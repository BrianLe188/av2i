import { resolveEdges } from './edges';
import { expandRule, sgRules, WORLD } from './sg-rules';
import { sgAssignments } from './sg';
import type { Graph, Issue } from './types';

const DB_PORT_LIST = [3306, 5432, 1433, 6379, 27017];

/**
 * Findings about exposure that the generated Terraform can't fix by itself.
 * (The generator already defaults to IMDSv2, encrypted volumes and databases, and blocked public S3 access.)
 */
export function securityChecks(graph: Graph): Issue[] {
  const issues: Issue[] = [];
  const { nodes } = graph;
  const flag = (nodeId: string, severity: Issue['severity'], message: string) =>
    issues.push({ nodeId, severity, message, category: 'security' });
  const resolved = resolveEdges(graph).filter((r) => r.kind && !r.problem);
  const byId = new Map(nodes.map((n) => [n.id, n]));

  /** Inbound rules that accept traffic from anywhere on the internet. */
  const worldOpen = (sgId: string) => {
    const sg = byId.get(sgId);
    return sg ? sgRules(sg, 'ingress').filter((r) => r.peer.trim() === WORLD && r.protocol !== 'icmp') : [];
  };

  for (const sg of nodes.filter((n) => n.type === 'sg')) {
    for (const rule of worldOpen(sg.id)) {
      if (rule.protocol === 'all') {
        flag(sg.id, 'error', 'All traffic is open to the whole internet.');
        continue;
      }
      for (const seg of expandRule(rule) ?? []) {
        const from = seg.from!;
        const to = seg.to!;
        const covers = (port: number) => from <= port && port <= to;
        const label = from === to ? `${from}` : `${from}-${to}`;
        if (rule.protocol === 'udp') {
          flag(sg.id, 'warning', `UDP port ${label} is open to the whole internet.`);
        } else if (from === 0 && to === 65535) {
          flag(sg.id, 'error', 'Every TCP port is open to the whole internet.');
        } else if (covers(22) || covers(3389)) {
          flag(sg.id, 'warning', 'SSH/RDP is open to the whole internet. Restrict the source CIDR.');
        } else if (DB_PORT_LIST.some(covers)) {
          flag(sg.id, 'error', `Database port ${label} is open to the whole internet.`);
        } else if (!(from === to && (from === 80 || from === 443))) {
          flag(sg.id, 'warning', `Port ${label} is open to the whole internet.`);
        }
      }
    }
  }

  const assigned = sgAssignments(nodes, resolved);
  for (const db of nodes.filter((n) => n.type === 'rds')) {
    for (const sg of assigned.get(db.id) ?? []) {
      if (worldOpen(sg.id).length > 0) {
        flag(db.id, 'error', `${sg.name} opens inbound traffic to the whole internet and is used by this database.`);
      }
    }
  }

  for (const db of nodes.filter((n) => n.type === 'rds')) {
    const subnet = byId.get(db.parentId ?? '');
    if (subnet?.props.public) flag(db.id, 'warning', 'The database sits in a public subnet. Prefer a private subnet.');
  }

  for (const alb of nodes.filter((n) => n.type === 'alb')) {
    const https = String(alb.props.certificate_arn ?? '').trim() !== '';
    if (!alb.props.internal && !https) {
      flag(alb.id, 'warning', 'Internet-facing load balancer serves plain HTTP. Add an ACM certificate for HTTPS.');
    }
  }

  for (const r of resolved.filter((x) => x.kind === 'cdn-origin' && x.to!.type === 'alb')) {
    if (!String(r.to!.props.certificate_arn ?? '').trim()) {
      flag(r.from!.id, 'warning', 'CloudFront talks to the load balancer over plain HTTP.');
    }
  }

  return issues;
}
