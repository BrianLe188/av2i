import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { ApiError } from "../api.ts";
import { App } from "../App.tsx";
import { useUser } from "../auth.tsx";
import { getProject, type ProjectFull } from "../projects.ts";
import { usePrefsContext, useStrings } from "../prefs.ts";
import { Page } from "./Page.tsx";

/** Loads one project and hands it to the canvas; the canvas is a layout of its own, so this page has no sidebar. */
export function ProjectPage() {
  const { id = "" } = useParams();
  const s = useStrings();
  const prefs = usePrefsContext();
  const user = useUser();
  const [state, setState] = useState<{ kind: "loading" } | { kind: "missing" } | { kind: "ready"; project: ProjectFull }>({ kind: "loading" });

  useEffect(() => {
    let live = true;
    setState({ kind: "loading" });
    getProject(id)
      .then((project) => live && setState({ kind: "ready", project }))
      .catch((e) => live && setState(e instanceof ApiError && e.status !== 401 ? { kind: "missing" } : { kind: "loading" }));
    return () => { live = false; };
  }, [id]);

  if (state.kind === "loading") return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{s.proj.loading}</div>;
  if (state.kind === "missing") {
    return (
      <Page title={s.proj.notFound} text={s.proj.notFoundText}>
        <Button asChild variant="outline"><Link to="/projects">{s.proj.back}</Link></Button>
      </Page>
    );
  }
  return <App key={`${id}-${state.project.project.rev}`} prefs={prefs} user={user} project={state.project} />;
}
