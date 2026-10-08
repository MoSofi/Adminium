// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A LINE WHOSE RULE HAS NO LINK BEHIND IT IS REFUSED, NOT PASSED OVER.
 *
 * A line's rule fires when the row it hangs under moves, and that row is
 * found by the database's own foreign key. Where the column the rule names
 * is a plain number there (it was made one before it was declared a link),
 * nothing could ever be posted for the line: it was saved, its parent moved,
 * and the add-on heard nothing. Such a line is now refused when it is made.
 *
 * The column is named `under` on purpose: a name like `job_id` beside a
 * `jobs` table is read as a link by its name alone, and the rule then runs.
 */
import { overridesRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PostingRefusedError } from '../src/errors.js';
import { LEGS } from './invoicing-install.helpers.js';
import { ledgerWorld, type LedgerWorld } from './ledger.helpers.js';

const USE = (id: string) => ({
  id,
  into: { addOn: 'ledger-kit', ledger: 'units', action: 'use' },
  via: 'under',
  map: { account: 'account_id', quantity: 'qty' },
  post: { on: { column: 'status', in: ['done'] } },
  // A line taken off by its own column: the line's own point, not its job's.
  reverse: { on: { column: 'voided_at', set: true, own: true } },
});
const LINE = `under INT NULL, account_id INT NULL, qty DECIMAL(12,3) NULL, voided_at VARCHAR(40) NULL`;

describe.each(LEGS)('a line under a rule with no link — %s', (dialect, available) => {
  let w: LedgerWorld;
  const taken = async () => String((await w.h.rows('SELECT taken FROM ledger_kit_accounts WHERE id = 1'))[0]!['taken']);

  beforeAll(async () => {
    if (!available) return;
    w = await ledgerWorld(dialect, {
      jobs: { columns: 'status VARCHAR(20) NULL', postings: [] },
      // The link is its own line: MySQL reads no other.
      linked_lines: { columns: `${LINE}, FOREIGN KEY (under) REFERENCES jobs(id)`, postings: [USE('linked')] },
      // The same column and the same rule, and no foreign key.
      loose_lines: { columns: LINE, postings: [USE('loose')] },
    });
    await w.h.rows(`INSERT INTO ledger_kit_accounts (id, name, opening, taken, balance, allow_below, reorder_at) VALUES (1, 'Flour', 10, 0, 10, ${w.flag(false)}, 2)`);
  }, 180_000);
  afterAll(async () => {
    if (available) await w.close();
  });

  it.skipIf(!available)('a line the database links is saved, and posted when its job is done', async () => {
    const job = await w.create('jobs', { status: 'open' });
    await w.create('linked_lines', { under: job['id'], account_id: 1, qty: '2' });
    expect(Number(await taken())).toBe(0);
    await w.update('jobs', job['id'], { status: 'done' });
    expect(Number(await taken())).toBe(2);
  });

  it.skipIf(!available)('a line the database does not link is refused when it is made, and nothing is written', async () => {
    const job = await w.create('jobs', { status: 'open' });
    const refused = await w.create('loose_lines', { under: job['id'], account_id: 1, qty: '3' }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(refused).toBeInstanceOf(PostingRefusedError);
    expect((refused as PostingRefusedError).details).toMatchObject({ reason: 'add-on-unavailable', posting: 'loose', column: 'under' });
    // Said as what it is: no wait mends it.
    expect((refused as PostingRefusedError).message).toBe('This cannot be saved: the rule that hands it to an add-on follows a link this table does not have. Updating the app, or linking the column, mends it.');
    expect(await w.h.rows('SELECT id FROM loose_lines')).toEqual([]);
  });

  it.skipIf(!available)('with its rule switched off the line is saved, as any rule that is off lets it', async () => {
    const id = w.target('loose_lines').table.id;
    await overridesRepo(w.h.meta).create({ connectionId: w.h.connectionId, op: 'table.switchedOff', tableName: id, columnName: null, value: { postings: ['loose'] }, origin: 'user' } as never);
    await w.reload();
    const job = await w.create('jobs', { status: 'open' });
    const line = await w.create('loose_lines', { under: job['id'], account_id: 1, qty: '3' });
    expect((await w.h.rows('SELECT id FROM loose_lines')).length).toBe(1);

    // The rule on again, the line from before is still there to be taken off: nothing was handed over for it, so nothing refuses.
    const off = (await overridesRepo(w.h.meta).listForConnection(w.h.connectionId, { status: 'active' })).find((row) => row.op === 'table.switchedOff')!;
    await overridesRepo(w.h.meta).delete(off.id);
    await w.reload();
    await w.update('loose_lines', line['id'], { voided_at: 'now' });
    expect((await w.h.rows(`SELECT voided_at FROM loose_lines WHERE id = ${String(line['id'])}`))[0]!['voided_at']).toBe('now');
    // …and a new one is still refused.
    await expect(w.create('loose_lines', { under: job['id'], account_id: 1, qty: '1' })).rejects.toBeInstanceOf(PostingRefusedError);
  });
});
