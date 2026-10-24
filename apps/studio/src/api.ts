/** One thin layer over fetch for the platform's API: same origin, the cookie rides along, errors carry the server's code. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: Record<string, unknown>;
  constructor(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

/** The server could not be reached at all (not an answer with an error status). */
export class Unreachable extends Error {}

export async function api<T = unknown>(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: { "X-Requested-With": "av2i", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new Unreachable("network");
  }
  const type = res.headers.get("content-type") ?? "";
  const data = type.includes("json") ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    const e = (data as { error?: { code?: string; message?: string } & Record<string, unknown> } | null)?.error;
    // a page from a proxy or a dev server in front of a missing API is not an answer of ours
    if (!e) throw res.status >= 500 || res.status === 404 ? new Unreachable(`HTTP ${res.status}`) : new ApiError(res.status, "other", `HTTP ${res.status}`);
    const { code, message, ...extra } = e;
    throw new ApiError(res.status, code ?? "other", message ?? "", extra);
  }
  return data as T;
}
