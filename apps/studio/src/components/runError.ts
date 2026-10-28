import { ApiError } from "../api.ts";
import type { Strings } from "../i18n.ts";
import { describe } from "./auth/errors.ts";

/** What to tell the person about a failed call on runs and requests: the texts of this feature first, the general ones after. */
export function runError(e: unknown, s: Strings): string {
  if (e instanceof ApiError) {
    const own = (s.run.errors as Record<string, string>)[e.code];
    if (own) return own;
  }
  return describe(e, s);
}
