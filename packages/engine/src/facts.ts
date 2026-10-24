import { Graph } from "./graph.ts";

export interface SubnetFacts {
  routeTable: string | null;
  public: boolean;
  /** the NAT gateway this subnet's table sends 0.0.0.0/0 to, when that gateway itself has a path out */
  natEgress: string | null;
  s3Endpoint: string | null;
}

export interface WorkloadFacts {
  subnet: string | null;
  /** every subnet the workload spans (ECS services, Lambda functions and databases may span several) */
  subnets: string[];
  publicAddress: boolean;
  direct: boolean;
  viaNat: boolean;
  internetEgress: boolean;
  s3Endpoint: string | null;
}

export interface Facts {
  subnets: Map<string, SubnetFacts>;
  workloads: Map<string, WorkloadFacts>;
}

/** Services whose workloads run in subnets and reach out to the network: instances, Fargate services and VPC-attached functions. */
export const WORKLOAD_SERVICES = ["ec2", "ecs", "lambda"] as const;

/** Public, private, egress and S3 path, derived once from routes and associations (egress-path mechanism). */
export function computeFacts(g: Graph): Facts {
  const subnets = new Map<string, SubnetFacts>();
  for (const s of g.nodesOf("subnet")) {
    const vpc = g.vpcOf(s.key);
    const tables = g.routeTablesOf(s.key);
    const table = tables[0];
    let pub = false;
    let nat: string | null = null;
    let s3: string | null = null;
    if (table) {
      for (const r of g.routesOf(table.key)) {
        if (r.target.service === "internet-gateway" && vpc && g.vpcOf(r.target.key)?.key === vpc.key) pub = true;
        if (r.target.service === "vpc-endpoint-s3") s3 = r.target.key;
      }
    }
    subnets.set(s.key, { routeTable: table?.key ?? null, public: pub, natEgress: nat, s3Endpoint: s3 });
  }
  // NAT egress needs the public flag of the NAT gateway's own subnet, so it is a second pass
  for (const s of g.nodesOf("subnet")) {
    const f = subnets.get(s.key)!;
    if (!f.routeTable) continue;
    for (const r of g.routesOf(f.routeTable)) {
      if (r.target.service !== "nat-gateway" || r.destination !== "0.0.0.0/0") continue;
      const host = g.parentOf(r.target.key);
      if (host && subnets.get(host.key)?.public) f.natEgress = r.target.key;
    }
  }

  const workloads = new Map<string, WorkloadFacts>();
  for (const svc of WORKLOAD_SERVICES) {
    for (const w of g.nodesOf(svc)) {
      if (svc === "ecs" && w.props.part !== "service") continue;
      const spans = g.subnetsOf(w.key);
      // a function outside every subnet is not in a VPC and needs no network path of its own
      if (svc === "lambda" && spans.length === 0) continue;
      const sfs = spans.map((s) => subnets.get(s.key)!);
      const explicit = svc === "ec2" ? w.props.associate_public_ip_address : svc === "ecs" ? (w.props.assign_public_ip === true) : false;
      const onLaunch = svc === "ec2" && spans[0]?.props.map_public_ip_on_launch === true;
      const publicAddress = g.elasticIpsOf(w.key).length > 0 || explicit === true || (explicit === undefined && onLaunch);
      const direct = sfs.length > 0 && sfs.every((f) => f.public) && publicAddress;
      const viaNat = sfs.length > 0 && sfs.every((f) => !!f.natEgress);
      const endpoints = sfs.map((f) => f.s3Endpoint);
      workloads.set(w.key, {
        subnet: spans[0]?.key ?? null,
        subnets: spans.map((s) => s.key),
        publicAddress,
        direct,
        viaNat,
        internetEgress: direct || viaNat,
        s3Endpoint: endpoints.length > 0 && endpoints.every((e) => e === endpoints[0]) ? endpoints[0] ?? null : null,
      });
    }
  }
  return { subnets, workloads };
}
