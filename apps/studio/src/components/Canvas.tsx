import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background, ConnectionMode, Controls, Handle, MiniMap, Position, ReactFlow, ReactFlowProvider, useEdgesState, useNodesState, useReactFlow,
  type Connection, type Node as RFNode, type NodeProps,
} from "@xyflow/react";
import type { Design } from "@av2i/model";
import { paletteItem, reg } from "../registry.ts";
import type { Analysis } from "../logic/analyze.ts";
import { addEdge, removeEdges, removeNodes, subtree, updateNode } from "../logic/design.ts";
import { buildFlow, type EdgeData, type NodeData, type Selection } from "../logic/flow.ts";
import { absolute, containerAt, LEAF } from "../logic/layout.ts";
import { canPlace, connect } from "../logic/placement.ts";
import type { Lang, Strings } from "../i18n.ts";
import { DRAG_TYPE } from "./Palette.tsx";

function ResourceNode({ data }: NodeProps<RFNode<NodeData>>) {
  const cls = ["rnode", data.container ? "container" : "leaf", data.generated ? "generated" : "", data.focused ? "focused" : "", data.severity ? `sev-${data.severity}` : ""].join(" ");
  return (
    <div className={cls} data-svc={data.service} data-testid={`node-${data.label}`}>
      <Handle type="source" position={Position.Left} id="l" />
      <Handle type="source" position={Position.Top} id="t" />
      <Handle type="source" position={Position.Bottom} id="b" />
      <div className="rhead">
        <span className="rtitle">{data.label}</span>
        {data.severity && <span className={`badge sev-${data.severity}`} title={data.severity} />}
      </div>
      <div className="rsub">{data.serviceTitle.replace(/ \(.*$/, "")}{data.detail ? ` · ${data.detail}` : ""}</div>
      <Handle type="source" position={Position.Right} id="r" />
    </div>
  );
}

const nodeTypes = { resource: ResourceNode };

interface Props {
  design: Design;
  analysis: Analysis;
  selection: Selection;
  focus: ReadonlySet<string>;
  lang: Lang;
  s: Strings;
  loadId: number;
  onSelect: (sel: Selection) => void;
  onEdit: (f: (d: Design) => Design) => void;
  onAdd: (service: string, parent: string | null, position?: { x: number; y: number }) => void;
  onToast: (message: string) => void;
}

function Flow({ design, analysis, selection, focus, lang, s, loadId, onSelect, onEdit, onAdd, onToast }: Props) {
  const flow = useMemo(() => buildFlow(reg, design, analysis, selection, focus, lang, s), [design, analysis, selection, focus, lang, s]);
  const [nodes, setNodes, onNodesChange] = useNodesState<RFNode<NodeData>>(flow.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(flow.edges);
  const [resync, setResync] = useState(0);
  const rf = useReactFlow();

  useEffect(() => {
    setNodes((prev) => flow.nodes.map((n) => ({ ...n, measured: prev.find((p) => p.id === n.id)?.measured })));
    setEdges(flow.edges);
  }, [flow, resync, setNodes, setEdges]);

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
    <div className="canvas" onDragOver={(e) => { if (e.dataTransfer.types.includes(DRAG_TYPE)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } }} onDrop={onDrop}>
      <ReactFlow<RFNode<NodeData>, import("@xyflow/react").Edge<EdgeData>>
        key={loadId}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
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
