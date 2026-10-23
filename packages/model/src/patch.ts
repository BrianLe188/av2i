import type { Design, PatchOp, Value } from "./types.ts";

function setPath(root: Record<string, any>, path: string, value: Value | undefined): void {
  const parts = path.split(".");
  let cur = root;
  for (const part of parts.slice(0, -1)) {
    if (cur[part] === null || typeof cur[part] !== "object") cur[part] = {};
    cur = cur[part];
  }
  const last = parts[parts.length - 1]!;
  if (value === undefined) delete cur[last];
  else cur[last] = value;
}

/** Apply scenario patch operations to a deep copy of the design (decision DD-012). */
export function applyPatch(design: Design, ops: readonly PatchOp[]): Design {
  const d: Design = structuredClone(design);
  for (const op of ops) {
    switch (op.op) {
      case "set":
      case "unset": {
        const node = d.nodes.find((n) => n.key === op.node);
        if (!node) throw new Error(`patch: no node ${op.node}`);
        setPath(node as unknown as Record<string, any>, op.path, op.op === "set" ? op.value : undefined);
        break;
      }
      case "add-node":
        d.nodes.push(structuredClone(op.node));
        break;
      case "remove-node":
        if (!d.nodes.some((n) => n.key === op.key)) throw new Error(`patch: no node ${op.key}`);
        d.nodes = d.nodes.filter((n) => n.key !== op.key);
        d.edges = d.edges.filter((e) => e.from !== op.key && e.to !== op.key);
        break;
      case "add-edge":
        d.edges.push(structuredClone(op.edge));
        break;
      case "remove-edge": {
        const before = d.edges.length;
        d.edges = d.edges.filter((e) => !(e.mechanism === op.mechanism && e.from === op.from && e.to === op.to));
        if (d.edges.length === before) throw new Error(`patch: no edge ${op.mechanism} ${op.from} -> ${op.to}`);
        break;
      }
    }
  }
  return d;
}
