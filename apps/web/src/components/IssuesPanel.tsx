import { CircleAlert, ShieldAlert, TriangleAlert } from 'lucide-react';
import type { Issue } from '@av2i/core';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import { useStore } from '../store';

export function IssuesPanel({ issues }: { issues: Issue[] }) {
  const nodes = useStore((s) => s.nodes);
  const select = useStore((s) => s.select);
  const selectEdge = useStore((s) => s.selectEdge);
  if (issues.length === 0) return <p className="text-sm text-muted-foreground">No issues found.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {issues.map((i, k) => {
        const Icon = i.category === 'security' ? ShieldAlert : i.severity === 'error' ? CircleAlert : TriangleAlert;
        return (
          <li key={k}>
            <Alert
              className={cn('cursor-pointer transition-colors hover:bg-muted/50', i.severity === 'error' ? 'border-destructive/40' : 'border-amber-500/40')}
              onClick={() => (i.edgeId ? selectEdge(i.edgeId) : select(i.nodeId))}
            >
              <Icon className={i.severity === 'error' ? 'text-destructive' : 'text-amber-600'} />
              <AlertTitle>
                {nodes.find((n) => n.id === i.nodeId)?.name ?? i.nodeId}
                {i.edgeId ? ' (connection)' : ''}
                {i.category === 'security' && <span className="ml-2 rounded bg-destructive px-1.5 py-px text-[10px] font-bold uppercase text-white">Security</span>}
              </AlertTitle>
              <AlertDescription>{i.message}</AlertDescription>
            </Alert>
          </li>
        );
      })}
    </ul>
  );
}
