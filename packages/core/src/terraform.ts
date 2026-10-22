import { DB_PORTS, forwardPort, resolveEdges, type ResolvedEdge } from './edges';
import { vpcOf } from './graph';
import { parsePorts } from './ports';
import type { Graph, GraphNode } from './types';

type Attr = [key: string, value: string] | null;

function str(value: unknown): string {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$\{/g, '$${').replace(/\n/g, '\\n')}"`;
}

/** Multi-line values keep their own relative indentation; shift them under the key. */
function block(header: string, attrs: Attr[], extra: string[] = []): string {
  const rows = attrs.filter((a): a is [string, string] => a !== null);
  const width = Math.max(0, ...rows.map(([k]) => k.length));
  const lines = rows.map(([k, v]) => `  ${k.padEnd(width)} = ${v.replace(/\n/g, '\n  ')}`);
  return [`${header} {`, ...lines, ...extra.map((l) => `  ${l}`), '}'].join('\n');
}

function tags(name: string): Attr {
  return ['tags', `{ Name = ${str(name)} }`];
}

/** Provider-safe resource name: letters, digits, `-` and `_` only. */
function slug(name: string, max = 64): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, max);
}

/** One Terraform label per node, unique across every resource type. */
class Labels {
  private used = new Set<string>();
  private byId = new Map<string, string>();

  constructor(nodes: GraphNode[]) {
    for (const n of nodes) {
      const base = n.name.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^(\d)/, '_$1') || n.type;
      let label = base;
      for (let i = 2; this.used.has(label); i++) label = `${base}_${i}`;
      this.used.add(label);
      this.byId.set(n.id, label);
    }
  }

  of(node: GraphNode): string {
    return this.byId.get(node.id)!;
  }
}

const HAS_SG = new Set(['ec2', 'lambda', 'ecs', 'rds', 'alb']);

/** AWS rejects security group names that start with "sg-" (it reserves them for ids). */
const sgName = (n: GraphNode) => {
  const name = `${slug(n.name, 240)}-sg`;
  return /^sg-/i.test(name) ? `av2i-${name}` : name;
};

const hasCertificate = (alb: GraphNode) => String(alb.props.certificate_arn ?? '').trim() !== '';
/** With a certificate on a non-80 port, plain HTTP on 80 redirects to HTTPS (unless switched off). */
const redirectsHttp = (alb: GraphNode) =>
  hasCertificate(alb) && alb.props.redirect_http !== false && (Number(alb.props.listener_port) || 80) !== 80;

/** Returns `{ filename: contents }` for a Terraform root module. */
export function generateTerraform(graph: Graph, opts: { region: string }): Record<string, string> {
  const nodes = graph.nodes;
  const labels = new Labels(nodes);
  const L = (n: GraphNode) => labels.of(n);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const sections: string[] = [];
  const emitted = new Set<string>();
  /** Emit once per key, so duplicate edges don't produce duplicate resources. */
  const add = (key: string, text: string) => {
    if (emitted.has(key)) return;
    emitted.add(key);
    sections.push(text);
  };

  const resolved = resolveEdges(graph).filter(
    (r): r is ResolvedEdge & { from: GraphNode; to: GraphNode } => !!r.kind && !r.problem,
  );
  const edgesOf = (kind: string) => resolved.filter((r) => r.kind === kind);

  const archiveProvider = nodes.some((n) => n.type === 'lambda')
    ? `
    archive = {
      source  = "hashicorp/archive"
      version = ">= 2.0"
    }`
    : '';
  const providers = [
    `terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }${archiveProvider}
  }
}`,
    block('provider "aws"', [['region', str(opts.region)]]),
  ].join('\n\n');

  const ofType = (type: string) => nodes.filter((n) => n.type === type);
  const vpcs = ofType('vpc');
  const subnets = ofType('subnet');
  const sgRef = (n: GraphNode) => `aws_security_group.${L(n)}.id`;
  /** The security group av2i manages for a resource, plus any explicit security groups attached to it. */
  const sgList = (n: GraphNode) =>
    `[${[sgRef(n), ...edgesOf('sg-attach').filter((r) => r.to.id === n.id).map((r) => sgRef(r.from))].join(', ')}]`;

  // --- Network --------------------------------------------------------------
  for (const vpc of vpcs) {
    add(
      `vpc.${vpc.id}`,
      block(`resource "aws_vpc" "${L(vpc)}"`, [
        ['cidr_block', str(vpc.props.cidr_block)],
        ['enable_dns_support', 'true'],
        ['enable_dns_hostnames', String(Boolean(vpc.props.enable_dns_hostnames))],
        tags(vpc.name),
      ]),
    );
  }

  for (const subnet of subnets) {
    const vpc = subnet.parentId ? byId.get(subnet.parentId) : undefined;
    if (vpc?.type !== 'vpc') continue;
    add(
      `subnet.${subnet.id}`,
      block(`resource "aws_subnet" "${L(subnet)}"`, [
        ['vpc_id', `aws_vpc.${L(vpc)}.id`],
        ['cidr_block', str(subnet.props.cidr_block)],
        ['availability_zone', str(subnet.props.availability_zone)],
        ['map_public_ip_on_launch', String(Boolean(subnet.props.public))],
        tags(subnet.name),
      ]),
    );
  }

  for (const igw of ofType('igw')) {
    const vpc = vpcOf(nodes, igw);
    if (!vpc) continue;
    add(
      `igw.${igw.id}`,
      block(`resource "aws_internet_gateway" "${L(igw)}"`, [
        ['vpc_id', `aws_vpc.${L(vpc)}.id`],
        tags(igw.name),
      ]),
    );
  }

  for (const nat of ofType('nat')) {
    const vpc = vpcOf(nodes, nat);
    if (!vpc || !nat.parentId) continue;
    const igws = ofType('igw').filter((g) => vpcOf(nodes, g)?.id === vpc.id);
    add(
      `eip.${nat.id}`,
      block(`resource "aws_eip" "${L(nat)}"`, [['domain', str('vpc')], tags(nat.name)]),
    );
    add(
      `nat.${nat.id}`,
      block(
        `resource "aws_nat_gateway" "${L(nat)}"`,
        [
          ['allocation_id', `aws_eip.${L(nat)}.id`],
          ['subnet_id', `aws_subnet.${L(byId.get(nat.parentId)!)}.id`],
          tags(nat.name),
        ],
        igws.length ? [`depends_on = [${igws.map((g) => `aws_internet_gateway.${L(g)}`).join(', ')}]`] : [],
      ),
    );
  }

  for (const rt of ofType('route_table')) {
    const vpc = vpcOf(nodes, rt);
    if (!vpc) continue;
    const route = (target: string) => ['route {', '  cidr_block = "0.0.0.0/0"', `  ${target}`, '}'];
    const routes = [
      ...edgesOf('route')
        .filter((r) => r.to.id === rt.id)
        .flatMap((r) => route(`gateway_id = aws_internet_gateway.${L(r.from)}.id`)),
      ...edgesOf('nat-route')
        .filter((r) => r.to.id === rt.id)
        .flatMap((r) => route(`nat_gateway_id = aws_nat_gateway.${L(r.from)}.id`)),
    ];
    add(
      `rt.${rt.id}`,
      block(
        `resource "aws_route_table" "${L(rt)}"`,
        [['vpc_id', `aws_vpc.${L(vpc)}.id`], tags(rt.name)],
        routes,
      ),
    );
  }
  for (const r of edgesOf('association')) {
    add(
      `assoc.${r.from.id}.${r.to.id}`,
      block(`resource "aws_route_table_association" "${L(r.from)}_${L(r.to)}"`, [
        ['subnet_id', `aws_subnet.${L(r.to)}.id`],
        ['route_table_id', `aws_route_table.${L(r.from)}.id`],
      ]),
    );
  }

  // --- Security groups: one per instance / database / load balancer ---------
  const sgOwners = nodes.filter((n) => HAS_SG.has(n.type) && vpcOf(nodes, n));
  for (const n of sgOwners) {
    add(
      `sg.${n.id}`,
      block(`resource "aws_security_group" "${L(n)}"`, [
        ['name', str(sgName(n))],
        ['description', str(`Managed by av2i for ${n.name}`)],
        ['vpc_id', `aws_vpc.${L(vpcOf(nodes, n)!)}.id`],
        tags(`${n.name}-sg`),
      ]),
    );
  }

  const ingress = (
    label: string,
    owner: GraphNode,
    source: { sg: GraphNode } | { cidr: string },
    port: number,
    description: string,
  ) =>
    add(
      `rule.${label}`,
      block(`resource "aws_vpc_security_group_ingress_rule" "${label}"`, [
        ['security_group_id', sgRef(owner)],
        'sg' in source
          ? ['referenced_security_group_id', sgRef(source.sg)]
          : ['cidr_ipv4', str(source.cidr)],
        ['ip_protocol', '"tcp"'],
        ['from_port', String(port)],
        ['to_port', String(port)],
        ['description', str(description)],
      ]),
    );

  for (const n of sgOwners.filter((x) => x.type === 'ec2' || x.type === 'lambda' || x.type === 'ecs' || x.type === 'alb')) {
    add(
      `rule.${L(n)}_egress`,
      block(`resource "aws_vpc_security_group_egress_rule" "${L(n)}_all"`, [
        ['security_group_id', sgRef(n)],
        ['ip_protocol', '"-1"'],
        ['cidr_ipv4', '"0.0.0.0/0"'],
      ]),
    );
  }

  // Explicit security groups: their own rules, from the node's fields.
  for (const sg of ofType('sg')) {
    const vpc = vpcOf(nodes, sg);
    if (!vpc) continue;
    add(
      `sg.${sg.id}`,
      block(`resource "aws_security_group" "${L(sg)}"`, [
        ['name', str(sgName(sg))],
        // Not "Managed by av2i for ...": that prefix marks the groups av2i creates per resource, which import skips.
        ['description', str(`Security group ${sg.name} (av2i)`)],
        ['vpc_id', `aws_vpc.${L(vpc)}.id`],
        tags(sg.name),
      ]),
    );
    const cidr = String(sg.props.ingress_cidr).trim();
    for (const range of cidr ? (parsePorts(String(sg.props.ingress_ports)) ?? []) : []) {
      const span = range.from === range.to ? `${range.from}` : `${range.from}_${range.to}`;
      add(
        `rule.${L(sg)}_in_${span}`,
        block(`resource "aws_vpc_security_group_ingress_rule" "${L(sg)}_${span}"`, [
          ['security_group_id', sgRef(sg)],
          ['cidr_ipv4', str(cidr)],
          ['ip_protocol', '"tcp"'],
          ['from_port', String(range.from)],
          ['to_port', String(range.to)],
        ]),
      );
    }
    if (sg.props.egress_all !== false) {
      add(
        `rule.${L(sg)}_egress`,
        block(`resource "aws_vpc_security_group_egress_rule" "${L(sg)}_all"`, [
          ['security_group_id', sgRef(sg)],
          ['ip_protocol', '"-1"'],
          ['cidr_ipv4', '"0.0.0.0/0"'],
        ]),
      );
    }
  }

  for (const r of edgesOf('db-access')) {
    const port = DB_PORTS[String(r.to.props.engine)] ?? 5432;
    ingress(`${L(r.to)}_from_${L(r.from)}`, r.to, { sg: r.from }, port, `${r.from.name} to ${r.to.name}`);
  }
  for (const alb of ofType('alb')) {
    const vpc = vpcOf(nodes, alb);
    if (!vpc) continue;
    const source = alb.props.internal ? { cidr: String(vpc.props.cidr_block) } : { cidr: '0.0.0.0/0' };
    ingress(`${L(alb)}_listener`, alb, source, Number(alb.props.listener_port) || 80, 'Listener');
    if (redirectsHttp(alb)) ingress(`${L(alb)}_http_redirect`, alb, source, 80, 'HTTP redirect');
  }
  for (const r of edgesOf('forward')) {
    ingress(
      `${L(r.to)}_from_${L(r.from)}`,
      r.to,
      { sg: r.from },
      forwardPort(r.from, r.to),
      `Traffic from ${r.from.name}`,
    );
  }

  // --- IAM: roles for EC2 (with S3 edges) and Lambda (always) -----------------
  const addRole = (owner: GraphNode, service: string) =>
    add(
      `role.${owner.id}`,
      block(`resource "aws_iam_role" "${L(owner)}"`, [
        ['name', str(`${slug(owner.name, 56)}-role`)],
        [
          'assume_role_policy',
          `jsonencode({
  Version = "2012-10-17"
  Statement = [{
    Effect    = "Allow"
    Action    = "sts:AssumeRole"
    Principal = { Service = "${service}" }
  }]
})`,
        ],
      ]),
    );
  /** Least-privilege S3 policy for everything `owner` is connected to. */
  const addS3Policy = (owner: GraphNode) => {
    const access = edgesOf('s3-access').filter((r) => r.from.id === owner.id);
    if (access.length === 0) return;
    const readBuckets = access.filter((r) => r.edge.props?.access !== 'readwrite').map((r) => r.to);
    const writeBuckets = access.filter((r) => r.edge.props?.access === 'readwrite').map((r) => r.to);
    const arn = (b: GraphNode) => `aws_s3_bucket.${L(b)}.arn`;
    const objects = (b: GraphNode) => `"\${${arn(b)}}/*"`;
    const statements = [statement(['s3:ListBucket'], access.map((r) => arn(r.to)))];
    if (readBuckets.length) statements.push(statement(['s3:GetObject'], readBuckets.map(objects)));
    if (writeBuckets.length) {
      statements.push(
        statement(['s3:GetObject', 's3:PutObject', 's3:DeleteObject'], writeBuckets.map(objects)),
      );
    }
    add(
      `rolepolicy.${owner.id}`,
      block(`resource "aws_iam_role_policy" "${L(owner)}_s3"`, [
        ['name', '"s3-access"'],
        ['role', `aws_iam_role.${L(owner)}.id`],
        [
          'policy',
          `jsonencode({
  Version = "2012-10-17"
  Statement = [
${statements.map((x) => x.replace(/^/gm, '    ')).join(',\n')}
  ]
})`,
        ],
      ]),
    );
  };

  const profiles = new Set<string>();
  for (const ec2 of ofType('ec2')) {
    if (!edgesOf('s3-access').some((r) => r.from.id === ec2.id)) continue;
    profiles.add(ec2.id);
    addRole(ec2, 'ec2.amazonaws.com');
    addS3Policy(ec2);
    add(
      `profile.${ec2.id}`,
      block(`resource "aws_iam_instance_profile" "${L(ec2)}"`, [
        ['name', str(`${slug(ec2.name, 120)}-profile`)],
        ['role', `aws_iam_role.${L(ec2)}.name`],
      ]),
    );
  }

  // --- Compute and data -----------------------------------------------------
  const usableEc2 = ofType('ec2').filter((e) => e.parentId && byId.get(e.parentId)?.type === 'subnet');
  if (usableEc2.some((e) => !String(e.props.ami).trim())) {
    add(
      'ami',
      block('data "aws_ssm_parameter" "al2023_ami"', [
        ['name', str('/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64')],
      ]),
    );
  }
  for (const ec2 of usableEc2) {
    const subnet = byId.get(ec2.parentId!)!;
    const ami = String(ec2.props.ami).trim();
    add(
      `ec2.${ec2.id}`,
      block(
        `resource "aws_instance" "${L(ec2)}"`,
        [
          ['ami', ami ? str(ami) : 'data.aws_ssm_parameter.al2023_ami.value'],
          ['instance_type', str(ec2.props.instance_type)],
          ['subnet_id', `aws_subnet.${L(subnet)}.id`],
          ['vpc_security_group_ids', sgList(ec2)],
          profiles.has(ec2.id) ? ['iam_instance_profile', `aws_iam_instance_profile.${L(ec2)}.name`] : null,
          tags(ec2.name),
        ],
        [
          // Secure defaults: IMDSv2 only, encrypted root volume.
          'metadata_options {',
          '  http_endpoint = "enabled"',
          '  http_tokens   = "required"',
          '}',
          'root_block_device {',
          `  volume_size = ${Number(ec2.props.root_volume_size) || 8}`,
          '  encrypted   = true',
          '}',
        ],
      ),
    );
  }

  for (const fn of ofType('lambda').filter((f) => f.parentId && byId.get(f.parentId)?.type === 'subnet')) {
    const subnet = byId.get(fn.parentId!)!;
    const runtime = String(fn.props.runtime);
    const handler = String(fn.props.handler).trim() || 'index.handler';
    const dot = handler.lastIndexOf('.');
    const moduleName = dot > 0 ? handler.slice(0, dot) : 'index';
    const functionName = dot > 0 ? handler.slice(dot + 1) : handler;
    const node = runtime.startsWith('nodejs');
    const file = `${moduleName}.${node ? 'js' : 'py'}`;
    const source = node
      ? `exports.${functionName} = async () => ({ statusCode: 200, body: "Hello from ${fn.name}" });\n`
      : `def ${functionName}(event, context):\n    return {"statusCode": 200, "body": "Hello from ${fn.name}"}\n`;

    addRole(fn, 'lambda.amazonaws.com');
    add(
      `lambda-vpc.${fn.id}`,
      block(`resource "aws_iam_role_policy_attachment" "${L(fn)}_vpc"`, [
        ['role', `aws_iam_role.${L(fn)}.name`],
        ['policy_arn', '"arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"'],
      ]),
    );
    addS3Policy(fn);
    add(
      `lambda-src.${fn.id}`,
      `# Placeholder handler so this applies out of the box: replace it with your own code or package.\n` +
        block(`data "archive_file" "${L(fn)}"`, [
          ['type', '"zip"'],
          ['output_path', `"\${path.module}/.build/${L(fn)}.zip"`],
        ], [`source {`, `  content  = ${str(source)}`, `  filename = ${str(file)}`, `}`]),
    );
    add(
      `lambda.${fn.id}`,
      block(
        `resource "aws_lambda_function" "${L(fn)}"`,
        [
          ['function_name', str(slug(fn.name, 64))],
          ['role', `aws_iam_role.${L(fn)}.arn`],
          ['runtime', str(runtime)],
          ['handler', str(handler)],
          ['filename', `data.archive_file.${L(fn)}.output_path`],
          ['source_code_hash', `data.archive_file.${L(fn)}.output_base64sha256`],
          ['memory_size', String(Number(fn.props.memory_size) || 128)],
          ['timeout', String(Number(fn.props.timeout) || 10)],
          ['depends_on', `[aws_iam_role_policy_attachment.${L(fn)}_vpc]`],
          tags(fn.name),
        ],
        [
          'vpc_config {',
          `  subnet_ids         = [aws_subnet.${L(subnet)}.id]`,
          `  security_group_ids = ${sgList(fn)}`,
          '}',
        ],
      ),
    );
  }

  // --- ECS on Fargate -----------------------------------------------------------
  for (const svc of ofType('ecs').filter((s) => s.parentId && byId.get(s.parentId)?.type === 'subnet')) {
    const subnet = byId.get(svc.parentId!)!;
    const name = slug(svc.name, 63);
    const alb = edgesOf('forward').find((r) => r.to.id === svc.id)?.from;
    add(`ecs-cluster.${svc.id}`, block(`resource "aws_ecs_cluster" "${L(svc)}"`, [['name', str(name)], tags(svc.name)]));
    add(
      `ecs-logs.${svc.id}`,
      block(`resource "aws_cloudwatch_log_group" "${L(svc)}"`, [
        ['name', str(`/ecs/${name}`)],
        ['retention_in_days', '14'],
      ]),
    );
    add(
      `ecs-exec-role.${svc.id}`,
      block(`resource "aws_iam_role" "${L(svc)}_exec"`, [
        ['name', str(`${slug(svc.name, 50)}-exec-role`)],
        [
          'assume_role_policy',
          `jsonencode({
  Version = "2012-10-17"
  Statement = [{
    Effect    = "Allow"
    Action    = "sts:AssumeRole"
    Principal = { Service = "ecs-tasks.amazonaws.com" }
  }]
})`,
        ],
      ]),
    );
    add(
      `ecs-exec-attach.${svc.id}`,
      block(`resource "aws_iam_role_policy_attachment" "${L(svc)}_exec"`, [
        ['role', `aws_iam_role.${L(svc)}_exec.name`],
        ['policy_arn', '"arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"'],
      ]),
    );
    add(
      `ecs-task.${svc.id}`,
      block(`resource "aws_ecs_task_definition" "${L(svc)}"`, [
        ['family', str(name)],
        ['requires_compatibilities', '["FARGATE"]'],
        ['network_mode', '"awsvpc"'],
        ['cpu', str(svc.props.cpu)],
        ['memory', str(svc.props.memory)],
        ['execution_role_arn', `aws_iam_role.${L(svc)}_exec.arn`],
        [
          'container_definitions',
          `jsonencode([{
  name         = ${str(name)}
  image        = ${str(String(svc.props.image).trim())}
  essential    = true
  portMappings = [{ containerPort = ${Number(svc.props.container_port) || 80}, protocol = "tcp" }]
  logConfiguration = {
    logDriver = "awslogs"
    options = {
      "awslogs-group"         = aws_cloudwatch_log_group.${L(svc)}.name
      "awslogs-region"        = ${str(opts.region)}
      "awslogs-stream-prefix" = "ecs"
    }
  }
}])`,
        ],
      ]),
    );
    add(
      `ecs-service.${svc.id}`,
      block(
        `resource "aws_ecs_service" "${L(svc)}"`,
        [
          ['name', str(name)],
          ['cluster', `aws_ecs_cluster.${L(svc)}.id`],
          ['task_definition', `aws_ecs_task_definition.${L(svc)}.arn`],
          ['desired_count', String(Math.max(0, Number(svc.props.desired_count) || 0))],
          ['launch_type', '"FARGATE"'],
          alb ? ['depends_on', `[aws_lb_listener.${L(alb)}]`] : null,
          tags(svc.name),
        ],
        [
          'network_configuration {',
          `  subnets          = [aws_subnet.${L(subnet)}.id]`,
          `  security_groups  = ${sgList(svc)}`,
          // Tasks in a public subnet need a public IP to pull their image; private ones go through NAT.
          `  assign_public_ip = ${Boolean(subnet.props.public)}`,
          '}',
          ...(alb
            ? [
                'load_balancer {',
                `  target_group_arn = aws_lb_target_group.${L(alb)}.arn`,
                `  container_name   = ${str(name)}`,
                `  container_port   = ${Number(svc.props.container_port) || 80}`,
                '}',
              ]
            : []),
        ],
      ),
    );
  }

  const dbVpcs = new Set<string>();
  const rdss = ofType('rds');
  for (const db of rdss) {
    const vpc = vpcOf(nodes, db);
    if (!vpc || dbVpcs.has(vpc.id)) continue;
    dbVpcs.add(vpc.id);
    const members = subnets.filter((s) => s.parentId === vpc.id);
    add(
      `dbsubnets.${vpc.id}`,
      block(`resource "aws_db_subnet_group" "${L(vpc)}"`, [
        ['name', str(`${vpc.name}-db`.toLowerCase().replace(/[^a-z0-9-]/g, '-'))],
        ['subnet_ids', `[${members.map((s) => `aws_subnet.${L(s)}.id`).join(', ')}]`],
        tags(`${vpc.name}-db`),
      ]),
    );
  }
  for (const db of rdss) {
    const vpc = vpcOf(nodes, db);
    if (!vpc) continue;
    add(
      `rds.${db.id}`,
      block(`resource "aws_db_instance" "${L(db)}"`, [
        ['identifier', str(db.name.toLowerCase().replace(/[^a-z0-9-]/g, '-'))],
        ['engine', str(db.props.engine)],
        ['instance_class', str(db.props.instance_class)],
        ['allocated_storage', String(Number(db.props.allocated_storage) || 20)],
        ['username', str(db.props.username)],
        ['manage_master_user_password', 'true'],
        ['db_subnet_group_name', `aws_db_subnet_group.${L(vpc)}.name`],
        ['vpc_security_group_ids', sgList(db)],
        ['multi_az', String(Boolean(db.props.multi_az))],
        ['publicly_accessible', 'false'],
        ['storage_encrypted', 'true'],
        ['backup_retention_period', '7'],
        ['skip_final_snapshot', 'true'],
        tags(db.name),
      ]),
    );
  }

  // --- Load balancers -------------------------------------------------------
  for (const alb of ofType('alb')) {
    const vpc = vpcOf(nodes, alb);
    if (!vpc) continue;
    const pool = subnets.filter(
      (s) => s.parentId === vpc.id && (alb.props.internal || s.props.public),
    );
    const lbName = slug(alb.name, 32);
    add(
      `alb.${alb.id}`,
      block(`resource "aws_lb" "${L(alb)}"`, [
        ['name', str(lbName)],
        ['load_balancer_type', '"application"'],
        ['internal', String(Boolean(alb.props.internal))],
        ['security_groups', sgList(alb)],
        ['subnets', `[${pool.map((s) => `aws_subnet.${L(s)}.id`).join(', ')}]`],
        tags(alb.name),
      ]),
    );

    const targets = edgesOf('forward').filter((r) => r.from.id === alb.id);
    if (targets.length === 0) continue;
    // ECS tasks register by IP, EC2 instances by id; one target group can't mix both.
    const ec2Targets = targets.filter((r) => r.to.type !== 'ecs');
    const useIp = ec2Targets.length === 0;
    const targetPort = forwardPort(alb, targets[0].to);
    add(
      `tg.${alb.id}`,
      block(
        `resource "aws_lb_target_group" "${L(alb)}"`,
        [
          ['name', str(slug(`${alb.name}-tg`, 32))],
          ['port', String(targetPort)],
          ['protocol', '"HTTP"'],
          useIp ? ['target_type', '"ip"'] : null,
          ['vpc_id', `aws_vpc.${L(vpc)}.id`],
        ],
        ['health_check {', `  path = ${str(alb.props.health_check_path || '/')}`, '}'],
      ),
    );
    for (const r of ec2Targets) {
      add(
        `tgattach.${alb.id}.${r.to.id}`,
        block(`resource "aws_lb_target_group_attachment" "${L(alb)}_${L(r.to)}"`, [
          ['target_group_arn', `aws_lb_target_group.${L(alb)}.arn`],
          ['target_id', `aws_instance.${L(r.to)}.id`],
          ['port', String(targetPort)],
        ]),
      );
    }
    const https = hasCertificate(alb);
    add(
      `listener.${alb.id}`,
      block(
        `resource "aws_lb_listener" "${L(alb)}"`,
        [
          ['load_balancer_arn', `aws_lb.${L(alb)}.arn`],
          ['port', String(Number(alb.props.listener_port) || 80)],
          ['protocol', https ? '"HTTPS"' : '"HTTP"'],
          https ? ['ssl_policy', '"ELBSecurityPolicy-TLS13-1-2-2021-06"'] : null,
          https ? ['certificate_arn', str(String(alb.props.certificate_arn).trim())] : null,
        ],
        [
          'default_action {',
          '  type             = "forward"',
          `  target_group_arn = aws_lb_target_group.${L(alb)}.arn`,
          '}',
        ],
      ),
    );
    if (redirectsHttp(alb)) {
      add(
        `listener-redirect.${alb.id}`,
        block(
          `resource "aws_lb_listener" "${L(alb)}_http_redirect"`,
          [
            ['load_balancer_arn', `aws_lb.${L(alb)}.arn`],
            ['port', '80'],
            ['protocol', '"HTTP"'],
          ],
          [
            'default_action {',
            '  type = "redirect"',
            '  redirect {',
            `    port        = "${Number(alb.props.listener_port) || 443}"`,
            '    protocol    = "HTTPS"',
            '    status_code = "HTTP_301"',
            '  }',
            '}',
          ],
        ),
      );
    }
  }

  // --- CloudFront ---------------------------------------------------------------
  for (const cdn of ofType('cdn')) {
    const origin = edgesOf('cdn-origin').find((r) => r.from.id === cdn.id)?.to;
    if (!origin) continue;
    const isS3 = origin.type === 's3';
    const originId = `${isS3 ? 's3' : 'alb'}-${L(origin)}`;
    const cert = String(cdn.props.certificate_arn).trim();
    const aliases = String(cdn.props.aliases).split(',').map((a) => a.trim()).filter(Boolean);
    const root = String(cdn.props.default_root_object).trim();

    add(
      `cdn-cache.${cdn.id}`,
      block(`data "aws_cloudfront_cache_policy" "${L(cdn)}"`, [
        ['name', str(isS3 ? 'Managed-CachingOptimized' : 'Managed-CachingDisabled')],
      ]),
    );
    if (!isS3) {
      add(
        `cdn-orp.${cdn.id}`,
        block(`data "aws_cloudfront_origin_request_policy" "${L(cdn)}"`, [['name', str('Managed-AllViewer')]]),
      );
    }
    if (isS3) {
      add(
        `cdn-oac.${cdn.id}`,
        block(`resource "aws_cloudfront_origin_access_control" "${L(cdn)}"`, [
          ['name', str(`${slug(cdn.name, 50)}-oac`)],
          ['origin_access_control_origin_type', '"s3"'],
          ['signing_behavior', '"always"'],
          ['signing_protocol', '"sigv4"'],
        ]),
      );
    }

    const originBlock = isS3
      ? [
          'origin {',
          `  domain_name              = aws_s3_bucket.${L(origin)}.bucket_regional_domain_name`,
          `  origin_id                = ${str(originId)}`,
          `  origin_access_control_id = aws_cloudfront_origin_access_control.${L(cdn)}.id`,
          '}',
        ]
      : (() => {
          const https = String(origin.props.certificate_arn ?? '').trim() !== '';
          const port = Number(origin.props.listener_port) || (https ? 443 : 80);
          return [
            'origin {',
            `  domain_name = aws_lb.${L(origin)}.dns_name`,
            `  origin_id   = ${str(originId)}`,
            '  custom_origin_config {',
            `    http_port              = ${https ? 80 : port}`,
            `    https_port             = ${https ? port : 443}`,
            `    origin_protocol_policy = ${https ? '"https-only"' : '"http-only"'}`,
            '    origin_ssl_protocols   = ["TLSv1.2"]',
            '  }',
            '}',
          ];
        })();

    add(
      `cdn.${cdn.id}`,
      block(
        `resource "aws_cloudfront_distribution" "${L(cdn)}"`,
        [
          ['enabled', 'true'],
          ['is_ipv6_enabled', 'true'],
          ['comment', str(cdn.name)],
          ['price_class', str(cdn.props.price_class)],
          isS3 && root ? ['default_root_object', str(root)] : null,
          aliases.length ? ['aliases', `[${aliases.map(str).join(', ')}]`] : null,
          tags(cdn.name),
        ],
        [
          ...originBlock,
          'default_cache_behavior {',
          `  target_origin_id       = ${str(originId)}`,
          '  viewer_protocol_policy = "redirect-to-https"',
          isS3
            ? '  allowed_methods        = ["GET", "HEAD"]'
            : '  allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]',
          '  cached_methods         = ["GET", "HEAD"]',
          '  compress               = true',
          `  cache_policy_id        = data.aws_cloudfront_cache_policy.${L(cdn)}.id`,
          ...(isS3 ? [] : [`  origin_request_policy_id = data.aws_cloudfront_origin_request_policy.${L(cdn)}.id`]),
          '}',
          'restrictions {',
          '  geo_restriction {',
          '    restriction_type = "none"',
          '  }',
          '}',
          'viewer_certificate {',
          ...(cert
            ? [
                `  acm_certificate_arn      = ${str(cert)}`,
                '  ssl_support_method       = "sni-only"',
                '  minimum_protocol_version = "TLSv1.2_2021"',
              ]
            : ['  cloudfront_default_certificate = true']),
          '}',
        ],
      ),
    );
    if (isS3) {
      add(
        `cdn-policy.${cdn.id}`,
        block(`resource "aws_s3_bucket_policy" "${L(cdn)}"`, [
          ['bucket', `aws_s3_bucket.${L(origin)}.id`],
          // Applying a policy while the public access block is being created can fail; order them.
          ['depends_on', `[aws_s3_bucket_public_access_block.${L(origin)}]`],
          [
            'policy',
            `jsonencode({
  Version = "2012-10-17"
  Statement = [{
    Sid       = "AllowCloudFrontRead"
    Effect    = "Allow"
    Principal = { Service = "cloudfront.amazonaws.com" }
    Action    = "s3:GetObject"
    Resource  = "\${aws_s3_bucket.${L(origin)}.arn}/*"
    Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.${L(cdn)}.arn } }
  }]
})`,
          ],
        ]),
      );
    }
  }

  // --- Route 53 alias records -------------------------------------------------
  for (const r of edgesOf('dns-alias')) {
    const dns = r.from;
    add(
      `zone.${dns.id}`,
      block(`data "aws_route53_zone" "${L(dns)}"`, [
        ['name', str(String(dns.props.zone_name).trim())],
        ['private_zone', 'false'],
      ]),
    );
    add(
      `dns.${dns.id}`,
      block(
        `resource "aws_route53_record" "${L(dns)}"`,
        [
          ['zone_id', `data.aws_route53_zone.${L(dns)}.zone_id`],
          ['name', str(String(dns.props.record_name).trim())],
          ['type', '"A"'],
        ],
        [
          'alias {',
          r.to.type === 'cdn'
            ? `  name                   = aws_cloudfront_distribution.${L(r.to)}.domain_name`
            : `  name                   = aws_lb.${L(r.to)}.dns_name`,
          r.to.type === 'cdn'
            ? `  zone_id                = aws_cloudfront_distribution.${L(r.to)}.hosted_zone_id`
            : `  zone_id                = aws_lb.${L(r.to)}.zone_id`,
          `  evaluate_target_health = ${r.to.type !== 'cdn'}`,
          '}',
        ],
      ),
    );
  }

  // --- S3 -------------------------------------------------------------------
  for (const bucket of ofType('s3')) {
    add(
      `s3.${bucket.id}`,
      block(`resource "aws_s3_bucket" "${L(bucket)}"`, [
        ['bucket', str(bucket.props.bucket)],
        tags(bucket.name),
      ]),
    );
    add(
      `s3pab.${bucket.id}`,
      block(`resource "aws_s3_bucket_public_access_block" "${L(bucket)}"`, [
        ['bucket', `aws_s3_bucket.${L(bucket)}.id`],
        ['block_public_acls', 'true'],
        ['block_public_policy', 'true'],
        ['ignore_public_acls', 'true'],
        ['restrict_public_buckets', 'true'],
      ]),
    );
    if (bucket.props.versioning) {
      add(
        `s3v.${bucket.id}`,
        block(
          `resource "aws_s3_bucket_versioning" "${L(bucket)}"`,
          [['bucket', `aws_s3_bucket.${L(bucket)}.id`]],
          ['versioning_configuration {', '  status = "Enabled"', '}'],
        ),
      );
    }
  }

  return {
    'providers.tf': providers + '\n',
    'main.tf': sections.length ? sections.join('\n\n') + '\n' : '# Empty canvas: drag resources onto it.\n',
  };
}

/** One IAM policy statement as HCL. `resources` are raw HCL expressions. */
function statement(actions: readonly string[], resources: string[]): string {
  return [
    '{',
    '  Effect   = "Allow"',
    `  Action   = [${actions.map((a) => str(a)).join(', ')}]`,
    `  Resource = [${resources.join(', ')}]`,
    '}',
  ].join('\n');
}
