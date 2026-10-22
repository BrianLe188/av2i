import { useState } from 'react';
import { BaseEdge, EdgeLabelRenderer, type Edge, type EdgeProps } from '@xyflow/react';
import { labelPoint, pathFromPoints, type Point } from '@av2i/core';

export interface RoutedEdgeData extends Record<string, unknown> {
  /** Absolute route from the router; missing until it has been computed. */
  points?: Point[];
  label: string;
}

export type RoutedEdgeType = Edge<RoutedEdgeData, 'routed'>;

/** Draws the route the router found. The label only shows while the connection is hovered or selected, to keep the canvas calm. */
export function RoutedEdge({ id, sourceX, sourceY, targetX, targetY, data, selected }: EdgeProps<RoutedEdgeType>) {
  const [hover, setHover] = useState(false);
  const points = data?.points ?? [
    { x: sourceX, y: sourceY },
    { x: (sourceX + targetX) / 2, y: sourceY },
    { x: (sourceX + targetX) / 2, y: targetY },
    { x: targetX, y: targetY },
  ];
  const at = labelPoint(points);
  return (
    <g onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} className={hover ? 'edge-hover' : undefined}>
      <BaseEdge id={id} path={pathFromPoints(points)} interactionWidth={16} />
      {(hover || selected) && data?.label && (
        <EdgeLabelRenderer>
          <div className="edge-label" style={{ left: at.x, top: at.y }}>
            {data.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </g>
  );
}
