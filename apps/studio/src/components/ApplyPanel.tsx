import { useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { Strings } from "../i18n.ts";
import { applyRun, approveRun, dismissRescue, listRescues, restoreRescue, rescueDownloadUrl, withdrawApproval, type PlanSummary, type RescueRow, type RunDetail } from "../projects.ts";

const fill = (t: string, v: Record<string, string>) => t.replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? "");

/** What stands between a plan and its apply, who approved it, and the button (with a confirmation, and the typed name when it deletes). */
export function ApplyPanel({ s, detail, me, projectName, onChanged, onApplyQueued, onReplan, onOpen, fail }: {
  s: Strings; detail: RunDetail; me: string; projectName: string;
  onChanged: () => Promise<void>; onApplyQueued: (id: string) => void; onReplan: () => void; onOpen: (runId: string) => void; fail: (e: unknown) => void;
}) {
  const [asking, setAsking] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const { apply, can, run } = detail;
  if (!apply || !can) return null;

  const blockers = apply.blockers.map((b) => b.code);
  const waiting = blockers.filter((c) => c !== "not_approved");
  const stale = waiting.some((c) => ["plan_expired", "design_changed", "variables_changed", "connection_changed", "state_changed"].includes(c));
  const myApproval = apply.approvals.some((a) => a.username === me);
  const planner = run.createdBy;
  const summary = run.summary as PlanSummary | null;
  const going = (summary?.resources ?? []).filter((r) => r.actions.includes("delete"));
  const destructiveClosed = apply.destructive && !can.applyDestructive;
  const canPress = can.apply && !destructiveClosed && blockers.length === 0;

  const act = async (job: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try { await job(); if (done) toast(done); await onChanged(); } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const press = async () => {
    setBusy(true);
    try { const r = await applyRun(detail.run.id, apply.destructive ? typed : undefined); setAsking(false); setTyped(""); onApplyQueued(r.id); } catch (e) { setAsking(false); fail(e); await onChanged(); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-2 rounded-md border p-3 text-sm" data-testid="apply-panel">
      <p className="font-medium">{s.run.applyTitle}</p>
      {apply.applyRun ? (
        <div className="flex items-center gap-2">
          <span>{apply.applyRun.status === "succeeded" ? s.run.appliedDone : s.run.applyingNow}</span>
          <Button size="sm" variant="outline" onClick={() => onOpen(apply.applyRun!.id)} data-testid="apply-view">{s.run.viewApply}</Button>
        </div>
      ) : (
        <>
          {apply.expiresAt && <p className="text-xs text-muted-foreground">{fill(s.run.expires, { t: new Date(apply.expiresAt).toLocaleString() })}</p>}
          {going.length > 0 && (
            <div className="rounded border border-destructive/40 p-2" data-testid="apply-destructive">
              <p className="flex items-center gap-1 text-xs font-medium text-destructive"><AlertTriangle className="size-3.5" />{s.run.destructiveBox}</p>
              <ul className="mt-1 font-mono text-xs text-destructive">{going.map((r) => <li key={r.address}>{r.address}</li>)}</ul>
            </div>
          )}
          {apply.needsApproval && (
            <p className="text-xs" data-testid="apply-approvals">{s.run.needsTwo} {apply.approvals.length ? fill(s.run.approvedBy, { n: apply.approvals.map((a) => a.username).join(", ") }) : s.run.noApproval}</p>
          )}
          {waiting.length > 0 && <ul className="list-disc pl-5 text-xs text-destructive" data-testid="apply-blockers">{waiting.map((c) => <li key={c}>{(s.run.blockers as Record<string, string>)[c] ?? c}</li>)}</ul>}
          {destructiveClosed && <p className="text-xs text-destructive">{s.run.noDestructive}</p>}
          {!can.apply && <p className="text-xs text-muted-foreground">{s.run.noApplyRight}</p>}
          <div className="flex flex-wrap items-center gap-2">
            {apply.needsApproval && can.approve && !myApproval && planner !== me && <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(() => approveRun(run.id))} data-testid="apply-approve">{s.run.approveBtn}</Button>}
            {myApproval && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act(() => withdrawApproval(run.id))} data-testid="apply-withdraw">{s.run.withdrawBtn}</Button>}
            <Button size="sm" variant={apply.destructive ? "destructive" : "default"} disabled={busy || !canPress} onClick={() => setAsking(true)} data-testid="apply-button">
              {busy && <Loader2 className="animate-spin" />}{apply.needsApproval ? s.run.applyBtn : s.run.approveApplyBtn}
            </Button>
            {stale && <Button size="sm" variant="outline" onClick={onReplan} data-testid="apply-replan">{s.run.replanBtn}</Button>}
          </div>
        </>
      )}
      <Dialog open={asking} onOpenChange={(o) => { if (!o) { setAsking(false); setTyped(""); } }}>
        <DialogContent className="sm:max-w-md" data-testid="apply-confirm">
          <DialogHeader><DialogTitle>{s.run.confirmTitle}</DialogTitle><DialogDescription>{s.run.confirmText}</DialogDescription></DialogHeader>
          {apply.destructive && (
            <div className="grid gap-1.5">
              <p className="text-xs">{fill(s.run.confirmType, { n: projectName })}</p>
              <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" data-testid="apply-confirm-name" />
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAsking(false)}>{s.adm.cancel}</Button>
            <Button variant={apply.destructive ? "destructive" : "default"} disabled={busy || (apply.destructive && typed !== projectName)} onClick={() => void press()} data-testid="apply-confirm-go">{s.run.applyBtn}</Button>
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
