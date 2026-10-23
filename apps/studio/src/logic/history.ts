/** Snapshots with undo and redo. A new edit drops the redo branch. */
export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

const LIMIT = 200;

export const start = <T,>(present: T): History<T> => ({ past: [], present, future: [] });

export function push<T>(h: History<T>, next: T): History<T> {
  if (Object.is(h.present, next)) return h;
  return { past: [...h.past, h.present].slice(-LIMIT), present: next, future: [] };
}
export function undo<T>(h: History<T>): History<T> {
  const prev = h.past[h.past.length - 1];
  return prev === undefined ? h : { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future] };
}
export function redo<T>(h: History<T>): History<T> {
  const [next, ...rest] = h.future;
  return next === undefined ? h : { past: [...h.past, h.present], present: next, future: rest };
}
