import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Play } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ApiError } from "../api.ts";
import type { Strings } from "../i18n.ts";
import { cancelRun, getRun, listRuns, queuePlan, runLogs, type RunRow } from "../projects.ts";
import { describe } from "./auth/errors.ts";

const LIVE = new Set(["queued", "running"]);
const fill = (t: string, v: { add: number; change: number; destroy: number; replace: number }) => t.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k as keyof typeof v] ?? 0));

/** Runs OpenTofu plan for the project and follows the run: status, what the plan would do, and the log as it grows. */
export function RunDialog({ s, projectId, open, onClose, beforeRun }: { s: Strings; projectId: string; open: boolean; onClose: () => void; beforeRun: () => Promise<unknown> }) {
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const last = useRef(0);
  const end = useRef<HTMLDivElement>(null);

  const fail = useCallback((e: unknown) => setError(e instanceof ApiError && (s.run.errors as Record<string, string>)[e.code] ? (s.run.errors as Record<string, string>)[e.code]! : describe(e, s)), [s]);

  const refresh = useCallback(async () => {
    try {
      const l = await listRuns(projectId);
      setRuns(l);
      setCurrent((c) => c ?? l[0]?.id ?? null);
    } catch (e) { fail(e); }
  }, [projectId, fail]);
  useEffect(() => { if (open) { setError(null); setCurrent(null); void refresh(); } }, [open, refresh]);

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

  const run = runs.find((r) => r.id === current) ?? null;
  const sum = run?.summary ?? null;
  const tone = (st: RunRow["status"]) => (st === "succeeded" ? "default" : st === "failed" ? "destructive" : "secondary");

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-3xl" data-testid="run-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Play className="size-4" />{s.run.title}</DialogTitle>
          <DialogDescription>{s.run.text}</DialogDescription>
        </DialogHeader>
        {error && <Alert variant="destructive"><AlertDescription data-testid="run-error">{error}</AlertDescription></Alert>}
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => void start()} disabled={busy} data-testid="run-start">{busy ? <Loader2 className="animate-spin" /> : <Play />}{busy ? s.run.starting : s.run.start}</Button>
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
        <div className="min-h-0 flex-1">
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
