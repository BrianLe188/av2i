import 'reflect-metadata';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import type { Graph } from '@av2i/core';

/**
 * End-to-end against a real (temporary) database: migrations, auth, ownership and sharing.
 *   npm test -w @av2i/api
 */
const dir = mkdtempSync(join(tmpdir(), 'av2i-e2e-'));
process.env.SQLITE_PATH = join(dir, 'test.sqlite');
process.env.DEV_LOGIN = 'true';
process.env.SESSION_SECRET = 'e2e-secret';
delete process.env.DATABASE_URL;
delete process.env.NODE_ENV;

let app: INestApplication;
let base = '';
let cookieA = '';
let cookieB = '';
let orphanId = '';

async function call(path: string, opts: { method?: string; cookie?: string; body?: unknown } = {}) {
  const res = await fetch(`${base}${path}`, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(opts.cookie ? { cookie: opts.cookie } : {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined, headers: res.headers };
}

const graph: Graph = {
  nodes: [{ id: 'n1', type: 'vpc', name: 'main', position: { x: 0, y: 0 }, size: { width: 460, height: 320 }, props: { cidr_block: '10.0.0.0/16' } }],
  edges: [],
};

describe('api', () => {
  before(async () => {
    const { NestFactory } = await import('@nestjs/core');
    const { ValidationPipe } = await import('@nestjs/common');
    const { DataSource } = await import('typeorm');
    const { AppModule } = await import('./app.module');
    const { SessionService } = await import('./auth/session.service');
    const { User } = await import('./auth/user.entity');
    const { Project } = await import('./projects/project.entity');

    app = await NestFactory.create(AppModule, { logger: false });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.listen(0);
    base = `${await app.getUrl()}/api`.replace('[::1]', '127.0.0.1');

    // A project from before auth existed (no owner): the first user to sign in inherits it.
    const ds = app.get(DataSource);
    const orphan = await ds.getRepository(Project).save(
      ds.getRepository(Project).create({ ownerId: null, shareToken: null, name: 'Legacy', region: 'us-east-1', graph }),
    );
    orphanId = orphan.id;

    const first = await call('/auth/dev-login', { method: 'POST' });
    cookieA = first.headers.get('set-cookie')!.split(';')[0];

    // Second user, signed in by minting a session cookie directly.
    const userB = await ds.getRepository(User).save(
      ds.getRepository(User).create({ githubId: '999', login: 'bob', name: 'Bob', avatarUrl: null }),
    );
    let minted = '';
    app.get(SessionService).issue({ cookie: (n: string, v: string) => (minted = `${n}=${v}`) } as never, userB.id);
    cookieB = minted;
  });

  after(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('serves public config but protects everything else', async () => {
    assert.equal((await call('/auth/config')).status, 200);
    assert.equal((await call('/projects')).status, 401);
    assert.equal((await call('/auth/me', { cookie: 'av2i_session=forged.value' })).status, 401);
    assert.equal((await call('/auth/me', { cookie: cookieA })).body.login, 'dev-user');
  });

  it('gives the first account the projects that predate auth, and nobody else', async () => {
    const mine = await call('/projects', { cookie: cookieA });
    assert.ok(mine.body.some((p: { id: string }) => p.id === orphanId));
    assert.deepEqual((await call('/projects', { cookie: cookieB })).body, []);
  });

  describe('ownership', () => {
    let id = '';
    before(async () => {
      const created = await call('/projects', { method: 'POST', cookie: cookieA, body: { name: 'Mine', graph } });
      assert.equal(created.status, 201);
      id = created.body.id;
    });

    it('hides a project from other users on every route', async () => {
      for (const [method, path] of [
        ['GET', `/projects/${id}`],
        ['PUT', `/projects/${id}`],
        ['DELETE', `/projects/${id}`],
        ['GET', `/projects/${id}/export`],
        ['GET', `/projects/${id}/versions`],
        ['POST', `/projects/${id}/versions`],
        ['POST', `/projects/${id}/share`],
      ]) {
        const res = await call(path, { method, cookie: cookieB, body: method === 'PUT' ? { name: 'x' } : method === 'POST' ? {} : undefined });
        assert.equal(res.status, 404, `${method} ${path}`);
      }
      assert.equal((await call(`/projects/${id}`, { cookie: cookieA })).body.name, 'Mine');
    });

    it('rejects malformed graphs', async () => {
      const bad = await call('/projects', { method: 'POST', cookie: cookieA, body: { name: 'Bad', graph: { nodes: [{ id: 1 }], edges: [] } } });
      assert.equal(bad.status, 400);
    });

    it('snapshots and restores versions', async () => {
      await call(`/projects/${id}/versions`, { method: 'POST', cookie: cookieA, body: { label: 'v1' } });
      await call(`/projects/${id}`, { method: 'PUT', cookie: cookieA, body: { graph: { nodes: [], edges: [] } } });
      const versions = (await call(`/projects/${id}/versions`, { cookie: cookieA })).body;
      assert.equal(versions[0].label, 'v1');
      const restored = await call(`/projects/${id}/versions/${versions[0].id}/restore`, { method: 'POST', cookie: cookieA });
      assert.equal(restored.body.graph.nodes.length, 1);
      assert.ok((await call(`/projects/${id}/versions`, { cookie: cookieA })).body.some((v: { label: string }) => v.label === 'Before restore'));
    });

    it('shares read-only by token and can revoke it', async () => {
      const { body } = await call(`/projects/${id}/share`, { method: 'POST', cookie: cookieA });
      assert.match(body.token, /^[\w-]{20,}$/);
      assert.equal((await call(`/projects/${id}/share`, { method: 'POST', cookie: cookieA })).body.token, body.token);

      const shared = await call(`/shared/${body.token}`); // no cookie
      assert.equal(shared.status, 200);
      assert.equal(shared.body.name, 'Mine');
      assert.equal(shared.body.graph.nodes.length, 1);
      assert.equal(shared.body.ownerId, undefined);
      assert.equal(shared.body.id, undefined);
      assert.equal((await call(`/shared/${body.token}`, { method: 'PUT', body: {} })).status, 404);

      assert.equal((await call(`/projects/${id}/share`, { method: 'DELETE', cookie: cookieB })).status, 404);
      assert.equal((await call(`/shared/${body.token}`)).status, 200);
      assert.equal((await call(`/projects/${id}/share`, { method: 'DELETE', cookie: cookieA })).status, 204);
      assert.equal((await call(`/shared/${body.token}`)).status, 404);
      assert.equal((await call('/shared/not-a-token')).status, 404);
    });

    it('deletes a project together with its versions', async () => {
      assert.equal((await call(`/projects/${id}`, { method: 'DELETE', cookie: cookieA })).status, 204);
      assert.equal((await call(`/projects/${id}`, { cookie: cookieA })).status, 404);
      assert.equal((await call(`/projects/${id}/versions`, { cookie: cookieA })).status, 404);
    });
  });
});
