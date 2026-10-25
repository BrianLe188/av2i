import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Strings } from "../i18n.ts";

export interface Conflict {
  currentRev: number;
  updatedBy: string | null;
  updatedAt: string | null;
}

interface Props {
  s: Strings;
  conflict: Conflict | null;
  onClose: () => void;
  onReload: () => void;
  onOverwrite: () => void;
  onCopy: () => void;
}

/** Another person saved first. Three ways out, none of them silent: take theirs, overwrite with mine, or keep mine as a new project. */
export function ConflictDialog({ s, conflict, onClose, onReload, onOverwrite, onCopy }: Props) {
  const who = conflict?.updatedBy ?? s.proj.someone;
  const when = conflict?.updatedAt ? new Date(conflict.updatedAt).toLocaleString() : "";
  return (
    <Dialog open={conflict !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md" data-testid="conflict-dialog">
        <DialogHeader>
          <DialogTitle>{s.proj.conflictTitle}</DialogTitle>
          <DialogDescription>{s.proj.conflictText.replace("{who}", who).replace("{when}", when)}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Button variant="outline" onClick={onReload} data-testid="conflict-reload">{s.proj.conflictReload}</Button>
          <Button variant="outline" onClick={onCopy} data-testid="conflict-copy">{s.proj.conflictCopy}</Button>
          <Button variant="destructive" onClick={onOverwrite} data-testid="conflict-overwrite">{s.proj.conflictOverwrite}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
