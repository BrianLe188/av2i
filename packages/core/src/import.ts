import { asBool, asNumber, asString, parseHcl, refOf, refsIn, type Block, type Expr } from './hcl';
import { addNode, autoResize, newId } from './graph';
import { REGIONS } from './resources';
import type { Graph, GraphEdge, GraphNode, PropValue, ResourceType } from './types';

export interface ImportReport {
  /** Resources turned into canvas nodes, by canvas type. */
  imported: Partial<Record<ResourceType, number>>;
  /** Terraform resource types that were read but have no canvas equivalent. */
  skipped: Record<string, number>;
  warnings: string[];
}

export interface ImportResult {
  graph: Graph;
  region: string;
  report: ImportReport;
}

/** Resource types that only add detail to a node we already draw; not worth listing as skipped. */
const ABSORBED = new Set([
  'aws_eip', 'aws_iam_role', 'aws_iam_role_policy', 'aws_iam_role_policy_attachment', 'aws_iam_instance_profile',
  'aws_security_group', 'aws_vpc_security_group_ingress_rule', 'aws_vpc_security_group_egress_rule',
  'aws_lb_target_group', 'aws_lb_listener', 'aws_lb_target_group_attachment', 'aws_db_subnet_group',
  'aws_cloudwatch_log_group', 'aws_ecs_cluster', 'aws_ecs_task_definition', 'aws_s3_bucket_versioning',
  'aws_s3_bucket_public_access_block', 'aws_s3_bucket_policy', 'aws_cloudfront_origin_access_control',
  'aws_route_table_association',
]);

type Ref = { type: string; name: string };
const key = (r: Ref | undefined) => (r ? `${r.type}.${r.name}` : '');

/**
 * Read Terraform source (one or more files concatenated) and rebuild a canvas graph from the AWS resources
 * it understands. Anything else is reported, not guessed at.
 */
export function importTerraform(source: string, opts: { region?: string } = {}): ImportResult {
  const blocks = parseHcl(source);
  const resources = blocks.filter((b) => b.type === 'resource' && b.labels.length === 2);
  const data = new Map(blocks.filter((b) => b.type === 'data' && b.labels.length === 2).map((b) => [key({ type: b.labels[0], name: b.labels[1] }), b]));
  const of = (type: string) => resources.filter((r) => r.labels[0] === type);
  const find = (ref: Ref | undefined) => (ref ? resources.find((r) => r.labels[0] === ref.type && r.labels[1] === ref.name) : undefined);

  const report: ImportReport = { imported: {}, skipped: {}, warnings: [] };
  const warn = (m: string) => report.warnings.push(m);

  const providerRegion = asString(blocks.find((b) => b.type === 'provider' && b.labels[0] === 'aws')?.attrs.region);
  const region = providerRegion && REGIONS.includes(providerRegion) ? providerRegion : opts.region ?? REGIONS[0];
  if (providerRegion && !REGIONS.includes(providerRegion)) warn(`Region ${providerRegion} is not supported yet; using ${region}.`);

  let nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const idOf = new Map<string, string>(); // "aws_vpc.main" -> node id

  const nameOf = (b: Block) => asString(tagsOf(b)?.entries.Name) ?? b.labels[1];
  function tagsOf(b: Block) {
    const t = b.attrs.tags;
    return t?.kind === 'object' ? t : undefined;
  }
  const lit = (e: Expr | undefined): PropValue | undefined => asString(e) ?? asNumber(e) ?? asBool(e);
  const firstRef = (e: Expr | undefined) => (e?.kind === 'list' ? refOf(e.items[0]) : refOf(e));
  const nested = (b: Block, type: string) => b.blocks.find((x) => x.type === type);

  const place = (b: Block, type: ResourceType, parent: Ref | undefined, props: Record<string, PropValue | undefined>) => {
    const parentId = parent ? idOf.get(key(parent)) : undefined;
    const needsParent = type !== 's3' && type !== 'cdn' && type !== 'dns' && type !== 'vpc';
    if (needsParent && !parentId) {
      warn(`${b.labels[0]}.${b.labels[1]} was skipped: its VPC or subnet is not in these files.`);
      report.skipped[b.labels[0]] = (report.skipped[b.labels[0]] ?? 0) + 1;
      return undefined;
    }
    const added = addNode(nodes, type, { region, parentId });
    const node: GraphNode = {
      ...added.node,
      name: nameOf(b),
      props: { ...added.node.props, ...Object.fromEntries(Object.entries(props).filter(([, v]) => v !== undefined)) } as Record<string, PropValue>,
    };
    nodes = added.nodes.map((n) => (n.id === node.id ? node : n));
    idOf.set(`${b.labels[0]}.${b.labels[1]}`, node.id);
    report.imported[type] = (report.imported[type] ?? 0) + 1;
    return node;
  };
  const link = (a: string | undefined, b: string | undefined, props?: Record<string, string>) => {
    if (!a || !b || a === b) return;
    if (edges.some((e) => (e.source === a && e.target === b) || (e.source === b && e.target === a))) return;
    edges.push({ id: newId(), source: a, target: b, props });
  };
  const id = (type: string, e: Expr | undefined) => idOf.get(key(refOf(e)?.type === type ? refOf(e) : undefined));

  // --- Network ---------------------------------------------------------------
  for (const b of of('aws_vpc')) {
    place(b, 'vpc', undefined, { cidr_block: lit(b.attrs.cidr_block), enable_dns_hostnames: asBool(b.attrs.enable_dns_hostnames) });
  }
  for (const b of of('aws_subnet')) {
    place(b, 'subnet', refOf(b.attrs.vpc_id), {
      cidr_block: lit(b.attrs.cidr_block),
      availability_zone: lit(b.attrs.availability_zone),
      public: asBool(b.attrs.map_public_ip_on_launch) ?? false,
    });
  }
  for (const b of of('aws_internet_gateway')) place(b, 'igw', refOf(b.attrs.vpc_id), {});
  for (const b of of('aws_nat_gateway')) place(b, 'nat', refOf(b.attrs.subnet_id), {});
  for (const b of of('aws_route_table')) place(b, 'route_table', refOf(b.attrs.vpc_id), {});

  // Explicit security groups: the ones av2i did not create itself.
  const sgRules = [...of('aws_vpc_security_group_ingress_rule')];
  for (const b of of('aws_security_group')) {
    if ((asString(b.attrs.description) ?? '').startsWith('Managed by av2i')) continue;
    const cidrs = new Set<string>();
    const ports: string[] = [];
    const take = (cidr: string | undefined, from: number | undefined, to: number | undefined) => {
      if (!cidr || from === undefined) return;
      cidrs.add(cidr);
      ports.push(to === undefined || to === from ? `${from}` : `${from}-${to}`);
    };
    for (const r of sgRules.filter((x) => key(refOf(x.attrs.security_group_id)) === `aws_security_group.${b.labels[1]}`)) {
      take(asString(r.attrs.cidr_ipv4), asNumber(r.attrs.from_port), asNumber(r.attrs.to_port));
    }
    for (const ing of b.blocks.filter((x) => x.type === 'ingress')) {
      const list = ing.attrs.cidr_blocks;
      take(list?.kind === 'list' ? asString(list.items[0]) : undefined, asNumber(ing.attrs.from_port), asNumber(ing.attrs.to_port));
    }
    if (cidrs.size > 1) warn(`${b.labels[1]} allows several source ranges; only ${[...cidrs][0]} was kept.`);
    place(b, 'sg', refOf(b.attrs.vpc_id), { ingress_cidr: [...cidrs][0] ?? '', ingress_ports: ports.join(', ') });
  }

  // --- Compute and data --------------------------------------------------------
  for (const b of of('aws_instance')) {
    const disk = nested(b, 'root_block_device');
    place(b, 'ec2', refOf(b.attrs.subnet_id), {
      instance_type: lit(b.attrs.instance_type),
      ami: asString(b.attrs.ami) ?? '',
      root_volume_size: asNumber(disk?.attrs.volume_size),
    });
  }
  for (const b of of('aws_db_instance')) {
    const group = find(refOf(b.attrs.db_subnet_group_name));
    const subnet = group ? firstRef(group.attrs.subnet_ids) : undefined;
    place(b, 'rds', subnet, {
      engine: lit(b.attrs.engine),
      instance_class: lit(b.attrs.instance_class),
      allocated_storage: asNumber(b.attrs.allocated_storage),
      multi_az: asBool(b.attrs.multi_az),
      username: lit(b.attrs.username),
    });
  }
  for (const b of of('aws_lambda_function')) {
    const vpc = nested(b, 'vpc_config');
    if (!vpc) {
      warn(`${b.labels[1]}: Lambda functions outside a VPC are not supported yet, so it was skipped.`);
      report.skipped.aws_lambda_function = (report.skipped.aws_lambda_function ?? 0) + 1;
      continue;
    }
    place(b, 'lambda', firstRef(vpc.attrs.subnet_ids), {
      runtime: lit(b.attrs.runtime),
      handler: lit(b.attrs.handler),
      memory_size: asNumber(b.attrs.memory_size),
      timeout: asNumber(b.attrs.timeout),
    });
  }
  for (const b of of('aws_ecs_service')) {
    const task = find(refOf(b.attrs.task_definition));
    const defs = task?.attrs.container_definitions?.raw ?? '';
    const net = nested(b, 'network_configuration');
    place(b, 'ecs', firstRef(net?.attrs.subnets), {
      image: /image\s*=\s*"([^"]+)"/.exec(defs)?.[1],
      container_port: Number(/containerPort\s*=\s*(\d+)/.exec(defs)?.[1]) || undefined,
      cpu: task ? asString(task.attrs.cpu) ?? (asNumber(task.attrs.cpu) !== undefined ? String(asNumber(task.attrs.cpu)) : undefined) : undefined,
      memory: task ? asNumber(task.attrs.memory) : undefined,
      desired_count: asNumber(b.attrs.desired_count),
    });
  }

  // --- Load balancers ----------------------------------------------------------
  const listenersOf = (lb: Block) => of('aws_lb_listener').filter((l) => key(refOf(l.attrs.load_balancer_arn)) === `aws_lb.${lb.labels[1]}`);
  const isRedirect = (l: Block) => l.blocks.some((x) => x.type === 'default_action' && asString(x.attrs.type) === 'redirect');
  for (const b of of('aws_lb')) {
    const subnet = idOf.get(key(firstRef(b.attrs.subnets)));
    const vpcId = nodes.find((n) => n.id === subnet)?.parentId;
    const vpcRef = [...idOf].find(([, v]) => v === vpcId)?.[0];
    const listeners = listenersOf(b);
    const main = listeners.find((l) => !isRedirect(l));
    const tg = find(refOf(main?.blocks.find((x) => x.type === 'default_action')?.attrs.target_group_arn));
    const cert = asString(main?.attrs.certificate_arn);
    const [vType, vName] = (vpcRef ?? '').split('.');
    place(b, 'alb', vpcRef ? { type: vType, name: vName } : undefined, {
      internal: asBool(b.attrs.internal),
      listener_port: asNumber(main?.attrs.port),
      target_port: asNumber(tg?.attrs.port),
      health_check_path: asString(tg?.blocks.find((x) => x.type === 'health_check')?.attrs.path),
      certificate_arn: cert,
      redirect_http: listeners.some(isRedirect),
    });
  }

  // --- Storage, CDN, DNS -------------------------------------------------------
  for (const b of of('aws_s3_bucket')) {
    const versioning = of('aws_s3_bucket_versioning').some((v) => key(refOf(v.attrs.bucket)) === `aws_s3_bucket.${b.labels[1]}`);
    place(b, 's3', undefined, { bucket: lit(b.attrs.bucket), versioning });
  }
  for (const b of of('aws_cloudfront_distribution')) {
    const aliases = b.attrs.aliases?.kind === 'list' ? b.attrs.aliases.items.map((i) => asString(i)).filter(Boolean) : [];
    place(b, 'cdn', undefined, {
      price_class: lit(b.attrs.price_class),
      default_root_object: asString(b.attrs.default_root_object),
      aliases: aliases.join(', '),
      certificate_arn: asString(nested(b, 'viewer_certificate')?.attrs.acm_certificate_arn) ?? '',
    });
  }
  for (const b of of('aws_route53_record')) {
    const zone = data.get(key(refOf(b.attrs.zone_id)));
    place(b, 'dns', undefined, { zone_name: asString(zone?.attrs.name), record_name: asString(b.attrs.name) });
  }

  // Explicit security groups attach to whatever lists them.
  const sgOwners = new Map<string, string[]>(); // "aws_security_group.x" -> owner node ids
  const noteSgs = (owner: Block, list: Expr | undefined) => {
    for (const item of list?.kind === 'list' ? list.items : []) {
      const ref = refOf(item);
      const ownerId = idOf.get(`${owner.labels[0]}.${owner.labels[1]}`);
      if (ref && ownerId) sgOwners.set(key(ref), [...(sgOwners.get(key(ref)) ?? []), ownerId]);
    }
  };
  for (const b of [...of('aws_instance'), ...of('aws_db_instance')]) noteSgs(b, b.attrs.vpc_security_group_ids);
  for (const b of of('aws_lb')) noteSgs(b, b.attrs.security_groups);
  for (const b of of('aws_lambda_function')) noteSgs(b, nested(b, 'vpc_config')?.attrs.security_group_ids);
  for (const b of of('aws_ecs_service')) noteSgs(b, nested(b, 'network_configuration')?.attrs.security_groups);
  for (const sg of of('aws_security_group')) {
    const sgId = idOf.get(`aws_security_group.${sg.labels[1]}`);
    for (const owner of sgOwners.get(`aws_security_group.${sg.labels[1]}`) ?? []) link(sgId, owner);
  }

  // --- Connections -------------------------------------------------------------
  for (const rt of of('aws_route_table')) {
    const rtId = idOf.get(`aws_route_table.${rt.labels[1]}`);
    for (const route of rt.blocks.filter((x) => x.type === 'route')) {
      link(rtId, id('aws_internet_gateway', route.attrs.gateway_id));
      link(rtId, id('aws_nat_gateway', route.attrs.nat_gateway_id));
    }
  }
  for (const a of of('aws_route_table_association')) link(id('aws_route_table', a.attrs.route_table_id), id('aws_subnet', a.attrs.subnet_id));

  // Load balancer targets: EC2 through attachments, ECS through the service's load_balancer block.
  const lbOfTargetGroup = new Map<string, string>(); // "aws_lb_target_group.x" -> alb node id
  for (const lb of of('aws_lb')) {
    for (const l of listenersOf(lb)) {
      const tgRef = refOf(l.blocks.find((x) => x.type === 'default_action')?.attrs.target_group_arn);
      if (tgRef) lbOfTargetGroup.set(key(tgRef), idOf.get(`aws_lb.${lb.labels[1]}`)!);
    }
  }
  for (const a of of('aws_lb_target_group_attachment')) {
    link(lbOfTargetGroup.get(key(refOf(a.attrs.target_group_arn))), id('aws_instance', a.attrs.target_id));
  }
  for (const s of of('aws_ecs_service')) {
    const lbBlock = nested(s, 'load_balancer');
    link(lbOfTargetGroup.get(key(refOf(lbBlock?.attrs.target_group_arn))), idOf.get(`aws_ecs_service.${s.labels[1]}`));
  }

  // Database access: an ingress rule on the database's group that names another group.
  for (const r of of('aws_vpc_security_group_ingress_rule')) {
    const targets = (sgOwners.get(key(refOf(r.attrs.security_group_id))) ?? []).filter((n) => nodes.find((x) => x.id === n)?.type === 'rds');
    const sources = (sgOwners.get(key(refOf(r.attrs.referenced_security_group_id))) ?? []).filter((n) =>
      ['ec2', 'lambda', 'ecs'].includes(nodes.find((x) => x.id === n)?.type ?? ''),
    );
    for (const t of targets) for (const s of sources) link(s, t);
  }

  // S3 access: an IAM policy naming buckets, on a role used by an instance or function.
  const roleUsers = new Map<string, string[]>(); // "aws_iam_role.x" -> node ids
  const profileRole = new Map(of('aws_iam_instance_profile').map((p) => [p.labels[1], key(refOf(p.attrs.role))]));
  for (const ec2 of of('aws_instance')) {
    const role = profileRole.get(refOf(ec2.attrs.iam_instance_profile)?.name ?? '');
    if (role) roleUsers.set(role, [...(roleUsers.get(role) ?? []), idOf.get(`aws_instance.${ec2.labels[1]}`)!]);
  }
  for (const fn of of('aws_lambda_function')) {
    const role = key(refOf(fn.attrs.role));
    if (role) roleUsers.set(role, [...(roleUsers.get(role) ?? []), idOf.get(`aws_lambda_function.${fn.labels[1]}`)!]);
  }
  for (const p of of('aws_iam_role_policy')) {
    const policy = p.attrs.policy?.raw ?? '';
    const access = /s3:(PutObject|DeleteObject)/.test(policy) ? 'readwrite' : 'read';
    const buckets = refsIn(policy).filter((r) => r.type === 'aws_s3_bucket').map((r) => idOf.get(key(r)));
    for (const user of roleUsers.get(key(refOf(p.attrs.role))) ?? []) for (const bucket of buckets) link(user, bucket, { access });
  }

  // CloudFront origins and DNS aliases.
  for (const cdn of of('aws_cloudfront_distribution')) {
    const cdnId = idOf.get(`aws_cloudfront_distribution.${cdn.labels[1]}`);
    const origin = nested(cdn, 'origin');
    const ref = refOf(origin?.attrs.domain_name);
    link(cdnId, idOf.get(key(ref?.type === 'aws_s3_bucket' || ref?.type === 'aws_lb' ? ref : undefined)));
  }
  for (const rec of of('aws_route53_record')) {
    const alias = nested(rec, 'alias');
    const ref = refOf(alias?.attrs.name);
    link(idOf.get(`aws_route53_record.${rec.labels[1]}`), idOf.get(key(ref?.type === 'aws_lb' || ref?.type === 'aws_cloudfront_distribution' ? ref : undefined)));
  }

  for (const r of resources) {
    const type = r.labels[0];
    if (type in KNOWN_TYPES || ABSORBED.has(type)) continue;
    report.skipped[type] = (report.skipped[type] ?? 0) + 1;
  }

  const containers = nodes.filter((n) => n.type === 'vpc' || n.type === 'subnet').map((n) => n.id);
  return { graph: { nodes: autoResize(nodes, { fit: containers }), edges }, region, report };
}

/** Terraform types that become canvas nodes (already counted in `imported`). */
const KNOWN_TYPES: Record<string, true> = {
  aws_vpc: true, aws_subnet: true, aws_internet_gateway: true, aws_nat_gateway: true, aws_route_table: true,
  aws_instance: true, aws_db_instance: true, aws_lambda_function: true, aws_ecs_service: true, aws_lb: true,
  aws_s3_bucket: true, aws_cloudfront_distribution: true, aws_route53_record: true,
};
