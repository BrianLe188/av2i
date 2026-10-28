import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ArrowLeft, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ACTIONS, PROJECT_ACTIONS, SYSTEM_GROUPS, documentOf, parseDocument, selectionOf, type Action } from "@av2i/authz";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "../api.ts";
import { deletePolicy, getPolicy, restorePolicyDefault, updatePolicy, type PolicyDetail } from "../admin.ts";
import { PermissionPicker } from "../components/PermissionPicker.tsx";
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
  const [restoring, setRestoring] = useState(false);
  const [tab, setTab] = useState<"picker" | "json">("picker");

  const load = useCallback(async () => {
    try {
      const d = await getPolicy(name);
      setDetail(d);
      setText(pretty(d.policy.document));
      setDescription(d.policy.description);
      // a document that is a choice of permissions opens on the picker; one with a Deny or a scope opens on the JSON
      const p = parseDocument(d.policy.document);
      setTab(p.ok && selectionOf(p.statements).ok ? "picker" : "json");
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

  /** The document as a choice of permissions, when it is one. */
  const selection = useMemo(() => {
    if (!check.ok) return null;
    const r = parseDocument(check.value);
    if (!r.ok) return null;
    const sel = selectionOf(r.statements);
    return sel.ok ? sel : null;
  }, [check]);

  if (detail === "missing") return <Page title={s.nav.notFound} text={s.nav.notFoundText}><Button asChild variant="outline"><Link to="/policies">{s.adm.policiesPage}</Link></Button></Page>;
  if (detail === null) return <Page title={s.acct.loading}>{error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}</Page>;

  const { policy, users, groups } = detail;
  const builtin = policy.builtin;
  const changed = text !== pretty(policy.document) || (!builtin && description.trim() !== policy.description);

  const save = async () => {
    setError(null);
    setServerProblems([]);
    try {
      await updatePolicy(name, { ...(builtin ? {} : { description: description.trim() }), ...(check.ok ? { document: check.value } : {}) });
      toast(s.adm.saved);
      await load();
    } catch (e) {
      if (e instanceof ApiError && Array.isArray(e.extra.problems)) setServerProblems(e.extra.problems as string[]);
      setError(e instanceof ApiError && e.code === "administrator_locked_out" ? fill(s.perm.errors.administrator_locked_out, { actions: ((e.extra.actions as string[] | undefined) ?? []).join(", ") }) : describe(e, s));
    }
  };

  const restore = async () => {
    setRestoring(false);
    try { await restorePolicyDefault(name); toast(s.perm.restored); await load(); } catch (e) { setError(describe(e, s)); }
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
      text={builtin ? s.perm.builtinText : s.adm.policiesText}
      actions={
        <div className="flex gap-2">
          <Button asChild variant="outline"><Link to="/policies"><ArrowLeft />{s.adm.policiesPage}</Link></Button>
          {builtin && policy.customized && <Button variant="outline" onClick={() => setRestoring(true)} data-testid="restore-default"><RotateCcw />{s.perm.restore}</Button>}
          {!builtin && <Button variant="destructive" onClick={() => setDeleting(true)} data-testid="delete-policy"><Trash2 />{s.adm.deletePolicy}</Button>}
        </div>
      }
    >
      <div className="grid gap-4">
        {error && <Alert variant="destructive" role="alert" data-testid="policy-error"><AlertDescription>{error}</AlertDescription></Alert>}
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              {s.adm.document}
              {builtin && <Badge variant="outline">{s.perm.builtin}</Badge>}
              {builtin && policy.customized && <Badge data-testid="policy-customized">{s.perm.customized}</Badge>}
            </CardTitle>
            <Tabs value={tab} onValueChange={(v) => setTab(v as "picker" | "json")}>
              <TabsList>
                <TabsTrigger value="picker" data-testid="tab-picker">{s.perm.tabPermissions}</TabsTrigger>
                <TabsTrigger value="json" data-testid="tab-json">{s.perm.tabJson}</TabsTrigger>
              </TabsList>
            </Tabs>
          </CardHeader>
          <CardContent className="grid gap-3">
            {!builtin && <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder={s.adm.description} maxLength={300} aria-label={s.adm.description} data-testid="policy-description" />}
            {detail.newActions.length > 0 && selection && (
              <Alert data-testid="policy-new-actions">
                <AlertTitle>{s.perm.newTitle}</AlertTitle>
                <AlertDescription className="flex flex-wrap items-center gap-2">
                  <span>{fill(s.perm.newText, { list: detail.newActions.map((a) => (s.perm.actions as Record<string, string>)[a] ?? a).join(", ") })}</span>
                  <Button size="xs" variant="outline" onClick={() => setText(pretty(documentOf([...selection.actions, ...(detail.newActions as Action[])], selection.all)))} data-testid="policy-add-new">{s.perm.addNew}</Button>
                </AlertDescription>
              </Alert>
            )}
            {tab === "picker" && (selection
              ? (
                <>
                  <PermissionPicker s={s} groups={SYSTEM_GROUPS} allToggle value={{ all: selection.all, actions: selection.actions }} onChange={(v) => setText(pretty(documentOf(v.actions, v.all)))} />
                  {!selection.all && selection.actions.some((a) => (PROJECT_ACTIONS as readonly string[]).includes(a)) && (
                    <p className="text-xs text-muted-foreground" data-testid="policy-hidden-project">{fill(s.acc.hiddenProject, { n: selection.actions.filter((a) => (PROJECT_ACTIONS as readonly string[]).includes(a)).length })}</p>
                  )}
                </>
              )
              : <Alert data-testid="policy-json-only"><AlertDescription>{s.perm.jsonOnly}</AlertDescription></Alert>)}
            {tab === "json" && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">{s.adm.addStatement}:</span>
                  {snippets(s).map((x) => <Button key={x.id} size="xs" variant="outline" onClick={() => append(x.statement)} data-testid={`snippet-${x.id}`}>{x.label}</Button>)}
                </div>
                <Textarea
                  value={text} onChange={(e) => setText(e.target.value)} spellCheck={false}
                  className="min-h-72 font-mono text-xs leading-relaxed" aria-label={s.adm.document} data-testid="policy-text"
                />
              </>
            )}
            {check.ok
              ? <p className="text-xs text-muted-foreground" data-testid="policy-valid">{fill(s.adm.valid, { n: check.statements })}</p>
              : (
                <Alert variant="destructive" data-testid="policy-problems">
                  <AlertTitle>{s.adm.problems}</AlertTitle>
                  <AlertDescription><ul className="list-disc pl-4">{[...check.problems, ...serverProblems.filter((p) => !check.problems.includes(p))].map((p) => <li key={p}>{p}</li>)}</ul></AlertDescription>
                </Alert>
              )}
            <Button className="w-fit" disabled={!changed || !check.ok} onClick={() => void save()} data-testid="policy-save">{s.adm.save}</Button>
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

      <Dialog open={restoring} onOpenChange={(o) => !o && setRestoring(false)}>
        <DialogContent className="sm:max-w-sm" data-testid="restore-dialog">
          <DialogHeader><DialogTitle>{s.perm.restoreTitle}</DialogTitle><DialogDescription>{policy.name}. {s.perm.restoreText}</DialogDescription></DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRestoring(false)}>{s.adm.cancel}</Button>
            <Button onClick={() => void restore()} data-testid="restore-confirm">{s.perm.restore}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
