import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { validateGraph } from '@av2i/core';
import { Canvas } from '../components/Canvas';
import { CodePanel } from '../components/CodePanel';
import { CostPanel } from '../components/CostPanel';
import { IssuesPanel } from '../components/IssuesPanel';
import { useAuth } from '../auth';
import { useStore } from '../store';
import { NotFoundPage } from './NotFoundPage';

type Tab = 'code' | 'issues' | 'cost';
const LABELS: Record<Tab, string> = { code: 'Terraform', issues: 'Issues', cost: 'Cost' };

/** Read-only view of a shared design. Works without signing in. */
export function SharedPage() {
  const { token } = useParams();
  const { user } = useAuth();
  const [status, setStatus] = useState<'loading' | 'ok' | 'missing'>('loading');
  const [tab, setTab] = useState<Tab>('code');
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
  if (status === 'loading') return <div className="page-center muted">Loading…</div>;

  return (
    <div className="app">
      <header className="bar">
        <strong className="logo">av2i</strong>
        <strong>{name}</strong>
        <span className="muted">{region} · read-only</span>
        <span className="spacer" />
        <Link className="btn" to={user ? '/' : '/login'}>
          {user ? 'My projects' : 'Sign in'}
        </Link>
      </header>
      <div className="workspace shared">
        <Canvas issues={issues} readOnly />
        <aside className="side">
          <div className="tabs">
            {(Object.keys(LABELS) as Tab[]).map((t) => (
              <button key={t} className={tab === t ? 'tab active' : 'tab'} onClick={() => setTab(t)}>
                {LABELS[t]}
                {t === 'issues' && issues.length > 0 && (
                  <span className={errorCount ? 'pill error' : 'pill warning'}>{issues.length}</span>
                )}
              </button>
            ))}
          </div>
          <div className="tab-body">
            {tab === 'code' && <CodePanel errorCount={errorCount} />}
            {tab === 'issues' && <IssuesPanel issues={issues} />}
            {tab === 'cost' && <CostPanel />}
          </div>
        </aside>
      </div>
    </div>
  );
}
