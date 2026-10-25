import { useMemo, useState } from "react";
import { ChevronRight, Search, X } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PALETTE, reg } from "../registry.ts";
import { colorOf } from "../logic/colors.ts";
import { iconOf } from "../logic/icons.ts";
import { sections } from "../logic/palette.ts";
import { title } from "../logic/placement.ts";
import type { Lang, Strings } from "../i18n.ts";

export const DRAG_TYPE = "application/x-av2i-service";

const STORE = "av2i.palette.closed";

function closedGroups(): string[] {
  try { const v = JSON.parse(localStorage.getItem(STORE) ?? "[]"); return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []; } catch { return []; }
}

export function Palette({ lang, s, onAdd, disabled }: { lang: Lang; s: Strings; onAdd: (service: string) => void; disabled?: boolean }) {
  const [query, setQuery] = useState("");
  const [closed, setClosed] = useState<string[]>(closedGroups);
  const searching = query.trim() !== "";
  const shown = useMemo(
    () => sections(PALETTE, query, (i) => [i.title?.vi ?? title(reg, i.service, "vi"), i.title?.en ?? title(reg, i.service, "en")], (g) => [s.paletteGroups[g]]),
    [query, s],
  );
  const toggle = (group: string, open: boolean) => setClosed((c) => {
    const next = open ? c.filter((x) => x !== group) : [...c.filter((x) => x !== group), group];
    try { localStorage.setItem(STORE, JSON.stringify(next)); } catch { /* the choice just is not remembered */ }
    return next;
  });

  return (
    <aside className={`flex min-h-0 flex-col border-r bg-card ${disabled ? "pointer-events-none opacity-60" : ""}`} aria-disabled={disabled} style={{ gridArea: "pal" }} aria-label={s.palette}>
      <div className="p-3 pb-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{s.palette}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{s.paletteHint}</p>
        <div className="relative mt-2">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-8 pl-7 pr-7 text-[13px]"
            type="search"
            value={query}
            placeholder={s.paletteSearch}
            aria-label={s.paletteSearch}
            data-testid="palette-search"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") setQuery(""); }}
          />
          {searching && (
            <button type="button" aria-label={s.delete} className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground" onClick={() => setQuery("")}><X className="size-3.5" /></button>
          )}
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:!block">
        <div className="flex flex-col gap-2 px-3 pb-3">
          {shown.length === 0 && <p className="px-1 text-xs text-muted-foreground" data-testid="palette-none">{s.paletteNone}</p>}
          {shown.map(({ group, items }) => (
            <Collapsible key={group} open={searching || !closed.includes(group)} onOpenChange={(o) => !searching && toggle(group, o)} data-testid={`palette-group-${group}`}>
              <CollapsibleTrigger className="group flex w-full items-center gap-1 px-1 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground">
                <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
                {s.paletteGroups[group]}
                <span className="ml-auto font-normal">{items.length}</span>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <ul className="flex flex-col gap-1.5 pt-1">
                  {items.map(({ id, service, title: own }) => {
                    const Icon = iconOf(service);
                    const color = colorOf(service);
                    return (
                      <li key={id}>
                        <button
                          type="button"
                          className="flex w-full cursor-grab items-center gap-2 rounded-md border bg-background px-2.5 py-1.5 text-left text-[13px] transition-colors hover:border-ring hover:bg-accent active:cursor-grabbing"
                          data-svc={service}
                          data-testid={`palette-${id}`}
                          draggable={!disabled}
                          onDragStart={(e) => { e.dataTransfer.setData(DRAG_TYPE, id); e.dataTransfer.effectAllowed = "copy"; }}
                          onClick={() => onAdd(id)}
                        >
                          <span className="flex size-6 flex-none items-center justify-center rounded-md" style={{ background: `color-mix(in srgb, ${color} 18%, transparent)`, color }}>
                            <Icon className="size-3.5" strokeWidth={1.8} />
                          </span>
                          {own ? own[lang] : title(reg, service, lang)}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </CollapsibleContent>
            </Collapsible>
          ))}
        </div>
      </ScrollArea>
    </aside>
  );
}
