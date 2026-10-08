// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE RULE THAT MAKES AN APP'S TABLE POST INTO AN ADD-ON'S LEDGER, WRITTEN
 * FROM THE ADD-ON'S MANIFEST.
 *
 * The columns the action needs, the rule with the add-on's own input names,
 * and what the app must name and may read. Every refusal says what to write.
 */
import { postingsSchema } from '@adminium/manifest';
import { describe, expect, it } from 'vitest';

import { inputsInWords, ledgerParts, type LedgerPartsInput } from '../src/project/apps/ledger-parts.js';
import { ledgerKitManifest } from './fixtures/ledger-kit/index.js';

const kit = ledgerKitManifest();
const lines = () => ({
  ref: 'visit_supplies',
  columns: [
    { ref: 'id', type: 'int', role: 'pk' },
    { ref: 'visit_id', type: 'fk', references: 'visits' },
  ],
});
const seen = { column: 'status', in: ['seen'] };
const back = { column: 'status', from: ['seen'], in: ['booked', 'cancelled'] };
const ask = (over: Partial<LedgerPartsInput> = {}) => ledgerParts({ addOn: 'ledger-kit', document: kit, ledger: 'units', action: 'use', table: lines(), via: 'visit_id', when: { post: seen, reverse: back }, ...over });
const problem = (over: Partial<LedgerPartsInput>) => {
  const made = ask(over);
  return made.ok ? 'no problem' : made.problem;
};

describe('the parts of a table that posts into a ledger', () => {
  it('adds a link column for a link input and a number column for a quantity, and maps both by the add-on\'s names', () => {
    const made = ask();
    expect(made.ok, made.ok ? '' : made.problem).toBe(true);
    if (!made.ok) return;
    expect(made.added).toEqual([
      { column: 'account_id', type: 'int', links: 'ledger-kit.accounts' },
      { column: 'qty', type: 'decimal, scale 4' },
    ]);
    expect((made.table['columns'] as unknown[]).slice(2)).toEqual([
      { ref: 'account_id', type: 'int', nullable: true, rules: { addOnLink: { addOn: 'ledger-kit', table: 'accounts' } } },
      { ref: 'qty', type: 'decimal', scale: 4 },
    ]);
    expect(made.posting).toEqual({
      id: 'units',
      into: { addOn: 'ledger-kit', ledger: 'units', action: 'use' },
      via: 'visit_id',
      post: { on: seen },
      reverse: { on: back },
      map: { account: 'account_id', quantity: 'qty' },
    });
    // The manifest's own schema takes the rule as written.
    expect(postingsSchema.safeParse(made.table['postings']).success).toBe(true);
    expect(made.addOn).toEqual({ key: 'ledger-kit', name: 'Ledger kit', range: '>=1.0.0' });
    expect(made.grants.map((grant) => grant.table)).toEqual(['accounts']);
    expect(made.feature).toBeNull();
  });

  it('a column the table already has is used, not added; a link column without its link is given one', () => {
    const table = lines();
    table.columns.push({ ref: 'units_used', type: 'decimal', scale: 2 } as never, { ref: 'account', type: 'int' } as never);
    const made = ask({ table, columns: { quantity: 'units_used', account: 'account' } });
    expect(made.ok, made.ok ? '' : made.problem).toBe(true);
    if (!made.ok) return;
    expect(made.posting.map).toEqual({ account: 'account', quantity: 'units_used' });
    expect(made.added).toEqual([{ column: 'account', type: 'int', links: 'ledger-kit.accounts' }]);
    expect((made.table['columns'] as unknown[]).length).toBe(4);
  });

  it('an optional input is mapped only when it is named', () => {
    const table = lines();
    table.columns.push({ ref: 'remark', type: 'text' } as never);
    const made = ask({ table, columns: { note: 'remark' } });
    expect(made.ok && made.posting.map).toEqual({ account: 'account_id', quantity: 'qty', note: 'remark' });
  });

  it('the row itself is handed over for an input that takes a row', () => {
    const made = ask({ action: 'adopt', when: { post: { create: true } }, via: undefined, columns: undefined });
    expect(made.ok && made.posting.map).toEqual({ what: { row: true }, name: 'name' });
    expect(made.ok && made.added).toEqual([{ column: 'name', type: 'text' }]);
  });

  it('an input that takes a row may be the row a link of this table points at', () => {
    const linked = ask({ action: 'adopt', when: { post: { create: true } }, columns: { what: 'visit_id' } });
    expect(linked.ok && linked.posting.map).toEqual({ what: 'visit_id', name: 'name' });
    expect(problem({ action: 'adopt', when: { post: { create: true } }, columns: { what: 'id' } })).toContain('"id" is int, not a link ("type": "fk").');
  });

  it('a second call replaces its own rule and nothing else', () => {
    const first = ask();
    if (!first.ok) throw new Error(first.problem);
    const other = { id: 'cards', into: { addOn: 'cards-kit', ledger: 'cards', action: 'pay' }, post: { on: { create: true } }, map: {} };
    const second = ask({ table: { ...first.table, postings: [other, ...(first.table['postings'] as unknown[])] }, when: { post: { create: true } } });
    if (!second.ok) throw new Error(second.problem);
    expect(second.added).toEqual([]);
    expect(second.table['columns']).toEqual(first.table['columns']);
    expect((second.table['postings'] as { id: string }[]).map((posting) => posting.id)).toEqual(['cards', 'units']);
    expect((second.table['postings'] as { post: unknown }[])[1]!.post).toEqual({ on: { create: true } });
  });

  it('with "suggests" the rule is live only under a feature named for the add-on', () => {
    const made = ask({ need: 'suggests' });
    expect(made.ok && made.feature).toBe('ledger-kit');
    expect(made.ok && made.posting.needs).toBe('ledger-kit');
  });

  it('a held action needs heldUntil: a time column of the table', () => {
    const hold = { reserve: { create: true }, post: seen, reverse: back };
    expect(problem({ when: hold })).toBe('This action holds stock until a time: give a date-time column of your table in "columns" as "heldUntil".');
    expect(problem({ when: hold, columns: { heldUntil: 'visit_id' } })).toBe('This action holds stock until a time: give a date-time column of your table in "columns" as "heldUntil" ("visit_id" is fk, not a time).');
    const table = lines();
    table.columns.push({ ref: 'keep_until', type: 'timestamptz' } as never);
    const made = ask({ table, when: hold, columns: { heldUntil: 'keep_until' } });
    expect(made.ok && made.posting.heldUntil).toBe('keep_until');
    expect(made.ok && made.posting.reserve).toEqual({ on: { create: true } });
    // Not reserving: nothing is held, and nothing is asked.
    expect(ask().ok).toBe(true);
  });

  it('a column of the wrong type is refused by name, with what to write', () => {
    const table = lines();
    table.columns.push({ ref: 'qty', type: 'text' } as never, { ref: 'account_id', type: 'text' } as never);
    expect(problem({ table, columns: { account: 'visit_id' } })).toContain('"visit_id" is fk in tables/visit_supplies.json, and "account" is a link to a row of ledger-kit.accounts: a whole number.');
    table.columns.pop();
    expect(problem({ table })).toBe(
      '"qty" is text in tables/visit_supplies.json, and the quantity must be a number. Change its type to "decimal" with "scale": 3, or name another column in "columns": { "quantity": "<column>" }.',
    );
  });

  it('what the add-on does not have is refused with what it does have', () => {
    expect(problem({ ledger: 'stocks' })).toBe('ledger-kit has no ledger "stocks". Its ledgers: units. Its actions for an app\'s rows: use, adopt.');
    expect(problem({ action: 'take' })).toBe('ledger-kit/units has no action "take". Its actions for an app\'s rows: use, adopt.');
    expect(problem({ columns: { amount: 'visit_id' } })).toBe('"amount" is not an input of ledger-kit/units/use. Its inputs are account, quantity, note (optional).');
    expect(problem({ columns: { quantity: 'nope' } })).toContain('"nope" is not a column of tables/visit_supplies.json.');
    expect(problem({ document: { kind: 'add-on', addOn: {} } })).toContain('keeps no ledger an app\'s rows post into');
    expect(inputsInWords({ inputs: { item: 'link', place: 'link?' } })).toBe('item, place (optional)');
  });

  it('a moment that is not one, a step the action has not, and a link that is not one are refused', () => {
    expect(problem({ when: {} })).toBe('Give "when": the change that takes the stock (reserve or post), and "reverse", the change that gives it back.');
    expect(problem({ when: { post: { when: 'paid' } } })).toContain('"when.post" is not a moment a rule fires at.');
    expect(problem({ action: 'adopt', when: { post: { create: true }, reverse: back } })).toBe('ledger-kit/units/adopt has no "reverse". It takes: post. Give "when" for those.');
    expect(problem({ via: 'id' })).toContain('"id" is not a link ("type": "fk")');
    expect(problem({ via: 'order_id' })).toContain('"order_id" is not a column of it');
  });
});
