import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Copy, KeyRound, ShieldCheck, UserCheck, UserX } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "../api.ts";
import { useAuth } from "../auth.tsx";
import type { Strings } from "../i18n.ts";
import { describe } from "./auth/errors.ts";

interface UserRow {
  id: string;
  username: string;
  displayName: string;
  disabled: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  policies: string[];
}
interface PolicyRow { name: string; description: string; builtin: boolean }
interface AuditRow { id: string; at: string; actor: string | null; action: string; resource: string | null; outcome: string; ip: string | null }

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

function PoliciesEditor({ s, user, onClose, onSaved }: { s: Strings; user: UserRow | null; onClose: () => void; onSaved: () => void }) {
  const { can } = useAuth();
  const [all, setAll] = useState<PolicyRow[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const editable = can("policy:Manage");

  useEffect(() => {
    if (!user) return;
    setChosen(new Set(user.policies));
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
      <DialogContent className="sm:max-w-md" data-testid="policies-dialog">
        <DialogHeader>
          <DialogTitle>{s.acct.editPolicies}: {user?.username}</DialogTitle>
          <DialogDescription>{editable ? s.acct.noPolicies : s.acct.readOnlyPolicies}</DialogDescription>
        </DialogHeader>
        <ul className="grid gap-2">
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
          {editable && <Button onClick={() => void save()} data-testid="policies-save">{s.acct.save}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AuditTab({ s }: { s: Strings }) {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [more, setMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async (before?: string) => {
    try {
      const r = await api<{ entries: AuditRow[] }>("GET", `/api/audit?limit=50${before ? `&before=${before}` : ""}`);
      setRows((cur) => (before ? [...cur, ...r.entries] : r.entries));
      setMore(r.entries.length === 50);
    } catch (e) { setError(describe(e, s)); }
  }, [s]);
  useEffect(() => { void load(); }, [load]);
  return (
    <div className="grid gap-2">
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      <Table>
        <TableHeader><TableRow><TableHead>{s.acct.time}</TableHead><TableHead>{s.acct.actor}</TableHead><TableHead>{s.acct.action}</TableHead><TableHead>{s.acct.resource}</TableHead><TableHead>{s.acct.outcome}</TableHead></TableRow></TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="whitespace-nowrap text-xs">{new Date(r.at).toLocaleString()}</TableCell>
              <TableCell>{r.actor ?? "—"}</TableCell>
              <TableCell className="font-mono text-xs">{r.action}</TableCell>
              <TableCell className="max-w-48 truncate font-mono text-xs" title={r.resource ?? ""}>{r.resource ?? ""}</TableCell>
              <TableCell><Badge variant={r.outcome === "success" ? "secondary" : "destructive"}>{r.outcome}</Badge></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {more && rows.length > 0 && <Button variant="outline" size="sm" className="w-fit" onClick={() => void load(rows[rows.length - 1]!.id)}>{s.acct.loadMore}</Button>}
    </div>
  );
}

export function UsersDialog({ open, onClose, s, selfId }: { open: boolean; onClose: () => void; s: Strings; selfId: string }) {
  const { can } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<{ who: string; password: string } | null>(null);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [form, setForm] = useState({ username: "", displayName: "", password: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setUsers((await api<{ users: UserRow[] }>("GET", "/api/users")).users);
    } catch (e) { setError(describe(e, s)); }
  }, [s]);
  useEffect(() => { if (open) { setError(null); setSecret(null); void load(); } }, [open, load]);

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
      if (r.temporaryPassword) setSecret({ who: r.user.username, password: r.temporaryPassword });
      toast(s.acct.userCreated);
    });
    setBusy(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="flex max-h-[85vh] w-[min(56rem,calc(100vw-2rem))] flex-col overflow-hidden sm:max-w-4xl" data-testid="users-dialog">
          <DialogHeader>
            <DialogTitle>{s.acct.manageUsers}</DialogTitle>
            <DialogDescription>{s.acct.users}: {users.length}</DialogDescription>
          </DialogHeader>
          <Tabs defaultValue="users" className="min-h-0 flex-1 overflow-y-auto">
            <TabsList>
              <TabsTrigger value="users">{s.acct.users}</TabsTrigger>
              {can("audit:Read") && <TabsTrigger value="audit" data-testid="audit-tab">{s.acct.audit}</TabsTrigger>}
            </TabsList>
            <TabsContent value="users" className="grid gap-3 pt-2">
              {error && <Alert variant="destructive" role="alert" data-testid="users-error"><AlertDescription>{error}</AlertDescription></Alert>}
              {secret && <Secret s={s} who={secret.who} password={secret.password} onClose={() => setSecret(null)} />}
              {can("user:Create") && (
                <form onSubmit={create} className="grid grid-cols-[1fr_1fr_1.4fr_auto] items-end gap-2 rounded-md border p-3" data-testid="create-user">
                  <div className="grid gap-1"><Label htmlFor="nu">{s.acct.username}</Label><Input id="nu" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} autoComplete="off" required /></div>
                  <div className="grid gap-1"><Label htmlFor="nd">{s.acct.displayName}</Label><Input id="nd" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} autoComplete="off" /></div>
                  <div className="grid gap-1"><Label htmlFor="np">{s.acct.optionalPassword}</Label><Input id="np" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" /></div>
                  <Button type="submit" disabled={busy || !form.username.trim()}>{s.acct.create}</Button>
                </form>
              )}
              <Table>
                <TableHeader>
                  <TableRow><TableHead>{s.acct.username}</TableHead><TableHead>{s.acct.status}</TableHead><TableHead>{s.acct.policies}</TableHead><TableHead>{s.acct.lastLogin}</TableHead><TableHead /></TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((u) => (
                    <TableRow key={u.id} data-testid={`user-${u.username}`}>
                      <TableCell><div className="font-medium">{u.username}</div>{u.displayName && <div className="text-xs text-muted-foreground">{u.displayName}</div>}</TableCell>
                      <TableCell className="space-x-1">
                        <Badge variant={u.disabled ? "destructive" : "secondary"}>{u.disabled ? s.acct.disabled : s.acct.active}</Badge>
                        {u.mustChangePassword && <Badge variant="outline">{s.acct.mustChange}</Badge>}
                      </TableCell>
                      <TableCell className="space-x-1">{u.policies.length ? u.policies.map((p) => <Badge key={p} variant="outline">{p}</Badge>) : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{when(u.lastLoginAt, s.acct.never)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right">
                        {can("user:Update") && <Button size="icon-sm" variant="ghost" title={s.acct.editPolicies} aria-label={s.acct.editPolicies} onClick={() => setEditing(u)} data-testid="edit-policies"><ShieldCheck /></Button>}
                        {can("user:ResetPassword") && (
                          <Button size="icon-sm" variant="ghost" title={s.acct.resetPassword} aria-label={s.acct.resetPassword} data-testid="reset-password" onClick={() => void run(async () => {
                            const r = await api<{ temporaryPassword?: string }>("POST", `/api/users/${u.id}/reset-password`, {});
                            if (r.temporaryPassword) setSecret({ who: u.username, password: r.temporaryPassword });
                          })}><KeyRound /></Button>
                        )}
                        {can("user:Disable") && u.id !== selfId && (
                          <Button size="icon-sm" variant="ghost" title={u.disabled ? s.acct.enable : s.acct.disable} aria-label={u.disabled ? s.acct.enable : s.acct.disable} data-testid="toggle-disabled" onClick={() => void run(async () => { await api("PATCH", `/api/users/${u.id}`, { disabled: !u.disabled }); toast(s.acct.userUpdated); })}>
                            {u.disabled ? <UserCheck /> : <UserX />}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TabsContent>
            {can("audit:Read") && <TabsContent value="audit" className="pt-2"><AuditTab s={s} /></TabsContent>}
          </Tabs>
        </DialogContent>
      </Dialog>
      <PoliciesEditor s={s} user={editing} onClose={() => setEditing(null)} onSaved={() => void load()} />
    </>
  );
}
