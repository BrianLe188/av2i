import { buildApp } from "./app.ts";
import { ensureAdmin, syncBuiltinPolicies } from "./bootstrap.ts";
import { loadConfig } from "./config.ts";
import { createDb } from "./db.ts";
import { migrate } from "./migrate.ts";
import { purgeSessions } from "./auth/sessions.ts";

const config = loadConfig();
const db = createDb(config.databaseUrl);
const app = buildApp({ db, config, logger: true });

const applied = await migrate(db);
if (applied.length) app.log.info(`applied migrations: ${applied.join(", ")}`);
await syncBuiltinPolicies(db);
await ensureAdmin(db, config, { warn: (m) => app.log.warn(m) });

await purgeSessions(db);
const sweep = setInterval(() => void purgeSessions(db).catch((e) => app.log.error(e)), 3_600_000);
sweep.unref();

const stop = async () => {
  clearInterval(sweep);
  await app.close();
  await db.destroy();
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);

await app.listen({ port: config.port, host: config.host });
