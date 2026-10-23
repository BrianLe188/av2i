# Data model

TypeScript shapes for the Design and the pipeline stages. Service and mechanism IDs come from the registry; property keys
are Terraform argument names.

## Design (what the user saves)

```ts
type Design = {
  schema: 1;                       // version of this shape
  name: string;
  settings: {
    region: string;                // one Region per design; CloudFront certificates add a us-east-1 alias (D-022)
    partition: "aws";              // fixed
    provider: { version: "~> 6.66.0" };   // from D-001, not user editable
  };
  nodes: Node[];
  edges: Edge[];
};

type Node = {
  key: string;                     // immutable, [a-z][a-z0-9_]*; becomes the Terraform local name
  label: string;                   // free text, changes without side effects
  service: ServiceId;              // "vpc" | "subnet" | ... from the registry
  parent?: string;                 // key of the containing node (vpc for a subnet, subnet for an instance)
  props: Record<string, Value>;    // Terraform argument names; defaults come from the registry
  position?: { x: number; y: number };   // canvas only; ignored by the engine
};

type Edge = {
  id: string;
  mechanism: MechanismId;          // only user-drawn mechanisms: route, route-association, sg-attach, sg-reference,
                                   // network-access, listener-target, image-source, origin, dns-alias, cert-attach,
                                   // assume-role, grant, eip-attach (EC2), db-subnet-group
  from: string; to: string;        // node keys, in the direction the matrix gives
  props?: Record<string, Value>;   // for example { level: "read" } on a grant, { port: 5432 } on network-access
};
```

Rules the model enforces before any rule runs: every `service` and `mechanism` exists, every edge is `valid` or
`conditional` in the [matrix](../spec/relations/matrix.md) in its own direction, `parent` points at a node the
[containment](../spec/relations/containment.md) table allows, and `key` is unique.

## NormalizedDesign (what the engine works on)

```ts
type NormalizedDesign = Design & {
  nodes: (Node & { origin: "user" | "derived" | "generated"; because?: string })[];
  edges: (Edge & { origin: "user" | "derived" | "generated"; because?: string })[];
};
```

`because` names the edge or node that caused the element, so the UI can explain it and a deletion cascades correctly.

What normalization adds, from the spec:

| Added | From | Source |
|---|---|---|
| `containment`, `igw-attach`, `nat-placement` edges | `parent` | [containment](../spec/relations/containment.md) |
| Required roles with their managed policies | Lambda, ECS execution, RDS monitoring nodes | D-025, [assume-role](../spec/relations/assume-role.md) |
| An Elastic IP node and `eip-attach` per public zonal NAT gateway | NAT nodes | D-030 |
| `sg-reference` rules and their egress counterparts | `network-access`, `listener-target` | D-012, [network-access](../spec/relations/network-access.md) |
| One bucket policy per bucket, statements merged | `origin`, ALB access logs | [resource-policy](../spec/relations/resource-policy.md) |
| Validation records and the certificate validation | `cert-validation` | [cert-validation](../spec/relations/cert-validation.md) |
| The managed, rule-less default security group | each VPC | D-006 |
| Endpoint route table associations | `route` edges to an S3 endpoint | [route](../spec/relations/route.md) |
| Instance profile | EC2 `assume-role` | [assume-role](../spec/relations/assume-role.md) |
| `us-east-1` provider alias | CloudFront with an ACM certificate | D-022 |

Normalization is idempotent and never changes a user node or edge.

## Facts

```ts
type Facts = {
  subnet: Record<NodeKey, { public: boolean; routeTable: NodeKey | null }>;
  workload: Record<NodeKey, { directEgress: boolean; viaNat: boolean; internetEgress: boolean }>;
  s3Path: (workload: NodeKey, bucket: NodeKey) => boolean;
};
```

Computed once per validation run from the routes and associations; rules read them and never recompute.

## Finding

```ts
type Finding = {
  rule: RuleId;                    // VAL-070
  severity: "error" | "warning" | "info";
  targets: NodeKey[];              // nodes to highlight
  edges?: string[];
  message: { vi: string; en: string };   // from the registry, with {placeholders} filled
  fix: { vi: string; en: string };
};
```

`error` findings block export (see [conventions](../spec/00-conventions.md#7-severity)).

## Rule implementation

```ts
type RuleImpl = (ctx: Ctx) => Omit<Finding, "message" | "fix" | "severity">[];

interface Ctx {
  nodesOf(service: ServiceId): readonly NormalizedNode[];
  edgesOf(mechanism: MechanismId): readonly NormalizedEdge[];
  prop<T>(node: NodeKey, key: string): T | undefined;
  facts: Facts;
  limits: Limits;                  // from limits.md, including configurable settings
  region: string;
}
```

The registry supplies severity, message and fix, so a rule implementation decides only whether and where it fires.

## Plan and emit

```ts
type PlannedResource = {
  type: string;                    // "aws_subnet"
  name: string;                    // from the node key, unique per type
  args: Record<string, Expr>;      // Expr is a literal, a reference "aws_vpc.main.id" or a raw expression
  dependsOn: string[];
  from: NodeKey | string;          // node or edge that caused it
};
```

The planner sorts resources by dependency using the order in [resource-map](../spec/terraform/resource-map.md); the printer
writes HCL in that order, grouped into files by service group.

## Example

A design with one VPC, one public subnet and one instance:

```json
{
  "schema": 1,
  "name": "demo",
  "settings": { "region": "ap-southeast-1", "partition": "aws", "provider": { "version": "~> 6.66.0" } },
  "nodes": [
    { "key": "vpc", "label": "Main", "service": "vpc", "props": { "cidr_block": "10.0.0.0/16" } },
    { "key": "pub_a", "label": "Public A", "service": "subnet", "parent": "vpc", "props": { "cidr_block": "10.0.0.0/24", "availability_zone": "ap-southeast-1a" } },
    { "key": "web", "label": "Web", "service": "ec2", "parent": "pub_a", "props": { "instance_type": "t3.micro" } },
    { "key": "sg_web", "label": "web-sg", "service": "security-group", "parent": "vpc", "props": { "name": "web-sg", "description": "web" } }
  ],
  "edges": [
    { "id": "e1", "mechanism": "sg-attach", "from": "sg_web", "to": "web" }
  ]
}
```

Normalization adds no internet gateway unless the user draws one, so the instance has no path out and the design reports
VAL-032 (info). SEC-004 stays quiet because a group is attached, and the AMI is resolved by a data source (D-014). The
printer emits only arguments the user set or the spec says to emit explicitly (for example `enable_dns_support` keeps the
provider default `true`). The Terraform output starts:

```hcl
resource "aws_vpc" "vpc" {
  cidr_block = "10.0.0.0/16"
}

resource "aws_default_security_group" "vpc" {
  vpc_id = aws_vpc.vpc.id
}

resource "aws_subnet" "pub_a" {
  vpc_id            = aws_vpc.vpc.id
  cidr_block        = "10.0.0.0/24"
  availability_zone = "ap-southeast-1a"
}
```
