import { Handle, NodeResizer, NodeToolbar, Position, type Node as RFNode, type NodeProps } from "@xyflow/react";
import { Copy, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { colorOf } from "../logic/colors.ts";
import { iconOf } from "../logic/icons.ts";
import type { NodeData } from "../logic/flow.ts";

const SEVERITY_BG = { error: "bg-destructive text-white", warning: "bg-warning text-black", info: "bg-info text-white" } as const;

function IssueBadge({ data }: { data: NodeData }) {
  if (!data.severity || data.issues.count === 0) return null;
  return (
    <span
      className={cn("flex h-4 min-w-4 flex-none items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none", SEVERITY_BG[data.severity])}
      title={data.issues.rules.join(", ")}
      data-testid="issue-badge"
    >
      {data.issues.count}
    </span>
  );
}

/** A square tile in the service colour that carries the service glyph. */
function Tile({ service, size }: { service: string; size: "sm" | "md" }) {
  const Icon = iconOf(service);
  const color = colorOf(service);
  return (
    <span
      className={cn("flex flex-none items-center justify-center rounded-md", size === "md" ? "size-9" : "size-6")}
      style={{ background: `color-mix(in srgb, ${color} 18%, transparent)`, color }}
    >
      <Icon className={size === "md" ? "size-5" : "size-3.5"} strokeWidth={1.8} />
    </span>
  );
}

const handleCls = "!size-2 !border-0 !bg-muted-foreground";

export function ResourceNode({ id, data, selected }: NodeProps<RFNode<NodeData>>) {
  const color = colorOf(data.service);
  const connecting = data.connect;
  const state = cn(
    connecting === "invalid" && "opacity-35",
    connecting === "valid" && "ring-2 ring-info/70",
    data.focused && "animate-[pulse_0.9s_ease-in-out_2] ring-[3px] ring-ring/60",
  );
  const border = { borderColor: selected ? color : `color-mix(in srgb, ${color} 55%, var(--border))` };
  const selectedShadow = selected ? { boxShadow: `0 0 0 3px color-mix(in srgb, ${color} 28%, transparent), 0 4px 14px color-mix(in srgb, ${color} 25%, transparent)` } : undefined;

  const toolbar = !data.generated && data.actions && (
    <NodeToolbar isVisible={selected} position={Position.Top} align="end" offset={6}>
      <div className="flex gap-0.5 rounded-md border bg-card p-0.5 shadow-md">
        {!data.container && (
          <button type="button" title={data.duplicateLabel} aria-label={data.duplicateLabel} onClick={() => data.actions!.duplicate(id)} className="rounded p-1 hover:bg-accent" data-testid="node-duplicate">
            <Copy className="size-3.5" />
          </button>
        )}
        <button type="button" title={data.deleteLabel} aria-label={data.deleteLabel} onClick={() => data.actions!.remove(id)} className="rounded p-1 text-destructive hover:bg-accent" data-testid="node-delete">
          <Trash2 className="size-3.5" />
        </button>
      </div>
    </NodeToolbar>
  );

  if (data.container) {
    const tint = data.subnetKind === "public" ? "var(--warning)" : data.subnetKind === "private" ? "var(--info)" : color;
    const strength = data.service === "subnet" ? 7 : 4 + data.depth * 2;
    return (
      <div
        className={cn("group relative h-full w-full rounded-xl border-[1.5px] text-xs", data.generated && "border-dashed", state)}
        style={{ ...border, ...selectedShadow, background: `color-mix(in srgb, ${tint} ${strength}%, transparent)` }}
        data-svc={data.service}
        data-testid={`node-${data.label}`}
      >
        {toolbar}
        {data.fit && data.resize && (
          <NodeResizer
            isVisible={selected}
            minWidth={data.fit.w}
            minHeight={data.fit.h}
            color={color}
            handleStyle={{ width: 10, height: 10, borderRadius: 3, background: "var(--background)", border: `2px solid ${color}` }}
            lineStyle={{ borderColor: color, opacity: 0.6 }}
            shouldResize={(_, p) => data.resize!.allowed(id, p)}
            onResizeEnd={(_, p) => data.resize!.commit(id, p)}
          />
        )}
        <Handle type="source" position={Position.Left} id="l" />
        <Handle type="source" position={Position.Top} id="t" />
        <Handle type="source" position={Position.Bottom} id="b" />
        <Handle type="source" position={Position.Right} id="r" />
        <div className="absolute inset-x-0 top-0 flex h-9 items-center gap-2 rounded-t-xl border-b px-2" style={{ borderColor: `color-mix(in srgb, ${color} 25%, transparent)`, background: `color-mix(in srgb, ${color} 10%, transparent)` }}>
          <Tile service={data.service} size="sm" />
          <span className="truncate text-[13px] font-semibold">{data.label}</span>
          {data.detail && <span className="flex-none rounded bg-background/70 px-1 font-mono text-[10px] text-muted-foreground">{data.detail}</span>}
          {data.subnetKind && (
            <span className={cn("flex-none rounded-full px-1.5 py-px text-[10px] font-medium", data.subnetKind === "public" ? "bg-warning/25 text-foreground" : "bg-info/20 text-info")}>
              {data.subnetKind === "public" ? data.kindLabels.public : data.kindLabels.private}
            </span>
          )}
          <span className="ml-auto" />
          <IssueBadge data={data} />
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "leaf-node group relative flex h-full w-full items-center gap-2 rounded-[10px] border-[1.5px] bg-card px-2 shadow-sm transition-shadow hover:shadow-md",
        data.generated && "border-dashed opacity-75",
        state,
      )}
      style={{ ...border, ...selectedShadow }}
      data-svc={data.service}
      data-testid={`node-${data.label}`}
    >
      {toolbar}
      <Handle type="source" position={Position.Left} id="l" className={handleCls} />
      <Handle type="source" position={Position.Top} id="t" className={handleCls} />
      <Handle type="source" position={Position.Bottom} id="b" className={handleCls} />
      <Handle type="source" position={Position.Right} id="r" className={handleCls} />
      <Tile service={data.service} size="md" />
      <div className="min-w-0 flex-1 text-xs leading-tight">
        <div className="flex items-center gap-1">
          <span className="truncate font-semibold">{data.label}</span>
          {data.generated && <span className="flex-none rounded bg-muted px-1 text-[9px] uppercase tracking-wide text-muted-foreground">{data.autoTag}</span>}
        </div>
        <div className="truncate text-[11px] text-muted-foreground">{data.serviceTitle.replace(/ \(.*$/, "")}</div>
        {data.detail && <div className="mt-0.5 truncate"><span className="rounded bg-muted px-1 font-mono text-[10px] text-muted-foreground">{data.detail}</span></div>}
      </div>
      <IssueBadge data={data} />
    </div>
  );
}
