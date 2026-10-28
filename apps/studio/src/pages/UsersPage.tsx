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
import { PermissionSummary, SystemPermissionsDialog } from "../components/SystemPermissionsDialog.tsx";
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
  direct?: { all: boolean; count: number };
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

export function UsersPage() {
  const s = useStrings();
  const { can } = useAuth();
  const self = useUser();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<{ who: string; password: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = users.find((u) => u.id === editingId) ?? null;
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
              <TableRow><TableHead>{s.acct.username}</TableHead><TableHead>{s.acct.status}</TableHead><TableHead>{s.adm.groupsOf}</TableHead><TableHead>{s.acc.summary}</TableHead><TableHead>{s.acct.lastLogin}</TableHead><TableHead /></TableRow>
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
                  <TableCell className="space-x-1"><PermissionSummary s={s} direct={u.direct} />{u.policies.map((p) => <Badge key={p} variant="outline">{p}</Badge>)}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs">{when(u.lastLoginAt, s.acct.never)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    {can("policy:Manage") && <Button size="sm" variant="ghost" onClick={() => setEditingId(u.id)} data-testid="edit-policies"><ShieldCheck />{s.acc.systemPerms}</Button>}
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
      {editing && <SystemPermissionsDialog s={s} kind="user" id={editing.id} name={editing.username} policies={editing.policies} open onClose={() => setEditingId(null)} onChanged={() => void load()} />}
    </Page>
  );
}
