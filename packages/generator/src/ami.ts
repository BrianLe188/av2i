import type { NormalizedNode } from "@av2i/model";
import { ref, type Expr } from "./hcl.ts";
import type { PlanCtx } from "./ctx.ts";

/** Graviton and other Arm instance types: a family name ending in g (t4g, m7g, c6gn), or the first generation a1. */
export const isArm = (instanceType: unknown): boolean => typeof instanceType === "string" && /^([a-z]+\d+g[a-z]*|a1)\./.test(instanceType);

const FAMILIES = {
  "amazon-linux-2023": { owner: "amazon", name: (arch: string) => `al2023-ami-2023.*-${arch === "arm64" ? "arm64" : "x86_64"}` },
  "ubuntu-24-04": { owner: "099720109477", name: (arch: string) => `ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-${arch === "arm64" ? "arm64" : "amd64"}-server-*` },
} as const;

/** The image of an instance that names none: a data source for the newest image of its family and architecture (decision D-014). */
export function lookupAmi(c: PlanCtx, n: NormalizedNode): Expr {
  const family = (typeof n.props.ami_family === "string" && n.props.ami_family in FAMILIES ? n.props.ami_family : "amazon-linux-2023") as keyof typeof FAMILIES;
  const arch = isArm(n.props.instance_type) ? "arm64" : "x86_64";
  const name = `${family.replace(/-/g, "_")}_${arch}`;
  c.once(`aws_ami.${name}`, () =>
    c.add("compute.tf", {
      type: "data",
      labels: ["aws_ami", name],
      args: [["most_recent", true], ["owners", [FAMILIES[family].owner]]],
      blocks: [
        { type: "filter", labels: [], args: [["name", "name"], ["values", [FAMILIES[family].name(arch)]]] },
        { type: "filter", labels: [], args: [["name", "architecture"], ["values", [arch]]] },
        { type: "filter", labels: [], args: [["name", "virtualization-type"], ["values", ["hvm"]]] },
      ],
    }, n.key));
  return ref(`data.aws_ami.${name}.id`);
}
