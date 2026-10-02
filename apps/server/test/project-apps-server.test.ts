// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A project's apps inside a composed server: the whole Adminium a person runs
 * with `adminium start`, given a project folder that carries an app. The app
 * is there before the first request, listed as the folder's, and its pages
 * are in the sidebar of whoever signs in.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createFirstSuperAdmin, pagesRepo, publicEndpointsRepo, usersRepo, type MetaDb } from '@adminium/meta';
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { runCli } from '../src/cli/run.js';
import { composeServer, type ComposedServer } from '../src/compose.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import type { MetaStoreHandle } from '../src/meta/store.js';
import { buildProjectApps, type AppsBuild } from '../src/project/apps/build-apps.js';
import { loadProjectBundler } from '../src/project/build.js';
import type { ProjectConfig } from '../src/project/config.js';
import { APP_VERSION } from '../src/version.js';
import { asProject, canBuildSides } from './app-project-helpers.js';
import { adminPasswordHash, ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD, login } from './auth-helpers.js';
import { fakeDeps, fakeIo } from './cli-helpers.js';
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

async function newApp(dir: string, ...argv: string[]): Promise<void> {
  const io = fakeIo({ interactive: false });
  const deps = fakeDeps({ cwd: dir, env: {} });
  deps.runProcess = () => ({ status: 0, stdout: '' });
  expect(await runCli(['app', 'new', ...argv], { io, deps }), io.stderr()).toBe(0);
}

/** Build the project's apps and record them in the build manifest, as `adminium build` does. */
export async function buildApps(dir: string): Promise<AppsBuild> {
  const apps = await buildProjectApps(dir, { version: APP_VERSION, bundler: canBuildSides ? await loadProjectBundler(dir) : null, dev: true });
  const build = join(dir, '.adminium', 'build');
  mkdirSync(build, { recursive: true });
  const file = join(build, 'manifest.json');
  const manifest = { adminiumVersion: APP_VERSION, builtAt: new Date().toISOString(), config: { entry: 'adminium.config.ts', inputs: {} }, apps };
  // The same one-step replace the build uses.
  writeFileSync(`${file}.tmp`, JSON.stringify(manifest));
  renameSync(`${file}.tmp`, file);
  return apps;
}

async function boot(opts: { mode?: 'dev' | 'server'; apps?: ProjectConfig['apps']; pollMs?: number } = {}) {
  if (install === null) throw new Error('make the install first');
  const { meta } = install;
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
    project: {
      root: install.dir,
      mode: opts.mode ?? 'dev',
      log: (line) => logs.push(line),
      warn: (line) => logs.push(`! ${line}`),
      databases: ['main'],
      ...(opts.apps === undefined ? {} : { apps: opts.apps }),
    },
  });
  await composed.app.ready();
  // A second boot of the same install already has its owner.
  if ((await usersRepo(meta).list()).length === 0) {
    await createFirstSuperAdmin(meta, { email: ADMIN_EMAIL, name: ADMIN_NAME, passwordHash: await adminPasswordHash() });
  }
  const { cookie } = await login(composed.app, ADMIN_EMAIL, ADMIN_PASSWORD);
  const get = async (url: string) => {
    const reply = await composed!.app.inject({ method: 'GET', url, headers: { cookie: cookie ?? '' } });
    return { status: reply.statusCode, body: reply.body, json: <T>() => JSON.parse(reply.body) as T, headers: reply.headers };
  };
  return { app: composed.app, cookie: cookie ?? '', logs, get };
}

/** The rows of the app's table, read straight from the project's database file. */
function itemRows(dir: string): Record<string, unknown>[] {
  const db = new BetterSqlite3(join(dir, 'shop.db'), { readonly: true });
  try {
    return db.prepare('SELECT * FROM repairs_items').all() as Record<string, unknown>[];
  } finally {
    db.close();
  }
}

interface Listed {
  apps: { key: string; source: string; folder?: { state: string }; missing: boolean; sides: { side: string; prefix: string }[]; connectionId: string | null }[];
}

describe('a project’s apps in a running server', { timeout: 120_000 }, () => {
  it('installs the app the folder carries before the first request, on the project’s first database', async () => {
    install = await makeInstall();
    asProject(install.dir);
    await newApp(install.dir, 'repairs');
    await buildApps(install.dir);
    const server = await boot();

    expect(server.logs.join('\n')).toContain('App "repairs" installed from apps/repairs.');
    expect(server.logs.filter((line) => line.startsWith('!'))).toEqual([]);
    const listed = (await server.get('/api/v1/apps')).json<Listed>();
    expect(listed.apps).toEqual([
      expect.objectContaining({ key: 'repairs', source: 'folder', folder: { state: 'here' }, missing: false, connectionId: install.mainId }),
    ]);

    // Its pages are pages of this server, bound to the tables it made.
    const pages = (await pagesRepo(install.meta).listAll()).map((page) => page.slug);
    expect(pages).toEqual(expect.arrayContaining(['repairs-items', 'repairs-requests']));
    // Dev adds its sample data on the first install.
    expect(itemRows(install.dir)).toHaveLength(6);
  });

  it('starts as it was on the next boot, and applies what the folder changed in between', async () => {
    install = await makeInstall();
    asProject(install.dir);
    await newApp(install.dir, 'repairs');
    await buildApps(install.dir);
    await boot();
    await composed?.app.close();

    const file = join(install.dir, 'apps/repairs/manifest/tables/items.json');
    const table = JSON.parse(readFileSync(file, 'utf8')) as { columns: unknown[] };
    writeFileSync(file, JSON.stringify({ ...table, columns: [...table.columns, { ref: 'colour', type: 'text', maxLength: 40 }] }));
    await buildApps(install.dir);
    const server = await boot();
    expect(server.logs.join('\n')).toContain('App "repairs" applied from apps/repairs.');
    const rows = itemRows(install.dir);
    expect(rows).toHaveLength(6);
    expect(Object.keys(rows[0] ?? {})).toContain('colour');
  });

  it('gives a server no public access for the app unless its config says so', async () => {
    install = await makeInstall();
    asProject(install.dir);
    await newApp(install.dir, 'repairs');
    writeFileSync(
      join(install.dir, 'apps/repairs/manifest/access.json'),
      JSON.stringify({ publicAccess: [{ table: 'items', methods: ['GET'], select: ['id', 'title', 'status'] }] }),
    );
    await buildApps(install.dir);
    const server = await boot({ mode: 'server' });
    expect(server.logs.join('\n')).toContain('App "repairs" is installed WITHOUT public access');
    expect(await publicEndpointsRepo(install.meta).listByConnection(install.mainId)).toEqual([]);
    expect((await server.get('/api/v1/apps')).json<Listed>().apps[0]).toMatchObject({ key: 'repairs', source: 'folder' });
  });
});
