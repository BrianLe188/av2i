import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type Edge as RFEdge, type EdgeProps } from "@xyflow/react";
import { KeyRound, Link2, Network, TriangleAlert, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { groupColor, hasArrow, type EdgeGroup } from "../logic/edges.ts";
import type { EdgeData } from "../logic/flow.ts";

const ICON: Record<EdgeGroup, LucideIcon> = { traffic: Network, access: KeyRound, attach: Link2, wiring: Link2 };

/** A connection drawn by what it is for: colour and stroke by family, an arrow where something is called or granted, a chip that names it. */
export function LinkEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, label, selected, data }: EdgeProps<RFEdge<EdgeData>>) {
  if (!data) return null;
  const [path, lx, ly] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 10 });
  const color = data.flagged ? "var(--edge-error)" : groupColor(data.group);
  const dash = data.generated ? "2 5" : data.group === "access" ? "9 5" : data.group === "wiring" ? "3 3" : undefined;
  const Icon = data.flagged ? TriangleAlert : ICON[data.group];
  const text = typeof label === "string" ? label : "";
  const prefix = data.detail && text.endsWith(data.detail) ? text.slice(0, text.length - data.detail.length).replace(/ · $/, "") : text;
  const marker = `${id}-arrow`;
  return (
    <g style={{ opacity: data.dimmed ? 0.18 : data.generated ? 0.6 : 1, transition: "opacity 0.15s" }}>
      {hasArrow(data.group) && (
        <defs>
          <marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
            <path d="M0,0 L10,5 L0,10 z" fill={color} />
          </marker>
        </defs>
      )}
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={18}
        markerEnd={hasArrow(data.group) ? `url(#${marker})` : undefined}
        style={{ stroke: color, strokeWidth: selected ? 3 : data.group === "attach" || data.group === "wiring" ? 1.4 : 2, strokeDasharray: dash }}
      />
      <EdgeLabelRenderer>
        <div
          title={data.hint}
          className={cn(
            "nodrag nopan pointer-events-auto absolute flex items-center gap-1 rounded-full border bg-card px-1.5 py-0.5 text-[10px] leading-none shadow-sm transition-opacity",
            selected && "ring-2 ring-ring/60",
            data.dimmed && "opacity-20",
          )}
          style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)`, borderColor: color, color: "var(--foreground)" }}
          data-testid={`edge-chip-${id}`}
        >
          <Icon className="size-2.5 flex-none" style={{ color }} />
          {prefix && <span>{prefix}</span>}
          {data.detail && <b className="font-mono font-semibold">{data.detail}</b>}
        </div>
      </EdgeLabelRenderer>
    </g>
  );
}

