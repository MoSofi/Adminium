// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The test ledger add-on, as a package: its manifest, the file that decides
 * (`dist/server.js`, a classic script exactly as an add-on ships one), and
 * the app whose orders post into it. One fixture for the install's tests and
 * the write path's.
 *
 * The manifests start from the ones the manifest package's own tests check
 * (`ledger-kit-fixture.ts`) and add what a package needs beside them: a
 * settings row the deciding file reads, and stock words over the ledger.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { LEDGER, LEDGER_HOST, LEDGER_KIT } from '../../../../../packages/manifest/test/ledger-kit-fixture.js';

type Doc = Record<string, unknown>;

/** The deciding file's bytes. */
export const LEDGER_KIT_SERVER = readFileSync(join(import.meta.dirname, 'dist', 'server.js'));

/** What the kit's ledger lets its code write, and the column that adds up to a balance. */
export const LEDGER_KIT_WRITES = LEDGER.writes;
export const LEDGER_KIT_SUMS = { entries: ['amount'] } as const;

/** The kit's one-row settings table: how its code is told to misbehave, and when a page may say how much is left. */
const SETTINGS = {
  ref: 'settings',
  columns: [
    { ref: 'id', type: 'int', role: 'pk' },
    { ref: 'misbehave', type: 'text', maxLength: 40, nullable: true },
    { ref: 'show_left_below', type: 'int', nullable: true },
    { ref: 'note', type: 'json', nullable: true },
  ],
};

/** Moves a request to the state its row asks for: `sent → done`, or the move kept for the ledger alone, `done → filed`. */
const TIDY = {
  inputs: { request: 'link', to: 'text' },
  phases: ['post'],
  reads: [{ as: 'requests', table: 'requests', by: [{ column: 'id', from: 'input.request' }] }],
  locks: [{ read: 'requests', column: 'id', table: 'requests' }],
  writes: ['holds', 'requests'],
};

/** Makes a thing of a row of another table, named by the column the owner chose: once a row, and never twice for a name. */
const ADOPT = {
  inputs: { what: 'rowRef', name: 'text' },
  phases: ['post'],
  reads: [{ as: 'known', table: 'things', by: [{ column: 'name', from: 'input.name' }] }],
  locks: [{ read: 'known', column: 'id', table: 'things' }],
  writes: ['things'],
};

/** What `adopt` makes: a row of the kit's own for a row of somebody else's table, linked to the receipt of the call that made it. */
const THINGS = {
  ref: 'things',
  columns: [
    { ref: 'id', type: 'int', role: 'pk' },
    { ref: 'name', type: 'text', maxLength: 80 },
    { ref: 'receipt_id', type: 'fk', references: 'postings', nullable: true },
  ],
};

type Table = Doc & { ref?: string; columns?: Doc[] };
const withColumns = (table: Table, change: (column: Doc) => Doc, added: Doc[] = []): Table => ({ ...table, columns: [...(table.columns ?? []).map(change), ...added] });

/**
 * Rules of the kit's own tables that a planned row must meet like any other:
 * an entry's amount has a ceiling and is stamped with who saved, a hold is
 * stamped when it is taken, and an account adds up what is still held — and
 * holds only so many things at once.
 */
function withOwnRules(table: Table): Table {
  if (table.ref === 'entries') {
    return withColumns(table, (column) => (column['ref'] === 'amount' ? { ...column, rules: { validation: { max: 100000 } } } : column), [
      { ref: 'made_by', type: 'text', maxLength: 80, nullable: true, rules: { stamp: { set: 'user-name', on: 'create' } } },
    ]);
  }
  if (table.ref === 'holds') {
    return {
      ...withColumns(table, (column) => (column['ref'] === 'account_id' ? { ...column, index: true } : column), [
        { ref: 'taken_at', type: 'timestamptz', nullable: true, rules: { stamp: { set: 'now', on: { column: 'state', values: ['taken'] } } } },
      ]),
      // An account holds so many things at once, and no more.
      capacity: { kind: 'parent', via: 'account_id', size: { column: 'max_holds' }, countWhere: { column: 'state', values: ['held'] } },
    };
  }
  if (table.ref === 'accounts') {
    // The flag reads the total, not the balance: a formula is worked out before the balances are, so one that read `balance` would see the one before this write.
    const low = { if: [{ lte: [{ sub: ['opening', 'taken'] }, 'reorder_at'] }, 1, 0] };
    return withColumns(table, (column) => (column['ref'] === 'low' ? { ...column, rules: { ...(column['rules'] as Doc), formula: low } } : column), [
      { ref: 'held', type: 'decimal', scale: 3, default: 0, rules: { rollup: { from: 'holds', via: 'account_id', sum: 'amount', where: { column: 'state', eq: 'held' } } } },
      { ref: 'max_holds', type: 'int', default: 100 },
    ]);
  }
  if (table.ref === 'requests') {
    // Marking a request done is kept for one role: a planned move is made whoever is saving.
    const states = table['states'] as Doc & { moves: Record<string, unknown[]> };
    return { ...table, states: { ...states, moves: { ...states.moves, sent: [{ to: 'done', roles: ['manager'] }, 'cancelled'] } } };
  }
  return table;
}

/** The add-on's manifest, version 1.0.0. */
export function ledgerKitManifest(): Doc {
  const kit = structuredClone(LEDGER_KIT) as unknown as Doc & { addOn: Doc; requiredSchema: { tables: Doc[] } };
  const [units] = structuredClone(kit.addOn['ledgers']) as [Doc & { writes: Doc; actions: Doc }];
  // The ledger may move a request too, and one action does nothing else: a planned change of a row with states.
  units.writes = { ...units.writes, requests: { update: { by: ['id'], set: ['status'] } }, things: { insert: ['name'] } };
  units.actions = { ...units.actions, tidy: TIDY, adopt: ADOPT };
  kit.addOn = {
    ...kit.addOn,
    ledgers: [units],
    settingsTable: 'settings',
    words: [{ id: 'units-left', ledger: 'units', action: 'use', input: 'account', showLeftBelow: { setting: 'show_left_below' } }],
  };
  // An index the kit declares itself, beside the ones its ledger is given.
  kit['roles'] = [{ key: 'manager', name: 'Ledger manager', permissions: ['table:@requests:read', 'table:@requests:update'] }];
  kit.requiredSchema.tables = [...kit.requiredSchema.tables.map((table) => (table['ref'] === 'entries' ? { ...table, indexes: [['account_id', 'kind']] } : table)), SETTINGS, THINGS].map(withOwnRules);
  return kit;
}

/**
 * The same add-on with one more action, `pay`: Adminium decides how much of
 * what is due an account pays — never more than is due, never more than the
 * account holds.
 */
export function ledgerKitDecidesManifest(): Doc {
  const kit = ledgerKitManifest() as Doc & { addOn: Doc & { ledgers: [Doc & { actions: Doc }] } };
  kit.addOn.ledgers[0].actions = {
    ...kit.addOn.ledgers[0].actions,
    pay: {
      inputs: { account: 'link', due: 'decimal', amount: 'decimal' },
      phases: ['post', 'reverse'],
      reads: [{ as: 'accounts', table: 'accounts', by: [{ column: 'id', from: 'input.account' }] }],
      locks: [{ read: 'accounts', column: 'id', table: 'accounts' }],
      decides: [
        { input: 'amount', min: '0', max: { input: 'due' } },
        { input: 'amount', min: '0', max: { read: 'accounts', column: 'balance' } },
      ],
      writes: ['entries'],
    },
  };
  return kit;
}

/** The app whose order lines and visits post into the kit's ledger. */
export function ledgerHostManifest(): Doc {
  return structuredClone(LEDGER_HOST) as unknown as Doc;
}

/** The package an install takes: the manifest and the file that decides. */
export function ledgerKitFiles(manifest: Doc = ledgerKitManifest()): Record<string, string> {
  return { 'manifest.json': JSON.stringify(manifest), 'dist/server.js': LEDGER_KIT_SERVER.toString('utf8') };
}
