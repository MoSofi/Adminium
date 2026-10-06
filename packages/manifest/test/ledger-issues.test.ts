// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A ledger stays inside its own tables. One named case for each way a
 * declaration could reach outside them, each refused with its own code.
 */
import { describe, expect, it } from 'vitest';

import { LEDGER_ISSUE_CODES, ledgerIssues, ledgersSchema, validateManifest, type LedgerScopeTable } from '../src/index.js';
import { LEDGER, LEDGER_KIT } from './ledger-kit-fixture.js';

type Doc = Record<string, unknown>;
interface TableDoc {
  ref: string;
  columns: Doc[];
  [key: string]: unknown;
}

const issuesOf = (doc: unknown) => {
  const result = validateManifest(doc);
  return result.ok ? [] : result.issues;
};
const coded = (doc: unknown, code: string): string => issuesOf(doc).filter((issue) => issue.code === code).map((issue) => `${issue.path}: ${issue.message}`).join('\n');

const USE = LEDGER.actions.use;

/** The kit with its ledger, an action of it, or its tables changed. */
function kit(over: { ledger?: Doc; use?: Doc; tables?: (tables: TableDoc[]) => TableDoc[]; addOn?: Doc } = {}): Doc {
  const doc = structuredClone(LEDGER_KIT) as unknown as { requiredSchema: { prefixed: true; tables: TableDoc[] }; addOn: Doc };
  const ledger = { ...structuredClone(LEDGER), ...(over.ledger ?? {}) } as Doc & { actions: Doc };
  if (over.use !== undefined) ledger.actions = { ...ledger.actions, use: { ...structuredClone(USE), ...over.use } };
  doc.addOn = { ...doc.addOn, ledgers: [ledger], ...(over.addOn ?? {}) };
  if (over.tables !== undefined) doc.requiredSchema.tables = over.tables(doc.requiredSchema.tables);
  return doc as unknown as Doc;
}
const table = (ref: string, change: (table: TableDoc) => TableDoc) => (tables: TableDoc[]) => tables.map((candidate) => (candidate.ref === ref ? change(candidate) : candidate));
const read = (as: string, tableRef: string, from: unknown, column = 'id') => ({ as, table: tableRef, by: [{ column, from }] });

describe('the fixture', () => {
  it('declares a ledger that stays inside its own tables', () => {
    expect(issuesOf(kit())).toEqual([]);
    expect(LEDGER_ISSUE_CODES).toHaveLength(7);
  });
});

describe('LEDGER_OUT_OF_SCOPE — a table that is not the add-on\'s own', () => {
  it('a host table in writes', () => {
    expect(coded(kit({ ledger: { writes: { ...LEDGER.writes, orders: { insert: ['status'] } } } }), 'LEDGER_OUT_OF_SCOPE')).toContain(
      'addOn.ledgers.0.writes.orders: the written table "orders" is not one of this add-on\'s own tables',
    );
  });

  it('a read of another add-on\'s table', () => {
    expect(coded(kit({ use: { reads: [...USE.reads, read('cards', 'gift_cards', 'input.account')] } }), 'LEDGER_OUT_OF_SCOPE')).toContain('the read table "gift_cards" is not one of this add-on\'s own tables');
  });

  it('a lock that stands for a table outside them, and a receipt table outside them', () => {
    expect(coded(kit({ use: { locks: [{ read: 'accounts', column: 'id', table: 'customers' }] } }), 'LEDGER_OUT_OF_SCOPE')).toContain('the locked table "customers"');
    expect(coded(kit({ ledger: { receipts: 'receipts' } }), 'LEDGER_OUT_OF_SCOPE')).toContain('the receipt table "receipts"');
  });

  it('the receipt table in writes, and an action writing a table the ledger does not list', () => {
    expect(coded(kit({ ledger: { writes: { ...LEDGER.writes, postings: { insert: ['rows'] } } } }), 'LEDGER_OUT_OF_SCOPE')).toContain('"postings" is the receipt table, which Adminium alone writes');
    expect(coded(kit({ use: { writes: ['entries', 'requests'] } }), 'LEDGER_OUT_OF_SCOPE')).toContain('the action "use" writes "requests", which the ledger\'s "writes" does not list');
  });
});

describe('LEDGER_WRITES_DECIDED — a written column Adminium decides', () => {
  const writes = (scope: Doc, ref = 'entries') => coded(kit({ ledger: { writes: { ...LEDGER.writes, [ref]: scope } } }), 'LEDGER_WRITES_DECIDED');

  it('a written rollup, and the balance it keeps', () => {
    const accounts = { insert: ['name', 'taken'], update: { by: ['id'], set: ['balance'] } };
    const issues = writes(accounts, 'accounts');
    expect(issues).toContain('"accounts.taken" is decided by its rollup rule: an answer never writes it');
    expect(issues).toContain('"accounts.balance" is a balance Adminium keeps: an answer never writes it');
  });

  it('the key, the link to the receipt, a formula, and a column the table lacks', () => {
    expect(writes({ insert: ['id', 'amount'] })).toContain('"entries.id" is the table\'s key');
    expect(writes({ insert: ['amount', 'receipt_id'] })).toContain('"entries.receipt_id" links a row to its receipt, which Adminium fills');
    expect(writes({ update: { by: ['id'], set: ['low'] } }, 'accounts')).toContain('"accounts.low" is decided by its formula rule');
    expect(writes({ insert: ['colour'] })).toContain('"entries" has no column "colour"');
  });
});

describe('LEDGER_UPDATE_KEY — an update that could name more than one row', () => {
  it('an update by a non-unique set', () => {
    const issue = coded(kit({ ledger: { writes: { ...LEDGER.writes, holds: { update: { by: ['account_id'], set: ['state'] } } } } }), 'LEDGER_UPDATE_KEY');
    expect(issue).toContain('an update names one row of "holds": by its key (id) or by one of its unique sets, not by account_id');
  });

  it('takes the key, a unique column or a unique set', () => {
    const unique = table('holds', (t) => ({ ...t, unique: [['account_id', 'state']] }));
    expect(coded(kit({ tables: unique, ledger: { writes: { ...LEDGER.writes, holds: { update: { by: ['state', 'account_id'], set: ['amount'] } } } } }), 'LEDGER_UPDATE_KEY')).toBe('');
  });

  it('never a delete: the word is not in the vocabulary', () => {
    const issues = issuesOf(kit({ ledger: { writes: { ...LEDGER.writes, holds: { delete: { by: ['id'] } } } } }));
    expect(issues.map((issue) => issue.path)).toContain('addOn.ledgers.0.writes.holds');
  });
});

describe('LEDGER_READ_CHAIN — a read whose key comes from nowhere', () => {
  const reads = (list: unknown[], over: Doc = {}) => coded(kit({ use: { reads: list, locks: [{ read: 'accounts', column: 'id', table: 'accounts' }], unavailable: undefined, ...over } }), 'LEDGER_READ_CHAIN');
  const ACCOUNTS = read('accounts', 'accounts', 'input.account');

  it('a receipt.id read without reverse', () => {
    const issue = reads([ACCOUNTS, read('mine', 'holds', 'receipt.id', 'receipt_id')], { phases: ['post'], holds: undefined });
    expect(issue).toContain('"receipt.id" is the round being given back: the action "use" has no "reverse" phase');
  });

  it('an input the action does not take, a read that comes later, a column the earlier read lacks', () => {
    expect(reads([read('accounts', 'accounts', 'input.item')])).toContain('"input.item": the action "use" takes no input "item"');
    expect(reads([read('mine', 'holds', 'accounts.id', 'account_id'), ACCOUNTS])).toContain('"accounts.id": no read named "accounts" comes before "mine"');
    expect(reads([ACCOUNTS, read('mine', 'holds', 'accounts.colour', 'account_id')])).toContain('"accounts.colour": "accounts" has no column "colour"');
  });

  it('a chain over three reads deep', () => {
    const chain = [ACCOUNTS, read('a', 'holds', 'accounts.id', 'account_id'), read('b', 'entries', 'a.account_id', 'account_id'), read('c', 'holds', 'b.account_id', 'account_id')];
    expect(reads(chain)).toContain('the read "c" is four reads deep: a chain of reads is at most three');
    expect(reads(chain.slice(0, 3))).toBe('');
  });

  it('a row of any table is read by its two halves; a setting needs a settings table', () => {
    const rowRef = { inputs: { account: 'link', quantity: 'decimal', what: 'rowRef' } };
    expect(reads([ACCOUNTS, read('links', 'holds', 'input.what', 'account_id')], rowRef)).toContain('read it as "input.what.table" or "input.what.row"');
    expect(reads([ACCOUNTS, read('links', 'holds', 'input.what.row', 'account_id')], rowRef)).toBe('');
    expect(reads([ACCOUNTS, read('links', 'holds', 'input.account.row', 'account_id')])).toContain('"account" is link: read it as "input.account"');
    expect(reads([read('accounts', 'accounts', 'setting.default_account')])).toContain('this add-on declares no settings table');
  });

  it('a read with no key, and a yes/no that is no yes/no', () => {
    expect(reads([{ as: 'accounts', table: 'accounts', by: [] }])).toContain('the read "accounts" names no key');
    expect(reads([ACCOUNTS], { unavailable: { allow: { read: 'accounts', column: 'name' } } })).toContain('"accounts.name" says yes or no for every row');
    expect(reads([ACCOUNTS], { unavailable: { allow: { read: 'accounts', column: 'allow_below' } } })).toBe('');
  });
});

describe('LEDGER_LOCK — a capped total nobody locks', () => {
  it('a capped parent missing from locks', () => {
    // `holds` names its lock; the total of `accounts` over `entries` is capped, and nothing locks an account.
    const issue = coded(kit({ use: { locks: [{ read: 'mine', column: 'id', table: 'holds' }] } }), 'LEDGER_LOCK');
    expect(issue).toContain('the action "use" writes "entries", whose rows a capped total of "accounts" adds up: lock "accounts"');
  });

  it('is judged per action: an action that writes under no capped parent owes no lock for one', () => {
    expect(coded(kit({ use: { writes: ['holds'], locks: [{ read: 'mine', column: 'id', table: 'holds' }] } }), 'LEDGER_LOCK')).toBe('');
  });

  it('is met by a table the capped parent always belongs to', () => {
    // Levels are capped; each level belongs to an item, and the item is what is locked.
    const withLevels = (tables: TableDoc[]): TableDoc[] => [
      ...tables.map((t) =>
        t.ref === 'accounts'
          ? { ...t, columns: t.columns.map((c) => (c['ref'] === 'taken' ? { ref: 'taken', type: 'decimal', scale: 3, default: 0 } : c)).filter((c) => !['balance', 'low'].includes(String(c['ref']))) }
          : t.ref === 'entries'
            ? { ...t, columns: [...t.columns, { ref: 'level_id', type: 'fk', references: 'levels', nullable: true }] }
            : t,
      ),
      {
        ref: 'levels',
        columns: [
          { ref: 'id', type: 'int', role: 'pk' },
          { ref: 'account_id', type: 'fk', references: 'accounts' },
          { ref: 'opening', type: 'decimal', scale: 3, default: 0 },
          { ref: 'taken', type: 'decimal', scale: 3, default: 0, rules: { rollup: { from: 'entries', via: 'level_id', sum: 'amount', cap: true, balance: { column: 'on_hand', of: 'opening' } } } },
          { ref: 'on_hand', type: 'decimal', scale: 3, default: 0 },
        ],
      },
    ];
    expect(coded(kit({ tables: withLevels }), 'LEDGER_LOCK')).toBe('');
    const unlocked = coded(kit({ tables: withLevels, use: { locks: [{ read: 'mine', column: 'id', table: 'holds' }] } }), 'LEDGER_LOCK');
    expect(unlocked).toContain('lock "levels" (or "accounts", which it always belongs to)');
  });

  it('a lock on no read', () => {
    expect(coded(kit({ use: { locks: [{ read: 'items', column: 'id', table: 'accounts' }] } }), 'LEDGER_LOCK')).toContain('the action "use" has no read "items" to name a lock by');
  });
});

describe('LEDGER_TABLE_GUARDED — a ledger table another guard rules', () => {
  /** The check itself, over the kit's tables with one changed: a booking rule or a limit need not be a whole valid one to be in the way. */
  const guarded = (ref: string, extra: Doc): string => {
    const tables = (LEDGER_KIT.requiredSchema.tables as unknown as TableDoc[]).map((candidate) => (candidate.ref === ref ? { ...candidate, ...extra } : candidate));
    return ledgerIssues({ tables: tables as unknown as LedgerScopeTable[], ledgers: ledgersSchema.parse([LEDGER]) })
      .filter((issue) => issue.code === 'LEDGER_TABLE_GUARDED')
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
  };

  it('a booking table in writes', () => {
    expect(guarded('holds', { booking: { start: 'starts_at' } })).toContain('addOn.ledgers.0.writes.holds: "holds" carries a booking rule, so it cannot be a ledger table');
  });

  it('a slot or a night limit; a parent limit may stay', () => {
    expect(guarded('holds', { capacity: { slot: 'starts_at' } })).toContain('"holds" carries a slot limit');
    expect(guarded('holds', { capacity: [{ kind: 'parent' }, { kind: 'night' }] })).toContain('"holds" carries a night limit');
    expect(guarded('holds', { capacity: { kind: 'parent' } })).toBe('');
  });

  it('a number without gaps, through the manifest', () => {
    const numbered = table('entries', (t) => ({ ...t, columns: [...t.columns, { ref: 'number', type: 'int', nullable: true, rules: { sequence: { gapless: true } } }] }));
    expect(coded(kit({ tables: numbered }), 'LEDGER_TABLE_GUARDED')).toContain('"entries.number" is numbered without gaps, so "entries" cannot be a ledger table');
  });
});

describe('a table an answer adds rows to carries the link to their receipt', () => {
  const linkless = (change: (column: Doc) => Doc[]): string => {
    const tables = (LEDGER_KIT.requiredSchema.tables as unknown as TableDoc[]).map((candidate) => (candidate.ref === 'entries' ? { ...candidate, columns: (candidate.columns as Doc[]).flatMap(change) } : candidate));
    return ledgerIssues({ tables: tables as unknown as LedgerScopeTable[], ledgers: ledgersSchema.parse([LEDGER]) })
      .map((issue) => `${issue.code} ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
  };

  it('with none, or one that may not be empty, the ledger is refused; a table an answer only changes needs none', () => {
    expect(linkless((column) => [column])).toBe('');
    expect(linkless((column) => (column['ref'] === 'receipt_id' ? [] : [column]))).toContain('LEDGER_TABLE_GUARDED addOn.ledgers.0.writes.entries.insert: "entries" takes rows an answer adds, so it carries "receipt_id": a link to "postings" that may be empty');
    expect(linkless((column) => [column['ref'] === 'receipt_id' ? { ...column, nullable: false } : column])).toContain('"entries" takes rows an answer adds');
  });
});

describe('LEDGER_DECIDES_TYPE — an amount decided that is no number', () => {
  const decides = (rule: Doc, inputs: Doc = { account: 'link', quantity: 'decimal', due: 'decimal', note: 'text?' }) => coded(kit({ use: { inputs, decides: [rule] } }), 'LEDGER_DECIDES_TYPE');

  it('a text decides', () => {
    expect(decides({ input: 'note', min: '0', max: { input: 'due' } })).toContain('"note" is text?: an amount Adminium decides is a decimal or a number');
  });

  it('a ceiling that is no number input, or no number column of a read', () => {
    expect(decides({ input: 'quantity', min: '0', max: { input: 'account' } })).toContain('the ceiling "account" is not a decimal or a number input');
    expect(decides({ input: 'quantity', min: '0', max: { read: 'accounts', column: 'name' } })).toContain('"accounts.name" is not a number to take a ceiling from');
    expect(decides({ input: 'quantity', min: '0', max: { read: 'accounts', column: 'balance' } })).toBe('');
    expect(decides({ input: 'quantity', min: '0', max: { input: 'due' } })).toBe('');
  });
});
