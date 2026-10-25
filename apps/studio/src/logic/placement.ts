import type { Registry } from "@av2i/registry";
import type { Design, Edge, Props } from "@av2i/model";

type Text = { vi: string; en: string };
export type Verdict<T = object> = ({ ok: true } & T) | { ok: false; reason: Text };

/** Mechanisms a user draws as an edge; the others come from nesting or from the engine. */
export const DRAWN = ["route", "route-association", "sg-attach", "eip-attach", "image-source", "network-access", "assume-role", "grant", "db-subnet-group", "containment", "listener-target", "cert-attach", "dns-alias", "origin", "resource-policy"] as const;
const PLACEMENT = ["containment", "igw-attach", "nat-placement"];
/** Where an undirected mechanism starts: the owner of the relation. */
const SOURCE_FIRST = ["route-table", "security-group", "elastic-ip", "iam-role", "ecr", "acm", "route53", "cloudfront", "alb"];
/** Services that may sit in several subnets, and the DB subnet group, which is made of them: a subnet connected to one by a containment line adds a subnet. */
const SPANS = ["ecs", "lambda", "alb", "db-subnet-group"];

export const CONTAINERS = ["vpc", "subnet"];

const usable = (v: string | undefined) => v === "valid" || v === "conditional";

export function cell(reg: Registry, from: string, to: string) {
  return reg.matrix.pairs.find((p) => p.from === from && p.to === to);
}

/** Services the palette offers: those the registry has a service file and a placement for. */
export function paletteServices(reg: Registry, ids: readonly string[]): string[] {
  return ids.filter((id) => reg.services[id]);
}

/** An ECS cluster is regional, so it sits outside any subnet; an ECS service needs one. */
const isRoot = (reg: Registry, service: string, props?: Props) =>
  (service === "ecs" ? props?.part === "cluster" : ((reg.services[service]?.placement?.requires as string[] | undefined) ?? []).length === 0);

/** May a node of `child` be placed inside a node of `parent` (null: at the top level)? */
export function canPlace(reg: Registry, parent: string | null, child: string, props?: Props): Verdict {
  if (parent === null) {
    return isRoot(reg, child, props)
      ? { ok: true }
      : { ok: false, reason: { vi: `${title(reg, child, "vi")} phải nằm trong một container (${requires(reg, child)}).`, en: `${title(reg, child, "en")} must sit inside a container (${requires(reg, child)}).` } };
  }
  const cells = [cell(reg, parent, child), cell(reg, child, parent)];
  if (cells.some((c) => c && PLACEMENT.includes(c.mechanism) && usable(c.value))) return { ok: true };
  return {
    ok: false,
    reason: { vi: `${title(reg, child, "vi")} không đặt được trong ${title(reg, parent, "vi")}.`, en: `${title(reg, child, "en")} cannot be placed in ${title(reg, parent, "en")}.` },
  };
}

const requires = (reg: Registry, s: string) => ((reg.services[s]?.placement?.requires as string[]) ?? []).join(", ");

export function title(reg: Registry, service: string, lang: "vi" | "en"): string {
  return (reg.services[service]?.title?.[lang] as string | undefined) ?? service;
}

/** The first container of the design where `child` may go, preferring the selected one. */
export function findParent(reg: Registry, design: Design, child: string, prefer?: string | null, props?: Props): string | null | undefined {
  if (isRoot(reg, child, props)) return null;
  const candidates = [...(prefer ? design.nodes.filter((n) => n.key === prefer) : []), ...design.nodes.filter((n) => CONTAINERS.includes(n.service))];
  return candidates.find((n) => canPlace(reg, n.service, child, props).ok)?.key;
}

/** Default destination of a route to a gateway; endpoints add their own route. */
export function defaultEdgeProps(mechanism: string, targetService: string): Props | undefined {
  if (mechanism === "route" && targetService !== "vpc-endpoint-s3") return { destination_cidr_block: "0.0.0.0/0" };
  return undefined;
}

function edgeId(design: Design, from: string, to: string): string {
  let id = `e_${from}_${to}`;
  for (let i = 2; design.edges.some((e) => e.id === id); i++) id = `e_${from}_${to}_${i}`;
  return id;
}

/** May a connection be drawn between two nodes, and if so which edge is it? */
export function connect(reg: Registry, design: Design, a: string, b: string): Verdict<{ edge: Edge }> {
  const na = design.nodes.find((n) => n.key === a);
  const nb = design.nodes.find((n) => n.key === b);
  if (!na || !nb || a === b) return { ok: false, reason: { vi: "Không nối được node này.", en: "These nodes cannot be connected." } };
  const options = [
    { from: na, to: nb, c: cell(reg, na.service, nb.service) },
    { from: nb, to: na, c: cell(reg, nb.service, na.service) },
  ].filter((o) => o.c && usable(o.c.value) && (DRAWN as readonly string[]).includes(o.c.mechanism) && (o.c.mechanism !== "containment" || SPANS.includes(o.to.service)));
  if (!options.length) {
    return {
      ok: false,
      reason: { vi: `${title(reg, na.service, "vi")} và ${title(reg, nb.service, "vi")} không nối với nhau được.`, en: `${title(reg, na.service, "en")} and ${title(reg, nb.service, "en")} cannot be connected.` },
    };
  }
  const pick = options.find((o) => SOURCE_FIRST.includes(o.from.service)) ?? options[0]!;
  const mechanism = pick.c!.mechanism;
  if (design.edges.some((e) => e.mechanism === mechanism && e.from === pick.from.key && e.to === pick.to.key)) {
    return { ok: false, reason: { vi: "Hai node này đã được nối.", en: "These nodes are already connected." } };
  }
  const props = defaultEdgeProps(mechanism, pick.to.service);
  return { ok: true, edge: { id: edgeId(design, pick.from.key, pick.to.key), mechanism: mechanism as Edge["mechanism"], from: pick.from.key, to: pick.to.key, ...(props ? { props } : {}) } };
}
