import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parse } from "yaml";

export type FileKind =
  | "service"
  | "mechanism"
  | "mechanism-catalogue"
  | "matrix"
  | "rules"
  | "cases"
  | "scenario"
  | "scenario-index"
  | "glossary"
  | "decisions"
  | "pitfalls"
  | "other";

export interface SpecFile {
  /** path relative to the spec root, with forward slashes */
  path: string;
  kind: FileKind;
  /** parsed front matter, or null when the file has none */
  front: Record<string, unknown> | null;
  /** markdown after the front matter */
  body: string;
  /** parsed fenced yaml blocks of the body (rules files keep their data there) */
  blocks: unknown[];
}

export interface LoadProblem {
  path: string;
  message: string;
}

/** A file starts with front matter when its first line is `---`; it ends at the next line that is exactly `---`. */
export function splitFrontMatter(text: string): { front: string | null; body: string } {
  const lines = text.split("\n");
  if (lines[0] !== "---") return { front: null, body: text };
  const end = lines.indexOf("---", 1);
  if (end === -1) return { front: null, body: text };
  return { front: lines.slice(1, end).join("\n"), body: lines.slice(end + 1).join("\n") };
}

export function yamlBlocks(body: string): string[] {
  const out: string[] = [];
  const re = /^```yaml\n([\s\S]*?)^```/gm;
  for (let m = re.exec(body); m; m = re.exec(body)) out.push(m[1] ?? "");
  return out;
}

export function kindOf(path: string): FileKind {
  if (path.startsWith("services/")) return "service";
  if (path === "relations/00-mechanisms.md") return "mechanism-catalogue";
  if (path === "relations/matrix.md") return "matrix";
  if (path.startsWith("relations/")) return "mechanism";
  if (path === "rules/validation.md" || path === "rules/security.md") return "rules";
  if (path === "rules/cases.md") return "cases";
  if (path === "scenarios/00-index.md") return "scenario-index";
  if (path.startsWith("scenarios/")) return "scenario";
  if (path === "01-glossary.md") return "glossary";
  if (path === "decisions.md") return "decisions";
  if (path === "terraform/pitfalls.md") return "pitfalls";
  return "other";
}

function walk(root: string, dir = root): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(root, full));
    else if (name.endsWith(".md")) out.push(relative(root, full).split("\\").join("/"));
  }
  return out;
}

export function loadSpec(root: string): { files: SpecFile[]; problems: LoadProblem[] } {
  const files: SpecFile[] = [];
  const problems: LoadProblem[] = [];
  for (const path of walk(root)) {
    const text = readFileSync(join(root, path), "utf8");
    const { front, body } = splitFrontMatter(text);
    let parsedFront: Record<string, unknown> | null = null;
    if (front !== null) {
      try {
        const v = parse(front);
        if (v === null || typeof v !== "object" || Array.isArray(v)) {
          problems.push({ path, message: "front matter is not a mapping" });
        } else parsedFront = v as Record<string, unknown>;
      } catch (e) {
        problems.push({ path, message: `front matter does not parse: ${(e as Error).message.split("\n")[0]}` });
      }
    }
    const blocks: unknown[] = [];
    for (const b of yamlBlocks(body)) {
      try {
        blocks.push(parse(b));
      } catch (e) {
        problems.push({ path, message: `yaml block does not parse: ${(e as Error).message.split("\n")[0]}` });
      }
    }
    files.push({ path, kind: kindOf(path), front: parsedFront, body, blocks });
  }
  return { files, problems };
}
