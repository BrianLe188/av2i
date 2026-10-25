import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Strings } from "../i18n.ts";

export interface SgRule {
  ip_protocol: string;
  from_port?: number;
  to_port?: number;
  cidr_ipv4?: string;
  cidr_ipv6?: string;
  prefix_list_id?: string;
  referenced_security_group_id?: string;
  description?: string;
}

interface Group { key: string; label: string }

/** The "Type" column of the AWS console: a name that fills in protocol and port. `custom` keeps whatever is typed. */
const TYPES: { id: string; label: string; protocol: string; port?: number }[] = [
  { id: "all", label: "All traffic", protocol: "-1" },
  { id: "custom-tcp", label: "Custom TCP", protocol: "tcp" },
  { id: "custom-udp", label: "Custom UDP", protocol: "udp" },
  { id: "all-icmp", label: "All ICMP - IPv4", protocol: "icmp" },
  { id: "ssh", label: "SSH", protocol: "tcp", port: 22 },
  { id: "http", label: "HTTP", protocol: "tcp", port: 80 },
  { id: "https", label: "HTTPS", protocol: "tcp", port: 443 },
  { id: "rdp", label: "RDP", protocol: "tcp", port: 3389 },
  { id: "mysql", label: "MySQL/Aurora", protocol: "tcp", port: 3306 },
  { id: "postgres", label: "PostgreSQL", protocol: "tcp", port: 5432 },
  { id: "redis", label: "Redis", protocol: "tcp", port: 6379 },
  { id: "dns-udp", label: "DNS (UDP)", protocol: "udp", port: 53 },
];

const PROTOCOL_NAME: Record<string, string> = { "-1": "All", tcp: "TCP", udp: "UDP", icmp: "ICMP", icmpv6: "ICMPv6" };

function typeOf(r: SgRule): string {
  if (r.ip_protocol === "-1") return "all";
  const named = TYPES.find((t) => t.port !== undefined && t.protocol === r.ip_protocol && r.from_port === t.port && r.to_port === t.port);
  if (named) return named.id;
  if (r.ip_protocol === "udp") return "custom-udp";
  if (r.ip_protocol === "icmp") return "all-icmp";
  return "custom-tcp";
}

const portsLocked = (type: string) => type === "all" || type === "all-icmp" || (TYPES.find((t) => t.id === type)?.port !== undefined);

type Source = "anywhere4" | "anywhere6" | "custom" | "sg" | "prefix";

function sourceOf(r: SgRule): Source {
  if (r.referenced_security_group_id !== undefined) return "sg";
  if (r.prefix_list_id !== undefined) return "prefix";
  if (r.cidr_ipv6 !== undefined) return r.cidr_ipv6 === "::/0" ? "anywhere6" : "custom";
  return r.cidr_ipv4 === "0.0.0.0/0" ? "anywhere4" : "custom";
}

const stripPeer = ({ cidr_ipv4, cidr_ipv6, prefix_list_id, referenced_security_group_id, ...rest }: SgRule): SgRule => {
  void [cidr_ipv4, cidr_ipv6, prefix_list_id, referenced_security_group_id];
  return rest;
};

/** What AWS creates for a new group's outbound side: one rule that allows everything. */
const ALLOW_ALL: SgRule = { ip_protocol: "-1", cidr_ipv4: "0.0.0.0/0" };

/** Inbound and Outbound as two tables, like the AWS console, over the `ingress_rules` and `egress_rules` properties. */
export function SgRules({ ingress, egress, s, groups, onSet }: {
  ingress: SgRule[] | undefined;
  egress: SgRule[] | undefined;
  s: Strings;
  groups: Group[];
  onSet: (key: "ingress_rules" | "egress_rules", value: SgRule[] | undefined) => void;
}) {
  return (
    <Tabs defaultValue="in" className="my-2 w-full min-w-0 gap-2" data-testid="sg-rules">
      <TabsList className="w-full justify-start">
        <TabsTrigger value="in" data-testid="sg-tab-in" className="flex-none">{s.sg.inbound} ({(ingress ?? []).length})</TabsTrigger>
        <TabsTrigger value="out" data-testid="sg-tab-out" className="flex-none">{s.sg.outbound} ({egress === undefined ? 1 : egress.length})</TabsTrigger>
      </TabsList>
      <TabsContent value="in">
        <Table rules={ingress ?? []} outbound={false} s={s} groups={groups} onChange={(v) => onSet("ingress_rules", v)} />
      </TabsContent>
      <TabsContent value="out">
        {egress === undefined && <p className="mb-2 text-xs text-muted-foreground">{s.sg.defaultOutbound}</p>}
        <Table rules={egress ?? [ALLOW_ALL]} outbound s={s} groups={groups} onChange={(v) => onSet("egress_rules", v)} />
        {egress !== undefined && (
          <Button variant="link" size="sm" className="mt-1 w-fit px-0" data-testid="sg-egress-default" onClick={() => onSet("egress_rules", undefined)}>{s.sg.restoreOutbound}</Button>
        )}
      </TabsContent>
    </Tabs>
  );
}

function Table({ rules, outbound, s, groups, onChange }: { rules: SgRule[]; outbound: boolean; s: Strings; groups: Group[]; onChange: (v: SgRule[]) => void }) {
  const set = (i: number, r: SgRule) => onChange(rules.map((x, j) => (j === i ? r : x)));
  const id = outbound ? "out" : "in";
  return (
    <div className="flex flex-col gap-2">
      {rules.length === 0 && <p className="text-xs text-muted-foreground">{outbound ? s.sg.noOutbound : s.sg.noInbound}</p>}
      {rules.map((r, i) => {
        const type = typeOf(r);
        const source = sourceOf(r);
        const locked = portsLocked(type);
        return (
          <div className="flex flex-col gap-1.5 rounded-md border p-2" key={i} data-testid={`sg-${id}-${i}`}>
            <div className="flex items-end gap-1.5">
              <Cell label={s.sg.type}>
                <Select
                  value={type}
                  onValueChange={(v) => {
                    const t = TYPES.find((x) => x.id === v)!;
                    const base = { ...r, ip_protocol: t.protocol };
                    const { from_port, to_port, ...noPorts } = base;
                    if (t.protocol === "-1") return set(i, noPorts);
                    if (t.protocol === "icmp") return set(i, { ...noPorts, from_port: -1, to_port: -1 });
                    set(i, { ...noPorts, from_port: t.port ?? from_port ?? 0, to_port: t.port ?? to_port ?? 0 });
                  }}
                >
                  <SelectTrigger size="sm" className="w-full" data-testid={`sg-${id}-${i}-type`}><SelectValue /></SelectTrigger>
                  <SelectContent>{TYPES.map((t) => <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
              </Cell>
              <Button variant="ghost" size="icon-xs" aria-label={s.delete} data-testid={`sg-${id}-${i}-delete`} onClick={() => onChange(rules.filter((_, j) => j !== i))}><X /></Button>
            </div>
            <div className="flex items-end gap-1.5">
              <Cell label={s.sg.protocol} className="w-20 flex-none">
                <Input className="h-8 bg-muted/40" readOnly tabIndex={-1} value={PROTOCOL_NAME[r.ip_protocol] ?? r.ip_protocol} />
              </Cell>
              <Cell label={s.sg.portRange} className="min-w-0 flex-1">
                {locked ? (
                  <Input className="h-8 bg-muted/40" readOnly tabIndex={-1} value={r.ip_protocol === "-1" ? s.sg.all : r.ip_protocol === "icmp" ? s.sg.all : String(r.from_port ?? "")} data-testid={`sg-${id}-${i}-ports`} />
                ) : (
                  <PortRange rule={r} onChange={(x) => set(i, x)} label={s.sg.portRange} testId={`sg-${id}-${i}-ports`} />
                )}
              </Cell>
            </div>
            <div className="flex items-end gap-1.5">
              <Cell label={outbound ? s.sg.destination : s.sg.source} className="w-[7.5rem] flex-none">
                <Select
                  value={source}
                  onValueChange={(v) => {
                    const base = stripPeer(r);
                    if (v === "anywhere4") set(i, { ...base, cidr_ipv4: "0.0.0.0/0" });
                    else if (v === "anywhere6") set(i, { ...base, cidr_ipv6: "::/0" });
                    else if (v === "sg") set(i, { ...base, referenced_security_group_id: groups[0]?.key ?? "" });
                    else if (v === "prefix") set(i, { ...base, prefix_list_id: "" });
                    else set(i, { ...base, cidr_ipv4: "" });
                  }}
                >
                  <SelectTrigger size="sm" className="w-full" data-testid={`sg-${id}-${i}-source`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="anywhere4">{s.sg.anywhere4}</SelectItem>
                    <SelectItem value="anywhere6">{s.sg.anywhere6}</SelectItem>
                    <SelectItem value="custom">{s.sg.custom}</SelectItem>
                    <SelectItem value="sg" disabled={groups.length === 0}>{s.sg.group}</SelectItem>
                    <SelectItem value="prefix">{s.sg.prefixList}</SelectItem>
                  </SelectContent>
                </Select>
              </Cell>
              <Cell label={s.sg.sourceValue}>
                {source === "sg" ? (
                  <Select value={r.referenced_security_group_id ?? ""} onValueChange={(v) => set(i, { ...r, referenced_security_group_id: v })}>
                    <SelectTrigger size="sm" className="w-full" data-testid={`sg-${id}-${i}-peer`}><SelectValue /></SelectTrigger>
                    <SelectContent>{groups.map((g) => <SelectItem key={g.key} value={g.key}>{g.label}</SelectItem>)}</SelectContent>
                  </Select>
                ) : source === "anywhere4" || source === "anywhere6" ? (
                  <Input className="h-8 bg-muted/40" readOnly tabIndex={-1} value={r.cidr_ipv4 ?? r.cidr_ipv6 ?? ""} data-testid={`sg-${id}-${i}-peer`} />
                ) : (
                  <Input
                    className="h-8"
                    key={`${source}${r.cidr_ipv4}${r.cidr_ipv6}${r.prefix_list_id}`}
                    defaultValue={r.prefix_list_id ?? r.cidr_ipv4 ?? r.cidr_ipv6 ?? ""}
                    placeholder={source === "prefix" ? "pl-…" : "10.0.0.0/16"}
                    data-testid={`sg-${id}-${i}-peer`}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (source === "prefix") set(i, { ...stripPeer(r), prefix_list_id: v });
                      else set(i, { ...stripPeer(r), ...(v.includes(":") ? { cidr_ipv6: v } : { cidr_ipv4: v }) });
                    }}
                  />
                )}
              </Cell>
            </div>
            <Cell label={s.description}>
              <Input className="h-8" defaultValue={r.description ?? ""} key={`d${r.description}`} placeholder={s.description} data-testid={`sg-${id}-${i}-description`} onBlur={(e) => set(i, { ...r, description: e.target.value === "" ? undefined : e.target.value })} />
            </Cell>
          </div>
        );
      })}
      <Button variant="outline" size="sm" className="w-fit" data-testid={`add-${outbound ? "egress" : "ingress"}`} onClick={() => onChange([...rules, { ip_protocol: "tcp", from_port: 443, to_port: 443, cidr_ipv4: "" }])}>
        <Plus />{s.addRule}
      </Button>
    </div>
  );
}

function Cell({ label, className = "min-w-0 flex-1", children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`flex flex-col gap-0.5 ${className}`}>
      <span className="text-[11px] text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

/** "From-To" in one box, as the console shows it: `80`, or `8000-8100`. */
function PortRange({ rule, onChange, label, testId }: { rule: SgRule; onChange: (r: SgRule) => void; label: string; testId: string }) {
  const text = rule.from_port === undefined ? "" : rule.from_port === rule.to_port ? String(rule.from_port) : `${rule.from_port}-${rule.to_port ?? ""}`;
  return (
    <Input
      className="h-8"
      aria-label={label}
      defaultValue={text}
      key={text}
      placeholder="80"
      data-testid={testId}
      onBlur={(e) => {
        const m = e.target.value.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
        if (!m) return;
        const from = Number(m[1]);
        onChange({ ...rule, from_port: from, to_port: m[2] === undefined ? from : Number(m[2]) });
      }}
    />
  );
}
