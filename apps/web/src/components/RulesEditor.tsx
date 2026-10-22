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

const PROTOCOLS: { value: SgProtocol; label: string }[] = [
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
    <div className="field">
      <span>{def.label}</span>
      <div className="rules">
        {rules.length === 0 && <p className="muted rules-empty">{direction === 'ingress' ? 'No inbound traffic allowed.' : 'No outbound traffic allowed.'}</p>}
        {rules.map((r, i) => {
          const mode = modeOf(r.peer);
          const bad = expandRule(r) === null;
          return (
            <div className="rule" key={i}>
              <div className="rule-row">
                <select value={r.protocol} onChange={(e) => patch(i, { protocol: e.target.value as SgProtocol })} aria-label="Protocol">
                  {PROTOCOLS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
                {(r.protocol === 'tcp' || r.protocol === 'udp') && (
                  <input
                    type="text"
                    className={bad ? 'invalid' : undefined}
                    value={r.ports}
                    placeholder="all ports"
                    title="Comma separated, ranges allowed: 22, 443, 8000-8100"
                    onChange={(e) => patch(i, { ports: e.target.value })}
                    aria-label="Ports"
                  />
                )}
                <button className="rule-remove" title="Remove rule" onClick={() => set(rules.filter((_, k) => k !== i))}>
                  ×
                </button>
              </div>
              <div className="rule-row">
                <select
                  value={mode === 'sg' ? `sg:${sgIdOfPeer(r.peer)}` : mode}
                  onChange={(e) => choosePeer(i, e.target.value)}
                  aria-label={peerWord}
                >
                  <option value="world">Anywhere (0.0.0.0/0)</option>
                  <option value="cidr">Custom CIDR</option>
                  {groups.map((g) => (
                    <option key={g.id} value={`sg:${g.id}`}>
                      Group: {g.name}
                    </option>
                  ))}
                  {mode === 'sg' && !groups.some((g) => g.id === sgIdOfPeer(r.peer)) && (
                    <option value={`sg:${sgIdOfPeer(r.peer)}`}>Group: (missing)</option>
                  )}
                </select>
                {mode === 'cidr' && (
                  <input type="text" value={r.peer} placeholder="10.0.0.0/16" onChange={(e) => patch(i, { peer: e.target.value })} aria-label="CIDR" />
                )}
              </div>
              <input
                type="text"
                className="rule-desc"
                value={r.description}
                placeholder="Description (optional)"
                onChange={(e) => patch(i, { description: e.target.value })}
                aria-label="Description"
              />
            </div>
          );
        })}
        <button onClick={() => set([...rules, newRule(direction)])}>+ Add {direction === 'ingress' ? 'inbound' : 'outbound'} rule</button>
      </div>
      {def.hint && <small>{def.hint}</small>}
    </div>
  );
}
