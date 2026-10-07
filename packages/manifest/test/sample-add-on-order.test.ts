// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An add-on's own sample may hold its ledger's history. Those tables are
 * listed last and in an order the removal can run backwards: after every
 * table their rows name, receipts before ledger rows. And an app's rows for
 * an add-on hold none of that history.
 */
import { describe, expect, it } from 'vitest';

import { sampleBundleIssues, sampleBundleSchema, sampleSectionIssues, validateManifest, type AddOnManifest, type AppManifest } from '../src/index.js';
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
});
