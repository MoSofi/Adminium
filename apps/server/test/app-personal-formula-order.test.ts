// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A formula over personal data, into a column the app marks personal, on every
 * engine: a hotel's `guest_name` joined from a guest's first and last names,
 * which read as personal by their names beside the guest's address.
 *
 * The install checks a copy, a stamp's copy or a formula against the marks
 * written so far. It used to write a column's rules in one order, its formula
 * before its own `personal`, so the check found the names personal and the
 * column not yet: the formula was skipped and `guest_name` stayed empty on
 * every row. Every mark is now in before any such check, on an install and on
 * an update that marks a column personal.
 */
import { parseDatabaseModel } from '@adminium/engine';
import { overridesRepo, snapshotsRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sha512Integrity } from '../src/add-ons/store.js';
import { keptColumnIssue } from '../src/connections/column-rules-validation.js';
import { applyOverrides } from '../src/connections/effective-schema.js';
import { packageTarball } from './app-bundle-helpers.js';
import { installInvoicing, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';
import { wrenManifest, wrenTables } from './wren-house-fixture.js';

type Doc = Record<string, unknown>;
const JOIN = { join: ['first_name', ' ', 'last_name'] };
const MARKED = { personal: true, formula: JOIN };

/** Wren House with the guest's address beside their names, and `guest_name` carrying `rules`. */
function hotel(version: string, rules: Doc | undefined): Doc {
  const tables = wrenTables();
  const columns = tables.find((table) => table['ref'] === 'stays')!['columns'] as Doc[];
  columns.splice(
    columns.findIndex((column) => column['ref'] === 'guest_name'),
    1,
    { ref: 'guest_name', type: 'text', maxLength: 130, nullable: true, ...(rules === undefined ? {} : { rules }) },
    { ref: 'email', type: 'text', maxLength: 254, nullable: true },
  );
  const manifest = wrenManifest(tables);
  manifest['version'] = version;
  return manifest;
}

describe.each(LEGS)('a formula over personal data into a column marked personal — %s', (dialect, available) => {
  let fresh: InvoicingHarness & { reply: Record<string, unknown> };
  let updated: InvoicingHarness;

  beforeAll(async () => {
    if (!available) return;
    fresh = await installInvoicing(dialect, hotel('0.2.0', MARKED));
    // The same app installed without the name, then updated to a version that adds it, marked personal.
    updated = await installInvoicing(dialect, hotel('0.2.0', undefined));
    const tarball = packageTarball({ 'manifest.json': JSON.stringify(hotel('0.2.1', MARKED)), 'staff/index.html': '<!doctype html><html></html>' });
    const staged = await updated.app.inject({
      method: 'POST',
      url: `/apps/upload?expectedSha512=${encodeURIComponent(sha512Integrity(tarball))}`,
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.from(tarball),
    });
    expect(staged.statusCode, staged.body).toBe(200);
    const planned = await updated.app.inject({ method: 'POST', url: '/apps/plan', payload: { key: 'wren', version: '0.2.1', connectionId: updated.connectionId } });
    expect(planned.statusCode, planned.body).toBe(200);
    const checksum = (planned.json() as { plan: { checksum: string } }).plan.checksum;
    const res = await updated.app.inject({ method: 'POST', url: '/apps/wren/update', payload: { planChecksum: checksum } });
    expect(res.statusCode, res.body).toBe(200);
  }, 360_000);

  afterAll(async () => {
    if (!available) return;
    await fresh.close();
    await updated.close();
  });

  const formulaOn = async (h: InvoicingHarness) =>
    (await overridesRepo(h.meta).listForConnection(h.connectionId, { status: 'active' })).filter((o) => o.op === 'column.formula' && o.columnName === 'guest_name');

  /** A stay booked through the desk, and the name stored on its row. */
  const bookedName = async (h: InvoicingHarness) => {
    const w = await writerFor(h);
    await w.create('settings', {});
    const type = await w.create('room_types', { code: 'garden', name: 'Garden', base_rate: '150.00', sleeps: 2 });
    const stay = await w.create('stays', {
      first_name: 'Ada',
      last_name: 'Lovelace',
      email: 'ada@example.com',
      room_type_id: type['id'],
      arrive: '2026-10-05',
      depart: '2026-10-07',
    });
    const [row] = await h.rows(`SELECT guest_name FROM ${h.real('stays')} WHERE id = ${String(stay['id'])}`);
    return row?.['guest_name'];
  };

  it.runIf(available)('is written on install and fills the name of a new stay', async () => {
    const skipped = (fresh.reply['rules'] as { skipped: { column: string; op: string; reason: string }[] }).skipped;
    expect(skipped.filter((s) => s.column === 'guest_name'), JSON.stringify(skipped)).toEqual([]);
    expect(await formulaOn(fresh)).toHaveLength(1);
    expect(await bookedName(fresh)).toBe('Ada Lovelace');
  });

  it.runIf(available)('still keeps the same names out of a column that is not marked', async () => {
    const snapshot = (await snapshotsRepo(fresh.meta).latest(fresh.connectionId))!;
    const model = applyOverrides(parseDatabaseModel(snapshot.schema), await overridesRepo(fresh.meta).listForConnection(fresh.connectionId, { status: 'active' }));
    const stays = model.tables.find((table) => table.name === fresh.real('stays'))!;
    const issue = keptColumnIssue('column.formula', { formula: JOIN }, { table: stays.id, column: 'note' }, model, new Map());
    expect(issue).toContain('is personal data, so no formula reads it unless it is marked personal too.');
  });

  it.runIf(available)('is written when an update marks the column personal', async () => {
    expect(await formulaOn(updated)).toHaveLength(1);
    expect(await bookedName(updated)).toBe('Ada Lovelace');
  });
});
