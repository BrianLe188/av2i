import { useCallback, useEffect, useState } from "react";
import { Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ACTIONS } from "@av2i/authz";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Strings } from "../i18n.ts";
import { createToken, listTokens, revokeToken, type TokenRow } from "../tokens.ts";
import { describe } from "./auth/errors.ts";

const KNOWN = Object.keys(ACTIONS);
const EXPIRY = ["30", "90", "365", "never"] as const;

/** Personal API tokens: made here, shown once, revoked here. */
export function TokensCard({ s }: { s: Strings }) {
  const t = s.tok;
  const [tokens, setTokens] = useState<TokenRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<TokenRow | null>(null);

  const load = useCallback(async () => {
    try { setTokens(await listTokens()); } catch (e) { setError(describe(e, s)); }
  }, [s]);
  useEffect(() => { void load(); }, [load]);

  const revoke = async () => {
    if (!revoking) return;
    try { await revokeToken(revoking.id); toast(t.revoked); setRevoking(null); await load(); } catch (e) { setError(describe(e, s)); setRevoking(null); }
  };

  return (
    <Card data-testid="tokens-card">
      <CardHeader>
        <div className="flex items-start gap-2">
          <div className="flex-1">
            <CardTitle className="flex items-center gap-2 text-base"><KeyRound className="size-4" />{t.title}</CardTitle>
            <CardDescription>{t.text}</CardDescription>
          </div>
          <Button size="sm" onClick={() => setCreating(true)} data-testid="token-new"><Plus />{t.create}</Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-2">
        {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
        {tokens?.length === 0 && <p className="text-sm text-muted-foreground">{t.none}</p>}
        <ul className="grid gap-1.5" data-testid="tokens">
          {(tokens ?? []).map((k) => (
            <li key={k.id} className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm" data-testid={`token-${k.name}`}>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{k.name}</span>
                  <Badge variant={k.status === "active" ? "secondary" : "outline"}>{t.status[k.status]}</Badge>
                  {k.actions && <Badge variant="outline">{t.actionsCount.replace("{n}", String(k.actions.length))}</Badge>}
                </div>
                <div className="text-xs text-muted-foreground">
                  <span className="font-mono">{k.prefix}…</span> · {t.lastUsed}: {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : t.neverUsed}
                  {k.expiresAt && ` · ${t.expires}: ${new Date(k.expiresAt).toLocaleDateString()}`}
                </div>
              </div>
              {k.status === "active" && <Button size="icon" variant="ghost" title={t.revoke} onClick={() => setRevoking(k)} data-testid="token-revoke"><Trash2 /></Button>}
            </li>
          ))}
        </ul>
      </CardContent>

      <CreateDialog s={s} open={creating} onClose={() => setCreating(false)} onCreated={(sec) => { setCreating(false); setSecret(sec); void load(); }} />

      <Dialog open={secret !== null} onOpenChange={(o) => !o && setSecret(null)}>
        <DialogContent className="sm:max-w-lg" data-testid="token-secret-dialog">
          <DialogHeader>
            <DialogTitle>{t.createdTitle}</DialogTitle>
            <DialogDescription>{t.createdText}</DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input readOnly value={secret ?? ""} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} data-testid="token-secret" />
            <Button variant="outline" onClick={() => { void navigator.clipboard?.writeText(secret ?? "").then(() => toast(t.copied)); }}><Copy />{t.copy}</Button>
          </div>
          <DialogFooter><Button onClick={() => setSecret(null)} data-testid="token-done">{t.done}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={revoking !== null} onOpenChange={(o) => !o && setRevoking(null)}>
        <DialogContent className="sm:max-w-sm" data-testid="token-revoke-dialog">
          <DialogHeader>
            <DialogTitle>{t.revokeTitle}</DialogTitle>
            <DialogDescription>{revoking?.name} · {t.revokeText}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRevoking(null)}>{s.acct.cancel}</Button>
            <Button variant="destructive" onClick={() => void revoke()} data-testid="token-revoke-confirm">{t.revoke}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function CreateDialog({ s, open, onClose, onCreated }: { s: Strings; open: boolean; onClose: () => void; onCreated: (secret: string) => void }) {
  const t = s.tok;
  const [name, setName] = useState("");
  const [expiry, setExpiry] = useState<(typeof EXPIRY)[number]>("90");
  const [limited, setLimited] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setName(""); setExpiry("90"); setLimited(false); setPicked(new Set()); setError(null); } }, [open]);

  const submit = async () => {
    if (limited && picked.size === 0) return setError(t.pickOne);
    setBusy(true);
    setError(null);
    try {
      const r = await createToken({ name: name.trim(), expiresInDays: expiry === "never" ? null : Number(expiry), actions: limited ? KNOWN.filter((a) => picked.has(a)) : null });
      onCreated(r.secret);
    } catch (e) { setError(describe(e, s)); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md" data-testid="token-dialog">
        <DialogHeader>
          <DialogTitle>{t.create}</DialogTitle>
          <DialogDescription>{t.scopeHint}</DialogDescription>
        </DialogHeader>
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <div className="grid gap-1.5">
            <Label htmlFor="token-name">{t.name}</Label>
            <Input id="token-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t.namePh} maxLength={64} autoFocus data-testid="token-name" />
          </div>
          <div className="grid gap-1.5">
            <Label>{t.expiry}</Label>
            <Select value={expiry} onValueChange={(v) => setExpiry(v as (typeof EXPIRY)[number])}>
              <SelectTrigger className="w-full" data-testid="token-expiry"><SelectValue /></SelectTrigger>
              <SelectContent>
                {EXPIRY.map((d) => <SelectItem key={d} value={d}>{d === "never" ? t.never : t.days.replace("{n}", d)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>{t.scope}</Label>
            <Select value={limited ? "some" : "all"} onValueChange={(v) => setLimited(v === "some")}>
              <SelectTrigger className="w-full" data-testid="token-scope"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t.scopeAll}</SelectItem>
                <SelectItem value="some">{t.scopeSome}</SelectItem>
              </SelectContent>
            </Select>
            {limited && (
              <div className="grid max-h-48 grid-cols-2 gap-1 overflow-y-auto rounded-md border p-2" data-testid="token-actions">
                {KNOWN.map((a) => (
                  <label key={a} className="flex items-center gap-2 text-xs">
                    <input type="checkbox" checked={picked.has(a)} onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(a); else n.delete(a); return n; })} />
                    <span className="font-mono">{a}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>{s.acct.cancel}</Button>
            <Button type="submit" disabled={busy || !name.trim()} data-testid="token-create">{t.create}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
