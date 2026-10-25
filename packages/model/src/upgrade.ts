import type { Design, Edge, Node } from "./types.ts";

const hyphen = (key: string) => key.replace(/_/g, "-");

function freshKey(design: Design, base: string): string {
  const taken = new Set(design.nodes.map((n) => n.key));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}_${i}`)) return `${base}_${i}`;
}

function freshId(design: Design, base: string): string {
  const taken = new Set(design.edges.map((e) => e.id));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}_${i}`)) return `${base}_${i}`;
}

/**
 * Bring a design saved by an older version up to the current model. A database used to sit in one subnet and reach the
 * others of its group by `db-subnet-group` lines; the group is now a node of its own (relations/db-subnet-group.md). Each
 * such database gets a group named as the old one was, the subnets move into it and the database moves up to the VPC.
 * A design that is already current comes back unchanged, and the input is never modified.
 */
export function upgradeDesign(design: Design): Design {
  const byKey = new Map(design.nodes.map((n) => [n.key, n]));
  const legacy = design.nodes.filter((n) => {
    if (n.service !== "rds") return false;
    if (byKey.get(n.parent ?? "")?.service === "subnet") return true;
    return design.edges.some((e) => e.mechanism === "db-subnet-group" && e.from === n.key && byKey.get(e.to)?.service === "subnet");
  });
  if (legacy.length === 0) return design;

  let d: Design = { ...design, nodes: [...design.nodes], edges: [...design.edges] };
  for (const db of legacy) {
    const own = byKey.get(db.parent ?? "");
    const subnets = [
      ...(own?.service === "subnet" ? [own.key] : []),
      ...d.edges.filter((e) => e.mechanism === "db-subnet-group" && e.from === db.key && byKey.get(e.to)?.service === "subnet").map((e) => e.to),
    ].filter((k, i, all) => all.indexOf(k) === i);
    const vpc = byKey.get(subnets[0] ?? "")?.parent ?? null;
    const groupKey = freshKey(d, `${db.key}_subnets`);
    const group: Node = { key: groupKey, label: `${db.label} subnets`, service: "db-subnet-group", ...(vpc ? { parent: vpc } : {}), props: { name: hyphen(db.key) } };
    const added: Edge[] = subnets.map((s) => ({ id: freshId(d, `e_${s}_${groupKey}`), mechanism: "containment", from: s, to: groupKey }));
    d = {
      ...d,
      nodes: d.nodes.map((n): Node => {
        if (n.key !== db.key) return n;
        const { position: _position, ...rest } = n;
        return { ...rest, parent: vpc };
      }),
      edges: d.edges.filter((e) => !(e.mechanism === "db-subnet-group" && e.from === db.key && byKey.get(e.to)?.service === "subnet")),
    };
    d = { ...d, nodes: [...d.nodes, group], edges: [...d.edges, ...added] };
    d = { ...d, edges: [...d.edges, { id: freshId(d, `e_${db.key}_${groupKey}`), mechanism: "db-subnet-group", from: db.key, to: groupKey }] };
  }
  return d;
}
