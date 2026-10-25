import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compile } from "../src/compile.ts";
import { splitFrontMatter, yamlBlocks } from "../src/load.ts";

const specRoot = resolve(import.meta.dirname, "../../../docs/spec");
const temps: string[] = [];

/** Copy the specification, apply one text edit to a file, compile and return the problem checks. */
function mutate(file: string, from: string | RegExp, to: string): string[] {
  const dir = mkdtempSync(join(tmpdir(), "av2i-spec-"));
  temps.push(dir);
  cpSync(specRoot, dir, { recursive: true });
  const path = join(dir, file);
  const before = readFileSync(path, "utf8");
  const after = before.replace(from, to);
  expect(after).not.toBe(before);
  writeFileSync(path, after);
  return compile(dir).problems.map((p) => p.check);
}

afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("the real specification", () => {
  const { registry, problems } = compile(specRoot);

  it("has no problems", () => {
    expect(problems).toEqual([]);
  });

  it("compiles every service, mechanism and rule", () => {
    expect(Object.keys(registry.services)).toHaveLength(21);
    expect(Object.keys(registry.mechanisms)).toHaveLength(20);
    expect(Object.keys(registry.rules).length).toBeGreaterThan(170);
    expect(registry.matrix.pairs).toHaveLength(registry.matrix.services.length ** 2);
  });

  it("exposes rule severity and decision status by ID", () => {
    expect(registry.rules["VAL-070"]?.severity).toBe("warning");
    expect(registry.decisions["D-030"]?.status).toBe("decided");
  });
});

describe("the checks catch a damaged specification", () => {
  it("a missing matrix pair", () => {
    expect(mutate("relations/matrix.md", /  - \{ from: vpc, to: vpc, value: none[^\n]*\n/, "")).toContain("matrix-pair");
  });
  it("a service naming an unknown mechanism", () => {
    expect(mutate("services/vpc.md", "relations: [containment, igw-attach]", "relations: [containment, igw-attach, nope]")).toContain("relation");
  });
  it("a reference to a rule that does not exist", () => {
    expect(mutate("services/vpc.md", "## Purpose", "## Purpose\n\nSee VAL-999.")).toContain("reference");
  });
  it("a broken relative link", () => {
    expect(mutate("services/vpc.md", "## Purpose", "## Purpose\n\n[x](../nowhere.md)")).toContain("link");
  });
  it("a verified rule without a source", () => {
    expect(mutate("rules/validation.md", /(id: VAL-001\n(?:.*\n){5}  source: )[^\n]+/, "$1null")).toContain("schema:rule");
  });
  it("an undefined source alias", () => {
    expect(mutate("rules/validation.md", /(id: VAL-001\n(?:.*\n){5}  source: )[^\n]+/, "$1AWS-NOPE")).toContain("source-alias");
  });
  it("a scenario connection the matrix forbids", () => {
    expect(mutate("scenarios/three-tier-web.md", "from: pub-a, to: alb, mechanism: containment", "from: alb, to: pub-a, mechanism: containment")).toContain("scenario-matrix");
  });
  it("a scenario naming an unknown rule", () => {
    expect(mutate("scenarios/three-tier-web.md", "fires: [VAL-013]", "fires: [VAL-998]")).toContain("reference");
  });
  it("front matter that does not parse", () => {
    expect(mutate("services/vpc.md", "id: vpc\n", "id: [vpc\n")).toContain("load");
  });
  it("a decision with a section but no table row", () => {
    expect(mutate("decisions.md", "| D-030 | decided |", "| D-0300 | decided |")).toContain("decision-table");
  });
});

describe("front matter splitting", () => {
  it("ends front matter at the first line that is exactly ---", () => {
    const { front, body } = splitFrontMatter("---\na: 1\n# ---- not a delimiter\n---\nbody\n---\nmore");
    expect(front).toBe("a: 1\n# ---- not a delimiter");
    expect(body).toBe("body\n---\nmore");
  });
  it("returns no front matter without an opening delimiter", () => {
    expect(splitFrontMatter("# Title\n---\n").front).toBeNull();
  });
  it("finds yaml blocks only", () => {
    expect(yamlBlocks("```yaml\na: 1\n```\n```bash\nls\n```\n")).toEqual(["a: 1\n"]);
  });
});

describe("generated identifiers", () => {
  it("are current", async () => {
    const { generatedSource } = await import("../src/generate.ts");
    const current = readFileSync(resolve(import.meta.dirname, "../src/generated.ts"), "utf8");
    expect(generatedSource(compile(specRoot).registry)).toBe(current);
  });
});
