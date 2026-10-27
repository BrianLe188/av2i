import { ApiError } from "../api.ts";
import type { Strings } from "../i18n.ts";
import { describe } from "./auth/errors.ts";

/** What to tell the person about a failed call on connections: the texts of this feature first, the general ones after. */
export function connError(e: unknown, s: Strings): string {
  if (e instanceof ApiError) {
    const own = (s.conn.errors as Record<string, string>)[e.code];
    if (own) return own;
  }
  return describe(e, s);
}
