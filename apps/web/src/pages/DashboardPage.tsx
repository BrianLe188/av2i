import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type ProjectSummary } from '../api';
import { useAuth } from '../auth';
import { REGIONS, TEMPLATES } from '@av2i/core';

export function DashboardPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [name, setName] = useState('');
  const [templateId, setTemplateId] = useState('');
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
      const p = await api.createProject(name.trim(), region, template?.build(region));
      navigate(`/projects/${p.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
    <div className="page">
      <header className="bar">
        <strong className="logo">av2i</strong>
        <span className="spacer" />
        {user?.avatarUrl && <img className="avatar" src={user.avatarUrl} alt="" />}
        <span>{user?.name ?? user?.login}</span>
        <button onClick={() => void logout()}>Sign out</button>
      </header>
      <main className="dashboard">
        <h2>Projects</h2>
        {error && <div className="banner error">{error}</div>}
        <form className="new-project" onSubmit={create}>
          <input
            type="text"
            placeholder="New project name"
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
          />
          <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} aria-label="Template">
            <option value="">Blank canvas</option>
            {TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <button className="primary" disabled={!name.trim()}>
            Create
          </button>
        </form>
        {templateId && <p className="muted">{TEMPLATES.find((t) => t.id === templateId)?.description}</p>}
        {projects === null ? (
          <p className="muted">Loading…</p>
        ) : projects.length === 0 ? (
          <p className="muted">No projects yet. Create one to open the canvas.</p>
        ) : (
          <ul className="project-grid">
            {projects.map((p) => (
              <li key={p.id} className="project-card">
                <Link to={`/projects/${p.id}`} className="project-link">
                  <strong>{p.name}</strong>
                  <span className="muted">
                    {p.region} · {p.nodeCount} resources
                  </span>
                  <span className="muted">Updated {new Date(p.updatedAt).toLocaleString()}</span>
                </Link>
                <button className="danger" onClick={() => void remove(p)}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
