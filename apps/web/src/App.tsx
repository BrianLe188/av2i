import { useEffect, useMemo, useState } from 'react';
import { validateGraph } from '@av2i/core';
import { Canvas } from './components/Canvas';
import { CodePanel } from './components/CodePanel';
import { IssuesPanel } from './components/IssuesPanel';
import { Palette } from './components/Palette';
import { ProjectBar } from './components/ProjectBar';
import { PropertiesPanel } from './components/PropertiesPanel';
import { useStore } from './store';

type Tab = 'properties' | 'code' | 'issues';

export function App() {
  const [tab, setTab] = useState<Tab>('properties');
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const dirty = useStore((s) => s.dirty);
  const rev = useStore((s) => s.rev);
  const notice = useStore((s) => s.notice);
  const projectId = useStore((s) => s.projectId);

  const issues = useMemo(() => validateGraph({ nodes, edges }), [nodes, edges]);
  const errorCount = issues.filter((i) => i.severity === 'error').length;

  useEffect(() => {
    void useStore.getState().init();
  }, []);

  // Autosave shortly after the last edit.
  useEffect(() => {
    if (!dirty || !projectId) return;
    const t = setTimeout(() => void useStore.getState().save(), 1200);
    return () => clearTimeout(t);
  }, [dirty, rev, projectId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select')) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        const s = useStore.getState();
        if (e.shiftKey) s.redo();
        else s.undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        useStore.getState().redo();
      } else if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void useStore.getState().save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app">
      <ProjectBar />
      <div className="workspace">
        <Palette />
        <Canvas issues={issues} />
        <aside className="side">
          <div className="tabs">
            {(['properties', 'code', 'issues'] as Tab[]).map((t) => (
              <button key={t} className={tab === t ? 'tab active' : 'tab'} onClick={() => setTab(t)}>
                {t === 'properties' ? 'Properties' : t === 'code' ? 'Terraform' : 'Issues'}
                {t === 'issues' && issues.length > 0 && (
                  <span className={errorCount ? 'pill error' : 'pill warning'}>{issues.length}</span>
                )}
              </button>
            ))}
          </div>
          <div className="tab-body">
            {tab === 'properties' && <PropertiesPanel issues={issues} />}
            {tab === 'code' && <CodePanel errorCount={errorCount} />}
            {tab === 'issues' && <IssuesPanel issues={issues} />}
          </div>
        </aside>
      </div>
      {notice && <div className="toast">{notice}</div>}
    </div>
  );
}
