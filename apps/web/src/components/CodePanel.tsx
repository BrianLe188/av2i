import { useMemo, useState } from 'react';
import { strToU8, zipSync } from 'fflate';
import { generateTerraform } from '@av2i/core';
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
    <div className="code">
      <div className="code-bar">
        {names.map((f) => (
          <button key={f} className={f === active ? 'chip active' : 'chip'} onClick={() => setCurrent(f)}>
            {f}
          </button>
        ))}
        <span className="spacer" />
        <button
          onClick={() => {
            void navigator.clipboard.writeText(files[active]);
            notify(`Copied ${active}`);
          }}
        >
          Copy
        </button>
        <button
          onClick={() => {
            const zip = zipSync(Object.fromEntries(names.map((f) => [`${slug}/${f}`, strToU8(files[f])])));
            download(`${slug}.zip`, zip, 'application/zip');
          }}
        >
          Download .zip
        </button>
      </div>
      {errorCount > 0 && (
        <div className="banner error">
          {errorCount} validation error{errorCount === 1 ? '' : 's'}: this code will likely fail to apply.
        </div>
      )}
      <pre>{files[active]}</pre>
    </div>
  );
}
