import { useMemo, useState } from 'react';
import { importTerraform, RESOURCES, type ImportResult, type ResourceType } from '@av2i/core';

/** Paste Terraform or pick .tf files, preview what will be drawn, then create a project from it. */
export function ImportDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string, result: ImportResult) => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [name, setName] = useState('Imported infrastructure');
  const [busy, setBusy] = useState(false);

  const result = useMemo(() => {
    if (!text.trim()) return null;
    try {
      return importTerraform(text);
    } catch (e) {
      return e instanceof Error ? e : new Error(String(e));
    }
  }, [text]);
  const ok = result && !(result instanceof Error) ? result : null;
  const count = ok ? ok.graph.nodes.length : 0;
  const skipped = ok ? Object.entries(ok.report.skipped) : [];

  const readFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const parts = await Promise.all([...files].map((f) => f.text()));
    setText(parts.join('\n\n'));
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" role="dialog" aria-label="Import Terraform" onClick={(e) => e.stopPropagation()}>
        <h3>Import Terraform</h3>
        <p className="muted">
          Reads AWS resources av2i can draw (VPC, subnets, gateways, routes, EC2, RDS, Lambda, ECS, load balancers, S3, CloudFront,
          Route 53, security groups). Variables, modules, <code>count</code> and <code>for_each</code> are not evaluated.
        </p>
        <input type="file" accept=".tf,text/plain" multiple onChange={(e) => void readFiles(e.target.files)} aria-label="Terraform files" />
        <textarea
          rows={10}
          spellCheck={false}
          placeholder='resource "aws_vpc" "main" { ... }'
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="Terraform source"
        />
        {result instanceof Error && <div className="banner error">Could not read this: {result.message}</div>}
        {ok && (
          <div className="import-report">
            <strong>
              {count} resource{count === 1 ? '' : 's'} · {ok.graph.edges.length} connection{ok.graph.edges.length === 1 ? '' : 's'} · {ok.region}
            </strong>
            <div className="muted">
              {Object.entries(ok.report.imported)
                .map(([t, n]) => `${n} × ${RESOURCES[t as ResourceType].label}`)
                .join(', ') || 'Nothing recognised.'}
            </div>
            {skipped.length > 0 && (
              <div className="muted">Not drawn: {skipped.map(([t, n]) => `${t} (${n})`).join(', ')}</div>
            )}
            {ok.report.warnings.map((w, i) => (
              <div key={i} className="banner warn">
                {w}
              </div>
            ))}
          </div>
        )}
        <div className="actions">
          <input type="text" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} aria-label="Project name" />
          <span className="spacer" />
          <button onClick={onClose}>Cancel</button>
          <button
            className="primary"
            disabled={!ok || count === 0 || !name.trim() || busy}
            onClick={async () => {
              if (!ok) return;
              setBusy(true);
              try {
                await onCreate(name.trim(), ok);
              } finally {
                setBusy(false);
              }
            }}
          >
            Create project
          </button>
        </div>
      </div>
    </div>
  );
}
