import { Ajv } from "ajv";
import { existsSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { loadSpec, type SpecFile } from "./load.ts";
import { schemas } from "./schemas.ts";

export interface Problem {
  path: string;
  check: string;
  message: string;
}

export interface Registry {
  services: Record<string, Record<string, any>>;
  mechanisms: Record<string, Record<string, any>>;
  matrix: { services: string[]; pairs: { from: string; to: string; value: string; mechanism: string; note: string }[] };
  rules: Record<string, Record<string, any>>;
  cases: { rule: string; cases: { name: string; in: unknown; fires: boolean; base?: string; patch?: unknown[]; unrepresentable?: string }[] }[];
  scenarios: Record<string, Record<string, any>>;
  glossary: { term: string; vi: string; en: string; see: string }[];
  decisions: Record<string, { status: string; title: string }>;
  pitfalls: string[];
}

type Obj = Record<string, any>;

const RULE_ID = /\b(?:VAL|SEC)-\d{3}\b/g;
const PITFALL_ID = /\bP-\d{3}\b/g;
const DECISION_ID = /\bD-\d{3}\b/g;

/** Participants in a mechanism that are not services of the registry (roles in resource policies, DNS names). */
const NON_SERVICE_PARTICIPANTS = new Set(["aws service principals", "other accounts"]);

export function compile(root: string): { registry: Registry; problems: Problem[] } {
  const problems: Problem[] = [];
  const add = (path: string, check: string, message: string) => problems.push({ path, check, message });
  const { files, problems: loadProblems } = loadSpec(root);
  for (const p of loadProblems) add(p.path, "load", p.message);

  const ajv = new Ajv({ allErrors: true, strict: false });
  for (const s of Object.values(schemas)) ajv.addSchema(s as object);
  const validate = (path: string, schema: string, data: unknown) => {
    const fn = ajv.getSchema(schema);
    if (!fn) throw new Error(`no schema ${schema}`);
    if (!fn(data)) {
      for (const e of fn.errors ?? []) add(path, `schema:${schema}`, `${e.instancePath || "/"} ${e.message ?? "invalid"}`);
    }
  };

  const byKind = (k: string): SpecFile[] => files.filter((f) => f.kind === k);

  // ---- services
  const services: Registry["services"] = {};
  for (const f of byKind("service")) {
    if (!f.front) { add(f.path, "front-matter", "missing front matter"); continue; }
    validate(f.path, "service", f.front);
    const id = String(f.front.id);
    if (services[id]) add(f.path, "unique-id", `duplicate service ${id}`);
    if (f.path !== `services/${id}.md`) add(f.path, "file-name", `file name does not match id ${id}`);
    services[id] = f.front;
  }

  // ---- mechanisms
  const mechanisms: Registry["mechanisms"] = {};
  for (const f of byKind("mechanism")) {
    if (!f.front) { add(f.path, "front-matter", "missing front matter"); continue; }
    validate(f.path, "mechanism", f.front);
    const id = String(f.front.id);
    if (mechanisms[id]) add(f.path, "unique-id", `duplicate mechanism ${id}`);
    if (f.path !== `relations/${id}.md`) add(f.path, "file-name", `file name does not match id ${id}`);
    mechanisms[id] = f.front;
  }

  // ---- rules
  const rules: Registry["rules"] = {};
  for (const f of byKind("rules")) {
    const aliases = ((f.front?.source_aliases ?? {}) as Record<string, string>);
    if (!f.front?.source_aliases) add(f.path, "source-aliases", "rules file needs source_aliases in its front matter");
    if (f.blocks.length !== 1 || !Array.isArray(f.blocks[0])) { add(f.path, "rules-block", "expected exactly one yaml block holding a list of rules"); continue; }
    for (const r of f.blocks[0] as Obj[]) {
      validate(f.path, "rule", r);
      const id = String(r.id);
      if (typeof r.source === "string" && !r.source.startsWith("https://") && !aliases[r.source]) add(f.path, "source-alias", `${id} cites undefined source alias ${r.source}`);
      if (rules[id]) add(f.path, "unique-id", `duplicate rule ${id}`);
      if (!f.path.endsWith(id.startsWith("VAL") ? "validation.md" : "security.md")) add(f.path, "rule-file", `${id} is in the wrong file`);
      rules[id] = r;
    }
  }
  for (const prefix of ["VAL", "SEC"]) {
    const nums = Object.keys(rules).filter((i) => i.startsWith(prefix)).map((i) => Number(i.slice(4))).sort((a, b) => a - b);
    nums.forEach((n, i) => { if (n !== i + 1) add("rules", "rule-sequence", `${prefix} numbering has a gap or reorder near ${n}`); });
  }
  for (const [id, r] of Object.entries(rules)) {
    for (const a of (r.applies_to ?? []) as string[]) {
      if (!services[a] && !mechanisms[a]) add("rules", "applies-to", `${id} applies_to unknown id ${a}`);
    }
  }

  // ---- matrix
  const matrixFile = byKind("matrix")[0];
  const matrix: Registry["matrix"] = { services: [], pairs: [] };
  if (!matrixFile?.front) add("relations/matrix.md", "front-matter", "missing");
  else {
    validate(matrixFile.path, "matrix", matrixFile.front);
    matrix.services = matrixFile.front.services as string[];
    matrix.pairs = matrixFile.front.pairs as Registry["matrix"]["pairs"];
    const svcIds = Object.keys(services).sort();
    if (JSON.stringify([...matrix.services].sort()) !== JSON.stringify(svcIds)) add(matrixFile.path, "matrix-services", "matrix services differ from the service files");
    const seen = new Set<string>();
    const counts: Record<string, number> = { valid: 0, conditional: 0, invalid: 0, none: 0 };
    for (const p of matrix.pairs) {
      const k = `${p.from}>${p.to}`;
      if (seen.has(k)) add(matrixFile.path, "matrix-pair", `duplicate pair ${k}`);
      seen.add(k);
      counts[p.value] = (counts[p.value] ?? 0) + 1;
      if (!services[p.from] || !services[p.to]) add(matrixFile.path, "matrix-pair", `unknown service in ${k}`);
      if (p.mechanism !== "-" && !mechanisms[p.mechanism]) add(matrixFile.path, "matrix-mechanism", `${k} names unknown mechanism ${p.mechanism}`);
      if ((p.value === "valid" || p.value === "conditional") && p.mechanism === "-") add(matrixFile.path, "matrix-mechanism", `${k} is ${p.value} without a mechanism`);
    }
    for (const a of matrix.services) for (const b of matrix.services) if (!seen.has(`${a}>${b}`)) add(matrixFile.path, "matrix-pair", `missing pair ${a}>${b}`);
    const declared = matrixFile.front.counts as Record<string, number>;
    for (const k of Object.keys(counts)) if (declared[k] !== counts[k]) add(matrixFile.path, "matrix-counts", `counts.${k} is ${declared[k]}, computed ${counts[k]}`);
  }

  // ---- service and mechanism cross references
  for (const [id, s] of Object.entries(services)) {
    for (const r of (s.relations ?? []) as string[]) if (!mechanisms[r]) add(`services/${id}.md`, "relation", `relations names unknown mechanism ${r}`);
  }
  const matrixMechs: Record<string, Set<string>> = {};
  for (const p of matrix.pairs) {
    if (p.value === "valid" || p.value === "conditional") {
      (matrixMechs[p.from] ??= new Set()).add(p.mechanism);
      (matrixMechs[p.to] ??= new Set()).add(p.mechanism);
    }
  }
  for (const [id, s] of Object.entries(services)) {
    const declared = new Set((s.relations ?? []) as string[]);
    for (const m of matrixMechs[id] ?? []) if (!declared.has(m)) add(`services/${id}.md`, "relation-matrix", `matrix links ${id} through ${m} but the service does not list it`);
  }
  for (const [id, m] of Object.entries(mechanisms)) {
    for (const part of (m.participants ?? []) as Obj[]) {
      const list: string[] = Array.isArray(part.service) ? part.service : [part.service];
      for (const sv of list) if (!services[sv] && !NON_SERVICE_PARTICIPANTS.has(sv)) add(`relations/${id}.md`, "participant", `participant ${sv} is not a service`);
    }
    for (const r of (m.invalid_when ?? []) as string[]) if (!rules[r]) add(`relations/${id}.md`, "invalid-when", `unknown rule ${r}`);
  }

  // ---- decisions and pitfalls
  const decisions: Registry["decisions"] = {};
  const decFile = byKind("decisions")[0];
  if (decFile) {
    for (const m of decFile.body.matchAll(/^\| (D-\d{3}) \| (\w+) \| (.+) \|$/gm)) decisions[m[1]!] = { status: m[2]!, title: m[3]! };
    const headings = [...decFile.body.matchAll(/^## (D-\d{3}) /gm)].map((m) => m[1]!);
    for (const h of headings) if (!decisions[h]) add(decFile.path, "decision-table", `${h} has a section but no table row`);
    for (const d of Object.keys(decisions)) if (!headings.includes(d)) add(decFile.path, "decision-table", `${d} has a table row but no section`);
    for (const [d, v] of Object.entries(decisions)) if (!["open", "decided"].includes(v.status)) add(decFile.path, "decision-status", `${d} has status ${v.status}`);
  }
  const pitFile = byKind("pitfalls")[0];
  const pitfalls: string[] = pitFile ? [...pitFile.body.matchAll(/^\| (P-\d{3}) \|/gm)].map((m) => m[1]!) : [];
  pitfalls.forEach((p, i) => { if (Number(p.slice(2)) !== i + 1) add("terraform/pitfalls.md", "pitfall-sequence", `${p} is out of sequence`); });

  // ---- references in prose and front matter
  const text = (f: SpecFile) => JSON.stringify(f.front ?? {}) + "\n" + f.body;
  for (const f of files) {
    if (f.path.startsWith("rules/cases.md")) continue;
    const t = text(f);
    for (const m of t.matchAll(RULE_ID)) if (!rules[m[0]]) add(f.path, "reference", `unknown rule ${m[0]}`);
    for (const m of t.matchAll(PITFALL_ID)) if (!pitfalls.includes(m[0])) add(f.path, "reference", `unknown pitfall ${m[0]}`);
    for (const m of t.matchAll(DECISION_ID)) if (!decisions[m[0]]) add(f.path, "reference", `unknown decision ${m[0]}`);
    for (const m of f.body.matchAll(/\]\(([^)#\s]+?)(?:#[^)]*)?\)/g)) {
      const target = m[1]!;
      if (/^[a-z]+:/.test(target)) continue;
      if (!existsSync(normalize(join(root, dirname(f.path), target)))) add(f.path, "link", `broken link ${target}`);
    }
  }

  // ---- cases
  const casesFile = byKind("cases")[0];
  const cases: Registry["cases"] = [];
  if (casesFile?.front) {
    validate(casesFile.path, "cases", casesFile.front);
    for (const c of (casesFile.front.cases ?? []) as Registry["cases"]) {
      if (!rules[c.rule]) add(casesFile.path, "reference", `cases for unknown rule ${c.rule}`);
      cases.push(c);
    }
  }

  // ---- scenarios
  const scenarios: Registry["scenarios"] = {};
  const matrixIndex = new Map(matrix.pairs.map((p) => [`${p.from}>${p.to}`, p]));
  for (const f of byKind("scenario")) {
    if (!f.front) { add(f.path, "front-matter", "missing front matter"); continue; }
    validate(f.path, "scenario", f.front);
    scenarios[String(f.front.id)] = f.front;
    const listed = new Set(f.front.services as string[]);
    const nodes = new Map(((f.front.nodes ?? []) as Obj[]).map((n) => [n.id as string, n.service as string]));
    for (const [nid, sv] of nodes) {
      if (!services[sv]) add(f.path, "scenario-node", `${nid} uses unknown service ${sv}`);
      if (!listed.has(sv)) add(f.path, "scenario-services", `services list lacks ${sv}`);
    }
    for (const c of (f.front.connections ?? []) as Obj[]) {
      const a = nodes.get(c.from), b = nodes.get(c.to);
      if (!a || !b) { add(f.path, "scenario-connection", `${c.from} -> ${c.to} names an unknown node`); continue; }
      if (!mechanisms[c.mechanism]) { add(f.path, "scenario-connection", `unknown mechanism ${c.mechanism}`); continue; }
      if (c.kind !== "drawn") {
        // derived and generated links are checked against the mechanism's participants, not the matrix
        const services = new Set(((mechanisms[c.mechanism]!.participants ?? []) as Obj[]).flatMap((p) => (Array.isArray(p.service) ? p.service : [p.service])));
        if (!services.has(a) || !services.has(b)) add(f.path, "scenario-participants", `${c.from} -> ${c.to} (${a} -> ${b}) are not participants of ${c.mechanism}`);
        continue;
      }
      const cell = matrixIndex.get(`${a}>${b}`);
      if (!cell || cell.value === "none" || cell.value === "invalid") add(f.path, "scenario-matrix", `${c.from} -> ${c.to} (${a} -> ${b}) is ${cell?.value ?? "missing"} in the matrix`);
      else if (cell.mechanism !== c.mechanism) add(f.path, "scenario-matrix", `${c.from} -> ${c.to} uses ${c.mechanism} but the matrix gives ${cell.mechanism}`);
    }
    const exp = f.front.expect as Obj;
    const fired = [...exp.errors, ...exp.findings, ...(f.front.variants as Obj[]).flatMap((v) => v.fires)] as string[];
    for (const r of fired) if (!rules[r]) add(f.path, "reference", `unknown rule ${r}`);
    for (const r of exp.errors as string[]) if (rules[r] && rules[r].severity !== "error") add(f.path, "scenario-severity", `${r} listed as an error but is ${rules[r].severity}`);
    for (const v of f.front.variants as Obj[]) {
      const worst = (v.fires as string[]).map((r) => rules[r]?.severity).filter(Boolean);
      if (worst.length && !worst.includes(v.severity)) add(f.path, "variant-severity", `variant ${v.id} says ${v.severity} but its rules are ${worst.join(", ")}`);
    }
  }

  // ---- glossary
  const glossary: Registry["glossary"] = [];
  const glossaryFile = byKind("glossary")[0];
  if (glossaryFile?.front) {
    validate(glossaryFile.path, "glossary", glossaryFile.front);
    for (const t of (glossaryFile.front.terms ?? []) as Registry["glossary"]) {
      if (!existsSync(join(root, t.see))) add(glossaryFile.path, "glossary-see", `${t.term} points at missing ${t.see}`);
      glossary.push(t);
    }
  }

  return { registry: { services, mechanisms, matrix, rules, cases, scenarios, glossary, decisions, pitfalls }, problems };
}
