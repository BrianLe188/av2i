import { defineConfig } from "vitest/config";

// every test file makes its own database and hashes passwords with argon2: more than five seconds when several files run together
export default defineConfig({ test: { testTimeout: 30_000, hookTimeout: 60_000 } });
