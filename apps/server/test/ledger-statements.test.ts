// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT A POSTING COSTS — counted in statements, on Postgres.
 *
 * An add-on's rows are written by the steps a create with child rows is
 * written by: prepared in memory, inserted, their parents held once, judged
 * once, settled once. Not by a create of each: that would prepare, hold,
 * judge and settle every row on its own, five times the statements for an
 * order of six lines. This test counts what one such order sends, so a change
 * that goes back to a write a row is seen.
 */
import type { KyselyPlugin } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { WriteTarget } from '../src/crud/write-context.js';
import { LEGS } from './invoicing-install.helpers.js';
import { DESK, ledgerWorld, type LedgerWorld } from './ledger.helpers.js';

/** The lines of an order, each taken from its own account as the order is counted. */
const LINE = {
  id: 'line',
  into: { addOn: 'ledger-kit', ledger: 'units', action: 'count' },
  via: 'order_id',
  map: { account: 'account_id', quantity: 'qty' },
  post: { on: { column: 'status', in: ['counted'] } },
};

/**
 * The most statements an order of six lines on six accounts may send, its
 * own seven rows included. Counted when this was written: 133 — the order
 * and its lines (7 inserts), a receipt a line (6), the entries (6), and for
 * each of the six accounts seven updates (its two totals, its flag and its
 * balance, once while it is held and once as it is settled) and five or six
 * reads (the rows the add-on is handed, the cap, the flag before and after);
 * the rest is the lock call and the transaction. It grows with the accounts
 * touched, never with their square. A create of each entry on its own would
 * send some thirty a row more: about 310.
 */
const MOST = 146;

describe.each(LEGS.filter(([dialect]) => dialect === 'postgres'))('what a posting costs — %s', (dialect, available) => {
  let w: LedgerWorld;

  beforeAll(async () => {
    if (!available) return;
    w = await ledgerWorld(dialect, {
      orders: { columns: 'status VARCHAR(20) NULL', postings: [] },
      order_lines: { columns: 'order_id INT NULL, account_id INT NULL, qty DECIMAL(12,3) NULL, FOREIGN KEY (order_id) REFERENCES orders(id)', postings: [LINE] },
    });
    const accounts = Array.from({ length: 6 }, (_, index) => `(${String(index + 1)}, 'Account ${String(index + 1)}', 100, 0, 100, ${w.flag(false)}, 0)`).join(', ');
    await w.h.rows(`INSERT INTO ledger_kit_accounts (id, name, opening, taken, balance, allow_below, reorder_at) VALUES ${accounts}`);
  }, 180_000);
  afterAll(async () => {
    if (available) await w.close();
  });

  it.skipIf(!available)(`an order of six lines on six accounts sends at most ${String(MOST)} statements, whatever it writes`, async () => {
    let sent = 0;
    const counting: KyselyPlugin = {
      transformQuery: (args) => {
        sent += 1;
        return args.node;
      },
      transformResult: async (args) => args.result,
    };
    const counted = (name: string): WriteTarget => {
      const target = w.target(name);
      return { ...target, db: target.db.withPlugin(counting) };
    };
    const save = () =>
      w.writes.createTree({
        root: {
          name: 'orders',
          target: counted('orders'),
          values: { status: 'counted' },
          at: [],
          children: Array.from({ length: 6 }, (_, index) => ({ name: 'order_lines', target: counted('order_lines'), values: { account_id: index + 1, qty: '1' }, via: { column: 'order_id', parentKey: 'id' }, at: ['order_lines', index], children: [] })),
        },
        context: DESK,
        mode: 'save',
        announce: async () => undefined,
        mapError: (error) => {
          throw error;
        },
      });
    // Once to warm what is read once a process (grants, the settings row's shape); the second is the one counted.
    await save();
    sent = 0;
    const made = await save();
    expect(made.postings).toMatchObject([{ posting: 'line', phase: 'post', rows: 6 }]);
    expect(await w.count('ledger_kit_entries')).toBe(12);
    expect(sent).toBeGreaterThan(20);
    expect(sent, `an order of six lines sent ${String(sent)} statements`).toBeLessThanOrEqual(MOST);
  });
});
