import { useState } from "react";
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

const BOOL_ENUM = ["", "true", "false"];

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
    <span className="flabel">
      {field.key}
      {field.required && <em title={s.required}>*</em>}
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
        <fieldset className="fobject">
          <legend>{field.key}</legend>
          <Fields fields={field.children ?? []} props={props} prefix={`${path}.`} s={s} groups={groups} refs={refs} onSet={onSet} />
        </fieldset>
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
        <div className="frow">
          {label}
          <RulesEditor value={Array.isArray(value) ? (value as unknown as Rule[]) : undefined} egress={field.key === "egress_rules"} s={s} groups={groups} onChange={(v) => onSet(path, v as unknown as Value | undefined)} />
        </div>
      );
    case "boolean":
      return (
        <label className="frow">
          {label}
          <select
            value={typeof value === "boolean" ? String(value) : ""}
            onChange={(e) => onSet(path, e.target.value === "" ? undefined : e.target.value === "true")}
            title={hint}
          >
            {BOOL_ENUM.map((v) => (
              <option key={v} value={v}>{v === "" ? (placeholder ?? "—") : v === "true" ? s.on : s.off}</option>
            ))}
          </select>
        </label>
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
        <label className="frow">
          {label}
          <textarea
            key={JSON.stringify(value)}
            defaultValue={value === undefined ? "" : JSON.stringify(value, null, 2)}
            rows={4}
            spellCheck={false}
            title={hint}
            onBlur={(e) => commit(e.target.value)}
          />
          {error && <span className="ferror">{error}</span>}
        </label>
      );
    default:
      return (
        <label className="frow">
          {label}
          <input
            key={String(value)}
            defaultValue={value === undefined || value === null ? "" : String(value)}
            placeholder={placeholder}
            title={hint}
            data-testid={`field-${path}`}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          />
          {error && <span className="ferror">{error}</span>}
        </label>
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
      <div className="rules">
        <p className="hint">{s.defaultEgress}</p>
        <button type="button" onClick={() => onChange([])}>{s.customEgress}</button>
      </div>
    );
  }
  const rules = value ?? [];
  const set = (i: number, r: Rule) => onChange(rules.map((x, j) => (j === i ? r : x)));
  const peerOf = (r: Rule) => PEERS.find((p) => r[p] !== undefined) ?? "cidr_ipv4";
  return (
    <div className="rules">
      {rules.map((r, i) => {
        const peer = peerOf(r);
        const all = r.ip_protocol === "-1";
        return (
          <div className="rule" key={i} data-testid={`rule-${i}`}>
            <div className="rule-line">
              <select value={r.ip_protocol} aria-label={s.protocol} onChange={(e) => { const { from_port, to_port, ...rest } = r; set(i, e.target.value === "-1" ? { ...rest, ip_protocol: "-1" } : { ...r, ip_protocol: e.target.value, from_port: from_port ?? 0, to_port: to_port ?? 0 }); }}>
                {PROTOCOLS.map((p) => <option key={p} value={p}>{p === "-1" ? "all" : p}</option>)}
              </select>
              {!all && (
                <>
                  <input className="port" type="number" aria-label={s.fromPort} defaultValue={r.from_port} key={`f${r.from_port}`} onBlur={(e) => set(i, { ...r, from_port: e.target.value === "" ? undefined : Number(e.target.value) })} />
                  <span>–</span>
                  <input className="port" type="number" aria-label={s.toPort} defaultValue={r.to_port} key={`t${r.to_port}`} onBlur={(e) => set(i, { ...r, to_port: e.target.value === "" ? undefined : Number(e.target.value) })} />
                </>
              )}
              <button type="button" className="icon" aria-label={s.delete} onClick={() => onChange(rules.filter((_, j) => j !== i))}>×</button>
            </div>
            <div className="rule-line">
              <select
                value={peer}
                aria-label={s.peer}
                onChange={(e) => { const { cidr_ipv4, cidr_ipv6, prefix_list_id, referenced_security_group_id, ...rest } = r; void [cidr_ipv4, cidr_ipv6, prefix_list_id, referenced_security_group_id]; set(i, { ...rest, [e.target.value]: e.target.value === "referenced_security_group_id" ? (groups[0]?.key ?? "") : "" }); }}
              >
                {PEERS.map((p) => <option key={p} value={p}>{peerLabel[p]}</option>)}
              </select>
              {peer === "referenced_security_group_id" ? (
                <select value={r.referenced_security_group_id ?? ""} onChange={(e) => set(i, { ...r, referenced_security_group_id: e.target.value })}>
                  {groups.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
                </select>
              ) : (
                <input key={`${peer}${r[peer]}`} defaultValue={r[peer] ?? ""} placeholder={peer === "cidr_ipv4" ? "10.0.0.0/16" : ""} aria-label={peerLabel[peer]} data-testid={`rule-${i}-peer`} onBlur={(e) => set(i, { ...r, [peer]: e.target.value })} />
              )}
            </div>
            <input className="rule-desc" placeholder={s.description} defaultValue={r.description ?? ""} key={`d${r.description}`} onBlur={(e) => set(i, { ...r, description: e.target.value === "" ? undefined : e.target.value })} />
          </div>
        );
      })}
      <button type="button" data-testid={egress ? "add-egress" : "add-ingress"} onClick={() => onChange([...rules, { ip_protocol: "tcp", from_port: 443, to_port: 443, cidr_ipv4: "10.0.0.0/16" }])}>+ {s.addRule}</button>
      {egress && <button type="button" className="link" onClick={() => onChange(undefined)}>{s.default}</button>}
    </div>
  );
}
