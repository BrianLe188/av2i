import { createHash } from "node:crypto";

/** OpenTofu's state file, as far as the viewer needs it (format version 4). */
interface RawState {
  serial?: number;
  lineage?: string;
  outputs?: Record<string, { value?: unknown; type?: unknown; sensitive?: boolean }>;
  resources?: { module?: string; mode?: string; type?: string; name?: string; provider?: string; instances?: { index_key?: unknown; attributes?: Record<string, unknown>; sensitive_attributes?: unknown }[] }[];
}

export const HIDDEN = "(sensitive)";
/** A second net under what the state marks sensitive: values under keys that look like secrets. */
const SECRET_KEY = /pass(word|wd)?|secret|token|private[_-]?key|access[_-]?key|credential|api[_-]?key/i;

export interface StateSummary { resources: number; outputs: number; bytes: number }

/** How many resource instances and outputs a state holds, and its size. */
export function summarizeState(state: unknown, bytes: number): StateSummary {
  const s = (state ?? {}) as RawState;
  const resources = (s.resources ?? []).reduce((n, r) => n + (r.instances?.length ?? 0), 0);
  return { resources, outputs: Object.keys(s.outputs ?? {}).length, bytes };
}

const keyOf = (k: unknown) => (typeof k === "number" ? `[${k}]` : `[${JSON.stringify(k)}]`);

/** The address OpenTofu prints for an instance: `module.net.data.aws_x.y[0]`. */
export function addressOf(r: { module?: string; mode?: string; type?: string; name?: string }, indexKey?: unknown): string {
  return `${r.module ? `${r.module}.` : ""}${r.mode === "data" ? "data." : ""}${r.type}.${r.name}${indexKey !== undefined && indexKey !== null ? keyOf(indexKey) : ""}`;
}

export interface ResourceRow { address: string; mode: string; type: string; name: string; provider: string; module: string | null; id: string | null }

export function listResources(state: unknown): ResourceRow[] {
  const s = (state ?? {}) as RawState;
  const out: ResourceRow[] = [];
  for (const r of s.resources ?? []) {
    for (const i of r.instances ?? []) {
      const id = i.attributes?.id ?? i.attributes?.arn;
      out.push({
        address: addressOf(r, i.index_key), mode: r.mode ?? "managed", type: r.type ?? "", name: r.name ?? "",
        provider: /"([^"]+)"/.exec(r.provider ?? "")?.[1]?.replace(/^registry\.[^/]+\//, "") ?? (r.provider ?? ""), module: r.module ?? null, id: typeof id === "string" ? id : null,
      });
    }
  }
  return out;
}

/** Puts a value at a path of the state's own notation (`get_attr`, `index`) out of sight. A path that does not lead anywhere is ignored. */
function hideAt(root: unknown, path: { type?: string; value?: unknown }[]): void {
  let cur: unknown = root;
  for (let i = 0; i < path.length; i++) {
    const step = path[i]!;
    const key = step.type === "index" && step.value && typeof step.value === "object" ? (step.value as { value?: unknown }).value : step.value;
    if (cur === null || typeof cur !== "object") return;
    const holder = cur as Record<string | number, unknown>;
    const k = key as string | number;
    if (i === path.length - 1) { if (k in holder) holder[k] = HIDDEN; return; }
    cur = holder[k];
  }
}

function hideByName(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(hideByName);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, SECRET_KEY.test(k) && x !== null && typeof x !== "object" ? HIDDEN : hideByName(x)]));
  }
  return v;
}

/** The attributes of an instance with the sensitive ones hidden: what the state marks, then what the name gives away. */
export function redactedAttributes(attributes: Record<string, unknown> | undefined, sensitive: unknown): Record<string, unknown> {
  const copy = structuredClone(attributes ?? {});
  if (Array.isArray(sensitive)) for (const p of sensitive) if (Array.isArray(p)) hideAt(copy, p as { type?: string; value?: unknown }[]);
  return hideByName(copy) as Record<string, unknown>;
}

/** The instances of one resource address, attributes redacted. */
export function instancesOf(state: unknown, address: string): { address: string; attributes: Record<string, unknown> }[] {
  const s = (state ?? {}) as RawState;
  const out: { address: string; attributes: Record<string, unknown> }[] = [];
  for (const r of s.resources ?? []) {
    for (const i of r.instances ?? []) {
      const a = addressOf(r, i.index_key);
      if (a === address) out.push({ address: a, attributes: redactedAttributes(i.attributes, i.sensitive_attributes) });
    }
  }
  return out;
}

export interface OutputRow { name: string; sensitive: boolean; value: unknown }

/** The outputs; the value of a sensitive one is not given. */
export function listOutputs(state: unknown): OutputRow[] {
  const s = (state ?? {}) as RawState;
  return Object.entries(s.outputs ?? {}).map(([name, o]) => ({ name, sensitive: !!o.sensitive, value: o.sensitive ? HIDDEN : hideByName(o.value) }));
}

const fingerprint = (v: unknown) => createHash("sha1").update(JSON.stringify(v ?? null)).digest("hex");

/** What changed between two states: addresses added, removed, and those whose attributes differ. */
export function diffStates(from: unknown, to: unknown): { added: string[]; removed: string[]; changed: string[] } {
  const index = (state: unknown) => {
    const m = new Map<string, string>();
    for (const r of ((state ?? {}) as RawState).resources ?? []) for (const i of r.instances ?? []) m.set(addressOf(r, i.index_key), fingerprint(i.attributes));
    return m;
  };
  const a = index(from);
  const b = index(to);
  return {
    added: [...b.keys()].filter((k) => !a.has(k)).sort(),
    removed: [...a.keys()].filter((k) => !b.has(k)).sort(),
    changed: [...b.keys()].filter((k) => a.has(k) && a.get(k) !== b.get(k)).sort(),
  };
}
