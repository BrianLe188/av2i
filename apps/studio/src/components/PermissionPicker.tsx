import { ShieldAlert } from "lucide-react";
import { SENSITIVE, type Action } from "@av2i/authz";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import type { Strings } from "../i18n.ts";

export interface Pick { all: boolean; actions: Action[] }
export interface PickerGroup { id: string; actions: readonly Action[] }

const fill = (t: string, v: Record<string, string | number>) => t.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? ""));

/**
 * The permissions of one scope as tickboxes in groups, with what each lets a person do (DD-031): the system ones, or the ones of a project.
 * Permissions of the value that are not shown (the other scope) are kept as they are. `holdable` limits what can be ticked to what the person
 * holds themselves; `fixed` permissions are always on; `allToggle` offers "all permissions", saved as `*` so future ones are included.
 */
export function PermissionPicker({ s, groups, value, onChange, disabled, holdable, fixed, allToggle }: {
  s: Strings; groups: readonly PickerGroup[]; value: Pick; onChange: (v: Pick) => void; disabled?: boolean;
  holdable?: readonly string[]; fixed?: readonly Action[]; allToggle?: boolean;
}) {
  const shown = groups.flatMap((g) => [...g.actions]);
  const has = (a: Action) => value.all || value.actions.includes(a) || !!fixed?.includes(a);
  const can = (a: Action) => !disabled && !value.all && !fixed?.includes(a) && (!holdable || holdable.includes(a));
  const set = (ticked: Action[]) => onChange({ all: false, actions: [...value.actions.filter((a) => !shown.includes(a)), ...ticked] });
  const toggle = (a: Action, on: boolean) => set(on ? [...shown.filter((x) => value.actions.includes(x)), a] : shown.filter((x) => x !== a && value.actions.includes(x)));
  const count = value.all ? shown.length : shown.filter(has).length;
  return (
    <div className="grid gap-3" data-testid="permission-picker">
      {allToggle && (
        <label className="flex items-start gap-3 rounded-md border p-3">
          <Switch checked={value.all} disabled={disabled} onCheckedChange={(on) => onChange({ all: on, actions: value.actions })} data-testid="perm-all" />
          <span className="text-sm"><span className="font-medium">{s.perm.all}</span><span className="block text-xs text-muted-foreground">{s.perm.allHelp}</span></span>
        </label>
      )}
      <p className="text-xs text-muted-foreground" data-testid="perm-count">{fill(s.perm.selected, { n: count, m: shown.length })}</p>
      {groups.map((g) => {
        const on = g.actions.filter(has).length;
        const free = g.actions.filter(can);
        return (
          <fieldset key={g.id} className="rounded-md border p-3" data-testid={`perm-group-${g.id}`}>
            <legend className="px-1 text-sm font-medium">{(s.perm.groups as Record<string, string>)[g.id]}</legend>
            {g.actions.length > 1 && (
              <label className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                <Checkbox checked={on === g.actions.length ? true : on === 0 ? false : "indeterminate"} disabled={free.length === 0}
                  onCheckedChange={(c) => set(c === true ? [...new Set([...shown.filter((x) => value.actions.includes(x)), ...free])] : shown.filter((x) => value.actions.includes(x) && !free.includes(x)))} data-testid={`perm-group-toggle-${g.id}`} />
                {s.perm.selectGroup} ({on}/{g.actions.length})
              </label>
            )}
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {g.actions.map((a) => (
                <li key={a}>
                  <label className={`flex items-center gap-2 text-sm ${has(a) || can(a) ? "" : "opacity-50"}`} title={holdable && !holdable.includes(a) && !fixed?.includes(a) ? s.pd.cantGrant : undefined}>
                    <Checkbox checked={has(a)} disabled={!can(a)} onCheckedChange={(c) => toggle(a, c === true)} data-testid={`perm-${a}`} />
                    <span>{(s.perm.actions as Record<string, string>)[a]}</span>
                    {SENSITIVE.has(a) && <Badge variant="outline" className="gap-1 text-[10px]"><ShieldAlert className="size-3" />{s.perm.sensitive}</Badge>}
                  </label>
                  <code className="ml-6 text-[11px] text-muted-foreground">{a}</code>
                </li>
              ))}
            </ul>
          </fieldset>
        );
      })}
    </div>
  );
}
