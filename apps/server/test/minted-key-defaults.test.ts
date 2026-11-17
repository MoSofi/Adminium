// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A KEY ADMINIUM MAKES IS MADE ON EVERY CREATE, on SQLite, Postgres and MySQL.
 *
 * A primary key declared `id` is text on every engine, and one declared
 * `uuid` is text on SQLite and MySQL: the database fills neither. The sample
 * loader made one, but a person's create and a mail in the outbox sent none,
 * so the row was refused (Postgres, MySQL) or kept with no key (SQLite).
 *
 *  - An add-on's table keyed `id`, whether the add-on installs like an app or
 *    is a plain one: its install writes the fill (`column.default`, a uuid),
 *    a staff create gets a uuid, an update writes it again for an install
 *    from before, and an uninstall takes it back.
 *  - An app's table keyed `id`: a person's create through the data route,
 *    as the role that may make one, and the outbox row a change produces.
 */
import { appTablesRepo, overridesRepo, type MetaDb } from '@adminium/meta';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createWriteService } from '../src/crud/write-service.js';
import { writeStores } from '../src/crud/write-stores.js';
import { loadSnapshotView } from '../src/data-io/snapshot-view.js';
import { createPublicViews } from '../src/public-api/runtime.js';
import { addOnHarness, addOnManifest, type Harness } from './app-add-ons.helpers.js';
import { LEGS, said, wholeServer, type WholeServer } from './whole-server.helpers.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idKey = { ref: 'id', type: 'id', role: 'pk' } as const;
const text = (ref: string, maxLength = 120) => ({ ref, type: 'text', maxLength, nullable: true });

/** A plain add-on, as the released table owners are: its tables, unprefixed, and nothing declared beside them. */
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
  requiredSchema: {
    tables: [
      { ref: 'shipments', columns: [idKey, text('label', 80)] },
      { ref: 'shipment_events', columns: [idKey, { ref: 'shipment_id', type: 'fk', references: 'shipments' }, text('note', 80)] },
    ],
  },
});

/** An add-on that installs like an app: its tables under its own prefix, and a page. */
const notes = (version: string): Record<string, unknown> =>
  addOnManifest('notes', {
    version,
    compatibility: { minAdminiumVersion: '0.3.18' },
    requiredSchema: { prefixed: true, tables: [{ ref: 'cards', columns: [idKey, text('title', 80)] }] },
    pages: [{ ref: 'notes-cards', template: 'page-crud', title: { key: 't', fallback: 'Cards' }, nav: { group: 'manage', icon: 'box', order: 1 }, bindings: { main: 'cards' } }],
  });

/** The id of a table by its name in the latest snapshot. */
async function tableId(meta: MetaDb, connectionId: string, name: string): Promise<string> {
  const table = (await loadSnapshotView(meta, connectionId)).model.tables.find((one) => one.name === name);
  if (table === undefined) throw new Error(`no table "${name}"`);
  return table.id;
}

/** The uuid fills on a table's columns, as `[column, origin]`. */
async function keyFills(meta: MetaDb, connectionId: string, table: string): Promise<[string | null, string][]> {
  return (await overridesRepo(meta).listForConnection(connectionId))
    .filter((row) => row.op === 'column.default' && row.tableName === table && row.status === 'active' && (row.value as { kind?: unknown }).kind === 'uuid')
    .map((row) => [row.columnName, row.origin]);
}

/** A staff create through the write service, with no key sent: answers the row written. */
async function staffCreate(h: Harness, table: string, values: Record<string, unknown>): Promise<Record<string, unknown>> {
  const view = (await createPublicViews(h.meta).viewFor(h.connectionId))!;
  const handle = await h.manager.data(h.connectionId);
  const writes = createWriteService(writeStores(h.meta));
  return writes.create({
    target: { connectionId: h.connectionId, view, table: view.table(table), db: handle.db, dialect: handle.dialect, timezone: 'UTC' },
    values,
    context: { origin: 'dashboard', hops: 0, actor: { kind: 'user', id: h.owner.id, label: h.owner.name }, request: null },
    announce: async () => {},
  });
}

/** Made as an install from before keys were filled: its fills gone, and its records listing none. */
async function asBefore(h: Harness, key: string): Promise<void> {
  const records = appTablesRepo(h.meta);
  for (const record of await records.forInstall(h.connectionId, key)) {
    for (const rule of record.rules) await overridesRepo(h.meta).delete(rule.overrideId);
    await records.setRules(record.id, []);
  }
}

const post = (h: Harness, url: string, payload: Record<string, unknown> = {}) => h.inject({ method: 'POST', url, payload });

for (const [dialect, available] of LEGS) {
  describe.skipIf(!available)(`a plain add-on's key keyed id [${dialect}]`, () => {
    let h: Harness | null = null;
    afterEach(async () => {
      await h?.close();
      h = null;
    });
    const install = async (): Promise<Harness> => {
      const harness = await addOnHarness(dialect);
      await harness.stageAddOn(carrier('1.0.0'));
      const res = await post(harness, '/add-ons', { key: 'carrier', version: '1.0.0', attachTo: [] });
      expect(res.statusCode, res.body).toBe(200);
      return harness;
    };

    it('is filled at install, and a staff create with no key gets a uuid', async () => {
      h = await install();
      const shipments = await tableId(h.meta, h.connectionId, 'shipments');
      const events = await tableId(h.meta, h.connectionId, 'shipment_events');
      expect(await keyFills(h.meta, h.connectionId, shipments)).toEqual([['id', 'app']]);
      expect(await keyFills(h.meta, h.connectionId, events)).toEqual([['id', 'app']]);
      const made = await staffCreate(h, shipments, { label: 'First' });
      expect(String(made['id'])).toMatch(UUID);
      const event = await staffCreate(h, events, { shipment_id: made['id'], note: 'Picked up' });
      expect(String(event['id'])).toMatch(UUID);
      expect(event['id']).not.toBe(made['id']);
      expect((await h.rows("SELECT id FROM shipments WHERE label = 'First'")).map((row) => String(row['id']))).toEqual([String(made['id'])]);
    });

    it('is written again by an update, for an install from before it was filled', async () => {
      h = await install();
      const shipments = await tableId(h.meta, h.connectionId, 'shipments');
      await asBefore(h, 'carrier');
      expect(await keyFills(h.meta, h.connectionId, shipments)).toEqual([]);
      await h.stageAddOn(carrier('1.0.1'));
      const updated = await post(h, '/add-ons/carrier/update');
      expect(updated.statusCode, updated.body).toBe(200);
      expect(await keyFills(h.meta, h.connectionId, shipments)).toEqual([['id', 'app']]);
      expect(String((await staffCreate(h, shipments, { label: 'After' }))['id'])).toMatch(UUID);
      // Written once: the next update keeps the one there.
      await h.stageAddOn(carrier('1.0.2'));
      expect((await post(h, '/add-ons/carrier/update')).statusCode).toBe(200);
      expect(await keyFills(h.meta, h.connectionId, shipments)).toEqual([['id', 'app']]);
    });

    it('is taken back at uninstall, with the tables it leaves behind', async () => {
      h = await install();
      const shipments = await tableId(h.meta, h.connectionId, 'shipments');
      const gone = await h.inject({ method: 'DELETE', url: '/add-ons/carrier', payload: {} });
      expect(gone.statusCode, gone.body).toBe(200);
      expect(await keyFills(h.meta, h.connectionId, shipments)).toEqual([]);
      expect(await keyFills(h.meta, h.connectionId, await tableId(h.meta, h.connectionId, 'shipment_events'))).toEqual([]);
      expect(await h.tableNames()).toEqual(expect.arrayContaining(['shipments', 'shipment_events']));
    });

    it('keeps an owner’s own rule for the key, and a key the database fills, and writes none beside them', async () => {
      h = await addOnHarness(dialect);
      // The tables are there before the add-on: one with the owner's own rule on its key, one whose key the database fills.
      const filled = dialect === 'postgres' ? '(gen_random_uuid()::text)' : dialect === 'mysql' ? '(uuid())' : '(lower(hex(randomblob(16))))';
      await h.rows('CREATE TABLE shipments (id varchar(36) PRIMARY KEY, label varchar(80))');
      await h.rows(`CREATE TABLE shipment_events (id varchar(36) DEFAULT ${filled} PRIMARY KEY, shipment_id varchar(36), note varchar(80))`);
      await h.introspect();
      const shipments = await tableId(h.meta, h.connectionId, 'shipments');
      const events = await tableId(h.meta, h.connectionId, 'shipment_events');
      await overridesRepo(h.meta).create({ connectionId: h.connectionId, op: 'column.default', tableName: shipments, columnName: 'id', value: { kind: 'uuid' }, origin: 'user' });
      await h.stageAddOn(carrier('1.0.0'));
      const res = await post(h, '/add-ons', { key: 'carrier', version: '1.0.0', attachTo: [] });
      expect(res.statusCode, res.body).toBe(200);
      expect(await keyFills(h.meta, h.connectionId, shipments)).toEqual([['id', 'user']]);
      expect(await keyFills(h.meta, h.connectionId, events)).toEqual([]);
      // Each create still gets a key: the owner's rule's, and the database's own.
      const made = await staffCreate(h, shipments, { label: 'First' });
      expect(String(made['id'])).toMatch(UUID);
      await staffCreate(h, events, { shipment_id: made['id'], note: 'Picked up' });
      const [event] = await h.rows("SELECT id FROM shipment_events WHERE note = 'Picked up'");
      expect(String(event!['id']).length).toBeGreaterThan(0);
      // Its uninstall leaves the owner's rule where it is.
      expect((await h.inject({ method: 'DELETE', url: '/add-ons/carrier', payload: {} })).statusCode).toBe(200);
      expect(await keyFills(h.meta, h.connectionId, shipments)).toEqual([['id', 'user']]);
    });
  });

  describe.skipIf(!available)(`an add-on that installs like an app, keyed id [${dialect}]`, () => {
    let h: Harness | null = null;
    afterEach(async () => {
      await h?.close();
      h = null;
    });
    const install = async (): Promise<{ harness: Harness; cards: string }> => {
      const harness = await addOnHarness(dialect, { unbuiltWords: {} });
      await harness.stageAddOn(notes('1.0.0'), { bundled: true });
      const res = await post(harness, '/add-ons', { key: 'notes', version: '1.0.0', attachTo: [], connectionId: harness.connectionId });
      expect(res.statusCode, res.body).toBe(200);
      const name = (await appTablesRepo(harness.meta).forInstall(harness.connectionId, 'notes')).find((record) => record.ref === 'cards')!.tableName;
      return { harness, cards: await tableId(harness.meta, harness.connectionId, name) };
    };

    it('is filled at install, and a staff create with no key gets a uuid', async () => {
      const made = await install();
      h = made.harness;
      expect(await keyFills(h.meta, h.connectionId, made.cards)).toEqual([['id', 'app']]);
      const row = await staffCreate(h, made.cards, { title: 'Call the printer' });
      expect(String(row['id'])).toMatch(UUID);
    });

    it('is written again by an update, and taken back at uninstall', async () => {
      const made = await install();
      h = made.harness;
      await asBefore(h, 'notes');
      expect(await keyFills(h.meta, h.connectionId, made.cards)).toEqual([]);
      await h.stageAddOn(notes('1.0.1'), { bundled: true });
      const updated = await post(h, '/add-ons/notes/update');
      expect(updated.statusCode, updated.body).toBe(200);
      expect(await keyFills(h.meta, h.connectionId, made.cards)).toEqual([['id', 'app']]);
      expect(String((await staffCreate(h, made.cards, { title: 'After' }))['id'])).toMatch(UUID);
      const gone = await h.inject({ method: 'DELETE', url: '/add-ons/notes', payload: {} });
      expect(gone.statusCode, gone.body).toBe(200);
      expect(await keyFills(h.meta, h.connectionId, made.cards)).toEqual([]);
    });
  });
}

/** A post room: parcels and the mails they send, each keyed by an `id` Adminium makes. */
function postRoom(): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'post',
    name: 'Post Room',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
    license: 'AGPL-3.0-only',
    description: { key: 'mft.post.desc', fallback: 'A post room.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: '0.3.61', engines: ['postgres', 'mysql', 'sqlite'] },
    navGroups: [{ key: 'post', label: { 'en-US': 'Post' }, order: 1 }],
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'settings', columns: [{ ref: 'id', type: 'int', role: 'pk' }, text('name', 80)] },
        { ref: 'parcels', columns: [idKey, text('number', 40), text('email', 200), { ref: 'status', type: 'enum', enum: ['open', 'sent'], default: 'open' }] },
        {
          ref: 'messages',
          columns: [
            idKey,
            { ref: 'kind', type: 'enum', enum: ['parcel-sent'] },
            { ref: 'status', type: 'enum', enum: ['held', 'queued', 'sent', 'failed', 'skipped'], default: 'queued' },
            text('to_address', 254),
            { ref: 'parcel_id', type: 'fk', references: 'parcels', nullable: true },
            text('error', 200),
            text('skip_reason', 40),
            { ref: 'sent_at', type: 'timestamptz', nullable: true },
          ],
        },
      ],
    },
    // At the counter: makes and sends parcels, and nothing else.
    roles: [{ key: 'clerk', name: 'Clerk', screensOnly: true, permissions: ['app:@:staff', 'table:@parcels:read', 'table:@parcels:create', 'table:@parcels:update'] }],
    pages: [{ ref: 'post-parcels', template: 'page-crud', title: { key: 't.parcels', fallback: 'Parcels' }, nav: { group: 'post', icon: 'list', order: 1 }, bindings: { rows: 'parcels' } }],
    outbox: {
      table: 'messages',
      columns: { kind: 'kind', status: 'status', to: 'to_address', error: 'error', skipReason: 'skip_reason', sentAt: 'sent_at' },
      links: { parcel: 'parcel_id' },
      recipient: { via: 'parcel_id', table: 'parcels', email: 'email', name: 'number' },
      settings: { table: 'settings', name: 'name' },
      kinds: { 'parcel-sent': 'post-parcel-sent' },
      classes: { 'parcel-sent': 'service' },
      producers: [{ kind: 'parcel-sent', link: 'parcel_id', onChange: { table: 'parcels', column: 'status', to: 'sent' } }],
    },
    emailTemplates: [{ key: 'post-parcel-sent', name: 'post-parcel-sent', locales: { 'en-US': { subject: 'Parcel {{parcel.number}} is on its way', blocks: [{ block: 'email.text', data: { text: 'It has left.' } }] } } }],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } }],
  };
}

for (const [dialect, available] of LEGS) {
  describe.skipIf(!available)(`an app's key keyed id [${dialect}]`, () => {
    let s: WholeServer;
    const real = (ref: string): string => s.t(ref).slice(s.t(ref).lastIndexOf('.') + 1);

    beforeAll(async () => {
      s = await wholeServer(dialect, postRoom(), { smtp: true, people: { cleo: ['clerk'] } });
      await s.rows(`INSERT INTO ${real('settings')} (id, name) VALUES (1, 'Post Room')`);
    }, 180_000);
    afterAll(async () => {
      await s?.close();
    });

    it('is filled on its tables by the install', async () => {
      expect(await keyFills(s.meta, s.connectionId, s.t('parcels'))).toEqual([['id', 'app']]);
      expect(await keyFills(s.meta, s.connectionId, s.t('messages'))).toEqual([['id', 'app']]);
      // A key the app numbers itself is never given one.
      expect(await keyFills(s.meta, s.connectionId, s.t('settings'))).toEqual([]);
    });

    it('gives a clerk’s create a uuid, and the mail its change queues one too', async () => {
      const made = await s.make('cleo', 'parcels', { number: 'P-1', email: 'ada@crumbandco.de' });
      expect(said(made), made.body).toBe('ok');
      const [parcel] = await s.rows(`SELECT id FROM ${real('parcels')} WHERE number = 'P-1'`);
      const key = String(parcel!['id']);
      expect(key).toMatch(UUID);
      const sent = await s.change('cleo', 'parcels', key, { status: 'sent' });
      expect(said(sent), sent.body).toBe('ok');
      await s.jobs();
      const mails = await s.rows(`SELECT id, status FROM ${real('messages')}`);
      expect(mails).toHaveLength(1);
      expect(String(mails[0]!['id'])).toMatch(UUID);
      expect((await s.emails()).map((mail) => mail.subject)).toEqual(['Parcel P-1 is on its way']);
    });
  });
}
