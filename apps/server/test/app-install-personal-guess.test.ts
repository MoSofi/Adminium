// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The validator's guess of personal data from a column's name is the
 * install's: for each column of a people table and of an orders table, what
 * the installed table masks is exactly what `personalColumn` says — so an
 * entry anyone may call is refused by the validator for the very columns the
 * install would refuse it for, never fewer. On every engine.
 */
import { parseDatabaseModel } from '@adminium/engine';
import { personalColumn, validateManifest } from '@adminium/manifest';
import { overridesRepo, snapshotsRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyOverrides, columnPolicyFor } from '../src/connections/effective-schema.js';
import { installInvoicing, invoicingManifest, LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';

type Doc = Record<string, unknown>;
const id = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, more: Doc = {}) => ({ ref, type: 'text', maxLength: 80, nullable: true, ...more });

const TABLES: Doc[] = [
  {
    ref: 'patients',
    columns: [
      id,
      text('email'),
      text('first_name'),
      text('last_name'),
      text('name'),
      text('mobile_number'),
      text('home_address'),
      text('photo_street'),
      { ref: 'dob', type: 'date', nullable: true },
      text('iban'),
      text('passport_no'),
      text('avatar_url'),
      text('company_name'),
      text('note'),
      text('venue_phone', { rules: { personal: false } }),
      text('allergies', { rules: { personal: true } }),
      // Kept as text: an enum is read by its name as any text column.
      { ref: 'home_city', type: 'enum', enum: ['Dublin', 'Cork'], nullable: true },
      { ref: 'blood_group', type: 'enum', enum: ['A', 'B'], nullable: true },
    ],
  },
  {
    ref: 'bookings',
    columns: [id, text('contact_email'), text('full_name'), text('title'), { ref: 'party', type: 'int', default: 1 }, text('last_ip')],
  },
];

function manifest(): Doc {
  const m = invoicingManifest(TABLES);
  m['key'] = 'guess';
  (m['pages'] as { bindings: Record<string, string> }[])[0]!.bindings = { rows: 'bookings' };
  return m;
}

describe.each(LEGS)("the validator's personal-data guess is the install's — %s", (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, manifest());
  }, 180_000);
  afterAll(async () => {
    if (available) await h.close();
  });

  it.skipIf(!available)('masks exactly the columns it guesses or is told are personal', async () => {
    const result = validateManifest(manifest());
    if (!result.ok || result.manifest.kind !== 'app') throw new Error(JSON.stringify(result));
    const snapshot = await snapshotsRepo(h.meta).latest(h.connectionId);
    const overrides = await overridesRepo(h.meta).listForConnection(h.connectionId);
    const model = applyOverrides(parseDatabaseModel(snapshot!.schema), overrides.filter((o) => o.status === 'active'));
    const seen: Record<string, string[]> = {};
    for (const declared of result.manifest.requiredSchema.tables) {
      const table = model.tables.find((t) => t.name === h.real(declared.ref))!;
      const masked = [...columnPolicyFor(table).masked].sort();
      const guessed = declared.columns.map((c) => c.ref).filter((ref) => personalColumn(declared as never, ref) !== null).sort();
      expect(guessed, declared.ref).toEqual(masked);
      seen[declared.ref] = masked;
    }
    // What that is, so the comparison is never two empty lists.
    expect(seen['patients']).toEqual(['allergies', 'dob', 'email', 'first_name', 'home_address', 'home_city', 'iban', 'last_name', 'mobile_number', 'passport_no', 'photo_street']);
    expect(seen['bookings']).toEqual(['contact_email', 'full_name', 'last_ip']);
  });
});
