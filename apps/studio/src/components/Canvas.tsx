import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background, ConnectionMode, Controls, Handle, MiniMap, NodeResizer, Panel, Position, ReactFlow, ReactFlowProvider, useEdgesState, useNodesState, useReactFlow,
  type Connection, type Node as RFNode, type NodeProps,
} from "@xyflow/react";
import type { Design } from "@av2i/model";
import { cn } from "@/lib/utils";
import { paletteItem, reg } from "../registry.ts";
import { colorOf } from "../logic/colors.ts";
import type { Analysis } from "../logic/analyze.ts";
import { addEdge, removeEdges, removeNodes, subtree, updateNode } from "../logic/design.ts";
import { buildFlow, type EdgeData, type NodeData, type Rect, type ResizeHandlers, type Selection } from "../logic/flow.ts";
import { absolute, containerAt, LEAF, sizeOf } from "../logic/layout.ts";
import { canPlace, connect } from "../logic/placement.ts";
import type { Lang, Strings } from "../i18n.ts";
import { DRAG_TYPE } from "./Palette.tsx";
import { LinkEdge } from "./LinkEdge.tsx";
import { EDGE_GROUPS, groupColor, type EdgeGroup } from "../logic/edges.ts";
import { Eye, EyeOff } from "lucide-react";

function ResourceNode({ id, data, selected }: NodeProps<RFNode<NodeData>>) {
  const color = colorOf(data.service);
  const sev = data.severity === "error" ? "bg-destructive" : data.severity === "warning" ? "bg-warning" : "bg-info";
  return (
    <div
      className={cn(
        "group relative h-full w-full rounded-lg border-[1.5px] px-2.5 py-1.5 text-xs",
        data.container ? "bg-transparent" : "h-14 w-[150px] border-l-[5px] bg-card",
        data.generated && "border-dashed opacity-60",
        data.focused && "ring-[3px] ring-ring/60",
      )}
      style={{ borderColor: color, ...(data.container ? { background: `color-mix(in srgb, ${color} 7%, transparent)` } : {}) }}
      data-svc={data.service}
      data-testid={`node-${data.label}`}
    >
      {data.container && data.fit && data.resize && (
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
      <div className={cn("flex items-center gap-1.5", data.container && "absolute inset-x-2.5 top-1.5")}>
        <span className="truncate font-semibold">{data.label}</span>
        {data.severity && <span className={cn("ml-auto size-2.5 flex-none rounded-full", sev)} title={data.severity} />}
      </div>
      {!data.container && (
        <div className="truncate text-[11px] text-muted-foreground">{data.serviceTitle.replace(/ \(.*$/, "")}{data.detail ? ` · ${data.detail}` : ""}</div>
      )}
      <Handle type="source" position={Position.Right} id="r" />
    </div>
  );
}

const nodeTypes = { resource: ResourceNode };
const edgeTypes = { link: LinkEdge };

function Legend({ s, hidden, toggle }: { s: Strings; hidden: ReadonlySet<EdgeGroup>; toggle: (g: EdgeGroup) => void }) {
  const dash = (g: EdgeGroup) => (g === "access" ? "5 3" : undefined);
  return (
    <div className="w-48 rounded-lg border bg-card/95 p-2 text-[11px] shadow-sm backdrop-blur" data-testid="legend">
      <div className="mb-1 font-semibold text-muted-foreground">{s.legend}</div>
      {EDGE_GROUPS.map((g) => (
        <button
          key={g}
          type="button"
          title={s.edgeGroupHint[g]}
          aria-pressed={!hidden.has(g)}
          onClick={() => toggle(g)}
          className={cn("flex w-full items-center gap-2 rounded px-1 py-1 text-left hover:bg-accent", hidden.has(g) && "opacity-45")}
          data-testid={`legend-${g}`}
        >
          <svg width="26" height="8" className="flex-none"><line x1="1" y1="4" x2={g === "attach" ? 25 : 20} y2="4" stroke={groupColor(g)} strokeWidth={g === "attach" ? 1.4 : 2} strokeDasharray={dash(g)} />{g !== "attach" && <path d="M19,0.5 L25,4 L19,7.5 z" fill={groupColor(g)} />}</svg>
          <span className="flex-1 truncate">{s.edgeGroups[g]}</span>
          {hidden.has(g) ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
        </button>
      ))}
      <div className="mt-1 border-t pt-1 text-muted-foreground">{s.generatedLine}</div>
    </div>
  );
}

interface Props {
  design: Design;
  analysis: Analysis;
  selection: Selection;
  focus: ReadonlySet<string>;
  lang: Lang;
  s: Strings;
  loadId: number;
  dark: boolean;
  onSelect: (sel: Selection) => void;
  onEdit: (f: (d: Design) => Design) => void;
  onAdd: (service: string, parent: string | null, position?: { x: number; y: number }) => void;
  onToast: (message: string) => void;
}

function Flow({ design, analysis, selection, focus, lang, s, loadId, dark, onSelect, onEdit, onAdd, onToast }: Props) {
  const [hidden, setHidden] = useState<ReadonlySet<EdgeGroup>>(new Set());
  const toggle = useCallback((g: EdgeGroup) => setHidden((h) => { const n = new Set(h); if (!n.delete(g)) n.add(g); return n; }), []);
  const flow = useMemo(() => buildFlow(reg, design, analysis, selection, focus, lang, s, hidden), [design, analysis, selection, focus, lang, s, hidden]);
  const [nodes, setNodes, onNodesChange] = useNodesState<RFNode<NodeData>>(flow.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(flow.edges);
  const [resync, setResync] = useState(0);
  const rf = useReactFlow();

  const resize = useMemo<ResizeHandlers>(() => {
    /** Dragging a top or left edge moves the container's origin, so the children shift back to stay where they were. */
    const shifted = (key: string, r: Rect) => {
      const dn = design.nodes.find((n) => n.key === key);
      const dx = r.x - (dn?.position?.x ?? 0), dy = r.y - (dn?.position?.y ?? 0);
      return { dn, dx, dy };
    };
    return {
      allowed: (key, r) => {
        const { dx, dy } = shifted(key, r);
        const pos = new Map(design.nodes.filter((n) => n.position).map((n) => [n.key, n.position!]));
        return design.nodes.filter((n) => n.parent === key && n.position).every((c) => {
          const sz = sizeOf(design, c.key, pos);
          return c.position!.x - dx >= 8 && c.position!.y - dy >= 8 && c.position!.x - dx + sz.w <= r.width && c.position!.y - dy + sz.h <= r.height;
        });
      },
      commit: (key, r) => {
        const { dx, dy } = shifted(key, r);
        const size = { w: Math.round(r.width), h: Math.round(r.height) };
        onEdit((d) => ({
          ...d,
          nodes: d.nodes.map((n) => {
            if (n.key === key) return { ...n, size, position: { x: Math.round(r.x), y: Math.round(r.y) } };
            if (n.parent === key && n.position && (dx || dy)) return { ...n, position: { x: n.position.x - dx, y: n.position.y - dy } };
            return n;
          }),
        }));
      },
    };
  }, [design, onEdit]);

  useEffect(() => {
    setNodes((prev) => flow.nodes.map((n) => ({
      ...n,
      ...(n.data.container ? { data: { ...n.data, resize } } : {}),
      measured: prev.find((p) => p.id === n.id)?.measured,
    })));
    setEdges(flow.edges);
  }, [flow, resize, resync, setNodes, setEdges]);

  const refuse = useCallback((what: string, reason: { vi: string; en: string }) => {
    onToast(`${what}: ${reason[lang]}`);
    setResync((n) => n + 1);
  }, [lang, onToast]);

  const onDrop = useCallback((e: React.DragEvent) => {
    const item = paletteItem(e.dataTransfer.getData(DRAG_TYPE));
    if (!item) return;
    e.preventDefault();
    const at = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const parent = containerAt(design, at);
    const verdict = canPlace(reg, parent ? design.nodes.find((n) => n.key === parent)!.service : null, item.service, item.props);
    if (!verdict.ok) return refuse(s.dropRefused, verdict.reason);
    const origin = parent ? absolute(design, parent) : { x: 0, y: 0 };
    const position = { x: Math.max(8, Math.round(at.x - origin.x - LEAF.w / 2)), y: Math.max(40, Math.round(at.y - origin.y - LEAF.h / 2)) };
    onAdd(item.id, parent, position);
  }, [rf, design, refuse, s, onAdd]);

  const onDragStop = useCallback((_: unknown, node: RFNode<NodeData>) => {
    const dn = design.nodes.find((n) => n.key === node.id);
    if (!dn) return;
    const parentAbs = dn.parent ? absolute(design, dn.parent) : { x: 0, y: 0 };
    const abs = { x: node.position.x + parentAbs.x, y: node.position.y + parentAbs.y };
    const centre = { x: abs.x + LEAF.w / 2, y: abs.y + LEAF.h / 2 };
    const target = containerAt(design, centre, subtree(design, node.id));
    if ((target ?? null) === (dn.parent ?? null)) {
      const position = { x: Math.round(node.position.x), y: Math.round(node.position.y) };
      if (position.x !== dn.position?.x || position.y !== dn.position?.y) onEdit((d) => updateNode(d, node.id, (n) => ({ ...n, position })));
      return;
    }
    const verdict = canPlace(reg, target ? design.nodes.find((n) => n.key === target)!.service : null, dn.service, dn.props);
    if (!verdict.ok) return refuse(s.dropRefused, verdict.reason);
    const base = target ? absolute(design, target) : { x: 0, y: 0 };
    const position = { x: Math.max(8, Math.round(abs.x - base.x)), y: Math.max(40, Math.round(abs.y - base.y)) };
    onEdit((d) => updateNode(d, node.id, (n) => ({ ...n, parent: target, position })));
  }, [design, refuse, s, onEdit]);

  const onConnect = useCallback((c: Connection) => {
    const v = connect(reg, design, c.source, c.target);
    if (!v.ok) return refuse(s.connectRefused, v.reason);
    onEdit((d) => addEdge(d, v.edge));
    onSelect({ kind: "edge", id: v.edge.id });
  }, [design, refuse, s, onEdit, onSelect]);

  const isValidConnection = useCallback((c: { source: string; target: string }) => connect(reg, design, c.source, c.target).ok, [design]);

  return (
    <div className="h-full w-full" onDragOver={(e) => { if (e.dataTransfer.types.includes(DRAG_TYPE)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } }} onDrop={onDrop}>
      <ReactFlow<RFNode<NodeData>, import("@xyflow/react").Edge<EdgeData>>
        key={loadId}
        colorMode={dark ? "dark" : "light"}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_, n) => onSelect({ kind: "node", id: n.id })}
        onEdgeClick={(_, e) => onSelect({ kind: "edge", id: e.id })}
        onPaneClick={() => onSelect(null)}
        onNodeDragStop={onDragStop}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onNodesDelete={(ns) => onEdit((d) => removeNodes(d, ns.map((n) => n.id)))}
        onEdgesDelete={(es) => onEdit((d) => removeEdges(d, es.map((e) => e.id)))}
        connectionMode={ConnectionMode.Loose}
        fitView
        minZoom={0.2}
        maxZoom={1.6}
        deleteKeyCode={["Backspace", "Delete"]}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} />
        <Panel position="top-right" className="!m-2">
          <Legend s={s} hidden={hidden} toggle={toggle} />
        </Panel>
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable style={{ width: 150, height: 96 }} nodeColor="#8a96a8" maskColor="rgba(120,130,150,0.15)" />
      </ReactFlow>
    </div>
  );
}

export function Canvas(props: Props) {
  return (
    <ReactFlowProvider>
      <Flow {...props} />
    </ReactFlowProvider>
  );
}
