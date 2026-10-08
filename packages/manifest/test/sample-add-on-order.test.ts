// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An add-on's own sample may hold its ledger's history. Those tables are
 * listed last and in an order the removal can run backwards: after every
 * table their rows name, receipts before ledger rows. And an app's rows for
 * an add-on hold none of that history.
 */
import { describe, expect, it } from 'vitest';

import { ledgerCatalogueTables, sampleBundleIssues, sampleBundleSchema, sampleSectionIssues, validateManifest, type AddOnManifest, type AppManifest } from '../src/index.js';
import { LEDGER_HOST, LEDGER_KIT } from './ledger-kit-fixture.js';

type Doc = Record<string, unknown>;

const KIT = (() => {
  const result = validateManifest(LEDGER_KIT);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.manifest as AddOnManifest;
})();
const HOST = (() => {
  const result = validateManifest(LEDGER_HOST);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.manifest as AppManifest;
})();

const RECEIPT = {
  '@label': 'r1',
  source_table: { '@table': 'requests' },
  source_row: '1',
  source_line: '',
  line_table: '',
  ledger: 'units',
  action: 'use',
  posting: 'request',
  phase: 'post',
  round: 1,
  state: 'planned',
  rows: 1,
  add_on_version: '1.0.0',
  origin: 'system',
  by: '',
  at: { '@ago': 'P2D' },
};
const ACCOUNTS = { ref: 'accounts', rows: [{ '@label': 'flour', name: 'Flour', opening: 10 }] };
const RECEIPTS = { ref: 'postings', rows: [RECEIPT] };
const ENTRIES = { ref: 'entries', rows: [{ account_id: { '@ref': 'flour' }, amount: 2, kind: 'use', receipt_id: { '@ref': 'r1' } }] };

const messages = (tables: Doc[]): string =>
  sampleBundleIssues(sampleBundleSchema.parse({ format: 'adminium.sample/1', app: 'ledger-kit', tables }), KIT)
    .map((issue) => `${issue.path}: ${issue.message}`)
    .join('\n');

describe('an add-on\'s sample with its ledger\'s history', () => {
  it('lists the tables its rows name first, then receipts, then ledger rows', () => {
    expect(messages([ACCOUNTS, RECEIPTS, ENTRIES])).toBe('');
  });

  it('a ledger table listed before a table it names is refused', () => {
    // The label check already asks for an earlier row; the order check names the table and why.
    const issues = messages([RECEIPTS, ENTRIES, ACCOUNTS]);
    expect(issues).toContain('tables.1.ref: "entries" is a ledger table of "units": list it after "accounts", which its rows name (account_id).');
    expect(issues).toContain('tables.2.ref: "accounts" comes after the history of the ledger "units": list a ledger\'s receipt and ledger tables last.');
  });

  it('receipts come before ledger rows', () => {
    const issues = messages([ACCOUNTS, ENTRIES, RECEIPTS]);
    expect(issues).toContain('tables.1.ref: "entries" is a ledger table of "units": list the receipt table "postings" before it.');
  });

  it('a ledger row that names no receipt may stand before them: the order is about what the rows name', () => {
    expect(messages([ACCOUNTS, { ...ENTRIES, rows: [{ account_id: { '@ref': 'flour' }, amount: 2, kind: 'use' }] }, RECEIPTS])).toBe('');
  });

  it('a table the ledger may also write, filled by the sample as people fill it, stands where its rows are named', () => {
    // A ledger that makes an account on the way (as a stock ledger makes an item): the sample's accounts name no receipt.
    const kit = structuredClone(KIT) as AddOnManifest;
    const ledger = kit.addOn.ledgers![0]!;
    (ledger.writes as Record<string, unknown>)['accounts'] = { insert: ['name'] };
    kit.requiredSchema!.tables.push({ ref: 'requests', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'account_id', type: 'fk', references: 'accounts' }] } as never);
    const REQUESTS = { ref: 'requests', rows: [{ '@label': 'q1', account_id: { '@ref': 'flour' } }] };
    const told = (tables: Doc[]) =>
      sampleBundleIssues(sampleBundleSchema.parse({ format: 'adminium.sample/1', app: 'ledger-kit', tables }), kit)
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join('\n');
    expect(told([ACCOUNTS, REQUESTS, RECEIPTS, ENTRIES])).toBe('');
    // What is not the ledger's still comes before the receipts.
    expect(told([ACCOUNTS, RECEIPTS, ENTRIES, REQUESTS])).toContain('tables.3.ref: "requests" comes after the history of the ledger "units"');
  });
});

describe('an app\'s rows for an add-on', () => {
  const section = (tables: Doc[]) =>
    sampleSectionIssues(sampleBundleSchema.parse({ format: 'adminium.sample/1', app: 'ledger-host', addOn: 'ledger-kit', tables }), HOST, KIT)
      .map((issue) => `${issue.path}: ${issue.message}`)
      .join('\n');

  it('hold what the ledger counts, and its own rows that link in', () => {
    expect(section([ACCOUNTS, { ref: 'order_lines', own: true, rows: [{ order_id: { '@ref': 'host:order-1' }, account_id: { '@ref': 'flour' }, qty: 1 }] }])).toBe('');
  });

  it('a ledger table in the section is refused, and so is the receipt table', () => {
    expect(section([ACCOUNTS, ENTRIES])).toContain('tables.1.ref: "entries" is a table of "ledger-kit"\'s ledger "units", which only postings write');
    expect(section([RECEIPTS])).toContain('"postings" is the receipt table of "ledger-kit"\'s ledger "units"');
  });

  describe('a table the ledger writes beside its books', () => {
    /**
     * The kit as a stock add-on is: `use` moves units (entries, holds), and
     * `adopt` makes a link from somebody's row to an account — and, on the
     * way, touches the account itself. Each action says what it writes.
     */
    const stock = (change?: (kit: Doc & { addOn: { ledgers: (Doc & { writes: Doc; actions: Record<string, Doc> })[] }; requiredSchema: { tables: (Doc & { ref: string; columns: Doc[] })[] } }) => void): AddOnManifest => {
      const kit = structuredClone(LEDGER_KIT) as unknown as Parameters<NonNullable<typeof change>>[0];
      const ledger = kit.addOn.ledgers[0]!;
      ledger.writes = { ...ledger.writes, links: { insert: ['source_table', 'source_row', 'account_id', 'qty'] }, accounts: { update: { by: ['id'], set: ['reorder_at'] } } };
      for (const action of Object.values(ledger.actions)) action['writes'] = ['entries', 'holds'];
      ledger.actions['adopt'] = {
        inputs: { what: 'rowRef', account: 'link', quantity: 'decimal' },
        phases: ['post'],
        reads: [{ as: 'known', table: 'links', by: [{ column: 'account_id', from: 'input.account' }] }],
        locks: [{ read: 'known', column: 'id', table: 'links' }],
        writes: ['accounts', 'links'],
      };
      kit.requiredSchema.tables.push({
        ref: 'links',
        columns: [
          { ref: 'id', type: 'int', role: 'pk' },
          { ref: 'source_table', type: 'text', maxLength: 128, rules: { tableRef: true } },
          { ref: 'source_row', type: 'text', maxLength: 64 },
          { ref: 'account_id', type: 'fk', references: 'accounts' },
          { ref: 'qty', type: 'decimal', scale: 3, default: 1 },
          { ref: 'receipt_id', type: 'fk', references: 'postings', nullable: true },
        ],
      });
      // The kit as written is a manifest Adminium takes; a changed one is read as it stands (what is asked of it here is asked before any install).
      const result = validateManifest(kit);
      if (!result.ok) throw new Error(JSON.stringify(result.issues));
      if (change === undefined) return result.manifest as AddOnManifest;
      change(kit);
      return kit as unknown as AddOnManifest;
    };
    const LINKS = { ref: 'links', rows: [{ source_table: { '@table': 'orders' }, source_row: '1', account_id: { '@ref': 'flour' }, qty: 2 }] };
    const told = (kit: AddOnManifest, tables: Doc[]) =>
      sampleSectionIssues(sampleBundleSchema.parse({ format: 'adminium.sample/1', app: 'ledger-host', addOn: 'ledger-kit', tables }), HOST, kit)
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join('\n');

    it('is catalogue, and an app may bring rows of it: which of its rows uses which of the add-on\'s', () => {
      expect([...ledgerCatalogueTables(stock())]).toEqual(['links']);
      expect(told(stock(), [LINKS])).toBe('');
      expect(told(stock(), [LINKS, { ref: 'order_lines', own: true, rows: [{ order_id: { '@ref': 'host:order-1' }, account_id: { '@ref': 'flour' }, qty: 1 }] }])).toBe('');
    });

    it('the history stays the ledger\'s: what is added up, what holds a total, and the receipts', () => {
      const kit = stock();
      expect(told(kit, [ENTRIES])).toContain('"entries" is a table of "ledger-kit"\'s ledger "units", which only postings write');
      expect(told(kit, [{ ref: 'holds', rows: [{ account_id: { '@ref': 'flour' }, amount: 1 }] }])).toContain('"holds" is a table of "ledger-kit"\'s ledger "units", which only postings write');
      // The accounts hold the total: written by the same action as the links, and still not an app's to bring.
      expect(told(kit, [ACCOUNTS])).toContain('"accounts" is a table of "ledger-kit"\'s ledger "units", which only postings write');
      expect(told(kit, [RECEIPTS])).toContain('"postings" is the receipt table of "ledger-kit"\'s ledger "units"');
    });

    it('a row of it names no receipt', () => {
      expect(told(stock(), [{ ref: 'links', rows: [{ ...LINKS.rows[0], receipt_id: { '@ref': 'r1' } }] }])).toContain('tables.0.rows.0.receipt_id: "links.receipt_id" names the receipt of a posting');
      expect(told(stock(), [{ ref: 'links', rows: [{ ...LINKS.rows[0], receipt_id: null }] }])).toBe('');
    });

    it('is history after all when an action that writes it also writes what is added up, or says nothing of what it writes', () => {
      // The action that links also moves units: a link is then part of a movement.
      expect([...ledgerCatalogueTables(stock((kit) => void (kit.addOn.ledgers[0]!.actions['adopt']!['writes'] = ['links', 'entries'])))]).toEqual([]);
      // An action with no list writes every table of the ledger.
      const silent = stock((kit) => void delete kit.addOn.ledgers[0]!.actions['use']!['writes']);
      expect([...ledgerCatalogueTables(silent)]).toEqual([]);
      expect(told(silent, [LINKS])).toContain('"links" is a table of "ledger-kit"\'s ledger "units", which only postings write');
      // Something adds its rows up: a total of the accounts over their links.
      const summed = stock((kit) => void kit.requiredSchema.tables.find((table) => table.ref === 'accounts')!.columns.push({ ref: 'linked', type: 'decimal', scale: 3, default: 0, rules: { rollup: { from: 'links', via: 'account_id', sum: 'qty' } } }));
      expect([...ledgerCatalogueTables(summed)]).toEqual([]);
      // No action writes it at all: nothing says what it is.
      expect([...ledgerCatalogueTables(stock((kit) => void (kit.addOn.ledgers[0]!.actions['adopt']!['writes'] = ['accounts'])))]).toEqual([]);
    });

    it('a kit with no such table has none', () => {
      expect([...ledgerCatalogueTables(KIT)]).toEqual([]);
    });
  });
});
