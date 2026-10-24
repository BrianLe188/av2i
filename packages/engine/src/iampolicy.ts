import type { NormalizedNode, Value } from "@av2i/model";
import { Graph } from "./graph.ts";

export interface PolicyDoc {
  Version?: unknown;
  Statement?: unknown;
}

/** A policy given as text or as a value; `null` when there is none, `{ Version: "invalid" }` when the text is not JSON. */
export function parseDoc(v: Value | undefined): PolicyDoc | null {
  if (v === undefined || v === null || v === "") return null;
  try {
    return (typeof v === "string" ? JSON.parse(v) : v) as PolicyDoc;
  } catch {
    return { Version: "invalid" };
  }
}

export interface Stmt {
  effect: string;
  actions: string[];
  resources: string[];
}

/** Statements of a document with Action and Resource always as lists. */
export function statementsOfDoc(doc: PolicyDoc | null): Stmt[] {
  const list = Array.isArray(doc?.Statement) ? doc.Statement : doc?.Statement ? [doc.Statement] : [];
  const many = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v === undefined ? [] : [String(v)]);
  return list.map((s: any) => ({ effect: String(s?.Effect ?? "Allow"), actions: many(s?.Action), resources: many(s?.Resource) }));
}

/** Customer managed policies a role holds: a grant connection from the role to an iam-policy node. */
export function policiesOf(g: Graph, role: string): NormalizedNode[] {
  return g.edges("grant").filter((e) => e.from === role).flatMap((e) => { const n = g.node(e.to); return n?.service === "iam-policy" ? [n] : []; });
}

/** Every hand-written document that applies to a role: its `raw_policy` and the documents of its customer managed policies. */
export function documentsOf(g: Graph, role: NormalizedNode): { owner: string; doc: PolicyDoc | null }[] {
  return [
    { owner: role.key, doc: parseDoc(role.props.raw_policy) },
    ...policiesOf(g, role.key).map((p) => ({ owner: p.key, doc: parseDoc(p.props.policy) })),
  ].filter((d) => d.doc !== null);
}

/** Name an emitted role gets: the written name, else the key with hyphens. */
export const roleNameOf = (role: NormalizedNode): string => (typeof role.props.name === "string" && role.props.name ? role.props.name : role.key.replace(/_/g, "-"));
export const policyNameOf = (p: NormalizedNode): string => (typeof p.props.name === "string" && p.props.name ? p.props.name : p.key.replace(/_/g, "-"));
