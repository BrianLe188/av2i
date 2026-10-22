import { Plus, X } from 'lucide-react';
import {
  expandRule,
  newRule,
  parseRules,
  peerOfSg,
  serializeRules,
  sgIdOfPeer,
  vpcOf,
  WORLD,
  type FieldDef,
  type GraphNode,
  type SgProtocol,
  type SgRule,
} from '@av2i/core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { SimpleSelect } from './SimpleSelect';

const PROTOCOLS = [
  { value: 'tcp', label: 'TCP' },
  { value: 'udp', label: 'UDP' },
  { value: 'icmp', label: 'ICMP' },
  { value: 'all', label: 'All traffic' },
];

type PeerMode = 'world' | 'cidr' | 'sg';
const modeOf = (peer: string): PeerMode => (sgIdOfPeer(peer) !== undefined ? 'sg' : peer.trim() === WORLD ? 'world' : 'cidr');

/** Editable list of security group rules, stored as JSON text in the node's props. */
export function RulesEditor({
  def,
  node,
  nodes,
  value,
  onChange,
}: {
  def: FieldDef;
  node: GraphNode;
  nodes: GraphNode[];
  value: string;
  onChange: (v: string) => void;
}) {
  const direction = def.direction ?? 'ingress';
  const rules = parseRules(value);
  const vpc = vpcOf(nodes, node);
  const groups = nodes.filter((n) => n.type === 'sg' && vpc && vpcOf(nodes, n)?.id === vpc.id);
  const peerWord = direction === 'ingress' ? 'Source' : 'Destination';

  const set = (next: SgRule[]) => onChange(serializeRules(next));
  const patch = (i: number, p: Partial<SgRule>) => set(rules.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const choosePeer = (i: number, choice: string) => {
    if (choice === 'world') patch(i, { peer: WORLD });
    else if (choice === 'cidr') patch(i, { peer: String(vpc?.props.cidr_block ?? '10.0.0.0/16') });
    else patch(i, { peer: peerOfSg(choice.slice(3)) });
  };

  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs text-muted-foreground">{def.label}</Label>
      <div className="flex flex-col gap-2">
        {rules.length === 0 && (
          <p className="text-xs text-muted-foreground">{direction === 'ingress' ? 'No inbound traffic allowed.' : 'No outbound traffic allowed.'}</p>
        )}
        {rules.map((r, i) => {
          const mode = modeOf(r.peer);
          const bad = expandRule(r) === null;
          const peerValue = mode === 'sg' ? `sg:${sgIdOfPeer(r.peer)}` : mode;
          return (
            <div className="flex flex-col gap-1.5 rounded-lg border bg-muted/30 p-2" key={i}>
              <div className="flex gap-1.5">
                <SimpleSelect size="sm" label="Protocol" value={r.protocol} options={PROTOCOLS} onChange={(v) => patch(i, { protocol: v as SgProtocol })} />
                {(r.protocol === 'tcp' || r.protocol === 'udp') && (
                  <Input
                    className={cn('h-7 min-w-0', bad && 'border-destructive')}
                    value={r.ports}
                    placeholder="all ports"
                    title="Comma separated, ranges allowed: 22, 443, 8000-8100"
                    aria-invalid={bad}
                    onChange={(e) => patch(i, { ports: e.target.value })}
                    aria-label="Ports"
                  />
                )}
                <Button variant="ghost" size="icon-sm" title="Remove rule" aria-label="Remove rule" onClick={() => set(rules.filter((_, k) => k !== i))}>
                  <X />
                </Button>
              </div>
              <div className="flex gap-1.5">
                <SimpleSelect
                  size="sm"
                  label={peerWord}
                  value={peerValue}
                  onChange={(v) => choosePeer(i, v)}
                  options={[
                    { value: 'world', label: 'Anywhere (0.0.0.0/0)' },
                    { value: 'cidr', label: 'Custom CIDR' },
                    ...groups.map((g) => ({ value: `sg:${g.id}`, label: `Group: ${g.name}` })),
                    ...(mode === 'sg' && !groups.some((g) => g.id === sgIdOfPeer(r.peer)) ? [{ value: peerValue, label: 'Group: (missing)' }] : []),
                  ]}
                />
                {mode === 'cidr' && (
                  <Input className="h-7 min-w-0" value={r.peer} placeholder="10.0.0.0/16" onChange={(e) => patch(i, { peer: e.target.value })} aria-label="CIDR" />
                )}
              </div>
              <Input className="h-7" value={r.description} placeholder="Description (optional)" onChange={(e) => patch(i, { description: e.target.value })} aria-label="Description" />
            </div>
          );
        })}
        <Button variant="outline" size="sm" onClick={() => set([...rules, newRule(direction)])}>
          <Plus /> Add {direction === 'ingress' ? 'inbound' : 'outbound'} rule
        </Button>
      </div>
      {def.hint && <p className="text-[11px] leading-snug text-muted-foreground">{def.hint}</p>}
    </div>
  );
}
