import { useCallback, useEffect, useState } from "react";
import { Share2, Trash2, UserRound, Users } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Strings } from "../i18n.ts";
import { listShares, putShare, removeShare, shareTargets, type ShareRow } from "../projects.ts";
import { describe } from "./auth/errors.ts";

type Role = ShareRow["role"];

/** Who else can open this project, and with what access. Only people who may share it get here. */
export function ShareDialog({ s, projectId, open, onClose }: { s: Strings; projectId: string; open: boolean; onClose: () => void }) {
  const [owner, setOwner] = useState<string | null>(null);
  const [shares, setShares] = useState<ShareRow[] | null>(null);
  const [targets, setTargets] = useState<{ users: string[]; groups: string[] }>({ users: [], groups: [] });
  const [pick, setPick] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [l, t] = await Promise.all([listShares(projectId), shareTargets(projectId)]);
      setOwner(l.owner);
      setShares(l.shares);
      setTargets(t);
    } catch (e) { setError(describe(e, s)); }
  }, [projectId, s]);
  useEffect(() => { if (open) { setError(null); setPick(""); void load(); } }, [open, load]);

  const run = async (job: () => Promise<unknown>, done: string) => {
    setError(null);
    try { await job(); toast(done); await load(); } catch (e) { setError(describe(e, s)); }
  };

  const add = () => {
    const [kind, ...rest] = pick.split(":");
    const name = rest.join(":");
    if (!name) return;
    void run(() => putShare(projectId, kind === "user" ? { user: name } : { group: name }, role), s.proj.shareAdded).then(() => setPick(""));
  };

  const taken = new Set((shares ?? []).map((x) => `${x.kind}:${x.name}`));
  const users = targets.users.filter((u) => u !== owner && !taken.has(`user:${u}`));
  const groups = targets.groups.filter((g) => !taken.has(`group:${g}`));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-lg" data-testid="share-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Share2 className="size-4" />{s.proj.shareTitle}</DialogTitle>
          <DialogDescription>{s.proj.shareText}</DialogDescription>
        </DialogHeader>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <Select value={pick} onValueChange={setPick}>
            <SelectTrigger className="min-w-0 flex-1" data-testid="share-pick"><SelectValue placeholder={s.proj.sharePick} /></SelectTrigger>
            <SelectContent>
              {users.length > 0 && (
                <SelectGroup>
                  <SelectLabel>{s.proj.shareUser}</SelectLabel>
                  {users.map((u) => <SelectItem key={u} value={`user:${u}`}>{u}</SelectItem>)}
                </SelectGroup>
              )}
              {groups.length > 0 && (
                <SelectGroup>
                  <SelectLabel>{s.proj.shareGroup}</SelectLabel>
                  {groups.map((g) => <SelectItem key={g} value={`group:${g}`}>{g}</SelectItem>)}
                </SelectGroup>
              )}
            </SelectContent>
          </Select>
          <RoleSelect s={s} value={role} onChange={setRole} testid="share-role" />
          <Button type="submit" disabled={!pick} data-testid="share-add">{s.proj.shareAdd}</Button>
        </form>
        {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
        <ScrollArea className="min-h-0 flex-1">
          <ul className="grid gap-1.5 pr-3" data-testid="shares">
            <li className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
              <UserRound className="size-4 text-muted-foreground" />
              <span className="flex-1 font-medium">{owner}</span>
              <span className="text-muted-foreground">{s.proj.shareOwner}</span>
            </li>
            {shares?.length === 0 && <li className="px-1 text-sm text-muted-foreground">{s.proj.shareNone}</li>}
            {(shares ?? []).map((x) => (
              <li key={x.id} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm" data-testid={`share-${x.kind}-${x.name}`}>
                {x.kind === "user" ? <UserRound className="size-4 text-muted-foreground" /> : <Users className="size-4 text-muted-foreground" />}
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{x.name}</div>
                  {x.grantedBy && <div className="text-xs text-muted-foreground">{s.proj.shareBy} {x.grantedBy}</div>}
                </div>
                <RoleSelect s={s} value={x.role} onChange={(r) => void run(() => putShare(projectId, x.kind === "user" ? { user: x.name } : { group: x.name }, r), s.proj.shareAdded)} testid="share-row-role" />
                <Button size="icon" variant="ghost" title={s.proj.shareRemove} onClick={() => void run(() => removeShare(projectId, x.id), s.proj.shareRemoved)} data-testid="share-remove"><Trash2 /></Button>
              </li>
            ))}
          </ul>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function RoleSelect({ s, value, onChange, testid }: { s: Strings; value: Role; onChange: (r: Role) => void; testid: string }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Role)}>
      <SelectTrigger className="w-32" data-testid={testid}><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="viewer">{s.proj.shareViewer}</SelectItem>
        <SelectItem value="editor">{s.proj.shareEditor}</SelectItem>
      </SelectContent>
    </Select>
  );
}
