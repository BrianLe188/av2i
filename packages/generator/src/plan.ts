import { effectiveEgress, effectiveIngress, Graph, normalize, type SgRule } from "@av2i/engine";
import type { Design, NormalizedNode, Value } from "@av2i/model";
import { call, ref, type Block, type Expr } from "./hcl.ts";
import { resource, slug, toExpr, type FileName, type PlanCtx, type PlannedResource } from "./ctx.ts";
import { planContainers } from "./containers.ts";
import { planDatabase } from "./database.ts";
import { planIam } from "./iam.ts";
import { planStorage } from "./storage.ts";

export { type FileName, type PlannedResource } from "./ctx.ts";

/**
 * Map a design to Terraform resources (design README, stage 5). Local names come from node keys (DD-011); resources the
 * design does not draw (rules, routes, associations) get names built from the keys they connect.
 */
export function plan(design: Design): PlannedResource[] {
  const nd = normalize(design);
  const g = new Graph(nd);
  const out: PlannedResource[] = [];
  const add = (file: FileName, block: Block, from: string) => out.push({ file, block, from });
  const tags = (n: NormalizedNode): [string, Expr] => ["tags", { Name: n.label }];
  const names = new Map<string, number>();
  const unique = (type: string, base: string) => {
    const k = `${type}.${base}`;
    const n = (names.get(k) ?? 0) + 1;
    names.set(k, n);
    return n === 1 ? base : `${base}_${n}`;
  };
  const ctx: PlanCtx = { nd, g, add, unique, tags, optional: (n, keys) => keys.filter((k) => n.props[k] !== undefined).map((k) => [k, toExpr(n.props[k]!)]) };
  const igwOf = (key: string): NormalizedNode | undefined => {
    const vpc = g.vpcOf(key);
    return vpc ? g.nodesOf("internet-gateway").find((i) => g.vpcOf(i.key)?.key === vpc.key) : undefined;
  };
  const dependsOnIgw = (key: string): [string, Expr][] => {
    const igw = igwOf(key);
    return igw ? [["depends_on", [ref(`aws_internet_gateway.${igw.key}`)]]] : [];
  };
  const optional = ctx.optional;

  for (const n of nd.nodes.filter((x) => x.service === "vpc")) {
    add("network.tf", resource("aws_vpc", n.key, [["cidr_block", n.props.cidr_block as string], ...optional(n, ["enable_dns_support", "enable_dns_hostnames", "instance_tenancy"]), tags(n)]), n.key);
    add("network.tf", resource("aws_default_security_group", n.key, [["vpc_id", ref(`aws_vpc.${n.key}.id`)]]), n.key);
  }
  for (const n of nd.nodes.filter((x) => x.service === "internet-gateway")) {
    const vpc = g.vpcOf(n.key);
    add("network.tf", resource("aws_internet_gateway", n.key, [...(vpc ? [["vpc_id", ref(`aws_vpc.${vpc.key}.id`)] as [string, Expr]] : []), tags(n)]), n.key);
  }
  for (const n of nd.nodes.filter((x) => x.service === "subnet")) {
    const vpc = g.vpcOf(n.key)!;
    add("network.tf", resource("aws_subnet", n.key, [["vpc_id", ref(`aws_vpc.${vpc.key}.id`)], ["cidr_block", n.props.cidr_block as string], ...optional(n, ["availability_zone", "availability_zone_id", "map_public_ip_on_launch"]), tags(n)]), n.key);
  }
  for (const n of nd.nodes.filter((x) => x.service === "elastic-ip")) {
    const target = g.edges("eip-attach").find((e) => e.from === n.key)?.to;
    add("network.tf", resource("aws_eip", n.key, [["domain", "vpc"], tags(n), ...(target ? dependsOnIgw(target) : [])]), n.key);
  }
  for (const n of nd.nodes.filter((x) => x.service === "nat-gateway")) {
    const host = g.parentOf(n.key);
    const eips = g.elasticIpsOf(n.key);
    const args: [string, Expr][] = [];
    if (eips[0]) args.push(["allocation_id", ref(`aws_eip.${eips[0].key}.id`)]);
    if (eips.length > 1) args.push(["secondary_allocation_ids", eips.slice(1).map((e) => ref(`aws_eip.${e.key}.id`))]);
    if (host) args.push(["subnet_id", ref(`aws_subnet.${host.key}.id`)]);
    if (n.props.connectivity_type && n.props.connectivity_type !== "public") args.push(["connectivity_type", n.props.connectivity_type as string]);
    args.push(tags(n), ...dependsOnIgw(n.key));
    add("network.tf", resource("aws_nat_gateway", n.key, args), n.key);
  }
  for (const n of nd.nodes.filter((x) => x.service === "route-table")) {
    const vpc = g.vpcOf(n.key)!;
    add("network.tf", resource("aws_route_table", n.key, [["vpc_id", ref(`aws_vpc.${vpc.key}.id`)], tags(n)]), n.key);
  }
  for (const e of nd.edges.filter((x) => x.mechanism === "route")) {
    const target = g.node(e.to)!;
    if (target.service === "vpc-endpoint-s3") {
      add("network.tf", resource("aws_vpc_endpoint_route_table_association", unique("aws_vpc_endpoint_route_table_association", `${e.from}_${e.to}`), [["route_table_id", ref(`aws_route_table.${e.from}.id`)], ["vpc_endpoint_id", ref(`aws_vpc_endpoint.${e.to}.id`)]]), e.id);
      continue;
    }
    const dest = (e.props?.destination_cidr_block as string | undefined) ?? "0.0.0.0/0";
    const args: [string, Expr][] = [["route_table_id", ref(`aws_route_table.${e.from}.id`)], ["destination_cidr_block", dest]];
    args.push(target.service === "nat-gateway" ? ["nat_gateway_id", ref(`aws_nat_gateway.${e.to}.id`)] : ["gateway_id", ref(`aws_internet_gateway.${e.to}.id`)]);
    add("network.tf", resource("aws_route", unique("aws_route", `${e.from}_${dest === "0.0.0.0/0" ? "default" : slug(dest)}`), args), e.id);
  }
  for (const e of nd.edges.filter((x) => x.mechanism === "route-association")) {
    add("network.tf", resource("aws_route_table_association", unique("aws_route_table_association", `${e.from}_${e.to}`), [["subnet_id", ref(`aws_subnet.${e.to}.id`)], ["route_table_id", ref(`aws_route_table.${e.from}.id`)]]), e.id);
  }
  for (const n of nd.nodes.filter((x) => x.service === "vpc-endpoint-s3")) {
    const vpc = g.vpcOf(n.key)!;
    add("network.tf", resource("aws_vpc_endpoint", n.key, [["vpc_id", ref(`aws_vpc.${vpc.key}.id`)], ["service_name", `com.amazonaws.${nd.settings.region}.s3`], ["vpc_endpoint_type", "Gateway"], ...(n.props.policy ? ([["policy", call("jsonencode", (typeof n.props.policy === "string" ? JSON.parse(n.props.policy) : n.props.policy) as Expr)]] as [string, Expr][]) : []), tags(n)]), n.key);
  }

  const peerArgs = (r: SgRule): [string, Expr][] => {
    if (r.cidr_ipv4) return [["cidr_ipv4", r.cidr_ipv4]];
    if (r.cidr_ipv6) return [["cidr_ipv6", r.cidr_ipv6]];
    if (r.prefix_list_of) return [["prefix_list_id", ref(`aws_vpc_endpoint.${r.prefix_list_of}.prefix_list_id`)]];
    if (r.prefix_list_id) return [["prefix_list_id", r.prefix_list_id]];
    if (r.referenced_security_group_id) return [["referenced_security_group_id", g.node(r.referenced_security_group_id) ? ref(`aws_security_group.${r.referenced_security_group_id}.id`) : r.referenced_security_group_id]];
    return [];
  };
  const ruleName = (sg: string, dir: string, r: SgRule) => {
    const peer = r.cidr_ipv4 ?? r.cidr_ipv6 ?? r.prefix_list_of ?? r.prefix_list_id ?? r.referenced_security_group_id ?? "any";
    const ports = r.ip_protocol === "-1" ? "all" : r.from_port === r.to_port ? String(r.from_port) : `${r.from_port}_${r.to_port}`;
    return unique(`aws_vpc_security_group_${dir}_rule`, slug(`${sg}_${dir}_${r.ip_protocol === "-1" ? "all" : r.ip_protocol}_${ports}_${peer}`));
  };
  for (const n of nd.nodes.filter((x) => x.service === "security-group")) {
    const vpc = g.vpcOf(n.key)!;
    add("security.tf", resource("aws_security_group", n.key, [...optional(n, ["name"]), ["description", n.props.description as string], ["vpc_id", ref(`aws_vpc.${vpc.key}.id`)], tags(n)]), n.key);
    const emit = (dir: "ingress" | "egress", rules: SgRule[]) => {
      for (const r of rules) {
        const args: [string, Expr][] = [["security_group_id", ref(`aws_security_group.${n.key}.id`)], ["ip_protocol", r.ip_protocol]];
        if (r.ip_protocol !== "-1") args.push(["from_port", r.from_port as number], ["to_port", r.to_port as number]);
        args.push(...peerArgs(r));
        if (r.description) args.push(["description", r.description]);
        add("security.tf", resource(`aws_vpc_security_group_${dir}_rule`, ruleName(n.key, dir, r), args), n.key);
      }
    };
    emit("ingress", effectiveIngress(g, n.key));
    emit("egress", effectiveEgress(g, n.key));
  }

  for (const n of nd.nodes.filter((x) => x.service === "ec2")) {
    const subnet = g.subnetOf(n.key)!;
    const args: [string, Expr][] = [["ami", n.props.ami as string], ["instance_type", n.props.instance_type as string], ["subnet_id", ref(`aws_subnet.${subnet.key}.id`)]];
    const sgs = g.securityGroupsOf(n.key);
    if (sgs.length) args.push(["vpc_security_group_ids", sgs.map((s) => ref(`aws_security_group.${s.key}.id`))]);
    args.push(...optional(n, ["associate_public_ip_address"]));
    if (g.rolesOf(n.key).length) args.push(["iam_instance_profile", ref(`aws_iam_instance_profile.${n.key}.name`)]);
    args.push(tags(n));
    const blocks: Block[] = [];
    for (const k of ["metadata_options", "root_block_device"]) {
      const v = n.props[k];
      if (v && typeof v === "object" && !Array.isArray(v)) blocks.push({ type: k, labels: [], args: Object.entries(v).map(([a, b]) => [a, toExpr(b)] as [string, Expr]) });
    }
    if (g.elasticIpsOf(n.key).length || n.props.associate_public_ip_address === true) args.push(...dependsOnIgw(n.key));
    add("compute.tf", resource("aws_instance", n.key, args, blocks), n.key);
  }
  for (const e of nd.edges.filter((x) => x.mechanism === "eip-attach" && g.node(x.to)?.service === "ec2")) {
    add("compute.tf", resource("aws_eip_association", e.from, [["allocation_id", ref(`aws_eip.${e.from}.id`)], ["instance_id", ref(`aws_instance.${e.to}.id`)]]), e.id);
  }
  planStorage(ctx);
  planContainers(ctx);
  planDatabase(ctx);
  planIam(ctx);
  return out;
}
