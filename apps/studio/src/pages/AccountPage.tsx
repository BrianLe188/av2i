import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useUser } from "../auth.tsx";
import { ChangePasswordForm } from "../components/auth/Screens.tsx";
import { useStrings } from "../prefs.ts";
import { Page } from "./Page.tsx";

export function AccountPage() {
  const s = useStrings();
  const user = useUser();
  return (
    <Page title={s.nav.accountPage} text={s.nav.accountPageText}>
      <div className="grid max-w-xl gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{user.displayName || user.username}</CardTitle>
            <CardDescription>{s.nav.youAre}: <Badge variant="outline" className="ml-1 font-mono">{user.username}</Badge></CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">{s.acct.changePassword}</CardTitle></CardHeader>
          <CardContent>
            <ChangePasswordForm s={s} username={user.username} onDone={() => toast(s.acct.passwordChanged)} />
          </CardContent>
        </Card>
      </div>
    </Page>
  );
}
