import { Link, NavLink, Outlet, useNavigate } from "react-router";
import { ChevronsUpDown, Cloud, KeyRound, LayoutDashboard, LogOut, Moon, PencilRuler, ScrollText, ShieldCheck, Sun, Users, UsersRound, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useAuth, useUser } from "../auth.tsx";
import type { Lang } from "../i18n.ts";
import { usePrefsContext, useStrings } from "../prefs.ts";

interface Item {
  to: string;
  label: string;
  icon: LucideIcon;
  show: boolean;
}

function Brand({ title }: { title: string }) {
  return (
    <Link to="/dashboard" className="flex items-center gap-2 px-3 py-4" aria-label={title}>
      <span className="flex size-8 flex-none items-center justify-center rounded-lg bg-primary text-primary-foreground"><PencilRuler className="size-4" /></span>
      <span className="hidden truncate text-[15px] font-semibold md:block">{title}</span>
    </Link>
  );
}

/** The home layout: a sidebar with the places of the platform, and the page beside it. The canvas has its own layout. */
export function AppLayout() {
  const s = useStrings();
  const prefs = usePrefsContext();
  const user = useUser();
  const { can, logout } = useAuth();
  const navigate = useNavigate();

  const items: Item[] = [
    { to: "/dashboard", label: s.nav.dashboard, icon: LayoutDashboard, show: true },
    { to: "/projects", label: s.nav.designer, icon: PencilRuler, show: true },
    { to: "/users", label: s.nav.users, icon: Users, show: can("user:List") },
    { to: "/groups", label: s.adm.groups, icon: UsersRound, show: can("group:Manage") },
    { to: "/policies", label: s.adm.policiesPage, icon: ShieldCheck, show: can("policy:Manage") },
    { to: "/connections", label: s.conn.nav, icon: Cloud, show: can("connection:Manage") },
    { to: "/audit", label: s.nav.audit, icon: ScrollText, show: can("audit:Read") },
  ];

  return (
    <div className="flex h-full" data-testid="home-layout">
      <aside className="flex w-14 flex-none flex-col border-r bg-card md:w-60" aria-label="Navigation">
        <Brand title={s.app} />
        <nav className="flex flex-1 flex-col gap-1 px-2">
          {items.filter((i) => i.show).map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              title={label}
              data-testid={`nav-${to.slice(1)}`}
              className={({ isActive }) => cn(
                "flex items-center gap-3 rounded-md px-2.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                isActive && "bg-accent text-accent-foreground",
              )}
            >
              <Icon className="size-4 flex-none" />
              <span className="hidden truncate md:block">{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="flex flex-col gap-2 border-t p-2">
          <div className="hidden items-center gap-2 md:flex">
            <Select value={prefs.lang} onValueChange={(v) => prefs.setLang(v as Lang)}>
              <SelectTrigger size="sm" aria-label={s.language} className="flex-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="vi">Tiếng Việt</SelectItem>
                <SelectItem value="en">English</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon-sm" onClick={prefs.toggleDark} aria-label={s.theme}>{prefs.dark ? <Sun /> : <Moon />}</Button>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="flex w-full items-center gap-2 rounded-md p-1.5 text-left hover:bg-accent" data-testid="user-menu">
                <span className="flex size-8 flex-none items-center justify-center rounded-full bg-muted text-sm font-semibold uppercase">{user.username.slice(0, 1)}</span>
                <span className="hidden min-w-0 flex-1 md:block">
                  <span className="block truncate text-sm font-medium">{user.displayName || user.username}</span>
                  <span className="block truncate text-xs text-muted-foreground">{user.username}</span>
                </span>
                <ChevronsUpDown className="hidden size-4 flex-none text-muted-foreground md:block" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-56">
              <DropdownMenuLabel className="font-normal">
                <div className="text-xs text-muted-foreground">{s.acct.signedInAs}</div>
                <div className="truncate font-medium">{user.displayName || user.username}</div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => navigate("/account")} data-testid="menu-account"><KeyRound />{s.nav.account}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void logout()} data-testid="menu-logout"><LogOut />{s.acct.signOut}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto" data-testid="home-main">
        <Outlet />
      </main>
    </div>
  );
}
