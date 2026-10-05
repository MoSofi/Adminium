// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Ledgers and postings as one manifest can check them: the declaration, the
 * receipt table, a posting's points and mappings, the fit of a posting with
 * the action it names, and the column rules that came with them.
 */
import { describe, expect, it } from 'vitest';

import { installFloorWords, ledgersOf, ledgersSchema, postingFitIssues, postingSchema, validateManifest, type Ledger, type Manifest, type Posting } from '../src/index.js';
import { LEDGER, LEDGER_HOST, LEDGER_KIT, RECEIPTS } from './ledger-kit-fixture.js';

type Doc = Record<string, unknown>;
interface TableDoc {
  ref: string;
  columns: Doc[];
  postings?: Doc[];
  states?: Doc;
}

const issuesOf = (doc: unknown): string[] => {
  const result = validateManifest(doc);
  return result.ok ? [] : result.issues.map((issue) => `${issue.path}: ${issue.message}`);
};

/** The kit with one table changed, or the ledger, or anything at the top. */
function kit(over: { table?: [string, (table: TableDoc) => TableDoc]; ledger?: Doc; addOn?: Doc; top?: Doc } = {}): Doc {
  const doc = structuredClone(LEDGER_KIT) as unknown as { requiredSchema: { tables: TableDoc[] }; addOn: Doc };
  if (over.table !== undefined) {
    const [ref, change] = over.table;
    doc.requiredSchema.tables = doc.requiredSchema.tables.map((table) => (table.ref === ref ? change(table) : table));
  }
  if (over.ledger !== undefined) doc.addOn = { ...doc.addOn, ledgers: [{ ...structuredClone(LEDGER), ...over.ledger }] };
  if (over.addOn !== undefined) doc.addOn = { ...doc.addOn, ...over.addOn };
  return { ...(doc as unknown as Doc), ...(over.top ?? {}) };
}

function host(table: string, change: (table: TableDoc) => TableDoc, top: Doc = {}): Doc {
  const doc = structuredClone(LEDGER_HOST) as unknown as { requiredSchema: { tables: TableDoc[] } };
  doc.requiredSchema.tables = doc.requiredSchema.tables.map((candidate) => (candidate.ref === table ? change(candidate) : candidate));
  return { ...(doc as unknown as Doc), ...top };
}
const posting = (over: Doc) => (table: TableDoc): TableDoc => ({ ...table, postings: [{ ...(table.postings ?? [])[0], ...over }] });
const column = (ref: string, change: (column: Doc) => Doc) => (table: TableDoc): TableDoc => ({ ...table, columns: table.columns.map((c) => (c['ref'] === ref ? change(c) : c)) });

describe('the two fixtures', () => {
  it('validate, and the add-on\'s ledgers read back typed', () => {
    expect(issuesOf(LEDGER_KIT)).toEqual([]);
    expect(issuesOf(LEDGER_HOST)).toEqual([]);
    const result = validateManifest(LEDGER_KIT);
    expect(result.ok && ledgersOf(result.manifest as Manifest).map((ledger) => [ledger.id, Object.keys(ledger.actions)])).toEqual([['units', ['use', 'count']]]);
  });

  it('use words that need the install floor', () => {
    expect(new Set(installFloorWords(LEDGER_KIT).map((found) => found.word))).toEqual(
      new Set(['addOn.ledgers', 'requiredSchema.prefixed', 'table.postings', 'states.planned', 'column.tableRef', 'column.announce', 'rollup.capUnless']),
    );
    expect(new Set(installFloorWords(LEDGER_HOST).map((found) => found.word))).toEqual(new Set(['table.postings', 'column.addOnLink', 'column.plainText', 'column.customerKey']));
    expect(issuesOf({ ...LEDGER_HOST, compatibility: { minAdminiumVersion: '0.3.17' } }).join('\n')).toContain('"table.postings" is read by Adminium 0.3.18 and later');
  });
});

describe('a ledger declaration', () => {
  it('takes one to four ledgers with distinct ids, each with a receipt table, writes and actions', () => {
    expect(ledgersSchema.safeParse([LEDGER]).success).toBe(true);
    expect(ledgersSchema.safeParse([LEDGER, LEDGER]).success).toBe(false);
    expect(ledgersSchema.safeParse([{ ...LEDGER, actions: {} }]).success).toBe(false);
    expect(ledgersSchema.safeParse([{ ...LEDGER, writes: {} }]).success).toBe(false);
    expect(ledgersSchema.safeParse([{ ...LEDGER, refusal: 'money' }]).success).toBe(false);
  });

  it('an action reads at most six times, by known sources, and never deletes', () => {
    const action = LEDGER.actions.use;
    const withReads = (reads: unknown[]) => ledgersSchema.safeParse([{ ...LEDGER, actions: { use: { ...action, reads } } }]).success;
    const read = (as: string, from: unknown) => ({ as, table: 'accounts', by: [{ column: 'id', from }] });
    expect(withReads(Array.from({ length: 6 }, (_, i) => read(`r${String(i)}`, 'input.account')))).toBe(true);
    expect(withReads(Array.from({ length: 7 }, (_, i) => read(`r${String(i)}`, 'input.account')))).toBe(false);
    expect(withReads([read('a', ['input.account', 'accounts.id', 'source.row'])])).toBe(true);
    expect(withReads([read('a', 'input.what.table'), read('b', 'setting.low_below'), read('c', 'uses.voucher')])).toBe(true);
    expect(withReads([read('a', 'now')])).toBe(false);
    expect(withReads([read('a', 'input.account'), read('a', 'input.account')])).toBe(false);
    expect(ledgersSchema.safeParse([{ ...LEDGER, writes: { entries: { delete: true } } }]).success).toBe(false);
  });

  it('is refused in the manifest with the place it is written', () => {
    expect(issuesOf(kit({ ledger: { refusal: 'money' } })).join('\n')).toContain('addOn.ledgers.0.refusal');
  });

  it('needs the add-on to provide posting-rows exactly once', () => {
    expect(issuesOf(kit({ addOn: { provides: [] } })).join('\n')).toContain('an add-on with ledgers provides the contract "posting-rows" exactly once');
    const twice = [{ contract: 'posting-rows', version: 1, server: 'dist/a.js' }, { contract: 'posting-rows', version: 1, server: 'dist/b.js' }];
    expect(issuesOf(kit({ addOn: { provides: twice } })).join('\n')).toContain('exactly once');
  });
});

describe('the receipt table', () => {
  const receipts = (change: (table: TableDoc) => TableDoc) => issuesOf(kit({ table: ['postings', change] })).join('\n');

  it('is exactly what Adminium writes', () => {
    expect(RECEIPTS.columns).toHaveLength(17);
    expect(receipts((table) => ({ ...table, columns: table.columns.filter((c) => c['ref'] !== 'round') }))).toContain('a receipt table has a column "round" (int)');
    expect(receipts((table) => ({ ...table, columns: [...table.columns, { ref: 'memo', type: 'text', maxLength: 40, nullable: true }] }))).toContain('take out "memo"');
    expect(receipts(column('phase', (c) => ({ ...c, enum: ['reserve', 'post'] })))).toContain('"postings.phase" takes exactly "reserve", "post", "reverse"');
  });

  it('a receipt key column is never nullable, and held_until always is', () => {
    expect(receipts(column('source_line', (c) => ({ ...c, nullable: true })))).toContain('"postings.source_line" is part of every receipt: it is never nullable');
    expect(receipts(column('held_until', (c) => ({ ...c, nullable: false })))).toContain('"postings.held_until" is empty while nothing is held: make it nullable');
  });

  it('holds its table names as stored names, in bounded text', () => {
    expect(receipts(column('source_table', (c) => ({ ref: c['ref'], type: 'text', maxLength: 128 })))).toContain('"postings.source_table" holds a table\'s stored name: give it rules.tableRef');
    expect(receipts(column('source_row', (c) => ({ ref: c['ref'], type: 'text' })))).toContain('"postings.source_row" needs a maxLength');
  });

  it('is one of the add-on\'s own tables', () => {
    expect(issuesOf(kit({ ledger: { receipts: 'receipts' } })).join('\n')).toContain('addOn.ledgers.0.receipts: "receipts" is not one of this add-on\'s tables');
  });
});

describe('a posting', () => {
  it('declares when it reserves or posts, with at most six on a table and one id each', () => {
    expect(issuesOf(host('order_lines', posting({ reserve: undefined, post: undefined }))).join('\n')).toContain('a posting declares when it reserves, when it posts, or both');
    const six = (table: TableDoc): TableDoc => ({ ...table, postings: Array.from({ length: 7 }, (_, i) => ({ ...(table.postings ?? [])[0], id: `line-${String(i)}` })) });
    expect(issuesOf(host('order_lines', six))).not.toEqual([]);
    const twice = (table: TableDoc): TableDoc => ({ ...table, postings: [(table.postings ?? [])[0]!, (table.postings ?? [])[0]!] });
    expect(issuesOf(host('order_lines', twice)).join('\n')).toContain('two postings of the table share an id');
  });

  it('goes into an add-on the manifest names, switched by a feature that needs it', () => {
    expect(issuesOf(host('order_lines', posting({ into: { addOn: 'offers', ledger: 'value', action: 'spend' } }))).join('\n')).toContain('"offers" is not an add-on this manifest names');
    expect(issuesOf(host('order_lines', posting({ needs: 'printing' }))).join('\n')).toContain('"printing" is not one of the app\'s addOns.features');
    expect(issuesOf(host('order_lines', posting({ into: { addOn: 'ledger-host', ledger: 'units', action: 'use' } }))).join('\n')).toContain("a posting goes into an add-on's ledger, not into the app itself");
  });

  it('judges a state point on the row that has states: the via parent\'s', () => {
    expect(issuesOf(host('order_lines', posting({ post: { on: { to: ['shipped'] } } }))).join('\n')).toContain('"shipped" is not a state of "orders"');
    expect(issuesOf(host('order_lines', posting({ via: 'account_id' }))).join('\n')).toContain('"order_lines.account_id" is not a foreign key of the table');
    expect(issuesOf(host('visits', posting({ post: { on: { to: ['seen'] } } }))).join('\n')).toContain('"visits" declares no states to move between: name a column and its values instead');
  });

  it('a column point names a column of the judged row; "own" is said under via', () => {
    expect(issuesOf(host('visits', posting({ post: { on: { column: 'state', in: ['seen'] } } }))).join('\n')).toContain('"visits" has no column "state"');
    expect(issuesOf(host('visits', posting({ reverse: { on: { column: 'voided_at', set: true, own: true } } }))).join('\n')).toContain('"own" judges a point on the line itself: it is said under "via"');
    expect(issuesOf(host('order_lines', posting({ reverse: { on: { column: 'voided_at', set: true, own: true } } })))).toEqual([]);
    expect(issuesOf(host('visits', posting({ reverse: { on: { column: 'status', set: true } } }))).join('\n')).toContain('"visits.status" is never empty, so it is never "set"');
  });

  it('maps columns of the row, of the parent under via, a setting or a value', () => {
    expect(issuesOf(host('order_lines', posting({ map: { account: 'account', quantity: 'qty' } }))).join('\n')).toContain('"order_lines" has no column "account"');
    expect(issuesOf(host('order_lines', posting({ heldUntil: { parent: 'held' } }))).join('\n')).toContain('"orders" has no column "held"');
    expect(issuesOf(host('visits', posting({ map: { account: 'account_id', quantity: { parent: 'qty' } } }))).join('\n')).toContain('a column of the parent is read under "via"');
    expect(issuesOf(host('order_lines', posting({ unlessSet: 'removed_at' }))).join('\n')).toContain('"order_lines" has no column "removed_at"');
    expect(issuesOf(host('order_lines', posting({ only: { column: 'method', eq: 'card' } }))).join('\n')).toContain('"order_lines" has no column "method"');
  });

  it('never reads an input from a total or a balance settled in the same save', () => {
    const issues = issuesOf(kit({ table: ['requests', (table) => table] , top: {} }));
    expect(issues).toEqual([]);
    const fromTotal = kit({
      table: ['accounts', (table) => ({ ...table, postings: [{ id: 'self', into: { addOn: 'ledger-kit', ledger: 'units', action: 'count' }, post: { on: { create: true } }, map: { account: 'id', quantity: 'balance' } }] })],
    });
    expect(issuesOf(fromTotal).join('\n')).toContain('"accounts.balance" is a total Adminium settles in the same save, so the input "quantity" is not read from it');
  });

  it('makes how long a hold lasts Adminium\'s own: no public entry writes it, on the row or on the parent', () => {
    const entry = { table: 'orders', methods: ['POST'], select: ['status'], writable: ['hold_until'] };
    const doc = { ...(host('orders', (table) => table) as Doc), publicAccess: [entry] };
    expect(issuesOf(doc).join('\n')).toContain('"hold_until" is decided by Adminium and cannot be written publicly');
    expect(issuesOf({ ...doc, publicAccess: [{ ...entry, writable: ['buyer_email'] }] }).join('\n')).not.toContain('decided by Adminium');
  });

  it('names sibling lines of the same parent', () => {
    const refuses = (refusal: Doc) => issuesOf(host('order_lines', posting({ refuses: [refusal] }))).join('\n');
    expect(refuses({ column: 'voided_at', set: true })).toBe('');
    expect(refuses({ table: 'visits', column: 'voided_at', set: true })).toContain('"table" and "via" together');
    expect(refuses({ table: 'visits', via: 'account_id', column: 'voided_at', set: true })).toContain('"visits.account_id" is not a foreign key to the same parent');
  });
});

describe('a posting against the action it names', () => {
  const ledger = ledgersSchema.parse([LEDGER])[0] as Ledger;
  const base: Posting = postingSchema.parse({
    id: 'line',
    into: { addOn: 'ledger-kit', ledger: 'units', action: 'use' },
    reserve: { on: { create: true } },
    post: { on: { to: ['picked_up'] } },
    reverse: { on: { to: ['cancelled'] } },
    map: { account: 'account_id', quantity: 'qty' },
    heldUntil: 'hold_until',
  });
  const fit = (over: Partial<Posting>, timed = false) => postingFitIssues({ ...base, ...over }, ledger, { timed }).map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n');

  it('fits: every needed input mapped, an optional one left out', () => {
    expect(fit({})).toBe('');
  });

  it('names an action the ledger has, and its inputs', () => {
    expect(fit({ into: { addOn: 'ledger-kit', ledger: 'units', action: 'sell' } })).toContain('the ledger "units" has no action "sell": it has "use", "count"');
    expect(fit({ map: { account: 'account_id' } })).toContain('the action "use" needs "quantity" (decimal)');
    expect(fit({ map: { account: 'account_id', quantity: 'qty', colour: 'colour' } })).toContain('the action "use" takes no input "colour"');
  });

  it('declares only phases the action has', () => {
    expect(fit({ into: { addOn: 'ledger-kit', ledger: 'units', action: 'count' }, heldUntil: undefined })).toContain('the action "count" has no "reserve" phase');
  });

  it('a hold is given back, and lasts until a time', () => {
    expect(fit({ reverse: undefined })).toContain('the action "use" holds: say when the hold is given back ("reverse")');
    expect(fit({ heldUntil: undefined })).toContain('the action "use" holds: say until when ("heldUntil")');
  });

  it('an amount decided at the create has an end', () => {
    const deciding = ledgersSchema.parse([
      { ...LEDGER, actions: { pay: { inputs: { account: 'link', due: 'decimal', amount: 'decimal' }, phases: ['post', 'reverse'], reads: LEDGER.actions.count.reads, locks: LEDGER.actions.count.locks, decides: [{ input: 'amount', min: '0', max: { input: 'due' } }] } } },
    ])[0] as Ledger;
    const pay: Posting = postingSchema.parse({ id: 'pay', into: { addOn: 'ledger-kit', ledger: 'units', action: 'pay' }, post: { on: { create: true } }, map: { account: 'account_id', due: { parent: 'balance_due' } } });
    const issues = (over: Partial<Posting>, timed = false) => postingFitIssues({ ...pay, ...over }, deciding, { timed }).map((issue) => issue.message).join('\n');
    // The decided input itself is Adminium's to fill: it need not be mapped.
    expect(issues({})).not.toContain('needs "amount"');
    expect(issues({})).toContain('an amount Adminium decides at the create is given back by something: declare "reverse"');
    expect(issues({ reverse: { on: { column: 'voided_at', set: true } } })).toContain('needs an end: a timed move');
    expect(issues({ reverse: { on: { column: 'voided_at', set: true } } }, true)).toBe('');
    expect(issues({ reverse: { on: { column: 'voided_at', set: true } }, heldUntil: 'held_until' })).toBe('');
    expect(issues({ reverse: { on: { column: 'voided_at', set: true } }, heldUntil: 'held_until', map: { account: 'account_id' } })).toContain('"amount" is decided up to "due": map "due" to what is still due');
  });

  it('an add-on\'s own posting is checked against its own ledger in the manifest', () => {
    const broken = kit({ table: ['requests', posting({ map: { account: 'account_id' } })] });
    expect(issuesOf(broken).join('\n')).toContain('requiredSchema.tables.4.postings.0.map: the action "use" needs "quantity" (decimal)');
    const noLedger = kit({ table: ['requests', posting({ into: { addOn: 'ledger-kit', ledger: 'money', action: 'use' } })] });
    expect(issuesOf(noLedger).join('\n')).toContain('this add-on declares no ledger "money"');
  });
});

describe('a planned move', () => {
  const states = (moves: Doc) => kit({ table: ['requests', (table) => ({ ...table, states: { ...table.states, moves } })] });

  it('is made by no role, is no undo, and is reached by no timed rule', () => {
    expect(issuesOf(states({ draft: ['sent', 'cancelled'], sent: ['done', 'cancelled'], done: [{ to: 'filed', planned: true, roles: ['manager'] }] })).join('\n')).toContain('a planned move is made by no role');
    expect(issuesOf(states({ draft: ['sent', 'cancelled'], sent: ['done', 'cancelled'], done: [{ to: 'filed', planned: true, undo: true }], filed: ['done'] })).join('\n')).toContain(
      'an undo is made by a person, a planned move by a ledger',
    );
    const timed = kit({
      table: ['requests', (table) => ({ ...table, states: { ...table.states, timed: [{ from: 'done', to: 'filed', at: { column: 'hold_until' } }] } })],
    });
    expect(issuesOf(timed).join('\n')).toContain('the move from "done" to "filed" is planned, which only a ledger\'s own update makes');
  });
});

describe('the column rules that came with ledgers', () => {
  const accounts = (ref: string, change: (column: Doc) => Doc) => issuesOf(kit({ table: ['accounts', column(ref, change)] })).join('\n');

  it('capUnless lifts a cap by a yes/no of the same row', () => {
    expect(accounts('taken', (c) => ({ ...c, rules: { rollup: { from: 'entries', via: 'account_id', sum: 'amount', capUnless: { column: 'allow_below' }, balance: { column: 'balance', of: 'opening' } } } }))).toContain('capUnless lifts a cap: say "cap": true beside it');
    expect(accounts('allow_below', (c) => ({ ...c, type: 'int' }))).toContain('"accounts.allow_below" says yes or no for every row: a bool that is not nullable');
  });

  it('a balance and its parts keep one scale', () => {
    expect(accounts('opening', (c) => ({ ...c, scale: 2 }))).toContain('a balance and its parts keep one scale: accounts.balance 3, accounts.opening 2, accounts.taken 3, entries.amount 3');
    const child = kit({ table: ['entries', column('amount', (c) => ({ ...c, scale: 2 }))] });
    expect(issuesOf(child).join('\n')).toContain('entries.amount 2');
  });

  it('announce is said of a formula over a total of its own row, on up to four columns, never of money', () => {
    expect(accounts('low', (c) => ({ ...c, rules: { announce: true } }))).toContain('a change is announced of a formula column that reads a total of its own row');
    expect(accounts('low', (c) => ({ ...c, rules: { formula: { if: [{ lte: ['reorder_at', 1] }, 1, 0] }, announce: true } }))).toContain('a change is announced of a formula column');
    const five = kit({
      table: ['accounts', (table) => ({ ...table, columns: [...table.columns, ...['a', 'b', 'c', 'd'].map((ref) => ({ ref: `low_${ref}`, type: 'int', nullable: true, rules: { formula: { if: [{ lte: ['balance', 1] }, 1, 0] }, announce: true } }))] })],
    });
    expect(issuesOf(five).join('\n')).toContain('a table announces at most four columns');
  });

  it('a customer key is a 64-character text worked out from an address of its row', () => {
    const orders = (change: (column: Doc) => Doc) => issuesOf(host('orders', column('buyer_key', change))).join('\n');
    expect(orders((c) => ({ ...c, maxLength: 40 }))).toContain('a customer key is a nullable text column of 64 characters');
    expect(orders((c) => ({ ...c, rules: { customerKey: { of: 'email' } } }))).toContain('"orders" has no column "email"');
    expect(orders((c) => ({ ...c, rules: { customerKey: { of: 'status' } } }))).toContain('"orders.status" is not a text column holding an address');
    expect(orders((c) => ({ ...c, rules: { customerKey: { of: 'buyer_email' }, sequence: { start: 1 } } }))).toContain('not also decided by sequence');
  });

  it('plain text is a rule of a text column', () => {
    expect(issuesOf(host('order_lines', column('qty', (c) => ({ ...c, rules: { plainText: true } })))).join('\n')).toContain('plain text is a rule of a text column');
    expect(issuesOf(host('order_lines', column('buyer_note', (c) => ({ ...c, rules: { plainText: true } }))))).toEqual([]);
  });

  it('the last four of a code are copied from a code of the same row', () => {
    const cards = {
      ref: 'cards',
      columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'code', type: 'text', maxLength: 24, nullable: true, rules: { code: { prefix: 'GC-', length: 12 } } }, { ref: 'last4', type: 'text', maxLength: 4, nullable: true, rules: { codeLast4: { of: 'code' } } }],
    };
    const withCards = (table: Doc) => ({ ...(structuredClone(LEDGER_HOST) as unknown as Doc), requiredSchema: { prefixed: true, tables: [...LEDGER_HOST.requiredSchema.tables, table] } });
    expect(issuesOf(withCards(cards))).toEqual([]);
    expect(issuesOf(withCards({ ...cards, columns: [cards.columns[0], cards.columns[1], { ...cards.columns[2], rules: { codeLast4: { of: 'id' } } }] })).join('\n')).toContain('"cards.id" is not a code Adminium makes');
  });
});
