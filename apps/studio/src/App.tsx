import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { upgradeDesign, type Design } from "@av2i/model";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Bottom, type Tab } from "./components/Bottom.tsx";
import { Canvas } from "./components/Canvas.tsx";
import { Inspector } from "./components/Inspector.tsx";
import { Palette } from "./components/Palette.tsx";
import { TopBar } from "./components/TopBar.tsx";
import { strings } from "./i18n.ts";
import { useNavigate } from "react-router";
import { useAuth, type User } from "./auth.tsx";
import { store, type Prefs } from "./prefs.ts";
import { ApiError } from "./api.ts";
import { ConflictDialog, type Conflict } from "./components/ConflictDialog.tsx";
import { HistoryDialog } from "./components/HistoryDialog.tsx";
import { RunDialog } from "./components/RunDialog.tsx";
import { ShareDialog } from "./components/ShareDialog.tsx";
import { SaveQueue, type Failure, type SyncStatus } from "./logic/sync.ts";
import { createProject, getProject, saveProject, type ProjectFull } from "./projects.ts";
import { analyze } from "./logic/analyze.ts";
import { addNode } from "./logic/design.ts";
import { download, zipFiles } from "./logic/files.ts";
import type { Selection } from "./logic/flow.ts";
import * as H from "./logic/history.ts";
import { withPositions } from "./logic/layout.ts";
import { canPlace, findParent } from "./logic/placement.ts";
import { paletteItem } from "./registry.ts";
import { blankDesign, fromTemplate, templates } from "./logic/templates.ts";
import { reg } from "./registry.ts";

/** What a failed save means: someone saved first, the server or the network hiccuped, or it will not work however often we try. */
const classify = (e: unknown): Failure => (e instanceof ApiError ? (e.status === 409 ? "conflict" : e.status >= 500 ? "retry" : "fatal") : "retry");

/** The canvas of one project: it opens what the server has, saves every change a moment after it, and shows who got there first. */
export function App({ prefs, user, project }: { prefs: Prefs; user: User; project: ProjectFull }) {
  const projectId = project.project.id;
  const writable = project.can.write;
  const initial = useMemo(() => withPositions(upgradeDesign(project.project.design)), [project]);
  /** the design the server last gave us: a change that is exactly this object is not saved back */
  const fromServer = useRef<Design>(initial);
  const [hist, setHist] = useState(() => H.start(initial));
  const [selection, setSelection] = useState<Selection>(null);
  const [focus, setFocus] = useState<ReadonlySet<string>>(new Set());
  const { lang, setLang, dark } = prefs;
  const auth = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>(() => (["problems", "terraform", "resources"].includes(store.get("tab") ?? "") ? (store.get("tab") as Tab) : "problems"));
  const [loadId, setLoadId] = useState(0);
  const [status, setStatus] = useState<SyncStatus>("saved");
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [runOpen, setRunOpen] = useState(false);

  const s = strings(lang);
  const design = hist.present;
  const analysis = useMemo(() => analyze(design, reg), [design]);
  const tpls = useMemo(() => templates(reg), []);

  const queue = useMemo(() => new SaveQueue<Design>({
    rev: project.project.rev,
    save: (d, rev) => saveProject(projectId, d, rev),
    classify,
    onStatus: (st, err) => {
      setStatus(st);
      if (st === "conflict" && err instanceof ApiError) {
        setConflict({ currentRev: Number(err.extra.currentRev), updatedBy: (err.extra.updatedBy as string | null) ?? null, updatedAt: (err.extra.updatedAt as string | null) ?? null });
      }
    },
  }), [project, projectId]);

  useEffect(() => { if (design !== fromServer.current) queue.update(design); }, [design, queue]);
  useEffect(() => { store.set("tab", tab); }, [tab]);
  // what is still waiting to be saved goes out when the page closes underneath, and the browser warns first
  useEffect(() => () => { void queue.flush(); }, [queue]);
  useEffect(() => {
    if (status === "saved") return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [status]);
  const setToast = useCallback((message: string) => { toast(message); }, []);

  const edit = useCallback((f: (d: Design) => Design) => { if (writable) setHist((h) => H.push(h, f(h.present))); }, [writable]);
  /** what the server sent replaces the design on screen and is not saved back */
  const adopt = useCallback((d: Design, rev: number) => {
    const next = withPositions(upgradeDesign(d));
    fromServer.current = next;
    queue.adopt(rev, next);
    setHist(H.start(next));
    setSelection(null);
    setFocus(new Set());
    setLoadId((n) => n + 1);
  }, [queue]);
  const replace = useCallback((d: Design) => { if (!writable) return; setHist(H.start(d)); setSelection(null); setFocus(new Set()); setLoadId((n) => n + 1); }, [writable]);

  const leave = async (to: string) => {
    await queue.flush();
    if (queue.status === "saved" || window.confirm(s.proj.leaveUnsaved)) navigate(to);
  };
  const reload = async () => {
    try { const fresh = await getProject(projectId); adopt(fresh.project.design, fresh.project.rev); setConflict(null); } catch { setToast(s.proj.errorFatal); }
  };
  const copyMine = async () => {
    try { const p = await createProject(design, `${design.name} (copy)`); setConflict(null); navigate(`/projects/${p.id}`); } catch { setToast(s.proj.errorFatal); }
  };

  const select = useCallback((sel: Selection, f?: string[]) => { setSelection(sel); setFocus(new Set(f ?? [])); }, []);

  const add = useCallback((itemId: string, parent: string | null | undefined, position?: { x: number; y: number }) => {
    const item = paletteItem(itemId);
    if (!item || !writable) return;
    const current = hist.present;
    const target = parent === undefined ? findParent(reg, current, item.service, selection?.kind === "node" ? selection.id : null, item.props) : parent;
    if (target === undefined) {
      const v = canPlace(reg, null, item.service, item.props);
      setToast(`${s.dropRefused}: ${v.ok ? "" : v.reason[lang]}`);
      return;
    }
    const r = addNode(reg, current, item.service, target, position, item.props);
    setHist((h) => H.push(h, withPositions(upgradeDesign(r.design))));
    setSelection({ kind: "node", id: r.key });
    setFocus(new Set());
  }, [hist.present, selection, s, lang, writable]);

  const nameOf = useCallback((key: string) => design.nodes.find((n) => n.key === key)?.label ?? analysis.normalized?.nodes.find((n) => n.key === key)?.label ?? key, [design, analysis]);

  const undo = () => { if (writable) { setHist(H.undo); setSelection(null); } };
  const redo = () => { if (writable) { setHist(H.redo); setSelection(null); } };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.matches("input, textarea, select")) return;
      if (writable && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") { e.preventDefault(); setHist(e.shiftKey ? H.redo : H.undo); setSelection(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [writable]);

  const openFile = async (file: File) => {
    try {
      const d = JSON.parse(await file.text()) as Design;
      if (d.schema !== 1 || !Array.isArray(d.nodes) || !Array.isArray(d.edges)) throw new Error("not a design");
      replace(withPositions(upgradeDesign(d)));
      setToast(s.opened);
    } catch { setToast(s.badFile); }
  };

  const exportZip = () => {
    if (!analysis.files || analysis.errors > 0) return setToast(s.cannotExport);
    download(`${design.name || "design"}-terraform.zip`, zipFiles(analysis.files), "application/zip");
    setToast(s.exported);
  };

  const empty = design.nodes.length === 0;

  return (
    <TooltipProvider>
    <div className="grid h-full grid-cols-[200px_minmax(0,1fr)_320px] grid-rows-[48px_minmax(0,1fr)_300px]" style={{ gridTemplateAreas: '"top top top" "pal main insp" "bot bot bot"' }} data-testid="app">
      <TopBar
        s={s} lang={lang} dark={dark} name={design.name === "untitled" ? s.untitled : design.name}
        canUndo={hist.past.length > 0} canRedo={hist.future.length > 0} canExport={analysis.files !== null && analysis.errors === 0} templates={tpls}
        onUndo={undo} onRedo={redo} onOpenFile={openFile}
        onSave={() => download(`${design.name || "design"}.json`, JSON.stringify(design, null, 2), "application/json")}
        onExport={exportZip}
        onBlank={() => replace(blankDesign(design.settings.region))}
        onTemplate={(id, v) => replace(fromTemplate(reg, id, v))}
        onLang={setLang}
        onTheme={prefs.toggleDark}
        user={user}
        onHome={() => void leave("/projects")}
        status={status}
        readOnly={!writable}
        onStatusClick={() => status === "conflict" && conflict === null && setConflict({ currentRev: queue.rev, updatedBy: null, updatedAt: null })}
        onHistory={() => setHistoryOpen(true)}
        onShare={project.can.share ? () => setShareOpen(true) : undefined}
        onRun={project.can.plan ? () => setRunOpen(true) : undefined}
        onAccount={(what) => (what === "logout" ? void auth.logout() : void leave("/account"))}
      />
      <Palette lang={lang} s={s} onAdd={(service) => add(service, undefined)} disabled={!writable} />
      <main className="relative min-h-0 min-w-0" style={{ gridArea: "main" }}>
        <Canvas
          design={design} analysis={analysis} selection={selection} focus={focus} lang={lang} s={s} loadId={loadId} dark={dark}
          onSelect={select} onEdit={edit} onAdd={add} onToast={setToast} readOnly={!writable}
        />
        {empty && writable && (
          <Card className="absolute inset-0 m-auto h-fit w-[360px] text-center shadow-lg" data-testid="welcome">
            <CardHeader>
              <CardTitle className="text-base">{s.welcomeTitle}</CardTitle>
              <CardDescription>{s.welcomeText}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => replace(fromTemplate(reg, "ec2-in-vpc"))}>{s.startTemplate}</Button>
            </CardContent>
          </Card>
        )}
      </main>
      <Inspector design={design} analysis={analysis} selection={selection} lang={lang} s={s} onEdit={edit} onSelect={select} readOnly={!writable} />
      <Bottom analysis={analysis} lang={lang} s={s} tab={tab} onTab={setTab} onSelect={select} nameOf={nameOf} />
    </div>
    <HistoryDialog
      s={s} projectId={projectId} open={historyOpen} onClose={() => setHistoryOpen(false)} writable={writable}
      beforeChange={() => queue.flush()} onRestored={(d, rev) => adopt(d, rev)}
    />
    <ShareDialog s={s} projectId={projectId} open={shareOpen} onClose={() => setShareOpen(false)} />
    <RunDialog s={s} projectId={projectId} open={runOpen} onClose={() => setRunOpen(false)} beforeRun={() => queue.flush()} />
    <ConflictDialog
      s={s} conflict={conflict} onClose={() => setConflict(null)}
      onReload={() => void reload()} onOverwrite={() => { if (conflict) queue.overwrite(conflict.currentRev); setConflict(null); }} onCopy={() => void copyMine()}
    />
    <Toaster theme={dark ? "dark" : "light"} position="bottom-center" />
    </TooltipProvider>
  );
}
