// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ONE RULE, TWO JUDGES.
 *
 * A posting an app writes is judged twice against the add-on it names: by
 * the folder check a Designer runs before anything is applied
 * (`hostPostingIssue`), and by the install when the rule is stored
 * (`storedPostingIssue`). They are two functions with two sets of words, so
 * this runs the same rules through both: what one refuses the other refuses,
 * and what one lets through the other does too.
 */
import { validateManifest, type AddOnManifest, type Posting } from '@adminium/manifest';
import { describe, expect, it } from 'vitest';

import { storedPostingIssue } from '../src/ledgers/rules.js';
import { hostPostingIssue } from '../src/project/apps/ledger-parts.js';
import { ledgerKitDecidesManifest } from './fixtures/ledger-kit/index.js';

const document = ledgerKitDecidesManifest();
const parsed = validateManifest(document);
if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues.slice(0, 3)));
const manifest = parsed.manifest as AddOnManifest;

const column = (name: string) => ({ name, nullable: true });
/** A table of an app as the install reads it: its key, the columns a rule names. */
const table = { id: 'parts', name: 'parts', primaryKey: ['id'], columns: ['id', 'account_id', 'qty', 'status', 'until', 'due', 'paid'].map(column), postings: [] };
const model = { tables: [table], relations: [] };

const USE: Posting = { id: 'units', into: { addOn: 'ledger-kit', ledger: 'units', action: 'use' }, post: { on: { column: 'status', in: ['done'] } }, map: { account: 'account_id', quantity: 'qty' } };
const both = (posting: Posting) => ({
  folder: hostPostingIssue(posting, document),
  install: storedPostingIssue({ model: model as never, table: table as never, posting, manifest }),
});

describe('a posting judged by the folder check and by the install', () => {
  it('a rule that fits passes both', () => {
    expect(both(USE)).toEqual({ folder: null, install: null });
  });

  const refused: [string, Posting][] = [
    ['a ledger the add-on does not keep', { ...USE, into: { ...USE.into, ledger: 'stocks' } }],
    ['an action the ledger does not have', { ...USE, into: { ...USE.into, action: 'burn' } }],
    ['an input the action does not take', { ...USE, map: { ...USE.map, colour: 'status' } }],
    ['a needed input left unmapped', { ...USE, map: { account: 'account_id' } }],
  ];
  it.each(refused)('%s is refused by both', (_name, posting) => {
    const said = both(posting);
    expect(said.folder, 'the folder check').not.toBeNull();
    expect(said.install, 'the install').not.toBeNull();
  });

  it('an amount the ledger decides need not be mapped, for either', () => {
    const pay: Posting = { id: 'pay', into: { addOn: 'ledger-kit', ledger: 'units', action: 'pay' }, post: { on: { create: true } }, map: { account: 'account_id', due: 'due' } };
    expect(both(pay)).toEqual({ folder: null, install: null });
  });
});
