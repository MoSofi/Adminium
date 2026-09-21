// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An app manifest's pages, checked against the manifest's own tables — what
 * an app's CI runs before it publishes, and what the install preview reports.
 */
import { describe, expect, it } from 'vitest';

import { checkManifestPages, pageSourceTable, type ManifestPagesInput } from '../src/generate/index.js';

const TABLES: ManifestPagesInput['requiredSchema'] = {
  tables: [
    {
      ref: 'patients',
      columns: [
        { ref: 'id', type: 'int', role: 'pk' },
        { ref: 'name', type: 'text' },
      ],
    },
    {
      ref: 'appointments',
      columns: [
        { ref: 'id', type: 'int', role: 'pk' },
        { ref: 'reason', type: 'text' },
        { ref: 'patient_id', type: 'fk', references: 'patients' },
        { ref: 'starts_at', type: 'timestamptz' },
      ],
    },
  ],
};

const page = (ref: string, template: string, bindings?: Record<string, string>) => ({
  ref,
  template,
  ...(bindings === undefined ? {} : { bindings }),
});

describe('pageSourceTable', () => {
  it('reads both conventions in the fleet', () => {
    expect(pageSourceTable(page('a', 'page-crud', { orders: 'orders' }))).toBe('orders');
    expect(pageSourceTable(page('a', 'page-crud', { rows: 'rooms', types: 'room_types' }))).toBe('rooms');
    expect(pageSourceTable(page('a', 'page-crud', { a: 'x', b: 'y' }))).toBeNull();
    expect(pageSourceTable(page('a', 'page-crud'))).toBeNull();
  });
});

describe('checkManifestPages', () => {
  it('a bound calendar over a table with a date passes', () => {
    expect(
      checkManifestPages({
        requiredSchema: TABLES,
        pages: [page('day', 'page-calendar', { rows: 'appointments' })],
      }),
    ).toEqual([]);
  });

  it('an unbound table-bound page is reported; a dashboard is not', () => {
    const issues = checkManifestPages({
      requiredSchema: TABLES,
      pages: [page('day', 'page-calendar'), page('home', 'page-dashboard')],
    });
    expect(issues.map((i) => [i.page, i.code])).toEqual([['day', 'PAGE_UNBOUND']]);
  });

  it('a calendar bound to a table with no date is unfit, with the fit report', () => {
    const [issue] = checkManifestPages({
      requiredSchema: TABLES,
      pages: [page('people', 'page-calendar', { rows: 'patients' })],
    });
    expect(issue?.code).toBe('PAGE_UNFIT');
    expect(issue?.fit?.requirements.find((r) => r.role === 'event-date')?.satisfiedBy).toBeNull();
  });

  it('names an unknown template, an undeclared table and an ambiguous binding', () => {
    const issues = checkManifestPages({
      requiredSchema: TABLES,
      pages: [
        page('legacy', 'table', { orders: 'orders' }),
        page('ghost', 'page-crud', { rows: 'invoices' }),
        page('two', 'page-crud', { a: 'patients', b: 'appointments' }),
      ],
    });
    expect(issues.map((i) => i.code)).toEqual([
      'PAGE_TEMPLATE_UNKNOWN',
      'PAGE_BINDING_UNKNOWN',
      'PAGE_BINDING_AMBIGUOUS',
    ]);
  });
});
