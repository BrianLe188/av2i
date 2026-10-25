import { useMemo } from "react";
import { ChevronRight, Trash2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { OptionSelect } from "@/components/ui/option-select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Design, Value } from "@av2i/model";
import { reg } from "../registry.ts";
import type { Analysis } from "../logic/analyze.ts";
import { removeEdges, removeNodes, setIn, updateEdge, updateNode } from "../logic/design.ts";
import { fieldsOf } from "../logic/form.ts";
import type { Selection } from "../logic/flow.ts";
import { title } from "../logic/placement.ts";
import type { Lang, Strings } from "../i18n.ts";
import { Fields } from "./Fields.tsx";
import { GroupMembers } from "./GroupMembers.tsx";

const REGIONS = ["ap-southeast-1", "ap-southeast-2", "ap-northeast-1", "ap-south-1", "us-east-1", "us-west-2", "eu-west-1", "eu-central-1"];

interface Props {
  design: Design;
  analysis: Analysis;
  selection: Selection;
  lang: Lang;
  s: Strings;
  onEdit: (f: (d: Design) => Design) => void;
  onSelect: (sel: Selection) => void;
  /** the person may look but not change: every control inside is disabled */
  readOnly?: boolean;
}

type PanelProps = { id: string } & Omit<Props, "selection">;

export function Inspector({ selection, readOnly, ...rest }: Props) {
  const { s } = rest;
  return (
    <aside className="flex min-h-0 flex-col border-l bg-card" style={{ gridArea: "insp" }} aria-label={s.inspector}>
      <ScrollArea className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:!block">
      <div className="p-3">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{s.inspector}</h2>
      <fieldset disabled={readOnly} className="m-0 min-w-0 border-0 p-0">
      {selection?.kind === "node" ? (
        <NodePanel key={selection.id} id={selection.id} {...rest} />
      ) : selection?.kind === "edge" ? (
        <EdgePanel key={selection.id} id={selection.id} {...rest} />
      ) : (
        <DesignPanel design={rest.design} s={s} onEdit={rest.onEdit} />
      )}
      </fieldset>
      </div>
      </ScrollArea>
    </aside>
  );
}

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="my-2 block">
    <span className="mb-1 block font-mono text-[11px] text-muted-foreground">{label}</span>
    {children}
  </label>
);

const Meta = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="my-1 flex justify-between gap-2 text-xs text-muted-foreground"><span>{label}</span><code className="text-foreground">{children}</code></div>
);

const Hint = ({ children }: { children: React.ReactNode }) => <p className="my-1 text-xs text-muted-foreground">{children}</p>;

function DesignPanel({ design, s, onEdit }: { design: Design; s: Strings; onEdit: Props["onEdit"] }) {
  return (
    <div>
      <Hint>{s.nothingSelected}</Hint>
      <h3 className="mb-1 mt-3 text-sm font-semibold">{s.designSettings}</h3>
      <Row label={s.name}>
        <Input className="h-8" defaultValue={design.name} key={design.name} onBlur={(e) => e.target.value !== design.name && onEdit((d) => ({ ...d, name: e.target.value }))} />
      </Row>
      <Row label={s.region}>
        <Select value={design.settings.region} onValueChange={(v) => onEdit((d) => ({ ...d, settings: { ...d.settings, region: v } }))}>
          <SelectTrigger size="sm" className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>{[...new Set([design.settings.region, ...REGIONS])].map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
        </Select>
      </Row>
      <Hint>{design.nodes.length} {s.nodes} · {design.edges.length} {s.edges}</Hint>
    </div>
  );
}

function NodePanel({ id, design, analysis, lang, s, onEdit, onSelect }: PanelProps) {
  const node = design.nodes.find((n) => n.key === id);
  const generated = analysis.normalized?.nodes.find((n) => n.key === id);
  const part = typeof node?.props.part === "string" ? node.props.part : undefined;
  const fields = useMemo(() => (node ? fieldsOf(reg, node.service, part) : []), [node?.service, part]);
  const refs = design.nodes.map((n) => ({ key: n.key, label: n.label, service: n.service, part: typeof n.props.part === "string" ? n.props.part : undefined }));
  const groups = design.nodes.filter((n) => n.service === "security-group").map((n) => ({ key: n.key, label: n.label }));
  const mine = analysis.findings.filter((f) => f.targets.includes(id));

  if (!node && generated) {
    return (
      <div data-testid="inspector-generated">
        <h3 className="mb-1 text-sm font-semibold">{generated.label}</h3>
        <Hint>{title(reg, generated.service, lang)}</Hint>
        <Alert className="my-2"><AlertDescription>{s.generated}. {s.readOnly}</AlertDescription></Alert>
        {generated.because && <p className="text-sm"><b>{s.because}:</b> {generated.because}</p>}
      </div>
    );
  }
  if (!node) return null;

  const required = fields.filter((f) => f.required || f.type === "rules" || f.type === "object");
  const optional = fields.filter((f) => !required.includes(f));
  const onSet = (path: string, value: Value | undefined) => onEdit((d) => updateNode(d, id, (n) => ({ ...n, props: setIn(n.props, path, value) })));
  const parent = node.parent ? design.nodes.find((n) => n.key === node.parent) : undefined;

  return (
    <div data-testid="inspector-node">
      <h3 className="mb-1 text-sm font-semibold">{title(reg, node.service, lang)}</h3>
      <Row label={s.label}>
        <Input className="h-8" defaultValue={node.label} key={node.label} data-testid="field-label" onBlur={(e) => e.target.value !== node.label && onEdit((d) => updateNode(d, id, (n) => ({ ...n, label: e.target.value })))} />
      </Row>
      <Meta label={s.key}>{node.key}</Meta>
      <Meta label={s.parent}>{parent ? parent.label : s.none}</Meta>
      <Fields fields={required} props={node.props} s={s} groups={groups} refs={refs} onSet={onSet} />
      {node.service === "db-subnet-group" && <GroupMembers reg={reg} design={design} group={id} s={s} onEdit={onEdit} />}
      {optional.length > 0 && (
        <Collapsible className="mt-3">
          <CollapsibleTrigger className="group flex w-full items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ChevronRight className="size-4 transition-transform group-data-[state=open]:rotate-90" />{s.advanced}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <Fields fields={optional} props={node.props} s={s} groups={groups} refs={refs} onSet={onSet} />
          </CollapsibleContent>
        </Collapsible>
      )}
      {mine.length > 0 && (
        <>
          <h3 className="mb-1 mt-4 text-sm font-semibold">{s.findings}</h3>
          <ul className="flex flex-col gap-1.5 text-xs">
            {mine.map((f, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <Badge variant={f.severity === "error" ? "destructive" : "outline"} className={f.severity === "warning" ? "border-warning text-warning" : f.severity === "info" ? "border-info text-info" : ""}>{f.rule}</Badge>
                <span>{f.message[lang]}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <Button variant="outline" size="sm" className="mt-4 text-destructive hover:text-destructive" data-testid="delete-node" onClick={() => { onEdit((d) => removeNodes(d, [id])); onSelect(null); }}><Trash2 />{s.delete}</Button>
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
    <div data-testid="inspector-edge">
      <h3 className="mb-1 text-sm font-semibold">{s.connection}</h3>
      <Meta label={s.mechanism}>{(s.mech as Record<string, string>)[e.mechanism] ?? e.mechanism}</Meta>
      <Meta label={s.from}>{name(e.from)}</Meta>
      <Meta label={s.to}>{name(e.to)}</Meta>
      {!edge && <Alert className="my-2"><AlertDescription>{s.generated}. {s.readOnly}{generated?.because ? ` ${generated.because}` : ""}</AlertDescription></Alert>}
      {edge && e.mechanism === "route" && dest !== undefined && (
        <Row label={s.destination}>
          <Input className="h-8" defaultValue={String(dest)} key={String(dest)} data-testid="field-destination" onBlur={(ev) => ev.target.value !== dest && onEdit((d) => updateEdge(d, id, (x) => ({ ...x, props: { ...x.props, destination_cidr_block: ev.target.value } })))} />
        </Row>
      )}
      {edge && <EdgeProps edge={edge} design={design} s={s} onEdit={onEdit} />}
      {edge && <Button variant="outline" size="sm" className="mt-4 text-destructive hover:text-destructive" data-testid="delete-edge" onClick={() => { onEdit((d) => removeEdges(d, [id])); onSelect(null); }}><Trash2 />{s.delete}</Button>}
    </div>
  );
}

const LEVELS: Record<string, string[]> = { s3: ["read", "readwrite"], ecr: ["pull", "push"] };

/** The properties a connection carries: the role slot, the grant level, the port and the groups of a network access. */
function EdgeProps({ edge, design, s, onEdit }: { edge: Design["edges"][number]; design: Design; s: Strings; onEdit: Props["onEdit"] }) {
  const set = (key: string, value: Value | undefined) =>
    onEdit((d) => updateEdge(d, edge.id, (x) => {
      const props = { ...(x.props ?? {}) };
      if (value === undefined) delete props[key]; else props[key] = value;
      return { ...x, props: Object.keys(props).length ? props : undefined } as typeof x;
    }));
  const target = design.nodes.find((n) => n.key === edge.to);
  const source = design.nodes.find((n) => n.key === edge.from);
  const select = (key: string, label: string, options: { value: string; label: string }[], fallback?: string) => (
    <Row label={label}>
      <OptionSelect value={typeof edge.props?.[key] === "string" ? String(edge.props[key]) : undefined} placeholder={fallback ? `${s.default}: ${fallback}` : "—"} options={options} onChange={(v) => set(key, v)} testId={`edge-${key}`} />
    </Row>
  );
  const groupsOf = (key: string) => design.edges.filter((e) => e.mechanism === "sg-attach" && (e.to === key || e.from === key)).map((e) => (e.to === key ? e.from : e.to)).map((k) => ({ value: k, label: design.nodes.find((n) => n.key === k)?.label ?? k }));
  if (edge.mechanism === "assume-role" && target?.service === "ecs") {
    return select("slot", s.slot, [{ value: "task", label: s.slotTask }, { value: "execution", label: s.slotExecution }], "task");
  }
  if (edge.mechanism === "grant" && target && LEVELS[target.service]) {
    return select("level", s.level, LEVELS[target.service]!.map((v) => ({ value: v, label: v })), LEVELS[target.service]![0]);
  }
  if (edge.mechanism === "listener-target") {
    const port = edge.props?.port;
    const health = edge.props?.health_check;
    const path = health !== null && typeof health === "object" && !Array.isArray(health) ? (health as Record<string, Value>).path : undefined;
    return (
      <>
        <Row label={s.port}>
          <Input className="h-8" type="number" defaultValue={typeof port === "number" ? port : ""} key={String(port)} placeholder={s.portDefault} data-testid="edge-port" onBlur={(e) => set("port", e.target.value === "" ? undefined : Number(e.target.value))} />
        </Row>
        <Row label={s.healthPath}>
          <Input className="h-8" defaultValue={typeof path === "string" ? path : ""} key={String(path)} placeholder="/" data-testid="edge-health" onBlur={(e) => set("health_check", e.target.value === "" ? undefined : { ...(health !== null && typeof health === "object" && !Array.isArray(health) ? health : {}), path: e.target.value })} />
        </Row>
        <Row label={s.targetGroup}>
          <Input className="h-8" defaultValue={typeof edge.props?.target_group === "string" ? edge.props.target_group : ""} key={String(edge.props?.target_group)} data-testid="edge-target-group" onBlur={(e) => set("target_group", e.target.value === "" ? undefined : e.target.value)} />
        </Row>
      </>
    );
  }
  if (edge.mechanism === "dns-alias" && target?.service === "alb") {
    return (
      <Row label={s.recordName}>
        <Input className="h-8" defaultValue={typeof edge.props?.name === "string" ? edge.props.name : ""} key={String(edge.props?.name)} data-testid="edge-name" onBlur={(e) => set("name", e.target.value === "" ? undefined : e.target.value)} />
      </Row>
    );
  }
  if (edge.mechanism === "origin" && target?.service === "s3") {
    return (
      <>
        {select("access", s.originAccess, [{ value: "none", label: "none (public bucket)" }], "origin access control")}
        <Row label={s.originPath}>
          <Input className="h-8" defaultValue={typeof edge.props?.origin_path === "string" ? edge.props.origin_path : ""} key={String(edge.props?.origin_path)} data-testid="edge-origin-path" onBlur={(e) => set("origin_path", e.target.value === "" ? undefined : e.target.value)} />
        </Row>
      </>
    );
  }
  if (edge.mechanism === "network-access") {
    const port = edge.props?.port;
    return (
      <>
        <Row label={s.port}>
          <Input className="h-8" type="number" defaultValue={typeof port === "number" ? port : ""} key={String(port)} placeholder={s.portDefault} data-testid="edge-port" onBlur={(e) => set("port", e.target.value === "" ? undefined : Number(e.target.value))} />
        </Row>
        {groupsOf(edge.from).length > 1 && select("caller_sg", s.callerGroup, groupsOf(edge.from))}
        {groupsOf(edge.to).length > 1 && select("callee_sg", s.calleeGroup, groupsOf(edge.to))}
        {source && target && <p className="hint">{s.networkAccessHint}</p>}
      </>
    );
  }
  return null;
}
