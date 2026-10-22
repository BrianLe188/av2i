import { randomBytes } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { generateTerraform, validateGraph, type Graph } from '@av2i/core';
import { CreateProjectDto, UpdateProjectDto } from './dto';
import { ProjectVersion } from './project-version.entity';
import { Project } from './project.entity';

const MAX_VERSIONS = 50;

function assertGraph(graph: unknown): asserts graph is Graph {
  const g = graph as Graph | undefined;
  if (!g || !Array.isArray(g.nodes) || !Array.isArray(g.edges)) {
    throw new BadRequestException('graph must be { nodes: [], edges: [] }');
  }
  const ids = new Set<string>();
  for (const n of g.nodes) {
    if (!n || typeof n.id !== 'string' || typeof n.type !== 'string') {
      throw new BadRequestException('invalid node in graph');
    }
    if (ids.has(n.id)) throw new BadRequestException(`duplicate node id ${n.id}`);
    ids.add(n.id);
  }
}

@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    @InjectRepository(ProjectVersion) private readonly versions: Repository<ProjectVersion>,
  ) {}

  async list(ownerId: string) {
    const rows = await this.projects.find({ where: { ownerId }, order: { updatedAt: 'DESC' } });
    return rows.map((p) => ({
      id: p.id,
      name: p.name,
      region: p.region,
      nodeCount: p.graph.nodes.length,
      updatedAt: p.updatedAt,
    }));
  }

  async get(ownerId: string, id: string) {
    const project = await this.projects.findOneBy({ id, ownerId });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  create(ownerId: string, dto: CreateProjectDto) {
    const graph = dto.graph ?? { nodes: [], edges: [] };
    assertGraph(graph);
    return this.projects.save(
      this.projects.create({ ownerId, name: dto.name, region: dto.region ?? 'us-east-1', graph }),
    );
  }

  async update(ownerId: string, id: string, dto: UpdateProjectDto) {
    const project = await this.get(ownerId, id);
    if (dto.graph !== undefined) {
      assertGraph(dto.graph);
      project.graph = dto.graph;
    }
    if (dto.name !== undefined) project.name = dto.name;
    if (dto.region !== undefined) project.region = dto.region;
    return this.projects.save(project);
  }

  async remove(ownerId: string, id: string) {
    const project = await this.get(ownerId, id);
    await this.versions.delete({ projectId: id });
    await this.projects.remove(project);
  }

  async listVersions(ownerId: string, projectId: string) {
    await this.get(ownerId, projectId);
    const rows = await this.versions.find({
      where: { projectId },
      order: { createdAt: 'DESC' },
    });
    return rows.map((v) => ({
      id: v.id,
      label: v.label,
      region: v.region,
      nodeCount: v.graph.nodes.length,
      createdAt: v.createdAt,
    }));
  }

  async snapshot(ownerId: string, projectId: string, label?: string) {
    const project = await this.get(ownerId, projectId);
    const saved = await this.versions.save(
      this.versions.create({
        projectId,
        label: label ?? null,
        region: project.region,
        graph: project.graph,
      }),
    );
    const all = await this.versions.find({ where: { projectId }, order: { createdAt: 'DESC' } });
    if (all.length > MAX_VERSIONS) await this.versions.remove(all.slice(MAX_VERSIONS));
    return { id: saved.id, label: saved.label, createdAt: saved.createdAt };
  }

  async restore(ownerId: string, projectId: string, versionId: string) {
    const project = await this.get(ownerId, projectId);
    const version = await this.versions.findOneBy({ id: versionId, projectId });
    if (!version) throw new NotFoundException('Version not found');
    // Keep what we're about to overwrite so a restore can itself be undone.
    await this.snapshot(ownerId, projectId, 'Before restore');
    project.graph = version.graph;
    project.region = version.region;
    return this.projects.save(project);
  }

  /** Turn on the read-only link (idempotent: an existing link keeps its token). */
  async enableShare(ownerId: string, id: string) {
    const project = await this.get(ownerId, id);
    if (!project.shareToken) {
      project.shareToken = randomBytes(18).toString('base64url');
      await this.projects.save(project);
    }
    return { token: project.shareToken };
  }

  async disableShare(ownerId: string, id: string) {
    const project = await this.get(ownerId, id);
    if (project.shareToken) {
      project.shareToken = null;
      await this.projects.save(project);
    }
  }

  /** Public, read-only view for anyone holding the token. Exposes the design, never the owner. */
  async getShared(token: string) {
    const project = /^[\w-]{20,64}$/.test(token) ? await this.projects.findOneBy({ shareToken: token }) : null;
    if (!project) throw new NotFoundException('This link is invalid or sharing was turned off');
    return {
      name: project.name,
      region: project.region,
      graph: project.graph,
      updatedAt: project.updatedAt,
    };
  }

  async export(ownerId: string, id: string) {
    const project = await this.get(ownerId, id);
    return {
      files: generateTerraform(project.graph, { region: project.region }),
      issues: validateGraph(project.graph),
    };
  }
}
