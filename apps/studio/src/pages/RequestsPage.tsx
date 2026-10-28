import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { runError } from "../components/runError.ts";
import { listRequests, type RequestRow } from "../requests.ts";
import { useStrings } from "../prefs.ts";
import { Page } from "./Page.tsx";

export function StatusBadge({ r }: { r: Pick<RequestRow, "status" | "closeReason"> }) {
  const s = useStrings();
  const label = r.status === "closed" && r.closeReason ? s.req.closeReason[r.closeReason] : s.req.status[r.status];
  return <Badge variant={r.status === "applied" ? "default" : r.status === "closed" ? "secondary" : r.status === "approved" ? "outline" : "secondary"} className={r.status === "waiting" ? "bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200" : ""}>{label}</Badge>;
}

/** Requests of the person: what waits for them to decide, and what they sent (DD-027). */
export function RequestsPage() {
  const s = useStrings();
  const [tab, setTab] = useState<"awaiting" | "mine">("awaiting");
  const [rows, setRows] = useState<RequestRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRows(null);
    try { setRows(await listRequests(tab)); setError(null); } catch (e) { setError(runError(e, s)); }
  }, [tab, s]);
  useEffect(() => { void load(); }, [load]);

  return (
    <Page title={s.req.title} text={s.req.text} wide>
      <div className="grid gap-4">
        <Tabs value={tab} onValueChange={(v) => setTab(v as "awaiting" | "mine")}>
          <TabsList>
            <TabsTrigger value="awaiting" data-testid="tab-awaiting">{s.req.tabAwaiting}</TabsTrigger>
            <TabsTrigger value="mine" data-testid="tab-mine">{s.req.tabMine}</TabsTrigger>
          </TabsList>
        </Tabs>
        {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
        <Card className="py-0">
          <Table>
            <TableHeader><TableRow><TableHead>{s.req.colRequest}</TableHead><TableHead>{s.req.colProject}</TableHead><TableHead>{s.req.colStatus}</TableHead><TableHead>{s.req.colBy}</TableHead><TableHead>{s.req.colSize}</TableHead><TableHead>{s.req.colUpdated}</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows !== null && rows.length === 0 && <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground" data-testid="no-requests">{tab === "awaiting" ? s.req.noAwaiting : s.req.noMine}</TableCell></TableRow>}
              {(rows ?? []).map((r) => (
                <TableRow key={r.id} data-testid={`request-row-${r.projectName}-${r.number}`}>
                  <TableCell className="font-medium"><Link to={`/requests/${r.id}`} className="hover:underline">#{r.number} · {s.req.kindApply}</Link></TableCell>
                  <TableCell>{r.projectName}</TableCell>
                  <TableCell><StatusBadge r={r} /></TableCell>
                  <TableCell>{r.requester}</TableCell>
                  <TableCell className="text-xs">
                    {r.size ? <span className="inline-flex items-center gap-1">{r.size.destructive && <AlertTriangle className="size-3.5 text-destructive" aria-label={s.req.destructive} />}{`+${r.size.add} ~${r.size.change} −${r.size.destroy} ↻${r.size.replace}`}</span> : "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{new Date(r.updatedAt).toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>
    </Page>
  );
}
