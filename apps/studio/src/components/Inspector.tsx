import { useMemo } from "react";
import type { Design, Value } from "@av2i/model";
import { reg } from "../registry.ts";
import type { Analysis } from "../logic/analyze.ts";
import { removeEdges, removeNodes, setIn, updateEdge, updateNode } from "../logic/design.ts";
import { fieldsOf } from "../logic/form.ts";
import type { Selection } from "../logic/flow.ts";
import { title } from "../logic/placement.ts";
import type { Lang, Strings } from "../i18n.ts";
import { Fields } from "./Fields.tsx";

const REGIONS = ["ap-southeast-1", "ap-southeast-2", "ap-northeast-1", "ap-south-1", "us-east-1", "us-west-2", "eu-west-1", "eu-central-1"];

interface Props {
  design: Design;
  analysis: Analysis;
  selection: Selection;
  lang: Lang;
  s: Strings;
  onEdit: (f: (d: Design) => Design) => void;
  onSelect: (sel: Selection) => void;
}

type PanelProps = { id: string } & Omit<Props, "selection">;

export function Inspector({ selection, ...rest }: Props) {
  const { s } = rest;
  return (
    <aside className="inspector" aria-label={s.inspector}>
      <h2>{s.inspector}</h2>
      {selection?.kind === "node" ? (
        <NodePanel key={selection.id} id={selection.id} {...rest} />
      ) : selection?.kind === "edge" ? (
        <EdgePanel key={selection.id} id={selection.id} {...rest} />
      ) : (
        <DesignPanel design={rest.design} s={s} onEdit={rest.onEdit} />
      )}
    </aside>
  );
}

function DesignPanel({ design, s, onEdit }: { design: Design; s: Strings; onEdit: Props["onEdit"] }) {
  return (
    <div className="panel">
      <p className="hint">{s.nothingSelected}</p>
      <h3>{s.designSettings}</h3>
      <label className="frow">
        <span className="flabel">{s.name}</span>
        <input defaultValue={design.name} key={design.name} onBlur={(e) => e.target.value !== design.name && onEdit((d) => ({ ...d, name: e.target.value }))} />
      </label>
      <label className="frow">
        <span className="flabel">{s.region}</span>
        <select value={design.settings.region} onChange={(e) => onEdit((d) => ({ ...d, settings: { ...d.settings, region: e.target.value } }))}>
          {[...new Set([design.settings.region, ...REGIONS])].map((r) => <option key={r}>{r}</option>)}
        </select>
      </label>
      <p className="hint">{design.nodes.length} {s.nodes} · {design.edges.length} {s.edges}</p>
    </div>
  );
}

function NodePanel({ id, design, analysis, lang, s, onEdit, onSelect }: PanelProps) {
  const node = design.nodes.find((n) => n.key === id);
  const generated = analysis.normalized?.nodes.find((n) => n.key === id);
  const fields = useMemo(() => (node ? fieldsOf(reg, node.service) : []), [node?.service]);
  const groups = design.nodes.filter((n) => n.service === "security-group").map((n) => ({ key: n.key, label: n.label }));
  const mine = analysis.findings.filter((f) => f.targets.includes(id));

  if (!node && generated) {
    return (
      <div className="panel" data-testid="inspector-generated">
        <h3>{generated.label}</h3>
        <p className="hint">{title(reg, generated.service, lang)}</p>
        <p className="notice">{s.generated}. {s.readOnly}</p>
        {generated.because && <p><b>{s.because}:</b> {generated.because}</p>}
      </div>
    );
  }
  if (!node) return null;

  const required = fields.filter((f) => f.required || f.type === "rules" || f.type === "object");
  const optional = fields.filter((f) => !required.includes(f));
  const onSet = (path: string, value: Value | undefined) => onEdit((d) => updateNode(d, id, (n) => ({ ...n, props: setIn(n.props, path, value) })));
  const parent = node.parent ? design.nodes.find((n) => n.key === node.parent) : undefined;

  return (
    <div className="panel" data-testid="inspector-node">
      <h3>{title(reg, node.service, lang)}</h3>
      <label className="frow">
        <span className="flabel">{s.label}</span>
        <input defaultValue={node.label} key={node.label} data-testid="field-label" onBlur={(e) => e.target.value !== node.label && onEdit((d) => updateNode(d, id, (n) => ({ ...n, label: e.target.value })))} />
      </label>
      <div className="meta"><span>{s.key}</span><code>{node.key}</code></div>
      <div className="meta"><span>{s.parent}</span><code>{parent ? parent.label : s.none}</code></div>
      <Fields fields={required} props={node.props} s={s} groups={groups} onSet={onSet} />
      {optional.length > 0 && (
        <details>
          <summary>{s.advanced}</summary>
          <Fields fields={optional} props={node.props} s={s} groups={groups} onSet={onSet} />
        </details>
      )}
      {mine.length > 0 && (
        <>
          <h3>{s.findings}</h3>
          <ul className="mini-findings">{mine.map((f, i) => <li key={i} className={`sev-${f.severity}`}><b>{f.rule}</b> {f.message[lang]}</li>)}</ul>
        </>
      )}
      <button type="button" className="danger" data-testid="delete-node" onClick={() => { onEdit((d) => removeNodes(d, [id])); onSelect(null); }}>{s.delete}</button>
    </div>
  );
}

function EdgePanel({ id, design, analysis, s, onEdit, onSelect }: PanelProps) {
  const edge = design.edges.find((e) => e.id === id);
  const generated = analysis.normalized?.edges.find((e) => e.id === id);
  const e = edge ?? generated;
  if (!e) return null;
  const name = (k: string) => design.nodes.find((n) => n.key === k)?.label ?? analysis.normalized?.nodes.find((n) => n.key === k)?.label ?? k;
  const dest = e.props?.destination_cidr_block;
  return (
    <div className="panel" data-testid="inspector-edge">
      <h3>{s.connection}</h3>
      <div className="meta"><span>{s.mechanism}</span><code>{(s.mech as Record<string, string>)[e.mechanism] ?? e.mechanism}</code></div>
      <div className="meta"><span>{s.from}</span><code>{name(e.from)}</code></div>
      <div className="meta"><span>{s.to}</span><code>{name(e.to)}</code></div>
      {!edge && <p className="notice">{s.generated}. {s.readOnly}{generated?.because ? ` ${generated.because}` : ""}</p>}
      {edge && e.mechanism === "route" && dest !== undefined && (
        <label className="frow">
          <span className="flabel">{s.destination}</span>
          <input defaultValue={String(dest)} key={String(dest)} data-testid="field-destination" onBlur={(ev) => ev.target.value !== dest && onEdit((d) => updateEdge(d, id, (x) => ({ ...x, props: { ...x.props, destination_cidr_block: ev.target.value } })))} />
        </label>
      )}
      {edge && <button type="button" className="danger" data-testid="delete-edge" onClick={() => { onEdit((d) => removeEdges(d, [id])); onSelect(null); }}>{s.delete}</button>}
    </div>
  );
}
