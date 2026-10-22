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

  if (billed.length === 0) return <div className="empty">Nothing here costs money yet.</div>;
  return (
    <div className="cost">
      <div className="cost-total">
        <span className="muted">Estimated fixed cost</span>
        <strong>{formatUsd(estimate.total)}</strong>
        <span className="muted">per month</span>
      </div>
      <ul className="cost-list">
        {billed.map((i) => (
          <li key={i.nodeId} onClick={() => select(i.nodeId)}>
            <div className="cost-row">
              <strong>{i.name}</strong>
              <span>{i.monthly > 0 ? formatUsd(i.monthly) : '—'}</span>
            </div>
            <div className="muted">{i.detail}</div>
            {i.usage && <div className="muted">+ by use: {i.usage}</div>}
          </li>
        ))}
      </ul>
      <p className="muted">
        Approximate on-demand list prices (us-east-1, scaled for {region}), 730 hours a month. Excludes free tier,
        taxes, data transfer and anything billed by use.
      </p>
    </div>
  );
}
