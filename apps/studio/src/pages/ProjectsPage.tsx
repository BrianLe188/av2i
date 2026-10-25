import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { FolderOpen, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "../auth.tsx";
import { describe } from "../components/auth/errors.ts";
import { DraftBanner } from "../components/DraftBanner.tsx";
import { NewProjectDialog } from "../components/NewProjectDialog.tsx";
import { deleteProject, listProjects, type ProjectSummary } from "../projects.ts";
import { useStrings } from "../prefs.ts";
import { Page } from "./Page.tsx";

export function ProjectsPage() {
  const s = useStrings();
  const { can } = useAuth();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [doomed, setDoomed] = useState<ProjectSummary | null>(null);

  const load = useCallback(async () => {
    try { setProjects(await listProjects()); } catch (e) { setError(describe(e, s)); }
  }, [s]);
  useEffect(() => { void load(); }, [load]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (projects ?? []).filter((p) => !q || p.name.toLowerCase().includes(q) || (p.owner ?? "").toLowerCase().includes(q));
  }, [projects, query]);

  const remove = async () => {
    if (!doomed) return;
    try {
      await deleteProject(doomed.id);
      toast(s.proj.deleted);
      setDoomed(null);
      await load();
    } catch (e) { setError(describe(e, s)); setDoomed(null); }
  };

  return (
    <Page
      title={s.proj.projects}
      text={s.proj.projectsText}
      wide
      actions={<Button onClick={() => setCreating(true)} disabled={!can("project:Create")} title={can("project:Create") ? undefined : s.proj.noCreate} data-testid="new-project"><Plus />{s.proj.newProject}</Button>}
    >
      <div className="grid gap-4">
        <DraftBanner />
        {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
        {!can("project:Create") && <Alert><AlertDescription>{s.proj.noCreate}</AlertDescription></Alert>}
        <div className="relative max-w-sm">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input className="pl-8" placeholder={s.proj.search} aria-label={s.proj.search} value={query} onChange={(e) => setQuery(e.target.value)} data-testid="project-search" />
        </div>
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow><TableHead>{s.proj.projectName}</TableHead><TableHead>{s.proj.owner}</TableHead><TableHead>{s.proj.size}</TableHead><TableHead>{s.proj.updated}</TableHead><TableHead /></TableRow>
            </TableHeader>
            <TableBody>
              {projects !== null && shown.length === 0 && (
                <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground" data-testid="no-projects">{projects.length === 0 ? s.proj.empty : s.nav.noMatch}</TableCell></TableRow>
              )}
              {shown.map((p) => (
                <TableRow key={p.id} data-testid={`project-${p.id}`}>
                  <TableCell className="font-medium"><Link to={`/projects/${p.id}`} className="hover:underline" data-testid="project-link">{p.name === "untitled" ? s.untitled : p.name}</Link></TableCell>
                  <TableCell>{p.owner ?? "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{p.nodes} {s.proj.nodes} · {p.edges} {s.proj.edges}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs">{new Date(p.updatedAt).toLocaleString()}{p.updatedBy && <span className="text-muted-foreground"> {s.proj.by} {p.updatedBy}</span>}</TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    <Button asChild size="sm" variant="ghost"><Link to={`/projects/${p.id}`}><FolderOpen />{s.proj.open}</Link></Button>
                    {p.can.delete && <Button size="sm" variant="ghost" onClick={() => setDoomed(p)} data-testid="delete-project"><Trash2 />{s.proj.delete}</Button>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>
      <NewProjectDialog open={creating} onClose={() => setCreating(false)} />
      <Dialog open={doomed !== null} onOpenChange={(o) => !o && setDoomed(null)}>
        <DialogContent className="sm:max-w-sm" data-testid="delete-dialog">
          <DialogHeader>
            <DialogTitle>{s.proj.deleteTitle}</DialogTitle>
            <DialogDescription>{doomed?.name}. {s.proj.deleteText}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDoomed(null)}>{s.acct.cancel}</Button>
            <Button variant="destructive" onClick={() => void remove()} data-testid="delete-confirm">{s.proj.delete}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  );
}
