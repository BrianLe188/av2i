import { useRef } from "react";
import type { Template } from "../logic/templates.ts";
import type { Lang, Strings } from "../i18n.ts";

interface Props {
  s: Strings;
  lang: Lang;
  name: string;
  canUndo: boolean;
  canRedo: boolean;
  canExport: boolean;
  templates: Template[];
  onUndo: () => void;
  onRedo: () => void;
  onOpenFile: (file: File) => void;
  onSave: () => void;
  onExport: () => void;
  onBlank: () => void;
  onTemplate: (id: string, variant?: string) => void;
  onLang: (l: Lang) => void;
  onTheme: () => void;
}

export function TopBar(p: Props) {
  const input = useRef<HTMLInputElement>(null);
  const { s } = p;
  return (
    <header className="topbar">
      <strong className="brand">{s.app}</strong>
      <span className="design-name" title={p.name}>{p.name}</span>
      <div className="spacer" />
      <button type="button" onClick={p.onUndo} disabled={!p.canUndo} data-testid="undo">↶ {s.undo}</button>
      <button type="button" onClick={p.onRedo} disabled={!p.canRedo} data-testid="redo">↷ {s.redo}</button>
      <details className="menu">
        <summary data-testid="templates">{s.templates}</summary>
        <div className="menu-body">
          <button type="button" onClick={(e) => { p.onBlank(); (e.currentTarget.closest("details") as HTMLDetailsElement).open = false; }}>{s.blank}</button>
          {p.templates.map((t) => (
            <div key={t.id}>
              <button type="button" data-testid={`template-${t.id}`} onClick={(e) => { p.onTemplate(t.id); (e.currentTarget.closest("details") as HTMLDetailsElement).open = false; }}>{t.title[p.lang]}</button>
              {t.variants.length > 0 && (
                <details className="variants">
                  <summary>{s.variantsOf} {t.id} ({t.variants.length})</summary>
                  {t.variants.map((v) => (
                    <button key={v.id} type="button" title={v.change} data-testid={`variant-${v.id}`} onClick={(e) => { p.onTemplate(t.id, v.id); (e.currentTarget.closest("details.menu") as HTMLDetailsElement).open = false; }}>{v.change}</button>
                  ))}
                </details>
              )}
            </div>
          ))}
        </div>
      </details>
      <button type="button" onClick={() => input.current?.click()}>{s.open}</button>
      <input ref={input} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) p.onOpenFile(f); e.target.value = ""; }} />
      <button type="button" onClick={p.onSave}>{s.save}</button>
      <select value={p.lang} aria-label={s.language} onChange={(e) => p.onLang(e.target.value as Lang)}>
        <option value="vi">Tiếng Việt</option>
        <option value="en">English</option>
      </select>
      <button type="button" onClick={p.onTheme} aria-label={s.theme}>◐</button>
      <button type="button" className="primary" onClick={p.onExport} disabled={!p.canExport} title={p.canExport ? undefined : s.cannotExport} data-testid="export">{s.exportTf}</button>
    </header>
  );
}
