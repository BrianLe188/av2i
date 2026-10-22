import { useCallback, useEffect, useMemo, useState } from 'react';
import { toPng } from 'html-to-image';
import {
  Background,
  Controls,
  ConnectionMode,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type NodeChange,
} from '@xyflow/react';
import { absolutePosition, resolveEdges, sortNodes, type Issue, type ResourceType } from '@av2i/core';
import { useStore } from '../store';
import { DRAG_MIME } from './Palette';
import { ResourceNode, TYPE_COLORS, type ResourceFlowNode } from './ResourceNode';

const nodeTypes = { resource: ResourceNode };

/** Renders the diagram (nodes and edges, not the controls) to a PNG and downloads it. */
async function exportPng() {
  const s = useStore.getState();
  if (s.nodes.length === 0) return s.notify('Nothing to export yet.');
  const viewport = document.querySelector<HTMLElement>('.react-flow__viewport');
  const flow = document.querySelector<HTMLElement>('.react-flow');
  if (!viewport || !flow) return;
  const boxes = s.nodes.map((n) => ({ ...absolutePosition(s.nodes, n.id), w: n.size.width, h: n.size.height }));
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const pad = 40;
  const width = Math.ceil(Math.max(...boxes.map((b) => b.x + b.w)) - x + pad * 2);
  const height = Math.ceil(Math.max(...boxes.map((b) => b.y + b.h)) - y + pad * 2);
  try {
    const url = await toPng(viewport, {
      width,
      height,
      pixelRatio: 2,
      backgroundColor: getComputedStyle(flow).backgroundColor,
      style: { width: `${width}px`, height: `${height}px`, transform: `translate(${pad - x}px, ${pad - y}px) scale(1)` },
    });
    const a = document.createElement('a');
    a.href = url;
    a.download = `${s.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'diagram'}.png`;
    a.click();
  } catch (e) {
    s.notify(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function Flow({ issues, readOnly }: { issues: Issue[]; readOnly: boolean }) {
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const selectedIds = useStore((s) => s.selectedIds);
  const selectedEdgeId = useStore((s) => s.selectedEdgeId);
  const loadedAt = useStore((s) => s.loadedAt);
  const { screenToFlowPosition, fitView } = useReactFlow();
  // React Flow's measurements (needed for handle positions, hence edges). Controlled nodes must
  // hand them back on every render, or each update throws the measurements away.
  const [measured, setMeasured] = useState<Record<string, { width: number; height: number }>>({});

  const flowNodes = useMemo<ResourceFlowNode[]>(() => {
    const count = new Map<string, { errors: number; warnings: number }>();
    for (const i of issues) {
      const c = count.get(i.nodeId) ?? { errors: 0, warnings: 0 };
      if (i.severity === 'error') c.errors++;
      else c.warnings++;
      count.set(i.nodeId, c);
    }
    return sortNodes(nodes).map((n) => ({
      id: n.id,
      type: 'resource',
      position: n.position,
      parentId: n.parentId,
      selected: selectedIds.includes(n.id),
      // Size lives on the node's own element, not `style`/`width`/`height`: those make React
      // Flow think the node is already measured, so it never registers its handles.
      measured: measured[n.id],
      data: { resource: n, errors: count.get(n.id)?.errors ?? 0, warnings: count.get(n.id)?.warnings ?? 0 },
    }));
  }, [nodes, issues, selectedIds, measured]);

  const flowEdges = useMemo<Edge[]>(
    () =>
      resolveEdges({ nodes, edges }).map((r) => ({
        id: r.edge.id,
        source: r.edge.source,
        target: r.edge.target,
        type: 'smoothstep',
        label: r.problem ? '\u26a0 invalid' : r.label,
        selected: r.edge.id === selectedEdgeId,
        className: r.problem ? 'edge-bad' : `edge-${r.kind}`,
      })),
    [nodes, edges, selectedEdgeId],
  );

  useEffect(() => {
    const t = setTimeout(() => void fitView({ padding: 0.2, maxZoom: 1 }), 50);
    return () => clearTimeout(t);
  }, [loadedAt, fitView]);

  const onNodesChange = useCallback((changes: NodeChange<ResourceFlowNode>[]) => {
    const s = useStore.getState();
    const seen: Record<string, { width: number; height: number }> = {};
    const removed: string[] = [];
    for (const c of changes) {
      if (c.type === 'position' && c.position) s.setPosition(c.id, c.position);
      else if (c.type === 'dimensions' && c.dimensions) {
        if (c.setAttributes) s.setSize(c.id, c.dimensions);
        else seen[c.id] = c.dimensions;
      } else if (c.type === 'remove') removed.push(c.id);
    }
    if (removed.length) s.removeMany(removed);
    if (Object.keys(seen).length) setMeasured((prev) => ({ ...prev, ...seen }));
    const selects = changes.filter((c) => c.type === 'select');
    if (selects.length) {
      const next = new Set(s.selectedIds);
      for (const c of selects) {
        if (c.selected) next.add(c.id);
        else next.delete(c.id);
      }
      if (next.size !== s.selectedIds.length || [...next].some((id) => !s.selectedIds.includes(id))) {
        s.setSelection([...next]);
      }
    }
  }, []);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const type = e.dataTransfer.getData(DRAG_MIME) as ResourceType;
    if (!type) return;
    useStore.getState().addAt(type, screenToFlowPosition({ x: e.clientX, y: e.clientY }));
  };

  return (
    <ReactFlow
      nodes={flowNodes}
      edges={flowEdges}
      nodeTypes={nodeTypes}
      connectionMode={ConnectionMode.Loose}
      onNodesChange={onNodesChange}
      onEdgesChange={(changes) => {
        const s = useStore.getState();
        for (const c of changes) if (c.type === 'remove') s.removeEdge(c.id);
        const selects = changes.filter((c) => c.type === 'select');
        const picked = selects.find((c) => c.selected);
        if (picked) s.selectEdge(picked.id);
        else if (selects.some((c) => c.id === s.selectedEdgeId)) s.selectEdge(null);
      }}
      onConnect={(c) => useStore.getState().connect(c.source, c.target)}
      onNodeDragStart={(_, n) => useStore.getState().beginDrag(n.id)}
      onNodeDragStop={(_, n, dragged) => useStore.getState().endDrag(dragged.length ? dragged.map((d) => d.id) : [n.id])}
      onPaneClick={() => {
        useStore.getState().select(null);
        useStore.getState().selectEdge(null);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={onDrop}
      deleteKeyCode={readOnly ? null : ['Backspace', 'Delete']}
      nodesDraggable={!readOnly}
      nodesConnectable={!readOnly}
      minZoom={0.2}
      maxZoom={1.5}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={20} />
      <Controls showInteractive={false} />
      <MiniMap
        pannable
        zoomable
        nodeColor={(n) => {
          const type = (n.data as ResourceFlowNode['data']).resource.type;
          // Containers are drawn pale so the resources inside them stay visible.
          return type === 'vpc' ? '#e9e2fb' : type === 'subnet' ? '#dbe7fc' : TYPE_COLORS[type];
        }}
        nodeStrokeWidth={2}
      />
      <Panel position="top-right">
        <button onClick={() => void exportPng()} title="Download the diagram as a PNG">
          Export PNG
        </button>
      </Panel>
    </ReactFlow>
  );
}

export function Canvas({ issues, readOnly = false }: { issues: Issue[]; readOnly?: boolean }) {
  return (
    <main className="canvas">
      <ReactFlowProvider>
        <Flow issues={issues} readOnly={readOnly} />
      </ReactFlowProvider>
    </main>
  );
}
