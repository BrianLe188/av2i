import { useCallback, useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { AlertTriangle, Loader2, PencilRuler, Play } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiError } from "../api.ts";
import { MembersPanel } from "../components/MembersPanel.tsx";
import { StatePanel } from "../components/StatePanel.tsx";
import { connError } from "../components/connError.ts";
import { listConnections, setProjectConnection, type ConnectionRow } from "../connections.ts";
import { getProject, type ProjectFull } from "../projects.ts";
import { listRequests, type RequestRow } from "../requests.ts";
import { useStrings } from "../prefs.ts";
import { Page } from "./Page.tsx";
import { StatusBadge } from "./RequestsPage.tsx";

type Tab = "overview" | "members" | "requests" | "state";

/** The page a project opens on: what it is, who works in it, its requests. The canvas is one click away (DD-028). */
export function ProjectDetailPage() {
  const s = useStrings();
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (["overview", "members", "requests", "state"].includes(params.get("tab") ?? "") ? params.get("tab") : "overview") as Tab;
  const [p, setP] = useState<ProjectFull | null>(null);
  const [gone, setGone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conns, setConns] = useState<ConnectionRow[]>([]);
  const [requests, setRequests] = useState<RequestRow[] | null>(null);

  const load = useCallback(async () => {
    try { setP(await getProject(id)); } catch (e) { if (e instanceof ApiError && e.status !== 401) setGone(true); }
  }, [id]);
  useEffect(() => { void load(); void listConnections().then(setConns).catch(() => setConns([])); }, [load]);
  useEffect(() => { if (tab === "requests") void listRequests("project", id).then(setRequests).catch(() => setRequests([])); }, [tab, id]);

  if (gone) return <Page title={s.pd.notFound}><Button asChild variant="outline"><Link to="/projects">{s.pd.back}</Link></Button></Page>;
  if (!p) return <Page title={s.nav.designer}><Loader2 className="animate-spin text-muted-foreground" /></Page>;

  const pr = p.project;
  const design = pr.design as { nodes?: unknown[]; edges?: unknown[]; settings?: { region?: string } };
  const may = p.can.plan || p.can.approve || p.can.apply;
  const changeConnection = async (v: string) => {
    setError(null);
    try { await setProjectConnection(id, v === "none" ? null : v); toast(s.pd.connectionChanged); await load(); } catch (e) { setError(connError(e, s)); }
  };
  const usable = conns.length > 0;

  return (
    <Page
      title={pr.name === "untitled" ? s.untitled : pr.name}
      text={`${s.pd.owner}: ${pr.owner ?? "—"} · ${s.pd.updated}: ${new Date(pr.updatedAt).toLocaleString()}`}
      wide
      actions={
        <div className="flex items-center gap-2">
          {may && <Button variant="outline" asChild><Link to={`/projects/${id}/design?run=1`} data-testid="open-plan"><Play />{s.pd.planApply}</Link></Button>}
          <Button asChild><Link to={`/projects/${id}/design`} data-testid="open-canvas"><PencilRuler />{s.pd.open}</Link></Button>
        </div>
      }
    >
      <div className="grid gap-4">
        <Tabs value={tab} onValueChange={(v) => setParams(v === "overview" ? {} : { tab: v })}>
          <TabsList>
            <TabsTrigger value="overview" data-testid="tab-overview">{s.pd.overview}</TabsTrigger>
            <TabsTrigger value="members" data-testid="tab-members">{s.pd.members}</TabsTrigger>
            <TabsTrigger value="requests" data-testid="tab-requests">{s.pd.requests}</TabsTrigger>
            {p.can.stateRead && <TabsTrigger value="state" data-testid="tab-state">{s.st.tab}</TabsTrigger>}
          </TabsList>
        </Tabs>

        {tab === "overview" && (
          <div className="grid gap-4">
            {pr.rescuePending && <Alert variant="destructive"><AlertTriangle /><AlertDescription data-testid="detail-rescue">{s.pd.rescue}</AlertDescription></Alert>}
            {error && <Alert variant="destructive" role="alert"><AlertDescription data-testid="detail-error">{error}</AlertDescription></Alert>}
            <Card>
              <CardContent className="grid gap-x-8 gap-y-3 pt-6 text-sm sm:grid-cols-2" data-testid="overview">
                <div><p className="text-xs text-muted-foreground">{s.pd.owner}</p><p className="font-medium">{pr.owner ?? "—"}</p></div>
                <div><p className="text-xs text-muted-foreground">{s.pd.created}</p><p>{pr.createdAt ? new Date(pr.createdAt).toLocaleString() : "—"}</p></div>
                <div><p className="text-xs text-muted-foreground">{s.pd.updated}</p><p>{new Date(pr.updatedAt).toLocaleString()}{pr.updatedBy ? ` · ${pr.updatedBy}` : ""}</p></div>
                <div><p className="text-xs text-muted-foreground">{s.pd.region}</p><p className="font-mono">{design.settings?.region ?? "—"}</p></div>
                <div><p className="text-xs text-muted-foreground">{s.pd.design}</p><p>{s.pd.size.replace("{n}", String(design.nodes?.length ?? 0)).replace("{e}", String(design.edges?.length ?? 0))}</p></div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">{s.pd.connection}</CardTitle></CardHeader>
              <CardContent className="grid gap-2 text-sm">
                <p className="text-xs text-muted-foreground">{s.pd.connectionHelp}</p>
                <div className="flex items-center gap-2">
                  {p.can.write && usable ? (
                    <Select value={pr.connection?.id ?? "none"} onValueChange={(v) => void changeConnection(v)}>
                      <SelectTrigger className="w-72" data-testid="detail-connection"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{s.pd.connectionNone}</SelectItem>
                        {conns.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                        {pr.connection && !conns.some((c) => c.id === pr.connection!.id) && <SelectItem value={pr.connection.id}>{pr.connection.name}</SelectItem>}
                      </SelectContent>
                    </Select>
                  ) : (
                    <><Badge variant="outline" data-testid="detail-connection-name">{pr.connection?.name ?? s.pd.connectionNone}</Badge>{p.can.write && <span className="text-xs text-muted-foreground">{s.pd.connectionLocked}</span>}</>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {tab === "members" && <MembersPanel s={s} projectId={id} />}

        {tab === "state" && p.can.stateRead && <StatePanel s={s} projectId={id} projectName={pr.name} canDownload={p.can.stateWrite} />}

        {tab === "requests" && (
          <Card className="py-0">
            <Table>
              <TableHeader><TableRow><TableHead>{s.req.colRequest}</TableHead><TableHead>{s.req.colStatus}</TableHead><TableHead>{s.req.colBy}</TableHead><TableHead>{s.req.colUpdated}</TableHead></TableRow></TableHeader>
              <TableBody>
                {requests !== null && requests.length === 0 && <TableRow><TableCell colSpan={4} className="py-8 text-center text-muted-foreground" data-testid="detail-no-requests">{s.pd.requestsNone}</TableCell></TableRow>}
                {(requests ?? []).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium"><Link to={`/requests/${r.id}`} className="hover:underline">#{r.number} · {s.req.kindApply}</Link></TableCell>
                    <TableCell><StatusBadge r={r} /></TableCell>
                    <TableCell>{r.requester}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(r.updatedAt).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>
    </Page>
  );
}
