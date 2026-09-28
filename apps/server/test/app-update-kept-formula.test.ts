// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An app update that keeps a formula as it was is judged again, as a fresh
 * install would judge it, on every engine.
 *
 * Wren House 0.2.0 marks `label` personal and joins a guest's first and last
 * names into it; the operator marks `first_name` personal in Studio. 0.2.1
 * keeps the same formula and drops the mark. The update used to keep the
 * unchanged formula without asking again, so every new stay wrote a guest's
 * name into a column every reader sees. It is now taken back, and the update
 * says so, as an install of 0.2.1 would skip it.
 */
import { parseDatabaseModel } from '@adminium/engine';
import { overridesRepo, snapshotsRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sha512Integrity } from '../src/add-ons/store.js';
import { packageTarball } from './app-bundle-helpers.js';
import { installInvoicing, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';
import { wrenManifest, wrenTables } from './wren-house-fixture.js';

type Doc = Record<string, unknown>;
const JOIN = { join: ['first_name', ' ', 'last_name'] };

/** Wren House with a `label` beside `guest_name`, carrying `rules`. */
function hotel(version: string, rules: Doc): Doc {
  const tables = wrenTables();
  const columns = tables.find((table) => table['ref'] === 'stays')!['columns'] as Doc[];
  columns.splice(
    columns.findIndex((column) => column['ref'] === 'guest_name'),
    1,
    { ref: 'guest_name', type: 'text', maxLength: 130, nullable: true },
    { ref: 'label', type: 'text', maxLength: 130, nullable: true, rules },
  );
  const manifest = wrenManifest(tables);
  manifest['version'] = version;
  return manifest;
}

describe.each(LEGS)('an unchanged formula an update keeps — %s', (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let update: { statusCode: number; body: string };

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, hotel('0.2.0', { personal: true, formula: JOIN }));
    // The operator, in Studio: a guest's first name is personal data.
    const stays = parseDatabaseModel((await snapshotsRepo(h.meta).latest(h.connectionId))!.schema).tables.find((table) => table.name === h.real('stays'))!;
    await overridesRepo(h.meta).create({ connectionId: h.connectionId, op: 'column.pii', tableName: stays.id, columnName: 'first_name', value: { masked: true, kind: 'name' } });
    const tarball = packageTarball({ 'manifest.json': JSON.stringify(hotel('0.2.1', { formula: JOIN })), 'staff/index.html': '<!doctype html><html></html>' });
    const staged = await h.app.inject({
      method: 'POST',
      url: `/apps/upload?expectedSha512=${encodeURIComponent(sha512Integrity(tarball))}`,
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.from(tarball),
    });
    expect(staged.statusCode, staged.body).toBe(200);
    const planned = await h.app.inject({ method: 'POST', url: '/apps/plan', payload: { key: 'wren', version: '0.2.1', connectionId: h.connectionId } });
    expect(planned.statusCode, planned.body).toBe(200);
    const checksum = (planned.json() as { plan: { checksum: string } }).plan.checksum;
    update = await h.app.inject({ method: 'POST', url: '/apps/wren/update', payload: { planChecksum: checksum } });
  }, 360_000);

  afterAll(async () => {
    if (!available) return;
    await h.close();
  });

  it.skipIf(!available)('takes the formula back once its column is no longer personal, and says so', async () => {
    expect(update.statusCode, update.body).toBe(200);
    const skipped = (JSON.parse(update.body) as { app: { rules: { skipped: { column: string; op: string; reason: string }[] } } }).app.rules.skipped;
    expect(skipped.filter((s) => s.column === 'label')).toEqual([
      expect.objectContaining({ op: 'column.formula', reason: expect.stringContaining('first_name') }),
    ]);
    const active = await overridesRepo(h.meta).listForConnection(h.connectionId, { status: 'active' });
    expect(active.filter((o) => o.columnName === 'label').map((o) => o.op)).not.toContain('column.formula');
    // The operator's own mark stays.
    expect(active.filter((o) => o.op === 'column.pii' && o.columnName === 'first_name')).toHaveLength(1);
    // A new stay keeps the guest's name out of the column everyone reads.
    const w = await writerFor(h);
    await w.create('settings', {});
    const type = await w.create('room_types', { code: 'garden', name: 'Garden', base_rate: '150.00', sleeps: 2 });
    const stay = await w.create('stays', { first_name: 'Ada', last_name: 'Lovelace', room_type_id: type['id'], arrive: '2026-10-05', depart: '2026-10-07' });
    const [row] = await h.rows(`SELECT label FROM ${h.real('stays')} WHERE id = ${String(stay['id'])}`);
    expect(row?.['label'] ?? null).toBeNull();
  });
});
