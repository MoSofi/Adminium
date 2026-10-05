// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN ADD-ON THAT KEEPS TABLES OF ITS OWN is installed the way an app is: in
 * one database, under its own prefix, its row written first and a record kept
 * per table — so an install that stops part way is finished by the same call,
 * and nothing it made is lost track of. The add-ons released before keep
 * today's order, and are recorded too.
 */
import { appTablesRepo, auditRepo, manifestsRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { LEGS } from './invoicing-install.helpers.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { ledgerKitFiles, ledgerKitManifest } from './fixtures/ledger-kit/index.js';

const CRYPTO = { encrypt: (v: string) => v, decrypt: (v: string) => v };
const KIT_TABLES = ['accounts', 'entries', 'holds', 'postings', 'requests', 'settings'];

let h: Harness | null = null;
afterEach(async () => {
  await h?.close();
  h = null;
});

/** The kit staged, with nothing refused for a word this server does not run yet: these tests are of the install's own steps. */
async function withKit(dialect: (typeof LEGS)[number][0]): Promise<Harness> {
  const harness = await addOnHarness(dialect, { unbuiltWords: {} });
  await harness.stageAddOn(ledgerKitManifest(), { files: ledgerKitFiles() });
  return harness;
}
const install = (harness: Harness, extra: Record<string, unknown> = {}) => harness.inject({ method: 'POST', url: '/add-ons', payload: { key: 'ledger-kit', version: '1.0.0', attachTo: [], ...extra } });

describe.each(LEGS)('an add-on with tables of its own — %s', (dialect, available) => {
  it.runIf(available)('makes its tables under its own prefix, with no app, and says where', async () => {
    h = await withKit(dialect);
    const reply = await install(h);
    expect(reply.statusCode, reply.body).toBe(200);
    const body = reply.json();
    expect(body.connectionId).toBe(h.connectionId);
    expect([...body.schema.created].sort()).toEqual(KIT_TABLES);
    expect(body.schema.reused).toEqual([]);
    expect(body.addOn.key).toBe('ledger-kit');
    const names = await h.tableNames();
    for (const ref of KIT_TABLES) expect(names, ref).toContain(`ledger_kit_${ref}`);
    // Nothing under a plain name.
    expect(names.filter((name) => KIT_TABLES.includes(name))).toEqual([]);
  });

  it.runIf(available)('stores its connection and one record per table', async () => {
    h = await withKit(dialect);
    expect((await install(h)).statusCode).toBe(200);
    const row = await manifestsRepo(h.meta, CRYPTO).findByKey('ledger-kit');
    expect(row?.row).toMatchObject({ kind: 'add-on', status: 'installed', connectionId: h.connectionId, version: '1.0.0' });
    const records = await appTablesRepo(h.meta).forInstall(h.connectionId, 'ledger-kit');
    expect(records.map((record) => record.ref).sort()).toEqual(KIT_TABLES);
    for (const record of records) {
      expect(record, record.ref).toMatchObject({ tableName: `ledger_kit_${record.ref}`, owned: true, state: 'created', prefix: 'ledger_kit_', manifestId: row!.row.id });
    }
    const audit = (await auditRepo(h.meta).list({ limit: 20 })).filter((entry) => entry.action === 'add-on.installed');
    expect(audit).toHaveLength(1);
    expect(audit[0]!.changes).toMatchObject({ after: { key: 'ledger-kit', connectionId: h.connectionId } });
  });
});

describe.each(LEGS.filter(([dialect]) => dialect !== 'postgres'))('an install that stops after the row — %s', (dialect, available) => {
  it.runIf(available)('is finished by the same call: nothing made twice, nothing lost', async () => {
    h = await withKit(dialect);
    h.failNextTables();
    const stopped = await install(h);
    expect(stopped.statusCode, stopped.body).toBe(409);
    expect(stopped.json()).toMatchObject({ error: { code: 'ADD_ON_INSTALL_INCOMPLETE', details: { addOn: 'ledger-kit', stage: 'tables', cause: { message: 'The disk is full.' } } } });
    // The row was written FIRST, so what was started is on record.
    const manifests = manifestsRepo(h.meta, CRYPTO);
    expect((await manifests.findByKey('ledger-kit'))?.row).toMatchObject({ status: 'installing', connectionId: h.connectionId });
    const failed = (await auditRepo(h.meta).list({ limit: 20 })).filter((entry) => entry.action === 'add-on.install-failed');
    expect(failed).toHaveLength(1);
    // Its code is not loaded while it is half installed.
    const before = h.rebuilds();

    const finished = await install(h);
    expect(finished.statusCode, finished.body).toBe(200);
    expect((await manifests.findByKey('ledger-kit'))?.row.status).toBe('installed');
    const records = await appTablesRepo(h.meta).forInstall(h.connectionId, 'ledger-kit');
    expect(records.map((record) => record.ref).sort()).toEqual(KIT_TABLES);
    expect(records.every((record) => record.state === 'created' && record.owned)).toBe(true);
    expect((await manifests.list('add-on')).filter((entry) => entry.row.manifestKey === 'ledger-kit')).toHaveLength(1);
    expect(h.rebuilds()).toBeGreaterThan(before);
    // A third call finds it installed.
    expect((await install(h)).statusCode).toBe(409);
  });

  it.runIf(available)('is not finished in another database, or as another version', async () => {
    h = await withKit(dialect);
    const other = await h.addConnection('Second');
    h.failNextTables();
    expect((await install(h, { connectionId: h.connectionId })).statusCode).toBe(409);
    const elsewhere = await install(h, { connectionId: other });
    expect(elsewhere.statusCode, elsewhere.body).toBe(409);
    expect(elsewhere.body).toContain('was started in another database');
    expect((await install(h, { connectionId: h.connectionId })).statusCode).toBe(200);
  });
});

describe('the add-ons released before', () => {
  const PLAIN = {
    kind: 'add-on',
    manifestVersion: 1,
    key: 'shipping',
    name: 'Shipping',
    version: '1.0.7',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'MIT',
    description: { key: 'd', fallback: 'd' },
    categories: ['delivery'],
    compatibility: { minAdminiumVersion: '0.3.1' },
    addOn: { attaches: [{ app: '*', range: '*' }], connect: { kind: 'none' } },
    requiredSchema: { tables: [{ ref: 'shipments', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'label', type: 'text', maxLength: 80 }] }, { ref: 'parcels', columns: [{ ref: 'id', type: 'int', role: 'pk' }] }] },
  };

  it('install in today\'s order, under their plain names, and are recorded', async () => {
    // The server's own word list: a released add-on uses none of the newer words.
    h = await addOnHarness('sqlite');
    await h.rows('CREATE TABLE parcels (id INTEGER PRIMARY KEY)');
    await h.introspect();
    await h.stageAddOn(PLAIN);
    const reply = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'shipping', version: '1.0.7', attachTo: [] } });
    expect(reply.statusCode, reply.body).toBe(200);
    expect({ connectionId: reply.json().connectionId, schema: reply.json().schema }).toEqual({ connectionId: h.connectionId, schema: { created: ['shipments'], reused: ['parcels'] } });
    expect(await h.tableNames()).toEqual(expect.arrayContaining(['parcels', 'shipments']));
    const row = await manifestsRepo(h.meta, CRYPTO).findByKey('shipping');
    expect(row?.row).toMatchObject({ status: 'installed', connectionId: h.connectionId });
    const records = await appTablesRepo(h.meta).forInstall(h.connectionId, 'shipping');
    expect(records.map((record) => [record.ref, record.tableName, record.owned, record.state, record.prefix]).sort()).toEqual([
      ['parcels', 'parcels', false, 'adopted', null],
      ['shipments', 'shipments', true, 'created', null],
    ]);
  });

  it('with no tables at all are asked nothing and record none', async () => {
    h = await addOnHarness('sqlite');
    await h.addConnection('Second');
    const { requiredSchema: _tables, ...bare } = PLAIN;
    await h.stageAddOn({ ...bare, key: 'labels' });
    const reply = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'labels', version: '1.0.7', attachTo: [] } });
    expect(reply.statusCode, reply.body).toBe(200);
    expect(reply.json().connectionId).toBeNull();
    expect((await manifestsRepo(h.meta, CRYPTO).findByKey('labels'))?.row.connectionId).toBeNull();
  });
});
