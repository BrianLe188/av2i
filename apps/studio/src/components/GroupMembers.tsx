import { Checkbox } from "@/components/ui/checkbox";
import type { Design } from "@av2i/model";
import type { Registry } from "@av2i/registry";
import { addEdge, removeEdges } from "../logic/design.ts";
import { connect } from "../logic/placement.ts";
import type { Strings } from "../i18n.ts";

/** The subnets of the group's VPC, each with a box: ticking one draws the same line the canvas draws (subnet to group). */
export function GroupMembers({ reg, design, group, s, onEdit }: { reg: Registry; design: Design; group: string; s: Strings; onEdit: (f: (d: Design) => Design) => void }) {
  const node = design.nodes.find((n) => n.key === group);
  const vpc = node?.parent ?? null;
  const subnets = design.nodes.filter((n) => n.service === "subnet" && n.parent === vpc);
  const line = (subnet: string) => design.edges.find((e) => e.mechanism === "containment" && e.from === subnet && e.to === group);
  const chosen = subnets.filter((n) => line(n.key));
  const zones = new Set(chosen.map((n) => n.props.availability_zone).filter((a) => typeof a === "string" && a !== ""));
  const toggle = (subnet: string, on: boolean) => onEdit((d) => {
    if (!on) return removeEdges(d, d.edges.filter((e) => e.mechanism === "containment" && e.from === subnet && e.to === group).map((e) => e.id));
    const v = connect(reg, d, subnet, group);
    return v.ok ? addEdge(d, v.edge) : d;
  });

  return (
    <div className="my-3" data-testid="group-members">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-sm font-semibold">{s.dbg.members}</span>
        <span className="text-xs text-muted-foreground" data-testid="group-summary">{s.dbg.summary.replace("{n}", String(chosen.length)).replace("{z}", String(zones.size))}</span>
      </div>
      <p className="mb-2 text-xs text-muted-foreground">{s.dbg.hint}</p>
      {subnets.length === 0 ? (
        <p className="text-xs text-muted-foreground">{s.dbg.none}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {subnets.map((n) => (
            <li key={n.key}>
              <label className="flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-sm has-[[data-state=checked]]:bg-muted/50">
                <Checkbox checked={!!line(n.key)} onCheckedChange={(v) => toggle(n.key, v === true)} data-testid={`member-${n.key}`} />
                <span className="min-w-0 flex-1 truncate">{n.label}</span>
                <span className="font-mono text-[11px] text-muted-foreground">{String(n.props.availability_zone ?? "—")}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
