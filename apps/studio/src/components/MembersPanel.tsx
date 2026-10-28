import { useCallback, useEffect, useState } from "react";
import { PROJECT_GROUPS, type Action } from "@av2i/authz";
import { Pencil, Plus, Trash2, UserRound, Users } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ApiError } from "../api.ts";
import type { Strings } from "../i18n.ts";
import { listShares, putShare, removeShare, shareTargets, type Members, type ShareRow } from "../projects.ts";
import { describe } from "./auth/errors.ts";
import { PermissionPicker, type Pick } from "./PermissionPicker.tsx";

const fill = (t: string, v: Record<string, string | number>) => t.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? ""));
const READ: Action = "project:Read";
const SHOWN = 4;

/** What a member may do in the project, as a few chips: the permissions themselves, not a role name (DD-031). */
function Chips({ s, actions }: { s: Strings; actions: string[] }) {
  const label = (a: string) => (s.perm.actions as Record<string, string>)[a] ?? a;
  return (
    <span className="flex flex-wrap items-center gap-1" title={actions.map(label).join(", ")} data-testid="member-chips">
      {actions.slice(0, SHOWN).map((a) => <Badge key={a} variant="secondary" className="font-normal">{label(a)}</Badge>)}
      {actions.length > SHOWN && <Badge variant="outline" className="font-normal">+{actions.length - SHOWN}</Badge>}
    </span>
  );
}

/** The members of a project and what each may do in it: added and edited in a dialog of tickboxes, by whoever may manage members. */
export function MembersPanel({ s, projectId }: { s: Strings; projectId: string }) {
  const [m, setM] = useState<Members | null>(null);
  const [targets, setTargets] = useState<{ users: string[]; groups: string[] }>({ users: [], groups: [] });
  const [dialog, setDialog] = useState<{ mode: "add" } | { mode: "edit"; member: ShareRow } | null>(null);
  const [pick, setPick] = useState<Pick>({ all: false, actions: [READ] });
  const [who, setWho] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const fail = useCallback((e: unknown, to: (m: string) => void) => to(e instanceof ApiError && (s.pd.errors as Record<string, string>)[e.code] ? (s.pd.errors as Record<string, string>)[e.code]! : describe(e, s)), [s]);
  const load = useCallback(async () => {
    try {
      const r = await listShares(projectId);
      setM(r);
      if (r.canManage) setTargets(await shareTargets(projectId));
    } catch (e) { fail(e, setError); }
  }, [projectId, fail]);
  useEffect(() => { void load(); }, [load]);

  const open = (d: NonNullable<typeof dialog>) => {
    setDialogError(null);
    setWho("");
    setPick({ all: false, actions: d.mode === "edit" ? (d.member.actions as Action[]) : [READ] });
    setDialog(d);
  };
  const target = (x: { kind: "user" | "group"; name: string }) => (x.kind === "user" ? { user: x.name } : { group: x.name });
  const save = async () => {
    if (!dialog) return;
    setDialogError(null);
    try {
      let to: { user: string } | { group: string };
      if (dialog.mode === "edit") to = target(dialog.member);
      else { const [kind, ...rest] = who.split(":"); to = kind === "user" ? { user: rest.join(":") } : { group: rest.join(":") }; }
      await putShare(projectId, to, "custom", [...new Set([READ, ...pick.actions])]);
      toast(s.pd.saved);
      setDialog(null);
      await load();
    } catch (e) { fail(e, setDialogError); }
  };
  const remove = async (x: ShareRow) => {
    setError(null);
    try { await removeShare(projectId, x.id); toast(s.pd.removed); await load(); } catch (e) { fail(e, setError); }
  };

  if (!m) return error ? <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert> : null;
  const taken = new Set(m.shares.map((x) => `${x.kind}:${x.name}`));
  const users = targets.users.filter((u) => u !== m.owner && !taken.has(`user:${u}`));
  const groups = targets.groups.filter((g) => !taken.has(`group:${g}`));

  return (
    <div className="grid gap-4" data-testid="members">
      <div className="flex flex-wrap items-start gap-3">
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">{s.pd.membersText}</p>
        {m.canManage && <Button onClick={() => open({ mode: "add" })} data-testid="member-add"><Plus />{s.pd.addButton}</Button>}
      </div>
      {error && <Alert variant="destructive" role="alert"><AlertDescription data-testid="members-error">{error}</AlertDescription></Alert>}
      {!m.canManage && <p className="text-xs text-muted-foreground">{s.pd.readOnlyNote}</p>}

      <ul className="grid gap-2" data-testid="member-list">
        <li className="flex items-center gap-3 rounded-md border bg-muted/40 px-3 py-2 text-sm" data-testid="member-owner">
          <UserRound className="size-4 text-muted-foreground" />
          <span className="flex-1 font-medium">{m.owner}</span>
          <Badge>{s.pd.ownerRow}</Badge>
          <span className="w-44 text-xs text-muted-foreground">{s.pd.allPerms}</span>
        </li>
        {m.shares.length === 0 && <li className="px-1 text-sm text-muted-foreground">{s.pd.none}</li>}
        {m.shares.map((x) => (
          <li key={x.id} className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm" data-testid={`member-${x.kind}-${x.name}`}>
            {x.kind === "user" ? <UserRound className="size-4 text-muted-foreground" /> : <Users className="size-4 text-muted-foreground" />}
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{x.name}</div>
              {x.grantedBy && <div className="text-xs text-muted-foreground">{s.pd.by} {x.grantedBy}</div>}
            </div>
            <div className="max-w-[55%]"><Chips s={s} actions={x.actions} /></div>
            {m.canManage && <Button size="icon" variant="ghost" title={s.pd.editPerms} onClick={() => open({ mode: "edit", member: x })} data-testid="member-edit"><Pencil /></Button>}
            {m.canManage && <Button size="icon" variant="ghost" title={s.pd.remove} onClick={() => void remove(x)} data-testid="member-remove"><Trash2 /></Button>}
          </li>
        ))}
      </ul>

      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-xl" data-testid="member-dialog">
          <DialogHeader>
            <DialogTitle>{dialog?.mode === "edit" ? fill(s.pd.editTitle, { n: dialog.member.name }) : s.pd.addTitle}</DialogTitle>
            <DialogDescription>{s.pd.dialogText}</DialogDescription>
          </DialogHeader>
          {dialogError && <Alert variant="destructive" role="alert"><AlertDescription data-testid="member-dialog-error">{dialogError}</AlertDescription></Alert>}
          {dialog?.mode === "add" && (
            <Select value={who} onValueChange={setWho}>
              <SelectTrigger data-testid="member-pick"><SelectValue placeholder={s.pd.pick} /></SelectTrigger>
              <SelectContent>
                {users.length > 0 && <SelectGroup><SelectLabel>{s.pd.user}</SelectLabel>{users.map((u) => <SelectItem key={u} value={`user:${u}`}>{u}</SelectItem>)}</SelectGroup>}
                {groups.length > 0 && <SelectGroup><SelectLabel>{s.pd.group}</SelectLabel>{groups.map((g) => <SelectItem key={g} value={`group:${g}`}>{g}</SelectItem>)}</SelectGroup>}
              </SelectContent>
            </Select>
          )}
          <PermissionPicker s={s} groups={PROJECT_GROUPS} value={pick} onChange={setPick} holdable={m.mine} fixed={[READ]} />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialog(null)}>{s.adm.cancel}</Button>
            <Button disabled={dialog?.mode === "add" && !who} onClick={() => void save()} data-testid="member-save">{s.pd.save}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
