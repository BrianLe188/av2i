import { useState } from "react";
import { FileClock } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useAuth, useUser } from "../auth.tsx";
import { clearDraft, loadDraft } from "../drafts.ts";
import { useCreateProject } from "../pages/useCreate.ts";
import { useStrings } from "../prefs.ts";

/** A draft this browser kept from before projects lived on the server: offer to make it a project, or let it go. */
export function DraftBanner() {
  const s = useStrings();
  const user = useUser();
  const { can } = useAuth();
  const create = useCreateProject();
  const [draft, setDraft] = useState(() => loadDraft(user.id));
  if (!draft || draft.nodes.length === 0) return null;
  return (
    <Alert className="mb-4" data-testid="draft-banner">
      <FileClock />
      <AlertTitle>{s.proj.draftTitle}</AlertTitle>
      <AlertDescription>
        <p>{s.proj.draftText.replace("{n}", String(draft.nodes.length))}</p>
        <div className="mt-2 flex gap-2">
          <Button size="sm" disabled={!can("project:Create")} onClick={() => { void create(draft, draft.name === "untitled" ? s.proj.defaultName : draft.name).then(() => clearDraft(user.id)); }} data-testid="draft-save">{s.proj.draftSave}</Button>
          <Button size="sm" variant="ghost" onClick={() => { clearDraft(user.id); setDraft(null); }} data-testid="draft-drop">{s.proj.draftDrop}</Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
