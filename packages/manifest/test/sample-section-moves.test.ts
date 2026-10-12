// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN APP'S SAMPLE BRINGS AN ADD-ON'S THINGS, AND ASKS THE ADD-ON FOR THEIR STOCK.
 *
 * Two words of an app's rows for an add-on. A row of a table the add-on's
 * ledger also writes may be brought when a person could make it by hand (a
 * role of the add-on creates it): with no history, so none of the columns
 * the ledger keeps. And `moves`: changes of state the loader makes as saves
 * of their own once the rows are in, so what a move hands to the ledger (a
 * receipt posted) is written by the add-on, not typed.
 */
import { describe, expect, it } from 'vitest';

import { ledgerBringableTables, ledgerKeptColumns, sampleBundleIssues, sampleBundleSchema, sampleSectionIssues, validateManifest, type AddOnManifest, type AppManifest } from '../src/index.js';
import { LEDGER_HOST, LEDGER_KIT } from './ledger-kit-fixture.js';

type Doc = Record<string, unknown>;

/** The kit whose ledger may also move a request, and whose clerk may write one by hand. */
function kit(roles: Doc[] = [{ key: 'clerk', name: 'Clerk', permissions: ['table:@requests:read', 'table:@requests:create', 'table:@requests:update'] }]): AddOnManifest {
  const doc = structuredClone(LEDGER_KIT) as unknown as Doc & { addOn: { ledgers: { writes: Doc }[] } };
  doc.addOn.ledgers[0]!.writes = { ...doc.addOn.ledgers[0]!.writes, requests: { update: { by: ['id'], set: ['status'] } } };
  doc['roles'] = roles;
  const result = validateManifest(doc);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.manifest as AddOnManifest;
}
const HOST = (() => {
  const result = validateManifest(LEDGER_HOST);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.manifest as AppManifest;
})();

const ACCOUNTS = { ref: 'accounts', rows: [{ '@label': 'flour', name: 'Flour' }] };
const REQUESTS = { ref: 'requests', rows: [{ '@label': 'first', account_id: { '@ref': 'flour' }, quantity: 4 }] };
const told = (addOn: AddOnManifest | undefined, section: Doc): string =>
  sampleSectionIssues(sampleBundleSchema.parse({ format: 'adminium.sample/1', app: 'ledger-host', addOn: 'ledger-kit', ...section }), HOST, addOn)
    .map((issue) => `${issue.path}: ${issue.message}`)
    .join('\n');

describe('a row of a table the ledger also writes', () => {
  it('may be brought when a role of the add-on makes such a row by hand, and not otherwise', () => {
    expect([...ledgerBringableTables(kit())]).toEqual(['requests']);
    expect(told(kit(), { tables: [ACCOUNTS, REQUESTS] })).toBe('');
    // Nobody is granted the create: only the ledger writes it.
    expect([...ledgerBringableTables(kit([]))]).toEqual([]);
    expect(told(kit([]), { tables: [ACCOUNTS, REQUESTS] })).toContain('"requests" is a table of "ledger-kit"\'s ledger "units", which only postings write');
    // What only the ledger writes stays the ledger's, whoever may read it.
    expect(told(kit(), { tables: [ACCOUNTS, { ref: 'entries', rows: [{ account_id: { '@ref': 'flour' }, amount: 2, kind: 'use' }] }] })).toContain('"entries" is a table of "ledger-kit"\'s ledger');
  });

  it('brings no history: a column the ledger keeps is left out', () => {
    expect([...ledgerKeptColumns(kit(), 'requests')]).toEqual(['status']);
    expect(told(kit(), { tables: [ACCOUNTS, { ref: 'requests', rows: [{ ...REQUESTS.rows[0], status: 'done' }] }] })).toContain('tables.1.rows.0.status: "requests.status" is kept by "ledger-kit"\'s ledger');
  });

  it('but for a column a row cannot be made without: what a person must type, a sample types too', () => {
    // The ledger may change a request's quantity later (an order line a delivery came short on): it has no default and may not be empty.
    const adjusting = structuredClone(LEDGER_KIT) as unknown as Doc & { addOn: { ledgers: { writes: Doc }[] } };
    adjusting.addOn.ledgers[0]!.writes = { ...adjusting.addOn.ledgers[0]!.writes, requests: { update: { by: ['id'], set: ['status', 'quantity'] } } };
    adjusting['roles'] = [{ key: 'clerk', name: 'Clerk', permissions: ['table:@requests:create'] }];
    const result = validateManifest(adjusting);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    const addOn = result.manifest as AddOnManifest;
    expect([...ledgerKeptColumns(addOn, 'requests')].sort()).toEqual(['quantity', 'status']);
    expect(told(addOn, { tables: [ACCOUNTS, REQUESTS] })).toBe('');
    expect(told(addOn, { tables: [ACCOUNTS, { ref: 'requests', rows: [{ ...REQUESTS.rows[0], status: 'sent' }] }] })).toContain('"requests.status" is kept by');
  });

});

describe('the moves a file asks for', () => {
  const moves = (list: Doc[]) => ({ tables: [ACCOUNTS, REQUESTS], moves: list });

  it('name a labelled row or a table of the add-on\'s that the file writes, and a state the table has', () => {
    expect(told(kit(), moves([{ ref: 'first', to: 'sent' }, { table: 'requests', to: 'done' }]))).toBe('');
    expect(told(kit(), moves([{ ref: 'second', to: 'sent' }]))).toContain('moves.0.ref: No row of this file carries the label "second".');
    expect(told(kit(), moves([{ table: 'holds', to: 'taken' }]))).toContain('moves.0.table: This file writes no row of "holds"');
    expect(told(kit(), moves([{ ref: 'first', to: 'posted' }]))).toContain('moves.0.to: "requests" has no state "posted".');
    expect(told(kit(), moves([{ ref: 'flour', to: 'sent' }]))).toContain('moves.0: "accounts" has no states');
  });

  it('are not of the app\'s own rows', () => {
    const own = { ref: 'order_lines', own: true, rows: [{ '@label': 'line', order_id: { '@ref': 'host:order-1' }, account_id: { '@ref': 'flour' }, qty: 1 }] };
    expect(told(kit(), { tables: [ACCOUNTS, own], moves: [{ ref: 'line', to: 'sent' }] })).toContain('moves.0: "order_lines" is the app\'s own table');
  });

  it('are read for their shape where the add-on\'s manifest is not at hand', () => {
    expect(told(undefined, moves([{ ref: 'first', to: 'anything' }]))).toBe('');
    expect(told(undefined, moves([{ ref: 'nobody', to: 'sent' }]))).toContain('No row of this file carries the label "nobody"');
  });

  it('take one of a row and a table, a state, and at most fifty', () => {
    const parse = (list: unknown) => sampleBundleSchema.safeParse({ format: 'adminium.sample/1', app: 'ledger-host', addOn: 'ledger-kit', tables: [ACCOUNTS], moves: list }).success;
    expect(parse([{ ref: 'flour', to: 'sent' }])).toBe(true);
    expect(parse([{ ref: 'flour', table: 'accounts', to: 'sent' }])).toBe(false);
    expect(parse([{ to: 'sent' }])).toBe(false);
    expect(parse([{ ref: 'flour' }])).toBe(false);
    expect(parse([])).toBe(false);
    expect(parse(Array.from({ length: 51 }, () => ({ ref: 'flour', to: 'sent' })))).toBe(false);
  });

  it('are refused in a manifest\'s own sample file', () => {
    const own = sampleBundleSchema.parse({ format: 'adminium.sample/1', app: 'ledger-kit', tables: [ACCOUNTS], moves: [{ ref: 'flour', to: 'sent' }] });
    expect(sampleBundleIssues(own, kit()).map((issue) => issue.path)).toContain('moves');
  });
});
