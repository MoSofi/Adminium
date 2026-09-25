// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The builder's form spells a window as "the last n units". A card whose
 * window is on the venue's calendar, moved back, following the day control or
 * reaching ahead from today would be saved back as a different window — "Not
 * yet due" turned into "the last day" — so the editor must warn before it.
 */
import { describe, expect, it } from 'vitest';
import type { QueryDescriptor } from '@adminium/engine/config';

import { draftIsLossy } from './bindingDraft.js';

const base: QueryDescriptor = {
  kind: 'table-query',
  connectionId: 'conn_1',
  source: { name: 'invoices', type: 'table' },
  shape: 'single-metric',
  aggregations: [{ fn: 'sum', column: 'balance', alias: 'value' }],
};
const window = { column: 'due_on', last: 1, unit: 'day' as const, compareToPrior: false };

describe('draftIsLossy — windows the form cannot say', () => {
  it('keeps a plain rolling window', () => {
    expect(draftIsLossy({ ...base, window })).toBe(false);
  });

  it('flags a window that reaches ahead, one on the calendar, one moved back, one that follows the day', () => {
    expect(draftIsLossy({ ...base, window: { ...window, ahead: true } })).toBe(true);
    expect(draftIsLossy({ ...base, window: { ...window, calendar: true } })).toBe(true);
    expect(draftIsLossy({ ...base, window: { ...window, offset: 1 } })).toBe(true);
    expect(draftIsLossy({ ...base, window: { ...window, param: 'day' } })).toBe(true);
  });
});
