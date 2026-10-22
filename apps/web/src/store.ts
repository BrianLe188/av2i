import { create } from 'zustand';
import {
  absolutePosition,
  addNode,
  alignNodes,
  ancestorsOf,
  autoResize,
  classifyEdge,
  copySelection,
  defaultEdgeProps,
  distributeNodes,
  findContainerAt,
  isDescendant,
  newId,
  pasteFragment,
  removeNode,
  reparent,
  RESOURCES,
  type AlignMode,
  type DistributeAxis,
  type Fragment,
  type GraphEdge,
  type GraphNode,
  type Point,
  type PropValue,
  type ResourceType,
  type Size,
} from '@av2i/core';
import { api, type VersionSummary } from './api';
import { autoLayout } from './layout';
import { toast } from 'sonner';

interface Snapshot {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

interface State extends Snapshot {
  versions: VersionSummary[];
  projectId: string | null;
  name: string;
  region: string;
  /** Secret of the read-only link, when sharing is on. */
  shareToken: string | null;
  /** The one selected node, or null when none or several are selected. */
  selectedId: string | null;
  selectedIds: string[];
  selectedEdgeId: string | null;
  clipboard: Fragment | null;
  past: Snapshot[];
  future: Snapshot[];
  dirty: boolean;
  rev: number;
  saveState: SaveState;
  /** Bumped when a project is loaded so the canvas can re-fit the view. */
  loadedAt: number;

  /** Load a project into the editor. Resolves false when it can't be loaded (missing, not yours). */
  openProject(id: string): Promise<boolean>;
  /** Load a project by share token for the read-only viewer (nothing is ever saved). */
  openShared(token: string): Promise<boolean>;
  setShareToken(token: string | null): void;
  save(): Promise<void>;
  setName(name: string): void;
  setRegion(region: string): void;
  snapshot(label?: string): Promise<void>;
  restore(versionId: string): Promise<void>;

  notify(message: string): void;
  select(id: string | null): void;
  setSelection(ids: string[]): void;
  copy(): void;
  paste(): void;
  duplicate(): void;
  removeMany(ids: string[]): void;
  align(mode: AlignMode): void;
  distribute(axis: DistributeAxis): void;
  /** Re-arrange everything so nothing overlaps (undoable). */
  autoLayout(): Promise<void>;
  selectEdge(id: string | null): void;
  beginChange(coalesceKey?: string): void;
  undo(): void;
  redo(): void;

  addAt(type: ResourceType, point: Point): void;
  addToSelection(type: ResourceType): void;
  setPosition(id: string, position: Point): void;
  setSize(id: string, size: Size): void;
  beginDrag(id: string): void;
  endDrag(ids: string[]): void;
  finishResize(): void;
  fit(id: string): void;
  updateNode(id: string, patch: { name?: string; props?: Record<string, PropValue> }): void;
  remove(id: string): void;
  connect(source: string, target: string): void;
  removeEdge(id: string): void;
  updateEdge(id: string, props: Record<string, PropValue>): void;
}

const HISTORY_LIMIT = 100;

let dragOrigin: Snapshot | null = null;
let lastEdit = { key: '', at: 0 };
let pasteCount = 0;

export const useStore = create<State>((set, get) => {
  /** Apply a content change: bump rev, mark dirty, optionally record undo history. */
  const commit = (patch: Partial<Snapshot>, extra: Partial<State> = {}) =>
    set((s) => ({ ...patch, ...extra, dirty: true, rev: s.rev + 1, saveState: 'idle' }));

  const loadProject = (p: { id: string; name: string; region: string; graph: Snapshot; shareToken?: string | null }) => {
    set({
      projectId: p.id,
      shareToken: p.shareToken ?? null,
      name: p.name,
      region: p.region,
      nodes: p.graph.nodes,
      edges: p.graph.edges,
      selectedId: null,
      selectedIds: [],
      selectedEdgeId: null,
      past: [],
      future: [],
      dirty: false,
      saveState: 'idle',
      loadedAt: Date.now(),
    });
  };

  const refreshVersions = async () => {
    const { projectId } = get();
    set({ versions: projectId ? await api.listVersions(projectId) : [] });
  };

  const guard = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      get().notify(e instanceof Error ? e.message : String(e));
    }
  };

  return {
    nodes: [],
    edges: [],
    versions: [],
    projectId: null,
    name: '',
    region: 'us-east-1',
    shareToken: null,
    selectedId: null,
    selectedIds: [],
    selectedEdgeId: null,
    clipboard: null,
    past: [],
    future: [],
    dirty: false,
    rev: 0,
    saveState: 'idle',
    loadedAt: 0,

    openProject: async (id) => {
      try {
        await get().save();
        loadProject(await api.getProject(id));
        await refreshVersions();
        return true;
      } catch (e) {
        get().notify(e instanceof Error ? e.message : String(e));
        return false;
      }
    },

    openShared: async (token) => {
      try {
        const p = await api.getShared(token);
        set({
          projectId: null,
          shareToken: null,
          name: p.name,
          region: p.region,
          nodes: p.graph.nodes,
          edges: p.graph.edges,
          selectedId: null,
          selectedIds: [],
          selectedEdgeId: null,
          past: [],
          future: [],
          versions: [],
          dirty: false,
          saveState: 'idle',
          loadedAt: Date.now(),
        });
        return true;
      } catch {
        return false;
      }
    },

    setShareToken: (shareToken) => set({ shareToken }),

    save: async () => {
      const { projectId, dirty, name, region, nodes, edges, rev } = get();
      if (!projectId || !dirty) return;
      set({ saveState: 'saving' });
      try {
        await api.updateProject(projectId, { name, region, graph: { nodes, edges } });
        // Edits made while the request was in flight stay dirty for the next save.
        set((s) => ({ saveState: 'saved', dirty: s.rev !== rev }));
      } catch (e) {
        set({ saveState: 'error' });
        get().notify(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },

    setName: (name) => commit({}, { name }),
    setRegion: (region) => commit({}, { region }),

    snapshot: (label) =>
      guard(async () => {
        const { projectId } = get();
        if (!projectId) return;
        await get().save();
        await api.snapshot(projectId, label);
        await refreshVersions();
        get().notify('Snapshot saved');
      }),

    restore: (versionId) =>
      guard(async () => {
        const { projectId } = get();
        if (!projectId) return;
        await get().save();
        loadProject(await api.restore(projectId, versionId));
        await refreshVersions();
        get().notify('Version restored (previous state kept as a snapshot)');
      }),

    notify: (message) => {
      toast(message);
    },

    select: (id) => get().setSelection(id ? [id] : []),
    setSelection: (ids) =>
      set({
        selectedIds: ids,
        selectedId: ids.length === 1 ? ids[0] : null,
        selectedEdgeId: ids.length ? null : get().selectedEdgeId,
      }),
    selectEdge: (id) =>
      set({ selectedEdgeId: id, ...(id ? { selectedId: null, selectedIds: [] } : {}) }),

    copy: () => {
      const { nodes, edges, selectedIds } = get();
      if (selectedIds.length === 0) return;
      const clipboard = copySelection({ nodes, edges }, selectedIds);
      set({ clipboard });
      pasteCount = 0;
      get().notify(`Copied ${clipboard.nodes.length} resource${clipboard.nodes.length === 1 ? '' : 's'}`);
    },

    paste: () => {
      const { nodes, edges, clipboard } = get();
      if (!clipboard) return;
      pasteCount++;
      const result = pasteFragment({ nodes, edges }, clipboard, { x: 40 * pasteCount, y: 40 * pasteCount });
      if (result.skipped) {
        get().notify(`${result.skipped} resource${result.skipped === 1 ? '' : 's'} not pasted: the container no longer exists.`);
      }
      if (result.newIds.length === 0) return;
      get().beginChange();
      commit({ nodes: result.graph.nodes, edges: result.graph.edges });
      get().setSelection(result.newIds);
    },

    duplicate: () => {
      get().copy();
      get().paste();
    },

    removeMany: (ids) => {
      const { nodes, edges } = get();
      const present = ids.filter((id) => nodes.some((n) => n.id === id));
      if (present.length === 0) return;
      get().beginChange();
      let graph = { nodes, edges };
      for (const id of present) graph = removeNode(graph, id);
      const { selectedEdgeId } = get();
      commit(graph, {
        selectedId: null,
        selectedIds: [],
        selectedEdgeId: graph.edges.some((e) => e.id === selectedEdgeId) ? selectedEdgeId : null,
      });
    },

    align: (mode) => {
      const { nodes, selectedIds } = get();
      const next = alignNodes(nodes, selectedIds, mode);
      if (!next) return get().notify('Align needs two or more resources inside the same container.');
      get().beginChange();
      commit({ nodes: next });
    },

    distribute: (axis) => {
      const { nodes, selectedIds } = get();
      const next = distributeNodes(nodes, selectedIds, axis);
      if (!next) return get().notify('Distribute needs three or more resources inside the same container.');
      get().beginChange();
      commit({ nodes: next });
    },

    autoLayout: async () => {
      const { nodes, edges } = get();
      if (nodes.length === 0) return;
      try {
        const next = await autoLayout({ nodes, edges });
        get().beginChange();
        commit({ nodes: next });
        set({ loadedAt: Date.now() });
      } catch (e) {
        get().notify(`Auto layout failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },

    beginChange: (coalesceKey) => {
      const now = Date.now();
      if (coalesceKey && lastEdit.key === coalesceKey && now - lastEdit.at < 1000) {
        lastEdit.at = now;
        return;
      }
      lastEdit = { key: coalesceKey ?? '', at: now };
      set((s) => ({
        past: [...s.past, { nodes: s.nodes, edges: s.edges }].slice(-HISTORY_LIMIT),
        future: [],
      }));
    },

    undo: () => {
      const { past, nodes, edges, future } = get();
      const prev = past[past.length - 1];
      if (!prev) return;
      lastEdit = { key: '', at: 0 };
      commit(
        { nodes: prev.nodes, edges: prev.edges },
        { past: past.slice(0, -1), future: [...future, { nodes, edges }] },
      );
    },

    redo: () => {
      const { past, nodes, edges, future } = get();
      const next = future[future.length - 1];
      if (!next) return;
      lastEdit = { key: '', at: 0 };
      commit(
        { nodes: next.nodes, edges: next.edges },
        { future: future.slice(0, -1), past: [...past, { nodes, edges }] },
      );
    },

    addAt: (type, point) => {
      const { nodes, region } = get();
      const def = RESOURCES[type];
      const container = def.parents.length ? findContainerAt(nodes, point, type) : undefined;
      if (def.parents.length && !container) {
        const where = def.parents.map((p) => RESOURCES[p].label).join(' / ');
        get().notify(`${def.label} must be dropped inside a ${where}.`);
        return;
      }
      const topLeft = { x: point.x - def.defaultSize.width / 2, y: point.y - 20 };
      const base = container ? absolutePosition(nodes, container.id) : { x: 0, y: 0 };
      get().beginChange();
      const result = addNode(nodes, type, {
        parentId: container?.id,
        position: { x: topLeft.x - base.x, y: topLeft.y - base.y },
        region,
      });
      commit({ nodes: result.nodes }, { selectedId: result.node.id });
    },

    addToSelection: (type) => {
      const { nodes, selectedId, region } = get();
      const def = RESOURCES[type];
      let parentId: string | undefined;
      if (def.parents.length) {
        const chain = selectedId ? [selectedId, ...ancestorsOf(nodes, selectedId)] : [];
        parentId = chain.find((id) => def.parents.includes(nodes.find((n) => n.id === id)!.type));
        if (!parentId) {
          const where = def.parents.map((p) => RESOURCES[p].label).join(' / ');
          get().notify(`Select a ${where} first, or drag ${def.label} onto one.`);
          return;
        }
      }
      get().beginChange();
      const result = addNode(nodes, type, { parentId, region });
      commit({ nodes: result.nodes }, { selectedId: result.node.id });
    },

    // Live updates while dragging/resizing: no history entry, history starts in beginDrag/onResizeStart.
    setPosition: (id, position) =>
      commit({ nodes: get().nodes.map((n) => (n.id === id ? { ...n, position } : n)) }),

    setSize: (id, size) =>
      commit({ nodes: get().nodes.map((n) => (n.id === id ? { ...n, size } : n)) }),

    beginDrag: (id) => {
      const { nodes, edges } = get();
      dragOrigin = { nodes, edges };
      get().beginChange();
      // Dragging a node that's part of a multi-selection keeps the selection.
      if (!get().selectedIds.includes(id)) get().setSelection([id]);
    },

    endDrag: (ids) => {
      const origin = dragOrigin;
      dragOrigin = null;
      // A node dragged together with its container just rides along; only the outermost ones can change parent.
      const movers = ids.filter((id) => !ids.some((other) => other !== id && isDescendant(get().nodes, id, other)));

      let next = get().nodes;
      const fit: string[] = [];
      for (const id of movers) {
        const node = next.find((n) => n.id === id);
        if (!node) continue;
        const def = RESOURCES[node.type];
        if (!def.parents.length) continue;
        const abs = absolutePosition(next, id);
        const center = { x: abs.x + node.size.width / 2, y: abs.y + node.size.height / 2 };
        const container = findContainerAt(next, center, node.type, id);
        if (!container) {
          // Dropped outside any valid parent: put everything back where it was.
          if (origin) {
            set((s) => ({ past: s.past.slice(0, -1) }));
            commit({ nodes: origin.nodes, edges: origin.edges });
          }
          const where = def.parents.map((p) => RESOURCES[p].label).join(' / ');
          get().notify(`${def.label} must stay inside a ${where}.`);
          return;
        }
        if (container.id !== node.parentId) {
          next = reparent(next, id, container.id, abs);
          if (node.parentId) fit.push(node.parentId);
        }
      }
      commit({ nodes: autoResize(next, { fit, anchorId: ids[0] }) });
    },

    finishResize: () =>
      commit({ nodes: autoResize(get().nodes, { anchorId: get().selectedId ?? undefined }) }),

    fit: (id) => {
      get().beginChange();
      commit({ nodes: autoResize(get().nodes, { fit: [id], anchorId: id }) });
    },

    updateNode: (id, patch) => {
      get().beginChange(`edit:${id}`);
      commit({
        nodes: get().nodes.map((n) =>
          n.id === id
            ? {
                ...n,
                name: patch.name ?? n.name,
                props: patch.props ? { ...n.props, ...patch.props } : n.props,
              }
            : n,
        ),
      });
    },

    remove: (id) => get().removeMany([id]),

    connect: (source, target) => {
      const { nodes, edges } = get();
      if (source === target) return;
      const candidate = { id: newId(), source, target };
      const resolved = classifyEdge(nodes, candidate);
      if (resolved.problem) {
        get().notify(resolved.problem);
        return;
      }
      const duplicate = edges.some((e) => {
        const r = classifyEdge(nodes, e);
        return r.kind === resolved.kind && r.from?.id === resolved.from?.id && r.to?.id === resolved.to?.id;
      });
      if (duplicate) {
        get().notify('These two are already connected.');
        return;
      }
      get().beginChange();
      commit(
        { edges: [...edges, { ...candidate, props: defaultEdgeProps(resolved.kind) }] },
        { selectedEdgeId: candidate.id, selectedId: null },
      );
    },

    removeEdge: (id) => {
      get().beginChange();
      commit(
        { edges: get().edges.filter((e) => e.id !== id) },
        { selectedEdgeId: get().selectedEdgeId === id ? null : get().selectedEdgeId },
      );
    },

    updateEdge: (id, props) => {
      get().beginChange(`edge:${id}`);
      commit({ edges: get().edges.map((e) => (e.id === id ? { ...e, props: { ...e.props, ...props } } : e)) });
    },
  };
});
