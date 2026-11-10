// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A form's reference picker narrowed by another field of the same form
 * (`reference.scope`): a proof's order line among the chosen order's lines.
 * The word is read from 0.3.53; a manifest that uses it says so in its floor.
 */
import { describe, expect, it } from 'vitest';

import { WORD_FLOORS, installFloorWords, validateManifest } from '../src/index.js';

const id = { ref: 'id', type: 'int', role: 'pk' };

function manifest(floor: string, scoped = true) {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'shop',
    name: 'Shop',
    version: '1.0.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'AGPL-3.0-only',
    description: { key: 'd', fallback: 'A shop.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: floor },
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'orders', columns: [id, { ref: 'number', type: 'text', maxLength: 16 }] },
        { ref: 'lines', columns: [id, { ref: 'order_id', type: 'fk', references: 'orders' }, { ref: 'code', type: 'text', maxLength: 16 }] },
        { ref: 'proofs', columns: [id, { ref: 'order_id', type: 'fk', references: 'orders' }, { ref: 'line_id', type: 'fk', references: 'lines' }] },
      ],
    },
    pages: [
      {
        ref: 'shop-proofs',
        template: 'page-crud',
        title: { key: 'p', fallback: 'Proofs' },
        nav: { group: 'records', icon: 'image', order: 1 },
        bindings: { rows: 'proofs' },
        config: {
          form: {
            v: 2,
            sections: [
              {
                id: 's1',
                fields: [
                  { column: 'order_id', control: 'reference' },
                  { column: 'line_id', control: 'reference', reference: { name: 'code', ...(scoped ? { scope: { field: 'order_id', column: 'order_id' } } : {}) } },
                ],
              },
            ],
          },
        },
      },
    ],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
  };
}

describe('a reference picker narrowed by another field of its form', () => {
  it('is a word read from 0.3.53, named where the form writes it', () => {
    expect(WORD_FLOORS['form.referenceScope']).toBe('0.3.53');
    expect(installFloorWords(manifest('0.3.53'))).toContainEqual({ word: 'form.referenceScope', path: 'pages.0.config.form.sections.0.fields.1.reference.scope' });
    expect(installFloorWords(manifest('0.3.53', false)).map((word) => word.word)).not.toContain('form.referenceScope');
  });

  it('validates at that floor, and is refused below it with the release that reads it', () => {
    expect(validateManifest(manifest('0.3.53')).ok).toBe(true);
    const below = validateManifest(manifest('0.3.52'));
    expect(below.ok).toBe(false);
    expect(below.ok ? '' : below.issues.map((issue) => issue.message).join('\n')).toContain('0.3.53');
    expect(validateManifest(manifest('0.3.52', false)).ok).toBe(true);
  });
});
