import { useCallback, useEffect, useState } from "react";
import { History, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import type { Design } from "@av2i/model";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Strings } from "../i18n.ts";
import { listVersions, restoreVersion, saveVersion, type VersionRow } from "../projects.ts";
import { describe } from "./auth/errors.ts";

interface Props {
  s: Strings;
  projectId: string;
  open: boolean;
  onClose: () => void;
  writable: boolean;
  /** make sure what is on the screen has reached the server, so a snapshot or a restore keeps it */
  beforeChange: () => Promise<void>;
  onRestored: (design: Design, rev: number) => void;
}

export function HistoryDialog({ s, projectId, open, onClose, writable, beforeChange, onRestored }: Props) {
  const [versions, setVersions] = useState<VersionRow[] | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<VersionRow | null>(null);

  const load = useCallback(async () => {
    try { setVersions(await listVersions(projectId)); } catch (e) { setError(describe(e, s)); }
  }, [projectId, s]);
  useEffect(() => { if (open) { setError(null); void load(); } }, [open, load]);

  const save = async () => {
    setError(null);
    try {
      await beforeChange();
      await saveVersion(projectId, note.trim());
      setNote("");
      toast(s.proj.versionSaved);
      await load();
    } catch (e) { setError(describe(e, s)); }
  };

  const restore = async () => {
    if (!pending) return;
    try {
      await beforeChange();
      const r = await restoreVersion(projectId, pending.version);
      toast(s.proj.restored);
      setPending(null);
      onRestored(r.design, r.rev);
      onClose();
    } catch (e) { setError(describe(e, s)); setPending(null); }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-lg" data-testid="history-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><History className="size-4" />{s.proj.versions}</DialogTitle>
            <DialogDescription>{s.proj.history}</DialogDescription>
          </DialogHeader>
          {writable && (
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void save(); }}>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={s.proj.versionNote} maxLength={200} data-testid="version-note" />
              <Button type="submit" data-testid="save-version">{s.proj.saveVersion}</Button>
            </form>
          )}
          {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
          <ScrollArea className="min-h-0 flex-1">
            <ul className="grid gap-1.5 pr-3" data-testid="versions">
              {versions?.length === 0 && <li className="text-sm text-muted-foreground">{s.proj.noVersions}</li>}
              {(versions ?? []).map((v) => (
                <li key={v.version} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm" data-testid={`version-${v.version}`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">v{v.version}</span>
                      {v.auto && <Badge variant="outline">{s.proj.auto}</Badge>}
                      <span className="truncate text-muted-foreground">{v.note}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">{new Date(v.createdAt).toLocaleString()}{v.by && ` · ${v.by}`} · {v.nodes} {s.proj.nodes}</div>
                  </div>
                  {writable && <Button size="sm" variant="outline" onClick={() => setPending(v)} data-testid="restore"><RotateCcw />{s.proj.restore}</Button>}
                </li>
              ))}
            </ul>
          </ScrollArea>
        </DialogContent>
      </Dialog>
      <Dialog open={pending !== null} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent className="sm:max-w-sm" data-testid="restore-dialog">
          <DialogHeader>
            <DialogTitle>{s.proj.restoreTitle.replace("{n}", String(pending?.version ?? ""))}</DialogTitle>
            <DialogDescription>{s.proj.restoreText}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPending(null)}>{s.acct.cancel}</Button>
            <Button onClick={() => void restore()} data-testid="restore-confirm">{s.proj.restore}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
