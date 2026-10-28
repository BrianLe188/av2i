import { useCallback, useEffect, useState } from "react";
import { Pencil, Trash2, UserRound, Users } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ApiError } from "../api.ts";
import type { Strings } from "../i18n.ts";
import { listShares, putShare, removeShare, shareTargets, type MemberRole, type Members, type ShareRow } from "../projects.ts";
import { describe } from "./auth/errors.ts";

const fill = (t: string, n: number) => t.replace("{n}", String(n));
const ROLES: MemberRole[] = ["viewer", "editor", "runner", "approver", "maintainer", "custom"];

/** The tickboxes of the project permissions; what the person does not hold themselves is shown but cannot be ticked. */
function PermissionGrid({ s, all, mine, value, onChange }: { s: Strings; all: string[]; mine: string[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-2" data-testid="permission-grid">
      {all.map((a) => {
        const locked = a === "project:Read";
        const held = mine.includes(a);
        return (
          <label key={a} className={`flex items-center gap-2 text-sm ${held || locked ? "" : "opacity-50"}`} title={held ? undefined : s.pd.cantGrant}>
            <Checkbox checked={value.includes(a) || locked} disabled={locked || !held} onCheckedChange={(c) => onChange(c === true ? [...value, a] : value.filter((x) => x !== a))} data-testid={`perm-${a}`} />
            <span>{(s.pd.actions as Record<string, string>)[a] ?? a}</span>
          </label>
        );
      })}
    </div>
  );
}

function roleSelect(s: Strings, value: MemberRole, onChange: (r: MemberRole) => void, testid: string) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as MemberRole)}>
      <SelectTrigger className="w-36" data-testid={testid}><SelectValue /></SelectTrigger>
      <SelectContent>
        {ROLES.map((r) => <SelectItem key={r} value={r} title={s.pd.roleHelp[r]}>{s.pd.roles[r]}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/** The members of a project and what each may do in it (DD-028): added, changed and removed here by whoever may manage members. */
export function MembersPanel({ s, projectId }: { s: Strings; projectId: string }) {
  const [m, setM] = useState<Members | null>(null);
  const [targets, setTargets] = useState<{ users: string[]; groups: string[] }>({ users: [], groups: [] });
  const [pick, setPick] = useState("");
  const [role, setRole] = useState<MemberRole>("viewer");
  const [custom, setCustom] = useState<string[]>(["project:Read"]);
  const [editing, setEditing] = useState<{ id: string; actions: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fail = useCallback((e: unknown) => setError(e instanceof ApiError && (s.pd.errors as Record<string, string>)[e.code] ? (s.pd.errors as Record<string, string>)[e.code]! : describe(e, s)), [s]);
  const load = useCallback(async () => {
    try {
      const r = await listShares(projectId);
      setM(r);
      if (r.canManage) setTargets(await shareTargets(projectId));
    } catch (e) { fail(e); }
  }, [projectId, fail]);
  useEffect(() => { void load(); }, [load]);

  const run = async (job: () => Promise<unknown>, done: string) => {
    setError(null);
    try { await job(); toast(done); await load(); } catch (e) { fail(e); }
  };
  const who = (x: Pick<ShareRow, "kind" | "name">) => (x.kind === "user" ? { user: x.name } : { group: x.name });
  const add = () => {
    const [kind, ...rest] = pick.split(":");
    const name = rest.join(":");
    if (!name) return;
    void run(() => putShare(projectId, kind === "user" ? { user: name } : { group: name }, role, custom), s.pd.saved).then(() => { setPick(""); setCustom(["project:Read"]); });
  };

  if (!m) return error ? <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert> : null;
  const taken = new Set(m.shares.map((x) => `${x.kind}:${x.name}`));
  const users = targets.users.filter((u) => u !== m.owner && !taken.has(`user:${u}`));
  const groups = targets.groups.filter((g) => !taken.has(`group:${g}`));

  return (
    <div className="grid gap-4" data-testid="members">
      <p className="text-sm text-muted-foreground">{s.pd.membersText}</p>
      {error && <Alert variant="destructive" role="alert"><AlertDescription data-testid="members-error">{error}</AlertDescription></Alert>}

      {m.canManage ? (
        <div className="grid gap-3 rounded-md border p-3">
          <p className="text-sm font-medium">{s.pd.addTitle}</p>
          <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); add(); }}>
            <Select value={pick} onValueChange={setPick}>
              <SelectTrigger className="w-56" data-testid="member-pick"><SelectValue placeholder={s.pd.pick} /></SelectTrigger>
              <SelectContent>
                {users.length > 0 && <SelectGroup><SelectLabel>{s.pd.user}</SelectLabel>{users.map((u) => <SelectItem key={u} value={`user:${u}`}>{u}</SelectItem>)}</SelectGroup>}
                {groups.length > 0 && <SelectGroup><SelectLabel>{s.pd.group}</SelectLabel>{groups.map((g) => <SelectItem key={g} value={`group:${g}`}>{g}</SelectItem>)}</SelectGroup>}
              </SelectContent>
            </Select>
            {roleSelect(s, role, setRole, "member-role")}
            <Button type="submit" disabled={!pick} data-testid="member-add">{s.pd.add}</Button>
          </form>
          {role === "custom" && (
            <div className="grid gap-2"><p className="text-xs text-muted-foreground">{s.pd.customHelp}</p><PermissionGrid s={s} all={m.actions} mine={m.mine} value={custom} onChange={setCustom} /></div>
          )}
        </div>
      ) : <p className="text-xs text-muted-foreground">{s.pd.readOnlyNote}</p>}

      <ul className="grid gap-2" data-testid="member-list">
        <li className="flex items-center gap-3 rounded-md border bg-muted/40 px-3 py-2 text-sm" data-testid="member-owner">
          <UserRound className="size-4 text-muted-foreground" />
          <span className="flex-1 font-medium">{m.owner}</span>
          <Badge>{s.pd.ownerRow}</Badge>
          <span className="w-40 text-xs text-muted-foreground">{s.pd.allPerms}</span>
        </li>
        {m.shares.length === 0 && <li className="px-1 text-sm text-muted-foreground">{s.pd.none}</li>}
        {m.shares.map((x) => (
          <li key={x.id} className="grid gap-2 rounded-md border px-3 py-2 text-sm" data-testid={`member-${x.kind}-${x.name}`}>
            <div className="flex items-center gap-3">
              {x.kind === "user" ? <UserRound className="size-4 text-muted-foreground" /> : <Users className="size-4 text-muted-foreground" />}
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{x.name}</div>
                {x.grantedBy && <div className="text-xs text-muted-foreground">{s.pd.by} {x.grantedBy}</div>}
              </div>
              {m.canManage ? roleSelect(s, x.role, (r) => {
                if (r === "custom") setEditing({ id: x.id, actions: x.actions });
                else void run(() => putShare(projectId, who(x), r), s.pd.saved);
              }, "member-row-role") : <Badge variant="outline">{s.pd.roles[x.role]}</Badge>}
              <span className="w-24 text-xs text-muted-foreground" title={x.actions.map((a) => (s.pd.actions as Record<string, string>)[a] ?? a).join(", ")}>{fill(s.pd.permsCount, x.actions.length)}</span>
              {m.canManage && x.role === "custom" && <Button size="icon" variant="ghost" title={s.pd.editPerms} onClick={() => setEditing({ id: x.id, actions: x.actions })} data-testid="member-edit"><Pencil /></Button>}
              {m.canManage && <Button size="icon" variant="ghost" title={s.pd.remove} onClick={() => void run(() => removeShare(projectId, x.id), s.pd.removed)} data-testid="member-remove"><Trash2 /></Button>}
            </div>
            {editing?.id === x.id && (
              <div className="grid gap-2 border-t pt-2">
                <p className="text-xs text-muted-foreground">{s.pd.customHelp}</p>
                <PermissionGrid s={s} all={m.actions} mine={m.mine} value={editing.actions} onChange={(v) => setEditing({ id: x.id, actions: v })} />
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => void run(() => putShare(projectId, who(x), "custom", editing.actions), s.pd.saved).then(() => setEditing(null))} data-testid="member-save-perms">{s.pd.savePerms}</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>{s.adm.cancel}</Button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
