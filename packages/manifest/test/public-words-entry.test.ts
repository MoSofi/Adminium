// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Stock words: the question an add-on's ledger answers without writing —
 * in, low or out — and the public availability entry answered by them.
 */
import { describe, expect, it } from 'vitest';

import { installFloorWords, validateManifest, wordsListSchema, wordsOf, type Manifest } from '../src/index.js';
import { LEDGER, LEDGER_HOST, LEDGER_KIT } from './ledger-kit-fixture.js';

type Doc = Record<string, unknown>;

const issuesOf = (doc: unknown): string => {
  const result = validateManifest(doc);
  return result.ok ? '' : result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n');
};

const SETTINGS = { ref: 'settings', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'show_left_below', type: 'int', default: 5 }, { ref: 'note', type: 'text', maxLength: 80, nullable: true }] };
const WORDS = { id: 'units-left', ledger: 'units', action: 'use', input: 'account', showLeftBelow: { setting: 'show_left_below' } };

function kit(words: Doc[], over: { settings?: boolean; top?: Doc } = {}): Doc {
  const doc = structuredClone(LEDGER_KIT) as unknown as { requiredSchema: { prefixed: true; tables: Doc[] }; addOn: Doc };
  if (over.settings !== false) {
    doc.requiredSchema.tables.push(SETTINGS);
    doc.addOn = { ...doc.addOn, settingsTable: 'settings' };
  }
  doc.addOn = { ...doc.addOn, words };
  return { ...(doc as unknown as Doc), ...(over.top ?? {}) };
}
const one = (over: Doc) => issuesOf(kit([{ ...WORDS, ...over }]));

describe('an add-on\'s stock words', () => {
  it('ask one of its ledgers\' actions, and read back typed', () => {
    expect(issuesOf(kit([WORDS]))).toBe('');
    const result = validateManifest(kit([WORDS]));
    expect(result.ok && wordsOf(result.manifest as Manifest)).toEqual([WORDS]);
    expect(installFloorWords(kit([WORDS])).map((found) => found.word)).toContain('addOn.words');
  });

  it('take one to four, each with its own id', () => {
    expect(wordsListSchema.safeParse([WORDS, WORDS]).success).toBe(false);
    expect(wordsListSchema.safeParse(Array.from({ length: 5 }, (_, i) => ({ ...WORDS, id: `w${String(i)}` }))).success).toBe(false);
    expect(wordsListSchema.safeParse([{ ...WORDS, limit: 5 }]).success).toBe(false);
  });

  it('name a ledger and an action the add-on has, and an action that takes', () => {
    expect(one({ ledger: 'money' })).toContain('addOn.words.0.ledger: this add-on declares no ledger "money"');
    expect(one({ action: 'sell' })).toContain('the ledger "units" has no action "sell"');
    const noPost = { ...structuredClone(LEDGER), actions: { ...LEDGER.actions, hold: { ...LEDGER.actions.use, phases: ['reserve', 'reverse'] } } };
    const doc = kit([{ ...WORDS, action: 'hold' }]) as { addOn: Doc };
    doc.addOn = { ...doc.addOn, ledgers: [noPost] };
    expect(issuesOf(doc)).toContain('words ask what a "post" of the action would do, and "hold" has no "post" phase');
  });

  it('words name the input that takes the row: a row reference or a link of the action', () => {
    expect(one({ input: 'item' })).toContain('addOn.words.0.input: the action "use" takes no input "item"');
    expect(one({ input: 'quantity' })).toContain('words name the input that takes the row asked about: a row of any table (rowRef) or a link, and "quantity" is decimal');
    expect(one({ input: 'note' })).toContain('"note" is text?');
  });

  it('the action takes a quantity: words ask about one', () => {
    const noQuantity = { ...structuredClone(LEDGER), actions: { ...LEDGER.actions, touch: { ...LEDGER.actions.count, inputs: { account: 'link' } } } };
    const doc = kit([{ ...WORDS, action: 'touch' }]) as { addOn: Doc };
    doc.addOn = { ...doc.addOn, ledgers: [noQuantity] };
    expect(issuesOf(doc)).toContain('words ask about a quantity of one, and "touch" takes no input "quantity"');
  });

  it('"show how many are left below" is a number the add-on keeps in its settings', () => {
    expect(one({ showLeftBelow: { setting: 'threshold' } })).toContain('"settings" has no column "threshold"');
    expect(one({ showLeftBelow: { setting: 'note' } })).toContain('"settings.note" holds a number');
    expect(issuesOf(kit([WORDS], { settings: false }))).toContain('this add-on declares no settings table (addOn.settingsTable) to keep the number in');
    expect(one({ showLeftBelow: undefined })).toBe('');
  });
});

describe('a public entry answered by stock words', () => {
  const ENTRY = { table: 'order_lines', methods: ['GET'], kind: 'availability', words: 'ledger-kit:units-left' };
  const host = (entry: Doc, top: Doc = {}) => issuesOf({ ...(structuredClone(LEDGER_HOST) as unknown as Doc), publicAccess: [entry], ...top });

  it('is an availability entry of its own, over a table with no limit', () => {
    expect(host(ENTRY)).toBe('');
    expect(installFloorWords({ ...LEDGER_HOST, publicAccess: [ENTRY] }).map((found) => found.word)).toContain('availability.words');
    expect(host({ ...ENTRY, kind: undefined })).toContain('stock words answer an availability entry: write "kind": "availability" beside them');
    expect(host({ ...ENTRY, methods: ['GET', 'POST'] })).toContain('availability is read-only');
  });

  it('takes nothing that shapes a limit\'s answer, no claim and no unlock', () => {
    expect(host({ ...ENTRY, rule: 0 })).toContain('an entry answered by stock words takes no "rule"');
    expect(host({ ...ENTRY, showLeft: { below: 5 } })).toContain('takes no "showLeft"');
    expect(host({ ...ENTRY, under: 'order_id' })).toContain('takes no "under"');
    expect(host({ ...ENTRY, unlockBy: { header: true, column: 'buyer_note', self: true } })).toContain('takes no "unlockBy"');
  });

  it('names an add-on the manifest names, by key and words id', () => {
    expect(host({ ...ENTRY, words: 'offers:left' })).toContain('"offers" is not an add-on this manifest names');
    expect(host({ ...ENTRY, words: 'units-left' })).toContain('<add-on key>:<words id>');
  });

  it('an entry with no words on a table with no limit is still refused', () => {
    expect(host({ table: 'order_lines', methods: ['GET'], kind: 'availability' })).toContain('"order_lines" declares no capacity or booking to answer from');
  });
});
