// SPDX-License-Identifier: AGPL-3.0-only
/**
 * HOW AN APP BINDS AN ADD-ON, AS THE VALIDATOR READS IT.
 *
 * From `HOST_REFERENCES_FLOOR` on, an add-on's foreign keys name its own
 * tables only: the app binds the add-on from its side. A manifest declaring
 * an older floor keeps pointing at the database's tables as it always did.
 */
import { describe, expect, it } from 'vitest';

import { HOST_REFERENCES_FLOOR, addOnManifestSchema } from '../src/index.js';

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
