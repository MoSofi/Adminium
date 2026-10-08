// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { listedColumnsOf, listedReductions } from '../src/crud/adjust/listed.js';

const COLUMNS = { offer: 'offer_id', code: 'code_id', voucher: 'voucher_id', name: 'name', kind: 'kind', amount: 'amount' };
const WELCOME = { 'en-US': '10 % off your first order', 'de-DE': '10 % auf Ihre erste Bestellung' };

describe('what an order took off, as a list prints it', () => {
  it('reads the columns of a declaration only when every one a list needs is named', () => {
    expect(listedColumnsOf({ table: 'applied', columns: { ...COLUMNS, reason: 'reason_id' } })).toEqual(COLUMNS);
    expect(listedColumnsOf({ table: 'applied', columns: { name: 'name' } })).toBeNull();
    expect(listedColumnsOf(undefined)).toBeNull();
  });

  it('tells a code that took a little off three lines as one row, its amounts added, beside the offer', () => {
    const rows = [
      { id: 1, offer_id: 7, code_id: null, voucher_id: null, name: { 'en-US': 'Pizza pair' }, kind: 'offer', amount: '16.00', source_line: 'order_items:1' },
      { id: 2, offer_id: 3, code_id: 9, voucher_id: null, name: WELCOME, kind: 'code', amount: '1.60', source_line: 'order_items:1' },
      { id: 3, offer_id: 3, code_id: 9, voucher_id: null, name: WELCOME, kind: 'code', amount: '1.65', source_line: 'order_items:2' },
      { id: 4, offer_id: 3, code_id: 9, voucher_id: null, name: WELCOME, kind: 'code', amount: '1.6', source_line: 'order_items:3' },
    ];
    expect(listedReductions(rows, COLUMNS, 'en-US').map((row) => [row['id'], row['name'], row['amount']])).toEqual([
      [1, 'Pizza pair', '16.00'],
      [2, '10 % off your first order', '4.85'],
    ]);
  });

  it('names each in the reader’s language, else English, and reads a name an engine kept as text', () => {
    const rows = [
      { id: 1, offer_id: 3, code_id: 9, voucher_id: null, name: JSON.stringify(WELCOME), kind: 'code', amount: 2 },
      { id: 2, offer_id: null, code_id: null, voucher_id: 4, name: 'A coffee', kind: 'voucher', amount: '3.5' },
    ];
    expect(listedReductions(rows, COLUMNS, 'de_DE').map((row) => row['name'])).toEqual(['10 % auf Ihre erste Bestellung', 'A coffee']);
    expect(listedReductions(rows, COLUMNS, 'fr-FR').map((row) => row['name'])).toEqual(['10 % off your first order', 'A coffee']);
    expect(listedReductions([], COLUMNS, 'en-US')).toEqual([]);
  });
});
