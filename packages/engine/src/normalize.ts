import { slotOfEdge, type SlotId } from "./roles.ts";
import { Graph } from "./graph.ts";
import { certNames, zoneFor } from "./delivery.ts";
import type { Design, NormalizedDesign, NormalizedEdge, NormalizedNode } from "@av2i/model";

function freshKey(taken: Set<string>, base: string): string {
  let key = base;
  for (let i = 2; taken.has(key); i++) key = `${base}_${i}`;
  taken.add(key);
  return key;
}

/**
 * Make every implied node and edge explicit (design README, stage 2). User nodes and edges are copied unchanged; what the
 * engine adds is marked `derived` or `generated` and says why. The function is idempotent on its own output's inputs: the
 * same Design always gives the same result.
 */
export function normalize(design: Design): NormalizedDesign {
  const nodes: NormalizedNode[] = design.nodes.map((n) => ({ ...structuredClone(n), origin: "user" as const }));
  const edges: NormalizedEdge[] = design.edges.map((e) => ({ ...structuredClone(e), origin: "user" as const }));
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const taken = new Set(nodes.map((n) => n.key));

  // containment, igw-attach and nat-placement come from `parent`
  for (const n of design.nodes) {
    if (!n.parent) continue;
    const parent = byKey.get(n.parent);
    if (!parent) continue;
    let mechanism: "containment" | "igw-attach" | "nat-placement" = "containment";
    let from = parent.key;
    let to = n.key;
    if (n.service === "internet-gateway") mechanism = "igw-attach";
    if (n.service === "nat-gateway" && parent.service === "subnet") { mechanism = "nat-placement"; from = n.key; to = parent.key; }
    edges.push({ id: `derived:${mechanism}:${from}:${to}`, mechanism, from, to, origin: "derived", because: n.key });
  }

  // an Elastic IP for every public zonal NAT gateway that has none (decision D-030)
  for (const n of design.nodes) {
    if (n.service !== "nat-gateway") continue;
    const mode = n.props.availability_mode ?? "zonal";
    const type = n.props.connectivity_type ?? "public";
    if (mode !== "zonal" || type !== "public") continue;
    if (edges.some((e) => e.mechanism === "eip-attach" && e.to === n.key)) continue;
    const key = freshKey(taken, `eip_${n.key}`);
    nodes.push({ key, label: `Elastic IP of ${n.label}`, service: "elastic-ip", props: {}, origin: "generated", because: n.key });
    edges.push({ id: `generated:eip-attach:${key}:${n.key}`, mechanism: "eip-attach", from: key, to: n.key, origin: "generated", because: n.key });
  }

  // a role for every consumer whose required slot the design leaves empty (decision D-025)
  for (const n of design.nodes) {
    const slot: SlotId | null = n.service === "lambda" || (n.service === "ecs" && n.props.part === "service") ? "execution" : null;
    if (!slot) continue;
    if (edges.some((e) => e.mechanism === "assume-role" && e.to === n.key && slotOfEdge(n.service, e.props) === slot)) continue;
    const key = freshKey(taken, n.service === "ecs" ? `role_${n.key}_exec` : `role_${n.key}`);
    nodes.push({ key, label: `Role of ${n.label}`, service: "iam-role", props: { name: key.replace(/_/g, "-") }, origin: "generated", because: n.key });
    edges.push({ id: `generated:assume-role:${key}:${n.key}`, mechanism: "assume-role", from: key, to: n.key, props: { slot }, origin: "generated", because: n.key });
  }

  // DNS validation of every certificate: one edge to each hosted zone that holds one of its names (relations/cert-validation.md)
  const g = new Graph({ name: design.name, settings: design.settings, nodes, edges });
  for (const cert of nodes.filter((n) => n.service === "acm")) {
    const zones = new Set(certNames(cert).map((n) => zoneFor(g, n)?.key).filter((k): k is string => !!k));
    for (const z of zones) edges.push({ id: `derived:cert-validation:${cert.key}:${z}`, mechanism: "cert-validation", from: cert.key, to: z, origin: "derived", because: cert.key });
  }

  return { name: design.name, settings: structuredClone(design.settings), nodes, edges };
}
