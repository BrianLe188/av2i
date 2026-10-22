import { useMemo } from 'react';
import { estimateCost, formatUsd } from '@av2i/core';
import { useStore } from '../store';

export function CostPanel() {
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const region = useStore((s) => s.region);
  const select = useStore((s) => s.select);
  const estimate = useMemo(() => estimateCost({ nodes, edges }, { region }), [nodes, edges, region]);
  const billed = estimate.items.filter((i) => i.monthly > 0 || i.usage);

  if (billed.length === 0) return <p className="text-sm text-muted-foreground">Nothing here costs money yet.</p>;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline gap-2">
        <span className="text-xs text-muted-foreground">Estimated fixed cost</span>
        <strong className="text-2xl">{formatUsd(estimate.total)}</strong>
        <span className="text-xs text-muted-foreground">per month</span>
      </div>
      <ul className="flex flex-col gap-2">
        {billed.map((i) => (
          <li
            key={i.nodeId}
            className="cursor-pointer rounded-lg border bg-background px-2.5 py-2 text-sm transition-colors hover:border-primary"
            onClick={() => select(i.nodeId)}
          >
            <div className="flex justify-between gap-2">
              <strong>{i.name}</strong>
              <span>{i.monthly > 0 ? formatUsd(i.monthly) : '—'}</span>
            </div>
            <div className="text-xs text-muted-foreground">{i.detail}</div>
            {i.usage && <div className="text-xs text-muted-foreground">+ by use: {i.usage}</div>}
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        Approximate on-demand list prices (us-east-1, scaled for {region}), 730 hours a month. Excludes free tier,
        taxes, data transfer and anything billed by use.
      </p>
    </div>
  );
}
