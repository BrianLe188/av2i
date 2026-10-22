import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { Graph } from '@av2i/core';
import { Project } from './project.entity';

@Entity('project_versions')
export class ProjectVersion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  projectId: string;

  @ManyToOne(() => Project, (p) => p.versions, { onDelete: 'CASCADE' })
  project: Project;

  @Column({ type: 'varchar', nullable: true })
  label: string | null;

  @Column({ default: 'us-east-1' })
  region: string;

  @Column('simple-json')
  graph: Graph;

  @CreateDateColumn()
  createdAt: Date;
}
