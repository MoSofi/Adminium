// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An add-on's record panels as its manifest is checked: on its own tables,
 * under its key, apart from its pages; opened by a role as one of its pages
 * is (`page:@<id>:view`); and named as a word of the release that reads it.
 */
import { describe, expect, it } from 'vitest';

import { installFloorWords, validateManifest, WORD_FLOORS } from '../src/index.js';

type Doc = Record<string, unknown>;
const pk = { ref: 'id', type: 'int', role: 'pk' };
const PANEL = { id: 'design-kit-editor', on: 'designs', client: 'dist/panel.js', title: { key: 'design-kit.panel.title', fallback: 'Design' } };

function kit(addOn: Doc = {}, top: Doc = {}): Doc {
  return {
    manifestVersion: 1,
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'MIT',
    version: '1.0.0',
    categories: ['data'],
    compatibility: { minAdminiumVersion: '0.3.43' },
    kind: 'add-on',
    key: 'design-kit',
    name: 'Design kit',
    description: { key: 'design-kit.description', fallback: 'Designs.' },
    addOn: { attaches: [{ app: '*', range: '*' }], connect: { kind: 'none' }, panels: [PANEL], ...addOn },
    requiredSchema: { prefixed: true, tables: [{ ref: 'designs', columns: [pk, { ref: 'title', type: 'text', maxLength: 80 }] }] },
    ...top,
  };
}
const issuesOf = (doc: unknown): string[] => {
  const result = validateManifest(doc);
  return result.ok ? [] : result.issues.map((issue) => `${issue.path}: ${issue.message}`);
};

describe('an add-on\'s record panels', () => {
  it('validate on its own tables', () => {
    expect(issuesOf(kit())).toEqual([]);
    expect(issuesOf(kit({ panels: [{ ...PANEL, on: 'orders' }] }))).toContainEqual(expect.stringContaining('"orders" is not one of this add-on\'s own tables'));
  });

  it('are opened by a role as one of its pages is', () => {
    const roles = (grant: string) => ({ roles: [{ key: 'designer', name: 'Designer', permissions: [grant] }] });
    expect(issuesOf(kit({}, roles('page:@design-kit-editor:view')))).toEqual([]);
    expect(issuesOf(kit({}, roles('page:@design-kit-other:view')))).toContainEqual(expect.stringContaining('a role opens one of this add-on\'s own pages'));
  });

  it('are a word of the release that reads them', () => {
    expect(installFloorWords(kit())).toContainEqual(expect.objectContaining({ word: 'addOn.panels', path: 'addOn.panels' }));
    expect(WORD_FLOORS['addOn.panels']).toBe('0.3.43');
  });
});
