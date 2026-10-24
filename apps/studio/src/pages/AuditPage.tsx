import { useCallback, useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "../api.ts";
import { describe } from "../components/auth/errors.ts";
import { useStrings } from "../prefs.ts";
import { Page } from "./Page.tsx";

interface AuditRow { id: string; at: string; actor: string | null; action: string; resource: string | null; outcome: string; ip: string | null }

export function AuditPage() {
  const s = useStrings();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [more, setMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const load = useCallback(async (before?: string) => {
    try {
      const r = await api<{ entries: AuditRow[] }>("GET", `/api/audit?limit=100${before ? `&before=${before}` : ""}`);
      setRows((cur) => (before ? [...cur, ...r.entries] : r.entries));
      setMore(r.entries.length === 100);
    } catch (e) { setError(describe(e, s)); }
  }, [s]);
  useEffect(() => { void load(); }, [load]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? rows.filter((r) => r.action.toLowerCase().includes(q) || (r.actor ?? "").toLowerCase().includes(q) || (r.resource ?? "").toLowerCase().includes(q)) : rows;
  }, [rows, query]);

  return (
    <Page title={s.nav.auditPage} text={s.nav.auditPageText} wide>
      <div className="grid gap-4">
        {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
        <div className="relative max-w-sm">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input className="pl-8" placeholder={s.nav.filter} aria-label={s.nav.filter} value={query} onChange={(e) => setQuery(e.target.value)} data-testid="audit-filter" />
        </div>
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow><TableHead>{s.acct.time}</TableHead><TableHead>{s.acct.actor}</TableHead><TableHead>{s.acct.action}</TableHead><TableHead>{s.acct.resource}</TableHead><TableHead>IP</TableHead><TableHead>{s.acct.outcome}</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap text-xs">{new Date(r.at).toLocaleString()}</TableCell>
                  <TableCell>{r.actor ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{r.action}</TableCell>
                  <TableCell className="max-w-64 truncate font-mono text-xs" title={r.resource ?? ""}>{r.resource ?? ""}</TableCell>
                  <TableCell className="font-mono text-xs">{r.ip ?? ""}</TableCell>
                  <TableCell><Badge variant={r.outcome === "success" ? "secondary" : "destructive"}>{r.outcome}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
        {more && rows.length > 0 && <Button variant="outline" className="w-fit" onClick={() => void load(rows[rows.length - 1]!.id)}>{s.acct.loadMore}</Button>}
      </div>
    </Page>
  );
}
