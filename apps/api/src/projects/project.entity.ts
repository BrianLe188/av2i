import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Graph } from '@av2i/core';
import { ProjectVersion } from './project-version.entity';

@Entity('projects')
export class Project {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Null only for projects created before auth existed; claimed by the first user to sign in. */
  @Index()
  @Column({ type: 'varchar', nullable: true })
  ownerId: string | null;

  /** Secret for the read-only share link; null when sharing is off. */
  @Index({ unique: true })
  @Column({ type: 'varchar', nullable: true })
  shareToken: string | null;

  @Column()
  name: string;

  @Column({ default: 'us-east-1' })
  region: string;

  /** `simple-json` works on both sql.js and Postgres; switch to jsonb later if we need to query inside it. */
  @Column('simple-json')
  graph: Graph;

  @OneToMany(() => ProjectVersion, (v) => v.project)
  versions: ProjectVersion[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
