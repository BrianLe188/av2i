import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { ArrowRight, FilePlus2, FolderOpen, ScrollText, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "../api.ts";
import { useAuth, useUser } from "../auth.tsx";
import { loadDraft } from "../drafts.ts";
import { usePrefsContext, useStrings } from "../prefs.ts";
import { reg } from "../registry.ts";
import { templates } from "../logic/templates.ts";
import { Page } from "./Page.tsx";

interface UserRow { disabled: boolean; mustChangePassword: boolean }
interface AuditRow { id: string; at: string; actor: string | null; action: string; outcome: string }

const fill = (text: string, values: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? ""));

export function Dashboard() {
  const s = useStrings();
  const { lang } = usePrefsContext();
  const user = useUser();
  const { can } = useAuth();
  const navigate = useNavigate();
  const draft = useMemo(() => loadDraft(user.id), [user.id]);
  const hasDraft = !!draft && draft.nodes.length > 0;
  const tpls = useMemo(() => templates(reg), []);
  const [pending, setPending] = useState<string | null>(null);

  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [activity, setActivity] = useState<AuditRow[] | null>(null);
  useEffect(() => {
    if (can("user:List")) api<{ users: UserRow[] }>("GET", "/api/users").then((r) => setUsers(r.users)).catch(() => setUsers(null));
    if (can("audit:Read")) api<{ entries: AuditRow[] }>("GET", "/api/audit?limit=6").then((r) => setActivity(r.entries)).catch(() => setActivity(null));
  }, [can]);

  /** Starting something new replaces the draft, so a draft with content asks first. */
  const start = (target: string) => (hasDraft ? setPending(target) : navigate(target));

  return (
    <Page title={`${s.nav.hello}, ${user.displayName || user.username}`} text={s.nav.helloText}>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card data-testid="design-card" className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">{s.nav.designTitle}</CardTitle>
            <CardDescription>{s.nav.designText}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            <div className="flex flex-wrap items-center gap-3">
              {hasDraft ? (
                <Button asChild><Link to="/designer" data-testid="continue-draft"><FolderOpen />{s.nav.continueDraft}</Link></Button>
              ) : (
                <Button disabled data-testid="continue-draft"><FolderOpen />{s.nav.continueDraft}</Button>
              )}
              <Button variant="outline" onClick={() => start("/designer?new=1")} data-testid="new-design"><FilePlus2 />{s.nav.newDesign}</Button>
              <span className="text-sm text-muted-foreground" data-testid="draft-info">
                {hasDraft ? `${draft!.name === "untitled" ? s.untitled : draft!.name} · ${fill(s.nav.draftInfo, { n: draft!.nodes.length, e: draft!.edges.length })}` : s.nav.noDraft}
              </span>
            </div>
            <div>
              <h2 className="mb-2 text-sm font-medium">{s.nav.fromTemplate}</h2>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {tpls.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => start(`/designer?template=${t.id}`)}
                    data-testid={`dash-template-${t.id}`}
                    className="group flex flex-col gap-1 rounded-lg border bg-background p-3 text-left transition-colors hover:border-ring hover:bg-accent"
                  >
                    <span className="text-sm font-medium leading-snug">{t.title[lang]}</span>
                    <span className="mt-auto flex items-center gap-2 pt-1 text-xs text-muted-foreground">
                      {t.variants.length > 0 && <Badge variant="outline">{t.variants.length} {s.nav.variants}</Badge>}
                      <ArrowRight className="ml-auto size-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {can("user:List") && (
          <Card data-testid="users-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><Users className="size-4" />{s.nav.usersTitle}</CardTitle>
              <CardDescription>
                {users
                  ? fill(s.nav.usersSummary, { a: users.filter((u) => !u.disabled).length, p: users.filter((u) => u.mustChangePassword).length, d: users.filter((u) => u.disabled).length })
                  : s.acct.loading}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="outline" size="sm"><Link to="/users">{s.nav.manage}<ArrowRight /></Link></Button>
            </CardContent>
          </Card>
        )}

        {can("audit:Read") && (
          <Card data-testid="activity-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><ScrollText className="size-4" />{s.nav.recent}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2">
              {activity && activity.length === 0 && <p className="text-sm text-muted-foreground">{s.nav.noActivity}</p>}
              <ul className="grid gap-1.5">
                {(activity ?? []).map((a) => (
                  <li key={a.id} className="flex items-center gap-2 text-xs">
                    <Badge variant={a.outcome === "success" ? "secondary" : "destructive"} className="flex-none">{a.outcome}</Badge>
                    <span className="truncate font-mono">{a.action}</span>
                    <span className="truncate text-muted-foreground">{a.actor ?? "—"}</span>
                    <span className="ml-auto flex-none text-muted-foreground">{new Date(a.at).toLocaleTimeString()}</span>
                  </li>
                ))}
              </ul>
              <Button asChild variant="outline" size="sm" className="w-fit"><Link to="/audit">{s.acct.audit}<ArrowRight /></Link></Button>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={pending !== null} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent className="sm:max-w-sm" data-testid="replace-dialog">
          <DialogHeader>
            <DialogTitle>{s.nav.replaceTitle}</DialogTitle>
            <DialogDescription>{s.nav.replaceText}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPending(null)}>{s.acct.cancel}</Button>
            <Button onClick={() => pending && navigate(pending)} data-testid="replace-confirm">{s.nav.replace}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  );
}
