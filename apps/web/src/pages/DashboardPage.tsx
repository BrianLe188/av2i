import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type ProjectSummary } from '../api';
import { useAuth } from '../auth';
import { autoLayout } from '../layout';
import { ImportDialog } from '../components/ImportDialog';
import { REGIONS, TEMPLATES, type ImportResult } from '@av2i/core';
import { FileUp, Plus, Trash2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { SimpleSelect } from '../components/SimpleSelect';

export function DashboardPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [name, setName] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.listProjects().then(setProjects).catch((e) => setError(e.message));
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      const region = REGIONS[0];
      const template = TEMPLATES.find((t) => t.id === templateId);
      const built = template?.build(region);
      const graph = built && { ...built, nodes: await autoLayout(built) };
      const p = await api.createProject(name.trim(), region, graph);
      navigate(`/projects/${p.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const createFromImport = async (projectName: string, result: ImportResult) => {
    try {
      const graph = { ...result.graph, nodes: await autoLayout(result.graph) };
      const p = await api.createProject(projectName, result.region, graph);
      navigate(`/projects/${p.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setImporting(false);
    }
  };

  const remove = async (p: ProjectSummary) => {
    if (!window.confirm(`Delete project "${p.name}"? This cannot be undone.`)) return;
    try {
      await api.deleteProject(p.id);
      setProjects((list) => list?.filter((x) => x.id !== p.id) ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex items-center gap-2 border-b bg-card px-3 py-2">
        <strong className="tracking-wide">av2i</strong>
        <span className="flex-1" />
        {user?.avatarUrl && <img className="size-6 rounded-full" src={user.avatarUrl} alt="" />}
        <span className="text-sm">{user?.name ?? user?.login}</span>
        <Button variant="outline" size="sm" onClick={() => void logout()}>
          Sign out
        </Button>
      </header>
      <main className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-6">
        <h2 className="text-xl font-semibold">Projects</h2>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <form className="flex flex-wrap gap-2" onSubmit={create}>
          <Input
            className="max-w-sm flex-1"
            type="text"
            placeholder="New project name"
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
          />
          <SimpleSelect
            className="w-56"
            label="Template"
            value={templateId}
            onChange={setTemplateId}
            options={[{ value: '', label: 'Blank canvas' }, ...TEMPLATES.map((t) => ({ value: t.id, label: t.name }))]}
          />
          <Button disabled={!name.trim()}>
            <Plus /> Create
          </Button>
          <Button type="button" variant="outline" onClick={() => setImporting(true)}>
            <FileUp /> Import Terraform…
          </Button>
        </form>
        {templateId && <p className="text-sm text-muted-foreground">{TEMPLATES.find((t) => t.id === templateId)?.description}</p>}
        {projects === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : projects.length === 0 ? (
          <p className="text-sm text-muted-foreground">No projects yet. Create one to open the canvas.</p>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
            {projects.map((p) => (
              <li key={p.id}>
                <Card className="h-full gap-2 py-3 transition-colors hover:border-primary">
                  <CardContent className="px-3">
                    <Link to={`/projects/${p.id}`} className="flex flex-col gap-1">
                      <strong>{p.name}</strong>
                      <span className="text-xs text-muted-foreground">
                        {p.region} · {p.nodeCount} resources
                      </span>
                      <span className="text-xs text-muted-foreground">Updated {new Date(p.updatedAt).toLocaleString()}</span>
                    </Link>
                  </CardContent>
                  <CardFooter className="justify-end px-3">
                    <Button variant="destructive" size="xs" onClick={() => void remove(p)}>
                      <Trash2 /> Delete
                    </Button>
                  </CardFooter>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </main>
      {importing && <ImportDialog onClose={() => setImporting(false)} onCreate={createFromImport} />}
    </div>
  );
}
