import type { ReactNode } from "react";
import type { Action } from "@av2i/authz";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { useAuth } from "../auth.tsx";
import { useStrings } from "../prefs.ts";
import { Page } from "./Page.tsx";

/** A page the person may not open shows why instead of an empty table of refused calls. */
export function Guard({ action, children }: { action: Action; children: ReactNode }) {
  const { can } = useAuth();
  const s = useStrings();
  if (can(action)) return <>{children}</>;
  return (
    <Page title={s.nav.noAccess} text={s.nav.noAccessText}>
      <Button asChild variant="outline"><Link to="/dashboard">{s.nav.dashboard}</Link></Button>
    </Page>
  );
}

export function NotFound() {
  const s = useStrings();
  return (
    <Page title={s.nav.notFound} text={s.nav.notFoundText}>
      <Button asChild variant="outline"><Link to="/dashboard">{s.nav.dashboard}</Link></Button>
    </Page>
  );
}
