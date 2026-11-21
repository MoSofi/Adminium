// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `heldBy`: an add-on's read of the rows held in the address a signed-in
 * customer proved. Anything that could show one person another's is refused
 * where it is written; an app's rows name their person by a link instead.
 */
import { describe, expect, it } from 'vitest';

import { validateManifest } from '../src/index.js';

type Doc = Record<string, unknown>;
const entry = (over: Doc = {}): Doc => ({ table: 'packs', methods: ['GET'], level: 'verified', select: ['id', 'name'], heldBy: { address: 'holder_email' }, ...over });
const addOn = (e: Doc, floor = '0.3.71'): Doc => ({
  kind: 'add-on',
  manifestVersion: 1,
  key: 'kit',
  name: 'Kit',
  version: '1.0.0',
  publisher: { id: 'adminium', name: 'Adminium' },
  license: 'MIT',
  description: { key: 'kit.description', fallback: 'A kit.' },
  categories: ['data'],
  compatibility: { minAdminiumVersion: floor },
  addOn: { attaches: [{ app: '*', range: '*' }], connect: { kind: 'none' }, hostApi: 1 },
  requiredSchema: {
    prefixed: true,
    tables: [
      {
        ref: 'packs',
        columns: [
          { ref: 'id', type: 'int', role: 'pk' },
          { ref: 'name', type: 'text', maxLength: 40 },
          { ref: 'holder_email', type: 'text', maxLength: 254, nullable: true, rules: { personal: true, normalize: 'email' } },
          { ref: 'plain', type: 'text', maxLength: 254, nullable: true },
        ],
      },
    ],
  },
  publicAccess: [e],
});
const issues = (m: Doc): string[] => {
  const result = validateManifest(m);
  return result.ok ? [] : result.issues.map((issue) => `${String(issue.path)}: ${issue.message}`);
};

describe('a read of what a person holds', () => {
  it('is an add-on\'s verified read, by a column that keeps an address in one spelling', () => {
    expect(issues(addOn(entry()))).toEqual([]);
  });

  it.each([
    ['writes', { methods: ['GET', 'PATCH'], writable: ['name'] }, /read, never written/],
    ['at a level that proved nothing', { level: 'lookup' }, /level "verified"/],
    ['with no list of what it shows', { select: undefined }, /lists what it shows/],
    ['by a column with no one spelling', { heldBy: { address: 'plain' } }, /one spelling/],
    ['by a column that is not there', { heldBy: { address: 'nope' } }, /has no column/],
    ['with a from that is no date', { heldBy: { address: 'holder_email', from: 'name' } }, /not a date column/],
    ['on a key of the add-on\'s own', { key: 'kit-link' }, /no signed-in customer/],
  ])('is refused when it %s', (_name, over, message) => {
    expect(issues(addOn(entry(over))).join('\n')).toMatch(message);
  });

  it('asks for the release that reads it', () => {
    expect(issues(addOn(entry(), '0.3.70')).join('\n')).toMatch(/publicAccess\.heldBy|heldBy.*0\.3\.71/);
  });

  it('is an add-on\'s word: an app names its person by a link', () => {
    const app = { ...addOn(entry()), kind: 'app', key: 'shop', categories: ['operations'], compatibility: { minAdminiumVersion: '0.3.71', engines: ['sqlite'] }, addOn: undefined, frontends: [{ side: 'staff', kind: 'none' }], pages: [] };
    expect(issues(app).join('\n')).toMatch(/heldBy is said by an add-on's entry/);
  });
});
