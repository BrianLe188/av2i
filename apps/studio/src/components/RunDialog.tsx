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
import { cancelRun, getRun, listRuns, listVariables, preflight, queuePlan, removeVariable, runLogs, setVariable, type Preflight, type RunRow, type VariableRow } from "../projects.ts";
import { describe } from "./auth/errors.ts";

const LIVE = new Set(["queued", "running"]);
const fill = (t: string, v: { add: number; change: number; destroy: number; replace: number }) => t.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k as keyof typeof v] ?? 0));

/** Runs OpenTofu plan for the project and follows the run: status, what the plan would do, and the log as it grows. */
export function RunDialog({ s, projectId, open, onClose, beforeRun, canSetVariables }: { s: Strings; projectId: string; open: boolean; onClose: () => void; beforeRun: () => Promise<unknown>; canSetVariables: boolean }) {
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pre, setPre] = useState<Preflight | null>(null);
  const [vars, setVars] = useState<VariableRow[] | null>(null);
  const last = useRef(0);
  const end = useRef<HTMLDivElement>(null);

  const fail = useCallback((e: unknown) => setError(e instanceof ApiError && (s.run.errors as Record<string, string>)[e.code] ? (s.run.errors as Record<string, string>)[e.code]! : describe(e, s)), [s]);

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
  useEffect(() => { if (open) { setError(null); setCurrent(null); setPre(null); void refresh(); void preflight(projectId).then(setPre).catch(fail); void loadVars(); } }, [open, refresh, projectId, fail, loadVars]);

  // follow the chosen run: new log lines and its status every second while it is waiting or running
  useEffect(() => {
    if (!open || !current) return;
    last.current = 0;
    setLines([]);
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const [r, l] = await Promise.all([getRun(current), runLogs(current, last.current)]);
        if (stop) return;
        if (l.lines.length) { last.current = l.lines[l.lines.length - 1]!.seq; setLines((x) => [...x, ...l.lines.map((y) => y.line)]); }
        setRuns((x) => x.map((y) => (y.id === r.id ? r : y)));
        if (!l.done || LIVE.has(r.status)) timer = setTimeout(() => void tick(), 1000);
      } catch (e) { if (!stop) fail(e); }
    };
    void tick();
    return () => { stop = true; clearTimeout(timer); };
  }, [open, current, fail]);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [lines]);

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

  const ready = !!pre && pre.key && pre.tofu.ok && pre.identity.ok && !!vars && vars.every((v) => v.set);
  const run = runs.find((r) => r.id === current) ?? null;
  const sum = run?.summary ?? null;
  const tone = (st: RunRow["status"]) => (st === "succeeded" ? "default" : st === "failed" ? "destructive" : "secondary");

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl" data-testid="run-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Play className="size-4" />{s.run.title}</DialogTitle>
          <DialogDescription>{s.run.text}</DialogDescription>
        </DialogHeader>
        {error && <Alert variant="destructive"><AlertDescription data-testid="run-error">{error}</AlertDescription></Alert>}
        <Checks s={s} pre={pre} />
        {vars && vars.length > 0 && <Variables s={s} projectId={projectId} vars={vars} can={canSetVariables} onChanged={loadVars} fail={fail} />}
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => void start()} disabled={busy || !ready} title={ready ? undefined : s.run.ready} data-testid="run-start">{busy ? <Loader2 className="animate-spin" /> : <Play />}{busy ? s.run.starting : s.run.start}</Button>
          {run && <Badge variant={tone(run.status)} data-testid="run-status">{s.run.status[run.status]}</Badge>}
          {run?.status === "queued" && <Button size="sm" variant="ghost" onClick={() => void cancel(run.id)}>{s.run.cancel}</Button>}
        </div>
        {sum && (
          <div className="rounded-md border p-3 text-sm" data-testid="run-summary">
            {sum.resources.length === 0 ? s.run.noChanges : fill(s.run.summary, sum)}
            {sum.destructive && <p className="mt-1 font-medium text-destructive">{s.run.destructive}</p>}
            {sum.resources.length > 0 && (
              <ul className="mt-2 max-h-32 space-y-0.5 overflow-y-auto font-mono text-xs">
                {sum.resources.map((r) => (
                  <li key={r.address}><span className={r.actions.includes("delete") ? "text-destructive" : "text-muted-foreground"}>{r.actions.map((a) => (s.run.actions as Record<string, string>)[a] ?? a).join(" + ")}</span> {r.address}</li>
                ))}
              </ul>
            )}
          </div>
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
    pre.identity.ok
      ? { ok: true, text: s.run.idOk.replace("{arn}", pre.identity.arn), detail: `${s.run.account} ${pre.identity.account}` }
      : { ok: false, text: pre.identity.reason === "none" ? s.run.idNone : s.run.idError, ...(pre.identity.reason === "error" ? { detail: pre.identity.message } : {}) },
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
