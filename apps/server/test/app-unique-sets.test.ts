// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Columns an app keeps unique together (`requiredSchema.tables[].unique`), on
 * every engine: a fresh install makes each set under its own name; a second
 * row with the same values is refused and the dashboard is told which columns;
 * a row with any of them empty never collides; an update gives an installed
 * table the set once no rows break it — rows that do are named, and nothing
 * moves — over a column the same update adds too, in place on SQLite; and a
 * set's name never takes an index name the database already has.
 */
import { schemaChangesRepo } from '@adminium/meta';
import { uniqueSetName } from '@adminium/manifest';
import { afterEach, describe, expect, it } from 'vitest';

import { sha512Integrity } from '../src/add-ons/store.js';
import { packageTarball } from './app-bundle-helpers.js';
import { LEGS, installInvoicing, invoicingManifest, type InvoicingHarness } from './invoicing-install.helpers.js';
import { dataRoutesOver } from './invoicing-routes.helpers.js';

const id = { ref: 'id', type: 'int', role: 'pk' };

function version(v: string, waitlist: { columns?: Record<string, unknown>[]; unique?: string[][] } = {}): Record<string, unknown> {
  return {
    ...invoicingManifest([
      { ref: 'events', columns: [id, { ref: 'name', type: 'text', maxLength: 80 }] },
      {
        ref: 'waitlist',
        columns: [
          id,
          { ref: 'event_id', type: 'fk', references: 'events' },
          { ref: 'email', type: 'text', maxLength: 200, nullable: true, rules: { normalize: 'email' } },
          ...(waitlist.columns ?? []),
        ],
        ...(waitlist.unique === undefined ? {} : { unique: waitlist.unique }),
      },
    ]),
    version: v,
    compatibility: { minAdminiumVersion: '0.3.0', updatesFrom: '>=0.2.0' },
  };
}

describe.each(LEGS)('columns kept unique together — %s', (dialect, available) => {
  let h: (InvoicingHarness & { reply: Record<string, unknown> }) | undefined;
  afterEach(async () => {
    await h?.close();
    h = undefined;
  });
  const stage = async (manifest: Record<string, unknown>) => {
    const tarball = packageTarball({ 'manifest.json': JSON.stringify(manifest), 'staff/index.html': '<!doctype html><html></html>' });
    const staged = await h!.app.inject({
      method: 'POST',
      url: `/apps/upload?expectedSha512=${encodeURIComponent(sha512Integrity(tarball))}`,
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.from(tarball),
    });
    expect(staged.statusCode, staged.body).toBe(200);
  };
  const plan = async (v: string) =>
    ((await h!.app.inject({ method: 'POST', url: '/apps/plan', payload: { key: 'studio', version: v, connectionId: h!.connectionId } })).json() as {
      plan: { installable: boolean; problems: { code: string; message: string; column?: string }[]; tables: { ref: string; edits: Record<string, unknown>[] }[] };
    }).plan;

  it.skipIf(!available)('makes each set on a fresh install, names its columns to staff, and lets empty values repeat', async () => {
    h = await installInvoicing(dialect, version('0.2.0', { unique: [['event_id', 'email']] }));
    const routes = await dataRoutesOver(h, dialect);
    try {
      const event = (await routes.post('events', { values: { name: 'Show' } })).json() as { data: { id: number } };
      const first = await routes.post('waitlist', { values: { event_id: event.data.id, email: 'a@example.com' } });
      expect(first.statusCode, first.body).toBe(201);
      // Normalised, so a different case is the same address on every engine.
      const again = await routes.post('waitlist', { values: { event_id: event.data.id, email: 'A@example.com' } });
      expect(again.statusCode, again.body).toBe(409);
      expect(again.json()).toMatchObject({ error: { code: 'UNIQUE_VIOLATION', details: { columns: ['event_id', 'email'] } } });
      for (let i = 0; i < 2; i += 1) expect((await routes.post('waitlist', { values: { event_id: event.data.id } })).statusCode).toBe(201);
      const other = (await routes.post('events', { values: { name: 'Other' } })).json() as { data: { id: number } };
      expect((await routes.post('waitlist', { values: { event_id: other.data.id, email: 'a@example.com' } })).statusCode).toBe(201);
    } finally {
      await routes.close();
    }
  }, 120_000);

  it.skipIf(!available)('gives an installed table its set once no rows break it, naming the ones that do', async () => {
    h = await installInvoicing(dialect, version('0.2.0'));
    await h.rows(`INSERT INTO ${h.real('events')} (name) VALUES ('Show')`);
    const [event] = await h.rows(`SELECT id FROM ${h.real('events')}`);
    await h.rows(`INSERT INTO ${h.real('waitlist')} (event_id, email) VALUES (${String(event!['id'])}, 'a@x.io'), (${String(event!['id'])}, 'a@x.io'), (${String(event!['id'])}, NULL), (${String(event!['id'])}, NULL)`);
    await stage(version('0.2.1', { unique: [['event_id', 'email']] }));
    const checked = await plan('0.2.1');
    const name = uniqueSetName(h.real('waitlist'), ['event_id', 'email']);
    expect(checked.tables.find((t) => t.ref === 'waitlist')!.edits).toEqual([{ kind: 'add-unique', column: 'email', with: ['event_id'], name }]);
    expect(checked.installable).toBe(false);
    expect(checked.problems).toEqual([expect.objectContaining({ code: 'UNIQUE_DUPLICATES', column: 'email', message: expect.stringContaining('event_id, email only once') })]);
    expect((await h.app.inject({ method: 'POST', url: '/apps/studio/update' })).statusCode).toBe(422);

    await h.rows(`UPDATE ${h.real('waitlist')} SET email = 'b@x.io' WHERE id = (SELECT m FROM (SELECT MAX(id) AS m FROM ${h.real('waitlist')} WHERE email = 'a@x.io') AS x)`);
    const res = await h.app.inject({ method: 'POST', url: '/apps/studio/update' });
    expect(res.statusCode, res.body).toBe(200);
    await expect(h.rows(`INSERT INTO ${h.real('waitlist')} (event_id, email) VALUES (${String(event!['id'])}, 'a@x.io')`)).rejects.toThrow();
    const steps = (await schemaChangesRepo(h.meta).listForConnection(h.connectionId)).flatMap((change) => change.steps).filter((step) => step.table.endsWith(h!.real('waitlist')));
    expect(steps.map((step) => step.kind)).toEqual([dialect === 'sqlite' ? 'add-index' : 'add-unique']);
  }, 120_000);

  it.skipIf(!available)('keeps a set over a column the same update adds, beside a rule on that column alone', async () => {
    h = await installInvoicing(dialect, version('0.2.0'));
    const seat = { ref: 'seat', type: 'text', maxLength: 8, nullable: true, unique: true };
    await stage(version('0.2.1', { columns: [seat], unique: [['event_id', 'seat'], ['email', 'seat']] }));
    const checked = await plan('0.2.1');
    expect(checked.installable, JSON.stringify(checked.problems)).toBe(true);
    const res = await h.app.inject({ method: 'POST', url: '/apps/studio/update' });
    expect(res.statusCode, res.body).toBe(200);
    await h.rows(`INSERT INTO ${h.real('events')} (name) VALUES ('Show')`);
    const [event] = await h.rows(`SELECT id FROM ${h.real('events')}`);
    await h.rows(`INSERT INTO ${h.real('waitlist')} (event_id, email, seat) VALUES (${String(event!['id'])}, 'a@x.io', 'A1')`);
    await expect(h.rows(`INSERT INTO ${h.real('waitlist')} (event_id, email, seat) VALUES (${String(event!['id'])}, 'b@x.io', 'A1')`)).rejects.toThrow();
  }, 120_000);

  it.skipIf(!available)('refuses a set over a column the same update adds filled with a default, where rows already repeat', async () => {
    h = await installInvoicing(dialect, version('0.2.0'));
    await h.rows(`INSERT INTO ${h.real('events')} (name) VALUES ('Show'), ('Other')`);
    const [show, other] = await h.rows(`SELECT id FROM ${h.real('events')} ORDER BY id`);
    await h.rows(`INSERT INTO ${h.real('waitlist')} (event_id, email) VALUES (${String(show!['id'])}, 'a@x.io'), (${String(show!['id'])}, 'b@x.io')`);
    // Every row the update finds gets seat 'A': two rows of one show would be the same show and seat.
    const seat = { ref: 'seat', type: 'text', maxLength: 8, nullable: true, default: 'A' };
    await stage(version('0.2.1', { columns: [seat], unique: [['event_id', 'seat']] }));
    const checked = await plan('0.2.1');
    expect(checked.installable).toBe(false);
    expect(checked.problems).toEqual([expect.objectContaining({ code: 'UNIQUE_DUPLICATES', column: 'seat', message: expect.stringContaining('event_id, seat only once') })]);
    expect((await h.app.inject({ method: 'POST', url: '/apps/studio/update' })).statusCode).toBe(422);
    // Nothing moved: the column is not there yet.
    await expect(h.rows(`SELECT seat FROM ${h.real('waitlist')}`)).rejects.toThrow();

    await h.rows(`UPDATE ${h.real('waitlist')} SET event_id = ${String(other!['id'])} WHERE email = 'b@x.io'`);
    const res = await h.app.inject({ method: 'POST', url: '/apps/studio/update' });
    expect(res.statusCode, res.body).toBe(200);
    expect((await h.rows(`SELECT seat FROM ${h.real('waitlist')} ORDER BY id`)).map((row) => row['seat'])).toEqual(['A', 'A']);
  }, 120_000);

  it.skipIf(!available)('refuses a set of columns the update adds, each filled with one default, once the table has two rows', async () => {
    h = await installInvoicing(dialect, version('0.2.0'));
    await h.rows(`INSERT INTO ${h.real('events')} (name) VALUES ('Show')`);
    const [show] = await h.rows(`SELECT id FROM ${h.real('events')}`);
    await h.rows(`INSERT INTO ${h.real('waitlist')} (event_id, email) VALUES (${String(show!['id'])}, 'a@x.io')`);
    const columns = [
      { ref: 'row_code', type: 'text', maxLength: 8, nullable: true, default: 'R' },
      { ref: 'badge', type: 'text', maxLength: 8, nullable: true, default: 'B' },
    ];
    await stage(version('0.2.1', { columns, unique: [['row_code', 'badge']] }));
    // One row: one value each, nothing repeats.
    expect((await plan('0.2.1')).installable).toBe(true);
    await h.rows(`INSERT INTO ${h.real('waitlist')} (event_id, email) VALUES (${String(show!['id'])}, 'b@x.io')`);
    const checked = await plan('0.2.1');
    expect(checked.problems).toEqual([expect.objectContaining({ code: 'UNIQUE_DUPLICATES', column: 'badge' })]);
  }, 120_000);

  it.skipIf(!available)('names a set clear of an index the database already has', async () => {
    const taken = `uq_studio_waitlist_event_id_email`;
    h = await installInvoicing(dialect, version('0.2.0', { unique: [['event_id', 'email']] }), undefined, {}, {
      prepare: async (run) => {
        await run(`CREATE TABLE other_table (id integer primary key, v integer)`);
        await run(`CREATE UNIQUE INDEX ${taken} ON other_table (v)`);
      },
    });
    const names = await (async () => {
      const adapter = await h!.manager.introspectAdapter(h!.connectionId);
      try {
        const model = await adapter.introspect({ collectRowEstimates: false, collectActivityStats: false });
        const table = model.tables.find((t) => t.name === h!.real('waitlist'))!;
        return [...table.uniques.map((u) => u.name), ...table.indexes.filter((i) => i.unique).map((i) => i.name)];
      } finally {
        await adapter.close();
      }
    })();
    const expected = uniqueSetName(h.real('waitlist'), ['event_id', 'email'], new Set([taken]));
    expect(expected).not.toBe(taken);
    // SQLite keeps a table's constraint by no name of its own (its index is `sqlite_autoindex_…`): nothing to collide with.
    if (dialect !== 'sqlite') expect(names, JSON.stringify(names)).toContain(expected);
  }, 120_000);
});
