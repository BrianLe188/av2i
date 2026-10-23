import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { generate } from "@av2i/generator";
import { executableScenarios } from "../src/index.ts";

// Rewrite the committed golden files from the current generator. Review the diff before committing.
for (const s of executableScenarios()) {
  const dir = resolve(import.meta.dirname, "../golden", s.id);
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(generate(s.design))) writeFileSync(resolve(dir, name), text);
  mkdirSync(resolve(import.meta.dirname, "../designs"), { recursive: true });
  writeFileSync(resolve(import.meta.dirname, "../designs", `${s.id}.json`), JSON.stringify(s.design, null, 2) + "\n");
  console.log("wrote", s.id);
}
