// SPDX-License-Identifier: AGPL-3.0-only
/**
 * HOW AN APP BINDS AN ADD-ON, AS THE VALIDATOR READS IT.
 *
 * From `HOST_REFERENCES_FLOOR` on, an add-on's foreign keys name its own
 * tables only: the app binds the add-on from its side. A manifest declaring
 * an older floor keeps pointing at the database's tables as it always did.
 *
 * And the words that come with it: an add-on's entry held to the app whose
 * key serves it (`appColumn`), an add-on's rows that expire (`expire`), and
 * a person's copy kept on an add-on's table, reached through the app's link
 * (`people[].copies[].addOn`).
 */
import { describe, expect, it } from 'vitest';

import { HOST_REFERENCES_FLOOR, WORD_FLOORS, addOnManifestSchema, appManifestSchema } from '../src/index.js';

type Doc = Record<string, unknown>;
const pk = { ref: 'id', type: 'int', role: 'pk' } as const;

/** A small add-on whose templates point at a product, at the floor it says. */
export function bindingKit(floor: string, over: Doc = {}): Doc {
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
    compatibility: { minAdminiumVersion: floor },
    addOn: { attaches: [{ app: 'printing', range: '*' }], connect: { kind: 'none' } },
    requiredSchema: {
      tables: [
        { ref: 'bases', columns: [pk, { ref: 'name', type: 'text', maxLength: 80 }] },
        { ref: 'templates', columns: [pk, { ref: 'base_id', type: 'fk', references: 'bases' }, { ref: 'product_id', type: 'fk', references: 'products' }] },
      ],
    },
    ...over,
  };
}

const issues = (doc: Doc) => {
  const parsed = addOnManifestSchema.safeParse(doc);
  return parsed.success ? [] : parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
};

describe("an add-on's foreign keys, at the floor that holds them to its own tables", () => {
  it('the floor is a version, and the coordinator moves it at the release', () => {
    expect(HOST_REFERENCES_FLOOR).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('at the floor, a foreign key into a table the add-on does not declare is refused by its path, saying how an app binds it', () => {
    const found = issues(bindingKit(HOST_REFERENCES_FLOOR));
    expect(found).toEqual([
      {
        path: 'requiredSchema.tables.1.columns.2.references',
        message: expect.stringContaining('"products" is not a table of this add-on'),
      },
    ]);
    expect(found[0]!.message).toContain('rules.addOnLink');
    // Above the floor too.
    expect(issues(bindingKit('9.0.0')).map((issue) => issue.path)).toEqual(['requiredSchema.tables.1.columns.2.references']);
  });

  it('a foreign key into its own table is taken at the floor', () => {
    const own = bindingKit(HOST_REFERENCES_FLOOR);
    const tables = (own['requiredSchema'] as { tables: Doc[] }).tables;
    tables[1] = { ref: 'templates', columns: [pk, { ref: 'base_id', type: 'fk', references: 'bases' }] };
    expect(issues(own)).toEqual([]);
  });

  it('below the floor, the reuse of a table the database has is kept as it was', () => {
    expect(issues(bindingKit('0.3.1'))).toEqual([]);
    expect(issues(bindingKit('0.3.42'))).toEqual([]);
  });
});

/** The kit with its own tables only, its designs expiring, and entries held to each app. */
function heldKit(over: { designs?: Doc; entries?: Doc[] } = {}): Doc {
  return bindingKit(HOST_REFERENCES_FLOOR, {
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'bases', columns: [pk, { ref: 'name', type: 'text', maxLength: 80 }, { ref: 'app', type: 'text', maxLength: 32, nullable: true }] },
        {
          ref: 'designs',
          columns: [
            pk,
            { ref: 'app', type: 'text', maxLength: 32, nullable: true },
            { ref: 'state', type: 'enum', enum: ['draft', 'ordered'], default: 'draft' },
            { ref: 'name_text', type: 'text', maxLength: 80, nullable: true },
            { ref: 'updated_at', type: 'timestamptz', nullable: true },
            { ref: 'size', type: 'int', nullable: true },
          ],
          expire: { after: 'updated_at', days: 90, unless: { column: 'state', equals: 'ordered' } },
          ...over.designs,
        },
      ],
    },
    publicAccess: over.entries ?? [
      { table: 'bases', methods: ['GET'], select: ['id', 'name'], appColumn: 'app' },
      { table: 'designs', methods: ['POST'], writable: ['name_text'], select: ['id'], humanCheck: true, appColumn: 'app' },
    ],
  });
}

describe("an add-on's entry held to the app whose key serves it (appColumn)", () => {
  it('a text column of the entry\'s table, which the entry neither writes nor sets, is taken', () => {
    expect(issues(heldKit())).toEqual([]);
  });

  it('a column that is not there, not text, written by the browser or set by the entry is refused by its path', () => {
    const one = (entry: Doc) => issues(heldKit({ entries: [entry] })).filter((issue) => issue.path === 'publicAccess.0.appColumn').map((issue) => issue.message);
    expect(one({ table: 'bases', methods: ['GET'], select: ['id'], appColumn: 'shop' })).toEqual(['"bases" has no column "shop"']);
    expect(one({ table: 'designs', methods: ['GET'], select: ['id'], appColumn: 'size' })[0]).toContain('is not a text column');
    expect(one({ table: 'designs', methods: ['POST'], writable: ['name_text', 'app'], select: ['id'], humanCheck: true, appColumn: 'app' })[0]).toContain('Adminium writes it');
    expect(one({ table: 'designs', methods: ['POST'], writable: ['name_text'], defaults: { app: 'maker' }, select: ['id'], humanCheck: true, appColumn: 'app' })[0]).toContain('Adminium writes it');
  });

  it('an entry on a key of the add-on\'s own is served by no app, and is refused', () => {
    const kit = heldKit({ entries: [{ table: 'bases', key: 'links', methods: ['GET'], select: ['id'], appColumn: 'app' }] });
    expect(issues(kit).map((issue) => issue.message)).toContainEqual(expect.stringContaining('is served by no app\'s key'));
  });

  it('is an add-on\'s word, at its floor: an app\'s entry is refused, and an older floor is told to rise', () => {
    expect(WORD_FLOORS['publicAccess.appColumn']).toBe(HOST_REFERENCES_FLOOR);
    const old = { ...heldKit(), compatibility: { minAdminiumVersion: '0.3.40' } };
    expect(issues(old).map((issue) => issue.path)).toEqual(expect.arrayContaining(['publicAccess.0.appColumn']));
  });
});

describe("an add-on's rows that expire", () => {
  it('a moment column, some days, and a column whose value keeps a row, are taken', () => {
    expect(issues(heldKit())).toEqual([]);
  });

  it('a column that is no moment, or not there, and a value its enum lacks, are refused by their paths', () => {
    const found = (expire: Doc) => issues(heldKit({ designs: { expire } })).map((issue) => `${issue.path}: ${issue.message}`);
    expect(found({ after: 'name_text', days: 90 })).toEqual(['requiredSchema.tables.1.expire.after: "name_text" is not a date or a moment (timestamptz), so a row\'s age is not counted from it']);
    expect(found({ after: 'made_at', days: 90 })).toEqual(['requiredSchema.tables.1.expire.after: the table has no column "made_at"']);
    expect(found({ after: 'updated_at', days: 90, unless: { column: 'state', equals: 'paid' } })).toEqual(['requiredSchema.tables.1.expire.unless.equals: "paid" is not one of the values of "state"']);
    expect(found({ after: 'updated_at', days: 0 })[0]).toContain('expire.days');
  });

  it('is an add-on\'s word: an app\'s table is refused', () => {
    const app = {
      kind: 'app',
      manifestVersion: 1,
      key: 'printing',
      name: 'Print',
      version: '1.0.0',
      publisher: { id: 'adminium', name: 'Adminium' },
      license: 'MIT',
      description: { key: 'p.d', fallback: 'Print.' },
      categories: ['commerce'],
      compatibility: { minAdminiumVersion: HOST_REFERENCES_FLOOR },
      requiredSchema: { tables: [{ ref: 'jobs', columns: [pk, { ref: 'made_at', type: 'timestamptz', nullable: true }], expire: { after: 'made_at', days: 30 } }] },
      pages: [{ ref: 'jobs', template: 'page-crud', title: { key: 'p.j', fallback: 'Jobs' }, nav: { group: 'manage', icon: 'printer', order: 1 }, bindings: { main: 'jobs' } }],
      frontends: [{ side: 'staff', kind: 'none' }],
    };
    const parsed = appManifestSchema.safeParse(app);
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues.map((issue) => issue.message)).toContainEqual(expect.stringContaining("only an add-on's own table expires"));
  });
});

/** A shop whose customers' words are copied onto the kit's designs, reached through the line's link. */
function shop(copy: Doc, more: Doc = {}): Doc {
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
    compatibility: { minAdminiumVersion: HOST_REFERENCES_FLOOR },
    addOns: { requires: [{ key: 'design-kit', range: '^1.0.0', reason: { 'en-US': 'Designs.' } }] },
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'customers', keyField: 'name', columns: [pk, { ref: 'name', type: 'text', maxLength: 80, nullable: true }, { ref: 'email', type: 'text', maxLength: 120, nullable: true }] },
        { ref: 'orders', columns: [pk, { ref: 'customer_id', type: 'fk', references: 'customers', nullable: true }, { ref: 'email', type: 'text', maxLength: 120, nullable: true }] },
        {
          ref: 'order_lines',
          columns: [pk, { ref: 'order_id', type: 'fk', references: 'orders' }, { ref: 'design_id', type: 'int', nullable: true, rules: { addOnLink: { addOn: 'design-kit', table: 'designs' } } }, { ref: 'note_id', type: 'int', nullable: true }],
        },
        { ref: 'stray', columns: [pk, { ref: 'design_id', type: 'int', nullable: true, rules: { addOnLink: { addOn: 'design-kit', table: 'designs' } } }] },
      ],
    },
    pages: [{ ref: 'orders', template: 'page-crud', title: { key: 'p.o', fallback: 'Orders' }, nav: { group: 'manage', icon: 'list', order: 1 }, bindings: { main: 'orders' } }],
    frontends: [{ side: 'staff', kind: 'none' }],
    people: [{ table: 'customers', kind: 'people', email: 'email', name: 'name', copies: [{ table: 'orders', column: 'email', holds: 'email', via: 'customer_id' }, copy] }],
    ...more,
  };
}
const appIssues = (doc: Doc) => {
  const parsed = appManifestSchema.safeParse(doc);
  return parsed.success ? [] : parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
};
const COPY = { addOn: 'design-kit', table: 'designs', column: 'name_text', holds: 'name', via: 'order_lines.design_id' };

describe("a person's copy on an add-on's table (people copies, addOn)", () => {
  it('reached through the app\'s link from a table that reaches the person, of an add-on the app requires: taken', () => {
    expect(appIssues(shop(COPY))).toEqual([]);
    expect(WORD_FLOORS['people.addOnCopies']).toBe(HOST_REFERENCES_FLOOR);
  });

  it('an add-on the app does not require, a column that is no link into that table, and a table that reaches nobody are refused', () => {
    const at = 'people.0.copies.1';
    const said = (doc: Doc) => appIssues(doc).filter((issue) => issue.path.startsWith(at)).map((issue) => `${issue.path}: ${issue.message}`);
    expect(said(shop(COPY, { addOns: { suggests: [{ key: 'design-kit', range: '^1.0.0', reason: { 'en-US': 'Designs.' } }] } }))).toEqual([
      `${at}.addOn: a copy on "design-kit"'s table is kept only of an add-on the app requires (addOns.requires)`,
    ]);
    expect(said(shop({ ...COPY, via: 'order_lines.note_id' }))).toEqual([`${at}.via: "order_lines.note_id" is not a link into "design-kit"'s table "designs" (rules.addOnLink)`]);
    expect(said(shop({ ...COPY, via: 'stray.design_id' }))).toEqual([`${at}.via: "stray" does not reach the person: it is not "customers" or one of this entry's copy tables, and links to none of them`]);
    expect(said(shop({ ...COPY, via: 'nowhere.design_id' }))).toEqual([`${at}.via: "nowhere" is not a table of this app`]);
    expect(said(shop({ ...COPY, via: 'design_id' }))[0]).toContain('"table.column"');
  });
});
