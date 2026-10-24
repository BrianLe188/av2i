export interface Config {
  port: number;
  host: string;
  databaseUrl: string;
  /** the password `admin` gets on the very first start; `admin` itself when unset */
  adminInitialPassword: string | undefined;
  sessionIdleMinutes: number;
  sessionMaxHours: number;
  /** a folder with the built studio, served next to the API */
  staticDir: string | undefined;
  /** honour X-Forwarded-For and X-Forwarded-Proto from the reverse proxy in front */
  trustProxy: boolean;
}

const int = (v: string | undefined, fallback: number, name: string): number => {
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive whole number`);
  return n;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required, for example postgres://user:password@host:5432/av2i");
  return {
    port: int(env.PORT, 3000, "PORT"),
    host: env.HOST || "0.0.0.0",
    databaseUrl,
    adminInitialPassword: env.ADMIN_INITIAL_PASSWORD || undefined,
    sessionIdleMinutes: int(env.SESSION_IDLE_MINUTES, 480, "SESSION_IDLE_MINUTES"),
    sessionMaxHours: int(env.SESSION_MAX_HOURS, 168, "SESSION_MAX_HOURS"),
    staticDir: env.STATIC_DIR || undefined,
    trustProxy: env.TRUST_PROXY === "true" || env.TRUST_PROXY === "1",
  };
}
