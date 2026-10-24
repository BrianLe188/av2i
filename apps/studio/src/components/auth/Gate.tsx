import type { ReactNode } from "react";
import { strings } from "../../i18n.ts";
import type { Prefs } from "../../prefs.ts";
import { useAuth, type User } from "../../auth.tsx";
import { ForcedChangeScreen, LoadingScreen, LoginScreen, UnreachableScreen } from "./Screens.tsx";

/** Nothing of the studio shows until a person is signed in and past the forced password change. */
export function Gate({ prefs, children }: { prefs: Prefs; children: (user: User) => ReactNode }) {
  const { state } = useAuth();
  if (state.status === "loading") return <LoadingScreen s={strings(prefs.lang)} />;
  if (state.status === "unreachable") return <UnreachableScreen prefs={prefs} />;
  if (state.status === "anonymous") return <LoginScreen prefs={prefs} />;
  if (state.user.mustChangePassword) return <ForcedChangeScreen prefs={prefs} username={state.user.username} />;
  return <>{children(state.user)}</>;
}
