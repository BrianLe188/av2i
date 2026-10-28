import { useCallback, useEffect, useState } from "react";
import { PROJECT_ACTIONS, SYSTEM_GROUPS, parseDocument, selectionOf, type Action } from "@av2i/authz";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "../api.ts";
import { getPermissions, getPolicy, setDirectPermissions, type Permissions } from "../admin.ts";
import type { Strings } from "../i18n.ts";
import { describe } from "./auth/errors.ts";
import { PermissionPicker, type Pick } from "./PermissionPicker.tsx";

const SYSTEM_ACTIONS = SYSTEM_GROUPS.flatMap((g) => [...g.actions]);
const fill = (t: string, v: Record<string, string | number>) => t.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? ""));

/** The system permissions of a user or a group as tickboxes, and nothing else (DD-031); policies attached before are shown so that none hides. */
export function SystemPermissionsDialog({ s, kind, id, name, policies, open, onClose, onChanged }: {
  s: Strings; kind: "user" | "group"; id: string; name: string; policies: string[]; open: boolean; onClose: () => void; onChanged: () => void;
}) {
  const [data, setData] = useState<Permissions | null>(null);
  const [pick, setPick] = useState<Pick>({ all: false, actions: [] });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await getPermissions(kind, id);
      setData(d);
      setPick({ all: d.direct.all, actions: d.direct.actions as Action[] });
      setError(null);
    } catch (e) { setError(describe(e, s)); }
  }, [kind, id, s]);
  useEffect(() => { if (open) { setData(null); void load(); } }, [open, load]);

  const changed = !!data && (pick.all !== data.direct.all || pick.actions.length !== data.direct.actions.length || pick.actions.some((a) => !data.direct.actions.includes(a)));
  const hidden = pick.all ? [] : pick.actions.filter((a) => (PROJECT_ACTIONS as readonly string[]).includes(a));

  const save = async () => {
    setError(null);
    try { await setDirectPermissions(kind, id, pick); toast(s.acc.saved); onChanged(); onClose(); } catch (e) { setError(describe(e, s)); }
  };
  const detach = async (names: string[]) => api("PUT", `/api/${kind}s/${id}/policies`, { policies: policies.filter((p) => !names.includes(p)) });
  const detachOne = async (n: string) => {
    try { await detach([n]); onChanged(); await load(); } catch (e) { setError(describe(e, s)); }
  };
  /** Turns the policies attached before into ticks and detaches them: only when every one of them is a plain choice of permissions. */
  const convert = async () => {
    setError(null);
    try {
      let all = pick.all;
      const actions = new Set<Action>(pick.actions);
      for (const n of policies) {
        const d = await getPolicy(n);
        const p = parseDocument(d.policy.document);
        const sel = p.ok ? selectionOf(p.statements) : null;
        if (!sel || !sel.ok) { setError(fill(s.acc.legacyCannot, { n })); return; }
        all = all || sel.all;
        sel.actions.forEach((a) => actions.add(a));
      }
      await setDirectPermissions(kind, id, { all, actions: [...actions] });
      await detach(policies);
      toast(s.acc.legacyConverted);
      onChanged();
      await load();
    } catch (e) { setError(describe(e, s)); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl" data-testid="system-permissions-dialog">
        <DialogHeader>
          <DialogTitle>{s.acc.systemPerms}: {name}</DialogTitle>
          <DialogDescription>{kind === "user" ? s.acc.systemUser : s.acc.systemGroup}</DialogDescription>
        </DialogHeader>
        {error && <Alert variant="destructive" role="alert"><AlertDescription data-testid="system-permissions-error">{error}</AlertDescription></Alert>}
        {!data ? <p className="text-sm text-muted-foreground">{s.acc.loading}</p> : (
          <>
            <PermissionPicker s={s} groups={SYSTEM_GROUPS} value={pick} onChange={setPick} allToggle />
            {hidden.length > 0 && <p className="text-xs text-muted-foreground" data-testid="hidden-project-permissions">{fill(s.acc.hiddenProject, { n: hidden.length })}</p>}
            {policies.length > 0 && (
              <Alert data-testid="legacy-policies">
                <AlertTitle>{s.acc.legacyTitle}</AlertTitle>
                <AlertDescription className="grid gap-2">
                  <span>{s.acc.legacyText}</span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    {policies.map((n) => (
                      <Badge key={n} variant="outline" className="gap-1">{n}<button type="button" className="ml-1 text-muted-foreground hover:text-foreground" title={s.acc.legacyDetach} onClick={() => void detachOne(n)} data-testid={`detach-${n}`}>×</button></Badge>
                    ))}
                    <Button size="xs" variant="outline" onClick={() => void convert()} data-testid="legacy-convert">{s.acc.legacyConvert}</Button>
                  </span>
                </AlertDescription>
              </Alert>
            )}
          </>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{s.acct.cancel}</Button>
          <Button disabled={!changed} onClick={() => void save()} data-testid="system-permissions-save">{s.acc.save}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A short line for a table: all permissions, how many, or none. */
export function PermissionSummary({ s, direct }: { s: Strings; direct?: { all: boolean; count: number } }) {
  if (!direct || (!direct.all && direct.count === 0)) return <span className="text-xs text-muted-foreground">{s.acc.none}</span>;
  return <Badge variant={direct.all ? "default" : "secondary"}>{direct.all ? s.acc.all : fill(s.acc.count, { n: direct.count })}</Badge>;
}
