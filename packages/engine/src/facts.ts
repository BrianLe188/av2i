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

export const WORKLOAD_SERVICES = ["ec2"] as const;

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
      const subnet = g.subnetOf(w.key);
      const sf = subnet ? subnets.get(subnet.key) : undefined;
      const explicit = w.props.associate_public_ip_address;
      const onLaunch = subnet?.props.map_public_ip_on_launch === true;
      const publicAddress = g.elasticIpsOf(w.key).length > 0 || explicit === true || (explicit === undefined && onLaunch);
      const direct = !!sf?.public && publicAddress;
      const viaNat = !!sf?.natEgress;
      workloads.set(w.key, { subnet: subnet?.key ?? null, publicAddress, direct, viaNat, internetEgress: direct || viaNat, s3Endpoint: sf?.s3Endpoint ?? null });
    }
  }
  return { subnets, workloads };
}
