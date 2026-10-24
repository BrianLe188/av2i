export class HttpError extends Error {
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

export const badRequest = (code: string, message: string, extra?: Record<string, unknown>) => new HttpError(400, code, message, extra);
export const unauthorized = (code = "unauthenticated", message = "Sign in first.") => new HttpError(401, code, message);
export const forbidden = (code = "forbidden", message = "You are not allowed to do that.") => new HttpError(403, code, message);
export const notFound = (message = "Not found.") => new HttpError(404, "not_found", message);
export const conflict = (code: string, message: string) => new HttpError(409, code, message);
