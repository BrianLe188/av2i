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
 * scenario and on every variant that has no error finding. One container serves the whole run (docker exec per command);
 * providers are cached in a Docker volume.
 */
const IMAGE = "ghcr.io/opentofu/opentofu:1.12.9";
const registry = getRegistry();

const NAME = `av2i-tofu-${process.pid}`;

function docker(args: string[]) {
  return spawnSync("docker", args, { encoding: "utf8" });
}

function tofu(name: string, args: string[]): { ok: boolean; out: string } {
  const r = docker(["exec", "-w", `/work/${name}`, NAME, "tofu", ...args]);
  return { ok: r.status === 0, out: `${r.stdout}${r.stderr}` };
}

let failed = 0;
let checked = 0;
const root = mkdtempSync(join(tmpdir(), "av2i-tofu-"));
try {
  const up = docker(["run", "-d", "--rm", "--name", NAME, "--entrypoint", "sleep", "-v", `${root}:/work`, "-v", "av2i-tofu-cache:/cache", "-e", "TF_PLUGIN_CACHE_DIR=/cache", IMAGE, "3600"]);
  if (up.status !== 0) throw new Error(`cannot start the OpenTofu container: ${up.stderr}`);
  for (const s of executableScenarios()) {
    const cases = [{ id: "base", design: s.design }, ...s.variants.map((v) => ({ id: v.id, design: applyPatch(s.design, v.patch ?? []) }))];
    for (const c of cases) {
      if (runRules(c.design, registry).some((f) => f.severity === "error")) continue;
      const dir = join(root, `${s.id}-${c.id}`);
      mkdirSync(dir, { recursive: true });
      for (const [name, text] of Object.entries(generate(c.design))) writeFileSync(join(dir, name), text);
      const steps: [string, string[]][] = [["fmt", ["fmt", "-check", "-diff"]], ["init", ["init", "-backend=false", "-input=false", "-no-color"]], ["validate", ["validate", "-no-color"]]];
      for (const [label, args] of steps) {
        const r = tofu(`${s.id}-${c.id}`, args);
        if (!r.ok) { failed++; console.error(`FAIL ${s.id}/${c.id} ${label}\n${r.out}`); break; }
      }
      checked++;
      console.log(`ok   ${s.id}/${c.id}`);
    }
  }
} finally {
  docker(["rm", "-f", NAME]);
  rmSync(root, { recursive: true, force: true });
}
console.log(`\n${checked} design(s) checked, ${failed} failed`);
process.exit(failed ? 1 : 0);
