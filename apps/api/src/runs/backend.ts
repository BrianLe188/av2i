/** Where the state of a project is kept, and the backend block that tells OpenTofu so (DD-032, R3b). */
export interface S3Backend {
  kind: "s3";
  bucket: string;
  key: string;
  region: string;
  encrypt: boolean;
  kms?: string;
  endpoint?: string;
  usePathStyle?: boolean;
}
export type StateBackend = { kind: "platform" } | S3Backend;

const BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const REGION = /^[a-z]{2}(-[a-z]+)+-\d$/;
const KMS = /^(arn:aws(-[a-z]+)*:kms:[a-z0-9-]+:\d{12}:(key|alias)\/[\w/-]+|alias\/[\w/-]+|[0-9a-f-]{36})$/;

/** Reads a backend from user input; returns the backend or the first thing wrong with it. */
export function parseBackend(input: unknown): { ok: true; backend: StateBackend } | { ok: false; message: string } {
  const b = (input ?? {}) as Record<string, unknown>;
  if (b.kind === "platform") return { ok: true, backend: { kind: "platform" } };
  if (b.kind !== "s3") return { ok: false, message: 'The backend kind must be "platform" or "s3".' };
  const str = (k: string) => (typeof b[k] === "string" ? (b[k] as string).trim() : "");
  const bucket = str("bucket"), key = str("key"), region = str("region");
  if (!BUCKET.test(bucket) || bucket.includes("..")) return { ok: false, message: "The bucket name is not valid." };
  if (!key || key.length > 1024 || key.startsWith("/") || key.includes("..") || /[\0\n"\\]/.test(key)) return { ok: false, message: "The key of the state file is not valid." };
  if (!REGION.test(region)) return { ok: false, message: "The region is not valid." };
  const out: S3Backend = { kind: "s3", bucket, key, region, encrypt: b.encrypt !== false };
  const kms = str("kms");
  if (kms) { if (!KMS.test(kms)) return { ok: false, message: "The KMS key is not valid." }; out.kms = kms; }
  const endpoint = str("endpoint");
  if (endpoint) {
    try { const u = new URL(endpoint); if (!/^https?:$/.test(u.protocol) || /["\s\\]/.test(endpoint)) throw new Error(); } catch { return { ok: false, message: "The endpoint must be an http(s) URL." }; }
    out.endpoint = endpoint;
  }
  if (b.usePathStyle === true) out.usePathStyle = true;
  return { ok: true, backend: out };
}

export function backendOf(raw: unknown): StateBackend {
  const r = parseBackend(raw);
  return r.ok ? r.backend : { kind: "platform" };
}

/** The `terraform` block for an S3 backend. Values were validated, so none can end the string. Apply uses the native lock file. */
export function s3BackendFile(b: S3Backend, withLock: boolean): string {
  const lines = [`bucket = "${b.bucket}"`, `key = "${b.key}"`, `region = "${b.region}"`, `encrypt = ${b.encrypt}`];
  if (b.kms) lines.push(`kms_key_id = "${b.kms}"`);
  if (b.endpoint) lines.push(`endpoints = { s3 = "${b.endpoint}" }`);
  if (b.usePathStyle) lines.push("use_path_style = true");
  if (b.endpoint) lines.push("skip_credentials_validation = true", "skip_metadata_api_check = true", "skip_requesting_account_id = true");
  if (withLock) lines.push("use_lockfile = true");
  return `terraform {\n  backend "s3" {\n${lines.map((l) => `    ${l}`).join("\n")}\n  }\n}\n`;
}
