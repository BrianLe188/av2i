import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OptionSelect } from "@/components/ui/option-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { Props, Value } from "@av2i/model";
import type { Field } from "../logic/form.ts";
import { getIn } from "../logic/design.ts";
import { parseInput } from "../logic/form.ts";
import type { Strings } from "../i18n.ts";

interface FieldsProps {
  fields: Field[];
  props: Props;
  /** path prefix for nested objects, e.g. "metadata_options" */
  prefix?: string;
  s: Strings;
  /** one entry per security group of the design, for rules that name a group as peer */
  groups: { key: string; label: string }[];
  /** the nodes a `node` field can point at */
  refs?: { key: string; label: string; service: string; part?: string }[];
  onSet: (path: string, value: Value | undefined) => void;
}


export function Fields({ fields, props, prefix = "", s, groups, refs = [], onSet }: FieldsProps) {
  return (
    <>
      {fields.map((f) => (
        <FieldRow key={f.key} field={f} path={prefix + f.key} props={props} s={s} groups={groups} refs={refs} onSet={onSet} />
      ))}
    </>
  );
}

function FieldRow({ field, path, props, s, groups, refs, onSet }: { field: Field; path: string; props: Props; s: Strings; groups: FieldsProps["groups"]; refs: NonNullable<FieldsProps["refs"]>; onSet: FieldsProps["onSet"] }) {
  const value = getIn(props, path);
  const [error, setError] = useState<string | null>(null);
  const label = (
    <span className="mb-1 block font-mono text-[11px] text-muted-foreground">
      {field.key}
      {field.required && <em className="ml-0.5 not-italic text-destructive" title={s.required}>*</em>}
    </span>
  );
  const hint = field.constraints.length ? field.constraints[0] : undefined;
  const placeholder = field.fallback !== undefined ? `${s.default}: ${field.fallback}` : undefined;
  const commit = (text: string) => {
    const parsed = parseInput(field.type, text);
    if (parsed instanceof Error) { setError(field.type === "json" ? s.invalidJson : s.invalidNumber); return; }
    setError(null);
    if (JSON.stringify(parsed) !== JSON.stringify(value)) onSet(path, parsed as Value | undefined);
  };

  switch (field.type) {
    case "object":
      return (
        <fieldset className="my-2.5 rounded-md border px-2 pb-1">
          <legend className="px-1 font-mono text-[11px] text-muted-foreground">{field.key}</legend>
          <Fields fields={field.children ?? []} props={props} prefix={`${path}.`} s={s} groups={groups} refs={refs} onSet={onSet} />
        </fieldset>
      );
    case "node": {
      const options = refs.filter((r) => r.service === field.of?.service && (field.of?.part === undefined || r.part === field.of.part));
      return (
        <div className="my-2">
          {label}
          <OptionSelect value={typeof value === "string" && value !== "" ? value : undefined} placeholder="—" options={options.map((o) => ({ value: o.key, label: o.label }))} onChange={(v) => onSet(path, v)} testId={`field-${path}`} title={hint} />
        </div>
      );
    }
    case "rules":
      return (
        <div className="my-2">
          {label}
          <RulesEditor value={Array.isArray(value) ? (value as unknown as Rule[]) : undefined} egress={field.key === "egress_rules"} s={s} groups={groups} onChange={(v) => onSet(path, v as unknown as Value | undefined)} />
        </div>
      );
    case "boolean":
      return (
        <div className="my-2">
          {label}
          <OptionSelect
            value={typeof value === "boolean" ? String(value) : undefined}
            placeholder={placeholder ?? "—"}
            options={[{ value: "true", label: s.on }, { value: "false", label: s.off }]}
            onChange={(v) => onSet(path, v === undefined ? undefined : v === "true")}
            title={hint}
          />
        </div>
      );
    case "enum":
      return (
        <div className="my-2">
          {label}
          <OptionSelect value={typeof value === "string" ? value : undefined} placeholder={placeholder ?? "—"} options={(field.values ?? []).map((v) => ({ value: String(v) }))} onChange={(v) => onSet(path, v)} title={hint} />
        </div>
      );
    case "node": {
      const options = refs.filter((r) => r.service === field.of?.service && (field.of?.part === undefined || r.part === field.of.part));
      return (
        <label className="frow">
          {label}
          <select value={typeof value === "string" ? value : ""} data-testid={`field-${path}`} onChange={(e) => onSet(path, e.target.value === "" ? undefined : e.target.value)} title={hint}>
            <option value="">—</option>
            {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </label>
      );
    }
    case "rules":
      return (
        <div className="my-2">
          {label}
          <RulesEditor value={Array.isArray(value) ? (value as unknown as Rule[]) : undefined} egress={field.key === "egress_rules"} s={s} groups={groups} onChange={(v) => onSet(path, v as unknown as Value | undefined)} />
        </div>
      );
    case "boolean":
      return (
        <div className="my-2">
          {label}
          <OptionSelect
            value={typeof value === "boolean" ? String(value) : undefined}
            placeholder={placeholder ?? "—"}
            options={[{ value: "true", label: s.on }, { value: "false", label: s.off }]}
            onChange={(v) => onSet(path, v === undefined ? undefined : v === "true")}
            title={hint}
          />
        </div>
      );
    case "enum":
      return (
        <label className="frow">
          {label}
          <select value={typeof value === "string" ? value : ""} onChange={(e) => onSet(path, e.target.value === "" ? undefined : e.target.value)} title={hint}>
            <option value="">{placeholder ?? "—"}</option>
            {field.values?.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
      );
    case "json":
      return (
        <div className="my-2">
          {label}
          <Textarea
            key={JSON.stringify(value)}
            defaultValue={value === undefined ? "" : JSON.stringify(value, null, 2)}
            rows={4}
            spellCheck={false}
            title={hint}
            className="font-mono text-xs"
            onBlur={(e) => commit(e.target.value)}
          />
          {error && <span className="text-[11px] text-destructive">{error}</span>}
        </div>
      );
    default:
      return (
        <div className="my-2">
          {label}
          <Input
            key={String(value)}
            defaultValue={value === undefined || value === null ? "" : String(value)}
            placeholder={placeholder}
            title={hint}
            className="h-8"
            data-testid={`field-${path}`}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          />
          {error && <span className="text-[11px] text-destructive">{error}</span>}
        </div>
      );
  }
}

interface Rule {
  ip_protocol: string;
  from_port?: number;
  to_port?: number;
  cidr_ipv4?: string;
  cidr_ipv6?: string;
  prefix_list_id?: string;
  referenced_security_group_id?: string;
  description?: string;
}

const PEERS = ["cidr_ipv4", "cidr_ipv6", "prefix_list_id", "referenced_security_group_id"] as const;
const PROTOCOLS = ["tcp", "udp", "icmp", "icmpv6", "-1"];

function RulesEditor({ value, egress, s, groups, onChange }: { value: Rule[] | undefined; egress: boolean; s: Strings; groups: FieldsProps["groups"]; onChange: (v: Rule[] | undefined) => void }) {
  const peerLabel: Record<(typeof PEERS)[number], string> = { cidr_ipv4: s.cidr4, cidr_ipv6: s.cidr6, prefix_list_id: s.prefix, referenced_security_group_id: s.sgref };
  if (value === undefined && egress) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-xs text-muted-foreground">{s.defaultEgress}</p>
        <Button variant="outline" size="sm" onClick={() => onChange([])}>{s.customEgress}</Button>
      </div>
    );
  }
  const rules = value ?? [];
  const set = (i: number, r: Rule) => onChange(rules.map((x, j) => (j === i ? r : x)));
  const peerOf = (r: Rule) => PEERS.find((p) => r[p] !== undefined) ?? "cidr_ipv4";
  return (
    <div className="flex flex-col gap-2">
      {rules.map((r, i) => {
        const peer = peerOf(r);
        const all = r.ip_protocol === "-1";
        return (
          <div className="flex flex-col gap-1 rounded-md border p-1.5" key={i} data-testid={`rule-${i}`}>
            <div className="flex items-center gap-1">
              <Select value={r.ip_protocol} onValueChange={(v) => { const { from_port, to_port, ...rest } = r; set(i, v === "-1" ? { ...rest, ip_protocol: "-1" } : { ...r, ip_protocol: v, from_port: from_port ?? 0, to_port: to_port ?? 0 }); }}>
                <SelectTrigger size="sm" aria-label={s.protocol} className="w-24"><SelectValue /></SelectTrigger>
                <SelectContent>{PROTOCOLS.map((p) => <SelectItem key={p} value={p}>{p === "-1" ? "all" : p}</SelectItem>)}</SelectContent>
              </Select>
              {!all && (
                <>
                  <Input className="h-8 w-[70px]" type="number" aria-label={s.fromPort} defaultValue={r.from_port} key={`f${r.from_port}`} onBlur={(e) => set(i, { ...r, from_port: e.target.value === "" ? undefined : Number(e.target.value) })} />
                  <span>–</span>
                  <Input className="h-8 w-[70px]" type="number" aria-label={s.toPort} defaultValue={r.to_port} key={`t${r.to_port}`} onBlur={(e) => set(i, { ...r, to_port: e.target.value === "" ? undefined : Number(e.target.value) })} />
                </>
              )}
              <Button variant="ghost" size="icon-xs" aria-label={s.delete} className="ml-auto" onClick={() => onChange(rules.filter((_, j) => j !== i))}><X /></Button>
            </div>
            <div className="flex items-center gap-1">
              <Select
                value={peer}
                onValueChange={(v) => { const { cidr_ipv4, cidr_ipv6, prefix_list_id, referenced_security_group_id, ...rest } = r; void [cidr_ipv4, cidr_ipv6, prefix_list_id, referenced_security_group_id]; set(i, { ...rest, [v]: v === "referenced_security_group_id" ? (groups[0]?.key ?? "") : "" }); }}
              >
                <SelectTrigger size="sm" aria-label={s.peer} className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>{PEERS.map((p) => <SelectItem key={p} value={p}>{peerLabel[p]}</SelectItem>)}</SelectContent>
              </Select>
              {peer === "referenced_security_group_id" ? (
                <Select value={r.referenced_security_group_id ?? ""} onValueChange={(v) => set(i, { ...r, referenced_security_group_id: v })}>
                  <SelectTrigger size="sm" className="min-w-0 flex-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{groups.map((g) => <SelectItem key={g.key} value={g.key}>{g.label}</SelectItem>)}</SelectContent>
                </Select>
              ) : (
                <Input className="h-8 min-w-0 flex-1" key={`${peer}${r[peer]}`} defaultValue={r[peer] ?? ""} placeholder={peer === "cidr_ipv4" ? "10.0.0.0/16" : ""} aria-label={peerLabel[peer]} data-testid={`rule-${i}-peer`} onBlur={(e) => set(i, { ...r, [peer]: e.target.value })} />
              )}
            </div>
            <Input className="h-8" placeholder={s.description} defaultValue={r.description ?? ""} key={`d${r.description}`} onBlur={(e) => set(i, { ...r, description: e.target.value === "" ? undefined : e.target.value })} />
          </div>
        );
      })}
      <Button variant="outline" size="sm" className="w-fit" data-testid={egress ? "add-egress" : "add-ingress"} onClick={() => onChange([...rules, { ip_protocol: "tcp", from_port: 443, to_port: 443, cidr_ipv4: "10.0.0.0/16" }])}><Plus />{s.addRule}</Button>
      {egress && <Button variant="link" size="sm" className="w-fit px-0" onClick={() => onChange(undefined)}>{s.default}</Button>}
    </div>
  );
}
