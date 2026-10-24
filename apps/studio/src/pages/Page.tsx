import type { ReactNode } from "react";

/** The frame every page of the home layout shares: a title, a line under it, optional actions, then the content. */
export function Page({ title, text, actions, children, wide }: { title: string; text?: string; actions?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`mx-auto w-full p-6 ${wide ? "max-w-7xl" : "max-w-5xl"}`}>
      <header className="mb-6 flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {text && <p className="mt-1 text-sm text-muted-foreground">{text}</p>}
        </div>
        {actions}
      </header>
      {children}
    </div>
  );
}
