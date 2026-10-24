import type { Registry } from "@av2i/registry";

export type FieldType = "string" | "number" | "boolean" | "enum" | "json" | "object" | "rules" | "node";

export interface Field {
  key: string;
  type: FieldType;
  values?: string[];
  required: boolean;
  constraints: string[];
  children?: Field[];
  /** shown as the placeholder: the value AWS or the platform uses when the field is empty */
  fallback?: string;
  /** for a `node` field: the service of the nodes it can point at, and the part when the service has parts */
  of?: { service: string; part?: string };
}

/** Properties the form never shows: they come from nesting or connections, are derived, or are out of scope (D-003). */
const HIDDEN = new Set([
  "tags", "routes", "route_table_ids", "service_name", "vpc_endpoint_type", "ip_address_type", "assign_generated_ipv6_cidr_block", "association", "domain", "allocation_id",
  "part", "vpc_config", "code_source", "logging_config",
]);

const RULES = new Set(["ingress_rules", "egress_rules"]);

function child(key: string, def: Record<string, any>): Field {
  const d = def.default;
  const flag = typeof d === "boolean" || typeof def.provider_default === "boolean";
  const type: FieldType = def.values ? "enum" : flag ? "boolean" : typeof d === "number" || def.range ? "number" : key.endsWith("size") ? "number" : "string";
  const fallback = d ?? def.provider_default;
  return { key, type, values: def.values, required: false, constraints: [], fallback: fallback === undefined || fallback === null ? undefined : String(fallback) };
}

/** `part` picks the properties of one part of a service that has parts (an ECS cluster or an ECS service). */
export function fieldsOf(reg: Registry, service: string, part?: string): Field[] {
  const props = (reg.services[service]?.properties ?? []) as Record<string, any>[];
  const out: Field[] = [];
  for (const p of props) {
    if (HIDDEN.has(p.key) || p.type === "reference" || p.type === "oneOf") continue;
    if (Array.isArray(p.part) && part !== undefined && !p.part.includes(part)) continue;
    if (p.type === "node") {
      out.push({ key: p.key, type: "node", required: p.required === true, constraints: (p.constraints ?? []) as string[], of: { service: p.of as string, part: p.of === "ecs" ? "cluster" : undefined } });
      continue;
    }
    if (p.ref) continue;
    const base = { key: p.key as string, required: p.required === true, constraints: (p.constraints ?? []) as string[] };
    if (RULES.has(p.key)) { out.push({ ...base, type: "rules", required: false }); continue; }
    switch (p.type) {
      case "string": out.push({ ...base, type: "string", fallback: p.default === undefined || p.default === null ? undefined : String(p.default) }); break;
      case "number": out.push({ ...base, type: "number", fallback: p.default === undefined || p.default === null ? undefined : String(p.default) }); break;
      case "boolean": out.push({ ...base, type: "boolean", fallback: p.default === undefined || p.default === null ? undefined : String(p.default) }); break;
      case "enum": out.push({ ...base, type: "enum", values: p.values as string[], fallback: p.default === undefined ? undefined : String(p.default) }); break;
      case "object": out.push({ ...base, type: "object", children: Object.entries((p.fields ?? {}) as Record<string, any>).map(([k, v]) => child(k, v)) }); break;
      default: out.push({ ...base, type: "json" });
    }
  }
  return out;
}

/** Text typed into a number or json field, turned into a value; `undefined` for empty, `Error` for bad input. */
export function parseInput(type: FieldType, text: string): unknown | undefined | Error {
  if (text.trim() === "") return undefined;
  if (type === "number") {
    const n = Number(text);
    return Number.isFinite(n) ? n : new Error("not a number");
  }
  if (type === "json") {
    try { return JSON.parse(text); } catch { return new Error("not valid JSON"); }
  }
  return text;
}
