import { useCallback, useEffect, useMemo, useState } from "react";
import type { Design } from "@av2i/model";
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
import { useAuth, type User } from "./auth.tsx";
import { ChangePasswordForm } from "./components/auth/Screens.tsx";
import { UsersDialog } from "./components/UsersDialog.tsx";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { store, type Prefs } from "./prefs.ts";
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

/** Drafts are kept per person: two people on one browser must not see each other's work. */
const draftKey = (userId: string) => `draft.${userId}`;

function loadDraft(userId: string): Design | null {
  // a draft made before there were accounts goes to the first person who signs in
  const legacy = store.get("draft");
  if (legacy && !store.get(draftKey(userId))) store.set(draftKey(userId), legacy);
  store.remove("draft");
  const raw = store.get(draftKey(userId));
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as Design;
    return d.schema === 1 && Array.isArray(d.nodes) && Array.isArray(d.edges) ? d : null;
  } catch { return null; }
}

export function App({ prefs, user }: { prefs: Prefs; user: User }) {
  const draft = useMemo(() => loadDraft(user.id), [user.id]);
  const [hist, setHist] = useState(() => H.start(draft ?? blankDesign()));
  const [selection, setSelection] = useState<Selection>(null);
  const [focus, setFocus] = useState<ReadonlySet<string>>(new Set());
  const { lang, setLang, dark } = prefs;
  const auth = useAuth();
  const [dialog, setDialog] = useState<null | "password" | "users">(null);
  const [tab, setTab] = useState<Tab>(() => (["problems", "terraform", "resources"].includes(store.get("tab") ?? "") ? (store.get("tab") as Tab) : "problems"));
  const [loadId, setLoadId] = useState(0);

  const s = strings(lang);
  const design = hist.present;
  const analysis = useMemo(() => analyze(design, reg), [design]);
  const tpls = useMemo(() => templates(reg), []);

  useEffect(() => { store.set(draftKey(user.id), JSON.stringify(design)); }, [design, user.id]);
  useEffect(() => { store.set("tab", tab); }, [tab]);
  const setToast = useCallback((message: string) => { toast(message); }, []);
  useEffect(() => { if (draft) toast(strings(store.get("lang") === "en" ? "en" : "vi").draftRestored); }, [draft]);

  const edit = useCallback((f: (d: Design) => Design) => setHist((h) => H.push(h, f(h.present))), []);
  const replace = useCallback((d: Design) => { setHist(H.start(d)); setSelection(null); setFocus(new Set()); setLoadId((n) => n + 1); }, []);
  const select = useCallback((sel: Selection, f?: string[]) => { setSelection(sel); setFocus(new Set(f ?? [])); }, []);

  const add = useCallback((itemId: string, parent: string | null | undefined, position?: { x: number; y: number }) => {
    const item = paletteItem(itemId);
    if (!item) return;
    const current = hist.present;
    const target = parent === undefined ? findParent(reg, current, item.service, selection?.kind === "node" ? selection.id : null, item.props) : parent;
    if (target === undefined) {
      const v = canPlace(reg, null, item.service, item.props);
      setToast(`${s.dropRefused}: ${v.ok ? "" : v.reason[lang]}`);
      return;
    }
    const r = addNode(reg, current, item.service, target, position, item.props);
    setHist((h) => H.push(h, withPositions(r.design)));
    setSelection({ kind: "node", id: r.key });
    setFocus(new Set());
  }, [hist.present, selection, s, lang]);

  const nameOf = useCallback((key: string) => design.nodes.find((n) => n.key === key)?.label ?? analysis.normalized?.nodes.find((n) => n.key === key)?.label ?? key, [design, analysis]);

  const undo = () => { setHist(H.undo); setSelection(null); };
  const redo = () => { setHist(H.redo); setSelection(null); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.matches("input, textarea, select")) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") { e.preventDefault(); setHist(e.shiftKey ? H.redo : H.undo); setSelection(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const openFile = async (file: File) => {
    try {
      const d = JSON.parse(await file.text()) as Design;
      if (d.schema !== 1 || !Array.isArray(d.nodes) || !Array.isArray(d.edges)) throw new Error("not a design");
      replace(withPositions(d));
      setToast(s.opened);
    } catch { setToast(s.badFile); }
  };

  const exportZip = () => {
    if (!analysis.files) return setToast(s.cannotExport);
    download(`${design.name || "design"}-terraform.zip`, zipFiles(analysis.files), "application/zip");
    setToast(s.exported);
  };

  const empty = design.nodes.length === 0;

  return (
    <TooltipProvider>
    <div className="grid h-full grid-cols-[200px_minmax(0,1fr)_320px] grid-rows-[48px_minmax(0,1fr)_300px]" style={{ gridTemplateAreas: '"top top top" "pal main insp" "bot bot bot"' }} data-testid="app">
      <TopBar
        s={s} lang={lang} dark={dark} name={design.name === "untitled" ? s.untitled : design.name}
        canUndo={hist.past.length > 0} canRedo={hist.future.length > 0} canExport={analysis.files !== null} templates={tpls}
        onUndo={undo} onRedo={redo} onOpenFile={openFile}
        onSave={() => download(`${design.name || "design"}.json`, JSON.stringify(design, null, 2), "application/json")}
        onExport={exportZip}
        onBlank={() => replace(blankDesign(design.settings.region))}
        onTemplate={(id, v) => replace(fromTemplate(reg, id, v))}
        onLang={setLang}
        onTheme={prefs.toggleDark}
        user={user}
        canManageUsers={auth.can("user:List")}
        onAccount={(what) => (what === "logout" ? void auth.logout() : setDialog(what))}
      />
      <Palette lang={lang} s={s} onAdd={(service) => add(service, undefined)} />
      <main className="relative min-h-0 min-w-0" style={{ gridArea: "main" }}>
        <Canvas
          design={design} analysis={analysis} selection={selection} focus={focus} lang={lang} s={s} loadId={loadId} dark={dark}
          onSelect={select} onEdit={edit} onAdd={add} onToast={setToast}
        />
        {empty && (
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
      <Inspector design={design} analysis={analysis} selection={selection} lang={lang} s={s} onEdit={edit} onSelect={select} />
      <Bottom analysis={analysis} lang={lang} s={s} tab={tab} onTab={setTab} onSelect={select} nameOf={nameOf} />
    </div>
    <Dialog open={dialog === "password"} onOpenChange={(o) => !o && setDialog(null)}>
      <DialogContent className="sm:max-w-sm" data-testid="password-dialog">
        <DialogHeader>
          <DialogTitle>{s.acct.changePassword}</DialogTitle>
          <DialogDescription>{user.username}</DialogDescription>
        </DialogHeader>
        <ChangePasswordForm s={s} username={user.username} onDone={() => { setDialog(null); toast(s.acct.passwordChanged); }} />
      </DialogContent>
    </Dialog>
    <UsersDialog open={dialog === "users"} onClose={() => setDialog(null)} s={s} selfId={user.id} />
    <Toaster theme={dark ? "dark" : "light"} position="bottom-center" />
    </TooltipProvider>
  );
}
