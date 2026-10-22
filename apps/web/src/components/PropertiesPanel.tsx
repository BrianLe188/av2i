import {
  classifyEdge,
  EDGE_INFO,
  RESOURCES,
  S3_ACCESS_LEVELS,
  vpcOf,
  type FieldDef,
  type GraphNode,
  type Issue,
  type PropValue,
} from '@av2i/core';
import type { AlignMode } from '@av2i/core';
import { Copy, CopyPlus, Maximize2, Trash2 } from 'lucide-react';
import { useStore } from '../store';
import { RulesEditor } from './RulesEditor';
import { FormField } from './FormField';
import { SimpleSelect } from './SimpleSelect';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function Field({
  def,
  value,
  node,
  nodes,
  onChange,
}: {
  def: FieldDef;
  value: PropValue;
  node: GraphNode;
  nodes: GraphNode[];
  onChange: (v: PropValue) => void;
}) {
  switch (def.type) {
    case 'rules':
      return <RulesEditor def={def} node={node} nodes={nodes} value={String(value)} onChange={onChange} />;
    case 'ref': {
      // Another node of `refType` that lives in the same VPC as this one.
      const vpcId = node.type === 'vpc' ? node.id : vpcOf(nodes, node)?.id;
      const choices = nodes.filter((n) => n.type === def.refType && vpcOf(nodes, n)?.id === vpcId);
      return (
        <FormField label={def.label} hint={def.hint}>
          <SimpleSelect
            label={def.label}
            value={String(value)}
            onChange={onChange}
            options={[{ value: '', label: 'None: one per resource' }, ...choices.map((n) => ({ value: n.id, label: n.name }))]}
          />
        </FormField>
      );
    }
    case 'boolean':
      return (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Checkbox id={`f-${def.key}`} checked={Boolean(value)} onCheckedChange={(c) => onChange(c === true)} />
            <Label htmlFor={`f-${def.key}`} className="text-sm">
              {def.label}
            </Label>
          </div>
          {def.hint && <p className="pl-6 text-[11px] leading-snug text-muted-foreground">{def.hint}</p>}
        </div>
      );
    case 'select':
      return (
        <FormField label={def.label} hint={def.hint}>
          <SimpleSelect label={def.label} value={String(value)} onChange={onChange} options={def.options!.map((o) => ({ value: o, label: o }))} />
        </FormField>
      );
    case 'number':
      return (
        <FormField label={def.label} hint={def.hint}>
          <Input type="number" value={Number(value)} onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))} />
        </FormField>
      );
    default:
      return (
        <FormField label={def.label} hint={def.hint}>
          <Input type="text" value={String(value)} onChange={(e) => onChange(e.target.value)} />
        </FormField>
      );
  }
}

function EdgePanel({ edgeId, issues }: { edgeId: string; issues: Issue[] }) {
  const nodes = useStore((s) => s.nodes);
  const edge = useStore((s) => s.edges.find((e) => e.id === edgeId));
  const updateEdge = useStore((s) => s.updateEdge);
  const removeEdge = useStore((s) => s.removeEdge);
  if (!edge) return <p className="text-sm text-muted-foreground">Connection not found.</p>;

  const r = classifyEdge(nodes, edge);
  const info = r.kind ? EDGE_INFO[r.kind] : null;
  const mine = issues.filter((i) => i.edgeId === edgeId);
  return (
    <div className="flex flex-col gap-3">
      <PanelTitle>Connection</PanelTitle>
      <p className="text-sm">
        <strong>{r.from?.name ?? nodes.find((n) => n.id === edge.source)?.name}</strong>
        {' \u2192 '}
        <strong>{r.to?.name ?? nodes.find((n) => n.id === edge.target)?.name}</strong>
      </p>
      {info && (
        <>
          <p className="text-sm">{info.title}</p>
          <p className="text-xs text-muted-foreground">{info.generates}</p>
        </>
      )}
      {r.kind === 's3-access' && (
        <FormField label="Access">
          <SimpleSelect
            label="Access"
            value={String(edge.props?.access ?? 'read')}
            onChange={(v) => updateEdge(edge.id, { access: v })}
            options={S3_ACCESS_LEVELS.map((a) => ({ value: a, label: a === 'readwrite' ? 'Read and write' : 'Read only' }))}
          />
        </FormField>
      )}
      <IssueList issues={mine} />
      <Button variant="destructive" size="sm" className="self-start" onClick={() => removeEdge(edge.id)}>
        <Trash2 /> Delete connection
      </Button>
    </div>
  );
}

const ALIGNS: { mode: AlignMode; label: string }[] = [
  { mode: 'left', label: 'Left' },
  { mode: 'center', label: 'Center' },
  { mode: 'right', label: 'Right' },
  { mode: 'top', label: 'Top' },
  { mode: 'middle', label: 'Middle' },
  { mode: 'bottom', label: 'Bottom' },
];

function SelectionPanel() {
  const count = useStore((s) => s.selectedIds.length);
  const { align, distribute, copy, duplicate, removeMany } = useStore.getState();
  return (
    <div className="flex flex-col gap-3">
      <PanelTitle>{count} resources selected</PanelTitle>
      <FormField label="Align">
        <div className="flex flex-wrap gap-1.5">
          {ALIGNS.map((a) => (
            <Button key={a.mode} variant="outline" size="xs" onClick={() => align(a.mode)}>
              {a.label}
            </Button>
          ))}
        </div>
      </FormField>
      <FormField label="Distribute evenly">
        <div className="flex flex-wrap gap-1.5">
          <Button variant="outline" size="xs" onClick={() => distribute('horizontal')}>
            Horizontally
          </Button>
          <Button variant="outline" size="xs" onClick={() => distribute('vertical')}>
            Vertically
          </Button>
        </div>
      </FormField>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={copy}>
          <Copy /> Copy
        </Button>
        <Button variant="outline" size="sm" onClick={duplicate}>
          <CopyPlus /> Duplicate
        </Button>
        <Button variant="destructive" size="sm" onClick={() => removeMany(useStore.getState().selectedIds)}>
          <Trash2 /> Delete
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Shift-drag on the canvas or Cmd/Ctrl-click to select several. Align and distribute work on resources
        inside the same container.
      </p>
    </div>
  );
}

function PanelTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{children}</h3>;
}

function IssueList({ issues }: { issues: Issue[] }) {
  if (issues.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1.5">
      {issues.map((i, k) => (
        <li
          key={k}
          className={`rounded-md border-l-[3px] px-2 py-1.5 text-[13px] ${i.severity === 'error' ? 'border-destructive bg-destructive/10' : 'border-amber-500 bg-amber-500/10'}`}
        >
          {i.message}
        </li>
      ))}
    </ul>
  );
}

export function PropertiesPanel({ issues }: { issues: Issue[] }) {
  const nodes = useStore((s) => s.nodes);
  const selectedId = useStore((s) => s.selectedId);
  const updateNode = useStore((s) => s.updateNode);
  const remove = useStore((s) => s.remove);
  const fit = useStore((s) => s.fit);
  const selectedEdgeId = useStore((s) => s.selectedEdgeId);
  const selectedIds = useStore((s) => s.selectedIds);
  const node = nodes.find((n) => n.id === selectedId);

  if (selectedIds.length > 1) return <SelectionPanel />;
  if (!node && selectedEdgeId) return <EdgePanel edgeId={selectedEdgeId} issues={issues} />;

  if (!node) {
    return (
      <div className="flex flex-col gap-2 text-sm">
        <p>Select a resource to edit its properties.</p>
        <p className="text-xs text-muted-foreground">
          {nodes.length} resource{nodes.length === 1 ? '' : 's'} on the canvas. Drag from one
          resource's side handle to another to connect them: IGW ↔ Route table ↔ Subnet, NAT ↔ Route table, Security group ↔ EC2/Lambda/RDS/ALB, EC2/Lambda/ECS ↔ RDS,
          Load balancer ↔ EC2/ECS, EC2/Lambda ↔ S3, CloudFront ↔ S3/Load balancer, DNS record ↔ Load balancer/CloudFront.
        </p>
      </div>
    );
  }

  const def = RESOURCES[node.type];
  const mine = issues.filter((i) => i.nodeId === node.id);

  return (
    <div className="flex flex-col gap-3">
      <PanelTitle>{def.label}</PanelTitle>
      <FormField label="Name">
        <Input type="text" value={node.name} onChange={(e) => updateNode(node.id, { name: e.target.value })} />
      </FormField>
      {def.fields.map((f) => (
        <Field
          key={f.key}
          def={f}
          node={node}
          nodes={nodes}
          value={node.props[f.key] ?? f.default}
          onChange={(v) => updateNode(node.id, { props: { [f.key]: v } })}
        />
      ))}
      <IssueList issues={mine} />
      <div className="flex gap-2">
        {def.kind === 'container' && (
          <Button variant="outline" size="sm" onClick={() => fit(node.id)}>
            <Maximize2 /> Fit to content
          </Button>
        )}
        <Button variant="destructive" size="sm" onClick={() => remove(node.id)}>
          <Trash2 /> Delete
        </Button>
      </div>
    </div>
  );
}
