import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background, BackgroundVariant, ConnectionMode, Controls, MiniMap, Panel, ReactFlow, ReactFlowProvider, useEdgesState, useNodesState, useReactFlow,
  type Connection, type Node as RFNode,
} from "@xyflow/react";
import type { Design } from "@av2i/model";
import { cn } from "@/lib/utils";
import { paletteItem, reg } from "../registry.ts";
import { colorOf } from "../logic/colors.ts";
import type { Analysis } from "../logic/analyze.ts";
import { addEdge, addNode, removeEdges, removeNodes, subtree, updateNode } from "../logic/design.ts";
import { buildFlow, type EdgeData, type NodeData, type NodeActions, type Rect, type ResizeHandlers, type Selection } from "../logic/flow.ts";
import { autoLayout } from "../logic/autolayout.ts";
import { absolute, containerAt, LEAF, nearestFree, placeFree, sizeOf, tidy } from "../logic/layout.ts";
import { canPlace, connect } from "../logic/placement.ts";
import type { Lang, Strings } from "../i18n.ts";
import { DRAG_TYPE } from "./Palette.tsx";
import { LinkEdge } from "./LinkEdge.tsx";
import { ResourceNode } from "./ResourceNode.tsx";
import { DEFAULT_HIDDEN, EDGE_GROUPS, groupColor, type EdgeGroup } from "../logic/edges.ts";
import { Eye, EyeOff } from "lucide-react";

const nodeTypes = { resource: ResourceNode };
const edgeTypes = { link: LinkEdge };

function Legend({ s, hidden, toggle, relatedOnly, setRelatedOnly, untangle, arrange, arranging, readOnly }: {
  arrange: () => void; arranging: boolean; readOnly: boolean; s: Strings; hidden: ReadonlySet<EdgeGroup>; toggle: (g: EdgeGroup) => void; relatedOnly: boolean; setRelatedOnly: (v: boolean) => void; untangle: () => void;
}) {
  const dash = (g: EdgeGroup) => (g === "access" ? "5 3" : g === "wiring" ? "2 2" : undefined);
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
          <svg width="26" height="8" className="flex-none"><line x1="1" y1="4" x2={g === "attach" || g === "wiring" ? 25 : 20} y2="4" stroke={groupColor(g)} strokeWidth={g === "attach" || g === "wiring" ? 1.4 : 2} strokeDasharray={dash(g)} />{g !== "attach" && g !== "wiring" && <path d="M19,0.5 L25,4 L19,7.5 z" fill={groupColor(g)} />}</svg>
          <span className="flex-1 truncate">{s.edgeGroups[g]}</span>
          {hidden.has(g) ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
        </button>
      ))}
      <div className="mt-1 border-t pt-1 text-muted-foreground">{s.generatedLine}</div>
      <div className="mt-1.5 flex flex-col gap-1 border-t pt-1.5">
        <button type="button" aria-pressed={relatedOnly} onClick={() => setRelatedOnly(!relatedOnly)} className={cn("w-full rounded border px-1.5 py-1 text-left hover:bg-accent", relatedOnly && "border-ring bg-accent")} data-testid="related-only">
          {s.relatedOnly}
        </button>
        <button type="button" onClick={untangle} disabled={readOnly} className="w-full rounded border px-1.5 py-1 text-left hover:bg-accent disabled:pointer-events-none disabled:opacity-50" data-testid="tidy">
          {s.tidy}
        </button>
        <button type="button" onClick={arrange} disabled={readOnly || arranging} className="w-full rounded border px-1.5 py-1 text-left hover:bg-accent disabled:pointer-events-none disabled:opacity-50" data-testid="auto-layout">
          {s.autoLayout}
        </button>
      </div>
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
  readOnly?: boolean;
}

function Flow({ design, analysis, selection, focus, lang, s, loadId, dark, onSelect, onEdit, onAdd, onToast, readOnly = false }: Props) {
  const [hidden, setHidden] = useState<ReadonlySet<EdgeGroup>>(new Set(DEFAULT_HIDDEN));
  const [relatedOnly, setRelatedOnly] = useState(false);
  const toggle = useCallback((g: EdgeGroup) => setHidden((h) => { const n = new Set(h); if (!n.delete(g)) n.add(g); return n; }), []);
  const flow = useMemo(() => buildFlow(reg, design, analysis, selection, focus, lang, s, hidden, relatedOnly), [design, analysis, selection, focus, lang, s, hidden, relatedOnly]);
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

  const actions = useMemo<NodeActions>(() => ({
    duplicate: (key) => {
      const src = design.nodes.find((n) => n.key === key);
      if (!src) return;
      const at = src.position ? { x: src.position.x + 24, y: src.position.y + 24 } : undefined;
      const r = addNode(reg, design, src.service, src.parent ?? null, at, JSON.parse(JSON.stringify(src.props)));
      onEdit(() => placeFree(r.design, r.key));
      onSelect({ kind: "node", id: r.key });
    },
    remove: (key) => { onEdit((d) => removeNodes(d, [key])); onSelect(null); },
    select: (key) => onSelect({ kind: "node", id: key }),
  }), [design, onEdit, onSelect]);

  const untangle = useCallback(() => {
    const next = tidy(design);
    const moved = next.nodes.some((n, i) => n.position?.x !== design.nodes[i]?.position?.x || n.position?.y !== design.nodes[i]?.position?.y);
    if (!moved) return onToast(s.nothingToTidy);
    onEdit(() => next);
    onToast(s.tidied);
  }, [design, onEdit, onToast, s]);

  const [arranging, setArranging] = useState(false);
  /** Arranges the whole design with ELK; it is one edit, so undo brings the old arrangement back. */
  const arrange = useCallback(async () => {
    setArranging(true);
    try {
      const measured = new Map(rf.getNodes().filter((n) => !n.data.container && n.measured?.width && n.measured?.height).map((n) => [n.id, { w: n.measured!.width!, h: n.measured!.height! }]));
      const next = await autoLayout(design, analysis, measured);
      onEdit(() => next);
      onToast(s.autoLaidOut);
      // the nodes move on the next render; frame them once they have
      requestAnimationFrame(() => requestAnimationFrame(() => void rf.fitView({ padding: 0.15, duration: 300 })));
    } catch {
      onToast(s.layoutFailed);
    } finally {
      setArranging(false);
    }
  }, [design, analysis, onEdit, onToast, rf, s]);

  const [connectFrom, setConnectFrom] = useState<string | null>(null);

  useEffect(() => {
    setNodes((prev) => flow.nodes.map((n) => ({
      ...n,
      data: {
        ...n.data,
        ...(n.data.container && !readOnly ? { resize } : {}),
        ...(n.data.generated || readOnly ? {} : { actions }),
        ...(connectFrom && connectFrom !== n.id ? { connect: connect(reg, design, connectFrom, n.id).ok ? "valid" as const : "invalid" as const } : {}),
      },
      measured: prev.find((p) => p.id === n.id)?.measured,
    })));
    setEdges(flow.edges);
  }, [flow, resize, actions, connectFrom, design, resync, readOnly, setNodes, setEdges]);

  const refuse = useCallback((what: string, reason: { vi: string; en: string }) => {
    onToast(`${what}: ${reason[lang]}`);
    setResync((n) => n + 1);
  }, [lang, onToast]);

  /** A new node dropped on top of another goes to the nearest free spot beside it. */
  const nearest = useCallback((parent: string | null, position: { x: number; y: number }) => nearestFree(design, parent, position, LEAF), [design]);

  const onDrop = useCallback((e: React.DragEvent) => {
    if (readOnly) return;
    const item = paletteItem(e.dataTransfer.getData(DRAG_TYPE));
    if (!item) return;
    e.preventDefault();
    const at = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const parent = containerAt(design, at);
    const verdict = canPlace(reg, parent ? design.nodes.find((n) => n.key === parent)!.service : null, item.service, item.props);
    if (!verdict.ok) return refuse(s.dropRefused, verdict.reason);
    const origin = parent ? absolute(design, parent) : { x: 0, y: 0 };
    const position = { x: Math.max(8, Math.round(at.x - origin.x - LEAF.w / 2)), y: Math.max(40, Math.round(at.y - origin.y - LEAF.h / 2)) };
    onAdd(item.id, parent, nearest(parent, position));
  }, [rf, design, refuse, s, onAdd, nearest, readOnly]);

  const onDragStop = useCallback((_: unknown, node: RFNode<NodeData>) => {
    const dn = design.nodes.find((n) => n.key === node.id);
    if (!dn) return;
    const parentAbs = dn.parent ? absolute(design, dn.parent) : { x: 0, y: 0 };
    const abs = { x: node.position.x + parentAbs.x, y: node.position.y + parentAbs.y };
    const centre = { x: abs.x + LEAF.w / 2, y: abs.y + LEAF.h / 2 };
    const target = containerAt(design, centre, subtree(design, node.id));
    if ((target ?? null) === (dn.parent ?? null)) {
      const position = { x: Math.round(node.position.x), y: Math.round(node.position.y) };
      if (position.x !== dn.position?.x || position.y !== dn.position?.y) onEdit((d) => placeFree(updateNode(d, node.id, (n) => ({ ...n, position })), node.id));
      return;
    }
    const verdict = canPlace(reg, target ? design.nodes.find((n) => n.key === target)!.service : null, dn.service, dn.props);
    if (!verdict.ok) return refuse(s.dropRefused, verdict.reason);
    const base = target ? absolute(design, target) : { x: 0, y: 0 };
    const position = { x: Math.max(8, Math.round(abs.x - base.x)), y: Math.max(40, Math.round(abs.y - base.y)) };
    onEdit((d) => placeFree(updateNode(d, node.id, (n) => ({ ...n, parent: target, position })), node.id));
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
        onConnectStart={(_, p) => setConnectFrom(p.nodeId)}
        onConnectEnd={() => setConnectFrom(null)}
        isValidConnection={isValidConnection}
        onNodesDelete={(ns) => onEdit((d) => removeNodes(d, ns.map((n) => n.id)))}
        onEdgesDelete={(es) => onEdit((d) => removeEdges(d, es.map((e) => e.id)))}
        connectionMode={ConnectionMode.Loose}
        fitView
        minZoom={0.2}
        maxZoom={1.6}
        deleteKeyCode={readOnly ? null : ["Backspace", "Delete"]}
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} />
        <Panel position="top-right" className="!m-2">
          <Legend readOnly={readOnly} s={s} hidden={hidden} toggle={toggle} relatedOnly={relatedOnly} setRelatedOnly={setRelatedOnly} untangle={untangle} arrange={() => void arrange()} arranging={arranging} />
        </Panel>
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable style={{ width: 150, height: 96 }} nodeColor={(n) => { const d = n.data as NodeData; return d.container ? `${colorOf(d.service)}33` : colorOf(d.service); }} nodeStrokeWidth={0} maskColor="rgba(120,130,150,0.15)" />
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
