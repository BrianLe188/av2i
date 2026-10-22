import { spawnSync } from 'node:child_process';
import { beforeAll, describe, expect, it } from 'vitest';
import { addNode, generateTerraform, TEMPLATES, type Graph } from '../src';
import { edge, region, scenario } from './fixtures';

/**
 * Runs the generated HCL through `tofu init` + `tofu validate` in Docker (no AWS credentials needed).
 * Opt-in because it needs Docker and downloads the AWS provider the first time:
 *   npm run test:tofu -w @av2i/core
 *
 * Speed: one container and one `init` for every case (they share providers.tf), and the provider
 * lives in a named volume so it is downloaded once, not per run.
 */
const IMAGE = 'ghcr.io/opentofu/opentofu:1.10';
const PLUGIN_VOLUME = 'av2i-tofu-plugins';
const CONTAINER = 'av2i-tofu-test';
const TIME_LIMIT_S = 240;

function validateAll(cases: Record<string, Graph>) {
  const names = Object.keys(cases);
  const env = names.flatMap((name, i) => [
    '-e', `MAIN_${i}=${Buffer.from(generateTerraform(cases[name], { region })['main.tf']).toString('base64')}`,
  ]);
  // One init for all cases, so use the providers.tf that declares the most providers (e.g. with archive).
  const providers = names
    .map((n) => generateTerraform(cases[n], { region })['providers.tf'])
    .reduce((a, b) => (b.length > a.length ? b : a));
  const script = [
    'mkdir /w && cd /w',
    'echo "$PROVIDERS" | base64 -d > providers.tf',
    'tofu init -backend=false -input=false -no-color >/dev/null',
    ...names.map(
      (name, i) => `echo "@@CASE ${name}" && echo "$MAIN_${i}" | base64 -d > main.tf && tofu validate -json`,
    ),
  ].join(' && ');

  const run = spawnSync(
    'docker',
    [
      'run', '--rm', '--name', CONTAINER,
      '-v', `${PLUGIN_VOLUME}:/plugins`,
      '-e', 'TF_PLUGIN_CACHE_DIR=/plugins',
      // The fresh directory has no lock file; without this the cache is ignored and the provider re-downloaded.
      '-e', 'TF_PLUGIN_CACHE_MAY_BREAK_DEPENDENCY_LOCK_FILE=true',
      '-e', `PROVIDERS=${Buffer.from(providers).toString('base64')}`,
      ...env,
      '--entrypoint', 'timeout',
      IMAGE,
      String(TIME_LIMIT_S - 10), 'sh', '-c', script,
    ],
    { encoding: 'utf8', timeout: TIME_LIMIT_S * 1000, killSignal: 'SIGKILL' },
  );
  if (run.error) spawnSync('docker', ['rm', '-f', CONTAINER]); // hard stop: never leave it running
  const out = `${run.stdout}${run.stderr}${run.error ?? ''}`;
  const results = new Map<string, string>();
  for (const chunk of out.split('@@CASE ').slice(1)) {
    const [name, ...rest] = chunk.split('\n');
    results.set(name, rest.join('\n'));
  }
  return { results, out };
}

describe.skipIf(!process.env.TOFU_VALIDATE)('tofu validate', () => {
  const k = scenario();
  const cases: Record<string, Graph> = {
    'fully-wired': {
      nodes: k.nodes,
      edges: [
        edge(k.igw.id, k.rt.id),
        edge(k.rt.id, k.s1.id),
        edge(k.ec2.id, k.rds.id),
        edge(k.alb.id, k.ec2.id),
        edge(k.ec2.id, k.bucket.id, { access: 'readwrite' }),
      ],
    },
    unconnected: { nodes: k.nodes, edges: [] },
    's3-read-only': { nodes: k.nodes, edges: [edge(k.ec2.id, k.bucket.id, { access: 'read' })] },
    'nat-gateway': (() => {
      const nat = addNode(k.nodes, 'nat', { region, parentId: k.s1.id });
      const rt2 = addNode(nat.nodes, 'route_table', { region, parentId: k.vpc.id });
      return {
        nodes: rt2.nodes,
        edges: [edge(k.igw.id, k.rt.id), edge(k.rt.id, k.s1.id), edge(nat.node.id, rt2.node.id), edge(rt2.node.id, k.priv.id)],
      };
    })(),
    'https-dns': (() => {
      const alb = { ...k.alb, props: { ...k.alb.props, listener_port: 443, certificate_arn: 'arn:aws:acm:us-east-1:123456789012:certificate/abc-123' } };
      const d = addNode(k.nodes.map((n) => (n.id === alb.id ? alb : n)), 'dns', { region });
      return { nodes: d.nodes, edges: [edge(k.alb.id, k.ec2.id), edge(d.node.id, k.alb.id)] };
    })(),
    'lambda-nodejs': (() => {
      const fn = addNode(k.nodes, 'lambda', { region, parentId: k.priv.id });
      const nodes = fn.nodes.map((n) =>
        n.id === fn.node.id ? { ...n, props: { ...n.props, runtime: 'nodejs20.x', handler: 'app.run' } } : n,
      );
      return { nodes, edges: [edge(fn.node.id, k.rds.id), edge(fn.node.id, k.bucket.id)] };
    })(),
    'vpc-only': { nodes: k.nodes.filter((n) => n.type === 'vpc' || n.type === 'subnet'), edges: [] },
    ...Object.fromEntries(TEMPLATES.map((t) => [`template-${t.id}`, t.build(region)])),
  };

  let run: ReturnType<typeof validateAll>;
  beforeAll(() => {
    run = validateAll(cases);
  }, (TIME_LIMIT_S + 20) * 1000);

  for (const name of Object.keys(cases)) {
    it(`accepts: ${name}`, () => {
      expect(run.results.get(name) ?? run.out, run.out).toMatch(/"valid":\s*true/);
    });
  }
});
