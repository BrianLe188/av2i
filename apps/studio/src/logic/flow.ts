import type { Registry } from "@av2i/registry";
import type { Design, Finding, Node as DNode } from "@av2i/model";
import type { Edge as RFEdge, Node as RFNode } from "@xyflow/react";
import type { Analysis } from "./analyze.ts";
import { worstByNode } from "./analyze.ts";
import { absolute, isContainer, LEAF, sizeOf } from "./layout.ts";
import { DRAWN, title } from "./placement.ts";
import type { Lang } from "../i18n.ts";

export interface NodeData extends Record<string, unknown> {
  label: string;
  service: string;
  serviceTitle: string;
  container: boolean;
  severity?: Finding["severity"];
  generated: boolean;
  focused: boolean;
  detail?: string;
}

export interface EdgeData extends Record<string, unknown> {
  mechanism: string;
  generated: boolean;
}

export type Selection = { kind: "node" | "edge"; id: string } | null;

/** Design nodes plus the nodes the engine added, each with a position so the canvas can draw them. */
function visualDesign(design: Design, analysis: Analysis): { visual: Design; generated: Set<string> } {
  const generated = new Set<string>();
  const nodes: DNode[] = [...design.nodes];
  const edges = analysis.normalized?.edges ?? [];
  for (const n of analysis.normalized?.nodes ?? []) {
    if (n.origin === "user" || design.nodes.some((d) => d.key === n.key)) continue;
    const anchor = design.nodes.find((d) => d.key === n.because);
    generated.add(n.key);
    if (n.service === "iam-role") {
      // roles are not in a subnet: stack the derived ones in a column to the right of everything
      const right = Math.max(0, ...design.nodes.filter((d) => !d.parent).map((d) => (absolute(design, d.key).x + sizeOf(design, d.key).w)));
      const index = [...generated].filter((k) => nodes.find((x) => x.key === k)?.service === "iam-role").length;
      nodes.push({ ...n, parent: null, position: { x: right + 60, y: 40 + index * (LEAF.h + 24) } });
      continue;
    }
    const base = anchor?.position ?? { x: 24, y: 44 };
    nodes.push({ ...n, parent: anchor?.parent ?? n.parent ?? null, position: { x: base.x, y: base.y + LEAF.h + 24 } });
  }
  return { visual: { ...design, nodes }, generated };
}

const edgeLabel = (mech: string, props: Record<string, unknown> | undefined, s: { mech: Record<string, string> }) => {
  const dest = props?.destination_cidr_block;
  if (mech === "route" && typeof dest === "string") return dest;
  const detail = mech === "grant" ? props?.level : mech === "assume-role" ? props?.slot : mech === "network-access" ? props?.port : undefined;
  return detail === undefined ? (s.mech[mech] ?? mech) : `${s.mech[mech] ?? mech} · ${String(detail)}`;
};

export function buildFlow(
  reg: Registry, design: Design, analysis: Analysis, selection: Selection, focus: ReadonlySet<string>, lang: Lang,
  s: { mech: Record<string, string> },
): { nodes: RFNode<NodeData>[]; edges: RFEdge<EdgeData>[] } {
  const { visual, generated } = visualDesign(design, analysis);
  const severity = worstByNode(analysis.findings);
  const depth = (n: DNode) => { let d = 0; for (let p = n.parent; p; p = visual.nodes.find((v) => v.key === p)?.parent) d++; return d; };
  const ordered = [...visual.nodes].sort((a, b) => depth(a) - depth(b));
  const pos = new Map(visual.nodes.filter((n) => n.position).map((n) => [n.key, n.position!]));

  const nodes = ordered.map((n): RFNode<NodeData> => {
    const container = isContainer(n.service);
    const size = sizeOf(visual, n.key, pos);
    const isGenerated = generated.has(n.key);
    const parentExists = n.parent && visual.nodes.some((v) => v.key === n.parent);
    return {
      id: n.key,
      type: "resource",
      position: n.position ?? absolute(visual, n.key),
      ...(parentExists ? { parentId: n.parent! } : {}),
      ...(container ? { style: { width: size.w, height: size.h }, zIndex: depth(n) } : { zIndex: 10 }),
      selected: selection?.kind === "node" && selection.id === n.key,
      draggable: !isGenerated,
      deletable: !isGenerated,
      data: {
        label: n.label,
        service: n.service,
        serviceTitle: title(reg, n.service, lang),
        container,
        severity: severity.get(n.key),
        generated: isGenerated,
        focused: focus.has(n.key),
        detail: detailOf(n),
      },
    };
  });

  const ids = new Set(nodes.map((n) => n.id));
  const centre = (k: string) => {
    const a = absolute(visual, k);
    const z = sizeOf(visual, k, pos);
    return { x: a.x + z.w / 2, y: a.y + z.h / 2 };
  };
  /** Leave and enter through the sides that face each other. */
  const handles = (from: string, to: string) => {
    const a = centre(from), b = centre(to);
    const dx = b.x - a.x, dy = b.y - a.y;
    if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? { sourceHandle: "r", targetHandle: "l" } : { sourceHandle: "l", targetHandle: "r" };
    return dy >= 0 ? { sourceHandle: "b", targetHandle: "t" } : { sourceHandle: "t", targetHandle: "b" };
  };
  const edges: RFEdge<EdgeData>[] = [];
  const seen = new Set<string>();
  for (const e of design.edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) continue;
    seen.add(e.id);
    edges.push({
      id: e.id, source: e.from, target: e.to, ...handles(e.from, e.to), label: edgeLabel(e.mechanism, e.props, s), type: "smoothstep",
      selected: selection?.kind === "edge" && selection.id === e.id,
      data: { mechanism: e.mechanism, generated: false },
    });
  }
  for (const e of analysis.normalized?.edges ?? []) {
    if (e.origin !== "generated" || seen.has(e.id) || !(DRAWN as readonly string[]).includes(e.mechanism) || !ids.has(e.from) || !ids.has(e.to)) continue;
    edges.push({
      id: e.id, source: e.from, target: e.to, ...handles(e.from, e.to), label: s.mech[e.mechanism] ?? e.mechanism, type: "smoothstep", deletable: false,
      selected: selection?.kind === "edge" && selection.id === e.id,
      data: { mechanism: e.mechanism, generated: true },
    });
  }
  return { nodes, edges };
}

/** One short line under the label: the most telling property of the service. */
function detailOf(n: DNode): string | undefined {
  const p = n.props;
  const pick = (k: string) => (typeof p[k] === "string" && p[k] !== "" ? String(p[k]) : undefined);
  return pick("cidr_block") ?? pick("instance_type") ?? pick("name") ?? pick("bucket") ?? pick("function_name") ?? pick("engine");
}
