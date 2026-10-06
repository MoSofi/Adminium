// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A public row that opens only with its own code (a gift card's balance), and
 * the one key an add-on may declare: a link that opens one row and only reads.
 */
import { describe, expect, it } from 'vitest';

import { installFloorWords, validateManifest } from '../src/index.js';
import { KIT } from './add-on-kit-fixture.js';

type Doc = Record<string, unknown>;

const issuesOf = (doc: unknown): string[] => {
  const result = validateManifest(doc);
  return result.ok ? [] : result.issues.map((issue) => `${issue.path}: ${issue.message}`);
};

const CARDS = {
  ref: 'cards',
  columns: [
    { ref: 'id', type: 'int', role: 'pk' },
    { ref: 'code', type: 'text', maxLength: 24, nullable: true, rules: { code: { prefix: 'GC-', length: 12 } } },
    { ref: 'label', type: 'text', maxLength: 40, nullable: true },
    { ref: 'balance', type: 'money', default: 0 },
    { ref: 'status', type: 'enum', enum: ['active', 'void'], default: 'active' },
    { ref: 'link_token', type: 'text', maxLength: 24, nullable: true, rules: { code: { length: 16, hiddenFromStaff: true } } },
  ],
};

const SELF = { header: true, column: 'code', self: true, length: 12, where: [{ column: 'status', eq: 'active' }] };
const BALANCE = { table: 'cards', methods: ['GET'], select: ['balance', 'status'], unlockBy: SELF };
const LINK = { table: 'cards', key: 'card-link', methods: ['GET'], select: ['balance'], claim: { by: 'token', column: 'link_token' } };

const kit = (over: Doc = {}, cards: Doc = CARDS): Doc => ({
  ...structuredClone(KIT),
  requiredSchema: { prefixed: true, tables: [...KIT.requiredSchema.tables, cards] },
  ...over,
});

describe('a row that opens with its own code', () => {
  it('a self unlock reads only, of its own, on a code column', () => {
    expect(issuesOf(kit({ publicAccess: [BALANCE] }))).toEqual([]);
    expect(issuesOf(kit({ publicAccess: [{ ...BALANCE, methods: ['GET', 'PATCH'], writable: ['label'] }] })).join('\n')).toContain('an unlock only reads');
    expect(issuesOf(kit({ publicAccess: [{ ...BALANCE, unlockBy: { ...SELF, column: 'colour' } }] })).join('\n')).toContain('"cards" has no column "colour"');
    expect(issuesOf(kit({ publicAccess: [{ ...BALANCE, unlockBy: { ...SELF, column: 'label' } }] })).join('\n')).toContain('a code finds one row: make "cards.label" unique');
    expect(issuesOf(kit({ publicAccess: [{ ...BALANCE, unlockBy: { ...SELF, where: [{ column: 'status', eq: 'lost' }] } }] })).join('\n')).toContain('"lost" is not a value of "cards.status"');
  });

  it('never shows the code it opens with', () => {
    expect(issuesOf(kit({ publicAccess: [{ ...BALANCE, select: ['balance', 'code'] }] })).join('\n')).toContain('"cards.code" opens the row, so the row does not show it');
  });

  it('takes a length of 4 to 16, a header and no link', () => {
    expect(issuesOf(kit({ publicAccess: [{ ...BALANCE, unlockBy: { ...SELF, length: 3 } }] }))).not.toEqual([]);
    expect(issuesOf(kit({ publicAccess: [{ ...BALANCE, unlockBy: { ...SELF, length: 17 } }] }))).not.toEqual([]);
    expect(issuesOf(kit({ publicAccess: [{ ...BALANCE, unlockBy: { ...SELF, link: 'id' } }] }))).not.toEqual([]);
    expect(issuesOf(kit({ publicAccess: [{ ...BALANCE, unlockBy: { column: 'code', self: true } }] }))).not.toEqual([]);
  });

  it('is a word that needs the install floor', () => {
    expect(installFloorWords(kit({ publicAccess: [BALANCE] })).map((found) => found.word)).toContain('unlockBy.self');
  });
});

describe('the one key of an add-on', () => {
  it('an add-on declares one read-only link key and no other', () => {
    expect(issuesOf(kit({ publicAccess: [LINK], publicKeys: { 'card-link': {} } }))).toEqual([]);
    const two = issuesOf(kit({ publicAccess: [LINK, { ...LINK, key: 'second' }], publicKeys: { 'card-link': {}, second: {} } })).join('\n');
    expect(two).toContain('an add-on declares at most one key');
    const writes = issuesOf(kit({ publicAccess: [{ ...LINK, methods: ['GET', 'PATCH'], writable: ['label'] }], publicKeys: { 'card-link': {} } })).join('\n');
    expect(writes).toContain('so it only reads');
  });

  it('takes no staff sign-in, no switch and no peak', () => {
    const roles = [{ key: 'desk', name: 'Desk', permissions: ['table:@cards:read'] }];
    const staffed = issuesOf(kit({ roles, publicAccess: [LINK], publicKeys: { 'card-link': { requiresStaff: { role: 'desk' } } } })).join('\n');
    expect(staffed).toContain('publicKeys.card-link.requiresStaff: an add-on\'s key opens one row by its link and only reads: it takes no "requiresStaff"');
    const peak = issuesOf(kit({ publicAccess: [LINK], publicKeys: { 'card-link': { peak: { reads: 3000, writes: 300 } } } })).join('\n');
    expect(peak).toContain('it takes no "peak"');
  });

  it('claims by a token staff never see, and never as the row\'s own link', () => {
    const own = issuesOf(kit({ publicAccess: [{ ...LINK, claim: { by: 'token', column: 'link_token', own: true } }], publicKeys: { 'card-link': {} } })).join('\n');
    expect(own).toContain("an add-on's link key claims by token, and never as the row's own link");
    const shown = { ...CARDS, columns: CARDS.columns.map((column) => (column.ref === 'link_token' ? { ...column, rules: { code: { length: 16 } } } : column)) };
    expect(issuesOf(kit({ publicAccess: [LINK], publicKeys: { 'card-link': {} } }, shown)).join('\n')).toContain('give "cards.link_token" rules.code {"length": 16, "hiddenFromStaff": true}');
  });

  it('its key is never called customer, and nothing on it is open to everyone', () => {
    const named = issuesOf(kit({ publicAccess: [{ table: 'cards', methods: ['GET', 'POST'], writable: ['label'] }], publicKeys: { customer: {} } })).join('\n');
    expect(named).toContain('an add-on has no "customer" key');
    // A plain read on the link key would be a list anyone holding the published key could ask for.
    const open = issuesOf(kit({ publicAccess: [LINK, { table: 'cards', key: 'card-link', methods: ['GET'], select: ['label'] }], publicKeys: { 'card-link': {} } })).join('\n');
    expect(open).toContain('"card-link" opens one row by its link');
  });

  it('an entry names the link key or none: an add-on has no customer key of its own', () => {
    expect(issuesOf(kit({ publicAccess: [{ ...BALANCE, key: 'customer' }] })).join('\n')).toContain('"customer" is neither');
  });
});
