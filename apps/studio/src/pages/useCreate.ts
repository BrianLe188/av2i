import { useCallback } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import type { Design } from "@av2i/model";
import { describe } from "../components/auth/errors.ts";
import { createProject } from "../projects.ts";
import { useStrings } from "../prefs.ts";

/** Makes a project on the server and opens it on the canvas; the answer is a toast when it fails. */
export function useCreateProject(): (design?: Design, name?: string) => Promise<void> {
  const s = useStrings();
  const navigate = useNavigate();
  return useCallback(async (design, name) => {
    try {
      const p = await createProject(design, name);
      toast(s.proj.created);
      navigate(`/projects/${p.id}`);
    } catch (e) {
      toast.error(describe(e, s));
    }
  }, [s, navigate]);
}
