import { useMemo, useState } from 'react';
import { importTerraform, RESOURCES, type ImportResult, type ResourceType } from '@av2i/core';
import { TriangleAlert } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

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
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import Terraform</DialogTitle>
          <DialogDescription>
            Reads AWS resources av2i can draw (VPC, subnets, gateways, routes, EC2, RDS, Lambda, ECS, load balancers, S3, CloudFront,
            Route 53, security groups). Variables, modules, <code>count</code> and <code>for_each</code> are not evaluated.
          </DialogDescription>
        </DialogHeader>
        <Input type="file" accept=".tf,text/plain" multiple onChange={(e) => void readFiles(e.target.files)} aria-label="Terraform files" />
        <Textarea
          rows={10}
          spellCheck={false}
          className="font-mono text-xs"
          placeholder='resource "aws_vpc" "main" { ... }'
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="Terraform source"
        />
        {result instanceof Error && (
          <Alert variant="destructive">
            <AlertDescription>Could not read this: {result.message}</AlertDescription>
          </Alert>
        )}
        {ok && (
          <div className="flex flex-col gap-1 text-sm">
            <strong>
              {count} resource{count === 1 ? '' : 's'} · {ok.graph.edges.length} connection{ok.graph.edges.length === 1 ? '' : 's'} · {ok.region}
            </strong>
            <div className="text-xs text-muted-foreground">
              {Object.entries(ok.report.imported)
                .map(([t, n]) => `${n} × ${RESOURCES[t as ResourceType].label}`)
                .join(', ') || 'Nothing recognised.'}
            </div>
            {skipped.length > 0 && (
              <div className="text-xs text-muted-foreground">Not drawn: {skipped.map(([t, n]) => `${t} (${n})`).join(', ')}</div>
            )}
            {ok.report.warnings.map((w, i) => (
              <Alert key={i} className="border-amber-500/40">
                <TriangleAlert className="text-amber-600" />
                <AlertDescription>{w}</AlertDescription>
              </Alert>
            ))}
          </div>
        )}
        <DialogFooter className="items-center">
          <Input className="max-w-64" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} aria-label="Project name" />
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
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
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
