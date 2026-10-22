import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Module } from '@nestjs/common';
import { TypeOrmModule, type TypeOrmModuleOptions } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { User } from './auth/user.entity';
import { ProjectsModule } from './projects/projects.module';
import { Project } from './projects/project.entity';
import { ProjectVersion } from './projects/project-version.entity';

function databaseOptions(): TypeOrmModuleOptions {
  const entities = [User, Project, ProjectVersion];
  // TODO: replace `synchronize` with migrations before any production deploy.
  if (process.env.DATABASE_URL) {
    return { type: 'postgres', url: process.env.DATABASE_URL, entities, synchronize: true };
  }
  const location = resolve(process.env.SQLITE_PATH ?? 'data/av2i.sqlite');
  mkdirSync(dirname(location), { recursive: true });
  return { type: 'sqljs', location, autoSave: true, entities, synchronize: true };
}

@Module({
  imports: [TypeOrmModule.forRoot(databaseOptions()), AuthModule, ProjectsModule],
})
export class AppModule {}
