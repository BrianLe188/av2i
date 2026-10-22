import { resolveEdges } from './edges';
import { parsePorts } from './ports';
import type { Graph, Issue } from './types';

const DB_PORT_LIST = [3306, 5432, 1433, 6379, 27017];
const WORLD = '0.0.0.0/0';

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

  const worldOpenPorts = (sgId: string) => {
    const sg = byId.get(sgId);
    if (!sg || String(sg.props.ingress_cidr).trim() !== WORLD) return [];
    return parsePorts(String(sg.props.ingress_ports)) ?? [];
  };

  for (const sg of nodes.filter((n) => n.type === 'sg')) {
    for (const range of worldOpenPorts(sg.id)) {
      const covers = (port: number) => range.from <= port && port <= range.to;
      const label = range.from === range.to ? `${range.from}` : `${range.from}-${range.to}`;
      if (covers(22) || covers(3389)) {
        flag(sg.id, 'warning', 'SSH/RDP is open to the whole internet. Restrict the source CIDR.');
      } else if (DB_PORT_LIST.some(covers)) {
        flag(sg.id, 'error', `Database port ${label} is open to the whole internet.`);
      } else if (!(range.from === range.to && (range.from === 80 || range.from === 443))) {
        flag(sg.id, 'warning', `Port ${label} is open to the whole internet.`);
      }
    }
  }

  for (const r of resolved.filter((x) => x.kind === 'sg-attach')) {
    if (r.to!.type === 'rds' && worldOpenPorts(r.from!.id).length > 0) {
      flag(r.to!.id, 'error', `${r.from!.name} opens inbound ports to the whole internet and is attached to this database.`);
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
