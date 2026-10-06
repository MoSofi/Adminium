// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A COLUMN HELD TO PLAIN TEXT — a name or a note shown to people who did not
 * write it (the name on a gift card, a note to the kitchen) may send nobody
 * anywhere: no web address, no email address, no handle, only so many digits.
 * The rule is the column's own, so it holds every way of writing the row: a
 * staff save, a change, an import — where an entry's own plain-text list only
 * ever judged a guest.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { WriteContext } from '../src/crud/write-context.js';
import { installInvoicing, invoicingManifest, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';
import { ledgerWorld, type LedgerWorld } from './ledger.helpers.js';

const IMPORT: WriteContext = { origin: 'import', hops: 0, actor: { kind: 'user', id: 'usr_ivy', label: 'Ivy' }, request: null };

const CARDS = {
  ref: 'cards',
  columns: [
    { ref: 'id', type: 'int', role: 'pk' },
    // A name: letters only, eighty characters.
    { ref: 'holder_name', type: 'text', maxLength: 200, nullable: true, rules: { plainText: true } },
    // A note with bounds of its own: up to four digits, forty characters.
    { ref: 'message', type: 'text', maxLength: 200, nullable: true, rules: { plainText: { digits: 4, max: 40 } } },
    // No rule: whatever is typed.
    { ref: 'memo', type: 'text', maxLength: 200, nullable: true },
  ],
};

const refusal = async (run: Promise<unknown>) => {
  try {
    await run;
  } catch (error) {
    return error as { code?: string; statusCode?: number; details?: { fields?: Record<string, { code: string }> } };
  }
  throw new Error('the save went through');
};

describe.each(LEGS)('a column held to plain text — %s', (dialect, available) => {
  let h: InvoicingHarness | undefined;
  let w: Awaited<ReturnType<typeof writerFor>>;

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, { ...invoicingManifest([CARDS]), compatibility: { minAdminiumVersion: '0.3.18' } });
    w = await writerFor(h);
  }, 180_000);
  afterAll(async () => h?.close());

  it.skipIf(!available)('a name with a web address, an email address or a digit is refused by its column; a name is a name', async () => {
    for (const name of ['Claim your refund at evil.com', 'ava@example.com', 'www.example.org', 'Ava 2', '@ava', 'a/b']) {
      const error = await refusal(w.create('cards', { holder_name: name }));
      expect(error, name).toMatchObject({ code: 'VALIDATION_FAILED', statusCode: 422, details: { fields: { holder_name: { code: 'plain-text' } } } });
    }
    for (const name of ['Ava Reyes', 'J.R.R. Tolkien', 'Mary.Ann', 'São João', '李小龍', 'مريم']) {
      expect((await w.create('cards', { holder_name: name }))['holder_name'], name).toBe(name);
    }
    // Empty is not text to judge; and a column with no rule holds whatever is typed.
    expect((await w.create('cards', { holder_name: null, memo: 'see https://example.com/x?y=1' }))['memo']).toBe('see https://example.com/x?y=1');
    expect((await w.create('cards', { holder_name: '' }))['id']).toBeDefined();
  });

  it.skipIf(!available)('a note may hold as many digits and characters as its own rule says, and no more', async () => {
    expect((await w.create('cards', { message: 'Table 12, at 7' }))['message']).toBe('Table 12, at 7');
    expect(await refusal(w.create('cards', { message: 'Call 01234' }))).toMatchObject({ details: { fields: { message: { code: 'plain-text' } } } });
    expect(await refusal(w.create('cards', { message: 'x'.repeat(41) }))).toMatchObject({ details: { fields: { message: { code: 'plain-text' } } } });
    expect(await refusal(w.create('cards', { message: 'Happy birthday. More at gifts.shop' }))).toMatchObject({ details: { fields: { message: { code: 'plain-text' } } } });
  });

  it.skipIf(!available)('a change and an import\'s row are held to it like a create; a change that leaves the column alone is not judged', async () => {
    const id = (await w.create('cards', { holder_name: 'Ava Reyes', memo: 'a' }))['id'];
    expect(await refusal(w.update('cards', id, { holder_name: 'evil.com' }))).toMatchObject({ code: 'VALIDATION_FAILED', details: { fields: { holder_name: { code: 'plain-text' } } } });
    await w.update('cards', id, { memo: 'b' });
    expect((await h!.rows(`SELECT holder_name, memo FROM ${h!.real('cards')} WHERE id = ${String(id)}`))[0]).toMatchObject({ holder_name: 'Ava Reyes', memo: 'b' });
    // An import brings history in, and a name is still a name: the row with an address in it is that row's own refusal.
    const checked = await w.writes.check('create', w.targetOf('cards'), IMPORT, [{ holder_name: 'Noor Haddad' }, { holder_name: 'refund-desk.com' }], { capacity: 'unchecked' });
    expect(checked.issues).toEqual([null, { holder_name: { code: 'plain-text' } }]);
  });
});

describe.each(LEGS)('a row an add-on\'s own code writes is held to plain text too — %s', (dialect, available) => {
  let w: LedgerWorld;
  /** Taken as the row is counted; whatever is typed into `memo` is handed to the add-on, which writes it as the entry's note. */
  const TAKE = { id: 'take', into: { addOn: 'ledger-kit', ledger: 'units', action: 'use' }, map: { account: 'account_id', quantity: 'qty', note: 'memo' }, post: { on: { column: 'status', in: ['taken'] } }, reverse: { on: { column: 'status', in: ['undone'] } } };

  beforeAll(async () => {
    if (!available) return;
    w = await ledgerWorld(dialect, { takes: { columns: 'account_id INT NULL, qty DECIMAL(12,3) NULL, status VARCHAR(20) NULL, memo VARCHAR(200) NULL', postings: [TAKE] } });
    await w.h.rows(`INSERT INTO ledger_kit_accounts (id, name, opening, taken, balance, allow_below, reorder_at) VALUES (1, 'Flour', 100, 0, 100, ${w.flag(false)}, 2)`);
  }, 180_000);
  afterAll(async () => {
    if (available) await w.close();
  });

  it.skipIf(!available)('a note the add-on would write with an address in it fails the save whole; a plain one is written', async () => {
    await w.create('takes', { account_id: 1, qty: '1', status: 'taken', memo: 'For table 12' });
    expect((await w.h.rows(`SELECT note FROM ledger_kit_entries ORDER BY id`)).map((row) => row['note'])).toEqual(['For table 12']);
    // The owner's own column has no such rule, so the row itself would be taken: it is the add-on's row that is refused, and nothing is saved.
    const error = await refusal(w.create('takes', { account_id: 1, qty: '1', status: 'taken', memo: 'refunds at evil.com' }));
    expect(error).toMatchObject({ code: 'POSTING_REFUSED', details: { reason: 'planner-failed' } });
    expect(await w.count('takes')).toBe(1);
    expect(await w.count('ledger_kit_entries')).toBe(1);
  });
});
