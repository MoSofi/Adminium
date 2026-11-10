// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A STAMP THAT NEVER MOVES A DATE EARLIER (`notEarlier`).
 *
 * A print job's ready-by is told to the customer. A change request moves it a
 * working day on; the approval stamps it again as so many working days from
 * that moment. The told date may never come forward, so the approval writes
 * the LATER of the date the job holds and the one it works out:
 *
 * - an empty ready-by takes the new date;
 * - a ready-by before it moves on to it;
 * - a ready-by after it stays.
 *
 * And a write of history (an import's own value) is not stamped at all, as
 * for every stamp. On every engine this run can reach, through an app
 * installed by the real installer.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { venueClock } from '../src/crud/venue-time.js';
import { dayPlus } from '../src/crud/moments.js';
import { installInvoicing, invoicingManifest, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';

vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.53' }));

const id = { ref: 'id', type: 'int', role: 'pk' };
const ALL_WEEK = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

function manifest(): Record<string, unknown> {
  const m = invoicingManifest([
    {
      ref: 'jobs',
      columns: [
        id,
        { ref: 'stage', type: 'enum', enum: ['proofing', 'approved'], default: 'proofing' },
        {
          ref: 'ready_by',
          type: 'date',
          nullable: true,
          rules: { stamp: { set: { addWorkingDays: { from: 'now', days: 3, weekdays: ALL_WEEK } }, on: { column: 'stage', values: ['approved'] }, notEarlier: true } },
        },
      ],
    },
  ]);
  m['key'] = 'works';
  (m['pages'] as { bindings: Record<string, string> }[])[0]!.bindings = { rows: 'jobs' };
  m['frontends'] = [{ side: 'staff', kind: 'spa', entry: 'index.html' }];
  m['compatibility'] = { minAdminiumVersion: '0.3.53' };
  return m;
}

const day = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return `${String(value.getFullYear())}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  return String(value).slice(0, 10);
};

describe.each(LEGS)('a stamp that never moves a date earlier, on %s', (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let w: Awaited<ReturnType<typeof writerFor>>;
  let today = '';
  const readyBy = async (key: unknown) => day((await h.rows(`select ready_by from ${h.real('jobs')} where id = ${String(key)}`))[0]!['ready_by']);
  const approved = async (held: string | null) => {
    const job = await w.create('jobs', held === null ? {} : { ready_by: held });
    await w.update('jobs', job['id'], { stage: 'approved' });
    return readyBy(job['id']);
  };

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, manifest());
    expect((h.reply['rules'] as { skipped: unknown[] }).skipped).toEqual([]);
    await h.meta.db.updateTable('adminium_connections').set({ timezone: 'Europe/London' } as never).where('id', '=', h.connectionId).execute();
    w = await writerFor(h, 'Europe/London');
    today = venueClock(new Date(), 'Europe/London').day;
  }, 180_000);
  afterAll(async () => {
    if (!available) return;
    await h.close();
  });

  it.skipIf(!available)('gives an empty ready-by the new date', async () => {
    expect(await approved(null)).toBe(dayPlus(today, 3));
  });

  it.skipIf(!available)('moves an earlier ready-by on to the new date', async () => {
    expect(await approved(dayPlus(today, -2))).toBe(dayPlus(today, 3));
    expect(await approved(dayPlus(today, 2))).toBe(dayPlus(today, 3));
  });

  it.skipIf(!available)('keeps a ready-by later than the new date: the told day never comes forward', async () => {
    expect(await approved(dayPlus(today, 4))).toBe(dayPlus(today, 4));
    expect(await approved(dayPlus(today, 30))).toBe(dayPlus(today, 30));
  });

  it.skipIf(!available)("stamps nothing on a write of history: an import's own date stands", async () => {
    const job = await w.create('jobs', { ready_by: dayPlus(today, -5) });
    await w.update('jobs', job['id'], { stage: 'approved', ready_by: dayPlus(today, -5) }, { ...w.desk, origin: 'import' });
    expect(await readyBy(job['id'])).toBe(dayPlus(today, -5));
  });
});
