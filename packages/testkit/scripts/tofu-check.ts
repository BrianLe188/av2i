import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
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
 * providers are cached in a Docker volume. `tofu init` runs once, in a directory that holds only the version constraints,
 * and its `.terraform` directory and lock file are copied into every design (all designs share them), so each design costs
 * a `fmt` and a `validate`. Designs are checked a few at a time; set TOFU_JOBS to change how many.
 */
const IMAGE = "ghcr.io/opentofu/opentofu:1.12.9";
const JOBS = Number(process.env.TOFU_JOBS ?? 4);
const registry = getRegistry();

const NAME = `av2i-tofu-${process.pid}`;

function docker(args: string[]) {
  return spawnSync("docker", args, { encoding: "utf8" });
}

function exec(args: string[]): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    const p = spawn("docker", ["exec", ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("close", (code) => resolve({ ok: code === 0, out }));
  });
}

const tofu = (name: string, args: string[]) => exec(["-w", `/work/${name}`, NAME, "tofu", ...args]);

let failed = 0;
let checked = 0;
const root = mkdtempSync(join(tmpdir(), "av2i-tofu-"));
try {
  const up = docker(["run", "-d", "--rm", "--name", NAME, "--entrypoint", "sleep", "-v", `${root}:/work`, "-v", "av2i-tofu-cache:/cache", "-e", "TF_PLUGIN_CACHE_DIR=/cache", IMAGE, "3600"]);
  if (up.status !== 0) throw new Error(`cannot start the OpenTofu container: ${up.stderr}`);

  const scenarios = executableScenarios();
  const init = join(root, "_init");
  mkdirSync(init, { recursive: true });
  writeFileSync(join(init, "versions.tf"), generate(scenarios[0]!.design)["versions.tf"]!);
  const first = await tofu("_init", ["init", "-backend=false", "-input=false", "-no-color"]);
  if (!first.ok) throw new Error(`tofu init failed:\n${first.out}`);

  const jobs: { id: string; design: Parameters<typeof generate>[0] }[] = [];
  for (const s of scenarios) {
    for (const c of [{ id: "base", design: s.design }, ...s.variants.map((v) => ({ id: v.id, design: applyPatch(s.design, v.patch ?? []) }))]) {
      if (runRules(c.design, registry).some((f) => f.severity === "error")) continue;
      jobs.push({ id: `${s.id}-${c.id}`, design: c.design });
    }
  }

  async function check(job: (typeof jobs)[number]) {
    const dir = join(root, job.id);
    mkdirSync(dir, { recursive: true });
    for (const [name, text] of Object.entries(generate(job.design))) writeFileSync(join(dir, name), text);
    await exec([NAME, "sh", "-c", `cp -a /work/_init/.terraform /work/_init/.terraform.lock.hcl /work/${job.id}/`]);
    for (const [label, args] of [["fmt", ["fmt", "-check", "-diff"]], ["validate", ["validate", "-no-color"]]] as const) {
      const r = await tofu(job.id, [...args]);
      if (!r.ok) { failed++; console.error(`FAIL ${job.id} ${label}\n${r.out}`); break; }
    }
    checked++;
    console.log(`ok   ${job.id}`);
  }

  const queue = [...jobs];
  await Promise.all(Array.from({ length: JOBS }, async () => { for (let j = queue.shift(); j; j = queue.shift()) await check(j); }));
} finally {
  docker(["rm", "-f", NAME]);
  rmSync(root, { recursive: true, force: true });
}
console.log(`\n${checked} design(s) checked, ${failed} failed`);
process.exit(failed ? 1 : 0);
