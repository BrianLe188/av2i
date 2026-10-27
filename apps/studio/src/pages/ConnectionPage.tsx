import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ArrowLeft, Copy, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "../api.ts";
import { connError } from "../components/connError.ts";
import { deleteConnection, getConnection, testConnection, updateConnection, type ConnectionDetail, type TestSide } from "../connections.ts";
import type { Strings } from "../i18n.ts";
import { useStrings } from "../prefs.ts";
import { Page } from "./Page.tsx";

function Copyable({ s, text, testid }: { s: Strings; text: string; testid?: string }) {
  return (
    <div className="relative">
      <pre className="max-h-56 overflow-auto rounded-md border bg-muted/40 p-3 pr-12 font-mono text-xs leading-5 whitespace-pre-wrap break-all" data-testid={testid}>{text}</pre>
      <Button type="button" size="icon-sm" variant="ghost" className="absolute right-1 top-1" aria-label={s.conn.copy} title={s.conn.copy}
        onClick={() => void navigator.clipboard.writeText(text).then(() => toast(s.conn.copied)).catch(() => {})}><Copy /></Button>
    </div>
  );
}

function Side({ s, label, side }: { s: Strings; label: string; side: TestSide }) {
  return (
    <li className="space-y-0.5" data-testid={`test-${label}`}>
      <div className="flex items-center gap-2"><span className="font-medium">{label}</span><Badge variant={side.ok ? "default" : "destructive"}>{side.ok ? s.conn.ok : "×"}</Badge></div>
      {side.ok ? <p className="text-xs text-muted-foreground">{s.conn.assumedAs} {side.arn} · {s.conn.inAccount} {side.account}</p>
        : <p className="text-xs text-destructive">{(s.conn.hint as Record<string, string>)[side.code ?? "other"]} <span className="text-muted-foreground">{side.message}</span></p>}
    </li>
  );
}

/** One connection: its roles, the guide for the AWS side, the test, and the projects that use it. */
export function ConnectionPage() {
  const s = useStrings();
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [d, setD] = useState<ConnectionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", description: "", planRoleArn: "", applyRoleArn: "" });
  const [testing, setTesting] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await getConnection(id);
      setD(r);
      setForm({ name: r.connection.name, description: r.connection.description, planRoleArn: r.connection.planRoleArn, applyRoleArn: r.connection.applyRoleArn ?? "" });
    } catch (e) { setError(e instanceof ApiError && (e.status === 404 || e.status === 403) ? s.conn.notAllowed : connError(e, s)); }
  }, [id, s]);
  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    setError(null);
    try {
      await updateConnection(id, { name: form.name.trim(), description: form.description.trim(), planRoleArn: form.planRoleArn.trim(), applyRoleArn: form.applyRoleArn.trim() || null });
      toast(s.conn.saved);
      await load();
    } catch (e) { setError(connError(e, s)); }
  };
  const test = async () => {
    setTesting(true);
    setError(null);
    try { await testConnection(id); toast(s.conn.tested); await load(); } catch (e) { setError(connError(e, s)); } finally { setTesting(false); }
  };
  const remove = async () => {
    setConfirm(false);
    try { await deleteConnection(id); toast(s.conn.deleted); navigate("/connections"); } catch (e) { setError(connError(e, s)); }
  };

  if (!d) {
    return <Page title={s.conn.title}>{error ? <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert> : <Loader2 className="animate-spin text-muted-foreground" />}</Page>;
  }
  const c = d.connection;
  const dirty = form.name.trim() !== c.name || form.description.trim() !== c.description || form.planRoleArn.trim() !== c.planRoleArn || (form.applyRoleArn.trim() || null) !== c.applyRoleArn;
  return (
    <Page title={c.name} text={c.description || s.conn.text} actions={<Button variant="ghost" asChild><Link to="/connections"><ArrowLeft />{s.conn.back}</Link></Button>}>
      <div className="grid gap-4">
        {error && <Alert variant="destructive" role="alert"><AlertDescription data-testid="connection-error">{error}</AlertDescription></Alert>}

        <Card>
          <CardContent className="grid gap-4">
            <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
              <div className="grid gap-1.5 sm:grid-cols-2 sm:gap-4">
                <div className="grid gap-1.5"><Label htmlFor="n">{s.conn.name}</Label><Input id="n" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="off" /></div>
                <div className="grid gap-1.5"><Label htmlFor="d">{s.conn.description}</Label><Input id="d" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} autoComplete="off" /></div>
              </div>
              <div className="grid gap-1.5"><Label htmlFor="p">{s.conn.planRole}</Label><Input id="p" value={form.planRoleArn} onChange={(e) => setForm({ ...form, planRoleArn: e.target.value })} className="font-mono text-xs" autoComplete="off" /></div>
              <div className="grid gap-1.5"><Label htmlFor="a">{s.conn.applyRole}</Label><Input id="a" value={form.applyRoleArn} onChange={(e) => setForm({ ...form, applyRoleArn: e.target.value })} className="font-mono text-xs" autoComplete="off" /><p className="text-xs text-muted-foreground">{s.conn.applyHelp}</p></div>
              <div className="flex gap-2"><Button type="submit" disabled={!dirty} data-testid="connection-save">{s.conn.save}</Button></div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">{s.conn.guide}</CardTitle><CardDescription>{s.conn.text}</CardDescription></CardHeader>
          <CardContent className="grid gap-4 text-sm">
            <div className="grid gap-1.5">
              <p className="font-medium">{s.conn.guide1}</p>
              {d.server.ok
                ? <><p className="font-mono text-xs break-all" data-testid="server-principal">{d.server.principal}</p><p className="text-xs text-muted-foreground">{(s.conn.source as Record<string, string>)[d.server.source] ?? d.server.source} · {s.conn.inAccount} {d.server.account}</p>{d.server.pathWarning && <p className="text-xs text-amber-600">{s.conn.pathWarning}</p>}</>
                : <Alert variant="destructive"><AlertDescription>{s.conn.serverNone}</AlertDescription></Alert>}
            </div>
            <div className="grid gap-1.5">
              <p className="font-medium">{s.conn.guide2}</p>
              <p className="text-xs text-muted-foreground">{s.conn.externalId}: <code className="font-mono">{c.externalId}</code></p>
              {d.trustPolicy && <Copyable s={s} text={d.trustPolicy} testid="trust-policy" />}
            </div>
            <div className="grid gap-1.5">
              <p className="font-medium">{s.conn.guide3}</p>
              <Copyable s={s} text={d.planPolicy} testid="plan-policy" />
              <p className="text-xs text-muted-foreground">{s.conn.planPolicyNote}</p>
            </div>
            <div className="grid gap-1.5"><p className="font-medium">{s.conn.guide4}</p><p className="text-xs text-muted-foreground">{s.conn.applyNote}</p></div>
            <div className="grid gap-2">
              <p className="font-medium">{s.conn.guide5}</p>
              <div className="flex items-center gap-2"><Button onClick={() => void test()} disabled={testing} data-testid="connection-test">{testing && <Loader2 className="animate-spin" />}{testing ? s.conn.testing : s.conn.test}</Button>
                {c.lastTestAt && <span className="text-xs text-muted-foreground">{new Date(c.lastTestAt).toLocaleString()}</span>}</div>
              {c.lastTest && (
                <ul className="grid gap-2 rounded-md border p-3" data-testid="test-result">
                  <Side s={s} label={s.conn.planSide} side={c.lastTest.plan} />
                  {c.lastTest.apply && <Side s={s} label={s.conn.applySide} side={c.lastTest.apply} />}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">{s.conn.usedBy}</CardTitle></CardHeader>
          <CardContent>
            {d.usedBy.length === 0 ? <p className="text-sm text-muted-foreground">{s.conn.noUse}</p> : <ul className="space-y-1 text-sm">{d.usedBy.map((p) => <li key={p.id}><Link to={`/projects/${p.id}`} className="hover:underline">{p.name}</Link></li>)}</ul>}
            <div className="mt-4"><Button variant="outline" onClick={() => setConfirm(true)} data-testid="connection-delete"><Trash2 />{s.conn.delete}</Button></div>
          </CardContent>
        </Card>
      </div>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent className="sm:max-w-sm"><DialogHeader><DialogTitle>{s.conn.delete}</DialogTitle><DialogDescription>{s.conn.deleteText}</DialogDescription></DialogHeader>
          <DialogFooter><Button variant="ghost" onClick={() => setConfirm(false)}>{s.adm.cancel}</Button><Button variant="destructive" onClick={() => void remove()} data-testid="connection-delete-confirm">{s.conn.delete}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  );
}
