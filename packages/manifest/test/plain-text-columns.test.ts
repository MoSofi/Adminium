// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A plain-text column named with what else it may hold: `{ "column": "note",
 * "digits": 4, "max": 140 }` beside a bare name. On a create's `anonymous`,
 * a change's `limits` and a child row; checked against the app's columns as a
 * bare name is; bounded (four digits, 200 characters); and a warning where a
 * column holds more characters than its plain text takes.
 */
import { describe, expect, it } from 'vitest';

import { PLAIN_TEXT_DIGITS_MOST, PLAIN_TEXT_LONGEST, validateManifest } from '../src/index.js';
import { columnOf, entryOf, issuesText, kitchen, messages, type Doc } from './orders-stays-fixture.js';

const create = (m: Doc) => entryOf(m, 'orders', 'POST');
const lines = (m: Doc) => (create(m)['children'] as Record<string, Doc>)['order_items']!;
const linkChange = (m: Doc) => entryOf(m, 'orders', 'PATCH', 'link');

/** The kitchen, its order's note taking four digits and 140 characters, a line's note two digits. */
function notes(): Doc {
  const m = kitchen();
  columnOf(m, 'orders', 'name')['maxLength'] = 80;
  columnOf(m, 'orders', 'note')['maxLength'] = 140;
  create(m)['anonymous'] = { perValue: { columns: ['email'], n: 10 }, perKeyHour: 300, plainText: ['name', { column: 'note', digits: 4, max: 140 }] };
  lines(m)['plainText'] = [{ column: 'note', digits: 2, max: 200 }];
  linkChange(m)['limits'] = { plainText: [{ column: 'note', digits: 4, max: 140 }] };
  return m;
}

const warningsOf = (m: Doc) => {
  const result = validateManifest(m);
  return result.warnings.filter((w) => w.path.includes('plainText')).map((w) => `${w.path}: ${w.message}`);
};

describe('a plain-text column with its digits and length', () => {
  it('validates on a create, a change and a child row, and keeps its shape', () => {
    const m = notes();
    expect(messages(m)).toEqual([]);
    const result = validateManifest(m);
    if (!result.ok || result.manifest.kind !== 'app') throw new Error('expected an app');
    const entry = result.manifest.publicAccess!.find((e) => e.methods.includes('POST') && e.table === 'orders')!;
    expect(entry.anonymous?.plainText).toEqual(['name', { column: 'note', digits: 4, max: 140 }]);
    expect(entry.children?.['order_items']?.plainText).toEqual([{ column: 'note', digits: 2, max: 200 }]);
  });

  it(`takes at most ${String(PLAIN_TEXT_DIGITS_MOST)} digits and ${String(PLAIN_TEXT_LONGEST)} characters, and nothing else`, () => {
    const at = (entry: unknown) => {
      const m = notes();
      create(m)['anonymous'] = { perValue: { columns: ['email'], n: 10 }, plainText: [entry] };
      return issuesText(m);
    };
    expect(at({ column: 'note', digits: PLAIN_TEXT_DIGITS_MOST + 1 })).toContain('publicAccess.');
    expect(at({ column: 'note', max: PLAIN_TEXT_LONGEST + 1 })).toContain('publicAccess.');
    expect(at({ column: 'note', digits: 0 })).toContain('publicAccess.');
    expect(at({ column: 'note', links: true })).toContain('publicAccess.');
    expect(at({ column: 'note', digits: PLAIN_TEXT_DIGITS_MOST, max: PLAIN_TEXT_LONGEST })).toBe('');
  });

  it('names a text column of the table, as a bare name does', () => {
    const m1 = notes();
    create(m1)['anonymous'] = { perValue: { columns: ['email'], n: 10 }, plainText: [{ column: 'nope', digits: 2 }] };
    expect(issuesText(m1)).toContain('"orders" has no column "nope"');
    const m2 = notes();
    lines(m2)['plainText'] = [{ column: 'qty', digits: 2 }];
    expect(issuesText(m2)).toContain('"order_items.qty" is not a text column');
    const m3 = notes();
    linkChange(m3)['limits'] = { plainText: [{ column: 'name', digits: 2 }] };
    expect(issuesText(m3)).toContain('"name" is not writable, so a guest never sends it');
  });

  it('warns where a column holds more characters than its plain text takes', () => {
    expect(warningsOf(notes())).toEqual([]);
    const m = notes();
    columnOf(m, 'orders', 'note')['maxLength'] = 500;
    create(m)['anonymous'] = { perValue: { columns: ['email'], n: 10 }, plainText: ['note'] };
    const warned = warningsOf(m);
    expect(warned).toHaveLength(2);
    const onCreate = warned.find((w) => w.includes('.anonymous.plainText.0'));
    expect(onCreate).toContain('"orders.note" holds 500 characters but its plain text takes 80');
    expect(onCreate).toContain('{ "column": "note", "max": 200 } and a maxLength of 200');
    expect(warned.find((w) => w.includes('.limits.plainText.0'))).toContain('"orders.note" holds 500 characters but its plain text takes 140');
    // A warning is advice: the manifest still validates.
    expect(messages(m)).toEqual([]);
  });
});
