import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { compile, specRoot } from "@av2i/registry";

/** The registry is compiled from docs/spec at build time (DD-002) and served as a virtual module. */
function registry(): Plugin {
  const id = "virtual:registry";
  return {
    name: "av2i-registry",
    resolveId: (source) => (source === id ? `\0${id}` : null),
    load(source) {
      if (source !== `\0${id}`) return null;
      const { registry: r, problems } = compile(specRoot);
      if (problems.length) throw new Error(`the specification has ${problems.length} problem(s); run \`pnpm spec:check\``);
      // the studio needs neither the cases nor the decisions' prose
      return `export default ${JSON.stringify({ ...r, cases: [] })};`;
    },
    configureServer(server) {
      server.watcher.add(specRoot);
      server.watcher.on("change", (f) => {
        if (f.startsWith(specRoot)) {
          const mod = server.moduleGraph.getModuleById(`\0${id}`);
          if (mod) server.moduleGraph.invalidateModule(mod);
          server.ws.send({ type: "full-reload" });
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), registry()],
  server: { port: 5173, fs: { allow: ["../.."] } },
});
