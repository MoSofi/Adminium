// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN APP'S STARTING ROWS (`seeds`): what the manifest check accepts and what
 * it refuses. Until 0.3.28 an app's `seeds` were taken and never read: no
 * check looked at them and no install wrote them.
 */
import { describe, expect, it } from 'vitest';

import { MAX_SEED_ROWS, installFloorWords, validateManifest } from '../src/index.js';

const id = { ref: 'id', type: 'int', role: 'pk' };

function app(seeds: unknown, floor = '0.3.28'): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'crm',
    name: 'CRM',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'MIT',
    description: { key: 'd', fallback: 'A CRM' },
    categories: ['crm'],
    compatibility: { minAdminiumVersion: floor },
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'settings', columns: [id, { ref: 'snag_days', type: 'int', default: 5 }] },
        { ref: 'reasons', columns: [id, { ref: 'label', type: 'text', maxLength: 80 }] },
        { ref: 'steps', columns: [id, { ref: 'reason_id', type: 'fk', references: 'reasons' }, { ref: 'owner_id', type: 'text', maxLength: 36, nullable: true, rules: { staff: true } }] },
        { ref: 'notes', private: true, belongs: [{ column: 'manager_id' }], indexes: [['manager_id']], columns: [id, { ref: 'manager_id', type: 'text', maxLength: 36, nullable: true, rules: { staff: true } }] },
      ],
    },
    pages: [{ ref: 'crm-reasons', template: 'page-crud', title: { key: 't', fallback: 'Reasons' }, nav: { group: 'library', icon: 'list', order: 1 }, bindings: { rows: 'reasons' } }],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
    ...(seeds === undefined ? {} : { seeds }),
  };
}

const said = (doc: Record<string, unknown>): string => {
  const result = validateManifest(doc);
  return result.ok ? '' : result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n');
};

const good = [
  { table: 'settings', rows: [{}] },
  { table: 'reasons', rows: [{ '@label': 'late', label: { '@t': { 'en-US': 'Late', 'de-DE': 'Verspätet' } } }, { label: 'Damaged' }] },
  { table: 'steps', rows: [{ reason_id: { '@ref': 'late' }, owner_id: null }] },
];

describe('an app\'s starting rows in the manifest', () => {
  it('are accepted: a row of defaults, a text in several languages, a row that names an earlier one', () => {
    expect(said(app(good))).toBe('');
    expect(said(app(undefined))).toBe('');
  });

  it('need the floor that first writes them', () => {
    expect(installFloorWords(app(good)).filter((found) => found.word === 'app.seeds').map((found) => found.path)).toEqual(['seeds']);
    expect(installFloorWords(app(undefined)).filter((found) => found.word === 'app.seeds')).toEqual([]);
    expect(said(app(good, '0.3.26'))).toMatch(/"app\.seeds" is read by Adminium 0\.3\.28 and later/);
  });

  it('are an add-on\'s word as before: no new floor for an add-on', () => {
    expect(installFloorWords({ kind: 'add-on', seeds: good }).map((found) => found.word)).not.toContain('app.seeds');
  });

  it('refuse a table that is not the app\'s, a column the table lacks, and a directive a seed does not take', () => {
    expect(said(app([{ table: 'nowhere', rows: [{}] }]))).toMatch(/seeds\.0\.table: "nowhere" is not one of this app's tables/);
    expect(said(app([{ table: 'reasons', rows: [{ title: 'Late' }] }]))).toMatch(/seeds\.0\.rows\.0\.title: "reasons" has no column "title"/);
    expect(said(app([{ table: 'reasons', rows: [{ '@onlyIfEmpty': true, label: 'Late' }] }]))).toMatch(/takes "@label" and no other row directive/);
    expect(said(app([{ table: 'reasons', rows: [{ label: { '@day': 3 } }] }]))).toMatch(/a seed value is a plain value/);
    expect(said(app([{ table: 'reasons', rows: [{ '@label': 7, label: 'Late' }] }]))).toMatch(/a label is text/);
    expect(said(app([{ table: 'reasons', rows: Array.from({ length: MAX_SEED_ROWS + 1 }, () => ({ label: 'x' })) }]))).toMatch(/seeded with at most/);
  });

  it('refuse a private table, and a staff member in any row', () => {
    expect(said(app([{ table: 'notes', rows: [{}] }]))).toMatch(/seeds\.0\.table: "notes" is private/);
    expect(said(app([{ table: 'reasons', rows: [{ '@label': 'late', label: 'Late' }] }, { table: 'steps', rows: [{ reason_id: { '@ref': 'late' }, owner_id: 'u_1' }] }]))).toMatch(/seeds\.1\.rows\.0\.owner_id: "owner_id" holds a staff member, and a seed names none/);
  });
});
