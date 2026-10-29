import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, Play, X } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ApiError } from "../api.ts";
import type { Strings } from "../i18n.ts";
import { Input } from "@/components/ui/input";
import { cancelRun, getRun, listRuns, listVariables, preflight, queuePlan, removeVariable, runLogs, setVariable, type AppliedSummary, type Preflight, type PlanSummary, type RunDetail, type RunRow, type VariableRow } from "../projects.ts";
import { ApplyBar, RescueBanner } from "./ApplyPanel.tsx";
import { PlanSummaryCard } from "./PlanSummaryCard.tsx";
import { runError } from "./runError.ts";
import { useNavigate } from "react-router";
import { describe } from "./auth/errors.ts";

const LIVE = new Set(["queued", "running"]);
/** Runs OpenTofu plan for the project and follows the run: status, what the plan would do, and the log as it grows. */
export function RunDialog({ s, projectId, projectName, open, onClose, beforeRun, canSetVariables, canPlan }: { s: Strings; projectId: string; projectName: string; open: boolean; onClose: () => void; beforeRun: () => Promise<unknown>; canSetVariables: boolean; canPlan: boolean }) {
  const navigate = useNavigate();
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pre, setPre] = useState<Preflight | null>(null);
  const [vars, setVars] = useState<VariableRow[] | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const last = useRef(0);
  const end = useRef<HTMLDivElement>(null);

  const fail = useCallback((e: unknown) => setError(runError(e, s)), [s]);

  const loadVars = useCallback(async () => {
    try { setVars(await listVariables(projectId)); } catch (e) { fail(e); }
  }, [projectId, fail]);

  const refresh = useCallback(async () => {
    try {
      const l = await listRuns(projectId);
      setRuns(l);
      setCurrent((c) => c ?? l[0]?.id ?? null);
    } catch (e) { fail(e); }
  }, [projectId, fail]);
  useEffect(() => { if (open) { setError(null); setCurrent(null); setPre(null); void refresh(); void preflight(projectId).then(setPre).catch(fail); if (canPlan) void loadVars(); } }, [open, refresh, projectId, fail, loadVars, canPlan]);

  // follow the chosen run: new log lines and its status every second while it is waiting or running
  useEffect(() => {
    if (!open || !current) return;
    last.current = 0;
    setLines([]);
    setDetail(null);
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const [d, l] = await Promise.all([getRun(current), runLogs(current, last.current)]);
        if (stop) return;
        const r = d.run;
        setDetail(d);
        if (l.lines.length) { last.current = l.lines[l.lines.length - 1]!.seq; setLines((x) => [...x, ...l.lines.map((y) => y.line)]); }
        setRuns((x) => x.map((y) => (y.id === r.id ? r : y)));
        if (!l.done || LIVE.has(r.status)) timer = setTimeout(() => void tick(), 1000);
      } catch (e) { if (!stop) fail(e); }
    };
    void tick();
    return () => { stop = true; clearTimeout(timer); };
  }, [open, current, fail]);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [lines]);

  /** the plan's apply state again (someone approved, the design changed, an apply began) */
  const reloadDetail = useCallback(async () => {
    if (!current) return;
    try { const d = await getRun(current); setDetail(d); setRuns((x) => x.map((y) => (y.id === d.run.id ? d.run : y))); setPre(await preflight(projectId)); } catch (e) { fail(e); }
  }, [current, projectId, fail]);
  const applyQueued = async (id: string) => { await refresh(); setCurrent(id); };

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      await beforeRun();
      const r = await queuePlan(projectId);
      setRuns((x) => [r, ...x]);
      setCurrent(r.id);
    } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const cancel = async (id: string) => {
    try { const r = await cancelRun(id); setRuns((x) => x.map((y) => (y.id === id ? r : y))); toast(s.run.status.cancelled); } catch (e) { fail(e); }
  };

  const ready = !!pre && pre.key && pre.tofu.ok && pre.identity.ok && !pre.rescuePending && !!vars && vars.every((v) => v.set);
  const run = runs.find((r) => r.id === current) ?? null;
  const sum = run?.kind === "plan" ? (run.summary as PlanSummary | null) : null;
  const done = run?.kind === "apply" ? (run.summary as AppliedSummary | null) : null;
  const tone = (st: RunRow["status"]) => (st === "succeeded" ? "default" : st === "failed" || st === "interrupted" ? "destructive" : "secondary");

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl" data-testid="run-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Play className="size-4" />{s.run.title}</DialogTitle>
          <DialogDescription>{s.run.text}</DialogDescription>
        </DialogHeader>
        {error && <Alert variant="destructive"><AlertDescription data-testid="run-error">{error}</AlertDescription></Alert>}
        <ConnectionRow s={s} pre={pre} projectId={projectId} />
        {pre?.rescuePending && <RescueBanner s={s} projectId={projectId} projectName={projectName} fail={fail} onChanged={async () => { setPre(await preflight(projectId)); await reloadDetail(); }} />}
        {canPlan && <Checks s={s} pre={pre} />}
        {canPlan && vars && vars.length > 0 && <Variables s={s} projectId={projectId} vars={vars} can={canSetVariables} onChanged={loadVars} fail={fail} />}
        <div className="flex items-center gap-2">
          {canPlan && <Button size="sm" onClick={() => void start()} disabled={busy || !ready} title={ready ? undefined : s.run.ready} data-testid="run-start">{busy ? <Loader2 className="animate-spin" /> : <Play />}{busy ? s.run.starting : s.run.start}</Button>}
          {run && <Badge variant={tone(run.status)} data-testid="run-status">{s.run.status[run.status]}</Badge>}
          {run?.status === "queued" && <Button size="sm" variant="ghost" onClick={() => void cancel(run.id)}>{s.run.cancel}</Button>}
        </div>
        {sum && <PlanSummaryCard s={s} summary={sum} />}
        {done && <p className="rounded-md border p-3 text-sm" data-testid="run-applied">{s.run.appliedSummary.replace("{added}", String(done.added)).replace("{changed}", String(done.changed)).replace("{destroyed}", String(done.destroyed))}</p>}
        {run && detail && detail.run.id === run.id && run.kind === "plan" && run.status === "succeeded" && detail.apply && detail.can && (
          <ApplyBar
            s={s} planRunId={run.id} projectName={projectName} destructive={detail.apply.destructive} going={((run.summary as PlanSummary | null)?.resources ?? []).filter((r) => r.actions.includes("delete")).map((r) => r.address)}
            blockers={detail.apply.blockers.map((b) => b.code)} expiresAt={detail.apply.expiresAt} request={detail.request ?? null} canApplyNow={detail.can.applyNow} canRequest={detail.can.request}
            replaceable={detail.replaceable ?? []} applyRun={detail.apply.applyRun} fail={fail} onChanged={reloadDetail} onApplyQueued={(id) => void applyQueued(id)} onReplan={() => void start()}
            onOpenRequest={(id) => navigate(`/requests/${id}`)} onOpenApply={setCurrent}
          />
        )}
        {run?.error && <p className="text-sm text-destructive">{run.error}</p>}
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">{s.run.logs}</p>
          <ScrollArea className="h-56 rounded-md border bg-muted/40 [&_[data-slot=scroll-area-viewport]>div]:!block">
            <pre className="p-3 font-mono text-xs leading-5 whitespace-pre-wrap break-all" data-testid="run-log">{lines.length ? lines.join("\n") : s.run.noLogs}</pre>
            <div ref={end} />
          </ScrollArea>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">{s.run.history}</p>
          {runs.length === 0 ? <p className="text-sm text-muted-foreground">{s.run.none}</p> : (
            <ul className="max-h-28 space-y-1 overflow-y-auto text-sm">
              {runs.map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => setCurrent(r.id)} className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-muted ${r.id === current ? "bg-muted" : ""}`}>
                    <Badge variant={tone(r.status)}>{s.run.status[r.status]}</Badge>
                    <Badge variant="outline">{r.kind === "migrate" ? s.st.moveKind : r.kind === "apply" ? s.run.kindApply : s.run.kindPlan}</Badge>
                    <span>{new Date(r.createdAt).toLocaleString()}</span>
                    {r.createdBy && <span className="text-muted-foreground">{s.run.by} {r.createdBy}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The conditions a run needs, each with what to do when it is not met. */
function Checks({ s, pre }: { s: Strings; pre: Preflight | null }) {
  if (!pre) return <p className="text-xs text-muted-foreground" data-testid="run-checking">{s.run.checking}</p>;
  const rows: { ok: boolean; text: string; detail?: string }[] = [
    { ok: pre.key, text: pre.key ? s.run.keyOk : s.run.keyMissing },
    pre.tofu.ok ? { ok: true, text: s.run.tofuOk.replace("{v}", pre.tofu.version) } : { ok: false, text: s.run.tofuMissing, detail: pre.tofu.message },
    identityRow(s, pre.identity),
  ];
  return (
    <ul className="space-y-1 rounded-md border p-2 text-xs" data-testid="run-checks">
      {rows.map((r, i) => (
        <li key={i} className="flex items-start gap-2">
          {r.ok ? <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-600" /> : <X className="mt-0.5 size-3.5 shrink-0 text-destructive" />}
          <span className={r.ok ? "" : "text-destructive"}>{r.text}{r.detail && <span className="block break-all text-muted-foreground">{r.detail}</span>}</span>
        </li>
      ))}
      <li className="pl-5 text-muted-foreground">{s.run.limit.replace("{m}", String(pre.timeoutMinutes))}</li>
    </ul>
  );
}

/** The values a design asks for. Write-only: a saved value is shown as set, never read back. */
function Variables({ s, projectId, vars, can, onChanged, fail }: { s: Strings; projectId: string; vars: VariableRow[]; can: boolean; onChanged: () => Promise<void>; fail: (e: unknown) => void }) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const save = async (name: string) => {
    try { await setVariable(projectId, name, draft[name] ?? ""); setDraft((d) => ({ ...d, [name]: "" })); toast(s.run.varSaved); await onChanged(); } catch (e) { fail(e); }
  };
  const remove = async (name: string) => {
    try { await removeVariable(projectId, name); toast(s.run.varRemoved); await onChanged(); } catch (e) { fail(e); }
  };
  return (
    <div className="space-y-2 rounded-md border p-2 text-xs" data-testid="run-vars">
      <p className="font-medium">{s.run.vars}</p>
      <p className="text-muted-foreground">{s.run.varsText} {s.run.varNote}</p>
      {vars.map((v) => (
        <div key={v.name} className="space-y-1">
          <div className="flex items-center gap-2">
            <code className="font-mono">{v.name}</code>
            <span className="text-muted-foreground">{s.run.varNode.replace("{n}", v.node)}</span>
            <Badge variant={v.set ? "default" : "destructive"}>{v.set ? s.run.varSet : s.run.varMissing}</Badge>
            {v.set && can && <Button size="sm" variant="ghost" onClick={() => void remove(v.name)} data-testid={`var-remove-${v.name}`}>{s.run.varRemove}</Button>}
          </div>
          {can ? (
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void save(v.name); }}>
              <Input type={v.sensitive ? "password" : "text"} autoComplete="new-password" placeholder={s.run.varValue} value={draft[v.name] ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [v.name]: e.target.value }))} className="h-8 flex-1" data-testid={`var-input-${v.name}`} />
              <Button size="sm" type="submit" disabled={!(draft[v.name] ?? "")} data-testid={`var-save-${v.name}`}>{s.run.varSave}</Button>
            </form>
          ) : !v.set && <p className="text-muted-foreground">{s.run.varNoRight}</p>}
        </div>
      ))}
    </div>
  );
}

function identityRow(s: Strings, id: Preflight["identity"]): { ok: boolean; text: string; detail?: string } {
  if (id.ok) {
    return id.via === "role"
      ? { ok: true, text: s.run.idRole.replace("{r}", id.roleArn ?? ""), detail: `${s.run.account} ${id.account} · ${id.arn}` }
      : { ok: true, text: s.run.idServer.replace("{arn}", id.arn), detail: `${s.run.account} ${id.account}` };
  }
  if (id.reason === "no_connection") return { ok: false, text: s.run.idNoConn };
  if (id.reason === "forbidden") return { ok: false, text: s.run.idForbidden };
  if (id.reason === "none") return { ok: false, text: s.run.idNone };
  const hint = (s.conn.hint as Record<string, string>)[id.reason];
  return { ok: false, text: hint ?? s.run.idError, detail: id.message };
}

/** The AWS connection the runs of this project use. It is chosen on the project page (DD-028); here it is shown, with the way there. */
function ConnectionRow({ s, pre, projectId }: { s: Strings; pre: Preflight | null; projectId: string }) {
  const navigate = useNavigate();
  return (
    <div className="flex items-center gap-2 text-xs" data-testid="run-connection">
      <span className="font-medium">{s.conn.choose}</span>
      <Badge variant="outline" data-testid="run-connection-name">{pre?.connection?.name ?? s.conn.chooseNone}</Badge>
      <Button type="button" size="sm" variant="ghost" onClick={() => navigate(`/projects/${projectId}`)} data-testid="run-connection-change">{s.pd.overview}</Button>
    </div>
  );
}
