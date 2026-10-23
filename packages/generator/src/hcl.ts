/** A Terraform expression: a literal, a list, a map, or a raw reference such as `aws_vpc.main.id`. */
export type Expr = string | number | boolean | Expr[] | { [key: string]: Expr } | Ref;

export interface Ref {
  ref: string;
}

export const ref = (code: string): Ref => ({ ref: code });
const isRef = (e: Expr): e is Ref => typeof e === "object" && e !== null && !Array.isArray(e) && "ref" in e && typeof (e as Ref).ref === "string" && Object.keys(e).length === 1;

export interface Block {
  type: string;
  labels: string[];
  args: [string, Expr][];
  blocks?: Block[];
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_-]*$/;

export function quote(s: string): string {
  const escaped = s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    .replace(/\$\{/g, () => "$${")
    .replace(/%\{/g, () => "%%{");
  return `"${escaped}"`;
}

const key = (k: string) => (IDENT.test(k) ? k : quote(k));

function inline(e: Expr): string | null {
  if (isRef(e)) return e.ref;
  if (typeof e === "string") return quote(e);
  if (typeof e === "number" || typeof e === "boolean") return String(e);
  if (Array.isArray(e)) {
    const parts = e.map(inline);
    return parts.every((p) => p !== null) ? `[${parts.join(", ")}]` : null;
  }
  return Object.keys(e).length === 0 ? "{}" : null;
}

/** Lines for `name = value`, with the value laid out the way `tofu fmt` does. */
function valueLines(e: Expr, indent: string): string[] {
  const one = inline(e);
  if (one !== null) return [one];
  if (Array.isArray(e)) {
    return ["[", ...e.flatMap((x) => { const l = valueLines(x, indent + "  "); return [`${indent}  ${l[0]}`, ...l.slice(1)].map((s, i, a) => (i === a.length - 1 && !s.endsWith(",") ? s + "," : s)); }), `${indent}]`];
  }
  const obj = e as { [key: string]: Expr };
  const entries = Object.entries(obj);
  const width = Math.max(...entries.map(([k]) => key(k).length));
  const lines = ["{"];
  for (const [k, v] of entries) {
    const l = valueLines(v, indent + "  ");
    lines.push(`${indent}  ${key(k).padEnd(width)} = ${l[0]}`, ...l.slice(1));
  }
  lines.push(`${indent}}`);
  return lines;
}

function bodyLines(b: Block, indent: string): string[] {
  const out: string[] = [];
  // `=` is aligned within a run of consecutive single-line attributes
  let run: [string, string][] = [];
  const flush = () => {
    const w = Math.max(0, ...run.map(([k]) => k.length));
    for (const [k, v] of run) out.push(`${indent}${k.padEnd(w)} = ${v}`);
    run = [];
  };
  for (const [name, expr] of b.args) {
    const lines = valueLines(expr, indent);
    // multi-line values and depends_on stand apart from the attributes above them
    if (lines.length > 1 || name === "depends_on") {
      flush();
      if (out.length && out[out.length - 1] !== "") out.push("");
    }
    if (lines.length === 1) run.push([key(name), lines[0]!]);
    else {
      out.push(`${indent}${key(name)} = ${lines[0]}`, ...lines.slice(1));
    }
  }
  flush();
  for (const nested of b.blocks ?? []) {
    if (out.length) out.push("");
    out.push(...blockLines(nested, indent));
  }
  return out;
}

function blockLines(b: Block, indent: string): string[] {
  const head = [b.type, ...b.labels.map(quote)].join(" ");
  const body = bodyLines(b, indent + "  ");
  return body.length ? [`${indent}${head} {`, ...body, `${indent}}`] : [`${indent}${head} {}`];
}

export function printBlocks(blocks: Block[]): string {
  return blocks.map((b) => blockLines(b, "").join("\n")).join("\n\n") + "\n";
}
