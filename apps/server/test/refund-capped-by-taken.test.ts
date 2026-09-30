// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Money given back never more than money taken, on every engine, with the
 * vocabulary a stay already has: two filtered totals over its payments, the
 * second keeping a capped balance of the first (`refundable = taken −
 * given_back`). A refund past what was taken is refused `BALANCE_EXCEEDED`;
 * a void of a payment taken, leaving too little to cover what went back, too.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { installInvoicing, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';

const id = { ref: 'id', type: 'int', role: 'pk' };

function house(): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'house',
    name: 'House',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'MIT',
    description: { key: 'd', fallback: 'A small hotel' },
    categories: ['crm'],
    compatibility: { minAdminiumVersion: '0.3.1' },
    requiredSchema: {
      prefixed: true,
      tables: [
        {
          ref: 'stays',
          columns: [
            id,
            { ref: 'taken', type: 'decimal', scale: 2, default: 0, rules: { rollup: { from: 'payments', via: 'stay_id', sum: 'amount', where: { column: 'kind', eq: 'taken' } } } },
            {
              ref: 'given_back',
              type: 'decimal',
              scale: 2,
              default: 0,
              rules: { rollup: { from: 'payments', via: 'stay_id', sum: 'amount', where: { column: 'kind', eq: 'given_back' }, balance: { column: 'refundable', of: 'taken' }, cap: true } },
            },
            { ref: 'refundable', type: 'decimal', scale: 2, default: 0 },
          ],
        },
        {
          ref: 'payments',
          columns: [id, { ref: 'stay_id', type: 'fk', references: 'stays' }, { ref: 'kind', type: 'enum', enum: ['taken', 'given_back'] }, { ref: 'amount', type: 'decimal', scale: 2 }],
        },
      ],
    },
    pages: [{ ref: 'overview', template: 'page-dashboard', title: { key: 't', fallback: 'Overview' }, nav: { group: 'house', icon: 'home', order: 1 } }],
    frontends: [{ side: 'staff', kind: 'spa' }],
  };
}

describe.each(LEGS)('money given back capped by money taken — %s', (dialect, available) => {
  let h: InvoicingHarness;
  let w: Awaited<ReturnType<typeof writerFor>>;
  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, house());
    w = await writerFor(h, 'UTC');
  }, 180_000);
  afterAll(async () => {
    if (available) await h.close();
  });

  it.runIf(available)('gives back up to what was taken, and no more', async () => {
    const stay = await w.create('stays', {});
    await w.create('payments', { stay_id: stay['id'], kind: 'taken', amount: '300.00' });
    await w.create('payments', { stay_id: stay['id'], kind: 'given_back', amount: '120.00' });
    await expect(w.create('payments', { stay_id: stay['id'], kind: 'given_back', amount: '180.01' })).rejects.toMatchObject({ code: 'BALANCE_EXCEEDED' });
    await expect(w.create('payments', { stay_id: stay['id'], kind: 'given_back', amount: '180.00' })).resolves.toBeDefined();
    const [row] = await h.rows(`SELECT taken, given_back, refundable FROM ${h.real('stays')} WHERE id = ${String(stay['id'])}`);
    expect([row!['taken'], row!['given_back'], row!['refundable']].map((v) => Number(v))).toEqual([300, 300, 0]);
  });

  it.runIf(available)('refuses taking back a payment that covers money already given back', async () => {
    const stay = await w.create('stays', {});
    const paid = await w.create('payments', { stay_id: stay['id'], kind: 'taken', amount: '100.00' });
    await w.create('payments', { stay_id: stay['id'], kind: 'given_back', amount: '60.00' });
    await expect(w.update('payments', paid['id'], { amount: '50.00' })).rejects.toMatchObject({ code: 'BALANCE_EXCEEDED' });
  });
});
