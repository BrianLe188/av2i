import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Cloud, Plus } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createConnection, listConnections, type ConnectionFull } from "../connections.ts";
import { connError } from "../components/connError.ts";
import { useStrings } from "../prefs.ts";
import { Page } from "./Page.tsx";

export function TestBadge({ c }: { c: Pick<ConnectionFull, "lastTest" | "lastTestAt"> }) {
  const s = useStrings();
  if (!c.lastTest) return <span className="text-xs text-muted-foreground">{s.conn.never}</span>;
  const ok = c.lastTest.plan.ok && (c.lastTest.apply?.ok ?? true);
  return <Badge variant={ok ? "default" : "destructive"} title={c.lastTestAt ? new Date(c.lastTestAt).toLocaleString() : undefined}>{ok ? s.conn.ok : "×"}</Badge>;
}

/** The AWS connections: the roles a project's runs assume (DD-025). Only people who manage connections get here. */
export function ConnectionsPage() {
  const s = useStrings();
  const navigate = useNavigate();
  const [rows, setRows] = useState<ConnectionFull[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", planRoleArn: "", applyRoleArn: "" });
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setRows((await listConnections()).filter((c): c is ConnectionFull => c.view === "full")); } catch (e) { setError(connError(e, s)); }
  }, [s]);
  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    setFormError(null);
    try {
      const c = await createConnection({ name: form.name.trim(), description: form.description.trim(), planRoleArn: form.planRoleArn.trim(), applyRoleArn: form.applyRoleArn.trim() || null });
      toast(s.conn.created);
      setCreating(false);
      setForm({ name: "", description: "", planRoleArn: "", applyRoleArn: "" });
      navigate(`/connections/${c.id}`);
    } catch (e) { setFormError(connError(e, s)); }
  };

  return (
    <Page title={s.conn.title} text={s.conn.text} wide actions={<Button onClick={() => setCreating(true)} data-testid="new-connection"><Plus />{s.conn.new}</Button>}>
      <div className="grid gap-4">
        {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
        <Card className="py-0">
          <Table>
            <TableHeader><TableRow><TableHead>{s.conn.name}</TableHead><TableHead>{s.conn.account}</TableHead><TableHead>{s.conn.planRole}</TableHead><TableHead>{s.conn.applyRole.replace(/ \(.*\)/, "")}</TableHead><TableHead>{s.conn.lastTest}</TableHead><TableHead>{s.conn.projects}</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows !== null && rows.length === 0 && <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground" data-testid="no-connections">{s.conn.none}</TableCell></TableRow>}
              {(rows ?? []).map((c) => (
                <TableRow key={c.id} data-testid={`connection-${c.name}`}>
                  <TableCell className="font-medium"><Link to={`/connections/${c.id}`} className="inline-flex items-center gap-2 hover:underline"><Cloud className="size-4 text-muted-foreground" />{c.name}</Link></TableCell>
                  <TableCell className="font-mono text-xs">{c.account}</TableCell>
                  <TableCell className="max-w-56 truncate font-mono text-xs" title={c.planRoleArn}>{c.planRoleArn.split("/").slice(1).join("/")}</TableCell>
                  <TableCell className="max-w-56 truncate font-mono text-xs" title={c.applyRoleArn ?? undefined}>{c.applyRoleArn ? c.applyRoleArn.split("/").slice(1).join("/") : <Badge variant="secondary">{s.conn.planOnly}</Badge>}</TableCell>
                  <TableCell><TestBadge c={c} /></TableCell>
                  <TableCell>{c.projects}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>
      <Dialog open={creating} onOpenChange={(o) => !o && setCreating(false)}>
        <DialogContent className="sm:max-w-lg" data-testid="connection-dialog">
          <DialogHeader><DialogTitle>{s.conn.new}</DialogTitle><DialogDescription>{s.conn.text}</DialogDescription></DialogHeader>
          <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); void create(); }}>
            <div className="grid gap-1.5"><Label htmlFor="cn">{s.conn.name}</Label><Input id="cn" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus autoComplete="off" required /></div>
            <div className="grid gap-1.5"><Label htmlFor="cd">{s.conn.description}</Label><Input id="cd" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} autoComplete="off" /></div>
            <div className="grid gap-1.5"><Label htmlFor="cp">{s.conn.planRole}</Label><Input id="cp" value={form.planRoleArn} onChange={(e) => setForm({ ...form, planRoleArn: e.target.value })} placeholder="arn:aws:iam::123456789012:role/av2i-plan" className="font-mono text-xs" autoComplete="off" required /></div>
            <div className="grid gap-1.5"><Label htmlFor="ca">{s.conn.applyRole}</Label><Input id="ca" value={form.applyRoleArn} onChange={(e) => setForm({ ...form, applyRoleArn: e.target.value })} placeholder="arn:aws:iam::123456789012:role/av2i-apply" className="font-mono text-xs" autoComplete="off" /><p className="text-xs text-muted-foreground">{s.conn.applyHelp}</p></div>
            {formError && <Alert variant="destructive" role="alert"><AlertDescription>{formError}</AlertDescription></Alert>}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setCreating(false)}>{s.adm.cancel}</Button>
              <Button type="submit" disabled={!form.name.trim() || !form.planRoleArn.trim()} data-testid="connection-create">{s.conn.create}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Page>
  );
}
