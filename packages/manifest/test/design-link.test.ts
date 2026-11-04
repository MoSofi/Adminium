// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A SHOPPER'S SAVED DESIGN, AS THE VALIDATOR READS IT.
 *
 * Three words of an add-on that keeps designs shoppers make:
 *  - its link key may open a design as the design's own link (`own: true`),
 *    which also changes it in place, only through the columns the entry
 *    names and only while the design is in a state it names;
 *  - whoever an app signed in (a guest who found their order) may read one
 *    design by its own code, never a list;
 *  - an app's person may have details of theirs on another row, kept as JSON
 *    (a design's words), found, exported and erased with them.
 */
import { describe, expect, it } from 'vitest';

import { WORD_FLOORS, addOnManifestSchema, appManifestSchema, installFloorWords, validateManifest } from '../src/index.js';

type Doc = Record<string, unknown>;
const pk = { ref: 'id', type: 'int', role: 'pk' } as const;
const FLOOR = '0.3.43';
const LINK_KEY = 'design-link';

/** The shopper's own link: it reads the design and changes it while it is a draft. */
const OWN = {
  table: 'designs',
  key: LINK_KEY,
  methods: ['GET', 'PATCH'],
  select: ['id', 'base_id', 'values', 'state'],
  writable: ['base_id', 'values'],
  writableWhen: { state: ['draft'] },
  claim: { by: 'token', column: 'link_token', own: true, address: 'email' },
};
/** Saving a design through each app's key: its own link comes back once, with a session on it. */
const SAVE = { table: 'designs', methods: ['POST'], writable: ['base_id', 'values', 'email'], select: ['id', 'code'], humanCheck: true, appColumn: 'app', shareLink: 'link_token' };
/** A design read by its own code, by whoever the app signed in. */
const BY_CODE = { table: 'designs', methods: ['GET'], select: ['id', 'values', 'state'], appColumn: 'app', level: 'lookup', unlockBy: { header: true, column: 'code', self: true, length: 16 } };

function kit(entries: Doc[] = [SAVE, OWN], over: Doc = {}): Doc {
  return {
    kind: 'add-on',
    manifestVersion: 1,
    key: 'design-kit',
    name: 'Design kit',
    version: '1.0.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'MIT',
    description: { key: 'kit.d', fallback: 'Designs.' },
    categories: ['data'],
    compatibility: { minAdminiumVersion: FLOOR },
    addOn: { attaches: [{ app: 'printing', range: '*' }], connect: { kind: 'none' } },
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'bases', columns: [pk, { ref: 'name', type: 'text', maxLength: 80 }] },
        {
          ref: 'designs',
          columns: [
            pk,
            { ref: 'app', type: 'text', maxLength: 32, nullable: true },
            { ref: 'code', type: 'text', maxLength: 24, nullable: true, rules: { code: { length: 16 } } },
            { ref: 'link_token', type: 'text', maxLength: 16, nullable: true, rules: { code: { length: 16, hiddenFromStaff: true } } },
            { ref: 'base_id', type: 'fk', references: 'bases', nullable: true },
            { ref: 'values', type: 'json', nullable: true },
            { ref: 'state', type: 'enum', enum: ['draft', 'ordered'], default: 'draft' },
            { ref: 'email', type: 'text', maxLength: 120, nullable: true },
          ],
        },
      ],
    },
    publicKeys: { [LINK_KEY]: {} },
    publicAccess: entries,
    ...over,
  };
}

const issues = (doc: Doc): string[] => {
  const parsed = addOnManifestSchema.safeParse(doc);
  return parsed.success ? [] : parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
};

describe("a design changed in place through its own link (an add-on's own link key)", () => {
  it('a link key opening its row as the row\'s own link reads it and changes it in a named state: taken', () => {
    expect(issues(kit())).toEqual([]);
    expect(issues(kit([SAVE, OWN, BY_CODE]))).toEqual([]);
  });

  it('a change with no state it is held to is refused: an ordered design is the order\'s', () => {
    const { writableWhen: _when, ...loose } = OWN;
    expect(issues(kit([SAVE, loose]))).toContain(`publicAccess.1.writableWhen: a row changed through "${LINK_KEY}" is changed only while it is in a state the entry names: give it writableWhen, e.g. {"state": ["draft"]}`);
    // A time window is no state.
    expect(issues(kit([SAVE, { ...OWN, writableWhen: { state: 'from-now' } }])).join('\n')).toContain('changed only while it is in a state the entry names');
  });

  it('the column that holds the app is never moved through the link, nor the link\'s own code, nor where it is mailed', () => {
    expect(issues(kit([SAVE, { ...OWN, writable: ['values', 'app'] }]))).toContain('publicAccess.1.writable: "designs.app" holds the app a row is for (appColumn), so no link moves it');
    expect(issues(kit([SAVE, { ...OWN, writable: ['values', 'link_token'] }])).join('\n')).toContain('"designs.link_token" opens or closes the row\'s own link, so no browser writes it');
    expect(issues(kit([SAVE, { ...OWN, writable: ['values', 'email'] }])).join('\n')).toContain('"designs.email" is an address the row\'s own link is emailed to');
    // An enum it may set says the values.
    expect(issues(kit([SAVE, { ...OWN, writable: ['values', 'state'] }])).join('\n')).toContain('"state" is an enum a browser changes; list the values it may set');
  });

  it('a link that is not the row\'s own still only reads, and the own link makes no row', () => {
    const shared = { ...OWN, claim: { by: 'token', column: 'link_token' } };
    expect(issues(kit([{ ...SAVE, shareLink: undefined }, shared])).join('\n')).toContain(`"${LINK_KEY}" opens a row to whoever holds its link, so it only reads`);
    expect(issues(kit([SAVE, { ...OWN, methods: ['GET', 'PATCH', 'POST'] }])).join('\n')).toContain(`"${LINK_KEY}" opens a row as its own link, which reads it and changes it, and makes no row`);
  });

  it('is a word of its floor: an older floor is told to rise', () => {
    expect(WORD_FLOORS['publicAccess.ownLink']).toBe(FLOOR);
    expect(installFloorWords(kit()).map((found) => found.word)).toContain('publicAccess.ownLink');
    const old = validateManifest({ ...kit(), compatibility: { minAdminiumVersion: '0.3.42' } });
    expect(old.ok).toBe(false);
    expect(JSON.stringify(old)).toContain('0.3.43');
  });
});

describe('a design read by its code, by whoever an app signed in', () => {
  it('reads one row by its own code, held to the app: taken, and a word of its floor', () => {
    expect(issues(kit([SAVE, OWN, BY_CODE]))).toEqual([]);
    expect(WORD_FLOORS['publicAccess.sessionRead']).toBe(FLOOR);
    expect(installFloorWords(kit([SAVE, OWN, BY_CODE])).map((found) => found.word)).toContain('publicAccess.sessionRead');
  });

  it('never a list: with no code to open it by, it is refused', () => {
    const { unlockBy: _unlock, ...list } = BY_CODE;
    expect(issues(kit([SAVE, OWN, list])).join('\n')).toContain("an add-on's read for whoever an app signed in opens one row by its own code");
  });

  it('never by the link\'s secret, and never shows the code back', () => {
    expect(issues(kit([SAVE, OWN, { ...BY_CODE, unlockBy: { ...BY_CODE.unlockBy, column: 'link_token' } }])).join('\n')).toContain("a shared link's code is never looked up");
    expect(issues(kit([SAVE, OWN, { ...BY_CODE, select: ['id', 'code'] }])).join('\n')).toContain('"designs.code" opens the row, so the row does not show it');
  });
});

/** A shop whose customers' details are kept on another row, as JSON, or on the kit's designs. */
function shop(copies: Doc[]): Doc {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'printing',
    name: 'Print',
    version: '1.0.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'MIT',
    description: { key: 'p.d', fallback: 'Print.' },
    categories: ['commerce'],
    compatibility: { minAdminiumVersion: FLOOR },
    addOns: { requires: [{ key: 'design-kit', range: '^1.0.0', reason: { 'en-US': 'Designs.' } }] },
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'customers', keyField: 'name', columns: [pk, { ref: 'name', type: 'text', maxLength: 80, nullable: true }, { ref: 'email', type: 'text', maxLength: 120, nullable: true }] },
        {
          ref: 'orders',
          columns: [pk, { ref: 'customer_id', type: 'fk', references: 'customers', nullable: true }, { ref: 'email', type: 'text', maxLength: 120, nullable: true }, { ref: 'gift', type: 'json', nullable: true }, { ref: 'note', type: 'text', maxLength: 200, nullable: true }],
        },
        { ref: 'order_lines', columns: [pk, { ref: 'order_id', type: 'fk', references: 'orders' }, { ref: 'design_id', type: 'int', nullable: true, rules: { addOnLink: { addOn: 'design-kit', table: 'designs' } } }] },
      ],
    },
    pages: [{ ref: 'orders', template: 'page-crud', title: { key: 'p.o', fallback: 'Orders' }, nav: { group: 'manage', icon: 'list', order: 1 }, bindings: { main: 'orders' } }],
    frontends: [{ side: 'staff', kind: 'none' }],
    people: [{ table: 'customers', kind: 'people', email: 'email', name: 'name', copies: [{ table: 'orders', column: 'email', holds: 'email', via: 'customer_id' }, ...copies] }],
  };
}
const appIssues = (doc: Doc): string[] => {
  const parsed = appManifestSchema.safeParse(doc);
  return parsed.success ? [] : parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
};

describe("a person's details kept as JSON (people copies, holds details)", () => {
  it('a json column of the app, and a design\'s words on the kit\'s table, held as details: taken', () => {
    const copies = [
      { table: 'orders', column: 'gift', holds: 'details', via: 'customer_id' },
      { addOn: 'design-kit', table: 'designs', column: 'values', holds: 'details', via: 'order_lines.design_id' },
    ];
    expect(appIssues(shop(copies))).toEqual([]);
    expect(WORD_FLOORS['people.copyDetails']).toBe(FLOOR);
    expect(installFloorWords(shop(copies)).map((found) => found.word)).toContain('people.copyDetails');
  });

  it('a json column held as an address, a name or a number is refused: a search reads those as text', () => {
    for (const holds of ['email', 'name', 'phone']) {
      expect(appIssues(shop([{ table: 'orders', column: 'gift', holds, via: 'customer_id' }])).join('\n'), holds).toContain('"orders.gift" is not a text column');
    }
  });

  it('details may be text too, and still not a number', () => {
    expect(appIssues(shop([{ table: 'orders', column: 'note', holds: 'details', via: 'customer_id' }]))).toEqual([]);
    expect(appIssues(shop([{ table: 'orders', column: 'customer_id', holds: 'details' }])).join('\n')).toContain('is not a text or json column (their details)');
  });
});
