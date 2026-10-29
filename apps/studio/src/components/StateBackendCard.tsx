import { useState } from "react";
import { Check, X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Strings } from "../i18n.ts";
import { checkStateBackend, migrateStateBackend, setStateBackend, type S3Backend, type S3CheckResult, type StateBackend } from "../projects.ts";
import { describe } from "./auth/errors.ts";

const empty = { bucket: "", key: "terraform.tfstate", region: "eu-west-1", endpoint: "", kms: "", usePathStyle: false };

/** Where the state is kept, with the way to check a bucket and to choose or move to it (DD-032). */
export function StateBackendCard({ s, projectId, projectName, backend, hasState, canWrite, onChanged }: { s: Strings; projectId: string; projectName: string; backend: StateBackend; hasState: boolean; canWrite: boolean; onChanged: () => void }) {
  const [form, setForm] = useState(backend.kind === "s3" ? { bucket: backend.bucket, key: backend.key, region: backend.region, endpoint: backend.endpoint ?? "", kms: backend.kms ?? "", usePathStyle: !!backend.usePathStyle } : empty);
  const [checked, setChecked] = useState<S3CheckResult | null>(null);
  const [typed, setTyped] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const candidate = (): S3Backend => ({ kind: "s3", bucket: form.bucket.trim(), key: form.key.trim(), region: form.region.trim(), encrypt: true, ...(form.kms.trim() ? { kms: form.kms.trim() } : {}), ...(form.endpoint.trim() ? { endpoint: form.endpoint.trim() } : {}), ...(form.usePathStyle ? { usePathStyle: true } : {}) });
  const act = async (f: () => Promise<void>) => { setBusy(true); setError(null); setNote(null); try { await f(); } catch (e) { setError(describe(e, s)); } finally { setBusy(false); } };
  const row = (ok: boolean, text: string) => <li className="flex items-center gap-2">{ok ? <Check className="size-4 text-emerald-600" /> : <X className="size-4 text-destructive" />}{text}</li>;
  const field = (k: "bucket" | "key" | "region" | "endpoint" | "kms", label: string) => (
    <div className="grid gap-1"><Label htmlFor={`sb-${k}`}>{label}</Label><Input id={`sb-${k}`} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} data-testid={`sb-${k}`} /></div>
  );

  return (
    <Card data-testid="state-backend-card">
      <CardHeader><CardTitle className="flex items-center gap-2 text-base">{s.st.backendTitle}: <Badge variant="outline" data-testid="state-backend">{backend.kind === "s3" ? `S3 · ${backend.bucket}/${backend.key}` : s.st.backendPlatform}</Badge></CardTitle></CardHeader>
      <CardContent className="grid gap-3">
        {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
        {note && <Alert role="status"><AlertDescription>{note}</AlertDescription></Alert>}
        {backend.kind === "s3" && <p className="text-xs text-muted-foreground">{s.st.s3Only}</p>}
        {canWrite && (
          <div className="grid gap-3">
            {backend.kind === "platform" && (
              <>
                <p className="text-sm font-medium">{s.st.backendS3}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {field("bucket", s.st.bucket)}{field("key", s.st.key)}{field("region", s.st.region)}{field("endpoint", s.st.endpoint)}{field("kms", s.st.kms)}
                  <label className="flex items-center gap-2 text-sm"><Checkbox checked={form.usePathStyle} onCheckedChange={(v) => setForm({ ...form, usePathStyle: v === true })} data-testid="sb-pathstyle" />{s.st.pathStyle}</label>
                </div>
              </>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" disabled={busy || (backend.kind === "platform" && !form.bucket.trim())} onClick={() => void act(async () => setChecked(await checkStateBackend(projectId, backend.kind === "platform" ? candidate() : undefined)))} data-testid="sb-check">{s.st.check}</Button>
              {backend.kind === "platform" && !hasState && <Button size="sm" disabled={busy || !form.bucket.trim()} onClick={() => void act(async () => { await setStateBackend(projectId, candidate()); setNote(s.st.saved); onChanged(); })} data-testid="sb-save">{s.st.backendUse}</Button>}
            </div>
            {checked && (
              <div className="grid gap-2 rounded-md border p-3 text-sm" data-testid="sb-result">
                <ul className="grid gap-1">
                  {!checked.access.ok && row(false, checked.access.message ?? "")}
                  {checked.bucket && row(checked.bucket.ok, `${s.st.checkBucket}${checked.bucket.message ? `: ${checked.bucket.message}` : ""}`)}
                  {checked.versioning && row(checked.versioning.ok, `${s.st.checkVersioning} (${checked.versioning.status})`)}
                  {checked.object && row(checked.object.ok, `${s.st.checkObject}: ${checked.object.exists ? s.st.exists : s.st.absent}`)}
                </ul>
                {(["plan", "apply"] as const).map((k) => (
                  <details key={k}><summary className="cursor-pointer text-xs">{k === "plan" ? s.st.policyPlan : s.st.policyApply}</summary><pre className="mt-1 max-h-48 overflow-auto rounded bg-muted/40 p-2 font-mono text-[11px]">{JSON.stringify(checked.policies[k], null, 2)}</pre></details>
                ))}
              </div>
            )}
            {(backend.kind === "s3" || hasState) && (
              <div className="grid gap-2 rounded-md border p-3">
                <p className="text-sm font-medium">{backend.kind === "s3" ? s.st.moveBack : s.st.move}</p>
                <p className="text-xs text-muted-foreground">{s.st.moveWarn}</p>
                <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={`${s.st.typeName}: ${projectName}`} className="max-w-sm" data-testid="sb-confirm" />
                <div><Button size="sm" variant="destructive" disabled={busy || typed !== projectName || (backend.kind === "platform" && !form.bucket.trim())} onClick={() => void act(async () => { await migrateStateBackend(projectId, backend.kind === "s3" ? { kind: "platform" } : candidate(), typed); setTyped(""); setNote(s.st.queued); })} data-testid="sb-move">{backend.kind === "s3" ? s.st.moveBack : s.st.move}</Button></div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
