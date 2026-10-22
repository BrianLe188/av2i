import { useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';

export function ShareDialog({ onClose }: { onClose: () => void }) {
  const projectId = useStore((s) => s.projectId);
  const token = useStore((s) => s.shareToken);
  const setShareToken = useStore((s) => s.setShareToken);
  const notify = useStore((s) => s.notify);
  const [busy, setBusy] = useState(false);
  const url = token ? `${window.location.origin}/s/${token}` : '';

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="Share" onClick={(e) => e.stopPropagation()}>
        <h3>Share read-only link</h3>
        {token ? (
          <>
            <p className="muted">Anyone with this link can view the design, its Terraform and cost. They cannot edit it.</p>
            <input type="text" readOnly value={url} onFocus={(e) => e.target.select()} aria-label="Share link" />
            <div className="actions">
              <button
                onClick={() => {
                  void navigator.clipboard.writeText(url);
                  notify('Link copied');
                }}
              >
                Copy link
              </button>
              <button
                className="danger"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await api.unshareProject(projectId!);
                    setShareToken(null);
                  })
                }
              >
                Stop sharing
              </button>
              <span className="spacer" />
              <button onClick={onClose}>Close</button>
            </div>
          </>
        ) : (
          <>
            <p className="muted">Create a private link that lets anyone who has it view this design without signing in.</p>
            <div className="actions">
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    setShareToken((await api.shareProject(projectId!)).token);
                  })
                }
              >
                Create link
              </button>
              <span className="spacer" />
              <button onClick={onClose}>Close</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
