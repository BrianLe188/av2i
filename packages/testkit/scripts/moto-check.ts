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
 * Run `tofu plan` on the base design of every executable scenario and on every variant without an error finding, against a Moto
 * server (an open source AWS emulator, https://github.com/getmoto/moto) in Docker, so the whole plan path is exercised with no AWS
 * account. It checks that the provider accepts what we generate and that a plan can be made, not how AWS would behave: Moto does not
 * enforce IAM, networks or limits, and does not implement every API (CloudFront's cache policy list is missing, so designs that read
 * it fail here and are reported as skipped when the error says the emulator lacks the call).
 * Same shape as tofu-check: one OpenTofu container, providers cached in a Docker volume, `init` once, designs checked a few at a time
 * (TOFU_JOBS). The Moto container is started and removed by the script.
 */
const IMAGE = "ghcr.io/opentofu/opentofu:1.12.9";
const MOTO = "motoserver/moto:latest";
const MOTO_NAME = `av2i-moto-${process.pid}`;
const JOBS = Number(process.env.TOFU_JOBS ?? 4);
const registry = getRegistry();

const NAME = `av2i-tofu-${process.pid}`;
/** Reaches Moto from the OpenTofu container through the host. */
const ENDPOINT = process.env.MOTO_ENDPOINT ?? "http://host.docker.internal:5000";

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
let skipped = 0;
let checked = 0;
const root = mkdtempSync(join(tmpdir(), "av2i-tofu-"));
try {
  const up = docker(["run", "-d", "--rm", "--name", NAME, "--entrypoint", "sleep", "-v", `${root}:/work`, "-v", "av2i-tofu-cache:/cache", "-e", "TF_PLUGIN_CACHE_DIR=/cache", "--add-host", "host.docker.internal:host-gateway", "-e", `AWS_ENDPOINT_URL=${ENDPOINT}`, "-e", "AWS_ACCESS_KEY_ID=test", "-e", "AWS_SECRET_ACCESS_KEY=test", IMAGE, "3600"]);
  const moto = docker(["run", "-d", "--rm", "--name", MOTO_NAME, "-p", "127.0.0.1:5000:5000", MOTO]);
  if (moto.status !== 0) throw new Error(`cannot start Moto (is port 5000 free?): ${moto.stderr}`);
  await new Promise((r) => setTimeout(r, 4000));
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
    const r = await tofu(job.id, ["plan", "-input=false", "-no-color", "-lock=false"]);
    if (r.ok) { checked++; console.log(`ok   ${job.id}  ${/Plan: .*/.exec(r.out)?.[0] ?? ""}`); return; }
    // a design that asks for a secret (the database password) cannot be planned without a value: the platform has no way to give one yet
    if (/No value for required variable/.test(r.out)) { skipped++; console.log(`skip ${job.id}  needs a value for a required variable`); return; }
    // Moto holds no Ubuntu images, so an AMI lookup finds nothing
    if (/data\.aws_ami\.[\s\S]*Your query returned no results|Your query returned no results[\s\S]*data\.aws_ami\./.test(r.out)) { skipped++; console.log(`skip ${job.id}  the emulator has no image for the AMI lookup`); return; }
    // an API the emulator does not have is not a fault of the design
    if (/StatusCode: 404|not (yet )?implemented|NotImplemented/i.test(r.out)) { skipped++; console.log(`skip ${job.id}  the emulator lacks an API this design reads`); return; }
    checked++; failed++;
    console.error(`FAIL ${job.id} plan\n${r.out}`);
  }

  const queue = [...jobs];
  await Promise.all(Array.from({ length: JOBS }, async () => { for (let j = queue.shift(); j; j = queue.shift()) await check(j); }));
} finally {
  docker(["rm", "-f", NAME, MOTO_NAME]);
  rmSync(root, { recursive: true, force: true });
}
console.log(`\n${checked} design(s) planned, ${failed} failed, ${skipped} skipped`);
process.exit(failed ? 1 : 0);
