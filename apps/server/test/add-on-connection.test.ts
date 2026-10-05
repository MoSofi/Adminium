// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHICH DATABASE AN ADD-ON'S TABLES GO IN, and what an install would make
 * there before anything is written. Never a guess: where there is a choice
 * the answer is the list to choose from, and a plan that the database has
 * moved away from is said, not built on.
 */
import { appTablesRepo, manifestsRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { LEGS } from './invoicing-install.helpers.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { ledgerKitFiles, ledgerKitManifest } from './fixtures/ledger-kit/index.js';

const CRYPTO = { encrypt: (v: string) => v, decrypt: (v: string) => v };

/** A small app, to be a host with a database of its own. */
const SHOP = {
  kind: 'app',
  manifestVersion: 1,
  key: 'shop',
  name: 'Shop',
  version: '0.3.0',
  publisher: { id: 'adminium', name: 'Adminium' },
  license: 'MIT',
  description: { key: 'd', fallback: 'd' },
  categories: ['commerce'],
  compatibility: { minAdminiumVersion: '0.3.1' },
  pages: [{ ref: 'sales', template: 'page-crud', title: { key: 't', fallback: 'Sales' }, nav: { group: 'manage', icon: 'list', order: 1 }, bindings: { main: 'sales' } }],
  frontends: [{ side: 'staff', kind: 'none' }],
  requiredSchema: { tables: [{ ref: 'sales', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'total', type: 'decimal', scale: 2, default: 0 }] }] },
};

let h: Harness | null = null;
afterEach(async () => {
  await h?.close();
  h = null;
});

async function withKit(dialect: (typeof LEGS)[number][0] = 'sqlite'): Promise<Harness> {
  const harness = await addOnHarness(dialect, { unbuiltWords: {} });
  await harness.stageAddOn(ledgerKitManifest(), { files: ledgerKitFiles() });
  return harness;
}
const install = (harness: Harness, extra: Record<string, unknown> = {}) => harness.inject({ method: 'POST', url: '/add-ons', payload: { key: 'ledger-kit', version: '1.0.0', attachTo: [], ...extra } });
const plan = (harness: Harness, extra: Record<string, unknown> = {}) => harness.inject({ method: 'POST', url: '/add-ons/plan', payload: { key: 'ledger-kit', ...extra } });

describe('where an add-on\'s tables go', () => {
  it('two databases and none named: the answer is the list, and nothing is made', async () => {
    h = await withKit();
    const second = await h.addConnection('Second');
    for (const reply of [await plan(h), await install(h)]) {
      expect(reply.statusCode, reply.body).toBe(409);
      expect(reply.json()).toMatchObject({ error: { code: 'ADD_ON_SCHEMA_CONNECTION', details: { connections: [{ id: h.connectionId, name: 'Studio' }, { id: second, name: 'Second' }] } } });
    }
    expect(await manifestsRepo(h.meta, CRYPTO).findByKey('ledger-kit')).toBeNull();
    expect((await h.tableNames()).filter((name) => name.startsWith('ledger_kit_'))).toEqual([]);
  });

  it('the one named is the one used', async () => {
    h = await withKit();
    const second = await h.addConnection('Second');
    const reply = await install(h, { connectionId: second });
    expect(reply.statusCode, reply.body).toBe(200);
    expect(reply.json().connectionId).toBe(second);
    expect((await manifestsRepo(h.meta, CRYPTO).findByKey('ledger-kit'))?.row.connectionId).toBe(second);
    expect(await appTablesRepo(h.meta).forInstall(second, 'ledger-kit')).toHaveLength(6);
    expect(await appTablesRepo(h.meta).forInstall(h.connectionId, 'ledger-kit')).toEqual([]);
    // Not in the first database.
    expect((await h.tableNames()).filter((name) => name.startsWith('ledger_kit_'))).toEqual([]);
  });

  it('a database that is not connected here is refused by name', async () => {
    h = await withKit();
    const reply = await install(h, { connectionId: 'conn_nowhere' });
    expect(reply.statusCode, reply.body).toBe(422);
    expect(reply.json().error.details).toMatchObject({ code: 'ADD_ON_NO_CONNECTION', connectionId: 'conn_nowhere' });
  });

  it('attached to an app, it goes where the app is, unasked — and nowhere else', async () => {
    h = await withKit();
    const second = await h.addConnection('Second');
    await h.stageApp(SHOP);
    expect((await h.install('shop', '0.3.0')).statusCode).toBe(200);
    const elsewhere = await install(h, { attachTo: ['shop'], connectionId: second });
    expect(elsewhere.statusCode, elsewhere.body).toBe(422);
    expect(elsewhere.json().error.details).toMatchObject({ code: 'ADD_ON_OTHER_DATABASE', connectionId: second, connections: [{ id: h.connectionId, name: 'Studio' }] });
    expect(await manifestsRepo(h.meta, CRYPTO).findByKey('ledger-kit')).toBeNull();
    // Two databases, and still no question: the app's is the answer.
    const reply = await install(h, { attachTo: ['shop'] });
    expect(reply.statusCode, reply.body).toBe(200);
    expect(reply.json().connectionId).toBe(h.connectionId);
  });
});

describe('an add-on already installed', () => {
  it('asked about for another database, the plan says where it is and that it stays there', async () => {
    h = await withKit();
    const second = await h.addConnection('Second');
    expect((await install(h, { connectionId: h.connectionId })).statusCode).toBe(200);
    const reply = await plan(h, { connectionId: second });
    expect(reply.statusCode, reply.body).toBe(200);
    expect(reply.json().plan.installable).toBe(false);
    const problem = reply.json().plan.problems.find((candidate: { code: string }) => candidate.code === 'APP_INSTALLED_ELSEWHERE');
    expect(problem.message).toBe('"Ledger kit" already keeps its tables on the connection "Studio". An add-on keeps them in one database: update it there, or uninstall it there before installing it on another.');
    // Asked about where it is, there is no such problem.
    const here = await plan(h, { connectionId: h.connectionId });
    expect(here.json().plan.problems.filter((candidate: { code: string }) => candidate.code === 'APP_INSTALLED_ELSEWHERE')).toEqual([]);
  });
});

describe.each(LEGS)('what an install would make — %s', (dialect, available) => {
  it.runIf(available)('is listed with its database and its identity, and nothing is written', async () => {
    h = await withKit(dialect);
    const reply = await plan(h);
    expect(reply.statusCode, reply.body).toBe(200);
    const body = reply.json();
    expect(body.connectionId).toBe(h.connectionId);
    expect(body.checksum).toMatch(/^[0-9a-f]{16,}$/);
    expect(body.plan).toMatchObject({ addOnKey: 'ledger-kit', version: '1.0.0', installable: true, requiresSchemaChange: true, reuse: [] });
    expect(body.plan.create.map((table: { ref: string }) => table.ref).sort()).toEqual(['accounts', 'entries', 'holds', 'postings', 'requests', 'settings']);
    expect(await manifestsRepo(h.meta, CRYPTO).findByKey('ledger-kit')).toBeNull();
    expect(await appTablesRepo(h.meta).forConnection(h.connectionId)).toEqual([]);
    expect((await h.tableNames()).filter((name) => name.startsWith('ledger_kit_'))).toEqual([]);
    // The same question twice has one answer.
    expect((await plan(h)).json().checksum).toBe(body.checksum);
    // The old route still answers, for the newest staged version.
    const old = await h.inject({ method: 'GET', url: '/add-ons/ledger-kit/plan' });
    expect(old.statusCode, old.body).toBe(200);
    expect(old.json().checksum).toBe(body.checksum);
  });

  it.runIf(available)('an install refuses a plan the database has moved away from, and takes the one that still holds', async () => {
    h = await withKit(dialect);
    const { checksum } = (await plan(h)).json();
    const moved = await install(h, { planChecksum: 'not-the-plan-you-saw' });
    expect(moved.statusCode, moved.body).toBe(409);
    expect(moved.json().error.code).toBe('SCHEMA_DRIFT');
    expect(await manifestsRepo(h.meta, CRYPTO).findByKey('ledger-kit')).toBeNull();
    const held = await install(h, { planChecksum: checksum });
    expect(held.statusCode, held.body).toBe(200);
  });

  it.runIf(available)('a table of its name that the owner already keeps is a problem said in the plan, never renamed or taken', async () => {
    h = await withKit(dialect);
    await h.rows('CREATE TABLE ledger_kit_accounts (id INTEGER PRIMARY KEY, owner_note VARCHAR(40))');
    await h.rows(`INSERT INTO ledger_kit_accounts (id, owner_note) VALUES (1, 'mine')`);
    await h.introspect();
    const reply = await plan(h);
    expect(reply.statusCode, reply.body).toBe(200);
    const body = reply.json();
    expect(body.plan.installable).toBe(false);
    expect(body.plan.problems.map((problem: { table: string }) => problem.table)).toContain('accounts');
    const refused = await install(h);
    expect(refused.statusCode, refused.body).toBe(422);
    expect(await manifestsRepo(h.meta, CRYPTO).findByKey('ledger-kit')).toBeNull();
    // The owner's table and row are as they were; nothing of the add-on's was made beside it.
    expect(await h.rows('SELECT owner_note FROM ledger_kit_accounts')).toEqual([{ owner_note: 'mine' }]);
    expect((await h.tableNames()).filter((name) => name.startsWith('ledger_kit_'))).toEqual(['ledger_kit_accounts']);
  });
});
