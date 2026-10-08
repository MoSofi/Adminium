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

function version(v: string, link: Record<string, unknown>): Record<string, unknown> {
  return {
    ...invoicingManifest([
      { ref: 'proposals', columns: [id, { ref: 'title', type: 'text', maxLength: 80 }] },
      { ref: 'versions', columns: [id, { ref: 'body', type: 'text', maxLength: 80 }, { ref: 'proposal_id', nullable: true, ...link }] },
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
      const names = new Set([h.real('versions'), h.real('proposals')]);
      const model = await adapter.introspect({ tableFilter: (t) => names.has(t.name), collectRowEstimates: false, collectActivityStats: false });
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
