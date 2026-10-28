import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { CheckCircle2, Plus, ShieldCheck, XCircle } from "lucide-react";
import { toast } from "sonner";
import { ACTIONS } from "@av2i/authz";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "../api.ts";
import { createPolicy, listPolicies, simulate, type PolicyRow, type Simulation } from "../admin.ts";
import { useAuth } from "../auth.tsx";
import { describe } from "../components/auth/errors.ts";
import { useStrings } from "../prefs.ts";
import { Page } from "./Page.tsx";

const STARTER = { Statement: [{ Sid: "first", Effect: "Allow", Action: ["project:Read"], Resource: ["av2i:project/*"] }] };
const fill = (text: string, values: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? ""));

function Simulator() {
  const s = useStrings();
  const { can } = useAuth();
  const [users, setUsers] = useState<{ id: string; username: string }[]>([]);
  const [userId, setUserId] = useState("");
  const [action, setAction] = useState<keyof typeof ACTIONS>("project:Read");
  const [resource, setResource] = useState<string>(ACTIONS["project:Read"]);
  const [result, setResult] = useState<Simulation | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (can("user:List")) api<{ users: { id: string; username: string }[] }>("GET", "/api/users").then((r) => setUsers(r.users)).catch(() => setUsers([])); }, [can]);

  const check = async () => {
    setError(null);
    setResult(null);
    try { setResult(await simulate(userId, action, resource)); } catch (e) { setError(describe(e, s)); }
  };
  const reason = result && (result.reason === "allow" ? s.adm.reasonAllow : result.reason === "explicit-deny" ? s.adm.reasonExplicit : s.adm.reasonImplicit);

  return (
    <Card data-testid="simulator">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="size-4" />{s.adm.simulator}</CardTitle>
        <CardDescription>{s.adm.simulatorText}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_1.6fr_auto] md:items-end">
          <div className="grid gap-1.5">
            <Label>{s.adm.user}</Label>
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger className="w-full" data-testid="sim-user"><SelectValue placeholder={s.adm.pickUser} /></SelectTrigger>
              <SelectContent>{users.map((u) => <SelectItem key={u.id} value={u.id}>{u.username}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>{s.adm.action}</Label>
            <Select value={action} onValueChange={(v) => { setAction(v as keyof typeof ACTIONS); setResource(ACTIONS[v as keyof typeof ACTIONS]); setResult(null); }}>
              <SelectTrigger className="w-full" data-testid="sim-action"><SelectValue /></SelectTrigger>
              <SelectContent>{Object.keys(ACTIONS).map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5"><Label htmlFor="sim-resource">{s.adm.resource}</Label><Input id="sim-resource" className="font-mono text-xs" value={resource} onChange={(e) => setResource(e.target.value)} data-testid="sim-resource" /></div>
          <Button onClick={() => void check()} disabled={!userId || !resource} data-testid="sim-check">{s.adm.check}</Button>
        </div>
        {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
        {result && (
          <Alert data-testid="sim-result" data-allowed={result.allowed}>
            {result.allowed ? <CheckCircle2 className="text-success" /> : <XCircle className="text-destructive" />}
            <AlertDescription>
              <span className="font-medium text-foreground">{result.allowed ? s.adm.allowed : s.adm.denied}</span>. {reason}
              {result.sid && <> {s.adm.byStatement} <code className="rounded bg-muted px-1 font-mono text-xs">{result.sid}</code>.</>}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

export function PoliciesPage() {
  const s = useStrings();
  const navigate = useNavigate();
  const [policies, setPolicies] = useState<PolicyRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", description: "" });
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setPolicies(await listPolicies()); } catch (e) { setError(describe(e, s)); }
  }, [s]);
  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    setFormError(null);
    try {
      await createPolicy(form.name.trim(), form.description.trim(), STARTER);
      toast(s.adm.created);
      navigate(`/policies/${encodeURIComponent(form.name.trim())}`);
    } catch (e) { setFormError(describe(e, s)); }
  };

  return (
    <Page title={s.adm.policiesPage} text={s.adm.policiesText} wide actions={<Button onClick={() => setCreating(true)} data-testid="new-policy"><Plus />{s.adm.newPolicy}</Button>}>
      <div className="grid gap-4">
        {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
        <Card className="py-0">
          <Table>
            <TableHeader><TableRow><TableHead>{s.adm.policyName}</TableHead><TableHead>{s.adm.description}</TableHead><TableHead>{s.adm.heldBy}</TableHead></TableRow></TableHeader>
            <TableBody>
              {(policies ?? []).map((p) => (
                <TableRow key={p.name} data-testid={`policy-row-${p.name}`}>
                  <TableCell className="font-medium"><Link to={`/policies/${encodeURIComponent(p.name)}`} className="hover:underline">{p.name}</Link>{p.builtin && <Badge variant="outline" className="ml-2">{s.adm.builtin}</Badge>}{p.builtin && p.customized && <Badge className="ml-1">{s.perm.customized}</Badge>}</TableCell>
                  <TableCell className="max-w-96 truncate text-sm text-muted-foreground">{p.description}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{fill(s.adm.usersN, { n: p.users })} · {fill(s.adm.groupsN, { n: p.groups })}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
        <Simulator />
      </div>
      <Dialog open={creating} onOpenChange={(o) => !o && setCreating(false)}>
        <DialogContent className="sm:max-w-md" data-testid="policy-dialog">
          <DialogHeader><DialogTitle>{s.adm.newPolicy}</DialogTitle><DialogDescription>{s.adm.policiesText}</DialogDescription></DialogHeader>
          <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); void create(); }}>
            <div className="grid gap-1.5"><Label htmlFor="pn">{s.adm.policyName}</Label><Input id="pn" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus autoComplete="off" required /></div>
            <div className="grid gap-1.5"><Label htmlFor="pd">{s.adm.description}</Label><Input id="pd" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} autoComplete="off" /></div>
            {formError && <Alert variant="destructive" role="alert"><AlertDescription>{formError}</AlertDescription></Alert>}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setCreating(false)}>{s.adm.cancel}</Button>
              <Button type="submit" disabled={!form.name.trim()} data-testid="policy-create">{s.acct.create}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Page>
  );
}
