import { useCallback, useEffect, useMemo, useState } from "react";
import type { Design } from "@av2i/model";
import { Bottom, type Tab } from "./components/Bottom.tsx";
import { Canvas } from "./components/Canvas.tsx";
import { Inspector } from "./components/Inspector.tsx";
import { Palette } from "./components/Palette.tsx";
import { TopBar } from "./components/TopBar.tsx";
import { strings, type Lang } from "./i18n.ts";
import { analyze } from "./logic/analyze.ts";
import { addNode } from "./logic/design.ts";
import { download, zipFiles } from "./logic/files.ts";
import type { Selection } from "./logic/flow.ts";
import * as H from "./logic/history.ts";
import { withPositions } from "./logic/layout.ts";
import { canPlace, findParent } from "./logic/placement.ts";
import { blankDesign, fromTemplate, templates } from "./logic/templates.ts";
import { reg } from "./registry.ts";

const store = {
  get(k: string): string | null { try { return localStorage.getItem(`av2i.${k}`); } catch { return null; } },
  set(k: string, v: string): void { try { localStorage.setItem(`av2i.${k}`, v); } catch { /* storage may be blocked */ } },
};

function loadDraft(): Design | null {
  const raw = store.get("draft");
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as Design;
    return d.schema === 1 && Array.isArray(d.nodes) && Array.isArray(d.edges) ? d : null;
  } catch { return null; }
}

export function App() {
  const draft = useMemo(loadDraft, []);
  const [hist, setHist] = useState(() => H.start(draft ?? blankDesign()));
  const [selection, setSelection] = useState<Selection>(null);
  const [focus, setFocus] = useState<ReadonlySet<string>>(new Set());
  const [lang, setLang] = useState<Lang>(() => (store.get("lang") === "en" ? "en" : "vi"));
  const [tab, setTab] = useState<Tab>(() => (["problems", "terraform", "resources"].includes(store.get("tab") ?? "") ? (store.get("tab") as Tab) : "problems"));
  const [toast, setToast] = useState<string | null>(draft ? "draft" : null);
  const [loadId, setLoadId] = useState(0);

  const s = strings(lang);
  const design = hist.present;
  const analysis = useMemo(() => analyze(design, reg), [design]);
  const tpls = useMemo(() => templates(reg), []);

  useEffect(() => { store.set("draft", JSON.stringify(design)); }, [design]);
  useEffect(() => { store.set("lang", lang); document.documentElement.lang = lang; }, [lang]);
  useEffect(() => { store.set("tab", tab); }, [tab]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const edit = useCallback((f: (d: Design) => Design) => setHist((h) => H.push(h, f(h.present))), []);
  const replace = useCallback((d: Design) => { setHist(H.start(d)); setSelection(null); setFocus(new Set()); setLoadId((n) => n + 1); }, []);
  const select = useCallback((sel: Selection, f?: string[]) => { setSelection(sel); setFocus(new Set(f ?? [])); }, []);

  const add = useCallback((service: string, parent: string | null | undefined, position?: { x: number; y: number }) => {
    const current = hist.present;
    const target = parent === undefined ? findParent(reg, current, service, selection?.kind === "node" ? selection.id : null) : parent;
    if (target === undefined) {
      const v = canPlace(reg, null, service);
      setToast(`${s.dropRefused}: ${v.ok ? "" : v.reason[lang]}`);
      return;
    }
    const r = addNode(reg, current, service, target, position);
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

  const toastText = toast === "draft" ? s.draftRestored : toast;
  const empty = design.nodes.length === 0;

  return (
    <div className="app" data-testid="app">
      <TopBar
        s={s} lang={lang} name={design.name === "untitled" ? s.untitled : design.name}
        canUndo={hist.past.length > 0} canRedo={hist.future.length > 0} canExport={analysis.files !== null} templates={tpls}
        onUndo={undo} onRedo={redo} onOpenFile={openFile}
        onSave={() => download(`${design.name || "design"}.json`, JSON.stringify(design, null, 2), "application/json")}
        onExport={exportZip}
        onBlank={() => replace(blankDesign(design.settings.region))}
        onTemplate={(id, v) => replace(fromTemplate(reg, id, v))}
        onLang={setLang}
        onTheme={() => { const root = document.documentElement; const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches; root.dataset.theme = dark ? "light" : "dark"; }}
      />
      <Palette lang={lang} s={s} onAdd={(service) => add(service, undefined)} />
      <main className="main">
        <Canvas
          design={design} analysis={analysis} selection={selection} focus={focus} lang={lang} s={s} loadId={loadId}
          onSelect={select} onEdit={edit} onAdd={add} onToast={setToast}
        />
        {empty && (
          <div className="welcome" data-testid="welcome">
            <h2>{s.welcomeTitle}</h2>
            <p>{s.welcomeText}</p>
            <button type="button" className="primary" onClick={() => replace(fromTemplate(reg, "ec2-in-vpc"))}>{s.startTemplate}</button>
          </div>
        )}
        {toastText && <div className="toast" role="status" data-testid="toast">{toastText}</div>}
      </main>
      <Inspector design={design} analysis={analysis} selection={selection} lang={lang} s={s} onEdit={edit} onSelect={select} />
      <Bottom analysis={analysis} lang={lang} s={s} tab={tab} onTab={setTab} onSelect={select} nameOf={nameOf} />
    </div>
  );
}

