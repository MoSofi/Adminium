// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { crudDetailTabSchema } from '../src/page-config/detail-config.js';

describe('a record tab\'s own words', () => {
  const tab = { table: 'public.receipts' };

  it('keeps what it says while empty, in every language, and that it offers no "New"', () => {
    const words = { title: 'Nothing received yet', titles: { 'de-DE': 'Noch nichts erhalten' }, body: 'A receipt shows here.', bodies: { 'de-DE': 'Hier.' } };
    expect(crudDetailTabSchema.parse({ ...tab, empty: words, noNew: true })).toMatchObject({ empty: words, noNew: true });
    expect(crudDetailTabSchema.parse({ ...tab, empty: { title: 'Nothing yet' } }).empty).toEqual({ title: 'Nothing yet' });
  });

  it('a tab without them is as it always was', () => {
    const parsed = crudDetailTabSchema.parse(tab);
    expect(parsed.empty).toBeUndefined();
    expect(parsed.noNew).toBeUndefined();
  });

  it('empty words need a title, of a length a tab can show', () => {
    expect(crudDetailTabSchema.safeParse({ ...tab, empty: { body: 'Only a body.' } }).success).toBe(false);
    expect(crudDetailTabSchema.safeParse({ ...tab, empty: { title: 'x'.repeat(121) } }).success).toBe(false);
    expect(crudDetailTabSchema.safeParse({ ...tab, noNew: 'yes' }).success).toBe(false);
  });
});
