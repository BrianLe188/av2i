import { useEffect, useState } from "react";
import type { Lang } from "./i18n.ts";

export const store = {
  get(k: string): string | null { try { return localStorage.getItem(`av2i.${k}`); } catch { return null; } },
  set(k: string, v: string): void { try { localStorage.setItem(`av2i.${k}`, v); } catch { /* storage may be blocked */ } },
  remove(k: string): void { try { localStorage.removeItem(`av2i.${k}`); } catch { /* storage may be blocked */ } },
};

export interface Prefs {
  lang: Lang;
  setLang: (l: Lang) => void;
  dark: boolean;
  toggleDark: () => void;
}

/** Language and theme, kept in the browser and applied to the page; shared by the sign in screens and the studio. */
export function usePrefs(): Prefs {
  const [lang, setLang] = useState<Lang>(() => (store.get("lang") === "en" ? "en" : "vi"));
  const [dark, setDark] = useState(() => { const t = store.get("theme"); return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches; });
  useEffect(() => { store.set("lang", lang); document.documentElement.lang = lang; }, [lang]);
  useEffect(() => { document.documentElement.classList.toggle("dark", dark); store.set("theme", dark ? "dark" : "light"); }, [dark]);
  return { lang, setLang, dark, toggleDark: () => setDark((d) => !d) };
}
