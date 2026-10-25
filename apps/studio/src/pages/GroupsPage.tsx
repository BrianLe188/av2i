import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Plus, UsersRound } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createGroup, listGroups, type GroupRow } from "../admin.ts";
import { describe } from "../components/auth/errors.ts";
import { useStrings } from "../prefs.ts";
import { Page } from "./Page.tsx";

export function GroupsPage() {
  const s = useStrings();
  const navigate = useNavigate();
  const [groups, setGroups] = useState<GroupRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", description: "" });
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setGroups(await listGroups()); } catch (e) { setError(describe(e, s)); }
  }, [s]);
  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    setFormError(null);
    try {
      const g = await createGroup(form.name.trim(), form.description.trim());
      toast(s.adm.created);
      setCreating(false);
      setForm({ name: "", description: "" });
      navigate(`/groups/${g.id}`);
    } catch (e) { setFormError(describe(e, s)); }
  };

  return (
    <Page title={s.adm.groups} text={s.adm.groupsText} wide actions={<Button onClick={() => setCreating(true)} data-testid="new-group"><Plus />{s.adm.newGroup}</Button>}>
      <div className="grid gap-4">
        {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
        <Card className="py-0">
          <Table>
            <TableHeader><TableRow><TableHead>{s.adm.groupName}</TableHead><TableHead>{s.adm.members}</TableHead><TableHead>{s.adm.policies}</TableHead><TableHead>{s.adm.description}</TableHead></TableRow></TableHeader>
            <TableBody>
              {groups !== null && groups.length === 0 && <TableRow><TableCell colSpan={4} className="py-8 text-center text-muted-foreground" data-testid="no-groups">{s.adm.noGroups}</TableCell></TableRow>}
              {(groups ?? []).map((g) => (
                <TableRow key={g.id} data-testid={`group-${g.name}`}>
                  <TableCell className="font-medium"><Link to={`/groups/${g.id}`} className="inline-flex items-center gap-2 hover:underline"><UsersRound className="size-4 text-muted-foreground" />{g.name}</Link></TableCell>
                  <TableCell>{g.members}</TableCell>
                  <TableCell className="space-x-1">{g.policies.length ? g.policies.map((p) => <Badge key={p} variant="outline">{p}</Badge>) : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="max-w-72 truncate text-sm text-muted-foreground">{g.description}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>
      <Dialog open={creating} onOpenChange={(o) => !o && setCreating(false)}>
        <DialogContent className="sm:max-w-md" data-testid="group-dialog">
          <DialogHeader><DialogTitle>{s.adm.newGroup}</DialogTitle><DialogDescription>{s.adm.groupsText}</DialogDescription></DialogHeader>
          <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); void create(); }}>
            <div className="grid gap-1.5"><Label htmlFor="gn">{s.adm.groupName}</Label><Input id="gn" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus autoComplete="off" required /></div>
            <div className="grid gap-1.5"><Label htmlFor="gd">{s.adm.description}</Label><Input id="gd" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} autoComplete="off" /></div>
            {formError && <Alert variant="destructive" role="alert"><AlertDescription>{formError}</AlertDescription></Alert>}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setCreating(false)}>{s.adm.cancel}</Button>
              <Button type="submit" disabled={!form.name.trim()} data-testid="group-create">{s.acct.create}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Page>
  );
}
