// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A column an app first made a plain number and then declares a link, given
 * its foreign key by the update — on every engine this run can reach.
 *
 * A table made with a link carries a foreign key; one whose column was there
 * before it was a link carried none, and the database then knew no parent
 * for the row: nothing that follows the link found anything. The update now
 * adds the key, once every row points at a row that is there; rows that do
 * not are named on the check, and nothing moves.
 */
import { schemaChangesRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { sha512Integrity } from '../src/add-ons/store.js';
import { packageTarball } from './app-bundle-helpers.js';
import { LEGS, installInvoicing, invoicingManifest, type InvoicingHarness } from './invoicing-install.helpers.js';

const id = { ref: 'id', type: 'int', role: 'pk' };

function version(v: string, link: Record<string, unknown>, more: { columns?: Record<string, unknown>[]; tables?: Record<string, unknown>[] } = {}): Record<string, unknown> {
  return {
    ...invoicingManifest([
      { ref: 'proposals', columns: [id, { ref: 'title', type: 'text', maxLength: 80 }] },
      { ref: 'versions', columns: [id, { ref: 'body', type: 'text', maxLength: 80 }, { ref: 'proposal_id', nullable: true, ...link }, ...(more.columns ?? [])] },
      ...(more.tables ?? []),
    ]),
    version: v,
    compatibility: { minAdminiumVersion: '0.3.0', updatesFrom: '>=0.2.0' },
  };
}
/** As a model writes a link before it knows the word for one. */
const NUMBER = { type: 'int', references: 'proposals' };
const LINK = { type: 'fk', references: 'proposals' };

describe.each(LEGS)('an update links a column that was made a plain number — %s', (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  afterEach(async () => {
    await h?.close();
  });

  const stage = async (manifest: Record<string, unknown>) => {
    const tarball = packageTarball({ 'manifest.json': JSON.stringify(manifest), 'staff/index.html': '<!doctype html><html></html>' });
    const staged = await h.app.inject({
      method: 'POST',
      url: `/apps/upload?expectedSha512=${encodeURIComponent(sha512Integrity(tarball))}`,
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.from(tarball),
    });
    expect(staged.statusCode, staged.body).toBe(200);
  };
  const plan = async (v: string) => {
    const res = await h.app.inject({ method: 'POST', url: '/apps/plan', payload: { key: 'studio', version: v, connectionId: h.connectionId } });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { plan: { installable: boolean; problems: { code: string; column?: string; message: string }[]; tables: { ref: string; edits: Record<string, unknown>[] }[] } }).plan;
  };
  const installed = async () => ((await h.app.inject({ method: 'GET', url: '/apps' })).json() as { apps: { version: string }[] }).apps[0]!.version;
  /** The links the database itself keeps from the versions, as `column -> table`. */
  const linksOf = async () => {
    const adapter = await h.manager.introspectAdapter(h.connectionId);
    try {
      const model = await adapter.introspect({ collectRowEstimates: false, collectActivityStats: false });
      const from = model.tables.find((t) => t.name === h.real('versions'))!.id;
      return model.relations.filter((r) => r.kind === 'declared-fk' && r.from.tableId === from).map((r) => `${r.from.columns.join(',')} -> ${model.tables.find((t) => t.id === r.to.tableId)?.name ?? r.to.tableId}`);
    } finally {
      await adapter.close();
    }
  };

  it.skipIf(!available)('a column declared a link from the start has its foreign key; one made a number has none', async () => {
    h = await installInvoicing(dialect, version('0.2.0', LINK));
    expect(await linksOf()).toEqual([`proposal_id -> ${h.real('proposals')}`]);
    await h.close();
    h = await installInvoicing(dialect, version('0.2.0', NUMBER));
    expect(await linksOf()).toEqual([]);
  }, 120_000);

  it.skipIf(!available)('the update gives it the foreign key, keeps every row, and the next check finds nothing left', async () => {
    h = await installInvoicing(dialect, version('0.2.0', NUMBER));
    await h.rows(`INSERT INTO ${h.real('proposals')} (id, title) VALUES (1, 'One'), (2, 'Two')`);
    await h.rows(`INSERT INTO ${h.real('versions')} (body, proposal_id) VALUES ('a', 1), ('b', 2), ('c', NULL)`);
    await stage(version('0.2.1', LINK));
    const checked = await plan('0.2.1');
    expect(checked.problems).toEqual([]);
    expect(checked.tables.find((t) => t.ref === 'versions')!.edits).toEqual([{ kind: 'add-link', column: 'proposal_id', to: 'proposals' }]);

    const res = await h.app.inject({ method: 'POST', url: '/apps/studio/update' });
    expect(res.statusCode, res.body).toBe(200);
    expect(await installed()).toBe('0.2.1');
    expect(await linksOf()).toEqual([`proposal_id -> ${h.real('proposals')}`]);
    expect((await h.rows(`SELECT body, proposal_id FROM ${h.real('versions')} ORDER BY id`)).map((row) => `${String(row['body'])}:${String(row['proposal_id'])}`)).toEqual(['a:1', 'b:2', 'c:null']);
    // One step on the table: the constraint where the engine can add one, the rebuild where it cannot.
    const steps = (await schemaChangesRepo(h.meta).listForConnection(h.connectionId)).flatMap((change) => change.steps).filter((step) => step.table.endsWith(h.real('versions')));
    expect([...new Set(steps.map((step) => step.kind))]).toEqual(dialect === 'sqlite' ? ['rebuild-table'] : dialect === 'postgres' ? expect.arrayContaining(['add-fk']) : ['add-fk']);
    expect(steps.every((step) => step.outcome === 'succeeded')).toBe(true);
    // The database now refuses what the link forbids.
    if (dialect !== 'sqlite') await expect(h.rows(`INSERT INTO ${h.real('versions')} (body, proposal_id) VALUES ('d', 999)`)).rejects.toThrow();

    await stage(version('0.2.2', LINK));
    expect((await plan('0.2.2')).tables.find((t) => t.ref === 'versions')!.edits).toEqual([]);
  }, 120_000);

  it.skipIf(!available)('the table keeps everything else it had: its unique rule, its value list, its default and its other link', async () => {
    // What a rebuild could lose (SQLite copies the table to add the key).
    const columns = [
      { ref: 'ref_no', type: 'text', maxLength: 20, nullable: true, unique: true },
      { ref: 'kind', type: 'enum', enum: ['draft', 'sent'], default: 'draft' },
      { ref: 'author_id', type: 'fk', references: 'authors', nullable: true },
    ];
    const tables = [{ ref: 'authors', columns: [id, { ref: 'name', type: 'text', maxLength: 40 }] }];
    h = await installInvoicing(dialect, version('0.2.0', NUMBER, { columns, tables }));
    await h.rows(`INSERT INTO ${h.real('proposals')} (id, title) VALUES (1, 'One')`);
    await h.rows(`INSERT INTO ${h.real('versions')} (body, proposal_id, ref_no) VALUES ('a', 1, 'R-1')`);
    await stage(version('0.2.1', LINK, { columns, tables }));
    expect((await plan('0.2.1')).tables.find((t) => t.ref === 'versions')!.edits).toEqual([{ kind: 'add-link', column: 'proposal_id', to: 'proposals' }]);
    const res = await h.app.inject({ method: 'POST', url: '/apps/studio/update' });
    expect(res.statusCode, res.body).toBe(200);
    expect((await linksOf()).sort()).toEqual([`author_id -> ${h.real('authors')}`, `proposal_id -> ${h.real('proposals')}`]);
    // The default still fills, the unique rule and the value list still refuse.
    await h.rows(`INSERT INTO ${h.real('versions')} (body, proposal_id) VALUES ('b', 1)`);
    expect((await h.rows(`SELECT kind FROM ${h.real('versions')} WHERE body = 'b'`))[0]!['kind']).toBe('draft');
    await expect(h.rows(`INSERT INTO ${h.real('versions')} (body, ref_no) VALUES ('c', 'R-1')`)).rejects.toThrow();
    await expect(h.rows(`INSERT INTO ${h.real('versions')} (body, kind) VALUES ('d', 'lost')`)).rejects.toThrow();
    // …and nothing is left for the next check.
    await stage(version('0.2.2', LINK, { columns, tables }));
    expect((await plan('0.2.2')).tables.find((t) => t.ref === 'versions')!.edits).toEqual([]);
  }, 120_000);

  it.skipIf(!available)('a link to a table the same update makes is offered only while the column is empty', async () => {
    const plain = { ref: 'batch_id', type: 'int', nullable: true };
    const linked = { ref: 'batch_id', type: 'fk', references: 'batches', nullable: true };
    const tables = [{ ref: 'batches', columns: [id, { ref: 'name', type: 'text', maxLength: 40 }] }];
    h = await installInvoicing(dialect, version('0.2.0', LINK, { columns: [plain] }));
    await h.rows(`INSERT INTO ${h.real('versions')} (body, batch_id) VALUES ('a', 7)`);
    await stage(version('0.2.1', LINK, { columns: [linked], tables }));
    // No batch exists yet: a value there names nothing.
    const checked = await plan('0.2.1');
    expect(checked.problems).toEqual([expect.objectContaining({ code: 'LINK_ORPHANS', column: 'batch_id' })]);
    await h.rows(`UPDATE ${h.real('versions')} SET batch_id = NULL`);
    const res = await h.app.inject({ method: 'POST', url: '/apps/studio/update' });
    expect(res.statusCode, res.body).toBe(200);
    expect((await linksOf()).sort()).toEqual([`batch_id -> ${h.real('batches')}`, `proposal_id -> ${h.real('proposals')}`]);
  }, 120_000);

  it.skipIf(!available)('a link to a table the update makes afresh, moving the one there aside, counts no row of the old one', async () => {
    const plain = { ref: 'batch_id', type: 'int', nullable: true };
    const linked = { ref: 'batch_id', type: 'fk', references: 'batches', nullable: true };
    const tables = [{ ref: 'batches', columns: [id, { ref: 'name', type: 'text', maxLength: 40 }] }];
    h = await installInvoicing(dialect, version('0.2.0', LINK, { columns: [plain] }));
    // Another system's table under the name the app will want, holding a row 7.
    await h.rows(`CREATE TABLE ${h.real('batches')} (id integer PRIMARY KEY, location_id integer NOT NULL)`);
    await h.rows(`INSERT INTO ${h.real('batches')} (id, location_id) VALUES (7, 1)`);
    await h.rows(`INSERT INTO ${h.real('versions')} (body, batch_id) VALUES ('a', 7)`);
    await stage(version('0.2.1', LINK, { columns: [linked], tables }));
    const res = await h.app.inject({
      method: 'POST',
      url: '/apps/plan',
      payload: { key: 'studio', version: '0.2.1', connectionId: h.connectionId, choices: { batches: { action: 'rename-existing', to: `${h.real('batches')}_old` } } },
    });
    expect(res.statusCode, res.body).toBe(200);
    const checked = (res.json() as { plan: { problems: { code: string; column?: string }[]; tables: { ref: string; action: string }[] } }).plan;
    expect(checked.tables.find((t) => t.ref === 'batches')!.action).toBe('rename-existing');
    // The 7 names a row of the table being moved aside: the new one has none.
    expect(checked.problems).toEqual([expect.objectContaining({ code: 'LINK_ORPHANS', column: 'batch_id' })]);
  }, 120_000);

  it.skipIf(!available)('a link to a table that was there before the app is checked by that table\'s own key, whatever its name', async () => {
    const serial = dialect === 'postgres' ? 'SERIAL PRIMARY KEY' : dialect === 'mysql' ? 'INT AUTO_INCREMENT PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
    const plain = { ref: 'person_no', type: 'int', nullable: true };
    const linked = { ref: 'person_no', type: 'fk', references: 'people_on_file', nullable: true };
    h = await installInvoicing(dialect, version('0.2.0', LINK, { columns: [plain] }));
    await h.rows(`CREATE TABLE people_on_file (person_no ${serial}, name VARCHAR(40))`);
    await h.rows(`INSERT INTO people_on_file (person_no, name) VALUES (5, 'Ada')`);
    await h.rows(`INSERT INTO ${h.real('versions')} (body, person_no) VALUES ('a', 5), ('stray', 6)`);
    await stage(version('0.2.1', LINK, { columns: [linked] }));
    // The check reads `person_no`, the key the table has: it answers, and names the stray row.
    const checked = await plan('0.2.1');
    expect(checked.problems).toEqual([expect.objectContaining({ code: 'LINK_ORPHANS', column: 'person_no' })]);
    await h.rows(`UPDATE ${h.real('versions')} SET person_no = NULL WHERE body = 'stray'`);
    const res = await h.app.inject({ method: 'POST', url: '/apps/studio/update' });
    expect(res.statusCode, res.body).toBe(200);
    const adapter = await h.manager.introspectAdapter(h.connectionId);
    try {
      const model = await adapter.introspect({ tableFilter: (t) => t.name === h.real('versions') || t.name === 'people_on_file', collectRowEstimates: false, collectActivityStats: false });
      expect(model.relations.filter((r) => r.kind === 'declared-fk' && r.from.columns[0] === 'person_no').map((r) => r.to.columns)).toEqual([['person_no']]);
    } finally {
      await adapter.close();
    }
  }, 120_000);

  it.skipIf(!available)('a row that names a parent that is not there is said on the check, and nothing moves', async () => {
    h = await installInvoicing(dialect, version('0.2.0', NUMBER));
    await h.rows(`INSERT INTO ${h.real('proposals')} (id, title) VALUES (1, 'One')`);
    await h.rows(`INSERT INTO ${h.real('versions')} (body, proposal_id) VALUES ('a', 1), ('stray', 999)`);
    await stage(version('0.2.1', LINK));
    const checked = await plan('0.2.1');
    expect(checked.installable).toBe(false);
    expect(checked.problems).toEqual([expect.objectContaining({ code: 'LINK_ORPHANS', column: 'proposal_id', message: expect.stringContaining(`"${h.real('versions')}.proposal_id"`) })]);
    const refused = await h.app.inject({ method: 'POST', url: '/apps/studio/update' });
    expect(refused.statusCode, refused.body).toBe(422);
    expect(await installed()).toBe('0.2.0');
    expect(await linksOf()).toEqual([]);

    // Emptied, the update links it.
    await h.rows(`UPDATE ${h.real('versions')} SET proposal_id = NULL WHERE body = 'stray'`);
    const res = await h.app.inject({ method: 'POST', url: '/apps/studio/update' });
    expect(res.statusCode, res.body).toBe(200);
    expect(await linksOf()).toEqual([`proposal_id -> ${h.real('proposals')}`]);
  }, 120_000);
});
