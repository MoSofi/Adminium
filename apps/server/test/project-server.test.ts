// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The project sync inside a composed server: a Studio write reaching the
 * folder in dev, a file saved in the folder reaching the dashboard, and the
 * `/project` routes Studio and `pull --from` use on a server.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  apiKeysRepo,
  createFirstSuperAdmin,
  pagesRepo,
  rolesRepo,
  type MetaDb,
} from '@adminium/meta';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { composeServer, type ComposedServer } from '../src/compose.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import type { MetaStoreHandle } from '../src/meta/store.js';
import { diskFileStore } from '../src/project/file-store.js';
import { parseJsonText, stableStringify } from '../src/project/json.js';
import { reconcileProject } from '../src/project/reconcile.js';
import { isConfigWrite } from '../src/project/service.js';
import { generateApiKey } from '../src/rbac/api-keys.js';
import { adminPasswordHash, ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD, login } from './auth-helpers.js';
import { makeEnv } from './helpers.js';
import { makeInstall, type Install } from './project-fixtures.js';

function memoryStore(meta: MetaDb): MetaStoreHandle {
  return { meta, url: 'sqlite::memory:', engine: 'sqlite', source: 'embedded', close: async () => Promise.resolve() };
}

let install: Install | null = null;
let composed: ComposedServer | null = null;
afterEach(async () => {
  await composed?.app.close();
  await install?.close();
  composed = null;
  install = null;
});

/** An install whose project folder already holds its files, served in `mode`. */
async function serve(mode: 'dev' | 'server'): Promise<{ install: Install; app: ComposedServer['app']; cookie: string; logs: string[] }> {
  install = await makeInstall();
  const { meta } = install;
  await reconcileProject({ meta, store: diskFileStore(install.dir), mode: 'dev' });
  const logs: string[] = [];
  const runService = createRunService({ meta });
  composed = await composeServer({
    env: makeEnv({ ADMINIUM_DATA_DIR: join(install.dir, 'data') }),
    metaStore: memoryStore(meta),
    manager: install.manager,
    runService,
    applyService: createApplyService({ meta, runService }),
    allowed: null,
    logger: false,
    telemetry: false,
    project: { root: install.dir, mode, log: (line) => logs.push(line), warn: (line) => logs.push(line) },
  });
  await composed.app.ready();
  await createFirstSuperAdmin(meta, { email: ADMIN_EMAIL, name: ADMIN_NAME, passwordHash: await adminPasswordHash() });
  const { cookie } = await login(composed.app, ADMIN_EMAIL, ADMIN_PASSWORD);
  return { install, app: composed.app, cookie: cookie ?? '', logs };
}

async function readPageFile(dir: string, slug: string): Promise<Record<string, unknown>> {
  const parsed = parseJsonText(await readFile(join(dir, 'pages', `${slug}.json`), 'utf8'));
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.value as Record<string, unknown>;
}

describe('which requests tell the sync the database moved', () => {
  it('counts writes to pages, connections and AI assist, and nothing else', () => {
    expect(isConfigWrite('PATCH', '/api/v1/pages/:pageId')).toBe(true);
    expect(isConfigWrite('PUT', '/api/v1/pages/nav-order')).toBe(true);
    expect(isConfigWrite('PUT', '/api/v1/connections/:id/overrides')).toBe(true);
    expect(isConfigWrite('POST', '/api/v1/connections/:id/generate')).toBe(true);
    expect(isConfigWrite('DELETE', '/api/v1/connections/:id')).toBe(true);
    expect(isConfigWrite('POST', '/api/v1/llm/runs/:id/apply')).toBe(true);
    expect(isConfigWrite('GET', '/api/v1/pages')).toBe(false);
    expect(isConfigWrite('POST', '/api/v1/data/:connectionId/:table')).toBe(false);
    expect(isConfigWrite('POST', '/api/v1/pagesx')).toBe(false);
    expect(isConfigWrite('POST', undefined)).toBe(false);
  });
});

describe('a project served in dev', () => {
  it('writes a Studio edit into the page file', async () => {
    const { install: one, app, cookie } = await serve('dev');
    const page = await pagesRepo(one.meta).findBySlug(one.mainId, 'orders');
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/pages/${page?.id ?? ''}`,
      headers: { cookie },
      payload: { title: 'Orders from Studio' },
    });
    expect(res.statusCode).toBe(200);
    await vi.waitFor(async () => {
      expect(((await readPageFile(one.dir, 'orders'))['title'] as { fallback: string }).fallback).toBe('Orders from Studio');
    }, { timeout: 5000, interval: 50 });
  });

  it('applies a file saved in the folder, with no restart', async () => {
    const { install: one, app, cookie } = await serve('dev');
    const file = await readPageFile(one.dir, 'customers');
    (file['title'] as Record<string, unknown>)['fallback'] = 'Clients';
    await writeFile(join(one.dir, 'pages', 'customers.json'), stableStringify(file));
    await vi.waitFor(async () => {
      expect((await pagesRepo(one.meta).findBySlug(one.mainId, 'customers'))?.title).toBe('Clients');
    }, { timeout: 5000, interval: 50 });
    const nav = await app.inject({ method: 'GET', url: '/api/v1/bootstrap', headers: { cookie } });
    expect(nav.body).toContain('Clients');
  });
});

describe('a project served on a server', () => {
  it('shows a Studio edit as changed on this server, and puts the project copy back on request', async () => {
    const { install: one, app, cookie } = await serve('server');
    const page = await pagesRepo(one.meta).findBySlug(one.mainId, 'orders');
    const edit = await app.inject({
      method: 'PATCH',
      url: `/api/v1/pages/${page?.id ?? ''}`,
      headers: { cookie },
      payload: { title: 'Edited on the server' },
    });
    expect(edit.statusCode).toBe(200);
    // Nothing on a server writes files.
    expect(((await readPageFile(one.dir, 'orders'))['title'] as { fallback: string }).fallback).toBe('Orders');

    const status = await app.inject({ method: 'GET', url: '/api/v1/project/status', headers: { cookie } });
    expect(status.statusCode).toBe(200);
    expect(status.json().data).toMatchObject({
      mode: 'server',
      entries: [{ path: 'pages/orders.json', kind: 'page', name: 'orders', pageId: page?.id, status: 'changed-on-server' }],
    });

    const resolved = await app.inject({
      method: 'POST',
      url: '/api/v1/project/resolve',
      headers: { cookie },
      payload: { path: 'pages/orders.json', keep: 'project' },
    });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json().data.entries).toEqual([]);
    expect((await pagesRepo(one.meta).findBySlug(one.mainId, 'orders'))?.title).toBe('Orders');

    const nothing = await app.inject({
      method: 'POST',
      url: '/api/v1/project/resolve',
      headers: { cookie },
      payload: { path: 'pages/orders.json', keep: 'server' },
    });
    expect(nothing.statusCode).toBe(422);
    const unknown = await app.inject({
      method: 'POST',
      url: '/api/v1/project/resolve',
      headers: { cookie },
      payload: { path: 'pages/nope.json', keep: 'server' },
    });
    expect(unknown.statusCode).toBe(404);
  });

  it('hands the changed copies to an API key that may read the project, and to nobody else', async () => {
    const { install: one, app, cookie } = await serve('server');
    const page = await pagesRepo(one.meta).findBySlug(one.mainId, 'orders');
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/pages/${page?.id ?? ''}`,
      headers: { cookie },
      payload: { title: 'Edited on the server' },
    });

    const keyFor = async (slug: string): Promise<string> => {
      const role = await rolesRepo(one.meta).findBySlug(slug);
      const generated = generateApiKey();
      await apiKeysRepo(one.meta).create({ name: `${slug} key`, prefix: generated.prefix, tokenHash: generated.tokenHash, roleId: role?.id ?? '' });
      return generated.key;
    };

    const exported = await app.inject({
      method: 'GET',
      url: '/api/v1/project/export',
      headers: { authorization: `Bearer ${await keyFor('admin')}` },
    });
    expect(exported.statusCode).toBe(200);
    const data = exported.json().data as { mode: string; changes: { path: string; status: string; content: string }[] };
    expect(data.mode).toBe('server');
    expect(data.changes).toHaveLength(1);
    expect(data.changes[0]).toMatchObject({ path: 'pages/orders.json', status: 'changed-on-server' });
    expect(data.changes[0]?.content).toContain('"fallback": "Edited on the server"');

    const refused = await app.inject({
      method: 'GET',
      url: '/api/v1/project/export',
      headers: { authorization: `Bearer ${await keyFor('editor')}` },
    });
    expect(refused.statusCode).toBe(403);
    const anonymous = await app.inject({ method: 'GET', url: '/api/v1/project/export' });
    expect(anonymous.statusCode).toBe(401);
  });
});
