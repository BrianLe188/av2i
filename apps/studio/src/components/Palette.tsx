import { PALETTE, reg } from "../registry.ts";
import { title } from "../logic/placement.ts";
import type { Lang, Strings } from "../i18n.ts";

export const DRAG_TYPE = "application/x-av2i-service";

export function Palette({ lang, s, onAdd }: { lang: Lang; s: Strings; onAdd: (service: string) => void }) {
  return (
    <aside className="palette" aria-label={s.palette}>
      <h2>{s.palette}</h2>
      <p className="hint">{s.paletteHint}</p>
      <ul>
        {PALETTE.map(({ id, service, title: own }) => (
          <li key={id}>
            <button
              type="button"
              className="palette-item"
              data-svc={service}
              data-testid={`palette-${id}`}
              draggable
              onDragStart={(e) => { e.dataTransfer.setData(DRAG_TYPE, id); e.dataTransfer.effectAllowed = "copy"; }}
              onClick={() => onAdd(id)}
            >
              <span className="swatch" />
              {own ? own[lang] : title(reg, service, lang)}
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
