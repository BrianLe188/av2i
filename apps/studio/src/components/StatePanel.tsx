import { useCallback, useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Strings } from "../i18n.ts";
import { getStateDiff, getStateResource, getStateVersion, listStateVersions, stateDownloadUrl, type StateDetail, type StateDiff, type StateVersion } from "../projects.ts";
import { describe } from "./auth/errors.ts";

const kb = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);

/** The state the platform keeps: its versions, what a version holds with secrets hidden, and what changed since the one before (DD-032). */
export function StatePanel({ s, projectId, canDownload }: { s: Strings; projectId: string; canDownload: boolean }) {
  const [versions, setVersions] = useState<StateVersion[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<StateDetail | null>(null);
  const [diff, setDiff] = useState<StateDiff | null>(null);
  const [open, setOpen] = useState<{ address: string; attributes: Record<string, unknown> }[] | null>(null);
  const [openAddress, setOpenAddress] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setVersions((await listStateVersions(projectId)).versions); } catch (e) { setError(describe(e, s)); }
  }, [projectId, s]);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (selected === null) return;
    setDetail(null); setDiff(null); setOpen(null); setOpenAddress(null); setFilter("");
    void getStateVersion(projectId, selected).then(setDetail).catch((e) => setError(describe(e, s)));
    void getStateDiff(projectId, selected).then(setDiff).catch(() => setDiff(null));
  }, [selected, projectId, s]);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (detail?.resources ?? []).filter((r) => !q || r.address.toLowerCase().includes(q) || r.type.toLowerCase().includes(q));
  }, [detail, filter]);

  const look = async (address: string) => {
    if (openAddress === address) { setOpenAddress(null); setOpen(null); return; }
    setOpenAddress(address);
    try { setOpen((await getStateResource(projectId, selected!, address)).instances); } catch (e) { setError(describe(e, s)); }
  };

  return (
    <div className="grid gap-4" data-testid="state-panel">
      <p className="text-sm text-muted-foreground">{s.st.backend}: <Badge variant="outline" data-testid="state-backend">{s.st.backendPlatform}</Badge></p>
      {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
      <Card className="py-0">
        <Table>
          <TableHeader><TableRow><TableHead>{s.st.serial}</TableHead><TableHead>{s.st.at}</TableHead><TableHead>{s.st.by}</TableHead><TableHead>{s.st.resources}</TableHead><TableHead>{s.st.outputs}</TableHead><TableHead>{s.st.size}</TableHead></TableRow></TableHeader>
          <TableBody>
            {versions !== null && versions.length === 0 && <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground" data-testid="state-none">{s.st.none}</TableCell></TableRow>}
            {(versions ?? []).map((v) => (
              <TableRow key={v.id} className={`cursor-pointer ${v.id === selected ? "bg-muted" : ""}`} onClick={() => setSelected(v.id)} data-testid={`state-version-${v.serial}`}>
                <TableCell className="font-mono">{v.serial}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{new Date(v.createdAt).toLocaleString()}</TableCell>
                <TableCell className="text-xs">{v.by ?? "—"}{v.runKind && <Badge variant="outline" className="ml-2">{v.runKind === "apply" ? s.st.viaApply : s.st.viaPlan}</Badge>}</TableCell>
                <TableCell>{v.resources}</TableCell>
                <TableCell>{v.outputs}</TableCell>
                <TableCell className="text-xs">{kb(v.bytes)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {selected === null && versions && versions.length > 0 && <p className="text-sm text-muted-foreground">{s.st.pick}</p>}
      {selected !== null && detail && (
        <Card data-testid="state-detail">
          <CardHeader className="flex flex-row items-start gap-3">
            <CardTitle className="flex-1 text-base">{s.st.detail}: serial {detail.version.serial}</CardTitle>
            {canDownload && (
              <div className="text-right">
                <Button size="sm" variant="outline" asChild><a href={stateDownloadUrl(projectId, detail.version.id)} data-testid="state-download"><Download />{s.st.download}</a></Button>
                <p className="mt-1 max-w-64 text-[11px] text-muted-foreground">{s.st.downloadWarn}</p>
              </div>
            )}
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="rounded-md border p-3 text-sm" data-testid="state-diff">
              <p className="mb-1 font-medium">{s.st.diffTitle}</p>
              {!diff ? null : diff.from === null ? <p className="text-muted-foreground">{s.st.diffFirst}</p> : diff.added.length + diff.removed.length + diff.changed.length === 0 ? <p className="text-muted-foreground">{s.st.noChange}</p> : (
                <ul className="grid gap-0.5 font-mono text-xs">
                  {diff.added.map((a) => <li key={`a${a}`} className="text-emerald-700 dark:text-emerald-400">+ {a}</li>)}
                  {diff.removed.map((a) => <li key={`r${a}`} className="text-destructive">− {a}</li>)}
                  {diff.changed.map((a) => <li key={`c${a}`} className="text-amber-700 dark:text-amber-400">~ {a}</li>)}
                </ul>
              )}
            </div>
            <div className="grid gap-2">
              <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={s.st.filter} className="max-w-sm" data-testid="state-filter" />
              {shown.length === 0 ? <p className="text-sm text-muted-foreground">{s.st.noResources}</p> : (
                <ul className="grid max-h-96 gap-1 overflow-y-auto" data-testid="state-resources">
                  {shown.map((r) => (
                    <li key={r.address} className="rounded border text-sm">
                      <button type="button" className="flex w-full items-center gap-3 px-3 py-1.5 text-left hover:bg-muted" onClick={() => void look(r.address)} data-testid={`state-resource-${r.address}`}>
                        <code className="flex-1 font-mono text-xs">{r.address}</code>
                        <span className="text-xs text-muted-foreground">{r.type}</span>
                        <span className="max-w-48 truncate font-mono text-[11px] text-muted-foreground">{r.id}</span>
                      </button>
                      {openAddress === r.address && open && (
                        <pre className="max-h-72 overflow-auto border-t bg-muted/40 p-3 font-mono text-[11px] leading-5" data-testid="state-attributes">{JSON.stringify(open.length === 1 ? open[0]!.attributes : open, null, 2)}</pre>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="grid gap-1" data-testid="state-outputs">
              <p className="text-sm font-medium">{s.st.outputsTitle} <span className="text-xs font-normal text-muted-foreground">{s.st.hiddenNote}</span></p>
              {detail.outputs.length === 0 ? <p className="text-sm text-muted-foreground">—</p> : detail.outputs.map((o) => (
                <p key={o.name} className="font-mono text-xs"><span className="font-medium">{o.name}</span> = <span className={o.sensitive ? "text-muted-foreground" : ""}>{typeof o.value === "string" ? o.value : JSON.stringify(o.value)}</span></p>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
