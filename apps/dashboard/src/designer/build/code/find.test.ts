// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { findHits, findRanges, type FindSpec } from './find.js';

const spec = (query: string, over: Partial<FindSpec> = {}): FindSpec => ({ query, matchCase: false, wholeWord: false, ...over });
const places = (text: string, find: FindSpec): [number, number, number][] => findHits(text, find).hits.map((hit) => [hit.line, hit.col, hit.len]);

/** The same cases the server's `searchText` is held to (`designer-files.test.ts`): the two must name the same places. */
describe('looking for words in a text', () => {
  it('finds every place, line by line, whatever the line ends', () => {
    expect(places('const menu = Menu;\r\n// menu\rmenu()\n', spec('menu'))).toEqual([
      [1, 6, 4],
      [1, 13, 4],
      [2, 3, 4],
      [3, 0, 4],
    ]);
    expect(places('one\ntwo\n', spec(''))).toEqual([]);
  });

  it('holds capitals apart, and finds whole words only, when asked', () => {
    expect(places('Menu menu MENU', spec('menu', { matchCase: true }))).toEqual([[1, 5, 4]]);
    expect(places('menu menus submenu menu_ menu', spec('menu', { wholeWord: true }))).toEqual([
      [1, 0, 4],
      [1, 25, 4],
    ]);
    expect(places('été étés', spec('été', { wholeWord: true }))).toEqual([[1, 0, 3]]);
  });

  it('takes the words as they are', () => {
    const text = 'a.b a+b (a|b) [x] {y} a\\b ^$ a*b a-b';
    expect(places(text, spec('.'))).toEqual([[1, 1, 1]]);
    for (const words of ['a+b', '(a|b)', '[x]', '{y}', 'a\\b', '^$', 'a*b', 'a-b', '(', ']', '\\']) expect(places(text, spec(words)).length, words).toBeGreaterThan(0);
    expect(places('aaaa', spec('.*'))).toEqual([]);
  });

  it('shows a long line around the place, and stops at the most it names', () => {
    const [hit] = findHits(`${'x'.repeat(500)}needle${'y'.repeat(500)}`, spec('needle')).hits;
    expect(hit).toMatchObject({ line: 1, col: 500, len: 6, at: 40 });
    expect(hit?.text).toHaveLength(240);
    const many = findHits('a '.repeat(300), spec('a'));
    expect([many.hits.length, many.more]).toEqual([100, true]);
  });

  it('gives the editor the same places as offsets', () => {
    expect(findRanges('const menu = Menu;\n// menu\n', spec('menu')).ranges).toEqual([
      { from: 6, to: 10 },
      { from: 13, to: 17 },
      { from: 22, to: 26 },
    ]);
    expect(findRanges('a a a', spec('a'), 2)).toEqual({ ranges: [{ from: 0, to: 1 }, { from: 2, to: 3 }], more: true });
    expect(findRanges('a', spec('')).ranges).toEqual([]);
  });
});
