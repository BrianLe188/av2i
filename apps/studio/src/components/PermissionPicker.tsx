import { ShieldAlert } from "lucide-react";
import { ACTION_GROUPS, SENSITIVE, type Action } from "@av2i/authz";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import type { Strings } from "../i18n.ts";

export interface Pick { all: boolean; actions: Action[] }

const fill = (t: string, v: Record<string, string | number>) => t.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? ""));
const TOTAL = ACTION_GROUPS.reduce((n, g) => n + g.actions.length, 0);

/** The permissions of the platform as tickboxes, in groups, with what each one lets a person do; "all" stands for every permission, new ones too. */
export function PermissionPicker({ s, value, onChange, disabled }: { s: Strings; value: Pick; onChange: (v: Pick) => void; disabled?: boolean }) {
  const has = (a: Action) => value.all || value.actions.includes(a);
  const toggle = (a: Action, on: boolean) => onChange({ all: false, actions: on ? [...value.actions, a] : value.actions.filter((x) => x !== a) });
  const count = value.all ? TOTAL : value.actions.length;
  return (
    <div className="grid gap-3" data-testid="permission-picker">
      <label className="flex items-start gap-3 rounded-md border p-3">
        <Switch checked={value.all} disabled={disabled} onCheckedChange={(on) => onChange(on ? { all: true, actions: ACTION_GROUPS.flatMap((g) => [...g.actions]) } : { all: false, actions: ACTION_GROUPS.flatMap((g) => [...g.actions]) })} data-testid="perm-all" />
        <span className="text-sm"><span className="font-medium">{s.perm.all}</span><span className="block text-xs text-muted-foreground">{s.perm.allHelp}</span></span>
      </label>
      <p className="text-xs text-muted-foreground" data-testid="perm-count">{fill(s.perm.selected, { n: count, m: TOTAL })} · {s.perm.scopeNote}</p>
      {ACTION_GROUPS.map((g) => {
        const on = g.actions.filter(has).length;
        return (
          <fieldset key={g.id} className="rounded-md border p-3" data-testid={`perm-group-${g.id}`}>
            <legend className="px-1 text-sm font-medium">{s.perm.groups[g.id]}</legend>
            <label className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox checked={on === g.actions.length ? true : on === 0 ? false : "indeterminate"} disabled={disabled || value.all}
                onCheckedChange={(c) => onChange({ all: false, actions: c === true ? [...new Set([...value.actions, ...g.actions])] : value.actions.filter((x) => !g.actions.includes(x)) })} data-testid={`perm-group-toggle-${g.id}`} />
              {s.perm.selectGroup} ({on}/{g.actions.length})
            </label>
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {g.actions.map((a) => (
                <li key={a}>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={has(a)} disabled={disabled || value.all} onCheckedChange={(c) => toggle(a, c === true)} data-testid={`perm-${a}`} />
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
