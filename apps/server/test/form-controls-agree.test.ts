// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The controls a page's form may name: the manifest check and the install
 * read the same list, so a form the check passes is one the install reads —
 * and a control neither has (`file`) is refused by both, never by the
 * install alone.
 */
import { crudFormConfigSchema, FORM_CONTROLS } from '@adminium/engine/config';
import { PAGE_FORM_CONTROLS, PAGE_FORM_RELATION_CONTROLS, type Manifest } from '@adminium/manifest';
import { describe, expect, it } from 'vitest';

import { formIssues } from '../src/apps/manifest-page-config.js';

type ManifestPage = Parameters<typeof formIssues>[1];

/** Whether a form of one field reads as a form. */
const reads = (field: Record<string, unknown>) => crudFormConfigSchema.safeParse({ v: 2, sections: [{ id: 'main', fields: [field] }] }).success;

describe("a page form's controls", () => {
  it('are the same list in the manifest check as in the form the install reads', () => {
    expect([...PAGE_FORM_CONTROLS].sort()).toEqual([...FORM_CONTROLS].sort());
    for (const control of PAGE_FORM_CONTROLS) expect(reads({ column: 'photo', control }), control).toBe(true);
    for (const control of PAGE_FORM_RELATION_CONTROLS) expect(reads({ relation: 'tags', control }), control).toBe(true);
    expect(reads({ relation: 'tags', control: 'select' })).toBe(false);
  });

  it('refuse "file" at install as the check refuses it', () => {
    expect(reads({ column: 'photo', control: 'file' })).toBe(false);
    const manifest = {
      kind: 'app',
      key: 'crew',
      requiredSchema: { tables: [{ ref: 'sign_offs', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'photo', type: 'text', maxLength: 64, nullable: true }] }] },
    } as unknown as Manifest;
    const page = (control?: string) =>
      ({ ref: 'crew-sign-offs', template: 'page-crud', bindings: { rows: 'sign_offs' }, config: { form: { v: 2, sections: [{ id: 'main', fields: [{ column: 'photo', ...(control === undefined ? {} : { control }) }] }] } } }) as unknown as ManifestPage;
    expect(formIssues(manifest, page())).toEqual([]);
    expect(formIssues(manifest, page('file'))).toHaveLength(1);
  });
});
