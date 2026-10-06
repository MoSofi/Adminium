// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHERE A TYPED VALUE IS LOOKED FOR.
 *
 * One value, several kinds of code: a card's (stored with its `GC-`), a
 * voucher's and a pack's (stored bare; `VC-` and `PK-` only say which is
 * meant), a discount word (no word at all). Every door that takes such a
 * value — an add-on's look-up, the price question — routes it with this one
 * function, so a code found at the desk is the code found at the till.
 */
import { describe, expect, it } from 'vitest';

import { canonicalCode, routeTypedCode, type CodeKind } from '../src/crud/code-lookup.js';

const CARD = { id: 'gift-card', prefix: 'GC-', spelling: { made: { prefix: 'GC-', length: 12 } } } as const;
const PACK = { id: 'pack', prefix: 'PK-', spelling: { made: { prefix: '', length: 12 } } } as const;
const VOUCHER = { id: 'voucher', prefix: 'VC-', spelling: { made: { prefix: '', length: 12 } } } as const;
const WORD = { id: 'code', spelling: { kept: true } } as const;
const KINDS: readonly (CodeKind & { id: string })[] = [CARD, PACK, VOUCHER, WORD];
const route = (typed: string, kinds = KINDS) => routeTypedCode(canonicalCode(typed), kinds).map((one) => [one.kind.id, one.needle]);

describe('where a typed value is looked for', () => {
  it.each([
    // A card stores its word: the whole value is compared, however it was typed.
    ['GC-7K2M-W3HN-Q4XP', [['gift-card', 'GC7K2MW3HNQ4XP']]],
    ['gc 7k2m w3hn q4xp', [['gift-card', 'GC7K2MW3HNQ4XP']]],
    ['GC7K2MW3HNQ4XP', [['gift-card', 'GC7K2MW3HNQ4XP']]],
    // A card moved in from elsewhere is shorter: any length is a card's while it starts so.
    ['GC-48219930', [['gift-card', 'GC48219930']]],
    // A voucher's and a pack's word only route: it is cut before the compare.
    ['VC-9QXA-41TR-7K2M', [['voucher', '9QXA41TR7K2M']]],
    ['vc 9qxa41tr7k2m', [['voucher', '9QXA41TR7K2M']]],
    ['PK-W3HN-Q4XP-9QXA', [['pack', 'W3HNQ4XP9QXA']]],
  ])('%s goes to the kind whose word it starts with, and to no other', (typed, tries) => {
    expect(route(typed)).toEqual(tries);
  });

  it('a value with no word is a discount word first, then a bare code of each kind that stores none — never a card', () => {
    // Twelve characters: what a voucher's QR holds.
    expect(route('9QXA-41TR-7K2M')).toEqual([['code', '9QXA41TR7K2M'], ['pack', '9QXA41TR7K2M'], ['voucher', '9QXA41TR7K2M']]);
    // Any other length is a word and nothing else.
    expect(route('SUMMER10')).toEqual([['code', 'SUMMER10']]);
    expect(route('48219930')).toEqual([['code', '48219930']]);
  });

  it('a scanned code that happens to start with a kind\'s letters is still tried whole, after the kind it looks like', () => {
    // Twelve characters, as a voucher's code is long: its first two are a routing word by chance.
    expect(route('VC9QXA41TR7K')).toEqual([['voucher', '9QXA41TR7K'], ['pack', 'VC9QXA41TR7K'], ['voucher', 'VC9QXA41TR7K']]);
    expect(route('GC9QXA41TR7K')).toEqual([['gift-card', 'GC9QXA41TR7K'], ['pack', 'GC9QXA41TR7K'], ['voucher', 'GC9QXA41TR7K']]);
    // A value typed with its word is longer than a bare code: nothing more is tried.
    expect(route('VC-9QXA-41TR-7K2M')).toHaveLength(1);
  });

  it('a column that stores a word is found only by a value that starts with one: never by a bare value, however its kind is declared', () => {
    // No routing word declared: the column's own stands for it.
    const plain = { id: 'card', spelling: { made: { prefix: 'GC-', length: 12 } } } as const;
    expect(route('7K2MW3HNQ4XP', [plain, WORD])).toEqual([['code', '7K2MW3HNQ4XP']]);
    expect(route('GC-7K2M-W3HN-Q4XP', [plain, WORD])).toEqual([['card', 'GC7K2MW3HNQ4XP']]);
    // Another word declared than the column stores: it routes and is cut; the compare puts the stored one back.
    const other = { id: 'pass', prefix: 'PS-', spelling: { made: { prefix: 'GC-', length: 12 } } } as const;
    expect(route('PS-7K2M-W3HN-Q4XP', [other])).toEqual([['pass', '7K2MW3HNQ4XP']]);
    expect(route('7K2MW3HNQ4XP', [other])).toEqual([]);
  });

  it('the kinds with no word are tried in the order declared, before any scanned code', () => {
    const second = { id: 'other-word', spelling: { kept: true } } as const;
    expect(route('9QXA41TR7K2M', [VOUCHER, second, WORD]).map(([id]) => id)).toEqual(['other-word', 'code', 'voucher']);
  });

  it('a word alone is no code of its kind, and a kind with no kinds is nowhere', () => {
    expect(route('VC-')).toEqual([['voucher', '']]);
    expect(route('SUMMER10', [])).toEqual([]);
    expect(route('SUMMER10', [CARD])).toEqual([]);
  });

  it('a column that keeps typed codes under a routing word is compared without the word', () => {
    const kept = { id: 'pass', prefix: 'PS-', spelling: { kept: true } } as const;
    expect(route('PS-ABC123', [kept])).toEqual([['pass', 'ABC123']]);
    // …and is never tried for a bare value: nothing says how long its codes are.
    expect(route('ABC123', [kept])).toEqual([]);
  });
});
