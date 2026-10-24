import { ApiError, Unreachable } from "../../api.ts";
import type { Strings } from "../../i18n.ts";

/** What to tell the person about a failed call, in their language. */
export function describe(e: unknown, s: Strings): string {
  if (e instanceof Unreachable) return s.acct.unreachableTitle;
  if (e instanceof ApiError) {
    const text = (s.acct.errors as Record<string, string>)[e.code];
    if (!text) return s.acct.errors.other;
    const wait = typeof e.extra.retryAfter === "number" ? e.extra.retryAfter : 0;
    return text.replace("{s}", String(wait));
  }
  return s.acct.errors.other;
}
