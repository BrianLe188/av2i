import type { Design } from "@av2i/model";
import { store } from "./prefs.ts";

/** Drafts are kept per person: two people on one browser must not see each other's work. */
export const draftKey = (userId: string) => `draft.${userId}`;

export function loadDraft(userId: string): Design | null {
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

export const clearDraft = (userId: string): void => store.remove(draftKey(userId));
