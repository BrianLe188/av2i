import { useState } from "react";
import { Input } from "@/components/ui/input";
import { OptionSelect } from "@/components/ui/option-select";
import { Textarea } from "@/components/ui/textarea";
import type { Props, Value } from "@av2i/model";
import type { Field } from "../logic/form.ts";
import { getIn } from "../logic/design.ts";
import { parseInput } from "../logic/form.ts";
import type { Strings } from "../i18n.ts";
import { SgRules, type SgRule } from "./SgRules.tsx";

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
      {fields.map((f) => f.key === "egress_rules" && fields.some((x) => x.key === "ingress_rules") ? null : f.key === "ingress_rules" ? (
        <SgRules
          key={f.key}
          ingress={getRules(props, `${prefix}ingress_rules`)}
          egress={getRules(props, `${prefix}egress_rules`)}
          s={s}
          groups={groups}
          onSet={(k, v) => onSet(prefix + k, v as unknown as Value | undefined)}
        />
      ) : (
        <FieldRow key={f.key} field={f} path={prefix + f.key} props={props} s={s} groups={groups} refs={refs} onSet={onSet} />
      ))}
    </>
  );
}

const getRules = (props: Props, path: string): SgRule[] | undefined => {
  const v = getIn(props, path);
  return Array.isArray(v) ? (v as unknown as SgRule[]) : undefined;
};

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
      return null;
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
      return null;
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
