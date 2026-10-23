import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "./compile.ts";
import { generatedSource } from "./generate.ts";
import { schemas } from "./schemas.ts";

const here = dirname(fileURLToPath(import.meta.url));
const specRoot = resolve(here, "../../../docs/spec");
const outDir = resolve(here, "../dist");

const command = process.argv[2] ?? "check";
const { registry, problems } = compile(specRoot);

if (problems.length) {
  const byCheck = new Map<string, number>();
  for (const p of problems) byCheck.set(p.check, (byCheck.get(p.check) ?? 0) + 1);
  for (const p of problems) console.error(`${p.path}: [${p.check}] ${p.message}`);
  console.error(`\n${problems.length} problem(s): ${[...byCheck].map(([k, n]) => `${k}=${n}`).join(", ")}`);
  process.exit(1);
}

if (command === "build") {
  writeFileSync(resolve(here, "generated.ts"), generatedSource(registry));
  mkdirSync(resolve(outDir, "schema"), { recursive: true });
  writeFileSync(resolve(outDir, "registry.json"), JSON.stringify(registry, null, 2));
  for (const [name, s] of Object.entries(schemas)) writeFileSync(resolve(outDir, "schema", `${name}.json`), JSON.stringify(s, null, 2));
  console.log(`registry: ${Object.keys(registry.services).length} services, ${Object.keys(registry.mechanisms).length} mechanisms, ${Object.keys(registry.rules).length} rules, ${registry.cases.length} case groups, ${Object.keys(registry.scenarios).length} scenarios`);
} else {
  console.log("spec ok");
}
