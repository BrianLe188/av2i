import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyPatch } from "@av2i/model";
import { generate } from "@av2i/generator";
import { getRegistry } from "@av2i/registry";
import { runRules } from "@av2i/rules";
import { executableScenarios } from "../src/index.ts";

/**
 * Run `tofu fmt -check` and `tofu validate` (OpenTofu in Docker, pinned image) on the base design of every executable
 * scenario and on every variant that has no error finding. Providers are cached in a Docker volume.
 */
const IMAGE = "ghcr.io/opentofu/opentofu:1.12.9";
const registry = getRegistry();

function tofu(dir: string, args: string[]): { ok: boolean; out: string } {
  const r = spawnSync("docker", ["run", "--rm", "-v", `${dir}:/work`, "-v", "av2i-tofu-cache:/cache", "-e", "TF_PLUGIN_CACHE_DIR=/cache", "-w", "/work", IMAGE, ...args], { encoding: "utf8" });
  return { ok: r.status === 0, out: `${r.stdout}${r.stderr}` };
}

let failed = 0;
let checked = 0;
const root = mkdtempSync(join(tmpdir(), "av2i-tofu-"));
try {
  for (const s of executableScenarios()) {
    const cases = [{ id: "base", design: s.design }, ...s.variants.map((v) => ({ id: v.id, design: applyPatch(s.design, v.patch ?? []) }))];
    for (const c of cases) {
      if (runRules(c.design, registry).some((f) => f.severity === "error")) continue;
      const dir = join(root, `${s.id}-${c.id}`);
      mkdirSync(dir, { recursive: true });
      for (const [name, text] of Object.entries(generate(c.design))) writeFileSync(join(dir, name), text);
      const steps: [string, string[]][] = [["fmt", ["fmt", "-check", "-diff"]], ["init", ["init", "-backend=false", "-input=false", "-no-color"]], ["validate", ["validate", "-no-color"]]];
      for (const [label, args] of steps) {
        const r = tofu(dir, args);
        if (!r.ok) { failed++; console.error(`FAIL ${s.id}/${c.id} ${label}\n${r.out}`); break; }
      }
      checked++;
      console.log(`ok   ${s.id}/${c.id}`);
    }
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log(`\n${checked} design(s) checked, ${failed} failed`);
process.exit(failed ? 1 : 0);
