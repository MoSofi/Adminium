// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A move the clock makes renews a code as any change does, on every engine:
 * a ticket offered to a friend whose offer runs out goes back to the sender
 * with the friend's address emptied by the timed move (`timed[].set`), and
 * the code sent to the friend is made again in the same write — the friend's
 * old code finds nothing from then on.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { runTimedMoves } from '../src/states/timed-moves.js';
import { installInvoicing, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';

const id = { ref: 'id', type: 'int', role: 'pk' };

function passes(): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'passes',
    name: 'Passes',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'MIT',
    description: { key: 'd', fallback: 'A box office' },
    categories: ['crm'],
    compatibility: { minAdminiumVersion: '0.3.1' },
    requiredSchema: {
      prefixed: true,
      tables: [
        {
          ref: 'tickets',
          columns: [
            id,
            { ref: 'status', type: 'enum', enum: ['valid', 'offered'], default: 'valid' },
            { ref: 'pending_email', type: 'text', maxLength: 254, nullable: true },
            { ref: 'door_code', type: 'text', maxLength: 16, nullable: true, rules: { code: { length: 16, renew: { on: { column: 'pending_email', changed: true } } } } },
            { ref: 'offer_until', type: 'timestamptz', nullable: true, rules: { stamp: { set: { addMinutes: { hours: 48 } }, on: { column: 'status', values: ['offered'] } } } },
          ],
          states: {
            column: 'status',
            initial: 'valid',
            moves: { valid: ['offered'], offered: ['valid'] },
            timed: [{ from: 'offered', to: 'valid', at: { column: 'offer_until' }, set: { pending_email: null } }],
          },
        },
      ],
    },
    pages: [{ ref: 'overview', template: 'page-dashboard', title: { key: 't', fallback: 'Overview' }, nav: { group: 'passes', icon: 'home', order: 1 } }],
    frontends: [{ side: 'staff', kind: 'spa' }],
  };
}

describe.each(LEGS)('a timed move renews a code as any change does — %s', (dialect, available) => {
  let h: InvoicingHarness;
  let w: Awaited<ReturnType<typeof writerFor>>;
  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, passes());
    w = await writerFor(h, 'Europe/London');
  }, 180_000);
  afterAll(async () => {
    if (available) await h.close();
  });
  afterEach(() => vi.useRealTimers());
  const at = (when: string) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(when));
  };
  const ticket = async (key: unknown) => (await h.rows(`select * from ${h.real('tickets')} where id = ${String(key)}`))[0]!;

  it.runIf(available)("makes the friend's link again when their offer runs out and the ticket goes back", async () => {
    at('2026-07-28T15:30:00Z');
    const made = await w.create('tickets', { status: 'valid' });
    const own = (await ticket(made['id']))['door_code'];
    await w.update('tickets', made['id'], { status: 'offered', pending_email: 'kai@example.com' });
    const sent = (await ticket(made['id']))['door_code'];
    expect(sent).not.toBe(own);
    at('2026-07-30T15:31:00Z');
    const tick = await runTimedMoves({ meta: h.meta, manager: h.manager }, h.connectionId, {}, new Date('2026-07-30T15:31:00Z'));
    expect(tick.moved).toBe(1);
    const back = await ticket(made['id']);
    expect([back['status'], back['pending_email']]).toEqual(['valid', null]);
    expect(back['door_code']).not.toBe(sent);
    expect(String(back['door_code'])).toMatch(/^[0-9A-Z]{16}$/);
  });
});
