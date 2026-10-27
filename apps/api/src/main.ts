import { buildApp } from "./app.ts";
import { realGateway } from "./aws.ts";
import { ensureAdmin, syncBuiltinPolicies } from "./bootstrap.ts";
import { loadConfig } from "./config.ts";
import { createDb } from "./db.ts";
import { migrate } from "./migrate.ts";
import { purgeSessions } from "./auth/sessions.ts";
import { runsHooks } from "./routes/runs.ts";
import { execute } from "./runs/runner.ts";
import { recoverRunDirs } from "./runs/rescue.ts";
import { failStale, startWorkers } from "./runs/queue.ts";
import { mkdirSync } from "node:fs";

const config = loadConfig();
const db = createDb(config.databaseUrl);
const aws = realGateway();
const app = buildApp({ db, config, aws, logger: true });

const applied = await migrate(db);
if (applied.length) app.log.info(`applied migrations: ${applied.join(", ")}`);
await syncBuiltinPolicies(db);
await ensureAdmin(db, config, { warn: (m) => app.log.warn(m) });

mkdirSync(config.runsDir, { recursive: true });
const cut = await failStale(db);
const recovered = await recoverRunDirs(db, config);
if (recovered.removed) app.log.warn(`removed ${recovered.removed} folder(s) left by runs cut off by the last restart`);
if (recovered.rescued) app.log.warn(`saved ${recovered.rescued} state(s) that an apply could not write: they wait in the platform for someone to restore or download them`);
if (cut) app.log.warn(`${cut} run(s) were cut off by the last restart and marked failed`);
const workers = startWorkers(db, config.runWorkers, (run) => execute(db, config, run, aws), (e) => app.log.error(e));
runsHooks.wake = workers.wake;
if (!config.stateKey) app.log.warn("STATE_ENCRYPTION_KEY is not set: OpenTofu runs are refused until it is (openssl rand -base64 32)");

await purgeSessions(db);
const sweep = setInterval(() => void purgeSessions(db).catch((e) => app.log.error(e)), 3_600_000);
sweep.unref();

const stop = async () => {
  clearInterval(sweep);
  await workers.stop();
  await app.close();
  await db.destroy();
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);

await app.listen({ port: config.port, host: config.host });
