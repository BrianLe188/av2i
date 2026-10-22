import { REGIONS } from '@av2i/core';
import { useStore } from '../store';

const SAVE_LABEL = { idle: '', saving: 'Saving…', saved: 'Saved', error: 'Save failed' } as const;

export function ProjectBar() {
  const s = useStore();

  return (
    <header className="bar">
      <strong className="logo">av2i</strong>
      <select
        value={s.projectId ?? ''}
        onChange={(e) => void s.openProject(e.target.value)}
        aria-label="Project"
      >
        {s.projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <input
        className="name"
        value={s.name}
        onChange={(e) => s.setName(e.target.value)}
        aria-label="Project name"
      />
      <button
        onClick={() => {
          const name = window.prompt('Project name');
          if (name?.trim()) void s.createProject(name.trim());
        }}
      >
        New
      </button>
      <button
        className="danger"
        onClick={() => {
          if (window.confirm(`Delete project "${s.name}"? This cannot be undone.`)) void s.deleteProject();
        }}
      >
        Delete
      </button>
      <select value={s.region} onChange={(e) => s.setRegion(e.target.value)} aria-label="Region">
        {REGIONS.map((r) => (
          <option key={r}>{r}</option>
        ))}
      </select>
      <span className="spacer" />
      <button onClick={s.undo} disabled={s.past.length === 0} title="Undo (Cmd/Ctrl+Z)">
        Undo
      </button>
      <button onClick={s.redo} disabled={s.future.length === 0} title="Redo (Cmd/Ctrl+Shift+Z)">
        Redo
      </button>
      <button onClick={() => void s.snapshot(window.prompt('Snapshot label (optional)') || undefined)}>
        Snapshot
      </button>
      <select
        value=""
        onChange={(e) => {
          if (e.target.value && window.confirm('Restore this version? Current state is kept as a snapshot.')) {
            void s.restore(e.target.value);
          }
        }}
        aria-label="Versions"
      >
        <option value="">Versions ({s.versions.length})</option>
        {s.versions.map((v) => (
          <option key={v.id} value={v.id}>
            {new Date(v.createdAt).toLocaleString()} {v.label ? `· ${v.label}` : ''}
          </option>
        ))}
      </select>
      <span className={`save ${s.saveState}`}>{s.dirty && s.saveState !== 'saving' ? 'Unsaved…' : SAVE_LABEL[s.saveState]}</span>
    </header>
  );
}
