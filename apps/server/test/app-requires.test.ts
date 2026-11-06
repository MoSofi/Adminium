// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A SELF-MADE APP THAT REQUIRES ANOTHER APP (`apps.requires`), AND `instance`.
 *
 * A dashboard saved over a catalogue app's tables never carries that app: it
 * requires it, by publisher and key, on the same database. The plan refuses
 * when the app is installed only on another database, is another publisher's
 * (a self-made file keyed `point-of-sale` is not Point of Sale), or runs a
 * version outside the range. Installed, the dependent makes none of the
 * required app's tables: it records its use of them as shared, so the
 * required app's uninstall never drops them (it is refused outright while the
 * dependent is there, and even past that refusal its drop keeps them), and
 * the dependent's own uninstall only lets them go.
 *
 * `instance` is planned and refused at install until applying it is built.
 *
 * SQLite always runs; Postgres runs with TEST_POSTGRES_URL, MySQL with
 * TEST_MYSQL_URL (`./app-install-harness.ts`).
 */
import { BUILTIN_EMAIL_TEMPLATE_KEYS } from '../src/email/builtins.js';
import { INSTANCE_SETTING_KEYS, INSTANCE_SYSTEM_EMAIL_KEYS } from '@adminium/manifest';
import { SETTINGS_REGISTRY, appTablesRepo, manifestsRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { createAppInstallService } from '../src/apps/install-service.js';
import { ENGINES, installHarness, type Dialect, type Harness } from './app-install-harness.js';

type Doc = Record<string, unknown>;
const PLAIN = { encrypt: (v: string) => v, decrypt: (v: string) => v };
const id = { ref: 'id', type: 'int', role: 'pk' };

/** A catalogue till: orders and their lines. */
function pos(version = '1.2.0', publisher = { id: 'adminium', name: 'Adminium' }): Doc {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'point-of-sale',
    name: 'Point of Sale',
    version,
    publisher,
    license: 'AGPL-3.0-only',
    description: { key: 'd', fallback: 'A till.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: '0.1.0' },
    requiredSchema: {
      tables: [
        { ref: 'orders', columns: [id, { ref: 'total', type: 'decimal', scale: 2, nullable: true }, { ref: 'till', type: 'text', maxLength: 20, nullable: true }] },
        { ref: 'order_lines', columns: [id, { ref: 'order_id', type: 'fk', references: 'orders', nullable: true }, { ref: 'qty', type: 'int', nullable: true }] },
      ],
    },
    pages: [{ ref: 'pos-orders', template: 'page-crud', title: { key: 'o', fallback: 'Orders' }, nav: { group: 'records', icon: 'list', order: 1 }, bindings: { rows: 'orders' } }],
    frontends: [{ side: 'staff', kind: 'spa' }],
  };
}

/** A desk made here over the till's orders, with notes of its own. */
function desk(over: Doc = {}): Doc {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'shop-desk',
    name: 'Shop desk',
    version: '1.0.0',
    publisher: { id: 'local', name: 'Made here' },
    license: 'AGPL-3.0-only',
    description: { key: 'd', fallback: 'A desk over the till.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: '0.3.49' },
    requiredSchema: {
      tables: [
        { ref: 'orders', columns: [id, { ref: 'total', type: 'decimal', scale: 2, nullable: true }] },
        { ref: 'desk_notes', columns: [id, { ref: 'order_id', type: 'fk', references: 'orders', nullable: true }, { ref: 'body', type: 'text', nullable: true }] },
      ],
    },
    pages: [{ ref: 'desk-notes', template: 'page-crud', title: { key: 'n', fallback: 'Notes' }, nav: { group: 'records', icon: 'list', order: 2 }, bindings: { rows: 'desk_notes' } }],
    frontends: [{ side: 'staff', kind: 'spa' }],
    apps: { requires: [{ publisher: 'adminium', key: 'point-of-sale', range: '>=1.2.0', tables: ['orders'] }] },
    ...over,
  };
}

let harness: Harness | null = null;
afterEach(async () => {
  await harness?.close();
  harness = null;
});

/** The tables of the database, by name. */
async function tablesOf(h: Harness, dialect: Dialect): Promise<string[]> {
  const rows =
    dialect === 'sqlite'
      ? await h.rows(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
      : await h.rows(`SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ${dialect === 'postgres' ? 'current_schema()' : 'DATABASE()'}`);
  return rows.map((row) => String(row['name'] ?? row['NAME'])).sort();
}

async function planProblems(h: Harness, connectionId = h.connectionId): Promise<{ code: string; message: string }[]> {
  const plan = await h.inject({ method: 'POST', url: '/apps/plan', payload: { key: 'shop-desk', version: '1.0.0', connectionId } });
  expect(plan.statusCode, plan.body).toBe(200);
  return (JSON.parse(plan.body) as { plan: { problems: { code: string; message: string }[] } }).plan.problems;
}

async function refusedInstall(h: Harness, code: string): Promise<void> {
  const install = await h.inject({ method: 'POST', url: '/apps/install', payload: { key: 'shop-desk', version: '1.0.0', connectionId: h.connectionId } });
  expect(install.statusCode, install.body).toBe(422);
  const body = JSON.parse(install.body) as { error: { details: { reason: string; problems: { code: string }[] } } };
  expect(body.error.details.reason).toBe('PLAN_REFUSED');
  expect(body.error.details.problems.map((problem) => problem.code)).toContain(code);
  expect(await (await manifestsRepo(h.meta, PLAIN).list('app')).filter((one) => one.row.manifestKey === 'shop-desk' && one.row.connectionId === h.connectionId)).toEqual([]);
}

describe.each(ENGINES)('an app that requires another, on %s', (dialect, available) => {
  it.skipIf(!available)('is refused while the app it needs is on another database, another publisher\'s, or outside the range', async () => {
    harness = await installHarness(dialect);
    const h = harness;

    // Installed on another database only: no use to this one.
    const other = await h.otherConnection();
    await h.stage(pos());
    const elsewhere = await h.inject({ method: 'POST', url: '/apps/install', payload: { key: 'point-of-sale', version: '1.2.0', connectionId: other.id } });
    expect(elsewhere.statusCode, elsewhere.body).toBe(200);
    await h.stage(desk());
    const missing = await planProblems(h);
    expect(missing.map((problem) => problem.code)).toContain('REQUIRED_APP_MISSING');
    expect(missing.find((problem) => problem.code === 'REQUIRED_APP_MISSING')?.message).toContain('installed on another database');
    await refusedInstall(h, 'REQUIRED_APP_MISSING');
    // On the database that has it, the same file plans clean.
    expect(await planProblems(h, other.id)).toEqual([]);
  });

  it.skipIf(!available)('is refused when the app of that key is somebody else\'s, or too old', async () => {
    harness = await installHarness(dialect);
    const h = harness;
    // A self-made file keyed like the till: never the till.
    expect((await h.install(pos('1.2.0', { id: 'local', name: 'Made here' }))).statusCode).toBe(200);
    await h.stage(desk());
    // Its orders are then simply another app's table of that name, which this app may not take.
    expect((await planProblems(h)).map((problem) => problem.code)).toContain('REQUIRED_APP_PUBLISHER');
    await refusedInstall(h, 'REQUIRED_APP_PUBLISHER');
    // And the till itself, at a version the range leaves out.
    const old = desk({ apps: { requires: [{ publisher: 'adminium', key: 'point-of-sale', range: '>=1.3.0', tables: ['orders'] }] } });
    await h.close();
    harness = await installHarness(dialect);
    const g = harness;
    expect((await g.install(pos('1.2.0'))).statusCode).toBe(200);
    await g.stage(old);
    const problems = await planProblems(g);
    expect(problems.map((problem) => problem.code)).toEqual(['REQUIRED_APP_VERSION']);
    expect(problems[0]!.message).toContain('this database has 1.2.0');
    await refusedInstall(g, 'REQUIRED_APP_VERSION');
  });

  it.skipIf(!available)('installs on the app it needs, shares its tables, and keeps them through either uninstall', async () => {
    harness = await installHarness(dialect, { superAdmin: true });
    const h = harness;
    expect((await h.install(pos())).statusCode).toBe(200);
    await h.run(`INSERT INTO orders (total, till) VALUES (12.5, 'front')`);
    const installed = await h.install(desk());
    expect(installed.statusCode, installed.body).toBe(200);
    expect(await tablesOf(h, dialect)).toEqual(['desk_notes', 'order_lines', 'orders']);

    // The desk's use of the till's orders: shared, never its own; its notes are its own.
    const records = await appTablesRepo(h.meta).forConnection(h.connectionId);
    const deskOrders = records.find((record) => record.appKey === 'shop-desk' && record.ref === 'orders');
    expect(deskOrders).toMatchObject({ tableName: 'orders', state: 'shared', owned: false });
    expect(records.find((record) => record.appKey === 'shop-desk' && record.ref === 'desk_notes')).toMatchObject({ state: 'created', owned: true });
    expect(records.find((record) => record.appKey === 'point-of-sale' && record.ref === 'orders')).toMatchObject({ state: 'created', owned: true });

    // An update of the desk goes on sharing them: never taken for its own.
    await h.stage(desk({ version: '1.1.0' }));
    const updated = await h.inject({ method: 'POST', url: '/apps/shop-desk/update', payload: {} });
    expect(updated.statusCode, updated.body).toBe(200);
    expect((await appTablesRepo(h.meta).forConnection(h.connectionId)).find((record) => record.appKey === 'shop-desk' && record.ref === 'orders')).toMatchObject({ tableName: 'orders', state: 'shared', owned: false });

    // The till's uninstall plan says who needs it, and that its orders are shared; the uninstall is refused.
    const plan = await h.inject({ method: 'GET', url: '/apps/point-of-sale/uninstall-plan' });
    expect(plan.statusCode, plan.body).toBe(200);
    const planned = JSON.parse(plan.body) as { requiredBy?: { key: string }[]; tables: { table: string; droppable: boolean; sharedWith?: { key: string }[] }[] };
    expect(planned.requiredBy).toEqual([{ key: 'shop-desk', name: 'Shop desk' }]);
    expect(planned.tables.find((table) => table.table === 'orders')).toMatchObject({ droppable: false, sharedWith: [{ key: 'shop-desk' }] });
    expect(planned.tables.find((table) => table.table === 'order_lines')).toMatchObject({ droppable: true });
    const refused = await h.inject({ method: 'DELETE', url: '/apps/point-of-sale', payload: { dropTables: true, confirmKey: 'point-of-sale' } });
    expect(refused.statusCode, refused.body).toBe(409);
    expect(JSON.parse(refused.body)).toMatchObject({ error: { code: 'APP_REQUIRED_BY', details: { apps: [{ key: 'shop-desk' }] } } });
    expect(await tablesOf(h, dialect)).toEqual(['desk_notes', 'order_lines', 'orders']);

    // Past that refusal (the steps run straight), the till's drop still keeps the orders the desk uses.
    const service = createAppInstallService(h.deps);
    const till = (await manifestsRepo(h.meta, PLAIN).findInScope('point-of-sale', h.connectionId))!;
    const list = await service.removals.listOf(till);
    const done = await service.removals.remove(list, { dropTables: true, superAdmin: true, createdBy: null });
    expect(done.dropped).toEqual(['order_lines']);
    expect(await tablesOf(h, dialect)).toEqual(['desk_notes', 'orders']);
    expect(await h.rows('SELECT till FROM orders')).toEqual([{ till: 'front' }]);

    // The desk's own uninstall, dropping its tables: its notes go, the orders it only used stay.
    const gone = await h.inject({ method: 'DELETE', url: '/apps/shop-desk', payload: { dropTables: true, confirmKey: 'shop-desk' } });
    expect(gone.statusCode, gone.body).toBe(200);
    expect(await tablesOf(h, dialect)).toEqual(['orders']);
    const after = await appTablesRepo(h.meta).forConnection(h.connectionId);
    expect(after.find((record) => record.appKey === 'shop-desk' && record.ref === 'orders')).toMatchObject({ state: 'released', owned: false });
  });

  it.skipIf(!available)('plans an instance part, and refuses to install it until applying it is built', async () => {
    harness = await installHarness(dialect);
    const h = harness;
    const m = desk({ apps: undefined, requiredSchema: { tables: [{ ref: 'desk_notes', columns: [id, { ref: 'body', type: 'text', nullable: true }] }] }, instance: { branding: { appName: 'Fernhill' }, settings: { 'assistant.name': 'Fern' } } });
    await h.stage(m);
    expect(await planProblems(h)).toEqual([]);
    const install = await h.inject({ method: 'POST', url: '/apps/install', payload: { key: 'shop-desk', version: '1.0.0', connectionId: h.connectionId } });
    expect(install.statusCode, install.body).toBe(422);
    expect(JSON.parse(install.body)).toMatchObject({ error: { details: { reason: 'INSTALL_PATH_NOT_BUILT', words: [{ word: 'instance', path: 'instance' }] } } });
    expect(await tablesOf(h, dialect)).toEqual([]);
  });
});

describe('what an instance part may name', () => {
  it('every system email Adminium sends, and nothing else', () => {
    expect([...INSTANCE_SYSTEM_EMAIL_KEYS].sort()).toEqual([...BUILTIN_EMAIL_TEMPLATE_KEYS].sort());
  });

  it('settings that are there, portable, and never secret', () => {
    for (const key of INSTANCE_SETTING_KEYS) {
      const setting = (SETTINGS_REGISTRY as Record<string, { secret?: boolean; portable?: boolean } | undefined>)[key];
      expect(setting, key).toBeDefined();
      expect(setting?.secret === true, key).toBe(false);
      expect(setting?.portable, key).toBe(true);
    }
  });
});
