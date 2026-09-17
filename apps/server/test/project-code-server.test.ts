// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A project's hooks and actions inside a composed server: a hook's rejection
 * on a single edit, a bulk edit, a delete, the public API and a CSV import;
 * after hooks writing through `db`; actions with their permissions and audit;
 * the Studio overview; a reload in dev; and no project code on the desktop.
 *
 * The bundles are written by hand, as `adminium build` would leave them, so
 * this needs no esbuild.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  auditRepo,
  createFirstSuperAdmin,
  permissionsRepo,
  publicKeysRepo,
  publicScopesRepo,
  rolesRepo,
  settingsRepo,
  usersRepo,
  type MetaDb,
} from '@adminium/meta';
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { composeServer, type ComposedServer } from '../src/compose.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import type { MetaStoreHandle } from '../src/meta/store.js';
import { generatePublishableKey } from '../src/public-api/keys.js';
import { adminPasswordHash, ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD, login } from './auth-helpers.js';
import { makeEnv } from './helpers.js';
import { makeInstall, type Install } from './project-fixtures.js';

const ORIGIN = 'https://shop.example.com';

const ORDERS_HOOK = `
export default {
  table: 'orders',
  beforeUpdate({ values, record, reject }) {
    if (record.status === 'refunded' && values.status !== undefined && values.status !== 'refunded') {
      reject('Refunded orders stay refunded.');
    }
  },
  beforeDelete({ record, reject }) {
    if (record.status === 'shipped') reject('Shipped orders cannot be deleted.');
  },
  async afterUpdate({ record, before, db, origin, user }) {
    if (record.status === 'refunded' && before.status !== 'refunded') {
      await db.table('events').insert({
        title: 'Refund of order ' + record.id + ' (' + origin + ', ' + (user ? user.name : 'nobody') + ')',
        customer_id: record.customer_id,
        starts_at: '2026-01-01 00:00:00',
        ends_at: '2026-01-01 01:00:00',
      });
    }
  },
};
`;

const TASKS_HOOK = `
export default {
  table: 'main.tasks',
  onImport: true,
  beforeCreate({ values, reject }) {
    if (values.title === 'spam') reject('No spam, please.');
    values.priority ??= 'low';
  },
  beforeUpdate({ values, record, reject }) {
    if (record.status === 'done' && values.status !== undefined && values.status !== 'done') {
      reject('Done tasks stay done.');
    }
    values.priority = 'urgent';
  },
  afterCreate({ record }) {
    globalThis.__projectTasksCreated = [...(globalThis.__projectTasksCreated ?? []), record.title];
  },
  afterUpdate({ record, before }) {
    globalThis.__projectTasksUpdated = [
      ...(globalThis.__projectTasksUpdated ?? []),
      record.title + ':' + before.status + '>' + record.status,
    ];
  },
  afterDelete() {
    throw new Error('after delete exploded');
  },
};
`;

const REFUND_ACTION = `
export default {
  table: 'orders',
  label: 'Refund',
  icon: 'undo-2',
  confirm: 'Refund this order?',
  bulk: true,
  async run({ records, db, fail }) {
    for (const record of records) {
      if (record.status === 'pending') fail('Order ' + record.id + ' is not paid yet.');
      await db.table('orders').update(record.id, { status: 'refunded' });
    }
    return { message: records.length + ' order(s) refunded.' };
  },
};
`;

const EXPLODE_ACTION = `
export default {
  table: 'orders',
  label: 'Explode',
  permission: 'read',
  run() {
    throw new Error('boom');
  },
};
`;

type Bundles = Record<string, string>;

const BUNDLES: Bundles = {
  'hooks/orders': ORDERS_HOOK,
  'hooks/tasks': TASKS_HOOK,
  'hooks/broken': "throw new Error('broken at import');\n",
  'hooks/typo': "export default { table: 'orders', beforeCreated() {} };\n",
  'actions/refund-order': REFUND_ACTION,
  'actions/explode': EXPLODE_ACTION,
};

/**
 * Write bundles and a manifest listing them, the way `adminium build` does.
 *
 * `tag` names the bundles apart. Node imports a changed bundle again because
 * the loader adds `?v=<hash>`, but vitest's module runner caches by path and
 * ignores the query, so a reload under test needs a new path. The rehearsal
 * (`scripts/release/rehearse-project.mjs`) covers the query in real Node.
 */
function writeBuild(dir: string, bundles: Bundles, tag = ''): void {
  const build = join(dir, '.adminium', 'build');
  const files = Object.entries(bundles).map(([key, source]) => {
    const [kind, name] = key.split('/') as ['hooks' | 'actions', string];
    const output = `server/${kind}/${name}${tag}.mjs`;
    mkdirSync(join(build, 'server', kind), { recursive: true });
    writeFileSync(join(build, output), source);
    return { kind, name, source: `${kind}/${name}.ts`, output, hash: createHash('sha256').update(source).digest('hex') };
  });
  const digest = createHash('sha256').update(JSON.stringify(files)).digest('hex');
  const manifest = {
    adminiumVersion: 'test',
    builtAt: new Date().toISOString(),
    config: { entry: 'adminium.config.ts', inputs: {} },
    server: { digest, files, inputs: {} },
  };
  const file = join(build, 'manifest.json');
  // The same one-step replace the build uses.
  writeFileSync(`${file}.tmp`, JSON.stringify(manifest));
  renameSync(`${file}.tmp`, file);
}

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

interface Served {
  install: Install;
  app: ComposedServer['app'];
  cookie: string;
  logs: string[];
}

async function serve(opts: { mode?: 'dev' | 'server'; env?: Record<string, string>; bundles?: Bundles } = {}): Promise<Served> {
  install = await makeInstall();
  const { meta } = install;
  writeBuild(install.dir, opts.bundles ?? BUNDLES);
  const logs: string[] = [];
  const runService = createRunService({ meta });
  composed = await composeServer({
    env: makeEnv({ ADMINIUM_DATA_DIR: join(install.dir, 'data'), ...opts.env }),
    metaStore: memoryStore(meta),
    manager: install.manager,
    runService,
    applyService: createApplyService({ meta, runService }),
    allowed: null,
    logger: false,
    telemetry: false,
    project: {
      root: install.dir,
      mode: opts.mode ?? 'server',
      log: (line) => logs.push(line),
      warn: (line) => logs.push(line),
    },
  });
  await composed.app.ready();
  await createFirstSuperAdmin(meta, { email: ADMIN_EMAIL, name: ADMIN_NAME, passwordHash: await adminPasswordHash() });
  const { cookie } = await login(composed.app, ADMIN_EMAIL, ADMIN_PASSWORD);
  return { install, app: composed.app, cookie: cookie ?? '', logs };
}

function orderStatus(one: Install, id: number): unknown {
  const db = new BetterSqlite3(join(one.dir, 'shop.db'), { readonly: true });
  try {
    return (db.prepare('SELECT status FROM orders WHERE id = ?').get(id) as { status: string } | undefined)?.status;
  } finally {
    db.close();
  }
}

function shopRows(one: Install, sql: string): Record<string, unknown>[] {
  const db = new BetterSqlite3(join(one.dir, 'shop.db'), { readonly: true });
  try {
    return db.prepare(sql).all() as Record<string, unknown>[];
  } finally {
    db.close();
  }
}

/** A signed-in person with only read access to the project database. */
async function reader(served: Served): Promise<string> {
  const { meta, mainId } = served.install;
  const role = await rolesRepo(meta).findBySlug('viewer');
  if (role === null) throw new Error('no viewer role');
  const user = await usersRepo(meta).create({
    email: 'reader@example.com',
    name: 'Reader',
    passwordHash: await adminPasswordHash(),
    status: 'active',
  });
  await rolesRepo(meta).assignToUser(user.id, role.id);
  await permissionsRepo(meta).grant(role.id, 'table', `${mainId}/*`, {
    read: true,
    create: false,
    update: false,
    delete: false,
    export: false,
    import: false,
  });
  const { cookie } = await login(served.app, 'reader@example.com', ADMIN_PASSWORD);
  return cookie ?? '';
}

const errorOf = (body: string): { code: string; message: string } =>
  (JSON.parse(body) as { error: { code: string; message: string } }).error;

describe('loading project code', () => {
  it('loads before the first request, and reports the files that do not load', async () => {
    const { app, cookie, logs } = await serve();
    const res = await app.inject({ method: 'GET', url: '/api/v1/project/overview', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const data = res.json().data as {
      codeEnabled: boolean;
      actions: { id: string }[];
      hooks: { source: string; events: string[]; onImport: boolean }[];
      problems: { source: string; message: string }[];
    };
    expect(data.codeEnabled).toBe(true);
    expect(data.actions.map((action) => action.id)).toEqual(['explode', 'refund-order']);
    expect(data.hooks).toEqual([
      { source: 'hooks/orders.ts', database: 'main', table: 'orders', events: ['beforeUpdate', 'beforeDelete', 'afterUpdate'], onImport: false },
      {
        source: 'hooks/tasks.ts',
        database: 'main',
        table: 'main.tasks',
        events: ['beforeCreate', 'beforeUpdate', 'afterCreate', 'afterUpdate', 'afterDelete'],
        onImport: true,
      },
    ]);
    expect(data.problems.map((problem) => problem.source)).toEqual(['hooks/broken.ts', 'hooks/typo.ts']);
    expect(data.problems[0]?.message).toContain('broken at import');
    expect(data.problems[1]?.message).toContain('unknown option "beforeCreated"');
    expect(logs.join('\n')).toContain('Project code: 2 hooks and 2 actions loaded.');
    expect(logs.join('\n')).toContain('hooks/broken.ts was not loaded.');
  });

  it('keeps the overview to super admins', async () => {
    const served = await serve();
    const cookie = await reader(served);
    const res = await served.app.inject({ method: 'GET', url: '/api/v1/project/overview', headers: { cookie } });
    expect(res.statusCode).toBe(403);
  });
});

describe('hooks', () => {
  it("refuse a single edit, a bulk edit and a delete with the hook's message", async () => {
    const { install: one, app, cookie } = await serve();
    const base = `/api/v1/data/${one.mainId}/main.orders`;
    // Order 3 is refunded, 2 is shipped, 1 is paid (the fixture's cycle).
    const single = await app.inject({
      method: 'PATCH',
      url: `${base}/3`,
      headers: { cookie },
      payload: { values: { status: 'paid' } },
    });
    expect(single.statusCode).toBe(422);
    expect(errorOf(single.body)).toMatchObject({ code: 'VALIDATION_FAILED', message: 'Refunded orders stay refunded.' });

    const bulk = await app.inject({
      method: 'POST',
      url: `${base}/bulk`,
      headers: { cookie },
      payload: { action: 'update', ids: [1, 3], values: { status: 'pending' } },
    });
    expect(bulk.statusCode).toBe(422);
    expect(errorOf(bulk.body).message).toBe('Refunded orders stay refunded.');
    expect(orderStatus(one, 1)).toBe('paid');

    const removed = await app.inject({ method: 'DELETE', url: `${base}/2?confirm=true`, headers: { cookie } });
    expect(removed.statusCode).toBe(422);
    expect(errorOf(removed.body).message).toBe('Shipped orders cannot be deleted.');
    expect(orderStatus(one, 2)).toBe('shipped');
    expect(orderStatus(one, 3)).toBe('refunded');
  });

  it('run after a change with a db that writes through the hooks and the audit trail', async () => {
    const { install: one, app, cookie } = await serve();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/data/${one.mainId}/main.orders/1`,
      headers: { cookie },
      payload: { values: { status: 'refunded' } },
    });
    expect(res.statusCode).toBe(200);
    expect(shopRows(one, "SELECT title FROM events WHERE title LIKE 'Refund%'")).toEqual([
      { title: `Refund of order 1 (dashboard, ${ADMIN_NAME})` },
    ]);
    const entries = await auditRepo(one.meta).list({ limit: 20 });
    const created = entries.find((entry) => entry.action === 'record.create');
    expect(created).toMatchObject({ actorKind: 'user', actorLabel: ADMIN_NAME, entity: { table: 'main.events' } });
  });

  it("show a hook's rejection on the public API, and apply its defaults", async () => {
    const { install: one, app } = await serve({
      env: { ADMINIUM_PUBLIC_API_ORIGINS: ORIGIN, HOST: '127.0.0.1' },
    });
    await settingsRepo(one.meta).set('publicApi.enabled', true);
    const scope = await publicScopesRepo(one.meta).create({
      connectionId: one.mainId,
      side: 'customer',
      name: 'Tasks',
      timezone: 'UTC',
      document: JSON.stringify({
        version: 1,
        side: 'customer',
        timezone: 'UTC',
        resources: [
          {
            ref: 'tasks',
            table: 'main.tasks',
            actions: ['read', 'create'],
            expose: ['id', 'title', 'priority'],
            writable: ['title', 'status', 'created_at', 'updated_at'],
          },
        ],
      }),
      createdBy: null,
    });
    const key = generatePublishableKey();
    await publicKeysRepo(one.meta).create({
      name: 'Site',
      prefix: key.prefix,
      tokenHash: key.tokenHash,
      tokenEncrypted: 'not-needed-here',
      scopeId: scope.id,
      side: 'customer',
      origins: [],
    });
    const post = (title: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/public/records/tasks',
        headers: { authorization: `Bearer ${key.token}`, origin: ORIGIN },
        payload: {
          values: { title, status: 'todo', created_at: '2026-01-01 00:00:00', updated_at: '2026-01-01 00:00:00' },
        },
      });
    const refused = await post('spam');
    expect(refused.statusCode).toBe(400);
    expect(errorOf(refused.body)).toMatchObject({ code: 'PUBLIC_WRITE_REJECTED', message: 'No spam, please.' });
    const accepted = await post('Call back');
    expect(accepted.statusCode).toBe(201);
    expect(accepted.json().data).toMatchObject({ title: 'Call back', priority: 'low' });
  });

  it("show a hook's rejection in a CSV import, and run after hooks the import asked for", async () => {
    const { install: one, app, cookie } = await serve();
    (globalThis as { __projectTasksCreated?: string[] }).__projectTasksCreated = [];
    const csv = 'title,status,created_at,updated_at\nspam,todo,2026-01-01 00:00:00,2026-01-01 00:00:00\nImported,todo,2026-01-01 00:00:00,2026-01-01 00:00:00\n';
    const upload = await app.inject({
      method: 'POST',
      url: '/api/v1/imports/upload?filename=tasks.csv',
      headers: { cookie, 'content-type': 'text/csv' },
      payload: csv,
    });
    expect(upload.statusCode).toBe(201);
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/imports',
      headers: { cookie },
      payload: {
        fileId: (upload.json().data as { fileId: string }).fileId,
        connectionId: one.mainId,
        table: 'main.tasks',
        mapping: {
          columns: ['title', 'status', 'created_at', 'updated_at'].map((column) => ({ from: column, to: column })),
        },
        options: { mode: 'insert', skipInvalid: true },
      },
    });
    expect(created.statusCode).toBe(201);
    const importId = (created.json().data as { import: { id: string } }).import.id;
    const run = await app.inject({ method: 'POST', url: `/api/v1/imports/${importId}/run`, headers: { cookie } });
    expect(run.statusCode).toBe(202);
    await vi.waitFor(
      async () => {
        const view = await app.inject({ method: 'GET', url: `/api/v1/imports/${importId}`, headers: { cookie } });
        expect((view.json().data as { status: string }).status).toBe('succeeded');
        expect((view.json().data as { stats: unknown }).stats).toEqual({ total: 2, inserted: 1, updated: 0, skipped: 1 });
      },
      { timeout: 10_000, interval: 100 },
    );
    const report = await app.inject({ method: 'GET', url: `/api/v1/imports/${importId}/error-report`, headers: { cookie } });
    expect(report.body).toContain('REJECTED');
    expect(report.body).toContain('No spam, please.');
    expect(shopRows(one, "SELECT priority FROM tasks WHERE title = 'Imported'")).toEqual([{ priority: 'low' }]);
    expect((globalThis as { __projectTasksCreated?: string[] }).__projectTasksCreated).toEqual(['Imported']);

    // An upsert: hooks judge the rows it updates too. Task 4 is done, task 6 is to do.
    (globalThis as { __projectTasksUpdated?: string[] }).__projectTasksUpdated = [];
    const upsertCsv = 'title,status\nTask 4,todo\nTask 6,review\n';
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/imports/upload?filename=upsert.csv',
      headers: { cookie, 'content-type': 'text/csv' },
      payload: upsertCsv,
    });
    const upsert = await app.inject({
      method: 'POST',
      url: '/api/v1/imports',
      headers: { cookie },
      payload: {
        fileId: (second.json().data as { fileId: string }).fileId,
        connectionId: one.mainId,
        table: 'main.tasks',
        mapping: { columns: ['title', 'status'].map((column) => ({ from: column, to: column })) },
        options: { mode: 'upsert', matchColumn: 'title', skipInvalid: true },
      },
    });
    expect(upsert.statusCode).toBe(201);
    const upsertId = (upsert.json().data as { import: { id: string } }).import.id;
    await app.inject({ method: 'POST', url: `/api/v1/imports/${upsertId}/run`, headers: { cookie } });
    await vi.waitFor(
      async () => {
        const view = await app.inject({ method: 'GET', url: `/api/v1/imports/${upsertId}`, headers: { cookie } });
        expect((view.json().data as { stats: unknown }).stats).toEqual({ total: 2, inserted: 0, updated: 1, skipped: 1 });
      },
      { timeout: 10_000, interval: 100 },
    );
    const upsertReport = await app.inject({ method: 'GET', url: `/api/v1/imports/${upsertId}/error-report`, headers: { cookie } });
    expect(upsertReport.body).toContain('Done tasks stay done.');
    expect(shopRows(one, "SELECT status, priority FROM tasks WHERE title IN ('Task 4', 'Task 6') ORDER BY id")).toEqual([
      { status: 'done', priority: 'low' },
      { status: 'review', priority: 'urgent' },
    ]);
    expect((globalThis as { __projectTasksUpdated?: string[] }).__projectTasksUpdated).toEqual(['Task 6:todo>review']);
  });

  it("record an after hook's failure without undoing the change", async () => {
    const { install: one, app, cookie } = await serve();
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/data/${one.mainId}/main.tasks/7?confirm=true`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(shopRows(one, 'SELECT id FROM tasks WHERE id = 7')).toEqual([]);
    const overview = await app.inject({ method: 'GET', url: '/api/v1/project/overview', headers: { cookie } });
    expect((overview.json().data as { hookFailures: unknown[] }).hookFailures).toEqual([
      expect.objectContaining({
        source: 'hooks/tasks.ts',
        event: 'afterDelete',
        database: 'main',
        table: 'main.tasks',
        message: 'after delete exploded',
      }),
    ]);
  });
});

describe('actions', () => {
  it('run on the selected records, as the person who clicked, and are audited', async () => {
    const { install: one, app, cookie } = await serve();
    const listed = await app.inject({ method: 'GET', url: '/api/v1/project/actions', headers: { cookie } });
    expect(listed.json().data).toEqual([
      expect.objectContaining({ id: 'explode', label: 'Explode', bulk: false, permission: 'read', table: 'main.orders' }),
      {
        id: 'refund-order',
        label: 'Refund',
        icon: 'undo-2',
        confirm: 'Refund this order?',
        bulk: true,
        permission: 'update',
        database: 'main',
        connectionId: one.mainId,
        table: 'main.orders',
      },
    ]);

    const run = await app.inject({
      method: 'POST',
      url: '/api/v1/project/actions/refund-order',
      headers: { cookie },
      payload: { database: 'main', table: 'main.orders', ids: ['5', '9'] },
    });
    expect(run.statusCode).toBe(200);
    expect(run.json().data).toEqual({ message: '2 order(s) refunded.', refresh: true });
    expect([orderStatus(one, 5), orderStatus(one, 9)]).toEqual(['refunded', 'refunded']);
    // The action's writes ran the orders hook, which wrote as the same person.
    expect(shopRows(one, "SELECT title FROM events WHERE title LIKE 'Refund%' ORDER BY id")).toEqual([
      { title: `Refund of order 5 (action, ${ADMIN_NAME})` },
      { title: `Refund of order 9 (action, ${ADMIN_NAME})` },
    ]);

    const stopped = await app.inject({
      method: 'POST',
      url: '/api/v1/project/actions/refund-order',
      headers: { cookie },
      payload: { database: 'main', table: 'orders', ids: [4] },
    });
    expect(stopped.statusCode).toBe(422);
    expect(errorOf(stopped.body).message).toBe('Order 4 is not paid yet.');

    const exploded = await app.inject({
      method: 'POST',
      url: '/api/v1/project/actions/explode',
      headers: { cookie },
      payload: { database: 'main', table: 'main.orders', ids: ['1'] },
    });
    expect(exploded.statusCode).toBe(500);
    expect(errorOf(exploded.body)).toMatchObject({
      code: 'ACTION_FAILED',
      message: 'The action "Explode" failed. The details are in the server log.',
      details: { action: 'explode' },
    });
    expect(exploded.body).not.toContain('boom');

    const outcomes = (await auditRepo(one.meta).list({ limit: 50 }))
      .filter((entry) => entry.action === 'project.action')
      .map((entry) => (entry.changes as { after: { action: string; outcome: string; ids: string[] } }).after);
    expect(outcomes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'refund-order', outcome: 'succeeded', ids: ['5', '9'] }),
        expect.objectContaining({ action: 'refund-order', outcome: 'rejected', ids: ['4'] }),
        expect.objectContaining({ action: 'explode', outcome: 'failed', ids: ['1'] }),
      ]),
    );
  });

  it('refuse what the request cannot ask for', async () => {
    const { app, cookie } = await serve();
    const post = (id: string, payload: Record<string, unknown>) =>
      app.inject({ method: 'POST', url: `/api/v1/project/actions/${id}`, headers: { cookie }, payload });
    expect((await post('missing', { database: 'main', table: 'orders', ids: [1] })).statusCode).toBe(404);
    expect((await post('explode', { database: 'main', table: 'tasks', ids: [1] })).statusCode).toBe(422);
    expect((await post('explode', { database: 'main', table: 'orders', ids: [1, 2] })).statusCode).toBe(422);
    expect((await post('explode', { database: 'main', table: 'orders', ids: [999] })).statusCode).toBe(404);
  });

  it('show and run only for people with the permission they ask for', async () => {
    const served = await serve();
    const cookie = await reader(served);
    const listed = await served.app.inject({ method: 'GET', url: '/api/v1/project/actions', headers: { cookie } });
    expect((listed.json().data as { id: string }[]).map((action) => action.id)).toEqual(['explode']);
    const refused = await served.app.inject({
      method: 'POST',
      url: '/api/v1/project/actions/refund-order',
      headers: { cookie },
      payload: { database: 'main', table: 'orders', ids: [5] },
    });
    expect(refused.statusCode).toBe(403);
    expect(orderStatus(served.install, 5)).toBe('paid');
  });
});

describe('where project code runs', () => {
  it('swaps in new code in dev without a restart', async () => {
    const { install: one, app, cookie } = await serve({ mode: 'dev' });
    writeBuild(
      one.dir,
      { 'hooks/orders': "export default { table: 'orders', beforeUpdate({ reject }) { reject('Orders are frozen.'); } };\n" },
      '.v2',
    );
    await vi.waitFor(
      async () => {
        const res = await app.inject({
          method: 'PATCH',
          url: `/api/v1/data/${one.mainId}/main.orders/1`,
          headers: { cookie },
          payload: { values: { status: 'pending' } },
        });
        expect(res.statusCode).toBe(422);
        expect(errorOf(res.body).message).toBe('Orders are frozen.');
      },
      { timeout: 5000, interval: 100 },
    );
    const listed = await app.inject({ method: 'GET', url: '/api/v1/project/actions', headers: { cookie } });
    expect(listed.json().data).toEqual([]);
  });

  it('never loads it on the desktop app', async () => {
    const { install: one, app, cookie } = await serve({ env: { ADMINIUM_RUNTIME: 'desktop' } });
    const overview = await app.inject({ method: 'GET', url: '/api/v1/project/overview', headers: { cookie } });
    expect(overview.json().data).toMatchObject({ codeEnabled: false, hooks: [], actions: [], problems: [] });
    const listed = await app.inject({ method: 'GET', url: '/api/v1/project/actions', headers: { cookie } });
    expect(listed.json().data).toEqual([]);
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/data/${one.mainId}/main.orders/3`,
      headers: { cookie },
      payload: { values: { status: 'paid' } },
    });
    expect(res.statusCode).toBe(200);
  });
});
