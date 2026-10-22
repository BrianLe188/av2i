import { autoResize } from './graph';
import type { GraphNode } from './types';

export type AlignMode = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
export type DistributeAxis = 'horizontal' | 'vertical';

/** Positions are relative to the parent, so only nodes sharing one parent can be arranged together. */
function group(nodes: GraphNode[], ids: string[], min: number): GraphNode[] | null {
  const picked = nodes.filter((n) => ids.includes(n.id));
  if (picked.length < min || picked.some((n) => n.parentId !== picked[0].parentId)) return null;
  return picked;
}

const finish = (nodes: GraphNode[], moved: Map<string, { x: number; y: number }>, anchor: string) =>
  autoResize(
    nodes.map((n) => (moved.has(n.id) ? { ...n, position: moved.get(n.id)! } : n)),
    { anchorId: anchor },
  );

/** Returns null when the selection can't be aligned (fewer than two nodes, or different containers). */
export function alignNodes(nodes: GraphNode[], ids: string[], mode: AlignMode): GraphNode[] | null {
  const picked = group(nodes, ids, 2);
  if (!picked) return null;
  const left = Math.min(...picked.map((n) => n.position.x));
  const right = Math.max(...picked.map((n) => n.position.x + n.size.width));
  const top = Math.min(...picked.map((n) => n.position.y));
  const bottom = Math.max(...picked.map((n) => n.position.y + n.size.height));
  const moved = new Map(
    picked.map((n) => {
      const p = { ...n.position };
      if (mode === 'left') p.x = left;
      if (mode === 'right') p.x = right - n.size.width;
      if (mode === 'center') p.x = Math.round((left + right) / 2 - n.size.width / 2);
      if (mode === 'top') p.y = top;
      if (mode === 'bottom') p.y = bottom - n.size.height;
      if (mode === 'middle') p.y = Math.round((top + bottom) / 2 - n.size.height / 2);
      return [n.id, p];
    }),
  );
  return finish(nodes, moved, picked[0].id);
}

/** Even gaps between the outermost two, which stay put. Needs three or more nodes. */
export function distributeNodes(nodes: GraphNode[], ids: string[], axis: DistributeAxis): GraphNode[] | null {
  const picked = group(nodes, ids, 3);
  if (!picked) return null;
  const x = axis === 'horizontal';
  const pos = (n: GraphNode) => (x ? n.position.x : n.position.y);
  const len = (n: GraphNode) => (x ? n.size.width : n.size.height);
  const sorted = [...picked].sort((a, b) => pos(a) - pos(b));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const span = pos(last) + len(last) - pos(first);
  const gap = (span - sorted.reduce((sum, n) => sum + len(n), 0)) / (sorted.length - 1);
  let cursor = pos(first);
  const moved = new Map<string, { x: number; y: number }>();
  for (const n of sorted) {
    moved.set(n.id, x ? { x: Math.round(cursor), y: n.position.y } : { x: n.position.x, y: Math.round(cursor) });
    cursor += len(n) + gap;
  }
  return finish(nodes, moved, first.id);
}
