import { useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Strings } from "../i18n.ts";
import { applyRun as applyPlan, dismissRescue, listRescues, restoreRescue, rescueDownloadUrl, type RequestCan, type RequestStatus, type RescueRow, type RunRow } from "../projects.ts";
import { approveRequest, rejectRequest, replanRequest, sendRequest, withdrawRequest } from "../requests.ts";

const fill = (t: string, v: Record<string, string>) => t.replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? "");

export interface BarRequest { id: string; number: number; status: RequestStatus; requester: string; decidedBy: string | null; can: RequestCan }

/**
 * What comes next for a plan: send it for approval, decide a request, apply. The same bar sits in the plan dialog and in a request (DD-027),
 * so a person sees the same state and the same buttons in both. The server checks every action again.
 */
export function ApplyBar({ s, planRunId, projectName, destructive, going, blockers, expiresAt, request, canApplyNow, canRequest, replaceable, applyRun, onChanged, onApplyQueued, onReplan, onOpenRequest, onOpenApply, fail }: {
  s: Strings; planRunId: string; projectName: string; destructive: boolean; going: string[]; blockers: string[]; expiresAt: string | null;
  request: BarRequest | null; canApplyNow: boolean; canRequest: boolean; replaceable: { id: string; number: number }[];
  applyRun: { id: string; status: RunRow["status"] } | null;
  onChanged: () => Promise<void>; onApplyQueued: (id: string) => void; onReplan?: () => void; onOpenRequest?: (id: string) => void; onOpenApply?: (runId: string) => void; fail: (e: unknown) => void;
}) {
  const [dialog, setDialog] = useState<"apply" | "send" | "reject" | null>(null);
  const [typed, setTyped] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const stale = blockers.some((c) => ["plan_expired", "design_changed", "variables_changed", "connection_changed", "state_changed"].includes(c));
  const close = () => { setDialog(null); setTyped(""); setText(""); };
  const act = async (job: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try { await job(); if (done) toast(done); close(); await onChanged(); } catch (e) { close(); fail(e); await onChanged(); } finally { setBusy(false); }
  };
  const press = async () => {
    setBusy(true);
    try { const r = await applyPlan(planRunId, destructive ? typed : undefined); close(); onApplyQueued(r.id); } catch (e) { close(); fail(e); await onChanged(); } finally { setBusy(false); }
  };
  const canApply = canApplyNow && blockers.length === 0 && (!request || request.status === "approved" || request.status === "applied" || request.can.apply);
  const live = request && (request.status === "waiting" || request.status === "approved");

  return (
    <div className="space-y-2 rounded-md border p-3 text-sm" data-testid="apply-panel">
      <p className="font-medium">{s.run.applyTitle}</p>
      {applyRun ? (
        <div className="flex items-center gap-2">
          <span>{applyRun.status === "succeeded" ? s.run.appliedDone : s.run.applyingNow}</span>
          {onOpenApply && <Button size="sm" variant="outline" onClick={() => onOpenApply(applyRun.id)} data-testid="apply-view">{s.run.viewApply}</Button>}
        </div>
      ) : (
        <>
          {expiresAt && <p className="text-xs text-muted-foreground">{fill(s.run.expires, { t: new Date(expiresAt).toLocaleString() })}</p>}
          {going.length > 0 && (
            <div className="rounded border border-destructive/40 p-2" data-testid="apply-destructive">
              <p className="flex items-center gap-1 text-xs font-medium text-destructive"><AlertTriangle className="size-3.5" />{s.run.destructiveBox}</p>
              <ul className="mt-1 font-mono text-xs text-destructive">{going.map((r) => <li key={r}>{r}</li>)}</ul>
            </div>
          )}
          {request?.status === "waiting" && <p className="text-xs" data-testid="request-state">{fill(s.req.waitingText, { n: String(request.number), u: request.requester })}</p>}
          {request?.status === "approved" && <p className="text-xs" data-testid="request-state">{fill(s.req.approvedText, { u: request.decidedBy ?? "" })}</p>}
          {request?.can.approveBlocked && <p className="text-xs text-destructive">{s.req.approveBlocked}</p>}
          {blockers.length > 0 && <ul className="list-disc pl-5 text-xs text-destructive" data-testid="apply-blockers">{blockers.map((c) => <li key={c}>{(s.run.blockers as Record<string, string>)[c] ?? c}</li>)}</ul>}
          {stale && live && <p className="text-xs">{s.req.staleText}</p>}
          <div className="flex flex-wrap items-center gap-2">
            {request?.can.approve && <Button size="sm" disabled={busy} onClick={() => void act(() => approveRequest(request.id), s.req.approvedToast)} data-testid="request-approve">{s.req.approve}</Button>}
            {request?.can.reject && <Button size="sm" variant="outline" disabled={busy} onClick={() => setDialog("reject")} data-testid="request-reject">{s.req.reject}</Button>}
            {request?.can.withdraw && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act(() => withdrawRequest(request.id), s.req.withdrawnToast)} data-testid="request-withdraw">{s.req.withdraw}</Button>}
            {canApplyNow && <Button size="sm" variant={destructive ? "destructive" : "default"} disabled={busy || !canApply} onClick={() => setDialog("apply")} data-testid="apply-button">{busy && <Loader2 className="animate-spin" />}{s.run.applyBtn}</Button>}
            {!request && canRequest && <Button size="sm" disabled={busy || blockers.length > 0} onClick={() => setDialog("send")} data-testid="request-send">{s.req.send}</Button>}
            {replaceable.map((r) => <Button key={r.id} size="sm" variant="outline" disabled={busy} onClick={() => void act(() => replanRequest(r.id, planRunId), s.req.putInDone)} data-testid="request-putin">{fill(s.req.putIn, { n: String(r.number) })}</Button>)}
            {request && live && onOpenRequest && <Button size="sm" variant="ghost" onClick={() => onOpenRequest(request.id)} data-testid="request-open">{fill(s.req.openRequest, { n: String(request.number) })}</Button>}
            {stale && onReplan && <Button size="sm" variant="outline" onClick={onReplan} data-testid="apply-replan">{s.run.replanBtn}</Button>}
          </div>
        </>
      )}

      <Dialog open={dialog === "apply"} onOpenChange={(o) => !o && close()}>
        <DialogContent className="sm:max-w-md" data-testid="apply-confirm">
          <DialogHeader><DialogTitle>{s.run.confirmTitle}</DialogTitle><DialogDescription>{s.run.confirmText}</DialogDescription></DialogHeader>
          {destructive && (
            <div className="grid gap-1.5">
              <p className="text-xs">{fill(s.run.confirmType, { n: projectName })}</p>
              <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" data-testid="apply-confirm-name" />
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={close}>{s.adm.cancel}</Button>
            <Button variant={destructive ? "destructive" : "default"} disabled={busy || (destructive && typed !== projectName)} onClick={() => void press()} data-testid="apply-confirm-go">{s.run.applyBtn}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "send"} onOpenChange={(o) => !o && close()}>
        <DialogContent className="sm:max-w-md" data-testid="request-send-dialog">
          <DialogHeader><DialogTitle>{s.req.sendTitle}</DialogTitle><DialogDescription>{s.req.sendText}</DialogDescription></DialogHeader>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={s.req.note} rows={4} data-testid="request-note" />
          <DialogFooter>
            <Button variant="ghost" onClick={close}>{s.adm.cancel}</Button>
            <Button disabled={busy} onClick={() => void act(() => sendRequest(planRunId, text.trim() || undefined), s.req.sent)} data-testid="request-send-go">{s.req.sendGo}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "reject"} onOpenChange={(o) => !o && close()}>
        <DialogContent className="sm:max-w-md" data-testid="request-reject-dialog">
          <DialogHeader><DialogTitle>{s.req.rejectTitle}</DialogTitle><DialogDescription>{s.req.rejectText}</DialogDescription></DialogHeader>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={s.req.reason} rows={4} data-testid="request-reason" />
          <DialogFooter>
            <Button variant="ghost" onClick={close}>{s.adm.cancel}</Button>
            <Button variant="destructive" disabled={busy || !text.trim()} onClick={() => request && void act(() => rejectRequest(request.id, text.trim()), s.req.rejectedToast)} data-testid="request-reject-go">{s.req.reject}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** An apply created resources but its state was not saved: the project is locked until a person restores, downloads or dismisses it. */
export function RescueBanner({ s, projectId, projectName, onChanged, fail }: { s: Strings; projectId: string; projectName: string; onChanged: () => Promise<void>; fail: (e: unknown) => void }) {
  const [rows, setRows] = useState<RescueRow[] | null>(null);
  const [dismissing, setDismissing] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const load = async () => { try { setRows((await listRescues(projectId)).filter((r) => !r.resolvedAt)); } catch { setRows([]); } };
  useEffect(() => { void load(); }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps
  const done = async (job: () => Promise<unknown>, msg: string) => { try { await job(); toast(msg); setDismissing(null); setTyped(""); await load(); await onChanged(); } catch (e) { fail(e); } };
  return (
    <Alert variant="destructive" data-testid="rescue-banner">
      <AlertTriangle />
      <AlertDescription className="space-y-2">
        <p className="font-medium">{s.run.rescue.title}</p>
        <p className="text-xs">{s.run.rescue.text}</p>
        {(rows ?? []).map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-2 text-xs">
            <span>{new Date(r.createdAt).toLocaleString()} · {fill(s.run.rescue.serial, { n: String(r.serial) })}</span>
            <Button size="sm" variant="outline" onClick={() => void done(() => restoreRescue(r.id), s.run.rescue.restored)} data-testid="rescue-restore">{s.run.rescue.restore}</Button>
            <Button size="sm" variant="outline" asChild><a href={rescueDownloadUrl(r.id)} data-testid="rescue-download">{s.run.rescue.download}</a></Button>
            <Button size="sm" variant="ghost" onClick={() => setDismissing(r.id)} data-testid="rescue-dismiss">{s.run.rescue.dismiss}</Button>
            {dismissing === r.id && (
              <span className="flex w-full items-center gap-2">
                <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={fill(s.run.rescue.dismissType, { n: projectName })} className="h-8 flex-1" data-testid="rescue-dismiss-name" />
                <Button size="sm" variant="destructive" disabled={typed !== projectName} onClick={() => void done(() => dismissRescue(r.id, typed), s.run.rescue.dismissed)} data-testid="rescue-dismiss-go">{s.run.rescue.dismiss}</Button>
              </span>
            )}
          </div>
        ))}
      </AlertDescription>
    </Alert>
  );
}
