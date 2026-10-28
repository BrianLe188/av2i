import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "../api.ts";
import { ApplyBar } from "../components/ApplyPanel.tsx";
import { PlanSummaryCard } from "../components/PlanSummaryCard.tsx";
import { runError } from "../components/runError.ts";
import { commentRequest, getRequest, replanRequest, type RequestDetail } from "../requests.ts";
import { useStrings } from "../prefs.ts";
import { Page } from "./Page.tsx";
import { StatusBadge } from "./RequestsPage.tsx";

/** One request: the plan, the actions, and the talk with its timeline, like a pull request (DD-027). */
export function RequestPage() {
  const s = useStrings();
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [d, setD] = useState<RequestDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setD(await getRequest(id)); } catch (e) { if (e instanceof ApiError && e.status === 404) setGone(true); else setError(runError(e, s)); }
  }, [id, s]);
  useEffect(() => { void load(); }, [load]);

  const fail = useCallback((e: unknown) => setError(runError(e, s)), [s]);
  const comment = async () => {
    setBusy(true);
    try { await commentRequest(id, text.trim()); setText(""); toast(s.req.commented); await load(); } catch (e) { fail(e); } finally { setBusy(false); }
  };

  if (gone) return <Page title={s.req.title}><Alert variant="destructive" role="alert"><AlertDescription data-testid="request-gone">{s.req.notFound}</AlertDescription></Alert></Page>;
  if (!d) return <Page title={s.req.title}>{error ? <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert> : <Loader2 className="animate-spin text-muted-foreground" />}</Page>;

  const r = d.request;
  const open = r.status === "waiting" || r.status === "approved";
  const going = (d.plan?.summary?.resources ?? []).filter((x) => x.actions.includes("delete")).map((x) => x.address);
  const newest = d.newerPlans[0];
  return (
    <Page
      title={`#${r.number} · ${s.req.kindApply}`}
      text={`${r.projectName} · ${s.req.by} ${r.requester} · ${new Date(r.createdAt).toLocaleString()}`}
      actions={<div className="flex items-center gap-2"><span data-testid="request-status"><StatusBadge r={r} /></span>{d.apply.stale.length > 0 && open && <span className="text-xs font-medium text-destructive">{s.req.stale}</span>}<Button variant="ghost" asChild><Link to="/requests"><ArrowLeft />{s.req.back}</Link></Button></div>}
    >
      <div className="grid gap-4">
        {error && <Alert variant="destructive" role="alert"><AlertDescription data-testid="request-error">{error}</AlertDescription></Alert>}

        <Card>
          <CardHeader><CardTitle className="text-base">{s.req.planTitle}</CardTitle></CardHeader>
          <CardContent className="grid gap-3">
            {d.plan?.summary ? <PlanSummaryCard s={s} summary={d.plan.summary} /> : <p className="text-sm text-muted-foreground">{s.req.noPlan}</p>}
            {open && r.planRunId && (
              <ApplyBar
                s={s} planRunId={r.planRunId} projectName={r.projectName} destructive={d.apply.destructive} going={going} blockers={d.apply.blockers.map((b) => b.code)} expiresAt={d.apply.expiresAt}
                request={{ id: r.id, number: r.number, status: r.status, requester: r.requester, decidedBy: r.decidedBy, can: d.can }} canApplyNow={d.can.apply} canRequest={false} replaceable={[]} applyRun={null}
                fail={fail} onChanged={load} onApplyQueued={() => navigate(`/projects/${r.projectId}/design?run=1`)}
              />
            )}
            {!open && <p className="text-sm text-muted-foreground" data-testid="request-closed">{r.status === "applied" ? s.run.appliedDone : s.req.closedText}</p>}
            {open && d.can.replan && newest && (
              <div>
                <Button size="sm" variant="outline" onClick={() => void replanRequest(r.id, newest.id).then(() => { toast(s.req.putInDone); return load(); }).catch(fail)} data-testid="request-replan">{s.req.putIn.replace("{n}", String(r.number))}</Button>
              </div>
            )}
            <div><Button size="sm" variant="ghost" asChild><Link to={`/projects/${r.projectId}`}>{s.req.openProject}</Link></Button></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">{s.req.timeline}</CardTitle></CardHeader>
          <CardContent className="grid gap-3">
            <ol className="grid gap-3" data-testid="timeline">
              {d.events.map((e) => (
                <li key={e.id} className="text-sm" data-testid={`event-${e.kind}`}>
                  <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">{e.actor}</span> {e.kind !== "comment" && (s.req.ev as Record<string, string>)[e.kind]} · {new Date(e.at).toLocaleString()}</p>
                  {e.body && <p className={`mt-1 whitespace-pre-wrap rounded-md border p-2 ${e.kind === "comment" || e.kind === "requested" ? "bg-muted/30" : ""} ${e.kind === "rejected" || e.kind === "apply_failed" ? "border-destructive/40" : ""}`}>{e.body}</p>}
                </li>
              ))}
            </ol>
            <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) void comment(); }}>
              <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={s.req.placeholder} rows={3} data-testid="comment-box" />
              <div><Button type="submit" size="sm" disabled={busy || !text.trim()} data-testid="comment-send">{s.req.comment}</Button></div>
            </form>
          </CardContent>
        </Card>
      </div>
    </Page>
  );
}
