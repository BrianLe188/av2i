import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Background,
  Controls,
  ConnectionMode,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type NodeChange,
} from '@xyflow/react';
import { resolveEdges, sortNodes, type Issue, type ResourceType } from '@av2i/core';
import { useStore } from '../store';
import { DRAG_MIME } from './Palette';
import { ResourceNode, type ResourceFlowNode } from './ResourceNode';

const nodeTypes = { resource: ResourceNode };

function Flow({ issues }: { issues: Issue[] }) {
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const selectedId = useStore((s) => s.selectedId);
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
      selected: n.id === selectedId,
      // Size lives on the node's own element, not `style`/`width`/`height`: those make React
      // Flow think the node is already measured, so it never registers its handles.
      measured: measured[n.id],
      data: { resource: n, errors: count.get(n.id)?.errors ?? 0, warnings: count.get(n.id)?.warnings ?? 0 },
    }));
  }, [nodes, issues, selectedId, measured]);

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
    for (const c of changes) {
      if (c.type === 'position' && c.position) s.setPosition(c.id, c.position);
      else if (c.type === 'dimensions' && c.dimensions) {
        if (c.setAttributes) s.setSize(c.id, c.dimensions);
        else seen[c.id] = c.dimensions;
      } else if (c.type === 'remove') s.remove(c.id);
    }
    if (Object.keys(seen).length) setMeasured((prev) => ({ ...prev, ...seen }));
    const selects = changes.filter((c) => c.type === 'select');
    const picked = selects.find((c) => c.selected);
    if (picked) s.select(picked.id);
    else if (selects.some((c) => c.id === s.selectedId)) s.select(null);
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
      onNodeDragStop={(_, n) => useStore.getState().endDrag(n.id)}
      onPaneClick={() => {
        useStore.getState().select(null);
        useStore.getState().selectEdge(null);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={onDrop}
      deleteKeyCode={['Backspace', 'Delete']}
      minZoom={0.2}
      maxZoom={1.5}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={20} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}

export function Canvas({ issues }: { issues: Issue[] }) {
  return (
    <main className="canvas">
      <ReactFlowProvider>
        <Flow issues={issues} />
      </ReactFlowProvider>
    </main>
  );
}
