import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fromTemplate, templates } from "../logic/templates.ts";
import { useCreateProject } from "../pages/useCreate.ts";
import { usePrefsContext, useStrings } from "../prefs.ts";
import { reg } from "../registry.ts";

/** Asks for a name and, if wanted, a template to start from; then makes the project and opens it. */
export function NewProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useStrings();
  const { lang } = usePrefsContext();
  const create = useCreateProject();
  const tpls = useMemo(() => templates(reg), []);
  const [name, setName] = useState("");
  const [template, setTemplate] = useState("blank");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    const title = name.trim() || (template === "blank" ? s.proj.defaultName : tpls.find((t) => t.id === template)!.title[lang]);
    const design = template === "blank" ? undefined : { ...fromTemplate(reg, template), name: title };
    await create(design, title);
    setBusy(false);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md" data-testid="new-project-dialog">
        <DialogHeader>
          <DialogTitle>{s.proj.newProject}</DialogTitle>
          <DialogDescription>{s.proj.emptyHint}</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <div className="grid gap-1.5">
            <Label htmlFor="project-name">{s.proj.projectName}</Label>
            <Input id="project-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={s.proj.defaultName} autoFocus data-testid="project-name" />
          </div>
          <div className="grid gap-1.5">
            <Label>{s.nav.fromTemplate}</Label>
            <Select value={template} onValueChange={setTemplate}>
              <SelectTrigger className="w-full" data-testid="project-template"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="blank">{s.blank}</SelectItem>
                {tpls.map((t) => <SelectItem key={t.id} value={t.id}>{t.title[lang]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>{s.acct.cancel}</Button>
            <Button type="submit" disabled={busy} data-testid="project-create">{s.proj.create}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
