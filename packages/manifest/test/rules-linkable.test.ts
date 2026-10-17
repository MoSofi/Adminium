// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A link that may name only some rows (`linkable`), as the manifest check
 * reads it: a rule of a foreign key, its conditions on the columns of the
 * table the key points at (in the shape a move's `linked` takes), never on a
 * secret there, and a manifest that uses it asks for the release that runs it.
 */
import { describe, expect, it } from 'vitest';

import { installFloorWords, validateManifest, WORD_FLOORS } from '../src/index.js';

const en = (text: string) => ({ 'en-US': text });

/** A price list and the quote lines that name its lines; `rules` go on `quote_lines.price_id`. */
function quotes(rules: Record<string, unknown> = { linkable: { where: [{ column: 'active', eq: true }] } }, on: { ref?: string; type?: string; references?: string } = {}): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'quotes',
    name: 'Quotes',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
    license: 'AGPL-3.0-only',
    description: { key: 'mft.quotes.desc', fallback: 'Quotes.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: '0.3.28', engines: ['postgres', 'mysql', 'sqlite'] },
    navGroups: [{ key: 'quotes', label: en('Quotes'), order: 1 }],
    requiredSchema: {
      prefixed: true,
      tables: [
        {
          ref: 'price_list',
          columns: [
            { ref: 'id', type: 'int', role: 'pk' },
            { ref: 'name', type: 'text', maxLength: 120 },
            { ref: 'list_rate', type: 'decimal', scale: 2 },
            { ref: 'active', type: 'bool', default: true },
            { ref: 'kind', type: 'enum', enum: ['service', 'goods'], default: 'service' },
            { ref: 'pin', type: 'text', maxLength: 12, nullable: true, rules: { secret: true } },
          ],
        },
        {
          ref: 'quote_lines',
          columns: [
            { ref: 'id', type: 'int', role: 'pk' },
            { ref: on.ref ?? 'price_id', type: on.type ?? 'fk', ...(on.type === undefined || on.type === 'fk' ? { references: on.references ?? 'price_list' } : {}), nullable: true, rules },
            { ref: 'list_rate', type: 'decimal', scale: 2, nullable: true, rules: { copy: { via: 'price_id', from: 'list_rate', mode: 'always' } } },
          ],
        },
      ],
    },
    pages: [{ ref: 'quotes-lines', template: 'page-crud', title: { key: 't.lines', fallback: 'Lines' }, nav: { group: 'quotes', icon: 'list', order: 1 }, bindings: { rows: 'quote_lines' } }],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } }],
  };
}

const issuesOf = (doc: Record<string, unknown>): string[] => {
  const result = validateManifest(doc);
  return result.ok ? [] : result.issues.map((issue) => `${String(issue.path)}: ${issue.message}`);
};

describe('a link that may name only some rows', () => {
  it('is a rule of a foreign key, kept as written, and asks for the release that runs it', () => {
    expect(issuesOf(quotes())).toEqual([]);
    const result = validateManifest(quotes({ linkable: { where: [{ column: 'active', eq: true }, { column: 'kind', in: ['service'] }, { column: 'list_rate', gt: 0 }] } }));
    if (!result.ok || result.manifest.kind !== 'app') throw new Error('expected an app');
    const column = result.manifest.requiredSchema.tables[1]!.columns[1]!;
    expect(column.rules?.linkable).toEqual({ where: [{ column: 'active', eq: true }, { column: 'kind', in: ['service'] }, { column: 'list_rate', gt: 0 }] });
    const words = installFloorWords(quotes());
    expect(words.find((found) => found.word === 'column.linkable')?.path).toBe('requiredSchema.tables.1.columns.1.rules.linkable');
    expect(WORD_FLOORS['column.linkable']).toBe('0.3.28');
    // An older floor is told which release reads the word.
    const older = quotes();
    (older['compatibility'] as Record<string, unknown>)['minAdminiumVersion'] = '0.3.27';
    expect(issuesOf(older).join('\n')).toContain('column.linkable');
  });

  it('is refused on a column that names no row', () => {
    expect(issuesOf(quotes(undefined, { type: 'int' })).join('\n')).toContain('only a foreign key names a row, so only one takes linkable');
    expect(issuesOf(quotes(undefined, { ref: 'note', type: 'text' })).join('\n')).toContain('only a foreign key names a row, so only one takes linkable');
  });

  it('names columns of the table the link points at, with values they can hold', () => {
    const at = (where: unknown[]) => issuesOf(quotes({ linkable: { where } })).join('\n');
    // `price_list` has `active`; the quote line does not, and the condition reads the price list's row.
    expect(at([{ column: 'nope', eq: true }])).toContain('"price_list" has no column "nope"');
    expect(at([{ column: 'kind', in: ['rental'] }])).toContain('"rental" is not a value of "price_list.kind"');
    expect(at([{ column: 'name', gt: 3 }])).toContain('"price_list.name" is not a number, so it cannot be compared');
    expect(at([{ column: 'pin', isNull: true }])).toContain('"price_list.pin" is a secret, and a link is never judged by one');
  });

  it('takes 1 to 8 conditions, each saying one test', () => {
    expect(issuesOf(quotes({ linkable: { where: [] } }))).not.toEqual([]);
    expect(issuesOf(quotes({ linkable: { where: Array.from({ length: 9 }, () => ({ column: 'active', eq: true })) } }))).not.toEqual([]);
    expect(issuesOf(quotes({ linkable: { where: [{ column: 'active', eq: true, isNull: false }] } }))).not.toEqual([]);
    expect(issuesOf(quotes({ linkable: { where: [{ column: 'active' }] } }))).not.toEqual([]);
    expect(issuesOf(quotes({ linkable: [{ column: 'active', eq: true }] }))).not.toEqual([]);
    expect(issuesOf(quotes({ linkable: { where: [{ column: 'active', eq: true }], message: 'Retired' } }))).not.toEqual([]);
  });
});

/** Companies, their contacts, deals for a company, and site visits on a deal; `rules` go on `site_visits.contact_id`. */
function visits(rules: Record<string, unknown>): Record<string, unknown> {
  const doc = quotes();
  (doc['requiredSchema'] as { tables: unknown[] }).tables = [
    { ref: 'companies', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'name', type: 'text', maxLength: 80 }, { ref: 'code', type: 'text', maxLength: 12, nullable: true, rules: { secret: true } }] },
    {
      ref: 'contacts',
      columns: [
        { ref: 'id', type: 'int', role: 'pk' },
        { ref: 'company_id', type: 'fk', references: 'companies' },
        { ref: 'name', type: 'text', maxLength: 80 },
        { ref: 'pin', type: 'text', maxLength: 12, nullable: true, rules: { secret: true } },
      ],
    },
    { ref: 'deals', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'company_id', type: 'fk', references: 'companies' }, { ref: 'name', type: 'text', maxLength: 80 }] },
    {
      ref: 'site_visits',
      columns: [
        { ref: 'id', type: 'int', role: 'pk' },
        { ref: 'deal_id', type: 'fk', references: 'deals' },
        { ref: 'company_id', type: 'int', nullable: true },
        { ref: 'contact_id', type: 'fk', references: 'contacts', nullable: true, rules },
        { ref: 'note', type: 'text', maxLength: 80, nullable: true },
      ],
    },
  ];
  doc['pages'] = [{ ref: 'quotes-visits', template: 'page-crud', title: { key: 't.visits', fallback: 'Visits' }, nav: { group: 'quotes', icon: 'list', order: 1 }, bindings: { rows: 'site_visits' } }];
  return doc;
}

describe('a link whose named row must hold what the row written holds', () => {
  const same = (pairs: unknown, where?: unknown) => issuesOf(visits({ linkable: { ...(where === undefined ? {} : { where }), same: pairs } })).join('\n');

  it('compares a column of the named row with one of the row, or one a link of the row names, and asks for the release that runs it', () => {
    expect(same([{ column: 'company_id', as: 'deal_id.company_id' }])).toBe('');
    expect(same([{ column: 'company_id', as: 'company_id' }])).toBe('');
    expect(same([{ column: 'company_id', as: 'deal_id.company_id' }], [{ column: 'name', isNull: false }])).toBe('');
    const words = installFloorWords(visits({ linkable: { same: [{ column: 'company_id', as: 'deal_id.company_id' }] } }));
    expect(words.map((found) => `${found.word} ${found.path}`)).toContain('linkable.same requiredSchema.tables.3.columns.3.rules.linkable.same');
    expect(WORD_FLOORS['linkable.same']).toBe('0.3.28');
  });

  it('refuses a column that is not there, a secret on either side, a hop that is no link, the link itself, and two columns that never hold one value', () => {
    expect(same([{ column: 'nope', as: 'deal_id.company_id' }])).toContain('"contacts" has no column "nope"');
    expect(same([{ column: 'pin', as: 'note' }])).toContain('"contacts.pin" is a secret, and a link is never judged by one');
    expect(same([{ column: 'company_id', as: 'nope' }])).toContain('"site_visits" has no column "nope"');
    expect(same([{ column: 'company_id', as: 'note.company_id' }])).toContain('"site_visits.note" is not a foreign key');
    expect(same([{ column: 'company_id', as: 'deal_id.nope' }])).toContain('"deals" has no column "nope"');
    expect(same([{ column: 'company_id', as: 'contact_id' }])).toContain('a link is compared with another column, not with itself');
    expect(same([{ column: 'company_id', as: 'deal_id.name' }])).toContain('"contacts.company_id" holds int and "deal_id.name" holds text');
    expect(issuesOf(visits({ linkable: { same: [{ column: 'id', as: 'deal_id.company_id.code' }] } }))).not.toEqual([]);
  });

  it('says where, same or both; and 1 to 4 pairs', () => {
    expect(issuesOf(visits({ linkable: {} })).join('\n')).toContain('"where", "same", or both');
    expect(issuesOf(visits({ linkable: { same: [] } }))).not.toEqual([]);
    expect(issuesOf(visits({ linkable: { same: Array.from({ length: 5 }, () => ({ column: 'company_id', as: 'company_id' })) } }))).not.toEqual([]);
  });
});
