import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { databaseOptions } from './database';

try {
  process.loadEnvFile();
} catch {
  /* no .env file */
}

/** Entry point for the TypeORM CLI: `npm run migration:generate -w @av2i/api -- src/migrations/Name`. */
export default new DataSource(databaseOptions());
