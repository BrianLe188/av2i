/** The most a design may hold; a bigger one is a mistake or an attack, not a design. */
export const LIMITS = { nodes: 2000, edges: 5000, name: 120, bytes: 8 * 1024 * 1024 };

export type Shape = { ok: true; name: string } | { ok: false; problem: string };

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * Checks that a value has the shape of a design: the server stores designs but does not judge them (the engine does, in the browser),
 * so this only refuses what could not be a design at all.
 */
export function checkShape(design: unknown): Shape {
  if (!isObject(design)) return { ok: false, problem: "the design must be an object" };
  if (design.schema !== 1) return { ok: false, problem: "schema must be 1" };
  if (typeof design.name !== "string" || design.name.trim() === "" || design.name.length > LIMITS.name) return { ok: false, problem: `name must be 1 to ${LIMITS.name} characters` };
  if (!isObject(design.settings) || typeof design.settings.region !== "string") return { ok: false, problem: "settings.region must be a string" };
  const { nodes, edges } = design;
  if (!Array.isArray(nodes) || nodes.length > LIMITS.nodes) return { ok: false, problem: `nodes must be a list of at most ${LIMITS.nodes}` };
  if (!Array.isArray(edges) || edges.length > LIMITS.edges) return { ok: false, problem: `edges must be a list of at most ${LIMITS.edges}` };
  const keys = new Set<string>();
  for (const [i, n] of nodes.entries()) {
    if (!isObject(n) || typeof n.key !== "string" || n.key === "" || n.key.length > 128 || typeof n.service !== "string" || typeof n.label !== "string" || !isObject(n.props)) {
      return { ok: false, problem: `nodes[${i}] needs a key, a label, a service and props` };
    }
    if (keys.has(n.key)) return { ok: false, problem: `node key "${n.key}" is used twice` };
    keys.add(n.key);
  }
  for (const [i, e] of edges.entries()) {
    if (!isObject(e) || typeof e.id !== "string" || typeof e.mechanism !== "string" || typeof e.from !== "string" || typeof e.to !== "string") {
      return { ok: false, problem: `edges[${i}] needs an id, a mechanism, a from and a to` };
    }
  }
  return { ok: true, name: design.name.trim() };
}
