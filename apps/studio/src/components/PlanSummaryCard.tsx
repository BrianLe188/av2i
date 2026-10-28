import type { Strings } from "../i18n.ts";
import type { PlanSummary } from "../projects.ts";

const fill = (t: string, v: { add: number; change: number; destroy: number; replace: number }) => t.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k as keyof typeof v] ?? 0));

/** What a plan will do, with the resources it touches: the same card in the dialog and in a request. */
export function PlanSummaryCard({ s, summary }: { s: Strings; summary: PlanSummary }) {
  return (
    <div className="rounded-md border p-3 text-sm" data-testid="run-summary">
      {summary.resources.length === 0 ? s.run.noChanges : fill(s.run.summary, summary)}
      {summary.destructive && <p className="mt-1 font-medium text-destructive">{s.run.destructive}</p>}
      {summary.resources.length > 0 && (
        <ul className="mt-2 max-h-32 space-y-0.5 overflow-y-auto font-mono text-xs">
          {summary.resources.map((r) => (
            <li key={r.address}><span className={r.actions.includes("delete") ? "text-destructive" : "text-muted-foreground"}>{r.actions.map((a) => (s.run.actions as Record<string, string>)[a] ?? a).join(" + ")}</span> {r.address}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
