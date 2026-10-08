// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN ADD-ON'S CODE IS TOLD WHAT DAY IT IS WHERE THE VENUE IS.
 *
 * The code that decides what a posting writes reads no clock of its own: it
 * is handed `now`, `zone` and `today`. Today is the venue's calendar day — a
 * batch good until today is still good at six in the evening in Portland,
 * when UTC already reads tomorrow. And the zone is the venue's whatever else
 * the table's rules read of a clock: a plain table that only posts has one too.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadDecider } from '../src/add-ons/decide.js';
import { plannerClock } from '../src/crud/ledger-write.js';
import type { PostedOutcome } from '../src/crud/ledger-write.js';
import { LEGS } from './invoicing-install.helpers.js';
import { DESK, ledgerWorld, type LedgerWorld } from './ledger.helpers.js';

describe('the clock handed to an add-on\'s code', () => {
  it('reads today on the venue\'s calendar, not on UTC\'s', () => {
    // 01:00 UTC on the 20th is 18:00 on the 19th in Portland, and 15:00 on the 20th in Kiritimati.
    const at = new Date('2026-10-20T01:00:00.000Z');
    expect(plannerClock(at, 'America/Los_Angeles')).toEqual({ now: '2026-10-20T01:00:00.000Z', today: '2026-10-19', zone: 'America/Los_Angeles' });
    expect(plannerClock(at, 'Pacific/Kiritimati').today).toBe('2026-10-20');
    // 23:30 UTC on the 20th is already the 21st in Berlin.
    expect(plannerClock(new Date('2026-10-20T23:30:00.000Z'), 'Europe/Berlin').today).toBe('2026-10-21');
  });

  it('does not stop a save over a zone no calendar knows: the instant\'s own day stands', () => {
    expect(plannerClock(new Date('2026-10-20T23:30:00.000Z'), 'Mars/Olympus')).toEqual({ now: '2026-10-20T23:30:00.000Z', today: '2026-10-20', zone: 'Mars/Olympus' });
  });

  it('is UTC\'s where no zone is known', () => {
    expect(plannerClock(new Date('2026-10-20T23:30:00.000Z'), undefined)).toEqual({ now: '2026-10-20T23:30:00.000Z', today: '2026-10-20', zone: 'UTC' });
  });
});

/** A deciding file that writes nothing and tells back the clock it was handed. */
const TELLS_THE_CLOCK = `module.exports = { rows: function (input) {
  return { rows: [], notes: input.lines.length === 0 ? [] : [{ line: input.lines[0].line, note: 'to-check', item: input.today + ' ' + input.zone }] };
} };`;
const TALLY = { id: 'tally', into: { addOn: 'ledger-kit', ledger: 'units', action: 'count' }, map: { account: 'account_id', quantity: 'qty' }, post: { on: { create: true } } };

describe.each(LEGS)('a table that only posts is on the venue\'s clock — %s', (dialect, available) => {
  let w: LedgerWorld;
  beforeAll(async () => {
    if (!available) return;
    // No stamp, no state, no limit: nothing on this table reads a clock but its posting.
    w = await ledgerWorld(dialect, { tallies: { columns: 'account_id INT NULL, qty DECIMAL(12,3) NULL', postings: [TALLY] } });
    await w.h.rows(`INSERT INTO ledger_kit_accounts (id, name, opening, taken, balance, allow_below, reorder_at) VALUES (1, 'Flour', 10, 0, 10, ${w.flag(false)}, 2)`);
  }, 180_000);
  afterAll(async () => {
    if (available) await w.close();
  });

  it.skipIf(!available)('its add-on is handed the connection\'s zone and that zone\'s day', async () => {
    // A zone whose calendar day is never UTC's at this hour: the far east of the date line, or the far west.
    const zone = new Date().getUTCHours() >= 11 ? 'Pacific/Kiritimati' : 'Pacific/Pago_Pago';
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    expect(day).not.toBe(new Date().toISOString().slice(0, 10));
    const decider = loadDecider({ key: 'ledger-kit', version: '1.0.0', path: 'dist/server.js', bytes: Buffer.from(TELLS_THE_CLOCK) });
    const writes = w.service({ decider: (key) => (key === 'ledger-kit' ? decider : null) }, { timezoneOf: async () => zone });
    let posted: PostedOutcome[] = [];
    // The save is handed no zone of its own, as a request is not: the write service finds the connection's.
    await writes.create({
      target: { ...w.target('tallies'), timezone: undefined },
      values: { account_id: 1, qty: '1' },
      context: DESK,
      announce: async (_row, _values, outcomes) => {
        posted = [...(outcomes ?? [])];
      },
    });
    expect(posted.flatMap((one) => (one.notes ?? []).map((note) => (note as { item?: string }).item))).toEqual([`${day} ${zone}`]);
  });
});
