import type { Registry } from "@av2i/registry";
import type { Design, Edge, Node, Props, Value } from "@av2i/model";

const KEY_BASE: Record<string, string> = {
  vpc: "vpc", subnet: "subnet", "internet-gateway": "igw", "nat-gateway": "nat", "elastic-ip": "eip",
  "route-table": "rt", "vpc-endpoint-s3": "s3ep", "security-group": "sg", ec2: "ec2",
  ecr: "repo", s3: "bucket", rds: "db", lambda: "fn", "iam-role": "role",
};

/** Keys are immutable and become Terraform local names (DD-011): lowercase, digits and underscores. */
export function newKey(design: Design, service: string, part?: string): string {
  const base = service === "ecs" ? (part === "cluster" ? "cluster" : "svc") : (KEY_BASE[service] ?? service.replace(/[^a-z0-9]+/g, "_"));
  if (!design.nodes.some((n) => n.key === base)) return base;
  for (let i = 2; ; i++) if (!design.nodes.some((n) => n.key === `${base}_${i}`)) return `${base}_${i}`;
}

const hyphen = (key: string) => key.replace(/_/g, "-");

export function defaultProps(service: string, design: Design, parent: string | null, key: string, preset: Props = {}): Props {
  switch (service) {
    case "ecs":
      if (preset.part === "cluster") return { part: "cluster", name: hyphen(key) };
      return {
        part: "service",
        name: hyphen(key),
        cluster: design.nodes.find((n) => n.service === "ecs" && n.props.part === "cluster")?.key ?? "",
        cpu: "256", memory: "512", desired_count: 1, container_port: 80,
      };
    case "ecr":
      return { name: hyphen(key), image_tag_mutability: "IMMUTABLE", image_scanning_configuration: { scan_on_push: true } };
    case "s3":
      // names are global; the owner picks a real one
      return { bucket: `av2i-${hyphen(key)}-${design.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "design"}` };
    case "rds":
      return { engine: "postgres", instance_class: "db.t3.micro", allocated_storage: 20, username: "app", deletion_protection: true };
    case "lambda":
      return { function_name: hyphen(key), filename: "lambda.zip", handler: "index.handler", runtime: "nodejs22.x" };
    case "iam-role":
      return { name: hyphen(key) };
    case "vpc":
      return { cidr_block: `10.${design.nodes.filter((n) => n.service === "vpc").length}.0.0/16`, enable_dns_support: true, enable_dns_hostnames: true };
    case "subnet": {
      const vpc = design.nodes.find((n) => n.key === parent);
      const octets = String(vpc?.props.cidr_block ?? "10.0.0.0/16").split(".");
      const n = design.nodes.filter((x) => x.service === "subnet" && x.parent === parent).length;
      return { cidr_block: `${octets[0]}.${octets[1]}.${n * 10}.0/24`, availability_zone: `${design.settings.region}a` };
    }
    case "nat-gateway":
      return { availability_mode: "zonal", connectivity_type: "public" };
    case "security-group":
      return { name: key.replace(/_/g, "-"), description: "Managed by av2i", ingress_rules: [] };
    case "ec2":
      return { ami: "", instance_type: "t3.micro", metadata_options: { http_tokens: "required" }, root_block_device: { encrypted: true } };
    default:
      return {};
  }
}

export function addNode(reg: Registry, design: Design, service: string, parent: string | null, position: { x: number; y: number } | undefined, preset: Props = {}): { design: Design; key: string } {
  const key = newKey(design, service, typeof preset.part === "string" ? preset.part : undefined);
  const title = preset.part === "cluster" ? "ECS cluster" : preset.part === "service" ? "ECS service" : ((reg.services[service]?.title?.en as string | undefined) ?? service);
  const node: Node = { key, label: title.replace(/ \(.*$/, ""), service: service as Node["service"], ...(parent ? { parent } : {}), props: defaultProps(service, design, parent, key, preset), ...(position ? { position } : {}) };
  return { design: { ...design, nodes: [...design.nodes, node] }, key };
}

/** The node and everything inside it, as a set of keys. */
export function subtree(design: Design, key: string): Set<string> {
  const out = new Set([key]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const n of design.nodes) if (n.parent && out.has(n.parent) && !out.has(n.key)) { out.add(n.key); grew = true; }
  }
  return out;
}

export function removeNodes(design: Design, keys: readonly string[]): Design {
  const gone = new Set<string>();
  for (const k of keys) for (const x of subtree(design, k)) gone.add(x);
  return { ...design, nodes: design.nodes.filter((n) => !gone.has(n.key)), edges: design.edges.filter((e) => !gone.has(e.from) && !gone.has(e.to)) };
}

export const removeEdges = (design: Design, ids: readonly string[]): Design => ({ ...design, edges: design.edges.filter((e) => !ids.includes(e.id)) });
export const addEdge = (design: Design, edge: Edge): Design => ({ ...design, edges: [...design.edges, edge] });

export function updateNode(design: Design, key: string, f: (n: Node) => Node): Design {
  return { ...design, nodes: design.nodes.map((n) => (n.key === key ? f(n) : n)) };
}
export function updateEdge(design: Design, id: string, f: (e: Edge) => Edge): Design {
  return { ...design, edges: design.edges.map((e) => (e.id === id ? f(e) : e)) };
}

/** Immutable set (or unset, with `undefined`) at a dotted path inside a props object. */
export function setIn(props: Props, path: string, value: Value | undefined): Props {
  const [head, ...rest] = path.split(".") as [string, ...string[]];
  const out: Props = { ...props };
  if (rest.length === 0) {
    if (value === undefined) delete out[head];
    else out[head] = value;
    return out;
  }
  const inner = out[head];
  out[head] = setIn(inner !== null && typeof inner === "object" && !Array.isArray(inner) ? (inner as Props) : {}, rest.join("."), value);
  if (value === undefined && Object.keys(out[head] as Props).length === 0) delete out[head];
  return out;
}

export function getIn(props: Props, path: string): Value | undefined {
  let cur: Value | undefined = props;
  for (const p of path.split(".")) {
    if (cur === null || typeof cur !== "object" || Array.isArray(cur)) return undefined;
    cur = (cur as Props)[p];
  }
  return cur;
}
