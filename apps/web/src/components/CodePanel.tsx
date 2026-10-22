import { useMemo, useState } from 'react';
import { strToU8, zipSync } from 'fflate';
import { Copy, Download } from 'lucide-react';
import { generateTerraform } from '@av2i/core';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useStore } from '../store';

function download(filename: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function CodePanel({ errorCount }: { errorCount: number }) {
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const region = useStore((s) => s.region);
  const name = useStore((s) => s.name);
  const notify = useStore((s) => s.notify);
  const files = useMemo(() => generateTerraform({ nodes, edges }, { region }), [nodes, edges, region]);
  const names = Object.keys(files);
  const [current, setCurrent] = useState('main.tf');
  const active = files[current] !== undefined ? current : names[0];
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'infrastructure';

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {names.map((f) => (
          <Button key={f} size="xs" variant={f === active ? 'default' : 'outline'} onClick={() => setCurrent(f)}>
            {f}
          </Button>
        ))}
        <span className="flex-1" />
        <Button
          size="xs"
          variant="outline"
          onClick={() => {
            void navigator.clipboard.writeText(files[active]);
            notify(`Copied ${active}`);
          }}
        >
          <Copy /> Copy
        </Button>
        <Button
          size="xs"
          variant="outline"
          onClick={() => {
            const zip = zipSync(Object.fromEntries(names.map((f) => [`${slug}/${f}`, strToU8(files[f])])));
            download(`${slug}.zip`, zip, 'application/zip');
          }}
        >
          <Download /> .zip
        </Button>
      </div>
      {errorCount > 0 && (
        <Alert variant="destructive">
          <AlertDescription>
            {errorCount} validation error{errorCount === 1 ? '' : 's'}: this code will likely fail to apply.
          </AlertDescription>
        </Alert>
      )}
      <pre className="overflow-auto rounded-lg border bg-muted/40 p-2.5 font-mono text-xs leading-relaxed">{files[active]}</pre>
    </div>
  );
}
