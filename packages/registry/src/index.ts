import { resolve } from "node:path";
import { compile, type Registry } from "./compile.ts";

export { compile } from "./compile.ts";
export type { Registry, Problem } from "./compile.ts";
export { generatedSource } from "./generate.ts";
export * from "./generated.ts";

export const specRoot = resolve(import.meta.dirname, "../../../docs/spec");

let cached: Registry | undefined;

/** Compile the specification once per process. Throws when the specification has problems. */
export function getRegistry(): Registry {
  if (cached) return cached;
  const { registry, problems } = compile(specRoot);
  if (problems.length) throw new Error(`the specification has ${problems.length} problem(s); run \`pnpm spec:check\``);
  cached = registry;
  return registry;
}
