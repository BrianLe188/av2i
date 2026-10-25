import { PALETTE_GROUPS, type PaletteGroup, type PaletteItem } from "../registry.ts";

export interface Section { group: PaletteGroup; items: PaletteItem[] }

const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\u0111/g, "d").toLowerCase();

/**
 * The palette as sections in the fixed order of the groups. A query keeps the items whose name (in either language,
 * without accents), service id or group name contains every word of it; a group with nothing left is dropped.
 */
export function sections(items: readonly PaletteItem[], query: string, names: (item: PaletteItem) => string[], groupName: (g: PaletteGroup) => string[]): Section[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  const keep = (item: PaletteItem) => {
    if (words.length === 0) return true;
    const hay = fold([...names(item), item.id, item.service, ...groupName(item.group)].join(" "));
    return words.every((w) => hay.includes(w));
  };
  return PALETTE_GROUPS.map((group) => ({ group, items: items.filter((i) => i.group === group && keep(i)) })).filter((s) => s.items.length > 0);
}
