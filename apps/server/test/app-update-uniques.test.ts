// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The one-of-a-kind rules an app's columns are declared with, kept by an
 * update exactly as a fresh install keeps them — on every engine this run can
 * reach.
 *
 * A unique text column wider than MySQL can index is refused on the check, for
 * an install and an update alike, before anything moves. A column that is
 * there without the rule it is declared with (an earlier update that stopped
 * halfway, a table the operator made) is given it by the next update, once no
 * two rows break it; rows that do are named, and nothing moves. A number
 * counted per parent row that an update adds is unique with its parent, as it
 * is on a table made with it.
 */
import { schemaChangesRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { sha512Integrity } from '../src/add-ons/store.js';
import { packageTarball } from './app-bundle-helpers.js';
import { LEGS, installInvoicing, invoicingManifest, invoicingTables, type InvoicingHarness } from './invoicing-install.helpers.js';

const id = { ref: 'id', type: 'int', role: 'pk' };

function version(v: string, notes: Record<string, unknown>[], versions: Record<string, unknown>[] = []): Record<string, unknown> {
  return {
    ...invoicingManifest([
      { ref: 'proposals', columns: [id, { ref: 'title', type: 'text', maxLength: 80 }] },
      { ref: 'notes', columns: [id, { ref: 'body', type: 'text', maxLength: 80 }, ...notes] },
      { ref: 'versions', columns: [id, { ref: 'proposal_id', type: 'fk', references: 'proposals' }, ...versions] },
    ]),
    version: v,
    compatibility: { minAdminiumVersion: '0.3.0', updatesFrom: '>=0.2.0' },
  };
}

describe.each(LEGS)('an update keeps the unique rules a column is declared with — %s', (dialect, available) => {
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
    return (res.json() as { plan: { installable: boolean; problems: { code: string; message: string }[]; tables: { ref: string; edits: Record<string, unknown>[] }[] } }).plan;
  };
  const editsOf = async (v: string, ref: string) => (await plan(v)).tables.find((t) => t.ref === ref)!.edits;
  const installed = async () => ((await h.app.inject({ method: 'GET', url: '/apps' })).json() as { apps: { version: string }[] }).apps[0]!.version;
  const columnsOf = async (ref: string) => {
    const adapter = await h.manager.introspectAdapter(h.connectionId);
    try {
      const model = await adapter.introspect({ tableFilter: (t) => t.name === h.real(ref), collectRowEstimates: false, collectActivityStats: false });
      return model.tables.find((t) => t.name === h.real(ref))!.columns.map((c) => c.name);
    } finally {
      await adapter.close();
    }
  };

  it.skipIf(!available)('refuses a unique text column wider than MySQL can index on the check, for an install and an update alike', async () => {
    const long = { ref: 'long_ref', type: 'text', maxLength: 1000, nullable: true, unique: true };
    h = await installInvoicing(dialect, version('0.2.0', []));
    await stage(version('0.2.1', [long]));
    const checked = await plan('0.2.1');
    const refused = checked.problems.filter((p) => p.code === 'UNIQUE_KEY_TOO_LONG');
    expect(refused.map((p) => p.message)).toEqual(dialect === 'mysql' ? [expect.stringContaining('at most 768 characters')] : []);
    const res = await h.app.inject({ method: 'POST', url: '/apps/studio/update' });
    if (dialect !== 'mysql') {
      expect(res.statusCode, res.body).toBe(200);
      return;
    }
    // Refused before anything moved: no column half-made, the running version as it was.
    expect(res.statusCode, res.body).toBe(422);
    expect(res.json().message).toBe('"studio" cannot be updated on this database.');
    expect(await columnsOf('notes')).not.toContain('long_ref');
    expect(await installed()).toBe('0.2.0');
  }, 120_000);

  it.skipIf(!available)('refuses the same column on a fresh install on MySQL, as the update does', async () => {
    const long = { ref: 'long_ref', type: 'text', maxLength: 1000, nullable: true, unique: true };
    if (dialect !== 'mysql') {
      h = await installInvoicing(dialect, version('0.2.0', [long]));
      return;
    }
    // Refused on the check, as the update is — not by the database halfway through making the tables.
    await expect(installInvoicing(dialect, version('0.2.0', [long]))).rejects.toThrow(/"statusCode":422,"code":"VALIDATION_/);
    h = undefined as never;
  }, 120_000);

  it.skipIf(!available)('gives a column the unique rule it is declared with but lacks, once no two rows break it', async () => {
    h = await installInvoicing(dialect, version('0.2.0', [{ ref: 'ref_no', type: 'text', maxLength: 20, nullable: true }]));
    await h.rows(`INSERT INTO ${h.real('notes')} (body, ref_no) VALUES ('One', 'R-1'), ('Two', 'R-1'), ('Three', NULL), ('Four', NULL)`);
    await stage(version('0.2.1', [{ ref: 'ref_no', type: 'text', maxLength: 20, nullable: true, unique: true }]));
    expect(await editsOf('0.2.1', 'notes')).toEqual([{ kind: 'add-unique', column: 'ref_no' }]);
    // Two rows share a value: said on the check, by name, and the update refused before anything moves.
    const checked = await plan('0.2.1');
    expect(checked.installable).toBe(false);
    expect(checked.problems).toEqual([expect.objectContaining({ code: 'UNIQUE_DUPLICATES', message: expect.stringContaining(`"${h.real('notes')}.ref_no"`) })]);
    const refused = await h.app.inject({ method: 'POST', url: '/apps/studio/update' });
    expect(refused.statusCode, refused.body).toBe(422);
    expect(await installed()).toBe('0.2.0');

    // Made to differ, the update gives the column its rule; empty values are not a value.
    await h.rows(`UPDATE ${h.real('notes')} SET ref_no = 'R-2' WHERE body = 'Two'`);
    const res = await h.app.inject({ method: 'POST', url: '/apps/studio/update' });
    expect(res.statusCode, res.body).toBe(200);
    await expect(h.rows(`INSERT INTO ${h.real('notes')} (body, ref_no) VALUES ('Again', 'R-1')`)).rejects.toThrow();
    await h.rows(`INSERT INTO ${h.real('notes')} (body) VALUES ('Five')`);
    // Under the installer's own name; on SQLite a unique index made in place, the table never copied.
    const steps = (await schemaChangesRepo(h.meta).listForConnection(h.connectionId)).flatMap((change) => change.steps).filter((step) => step.table.endsWith(h.real('notes')));
    expect(steps.map((step) => step.kind)).toEqual([dialect === 'sqlite' ? 'add-index' : 'add-unique']);
    if (dialect === 'sqlite') {
      const indexes = await h.rows(`SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = '${h.real('notes')}' AND sql IS NOT NULL`);
      expect(indexes.map((i) => [i['name'], /^CREATE UNIQUE INDEX/.test(String(i['sql']))])).toEqual([[`uq_${h.real('notes')}_ref_no`, true]]);
    }
    // …and the next check finds nothing left to do.
    await stage(version('0.2.2', [{ ref: 'ref_no', type: 'text', maxLength: 20, nullable: true, unique: true }]));
    expect(await editsOf('0.2.2', 'notes')).toEqual([]);
  }, 120_000);

  it.skipIf(!available)('keeps a number counted per parent row unique with its parent, added by an update or found without it', async () => {
    h = await installInvoicing(dialect, version('0.2.0', []));
    await h.rows(`INSERT INTO ${h.real('proposals')} (title) VALUES ('Harbour'), ('Mill')`);
    const [harbour, mill] = (await h.rows(`SELECT id FROM ${h.real('proposals')} ORDER BY id`)).map((row) => String(row['id']));
    const numbered = { ref: 'v', type: 'int', nullable: true, rules: { sequence: { gapless: true, scope: 'proposal_id' } } };
    await stage(version('0.2.1', [], [numbered]));
    expect(await editsOf('0.2.1', 'versions')).toEqual([{ kind: 'add-column', column: 'v' }]);
    const res = await h.app.inject({ method: 'POST', url: '/apps/studio/update' });
    expect(res.statusCode, res.body).toBe(200);
    // The same number under two proposals, but never twice under one.
    await h.rows(`INSERT INTO ${h.real('versions')} (proposal_id, v) VALUES (${harbour!}, 1), (${mill!}, 1)`);
    await expect(h.rows(`INSERT INTO ${h.real('versions')} (proposal_id, v) VALUES (${harbour!}, 1)`)).rejects.toThrow();
    await stage(version('0.2.2', [], [numbered]));
    expect(await editsOf('0.2.2', 'versions')).toEqual([]);
  }, 120_000);

  it.skipIf(!available)('gives a per-parent number found without its rule the rule, as a fresh install has it', async () => {
    h = await installInvoicing(dialect, version('0.2.0', [], [{ ref: 'v', type: 'int', nullable: true }]));
    await h.rows(`INSERT INTO ${h.real('proposals')} (title) VALUES ('Harbour')`);
    const harbour = String((await h.rows(`SELECT id FROM ${h.real('proposals')}`))[0]!['id']);
    await h.rows(`INSERT INTO ${h.real('versions')} (proposal_id, v) VALUES (${harbour}, 1), (${harbour}, 2)`);
    await stage(version('0.2.1', [], [{ ref: 'v', type: 'int', nullable: true, rules: { sequence: { gapless: true, scope: 'proposal_id' } } }]));
    expect(await editsOf('0.2.1', 'versions')).toEqual([{ kind: 'add-unique', column: 'v', with: ['proposal_id'] }]);
    const res = await h.app.inject({ method: 'POST', url: '/apps/studio/update' });
    expect(res.statusCode, res.body).toBe(200);
    await expect(h.rows(`INSERT INTO ${h.real('versions')} (proposal_id, v) VALUES (${harbour}, 2)`)).rejects.toThrow();
  }, 120_000);

  it.skipIf(!available)('finds nothing to add to the tables a fresh install made', async () => {
    h = await installInvoicing(dialect);
    const res = await h.app.inject({ method: 'POST', url: '/apps/plan', payload: { key: 'studio', version: '0.2.0', connectionId: h.connectionId } });
    expect(res.statusCode, res.body).toBe(200);
    const tables = (res.json() as { plan: { tables: { ref: string; edits: unknown[] }[] } }).plan.tables;
    expect(tables.filter((t) => t.edits.length > 0)).toEqual([]);
    expect(tables.map((t) => t.ref).sort()).toEqual(invoicingTables().map((t) => String(t['ref'])).sort());
  }, 120_000);
});
