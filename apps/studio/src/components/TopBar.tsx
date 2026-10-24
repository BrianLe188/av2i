import { useRef } from "react";
import { ArrowLeft, Download, FolderOpen, KeyRound, Layers, LogOut, Moon, Redo2, Save, Sun, Undo2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent,
  DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Template } from "../logic/templates.ts";
import type { Lang, Strings } from "../i18n.ts";
import type { User } from "../auth.tsx";

interface Props {
  s: Strings;
  lang: Lang;
  dark: boolean;
  name: string;
  canUndo: boolean;
  canRedo: boolean;
  canExport: boolean;
  templates: Template[];
  onUndo: () => void;
  onRedo: () => void;
  onOpenFile: (file: File) => void;
  onSave: () => void;
  onExport: () => void;
  onBlank: () => void;
  onTemplate: (id: string, variant?: string) => void;
  onLang: (l: Lang) => void;
  onTheme: () => void;
  user: User;
  onHome: () => void;
  onAccount: (what: "account" | "logout") => void;
}

export function TopBar(p: Props) {
  const input = useRef<HTMLInputElement>(null);
  const { s } = p;
  return (
    <header className="flex items-center gap-2 border-b bg-card px-3" style={{ gridArea: "top" }}>
      <Button variant="ghost" size="sm" onClick={p.onHome} data-testid="back-home" title={s.nav.home}><ArrowLeft />{s.nav.dashboard}</Button>
      <span className="h-5 w-px bg-border" />
      <span className="max-w-56 truncate text-muted-foreground" title={p.name}>{p.name}</span>
      <div className="flex-1" />
      <Button variant="outline" size="sm" onClick={p.onUndo} disabled={!p.canUndo} data-testid="undo"><Undo2 />{s.undo}</Button>
      <Button variant="outline" size="sm" onClick={p.onRedo} disabled={!p.canRedo} data-testid="redo"><Redo2 />{s.redo}</Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" data-testid="templates"><Layers />{s.templates}</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-96 max-h-[70vh] overflow-y-auto">
          <DropdownMenuItem onSelect={p.onBlank}>{s.blank}</DropdownMenuItem>
          <DropdownMenuSeparator />
          {p.templates.map((t) => (
            <div key={t.id}>
              <DropdownMenuItem data-testid={`template-${t.id}`} onSelect={() => p.onTemplate(t.id)} className="whitespace-normal">{t.title[p.lang]}</DropdownMenuItem>
              {t.variants.length > 0 && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className="text-xs text-muted-foreground">{s.variantsOf} {t.id} ({t.variants.length})</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-96 max-h-[70vh] overflow-y-auto">
                    <DropdownMenuLabel className="text-xs text-muted-foreground">{t.title[p.lang]}</DropdownMenuLabel>
                    {t.variants.map((v) => (
                      <DropdownMenuItem key={v.id} data-testid={`variant-${v.id}`} title={v.change} className="whitespace-normal text-xs" onSelect={() => p.onTemplate(t.id, v.id)}>{v.change}</DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
              <DropdownMenuSeparator />
            </div>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button variant="outline" size="sm" onClick={() => input.current?.click()}><FolderOpen />{s.open}</Button>
      <input ref={input} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) p.onOpenFile(f); e.target.value = ""; }} />
      <Button variant="outline" size="sm" onClick={p.onSave}><Save />{s.save}</Button>
      <Select value={p.lang} onValueChange={(v) => p.onLang(v as Lang)}>
        <SelectTrigger size="sm" aria-label={s.language} className="w-32">{p.lang === "vi" ? "Tiếng Việt" : "English"}</SelectTrigger>
        <SelectContent>
          <SelectItem value="vi">Tiếng Việt</SelectItem>
          <SelectItem value="en">English</SelectItem>
        </SelectContent>
      </Select>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline" size="icon-sm" onClick={p.onTheme} aria-label={s.theme}>{p.dark ? <Sun /> : <Moon />}</Button>
        </TooltipTrigger>
        <TooltipContent>{s.theme}</TooltipContent>
      </Tooltip>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" data-testid="account"><UserRound /><span className="max-w-24 truncate">{p.user.username}</span></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="font-normal">
            <div className="text-xs text-muted-foreground">{s.acct.signedInAs}</div>
            <div className="truncate font-medium">{p.user.displayName || p.user.username}</div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => p.onAccount("account")} data-testid="menu-account"><KeyRound />{s.nav.account}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => p.onAccount("logout")} data-testid="menu-logout"><LogOut />{s.acct.signOut}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button size="sm" onClick={p.onExport} disabled={!p.canExport} title={p.canExport ? undefined : s.cannotExport} data-testid="export"><Download />{s.exportTf}</Button>
    </header>
  );
}
