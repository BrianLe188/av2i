import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ArrowLeft, Trash2, UserMinus, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api, ApiError } from "../api.ts";
import { deleteGroup, getGroup, getPermissions, setMembers, updateGroup, type GroupDetail } from "../admin.ts";
import { useAuth } from "../auth.tsx";
import { PermissionSummary, SystemPermissionsDialog } from "../components/SystemPermissionsDialog.tsx";
import { describe } from "../components/auth/errors.ts";
import { useStrings } from "../prefs.ts";
import { Page } from "./Page.tsx";

interface UserLite { id: string; username: string; displayName: string; disabled: boolean }

export function GroupPage() {
  const { id = "" } = useParams();
  const s = useStrings();
  const { can } = useAuth();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<GroupDetail | null | "missing">(null);
  const [users, setUsers] = useState<UserLite[]>([]);
  const [description, setDescription] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [permsOpen, setPermsOpen] = useState(false);
  const [summary, setSummary] = useState<{ all: boolean; count: number } | undefined>();
  const loadSummary = useCallback(async () => {
    if (!can("policy:Manage")) return;
    try { const p = await getPermissions("group", id); setSummary({ all: p.direct.all, count: p.direct.actions.length }); } catch { setSummary(undefined); }
  }, [id, can]);
  useEffect(() => { void loadSummary(); }, [loadSummary]);

  const load = useCallback(async () => {
    try {
      const d = await getGroup(id);
      setDetail(d);
      setDescription(d.group.description);
    } catch (e) { if (e instanceof ApiError && e.status === 404) setDetail("missing"); else setError(describe(e, s)); }
  }, [id, s]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (can("user:List")) api<{ users: UserLite[] }>("GET", "/api/users").then((r) => setUsers(r.users)).catch(() => setUsers([]));
  }, [can]);

  const run = async (f: () => Promise<unknown>, done?: string) => {
    setError(null);
    try { await f(); if (done) toast(done); await load(); } catch (e) { setError(describe(e, s)); }
  };

  const memberIds = useMemo(() => (detail && detail !== "missing" ? detail.members.map((m) => m.id) : []), [detail]);
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter((u) => !memberIds.includes(u.id) && (!q || u.username.toLowerCase().includes(q) || u.displayName.toLowerCase().includes(q))).slice(0, 8);
  }, [users, memberIds, query]);

  if (detail === "missing") return <Page title={s.nav.notFound} text={s.nav.notFoundText}><Button asChild variant="outline"><Link to="/groups">{s.adm.backToGroups}</Link></Button></Page>;
  if (detail === null) return <Page title={s.acct.loading}>{error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}</Page>;

  const { group, members } = detail;
  const editablePolicies = can("policy:Manage");

  return (
    <Page
      title={group.name}
      text={s.adm.groupsText}
      actions={
        <div className="flex gap-2">
          <Button asChild variant="outline"><Link to="/groups"><ArrowLeft />{s.adm.backToGroups}</Link></Button>
          <Button variant="destructive" onClick={() => setDeleting(true)} data-testid="delete-group"><Trash2 />{s.adm.deleteGroup}</Button>
        </div>
      }
    >
      <div className="grid gap-4">
        {error && <Alert variant="destructive" role="alert" data-testid="group-error"><AlertDescription>{error}</AlertDescription></Alert>}
        <Card>
          <CardHeader><CardTitle className="text-base">{s.adm.description}</CardTitle></CardHeader>
          <CardContent className="flex gap-2">
            <Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} data-testid="group-description" />
            <Button variant="outline" disabled={description.trim() === group.description} onClick={() => void run(() => updateGroup(id, description), s.adm.saved)}>{s.adm.saveDescription}</Button>
          </CardContent>
        </Card>

        <Card data-testid="members-card">
          <CardHeader><CardTitle className="text-base">{s.adm.members} ({members.length})</CardTitle></CardHeader>
          <CardContent className="grid gap-3">
            {members.length === 0 && <p className="text-sm text-muted-foreground">{s.adm.noMembers}</p>}
            <ul className="grid gap-1.5">
              {members.map((m) => (
                <li key={m.id} className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm" data-testid={`member-${m.username}`}>
                  <span className="font-medium">{m.username}</span>
                  {m.displayName && <span className="text-muted-foreground">{m.displayName}</span>}
                  {m.disabled && <Badge variant="destructive">{s.acct.disabled}</Badge>}
                  <Button size="sm" variant="ghost" className="ml-auto" data-testid="remove-member" onClick={() => void run(() => setMembers(id, memberIds.filter((x) => x !== m.id)))}><UserMinus />{s.adm.remove}</Button>
                </li>
              ))}
            </ul>
            {can("user:List") && (
              <div className="grid gap-1.5">
                <Input placeholder={s.adm.searchUsers} aria-label={s.adm.searchUsers} value={query} onChange={(e) => setQuery(e.target.value)} className="max-w-sm" data-testid="member-search" />
                {candidates.length === 0 && users.length > 0 && !query && <p className="text-xs text-muted-foreground">{s.adm.allUsersAdded}</p>}
                <ul className="flex flex-wrap gap-1.5">
                  {candidates.map((u) => (
                    <li key={u.id}><Button size="sm" variant="outline" data-testid={`add-${u.username}`} onClick={() => void run(() => setMembers(id, [...memberIds, u.id]))}><UserPlus />{u.username}</Button></li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        <Card data-testid="group-permissions-card">
          <CardHeader>
            <CardTitle className="text-base">{s.acc.systemPerms}</CardTitle>
            <CardDescription>{s.acc.systemGroup}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3">
            <PermissionSummary s={s} direct={summary} />
            {detail.policies.map((p) => <Badge key={p} variant="outline">{p}</Badge>)}
            {editablePolicies && <Button variant="outline" onClick={() => setPermsOpen(true)} data-testid="group-permissions-open">{s.acc.systemPerms}</Button>}
          </CardContent>
        </Card>
      </div>

      {editablePolicies && <SystemPermissionsDialog s={s} kind="group" id={id} name={group.name} policies={detail.policies} open={permsOpen} onClose={() => setPermsOpen(false)} onChanged={() => { void load(); void loadSummary(); }} />}

      <Dialog open={deleting} onOpenChange={(o) => !o && setDeleting(false)}>
        <DialogContent className="sm:max-w-sm" data-testid="delete-group-dialog">
          <DialogHeader><DialogTitle>{s.adm.deleteGroupTitle}</DialogTitle><DialogDescription>{group.name}. {s.adm.deleteGroupText}</DialogDescription></DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleting(false)}>{s.adm.cancel}</Button>
            <Button variant="destructive" data-testid="delete-group-confirm" onClick={() => void (async () => {
              try { await deleteGroup(id); toast(s.adm.deleted); navigate("/groups"); } catch (e) { setError(describe(e, s)); setDeleting(false); }
            })()}>{s.adm.confirmDelete}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  );
}
