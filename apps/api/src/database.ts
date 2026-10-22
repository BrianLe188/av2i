import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { DataSourceOptions } from 'typeorm';
import { User } from './auth/user.entity';
import { InitialSchema1730000000000 } from './migrations/1730000000000-initial-schema';
import { AddShareToken1730000100000 } from './migrations/1730000100000-add-share-token';
import { ProjectVersion } from './projects/project-version.entity';
import { Project } from './projects/project.entity';

/** Shared by the app and the TypeORM CLI (see data-source.ts). */
export function databaseOptions(): DataSourceOptions {
  const entities = [User, Project, ProjectVersion];
  const migrations = [InitialSchema1730000000000, AddShareToken1730000100000];
  // The schema changes only through migrations (npm run migration:generate -w @av2i/api).
  if (process.env.DATABASE_URL) {
    return { type: 'postgres', url: process.env.DATABASE_URL, entities, migrations, migrationsRun: true };
  }
  const location = resolve(process.env.SQLITE_PATH ?? 'data/av2i.sqlite');
  mkdirSync(dirname(location), { recursive: true });
  return { type: 'sqljs', location, autoSave: true, entities, migrations, migrationsRun: true };
}
