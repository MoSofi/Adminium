// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A place and an area as the manifest check reads them: each is a rule of a
 * json column, a column holds one or the other, and a manifest that uses
 * either asks for the release that runs it.
 */
import { describe, expect, it } from 'vitest';

import { installFloorWords, validateManifest, WORD_FLOORS } from '../src/index.js';

const en = (text: string) => ({ 'en-US': text });

function depots(rules: Record<string, Record<string, unknown>> = { spot: { place: true }, zone: { area: true } }, types: Record<string, string> = {}): Record<string, unknown> {
  const column = (ref: string) => ({ ref, type: types[ref] ?? 'json', nullable: true, ...(rules[ref] === undefined ? {} : { rules: rules[ref] }) });
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'depots',
    name: 'Depots',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
    license: 'AGPL-3.0-only',
    description: { key: 'mft.depots.desc', fallback: 'Depots.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: '0.3.28', engines: ['postgres', 'mysql', 'sqlite'] },
    navGroups: [{ key: 'depots', label: en('Depots'), order: 1 }],
    requiredSchema: {
      prefixed: true,
      tables: [{ ref: 'sites', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'name', type: 'text', maxLength: 120 }, column('spot'), column('zone')] }],
    },
    pages: [{ ref: 'depots-sites', template: 'page-crud', title: { key: 't.sites', fallback: 'Sites' }, nav: { group: 'depots', icon: 'list', order: 1 }, bindings: { rows: 'sites' } }],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } }],
  };
}

const issuesOf = (doc: Record<string, unknown>): string[] => {
  const result = validateManifest(doc);
  return result.ok ? [] : result.issues.map((issue) => `${String(issue.path)}: ${issue.message}`);
};

describe('a place and an area in a column', () => {
  it('are rules of a json column', () => {
    expect(issuesOf(depots())).toEqual([]);
    const words = installFloorWords(depots());
    expect(words.map((found) => found.word)).toEqual(expect.arrayContaining(['column.place', 'column.area']));
    expect(words.find((found) => found.word === 'column.place')?.path).toBe('requiredSchema.tables.0.columns.2.rules.place');
    expect(WORD_FLOORS['column.place']).toBe('0.3.28');
    expect(WORD_FLOORS['column.area']).toBe('0.3.28');
  });

  it('are refused on any other column', () => {
    expect(issuesOf(depots(undefined, { spot: 'text' })).join('\n')).toContain('a place is kept in a json column, and "sites.spot" is text');
    expect(issuesOf(depots(undefined, { zone: 'decimal' })).join('\n')).toContain('an area is kept in a json column, and "sites.zone" is decimal');
  });

  it('are one or the other, and only ever `true`', () => {
    expect(issuesOf(depots({ spot: { place: true, area: true } })).join('\n')).toContain('a column holds a place or an area, not both');
    expect(issuesOf(depots({ spot: { place: false } }))).not.toEqual([]);
    expect(issuesOf(depots({ spot: { place: { by: 'town' } } }))).not.toEqual([]);
    expect(issuesOf(depots({ zone: { area: 'polygon' } }))).not.toEqual([]);
  });
});
