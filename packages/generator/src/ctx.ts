import type { Graph } from "@av2i/engine";
import type { NormalizedDesign, NormalizedNode, Value } from "@av2i/model";
import type { Block, Expr } from "./hcl.ts";
import { ref } from "./hcl.ts";

export type FileName = "network.tf" | "security.tf" | "compute.tf" | "storage.tf" | "database.tf" | "iam.tf" | "variables.tf" | "delivery.tf" | "dns.tf" | "cdn.tf";

export interface PlannedResource {
  file: FileName;
  block: Block;
  /** the node or edge that caused the resource */
  from: string;
}

/** What each service planner gets: the normalized design, its graph, and ways to add and name resources. */
export interface PlanCtx {
  nd: NormalizedDesign;
  g: Graph;
  add: (file: FileName, block: Block, from: string) => void;
  unique: (type: string, base: string) => string;
  tags: (n: NormalizedNode) => [string, Expr];
  optional: (n: NormalizedNode, keys: string[]) => [string, Expr][];
  /** run `f` the first time `key` is seen: for blocks several services share, such as the account data source */
  once: (key: string, f: () => void) => void;
}

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "x";

export function resource(type: string, name: string, args: [string, Expr][], blocks: Block[] = []): Block {
  return { type: "resource", labels: [type, name], args, blocks };
}

/** A value of a design as an expression; `{ $ref }` and `{ $template }` (see the engine's policy statements) become Terraform references. */
export const toExpr = (v: Value): Expr => {
  if (Array.isArray(v)) return v.map(toExpr);
  if (v !== null && typeof v === "object") {
    const keys = Object.keys(v);
    if (keys.length === 1 && keys[0] === "$ref" && typeof v.$ref === "string") return ref(v.$ref);
    if (keys.length === 1 && keys[0] === "$template" && typeof v.$template === "string") return template(v.$template);
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toExpr(x)]));
  }
  return v as Expr;
};

/** A double-quoted Terraform template that mixes text with references, such as `"${aws_s3_bucket.x.arn}/*"`. */
export const template = (code: string) => ref(`"${code}"`);

/** An object turned into nested blocks: scalar entries become arguments, objects and lists of objects become blocks. */
export function blocksOf(type: string, value: Value): Block[] {
  if (Array.isArray(value)) return value.flatMap((v) => blocksOf(type, v));
  if (value === null || typeof value !== "object") return [];
  const args: [string, Expr][] = [];
  const blocks: Block[] = [];
  for (const [k, v] of Object.entries(value)) {
    const nested = v !== null && typeof v === "object" && !(Array.isArray(v) && v.every((x) => x === null || typeof x !== "object"));
    if (nested) blocks.push(...blocksOf(k, v as Value));
    else args.push([k, toExpr(v as Value)]);
  }
  return [{ type, labels: [], args, blocks }];
}

/** The key of a node with underscores turned into hyphens: the default for names AWS accepts hyphens in but not underscores. */
export const hyphen = (key: string) => key.replace(/_/g, "-");
