import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ArrowLeft, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ACTIONS, parseDocument } from "@av2i/authz";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "../api.ts";
import { deletePolicy, getPolicy, updatePolicy, type PolicyDetail } from "../admin.ts";
import { describe } from "../components/auth/errors.ts";
import { useStrings } from "../prefs.ts";
import type { Strings } from "../i18n.ts";
import { Page } from "./Page.tsx";

const fill = (text: string, values: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? ""));
const pretty = (document: unknown) => JSON.stringify(document, null, 2);

/** Example statements, appended to the document being edited. */
const snippets = (s: Strings) => [
  { id: "read", label: s.adm.templateRead, statement: { Sid: "read-projects", Effect: "Allow", Action: ["project:List", "project:Read"], Resource: ["av2i:project/*"] } },
  { id: "edit", label: s.adm.templateEdit, statement: { Sid: "edit-projects", Effect: "Allow", Action: ["project:Create", "project:List", "project:Read", "project:Write"], Resource: ["av2i:project/*"] } },
  { id: "deny-delete", label: s.adm.templateDenyDelete, statement: { Sid: "no-delete", Effect: "Deny", Action: ["project:Delete"], Resource: ["av2i:project/*"] } },
  { id: "users", label: s.adm.templateUsers, statement: { Sid: "users", Effect: "Allow", Action: ["user:*"], Resource: ["av2i:user/*"] } },
  { id: "audit", label: s.adm.templateAudit, statement: { Sid: "audit", Effect: "Allow", Action: ["audit:Read"], Resource: ["av2i:audit/*"] } },
];

export function PolicyPage() {
  const { name = "" } = useParams();
  const s = useStrings();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<PolicyDetail | null | "missing">(null);
  const [text, setText] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [serverProblems, setServerProblems] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await getPolicy(name);
      setDetail(d);
      setText(pretty(d.policy.document));
      setDescription(d.policy.description);
    } catch (e) { if (e instanceof ApiError && e.status === 404) setDetail("missing"); else setError(describe(e, s)); }
  }, [name, s]);
  useEffect(() => { void load(); }, [load]);

  /** What the document says now: its statements, or why it is not a policy; the same check the server makes. */
  const check = useMemo(() => {
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { return { ok: false as const, problems: [s.adm.invalidJson] }; }
    const r = parseDocument(parsed);
    return r.ok ? { ok: true as const, statements: r.statements.length, value: parsed } : { ok: false as const, problems: r.errors };
  }, [text, s]);

  if (detail === "missing") return <Page title={s.nav.notFound} text={s.nav.notFoundText}><Button asChild variant="outline"><Link to="/policies">{s.adm.policiesPage}</Link></Button></Page>;
  if (detail === null) return <Page title={s.acct.loading}>{error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}</Page>;

  const { policy, users, groups } = detail;
  const readOnly = policy.builtin;
  const changed = text !== pretty(policy.document) || description.trim() !== policy.description;

  const save = async () => {
    setError(null);
    setServerProblems([]);
    try {
      await updatePolicy(name, { description: description.trim(), ...(check.ok ? { document: check.value } : {}) });
      toast(s.adm.saved);
      await load();
    } catch (e) {
      if (e instanceof ApiError && Array.isArray(e.extra.problems)) setServerProblems(e.extra.problems as string[]);
      setError(describe(e, s));
    }
  };

  const append = (statement: object) => {
    try {
      const doc = JSON.parse(text) as { Statement?: unknown };
      const list = Array.isArray(doc.Statement) ? doc.Statement : doc.Statement ? [doc.Statement] : [];
      setText(pretty({ ...doc, Statement: [...list, statement] }));
    } catch { setError(s.adm.invalidJson); }
  };

  const remove = async () => {
    try { await deletePolicy(name, users.length + groups.length > 0); toast(s.adm.deleted); navigate("/policies"); } catch (e) { setError(describe(e, s)); setDeleting(false); }
  };

  return (
    <Page
      title={policy.name}
      text={readOnly ? s.adm.builtinReadOnly : s.adm.policiesText}
      actions={
        <div className="flex gap-2">
          <Button asChild variant="outline"><Link to="/policies"><ArrowLeft />{s.adm.policiesPage}</Link></Button>
          {!readOnly && <Button variant="destructive" onClick={() => setDeleting(true)} data-testid="delete-policy"><Trash2 />{s.adm.deletePolicy}</Button>}
        </div>
      }
    >
      <div className="grid gap-4">
        {error && <Alert variant="destructive" role="alert" data-testid="policy-error"><AlertDescription>{error}</AlertDescription></Alert>}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{s.adm.document}</CardTitle>
            {!readOnly && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className="text-xs text-muted-foreground">{s.adm.addStatement}:</span>
                {snippets(s).map((x) => <Button key={x.id} size="xs" variant="outline" onClick={() => append(x.statement)} data-testid={`snippet-${x.id}`}>{x.label}</Button>)}
              </div>
            )}
          </CardHeader>
          <CardContent className="grid gap-3">
            {!readOnly && <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder={s.adm.description} maxLength={300} aria-label={s.adm.description} data-testid="policy-description" />}
            <Textarea
              value={text} onChange={(e) => setText(e.target.value)} readOnly={readOnly} spellCheck={false}
              className="min-h-72 font-mono text-xs leading-relaxed" aria-label={s.adm.document} data-testid="policy-text"
            />
            {check.ok
              ? <p className="text-xs text-muted-foreground" data-testid="policy-valid">{fill(s.adm.valid, { n: check.statements })}</p>
              : (
                <Alert variant="destructive" data-testid="policy-problems">
                  <AlertTitle>{s.adm.problems}</AlertTitle>
                  <AlertDescription><ul className="list-disc pl-4">{[...check.problems, ...serverProblems.filter((p) => !check.problems.includes(p))].map((p) => <li key={p}>{p}</li>)}</ul></AlertDescription>
                </Alert>
              )}
            {!readOnly && <Button className="w-fit" disabled={!changed || !check.ok} onClick={() => void save()} data-testid="policy-save">{s.adm.save}</Button>}
          </CardContent>
        </Card>

        <Card data-testid="attached-card">
          <CardHeader><CardTitle className="text-base">{s.adm.attached}</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-1.5">
            {users.length + groups.length === 0 && <p className="text-sm text-muted-foreground">{s.adm.noAttached}</p>}
            {users.map((u) => <Badge key={u.id} variant="secondary">{u.username}</Badge>)}
            {groups.map((g) => <Badge key={g.id} variant="outline"><Link to={`/groups/${g.id}`} className="hover:underline">{g.name}</Link></Badge>)}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">{s.adm.reference}</CardTitle><CardDescription>{s.adm.referenceText}</CardDescription></CardHeader>
          <CardContent>
            <ul className="grid gap-1 text-xs sm:grid-cols-2">
              {Object.entries(ACTIONS).map(([a, r]) => <li key={a} className="flex justify-between gap-3 rounded border px-2 py-1"><code className="font-mono">{a}</code><code className="font-mono text-muted-foreground">{r}</code></li>)}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Dialog open={deleting} onOpenChange={(o) => !o && setDeleting(false)}>
        <DialogContent className="sm:max-w-sm" data-testid="delete-policy-dialog">
          <DialogHeader>
            <DialogTitle>{s.adm.deletePolicyTitle}</DialogTitle>
            <DialogDescription>{policy.name}. {users.length + groups.length > 0 ? fill(s.adm.deletePolicyText, { u: users.length, g: groups.length }) : s.adm.deletePolicyPlain}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleting(false)}>{s.adm.cancel}</Button>
            <Button variant="destructive" onClick={() => void remove()} data-testid="delete-policy-confirm">{s.adm.confirmDelete}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  );
}
