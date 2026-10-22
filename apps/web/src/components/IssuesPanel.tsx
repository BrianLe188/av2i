import type { Issue } from '@av2i/core';
import { useStore } from '../store';

export function IssuesPanel({ issues }: { issues: Issue[] }) {
  const nodes = useStore((s) => s.nodes);
  const select = useStore((s) => s.select);
  const selectEdge = useStore((s) => s.selectEdge);
  if (issues.length === 0) return <div className="empty">No issues found.</div>;
  return (
    <ul className="issue-list">
      {issues.map((i, k) => (
        <li key={k} className={`${i.severity} clickable`} onClick={() => (i.edgeId ? selectEdge(i.edgeId) : select(i.nodeId))}>
          <strong>{nodes.find((n) => n.id === i.nodeId)?.name ?? i.nodeId}{i.edgeId ? ' (connection)' : ''}</strong>
          <br />
          {i.message}
        </li>
      ))}
    </ul>
  );
}
