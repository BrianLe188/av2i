import { useCallback, useEffect, useState } from "react";
import { ACTION_GROUPS, type Action } from "@av2i/authz";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Strings } from "../i18n.ts";
import { getPermissions, setDirectPermissions, type Permissions } from "../admin.ts";
import { describe } from "./auth/errors.ts";
import { PermissionPicker, type Pick } from "./PermissionPicker.tsx";

const fill = (t: string, v: Record<string, string>) => t.replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? "");

/** Loads the permissions of a user or a group; the two panels below read the same answer. */
export function usePermissions(kind: "user" | "group", id: string, s: Strings) {
  const [data, setData] = useState<Permissions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setData(await getPermissions(kind, id)); setError(null); } catch (e) { setError(describe(e, s)); }
  }, [kind, id, s]);
  useEffect(() => { void load(); }, [load]);
  return { data, error, reload: load };
}

/** The permissions given straight to a user or a group, chosen with the picker (DD-030). */
export function DirectPermissions({ s, kind, id, data, reload }: { s: Strings; kind: "user" | "group"; id: string; data: Permissions; reload: () => Promise<void> }) {
  const [pick, setPick] = useState<Pick>({ all: data.direct.all, actions: data.direct.actions as Action[] });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setPick({ all: data.direct.all, actions: data.direct.actions as Action[] }); }, [data]);
  const changed = pick.all !== data.direct.all || pick.actions.length !== data.direct.actions.length || pick.actions.some((a) => !data.direct.actions.includes(a));
  const save = async () => {
    setError(null);
    try { await setDirectPermissions(kind, id, pick); toast(s.acc.directSaved); await reload(); } catch (e) { setError(describe(e, s)); }
  };
  return (
    <div className="grid gap-3" data-testid="direct-permissions">
      <p className="text-sm text-muted-foreground">{kind === "user" ? s.acc.directUser : s.acc.directGroup}</p>
      {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
      <PermissionPicker s={s} value={pick} onChange={setPick} />
      <Button className="w-fit" disabled={!changed} onClick={() => void save()} data-testid="direct-save">{s.acc.saveDirect}</Button>
    </div>
  );
}

/** Every permission of the system with whether it is allowed and where it comes from. */
export function EffectivePermissions({ s, data }: { s: Strings; data: Permissions }) {
  const by = new Map(data.effective.map((r) => [r.action, r]));
  return (
    <div className="grid gap-3" data-testid="effective-permissions">
      <p className="text-sm text-muted-foreground">{s.acc.effectiveText}</p>
      {ACTION_GROUPS.map((g) => (
        <div key={g.id} className="overflow-hidden rounded-md border">
          <p className="border-b bg-muted/40 px-3 py-1.5 text-sm font-medium">{s.perm.groups[g.id]}</p>
          <ul className="divide-y">
            {g.actions.map((a) => {
              const r = by.get(a);
              if (!r) return null;
              return (
                <li key={a} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 text-sm" data-testid={`eff-${a}`}>
                  <span className="min-w-52">{(s.perm.actions as Record<string, string>)[a]}<code className="ml-2 text-[11px] text-muted-foreground">{a}</code></span>
                  <Badge variant={r.denied ? "destructive" : r.allowed ? "default" : "secondary"} data-testid={`eff-status-${a}`}>{r.denied ? s.acc.denied : r.allowed ? s.acc.allowed : s.acc.notAllowed}</Badge>
                  <span className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                    {r.sources.length === 0 ? s.acc.noSource : r.sources.map((x, i) => (
                      <span key={i} className="rounded border px-1.5 py-0.5">
                        {x.kind === "policy" ? (x.group ? fill(s.acc.viaPolicyGroup, { n: x.name, g: x.group }) : fill(s.acc.viaPolicy, { n: x.name })) : (x.group ? fill(s.acc.viaDirectGroup, { g: x.group }) : s.acc.viaDirect)}
                        {x.scoped && ` · ${s.acc.scoped}`}
                      </span>
                    ))}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
