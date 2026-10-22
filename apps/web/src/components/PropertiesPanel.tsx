import {
  classifyEdge,
  EDGE_INFO,
  RESOURCES,
  S3_ACCESS_LEVELS,
  type FieldDef,
  type Issue,
  type PropValue,
} from '@av2i/core';
import { useStore } from '../store';

function Field({ def, value, onChange }: { def: FieldDef; value: PropValue; onChange: (v: PropValue) => void }) {
  switch (def.type) {
    case 'boolean':
      return (
        <label className="field check">
          <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
          <span>{def.label}</span>
          {def.hint && <small>{def.hint}</small>}
        </label>
      );
    case 'select':
      return (
        <label className="field">
          <span>{def.label}</span>
          <select value={String(value)} onChange={(e) => onChange(e.target.value)}>
            {def.options!.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        </label>
      );
    case 'number':
      return (
        <label className="field">
          <span>{def.label}</span>
          <input
            type="number"
            value={Number(value)}
            onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
          />
        </label>
      );
    default:
      return (
        <label className="field">
          <span>{def.label}</span>
          <input type="text" value={String(value)} onChange={(e) => onChange(e.target.value)} />
          {def.hint && <small>{def.hint}</small>}
        </label>
      );
  }
}

function EdgePanel({ edgeId, issues }: { edgeId: string; issues: Issue[] }) {
  const nodes = useStore((s) => s.nodes);
  const edge = useStore((s) => s.edges.find((e) => e.id === edgeId));
  const updateEdge = useStore((s) => s.updateEdge);
  const removeEdge = useStore((s) => s.removeEdge);
  if (!edge) return <div className="empty">Connection not found.</div>;

  const r = classifyEdge(nodes, edge);
  const info = r.kind ? EDGE_INFO[r.kind] : null;
  const mine = issues.filter((i) => i.edgeId === edgeId);
  return (
    <div className="form">
      <h3>Connection</h3>
      <p className="edge-title">
        <strong>{r.from?.name ?? nodes.find((n) => n.id === edge.source)?.name}</strong>
        {' \u2192 '}
        <strong>{r.to?.name ?? nodes.find((n) => n.id === edge.target)?.name}</strong>
      </p>
      {info && (
        <>
          <p>{info.title}</p>
          <p className="muted">{info.generates}</p>
        </>
      )}
      {r.kind === 's3-access' && (
        <label className="field">
          <span>Access</span>
          <select
            value={String(edge.props?.access ?? 'read')}
            onChange={(e) => updateEdge(edge.id, { access: e.target.value })}
          >
            {S3_ACCESS_LEVELS.map((a) => (
              <option key={a} value={a}>
                {a === 'readwrite' ? 'Read and write' : 'Read only'}
              </option>
            ))}
          </select>
        </label>
      )}
      {mine.length > 0 && (
        <ul className="issue-list">
          {mine.map((i, k) => (
            <li key={k} className={i.severity}>
              {i.message}
            </li>
          ))}
        </ul>
      )}
      <div className="actions">
        <button className="danger" onClick={() => removeEdge(edge.id)}>
          Delete connection
        </button>
      </div>
    </div>
  );
}

export function PropertiesPanel({ issues }: { issues: Issue[] }) {
  const nodes = useStore((s) => s.nodes);
  const selectedId = useStore((s) => s.selectedId);
  const updateNode = useStore((s) => s.updateNode);
  const remove = useStore((s) => s.remove);
  const fit = useStore((s) => s.fit);
  const selectedEdgeId = useStore((s) => s.selectedEdgeId);
  const node = nodes.find((n) => n.id === selectedId);

  if (!node && selectedEdgeId) return <EdgePanel edgeId={selectedEdgeId} issues={issues} />;

  if (!node) {
    return (
      <div className="empty">
        <p>Select a resource to edit its properties.</p>
        <p className="muted">
          {nodes.length} resource{nodes.length === 1 ? '' : 's'} on the canvas. Drag from one
          resource's side handle to another to connect them: IGW ↔ Route table ↔ Subnet, NAT ↔ Route table, EC2/Lambda ↔ RDS,
          Load balancer ↔ EC2, EC2/Lambda ↔ S3, DNS record ↔ Load balancer.
        </p>
      </div>
    );
  }

  const def = RESOURCES[node.type];
  const mine = issues.filter((i) => i.nodeId === node.id);

  return (
    <div className="form">
      <h3>{def.label}</h3>
      <label className="field">
        <span>Name</span>
        <input type="text" value={node.name} onChange={(e) => updateNode(node.id, { name: e.target.value })} />
      </label>
      {def.fields.map((f) => (
        <Field
          key={f.key}
          def={f}
          value={node.props[f.key] ?? f.default}
          onChange={(v) => updateNode(node.id, { props: { [f.key]: v } })}
        />
      ))}
      {mine.length > 0 && (
        <ul className="issue-list">
          {mine.map((i, k) => (
            <li key={k} className={i.severity}>
              {i.message}
            </li>
          ))}
        </ul>
      )}
      <div className="actions">
        {def.kind === 'container' && <button onClick={() => fit(node.id)}>Fit to content</button>}
        <button className="danger" onClick={() => remove(node.id)}>
          Delete
        </button>
      </div>
    </div>
  );
}
