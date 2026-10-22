import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { validateGraph } from '@av2i/core';
import { Canvas } from '../components/Canvas';
import { CodePanel } from '../components/CodePanel';
import { CostPanel } from '../components/CostPanel';
import { IssuesPanel } from '../components/IssuesPanel';
import { Palette } from '../components/Palette';
import { ProjectBar } from '../components/ProjectBar';
import { PropertiesPanel } from '../components/PropertiesPanel';
import { SidePanel } from '../components/SidePanel';
import { useStore } from '../store';
import { NotFoundPage } from './NotFoundPage';

export function EditorPage() {
  const [tab, setTab] = useState('properties');
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const dirty = useStore((s) => s.dirty);
  const rev = useStore((s) => s.rev);
  const projectId = useStore((s) => s.projectId);

  const issues = useMemo(() => validateGraph({ nodes, edges }), [nodes, edges]);
  const errorCount = issues.filter((i) => i.severity === 'error').length;

  const { projectId: routeId } = useParams();
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!routeId) return;
    setMissing(false);
    let cancelled = false;
    void useStore
      .getState()
      .openProject(routeId)
      .then((ok) => !cancelled && setMissing(!ok));
    // Leaving the editor flushes any pending autosave.
    return () => {
      cancelled = true;
      void useStore.getState().save();
    };
  }, [routeId]);

  // Autosave shortly after the last edit.
  useEffect(() => {
    if (!dirty || !projectId) return;
    const t = setTimeout(() => void useStore.getState().save(), 1200);
    return () => clearTimeout(t);
  }, [dirty, rev, projectId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select, [role=combobox], [role=dialog]')) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        useStore.getState().copy();
      } else if (mod && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        useStore.getState().paste();
      } else if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        useStore.getState().duplicate();
      } else if (e.key === 'Escape') {
        useStore.getState().select(null);
        useStore.getState().selectEdge(null);
      } else if (mod && e.key.toLowerCase() === 'z') {
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

  if (missing) return <NotFoundPage what="project" />;
  if (projectId !== routeId) return <div className="grid min-h-full place-items-center text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="app">
      <ProjectBar />
      <div className="workspace">
        <Palette />
        <Canvas issues={issues} />
        <SidePanel
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'properties', label: 'Properties', content: <PropertiesPanel issues={issues} /> },
            { value: 'code', label: 'Terraform', content: <CodePanel errorCount={errorCount} /> },
            { value: 'issues', label: 'Issues', count: issues.length, danger: errorCount > 0, content: <IssuesPanel issues={issues} /> },
            { value: 'cost', label: 'Cost', content: <CostPanel /> },
          ]}
        />
      </div>
    </div>
  );
}
