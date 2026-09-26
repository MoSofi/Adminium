// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A date column reads as the day it holds, `YYYY-MM-DD`, on every engine and
 * in every zone this server may run in.
 *
 * Postgres and MySQL handed a `date` back as a JavaScript date at this
 * process's local midnight: in Berlin `2026-08-14` came back through the data
 * API as `2026-08-13T22:00:00.000Z`, and an export, a CSV and anything else
 * that printed it named the day before. SQLite already answered with the
 * text. Run this file under `TZ=Europe/Berlin`, `America/Los_Angeles` and
 * `Asia/Kolkata`: every door answers the same day, and a save that leaves
 * the date alone keeps it.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { serializeCsvField } from '../src/data-io/csv.js';
import { cellText } from '../src/export/writer.js';
import { canonicalValue } from '../src/crud/seal.js';
import { dayOf } from '../src/outbox/timing.js';
import { LEGS, installInvoicing, invoicingManifest, type InvoicingHarness } from './invoicing-install.helpers.js';
import { dataRoutesOver, type DataRoutes } from './invoicing-routes.helpers.js';
import { settledWriter } from './invoicing-writes.helpers.js';

const manifest = () =>
  invoicingManifest([
    {
      ref: 'visits',
      columns: [
        { ref: 'id', type: 'int', role: 'pk' },
        { ref: 'on_day', type: 'date', nullable: true },
        { ref: 'note', type: 'text', maxLength: 80, nullable: true },
      ],
    },
  ]);

let open: InvoicingHarness | null = null;
let routes: DataRoutes | null = null;
afterEach(async () => {
  await routes?.close();
  routes = null;
  await open?.close();
  open = null;
});

for (const [dialect, available] of LEGS) {
  describe.skipIf(!available)(`a date column on ${dialect} (TZ=${process.env['TZ'] ?? 'unset'})`, () => {
    it('reads as the day it holds through every door, and keeps it through a save that leaves it alone', async () => {
      const h = (open = await installInvoicing(dialect, manifest()));
      const w = await settledWriter(h);
      const made = await w.create('visits', { on_day: '2026-08-14', note: 'first' });
      expect(made['on_day']).toBe('2026-08-14');
      const [raw] = await h.rows(`select on_day from ${h.real('visits')} where id = ${String(made['id'])}`);
      expect(raw!['on_day']).toBe('2026-08-14');

      // The data API: the record, and a save of another column.
      routes = await dataRoutesOver(h, dialect);
      const r = routes;
      const url = `/api/v1/data/${r.connectionId}/${r.table('visits')}/${String(made['id'])}`;
      const read = await r.t.app.inject({ method: 'GET', url, headers: { 'x-test-user-id': r.t.users.admin.id } });
      expect(read.statusCode, read.body).toBe(200);
      expect(read.body).toContain('"on_day":"2026-08-14"');
      const saved = await r.patch('visits', made['id'], { values: { note: 'second' } });
      expect(saved.statusCode, saved.body).toBe(200);
      const [after] = await h.rows(`select on_day from ${h.real('visits')} where id = ${String(made['id'])}`);
      expect(after!['on_day']).toBe('2026-08-14');

      // What prints or compares it: an export cell, a CSV field, a fingerprint, an outbox due date.
      const value = raw!['on_day'];
      expect(cellText(value, false)).toBe('2026-08-14');
      expect(serializeCsvField(value)).toBe('2026-08-14');
      expect(canonicalValue({ logicalType: 'date' }, value, {}, null)).toBe('2026-08-14');
      expect(dayOf({ logicalType: 'date' }, value, 'Pacific/Kiritimati')).toBe('2026-08-14');
    });
  });
}
