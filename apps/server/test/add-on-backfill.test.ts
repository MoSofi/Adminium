// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN ADD-ON INSTALLED BEFORE ITS TABLES WERE RECORDED. The add-ons released
 * earlier made their tables and wrote down neither the database nor the
 * tables. The first update, or the first time one is connected to an app,
 * finds out where it lives by looking: one database holds its tables — it is
 * recorded, each table as found and taken, never as made; several — the
 * person is asked; none — nothing is recorded. No table is renamed, no row
 * is lost.
 */
import { appTablesRepo, auditRepo, manifestsRepo } from '@adminium/meta';
import { sql, type Kysely } from 'kysely';
import { afterEach, describe, expect, it } from 'vitest';

import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { LEGS } from './invoicing-install.helpers.js';

const CRYPTO = { encrypt: (v: string) => v, decrypt: (v: string) => v };
let h: Harness | null = null;
afterEach(async () => {
  await h?.close();
  h = null;
});

/** An add-on as the released table owners are: plain table names, the floor of its day, nothing declared beside them. */
const carrier = (version: string): Record<string, unknown> => ({
  kind: 'add-on',
  manifestVersion: 1,
  key: 'carrier',
  name: 'Carrier',
  version,
  publisher: { id: 'adminium', name: 'Adminium' },
  license: 'MIT',
  description: { key: 'carrier.line', fallback: 'Ships.' },
  categories: ['data'],
  compatibility: { minAdminiumVersion: '0.3.1' },
  addOn: { attaches: [{ app: '*', range: '*' }], connect: { kind: 'none' }, hostApi: 1 },
  requiredSchema: { tables: [{ ref: 'shipments', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'label', type: 'text', maxLength: 80, nullable: true }] }, { ref: 'shipment_events', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'shipment_id', type: 'fk', references: 'shipments' }] }] },
});
const post = (harness: Harness, url: string, payload: Record<string, unknown> = {}) => harness.inject({ method: 'POST', url, payload });
const db = async (harness: Harness, connectionId = harness.connectionId) => (await harness.manager.data(connectionId)).db as unknown as Kysely<unknown>;
const row = async (harness: Harness) => (await manifestsRepo(harness.meta, CRYPTO).findByKey('carrier'))!.row;

describe.each(LEGS)('an add-on installed before its tables were recorded — %s', (dialect, available) => {
  /** 1.0.0 installed with a shipment in it, then made as an earlier server left it: no database on its row, no table record. 1.0.1 is staged. */
  async function before(): Promise<Harness> {
    const harness = await addOnHarness(dialect);
    await harness.stageAddOn(carrier('1.0.0'));
    expect((await post(harness, '/add-ons', { key: 'carrier', version: '1.0.0', attachTo: [] })).statusCode).toBe(200);
    await sql`insert into shipments (id, label) values (1, 'First')`.execute(await db(harness));
    await harness.meta.db.updateTable('adminium_manifests').set({ connectionId: null }).where('manifestKey', '=', 'carrier').execute();
    await harness.meta.db.deleteFrom('adminium_app_tables').where('appKey', '=', 'carrier').execute();
    await harness.stageAddOn(carrier('1.0.1'));
    return harness;
  }
  const recorded = async (harness: Harness) => (await appTablesRepo(harness.meta).forConnection(harness.connectionId)).filter((record) => record.appKey === 'carrier');

  it.runIf(available)('updated: its database is recorded, its tables as found and taken, and nothing is renamed or lost', async () => {
    h = await before();
    const names = (await h.tableNames()).sort();
    const reply = await post(h, '/add-ons/carrier/update');
    expect(reply.statusCode, reply.body).toBe(200);
    expect(await row(h)).toMatchObject({ version: '1.0.1', connectionId: h.connectionId, status: 'installed' });
    const records = await recorded(h);
    expect(records.map((record) => record.ref).sort()).toEqual(['shipment_events', 'shipments']);
    // Found and taken, never made: nothing will ever offer to drop them.
    for (const record of records) expect(record, record.ref).toMatchObject({ tableName: record.ref, owned: false, state: 'adopted', prefix: null });
    expect((await h.tableNames()).sort()).toEqual(names);
    expect((await h.rows('SELECT label FROM shipments')).map((shipment) => shipment['label'])).toEqual(['First']);
    const audit = (await auditRepo(h.meta).list({ limit: 30 })).filter((entry) => entry.action === 'add-on.connection-recorded');
    expect(audit).toHaveLength(1);
    // Asked a second time, it is already known: nothing is recorded twice.
    await h.stageAddOn(carrier('1.0.2'));
    expect((await post(h, '/add-ons/carrier/update')).statusCode).toBe(200);
    expect(await recorded(h)).toHaveLength(2);
    expect((await auditRepo(h.meta).list({ limit: 30 })).filter((entry) => entry.action === 'add-on.connection-recorded')).toHaveLength(1);
  });

  it.runIf(available)('two databases hold its tables: it stops and asks, and the one named is the one recorded', async () => {
    h = await before();
    const second = await h.addConnection('Archive');
    const other = await db(h, second);
    await sql.raw('CREATE TABLE IF NOT EXISTS shipments (id INT PRIMARY KEY, label VARCHAR(80))').execute(other);
    await sql.raw('CREATE TABLE IF NOT EXISTS shipment_events (id INT PRIMARY KEY, shipment_id INT)').execute(other);
    const asked = await post(h, '/add-ons/carrier/update');
    expect(asked.statusCode, asked.body).toBe(409);
    expect(asked.json().error.code).toBe('ADD_ON_SCHEMA_CONNECTION');
    expect(asked.json().error.details.connections.map((connection: { id: string }) => connection.id).sort()).toEqual([h.connectionId, second].sort());
    // Nothing moved, nothing was written down.
    expect(await row(h)).toMatchObject({ version: '1.0.0', connectionId: null });
    expect(await recorded(h)).toEqual([]);
    const answered = await post(h, '/add-ons/carrier/update', { connectionId: h.connectionId });
    expect(answered.statusCode, answered.body).toBe(200);
    expect(await row(h)).toMatchObject({ version: '1.0.1', connectionId: h.connectionId });
    expect(await recorded(h)).toHaveLength(2);
  });

  // On SQLite a second connection is a second file; on the others the harness connects the same database twice.
  it.runIf(available && dialect === 'sqlite')('a database that holds only some of its tables is not where it lives', async () => {
    h = await before();
    const second = await h.addConnection('Archive');
    await sql.raw('CREATE TABLE IF NOT EXISTS shipments (id INT PRIMARY KEY, label VARCHAR(80))').execute(await db(h, second));
    // Only the first database has both: nobody is asked.
    expect((await post(h, '/add-ons/carrier/update')).statusCode).toBe(200);
    expect((await row(h)).connectionId).toBe(h.connectionId);
  });

  it.runIf(available)('connected to the dashboard for the first time, it is found out then too', async () => {
    h = await before();
    await h.meta.db.deleteFrom('adminium_manifest_attachments').execute();
    const reply = await post(h, '/add-ons/carrier/attachments', { app: 'dashboard' });
    expect(reply.statusCode, reply.body).toBe(200);
    expect((await row(h)).connectionId).toBe(h.connectionId);
    expect((await recorded(h)).every((record) => record.state === 'adopted' && !record.owned)).toBe(true);
    expect(await recorded(h)).toHaveLength(2);
  });

  it.runIf(available)('no database holds them: nothing is recorded', async () => {
    h = await before();
    const source = await db(h);
    await sql.raw('DROP TABLE shipment_events').execute(source);
    await sql.raw('DROP TABLE shipments').execute(source);
    await h.introspect();
    await post(h, '/add-ons/carrier/attachments', { app: 'dashboard' });
    expect((await row(h)).connectionId).toBeNull();
    expect(await recorded(h)).toEqual([]);
    expect((await auditRepo(h.meta).list({ limit: 30 })).filter((entry) => entry.action === 'add-on.connection-recorded')).toEqual([]);
  });
});
