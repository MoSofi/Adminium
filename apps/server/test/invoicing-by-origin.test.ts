// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A `byOrigin` stamp whose word for one side is itself a stamp word —
 * `today`, `now`, `user-name`, `user-id` — writes what that word means, as a
 * plain stamp of it would: the venue's date, the moment, the person. Any
 * other word is written as it is. A side with no word leaves the writer's
 * own value.
 *
 * A client approving a proposal in the portal stamps the day they approved it
 * (`approved_on: byOrigin {public: 'today'}`); the desk recording an approval
 * says the day itself.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { decideRow, stampYields } from '../src/crud/decide.js';
import type { ColumnStamp, TableRules } from '../src/crud/column-rules.js';
import type { WriteContext } from '../src/crud/write-service.js';
import { venueClock } from '../src/crud/venue-time.js';
import { LEGS, installInvoicing, invoicingManifest, type InvoicingHarness } from './invoicing-install.helpers.js';
import { seedSettings, setConnectionCurrency, settledWriter, writeTables } from './invoicing-writes.helpers.js';

type Table = { ref: string; columns: Record<string, unknown>[] } & Record<string, unknown>;

/** Proposals that record the day and how they were approved. */
function manifest(): Record<string, unknown> {
  const tables = (writeTables() as Table[]).map(({ states: _states, ...table }): Table => {
    if (table.ref !== 'proposals') return table as Table;
    const on = { column: 'status', values: ['accepted'] };
    return {
      ...(table as Table),
      columns: [
        ...(table as Table).columns,
        { ref: 'approved_on', type: 'date', nullable: true, rules: { stamp: { set: { byOrigin: { public: 'today' } }, on } } },
        { ref: 'approved_via', type: 'text', maxLength: 24, nullable: true, rules: { stamp: { set: { byOrigin: { public: 'portal', staff: 'desk' } }, on } } },
      ],
    };
  });
  return invoicingManifest(tables);
}

let open: InvoicingHarness | null = null;
afterEach(async () => {
  await open?.close();
  open = null;
});

const guest: WriteContext = { origin: 'public', hops: 0, actor: { kind: 'public', id: null, label: 'public:key' }, request: null };

/** A `date` column's day, however the engine hands it back. */
const dayOf = (value: unknown): string =>
  value instanceof Date
    ? `${String(value.getFullYear())}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
    : String(value).slice(0, 10);

describe('a byOrigin word that is a stamp word, as DECIDE writes it', () => {
  const stamp = (set: ColumnStamp['set'], logicalType: ColumnStamp['logicalType']): ColumnStamp => ({ column: 'x', set, on: 'create', logicalType });
  const context = (origin: WriteContext['origin']) => ({
    db: null as never,
    dialect: 'postgres' as const,
    table: { columns: new Map() } as never,
    origin,
    actor: origin === 'public' ? { kind: 'public' as const, id: null, label: 'public:key' } : { kind: 'user' as const, id: 'usr_ivy', label: 'Ivy' },
    now: new Date('2026-09-25T23:30:00Z'),
    zone: 'Pacific/Auckland',
  });
  const decide = async (set: ColumnStamp['set'], origin: WriteContext['origin'], logicalType: ColumnStamp['logicalType'] = 'text', values: Record<string, unknown> = {}) =>
    (await decideRow({ fills: [], checks: [], stamps: [stamp(set, logicalType)] } as TableRules, 'create', values, null, context(origin)))['x'];

  it('writes the venue’s date, the moment and the person, and any other word as it is', async () => {
    // 23:30 UTC on 25 September is already the 26th in Auckland.
    expect(await decide({ byOrigin: { public: 'today' } }, 'public', 'date')).toBe('2026-09-26');
    expect(await decide({ byOrigin: { public: 'now', staff: 'now' } }, 'dashboard', 'timestamptz')).toEqual(expect.stringMatching(/^2026-09-25/));
    expect(await decide({ byOrigin: { public: 'portal', staff: 'user-name' } }, 'dashboard')).toBe('Ivy');
    expect(await decide({ byOrigin: { public: 'portal', staff: 'user-id' } }, 'dashboard')).toBe('usr_ivy');
    expect(await decide({ byOrigin: { public: 'portal', staff: 'desk' } }, 'dashboard')).toBe('desk');
    // A guest is nobody: their side's person word writes nothing, and nothing of theirs.
    expect(await decide({ byOrigin: { public: 'user-name' } }, 'public', 'text', { x: 'Mo' })).toBeUndefined();
    // No staff word: the staff's own value stands.
    expect(await decide({ byOrigin: { public: 'today' } }, 'dashboard', 'date', { x: '2026-01-02' })).toBe('2026-01-02');
  });

  it("counts as Adminium's under a lock only what it really writes", () => {
    expect(stampYields({ set: { byOrigin: { public: 'today' } } }, 'public', null)).toBe(true);
    expect(stampYields({ set: { byOrigin: { public: 'user-name', staff: 'user-name' } } }, 'public', null)).toBe(false);
    expect(stampYields({ set: { byOrigin: { public: 'user-name', staff: 'user-name' } } }, 'dashboard', null)).toBe(true);
    expect(stampYields({ set: { byOrigin: { public: 'today' } } }, 'dashboard', null)).toBe(false);
  });
});

for (const [dialect, available] of LEGS) {
  describe.skipIf(!available)(`a byOrigin stamp of today on ${dialect}`, () => {
    it("stamps the venue's date for a client's approval, and keeps the day the desk says", async () => {
      const h = await installInvoicing(dialect, manifest());
      open = h;
      // Every rule kept: a date column takes a stamp of today, whichever side says it.
      expect((h.reply['rules'] as { skipped: unknown[] }).skipped).toEqual([]);
      await seedSettings(h);
      await setConnectionCurrency(h, 'EUR');
      const w = await settledWriter(h);
      const client = await w.create('clients', { email: 'ann@example.test', name: 'Ann' });
      const row = async (id: unknown) => (await h.rows(`select * from ${h.real('proposals')} where id = ${String(id)}`))[0]!;

      const online = await w.create('proposals', { client_id: client['id'], status: 'sent' });
      await w.update('proposals', online['id'], { status: 'accepted', approved_on: '1999-01-01', approved_via: 'desk' }, guest);
      const approved = await row(online['id']);
      expect(dayOf(approved['approved_on'])).toBe(venueClock(new Date(), 'Europe/London').day);
      expect(approved['approved_via']).toBe('portal');

      const byPhone = await w.create('proposals', { client_id: client['id'], status: 'sent' });
      await w.update('proposals', byPhone['id'], { status: 'accepted', approved_on: '2026-01-02' });
      const recorded = await row(byPhone['id']);
      expect(dayOf(recorded['approved_on'])).toBe('2026-01-02');
      expect(recorded['approved_via']).toBe('desk');
    });
  });
}
