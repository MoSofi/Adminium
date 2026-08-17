// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Pure helpers behind the audit log: the date-range bounds, and the
 * before/after diff the drawer renders. The diff is where an audit surface
 * either tells the truth or quietly rounds it off.
 */
import { describe, expect, it } from 'vitest';

import {
  EMPTY_AUDIT_FILTERS,
  buildAuditPath,
  dayBound,
  diffRows,
  entityRows,
  formatDiffValue,
  isTruncated,
} from './auditApi.js';

describe('dayBound', () => {
  it('takes the start of the day for `from` and the END of it for `to`', () => {
    // Same date on both ends means "that day"; a naive midnight-to-midnight
    // range would return nothing at all.
    expect(dayBound('2026-08-17', 'start')).toBe(Date.UTC(2026, 7, 17, 0, 0, 0, 0));
    expect(dayBound('2026-08-17', 'end')).toBe(Date.UTC(2026, 7, 17, 23, 59, 59, 999));
  });

  it('returns null for an empty or unparseable day rather than NaN', () => {
    expect(dayBound('', 'start')).toBeNull();
    expect(dayBound('not-a-date', 'start')).toBeNull();
  });
});

describe('buildAuditPath', () => {
  it('sends nothing when nothing is filtered', () => {
    expect(buildAuditPath(EMPTY_AUDIT_FILTERS, null)).toBe('/api/v1/audit');
  });

  it('sends the epoch bounds the route expects', () => {
    const path = buildAuditPath(
      { category: 'rbac', actorId: 'user-1', from: '2026-08-01', to: '2026-08-02' },
      'cur',
    );
    expect(path).toBe(
      `/api/v1/audit?category=rbac&actorId=user-1&from=${String(Date.UTC(2026, 7, 1))}` +
        `&to=${String(Date.UTC(2026, 7, 2, 23, 59, 59, 999))}&cursor=cur`,
    );
  });

  it('drops an unparseable bound instead of sending NaN', () => {
    expect(buildAuditPath({ ...EMPTY_AUDIT_FILTERS, from: 'nope' }, null)).toBe('/api/v1/audit');
  });
});

describe('formatDiffValue', () => {
  it('distinguishes the VALUE null from an absent field', () => {
    // `null` the value is a thing a column can hold; "not in this image" is
    // diffRows returning null, which the drawer draws as a dash.
    expect(formatDiffValue(null)).toBe('null');
  });

  it('passes strings through and stringifies scalars', () => {
    expect(formatDiffValue('dana')).toBe('dana');
    expect(formatDiffValue(42)).toBe('42');
    expect(formatDiffValue(false)).toBe('false');
  });

  it('compacts objects and arrays rather than dropping them', () => {
    expect(formatDiffValue({ a: 1 })).toBe('{"a":1}');
    expect(formatDiffValue(['x'])).toBe('["x"]');
  });

  it('survives a cyclic value — the row still has to exist', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    expect(formatDiffValue(cyclic)).toBe('[unserializable]');
  });
});

describe('diffRows', () => {
  it('unions both images and marks only the fields that differ', () => {
    const rows = diffRows({
      before: { name: 'Old', slug: 'ops' },
      after: { name: 'New', slug: 'ops' },
    });
    expect(rows).toEqual([
      { field: 'name', before: 'Old', after: 'New', changed: true },
      { field: 'slug', before: 'ops', after: 'ops', changed: false },
    ]);
  });

  it('renders a create (after only) and a delete (before only) as what they are', () => {
    expect(diffRows({ after: { name: 'New' } })).toEqual([
      { field: 'name', before: null, after: 'New', changed: true },
    ]);
    expect(diffRows({ before: { name: 'Gone' } })).toEqual([
      { field: 'name', before: 'Gone', after: null, changed: true },
    ]);
  });

  it('returns no rows when the entry recorded no images', () => {
    expect(diffRows(null)).toEqual([]);
    expect(diffRows({})).toEqual([]);
    expect(diffRows({ before: 'not-an-object' })).toEqual([]);
  });

  it('keeps a field that is present but undefined-valued on one side', () => {
    const rows = diffRows({ before: { note: undefined }, after: {} });
    expect(rows).toEqual([{ field: 'note', before: '', after: null, changed: true }]);
  });
});

describe('isTruncated', () => {
  it('reports the §3.11 16 KB cap so a partial diff is never shown as whole', () => {
    expect(isTruncated({ _truncated: true })).toBe(true);
    expect(isTruncated({ before: {} })).toBe(false);
    expect(isTruncated(null)).toBe(false);
  });
});

describe('entityRows', () => {
  it('sorts the resource fields and formats their values', () => {
    expect(entityRows({ table: 'orders', id: 7 })).toEqual([
      { field: 'id', value: '7' },
      { field: 'table', value: 'orders' },
    ]);
  });

  it('is empty when the entry names no resource', () => {
    expect(entityRows(null)).toEqual([]);
  });
});
