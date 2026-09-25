// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The record page's reading of a document's states, as the server judges
 * them (`crud/states.ts`): locked fields, a delete the server refuses, a child
 * its parent's state closes.
 */
import { describe, expect, it } from 'vitest';

import { childWritable, deleteRefused, lockedFields, lockedIn, type TableStateFacts } from './recordLocks.js';

const invoices: TableStateFacts = {
  id: 'main.invoices',
  name: 'invoices',
  states: { column: 'status', initial: 'draft', lock: { when: ['sent', 'void'], except: ['due_on'] }, noDelete: { when: 'numbered' } },
  stateParents: [],
  gapless: ['number_seq'],
};

describe('a document’s states, read by the record page', () => {
  it('locks every field of a sent row but the state and the exceptions; a row with no state is its first', () => {
    const locked = lockedFields(invoices, { status: 'sent' })!;
    expect([locked('total'), locked('status'), locked('due_on')]).toEqual([true, false, false]);
    expect(lockedFields(invoices, { status: 'draft' })).toBeNull();
    expect(lockedIn(invoices, { status: null })).toBeNull();
    expect(lockedIn(invoices, { status: 'void' })).toBe('void');
  });

  it('refuses to delete a numbered row, a locked one, or one in a no-delete state', () => {
    expect(deleteRefused(invoices, { status: 'draft', number_seq: 12 })).toBe(true);
    expect(deleteRefused(invoices, { status: 'draft', number_seq: null })).toBe(false);
    expect(deleteRefused(invoices, { status: 'sent', number_seq: null })).toBe(true);
    const quotes: TableStateFacts = { ...invoices, states: { column: 'status', initial: 'draft', noDelete: { when: ['accepted'] } }, gapless: [] };
    expect(deleteRefused(quotes, { status: 'accepted' })).toBe(true);
    expect(deleteRefused(quotes, { status: 'draft' })).toBe(false);
  });

  it('closes a child under a locked parent that locks its children, and outside the states it is tied to', () => {
    const lines = { table: 'main.invoices', key: 'id', via: 'invoice_id', column: 'status', lockedIn: ['sent', 'void'], lock: true as const };
    expect(childWritable(lines, 'sent')).toBe(false);
    expect(childWritable(lines, 'draft')).toBe(true);
    const payments = { table: 'main.invoices', key: 'id', via: 'invoice_id', column: 'status', lockedIn: ['sent', 'void'], parentIn: ['sent'] };
    expect(childWritable(payments, 'sent')).toBe(true);
    expect(childWritable(payments, 'draft')).toBe(false);
    expect(childWritable(payments, null)).toBe(false);
  });
});
