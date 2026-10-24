import { ScrollArea } from "@/components/ui/scroll-area";
import { PALETTE, reg } from "../registry.ts";
import { colorOf } from "../logic/colors.ts";
import { title } from "../logic/placement.ts";
import type { Lang, Strings } from "../i18n.ts";

export const DRAG_TYPE = "application/x-av2i-service";

export function Palette({ lang, s, onAdd }: { lang: Lang; s: Strings; onAdd: (service: string) => void }) {
  return (
    <aside className="flex min-h-0 flex-col border-r bg-card" style={{ gridArea: "pal" }} aria-label={s.palette}>
      <div className="p-3 pb-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{s.palette}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{s.paletteHint}</p>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <ul className="flex flex-col gap-1.5 px-3 pb-3">
          {PALETTE.map(({ id, service, title: own }) => (
            <li key={id}>
              <button
                type="button"
                className="flex w-full cursor-grab items-center gap-2 rounded-md border bg-background px-2.5 py-1.5 text-left text-[13px] transition-colors hover:border-ring hover:bg-accent active:cursor-grabbing"
                data-svc={service}
                data-testid={`palette-${id}`}
                draggable
                onDragStart={(e) => { e.dataTransfer.setData(DRAG_TYPE, id); e.dataTransfer.effectAllowed = "copy"; }}
                onClick={() => onAdd(id)}
              >
                <span className="size-2.5 flex-none rounded-[3px]" style={{ background: colorOf(service) }} />
                {own ? own[lang] : title(reg, service, lang)}
              </button>
            </li>
          ))}
        </ul>
      </ScrollArea>
    </aside>
  );
}
