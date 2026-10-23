#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getRegistry } from "@av2i/registry";
import { checkDesign, type Design, type Finding } from "@av2i/model";
import { runRules } from "@av2i/rules";
import { generate } from "@av2i/generator";

const USAGE = `usage:
  av2i validate <design.json> [--lang vi|en]
  av2i generate <design.json> --out <dir> [--lang vi|en]`;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

function load(path: string): Design {
  return JSON.parse(readFileSync(resolve(path), "utf8")) as Design;
}

function print(findings: Finding[], lang: "vi" | "en"): void {
  const rank = { error: 0, warning: 1, info: 2 } as const;
  for (const f of [...findings].sort((a, b) => rank[a.severity] - rank[b.severity] || a.rule.localeCompare(b.rule))) {
    console.log(`${f.severity.padEnd(7)} ${f.rule}  ${f.targets.join(", ")}\n        ${f.message[lang]}\n        -> ${f.fix[lang]}`);
  }
}

const [command, file] = process.argv.slice(2);
const lang = arg("--lang") === "en" ? "en" : "vi";
if ((command !== "validate" && command !== "generate") || !file) {
  console.error(USAGE);
  process.exit(2);
}

const registry = getRegistry();
const design = load(file);
const structural = checkDesign(design, registry);
if (structural.length) {
  for (const p of structural) console.error(`invalid design: ${p.where}: ${p.message}`);
  process.exit(1);
}
const findings = runRules(design, registry);
print(findings, lang);
const errors = findings.filter((f) => f.severity === "error").length;
console.log(`\n${errors} error(s), ${findings.length - errors} other finding(s)`);

if (command === "validate") process.exit(errors ? 1 : 0);

const out = arg("--out");
if (!out) { console.error(USAGE); process.exit(2); }
if (errors) { console.error("not generating: fix the errors first"); process.exit(1); }
mkdirSync(resolve(out), { recursive: true });
for (const [name, text] of Object.entries(generate(design))) writeFileSync(resolve(out, name), text);
console.log(`wrote Terraform files to ${resolve(out)}`);
