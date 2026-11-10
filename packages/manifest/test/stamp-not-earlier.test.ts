// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A stamp kept from moving a date earlier (`stamp.notEarlier`): read from
 * 0.3.53, on a date or timestamptz column only.
 */
import { describe, expect, it } from 'vitest';

import { WORD_FLOORS, installFloorWords, validateManifest } from '../src/index.js';

const id = { ref: 'id', type: 'int', role: 'pk' };

function manifest(floor: string, type = 'date') {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'works',
    name: 'Works',
    version: '1.0.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'AGPL-3.0-only',
    description: { key: 'd', fallback: 'A print works.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: floor },
    requiredSchema: {
      prefixed: true,
      tables: [
        {
          ref: 'jobs',
          columns: [
            id,
            { ref: 'stage', type: 'enum', enum: ['proofing', 'approved'], default: 'proofing' },
            {
              ref: 'ready_by',
              type,
              nullable: true,
              ...(type === 'text' ? { maxLength: 20 } : {}),
              rules: { stamp: { set: type === 'timestamptz' ? 'now' : 'today', on: { column: 'stage', values: ['approved'] }, notEarlier: true } },
            },
          ],
        },
      ],
    },
    pages: [{ ref: 'works-jobs', template: 'page-crud', title: { key: 'p', fallback: 'Jobs' }, nav: { group: 'records', icon: 'list', order: 1 }, bindings: { rows: 'jobs' } }],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
  };
}

const issues = (doc: unknown) => {
  const result = validateManifest(doc);
  return result.ok ? [] : result.issues.map((issue) => `${issue.path}: ${issue.message}`);
};

describe('a stamp kept from moving a date earlier', () => {
  it('is a word read from 0.3.53, named where the column writes it', () => {
    expect(WORD_FLOORS['stamp.notEarlier']).toBe('0.3.53');
    expect(installFloorWords(manifest('0.3.53'))).toContainEqual({ word: 'stamp.notEarlier', path: 'requiredSchema.tables.0.columns.2.rules.stamp.notEarlier' });
  });

  it('validates on a date or timestamptz column at that floor, and is refused below it or on another column', () => {
    expect(issues(manifest('0.3.53'))).toEqual([]);
    expect(issues(manifest('0.3.53', 'timestamptz'))).toEqual([]);
    expect(issues(manifest('0.3.52')).join('\n')).toContain('0.3.53');
    expect(issues(manifest('0.3.53', 'text')).join('\n')).toContain('a stamp kept from moving earlier needs a date or timestamptz column');
  });
});
