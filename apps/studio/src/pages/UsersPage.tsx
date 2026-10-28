import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Copy, KeyRound, Search, ShieldCheck, UserCheck, UserPlus, UserX } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DirectPermissions, EffectivePermissions, usePermissions } from "../components/AccessPanels.tsx";
import { api } from "../api.ts";
import { useAuth, useUser } from "../auth.tsx";
import { describe } from "../components/auth/errors.ts";
import type { Strings } from "../i18n.ts";
import { useStrings } from "../prefs.ts";
import { Page } from "./Page.tsx";

interface UserRow {
  id: string;
  username: string;
  displayName: string;
  disabled: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  policies: string[];
  groups: string[];
}
interface PolicyRow { name: string; description: string; builtin: boolean }

const when = (iso: string | null, never: string) => (iso ? new Date(iso).toLocaleString() : never);

function Secret({ s, who, password, onClose }: { s: Strings; who: string; password: string; onClose: () => void }) {
  return (
    <Alert data-testid="temp-password">
      <KeyRound />
      <AlertTitle>{s.acct.tempPassword}: {who}</AlertTitle>
      <AlertDescription>
        <div className="flex items-center gap-2">
          <code className="rounded bg-muted px-2 py-1 font-mono text-sm" data-testid="temp-password-value">{password}</code>
          <Button size="xs" variant="outline" onClick={() => { void navigator.clipboard?.writeText(password); toast(s.acct.copied); }}><Copy />{s.acct.copy}</Button>
          <Button size="xs" variant="ghost" onClick={onClose}>{s.acct.close}</Button>
        </div>
        <p className="mt-1 text-xs">{s.acct.tempPasswordHint}</p>
      </AlertDescription>
    </Alert>
  );
}

/** The direct permissions and the table of effective permissions of one user. */
function UserAccess({ s, id, tab }: { s: Strings; id: string; tab: "direct" | "effective" }) {
  const { data, error, reload } = usePermissions("user", id, s);
  if (!data) return error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : <p className="text-sm text-muted-foreground">{s.acc.loading}</p>;
  return tab === "direct" ? <DirectPermissions s={s} kind="user" id={id} data={data} reload={reload} /> : <EffectivePermissions s={s} data={data} />;
}

function PoliciesEditor({ s, user, onClose, onSaved }: { s: Strings; user: UserRow | null; onClose: () => void; onSaved: () => void }) {
  const { can } = useAuth();
  const [all, setAll] = useState<PolicyRow[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"policies" | "direct" | "effective">("policies");
  const editable = can("policy:Manage");

  useEffect(() => {
    if (!user) return;
    setChosen(new Set(user.policies));
    setTab("policies");
    setError(null);
    if (editable) api<{ policies: PolicyRow[] }>("GET", "/api/policies").then((r) => setAll(r.policies)).catch((e) => setError(describe(e, s)));
    else setAll(user.policies.map((name) => ({ name, description: "", builtin: true })));
  }, [user, editable, s]);

  const save = async () => {
    if (!user) return;
    try {
      await api("PUT", `/api/users/${user.id}/policies`, { policies: [...chosen] });
      toast(s.acct.policiesSaved);
      onSaved();
      onClose();
    } catch (e) {
      setError(describe(e, s));
    }
  };

  return (
    <Dialog open={user !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl" data-testid="policies-dialog">
        <DialogHeader>
          <DialogTitle>{s.acct.editPolicies}: {user?.username}</DialogTitle>
          <DialogDescription>{editable ? s.acct.noPolicies : s.acct.readOnlyPolicies}</DialogDescription>
        </DialogHeader>
        {editable && user && (
          <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
            <TabsList>
              <TabsTrigger value="policies" data-testid="user-tab-policies">{s.acc.tabPolicies}</TabsTrigger>
              <TabsTrigger value="direct" data-testid="user-tab-direct">{s.acc.tabDirect}</TabsTrigger>
              <TabsTrigger value="effective" data-testid="user-tab-effective">{s.acc.tabEffective}</TabsTrigger>
            </TabsList>
          </Tabs>
        )}
        {editable && user && tab !== "policies" && <UserAccess s={s} id={user.id} tab={tab} />}
        <ul className={`grid gap-2 ${editable && tab !== "policies" ? "hidden" : ""}`}>
          {all.map((p) => (
            <li key={p.name}>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={chosen.has(p.name)}
                  disabled={!editable}
                  data-testid={`policy-${p.name}`}
                  onChange={(e) => setChosen((c) => { const n = new Set(c); if (e.target.checked) n.add(p.name); else n.delete(p.name); return n; })}
                />
                <span>
                  <span className="font-medium">{p.name}</span>{p.builtin && <Badge variant="outline" className="ml-1.5">{s.acct.builtin}</Badge>}
                  {p.description && <span className="block text-xs text-muted-foreground">{p.description}</span>}
                </span>
              </label>
            </li>
          ))}
        </ul>
        {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{s.acct.cancel}</Button>
          {editable && tab === "policies" && <Button onClick={() => void save()} data-testid="policies-save">{s.acct.save}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function UsersPage() {
  const s = useStrings();
  const { can } = useAuth();
  const self = useUser();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<{ who: string; password: string } | null>(null);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [form, setForm] = useState({ username: "", displayName: "", password: "" });
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    try { setUsers((await api<{ users: UserRow[] }>("GET", "/api/users")).users); } catch (e) { setError(describe(e, s)); }
  }, [s]);
  useEffect(() => { void load(); }, [load]);

  const run = async (f: () => Promise<void>) => {
    setError(null);
    try { await f(); await load(); } catch (e) { setError(describe(e, s)); }
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await run(async () => {
      const r = await api<{ user: UserRow; temporaryPassword?: string }>("POST", "/api/users", {
        username: form.username.trim(), ...(form.displayName.trim() ? { displayName: form.displayName.trim() } : {}), ...(form.password ? { password: form.password } : {}),
      });
      setForm({ username: "", displayName: "", password: "" });
      setCreating(false);
      if (r.temporaryPassword) setSecret({ who: r.user.username, password: r.temporaryPassword });
      toast(s.acct.userCreated);
    });
    setBusy(false);
  };

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? users.filter((u) => u.username.toLowerCase().includes(q) || u.displayName.toLowerCase().includes(q) || u.policies.some((p) => p.toLowerCase().includes(q))) : users;
  }, [users, query]);

  return (
    <Page
      title={s.nav.usersPage}
      text={s.nav.usersPageText}
      wide
      actions={can("user:Create") && <Button onClick={() => setCreating((c) => !c)} data-testid="open-create"><UserPlus />{s.acct.createUser}</Button>}
    >
      <div className="grid gap-4">
        {error && <Alert variant="destructive" role="alert" data-testid="users-error"><AlertDescription>{error}</AlertDescription></Alert>}
        {secret && <Secret s={s} who={secret.who} password={secret.password} onClose={() => setSecret(null)} />}
        {creating && can("user:Create") && (
          <Card>
            <CardHeader><CardTitle className="text-base">{s.acct.createUser}</CardTitle></CardHeader>
            <CardContent>
              <form onSubmit={create} className="grid items-end gap-3 md:grid-cols-[1fr_1fr_1.4fr_auto]" data-testid="create-user">
                <div className="grid gap-1.5"><Label htmlFor="nu">{s.acct.username}</Label><Input id="nu" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} autoComplete="off" autoFocus required /></div>
                <div className="grid gap-1.5"><Label htmlFor="nd">{s.acct.displayName}</Label><Input id="nd" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} autoComplete="off" /></div>
                <div className="grid gap-1.5"><Label htmlFor="np">{s.acct.optionalPassword}</Label><Input id="np" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" /></div>
                <div className="flex gap-2">
                  <Button type="submit" disabled={busy || !form.username.trim()}>{s.acct.create}</Button>
                  <Button type="button" variant="ghost" onClick={() => setCreating(false)}>{s.acct.cancel}</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}
        <div className="relative max-w-sm">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input className="pl-8" placeholder={s.nav.search} aria-label={s.nav.search} value={query} onChange={(e) => setQuery(e.target.value)} data-testid="user-search" />
        </div>
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow><TableHead>{s.acct.username}</TableHead><TableHead>{s.acct.status}</TableHead><TableHead>{s.adm.groupsOf}</TableHead><TableHead>{s.acct.policies}</TableHead><TableHead>{s.acct.lastLogin}</TableHead><TableHead /></TableRow>
            </TableHeader>
            <TableBody>
              {shown.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">{s.nav.noMatch}</TableCell></TableRow>}
              {shown.map((u) => (
                <TableRow key={u.id} data-testid={`user-${u.username}`}>
                  <TableCell><div className="font-medium">{u.username}</div>{u.displayName && <div className="text-xs text-muted-foreground">{u.displayName}</div>}</TableCell>
                  <TableCell className="space-x-1">
                    <Badge variant={u.disabled ? "destructive" : "secondary"}>{u.disabled ? s.acct.disabled : s.acct.active}</Badge>
                    {u.mustChangePassword && <Badge variant="outline">{s.acct.mustChange}</Badge>}
                  </TableCell>
                  <TableCell className="space-x-1">{u.groups.length ? u.groups.map((g) => <Badge key={g} variant="secondary">{g}</Badge>) : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="space-x-1">{u.policies.length ? u.policies.map((p) => <Badge key={p} variant="outline">{p}</Badge>) : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs">{when(u.lastLoginAt, s.acct.never)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    {can("user:Update") && <Button size="sm" variant="ghost" onClick={() => setEditing(u)} data-testid="edit-policies"><ShieldCheck />{s.acct.editPolicies}</Button>}
                    {can("user:ResetPassword") && (
                      <Button size="sm" variant="ghost" data-testid="reset-password" onClick={() => void run(async () => {
                        const r = await api<{ temporaryPassword?: string }>("POST", `/api/users/${u.id}/reset-password`, {});
                        if (r.temporaryPassword) setSecret({ who: u.username, password: r.temporaryPassword });
                      })}><KeyRound />{s.acct.resetPassword}</Button>
                    )}
                    {can("user:Disable") && u.id !== self.id && (
                      <Button size="sm" variant="ghost" data-testid="toggle-disabled" onClick={() => void run(async () => { await api("PATCH", `/api/users/${u.id}`, { disabled: !u.disabled }); toast(s.acct.userUpdated); })}>
                        {u.disabled ? <UserCheck /> : <UserX />}{u.disabled ? s.acct.enable : s.acct.disable}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>
      <PoliciesEditor s={s} user={editing} onClose={() => setEditing(null)} onSaved={() => void load()} />
    </Page>
  );
}
