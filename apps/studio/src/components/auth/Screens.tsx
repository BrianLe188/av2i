import { useState, type FormEvent, type ReactNode } from "react";
import { checkNewPassword } from "@av2i/authz";
import { Moon, Sun } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { strings, type Lang, type Strings } from "../../i18n.ts";
import type { Prefs } from "../../prefs.ts";
import { useAuth } from "../../auth.tsx";
import { describe } from "./errors.ts";

/** A centred card on the page, with the language and theme switches the studio has in its top bar. */
function Shell({ prefs, s, title, description, children }: { prefs: Prefs; s: Strings; title: string; description?: string; children: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-background p-4">
      <div className="absolute right-3 top-3 flex items-center gap-2">
        <Select value={prefs.lang} onValueChange={(v) => prefs.setLang(v as Lang)}>
          <SelectTrigger size="sm" aria-label={s.language} className="w-32">{prefs.lang === "vi" ? "Tiếng Việt" : "English"}</SelectTrigger>
          <SelectContent>
            <SelectItem value="vi">Tiếng Việt</SelectItem>
            <SelectItem value="en">English</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="icon-sm" onClick={prefs.toggleDark} aria-label={s.theme}>{prefs.dark ? <Sun /> : <Moon />}</Button>
      </div>
      <div className="text-lg font-semibold">{s.app}</div>
      <Card className="w-full max-w-sm shadow-lg">
        <CardHeader>
          <CardTitle className="text-base">{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </div>
  );
}

function Field({ id, label, ...props }: { id: string; label: string } & React.ComponentProps<"input">) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={id} {...props} />
    </div>
  );
}

export function LoginScreen({ prefs }: { prefs: Prefs }) {
  const s = strings(prefs.lang);
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError(describe(err, s));
      setPassword("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell prefs={prefs} s={s} title={s.acct.signIn} description={s.acct.signInHint}>
      <form onSubmit={submit} className="grid gap-4" data-testid="login-form">
        <Field id="username" label={s.acct.username} autoComplete="username" autoFocus value={username} onChange={(e) => setUsername(e.target.value)} required />
        <Field id="password" label={s.acct.password} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <Alert variant="destructive" role="alert" data-testid="login-error"><AlertDescription>{error}</AlertDescription></Alert>}
        <Button type="submit" disabled={busy || !username || !password}>{busy ? s.acct.signingIn : s.acct.signIn}</Button>
      </form>
    </Shell>
  );
}

/** The form behind both the forced change after the first sign in and the account menu. */
export function ChangePasswordForm({ s, username, submitLabel, onDone, extra }: {
  s: Strings; username: string; submitLabel?: string; onDone?: () => void; extra?: ReactNode;
}) {
  const { changePassword } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const problem = checkNewPassword(next, username) ?? (next === current ? "same_as_old" : null);
    if (problem) return setError((s.acct.errors as Record<string, string>)[problem] ?? s.acct.errors.other);
    if (next !== again) return setError(s.acct.mismatch);
    setBusy(true);
    try {
      await changePassword(current, next);
      onDone?.();
    } catch (err) {
      setError(describe(err, s));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-4" data-testid="change-password-form">
      <Field id="current" label={s.acct.currentPassword} type="password" autoComplete="current-password" autoFocus value={current} onChange={(e) => setCurrent(e.target.value)} required />
      <Field id="new" label={s.acct.newPassword} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
      <Field id="again" label={s.acct.confirmPassword} type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required />
      <p className="text-xs text-muted-foreground">{s.acct.rule}</p>
      {error && <Alert variant="destructive" role="alert" data-testid="change-error"><AlertDescription>{error}</AlertDescription></Alert>}
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={busy || !current || !next || !again}>{busy ? s.acct.saving : submitLabel ?? s.acct.save}</Button>
        {extra}
      </div>
    </form>
  );
}

export function ForcedChangeScreen({ prefs, username }: { prefs: Prefs; username: string }) {
  const s = strings(prefs.lang);
  const { logout } = useAuth();
  return (
    <Shell prefs={prefs} s={s} title={s.acct.mustChangeTitle} description={s.acct.mustChangeText}>
      <ChangePasswordForm s={s} username={username} extra={<Button type="button" variant="ghost" onClick={() => void logout()}>{s.acct.signOut}</Button>} />
    </Shell>
  );
}

export function UnreachableScreen({ prefs }: { prefs: Prefs }) {
  const s = strings(prefs.lang);
  const { retry } = useAuth();
  return (
    <Shell prefs={prefs} s={s} title={s.acct.unreachableTitle} description={s.acct.unreachableText}>
      <Button onClick={retry} data-testid="retry">{s.acct.retry}</Button>
    </Shell>
  );
}

export function LoadingScreen({ s }: { s: Strings }) {
  return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{s.acct.loading}</div>;
}
