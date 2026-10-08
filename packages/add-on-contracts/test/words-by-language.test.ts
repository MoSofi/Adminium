// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A text that is drawn before an add-on's code runs — a page's title in the
 * sidebar, a group's heading, a tab on a record — carries its other
 * languages beside the message, by language tag.
 */
import { describe, expect, it } from 'vitest';

import { addOnNavGroupSchema, addOnPageSchema, recordTabSchema } from '../src/index.js';

const title = (fallback: string) => ({ key: `kit.${fallback.toLowerCase()}`, fallback });
const PAGE = { ref: 'count', title: title('Count'), icon: 'clipboard', client: 'dist/count.js' };
const GROUP = { key: 'kit-stock', label: title('Stock'), order: 5 };
const TAB = { id: 'stock', label: title('Stock'), table: 'links', match: { table: 'of_table', row: 'of_row' }, on: 'linked', columns: ['qty'], empty: title('Nothing'), actions: [{ id: 'use', label: title('Use'), child: { table: 'uses', form: ['qty'] } }] };

describe('an add-on\'s words in other languages', () => {
  it('a page takes `titles`, a group `labels`, a record tab `labels` and `empties`, its button `labels`', () => {
    expect(addOnPageSchema.safeParse({ ...PAGE, titles: { 'de-DE': 'Zählen', 'zh-TW': '盤點' } }).success).toBe(true);
    expect(addOnNavGroupSchema.safeParse({ ...GROUP, labels: { 'de-DE': 'Bestand' } }).success).toBe(true);
    const tab = recordTabSchema.safeParse({ ...TAB, labels: { 'de-DE': 'Bestand' }, empties: { 'de-DE': 'Nichts' }, actions: [{ ...TAB.actions[0], labels: { 'de-DE': 'Verwenden' } }] });
    expect(tab.success, JSON.stringify(tab.error?.issues)).toBe(true);
  });

  it('none of them is needed: a manifest written before them reads as it did', () => {
    expect(addOnPageSchema.safeParse(PAGE).success).toBe(true);
    expect(addOnNavGroupSchema.safeParse(GROUP).success).toBe(true);
    expect(recordTabSchema.safeParse(TAB).success).toBe(true);
  });

  it('a key that is no language tag, or an empty text, is refused', () => {
    expect(addOnPageSchema.safeParse({ ...PAGE, titles: { German: 'Zählen' } }).success).toBe(false);
    expect(addOnPageSchema.safeParse({ ...PAGE, titles: { 'de-DE': '' } }).success).toBe(false);
    expect(addOnNavGroupSchema.safeParse({ ...GROUP, labels: { de_DE: 'Bestand' } }).success).toBe(false);
    // The page schema stays strict: a misspelt field is still an error.
    expect(addOnPageSchema.safeParse({ ...PAGE, title_de: 'Zählen' }).success).toBe(false);
  });
});
