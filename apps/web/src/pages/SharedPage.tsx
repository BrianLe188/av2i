import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { validateGraph } from '@av2i/core';
import { Canvas } from '../components/Canvas';
import { CodePanel } from '../components/CodePanel';
import { CostPanel } from '../components/CostPanel';
import { IssuesPanel } from '../components/IssuesPanel';
import { useAuth } from '../auth';
import { Button } from '@/components/ui/button';
import { SidePanel } from '../components/SidePanel';
import { useStore } from '../store';
import { NotFoundPage } from './NotFoundPage';

/** Read-only view of a shared design. Works without signing in. */
export function SharedPage() {
  const { token } = useParams();
  const { user } = useAuth();
  const [status, setStatus] = useState<'loading' | 'ok' | 'missing'>('loading');
  const [tab, setTab] = useState('code');
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const name = useStore((s) => s.name);
  const region = useStore((s) => s.region);
  const issues = useMemo(() => validateGraph({ nodes, edges }), [nodes, edges]);
  const errorCount = issues.filter((i) => i.severity === 'error').length;

  useEffect(() => {
    if (!token) return;
    setStatus('loading');
    void useStore.getState().openShared(token).then((ok) => setStatus(ok ? 'ok' : 'missing'));
  }, [token]);

  if (status === 'missing') return <NotFoundPage what="shared link" />;
  if (status === 'loading') return <div className="grid min-h-full place-items-center text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="app">
      <header className="flex shrink-0 items-center gap-3 border-b bg-card px-3 py-2">
        <strong className="tracking-wide">av2i</strong>
        <strong>{name}</strong>
        <span className="text-xs text-muted-foreground">{region} · read-only</span>
        <span className="flex-1" />
        <Button asChild variant="outline" size="sm">
          <Link to={user ? '/' : '/login'}>{user ? 'My projects' : 'Sign in'}</Link>
        </Button>
      </header>
      <div className="workspace shared">
        <Canvas issues={issues} readOnly />
        <SidePanel
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'code', label: 'Terraform', content: <CodePanel errorCount={errorCount} /> },
            { value: 'issues', label: 'Issues', count: issues.length, danger: errorCount > 0, content: <IssuesPanel issues={issues} /> },
            { value: 'cost', label: 'Cost', content: <CostPanel /> },
          ]}
        />
      </div>
    </div>
  );
}
