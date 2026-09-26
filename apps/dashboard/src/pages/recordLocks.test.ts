// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The record page's reading of a document's states, as the server judges
 * them (`crud/states.ts`): locked fields, a delete the server refuses, a child
 * its parent's state closes.
 */
import { describe, expect, it } from 'vitest';

import { childWritable, deleteRefused, linkKeptColumns, lockedFields, lockedIn, releasedColumns, type LinkLockFact, type TableStateFacts } from './recordLocks.js';

const invoices: TableStateFacts = {
  id: 'main.invoices',
  name: 'invoices',
  states: { column: 'status', initial: 'draft', lock: { when: ['sent', 'void'], except: ['due_on'] }, noDelete: { when: 'numbered' } },
  stateParents: [],
  linkLocks: [],
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

describe('a line a void invoice lets go of, and the time a line keeps', () => {
  const lines = {
    table: 'main.invoices',
    key: 'id',
    via: 'invoice_id',
    column: 'status',
    lockedIn: ['sent', 'void'],
    lock: true as const,
    release: { when: ['void'], columns: ['time_entry_id'] },
  };

  it('opens only the released columns of a line, and only in the released states', () => {
    expect(releasedColumns(lines, 'void')).toEqual(['time_entry_id']);
    expect(releasedColumns(lines, 'sent')).toBeNull();
    // Not closed at all: nothing to release.
    expect(releasedColumns(lines, 'draft')).toBeNull();
    const { release: _release, ...unreleased } = lines;
    expect(releasedColumns(unreleased, 'void')).toBeNull();
  });

  const hours: LinkLockFact = {
    table: 'main.invoice_lines',
    via: 'time_entry_id',
    key: 'id',
    columns: ['hours', 'worked_on'],
    parent: { table: 'main.invoices', key: 'id', via: 'invoice_id', column: 'status' },
    releasedIn: ['void'],
  };
  const read = (parents: unknown[], states: Record<string, string | null>) => ({
    parentKeys: async () => Promise.resolve(parents),
    parentState: async (_lock: LinkLockFact, key: unknown) => Promise.resolve(states[String(key)] ?? null),
  });

  it('keeps the linked columns while a line on an invoice that is not void points here', async () => {
    const facts = { linkLocks: [hours] };
    expect([...(await linkKeptColumns(facts, { id: 7 }, read([1], { 1: 'draft' })))]).toEqual(['hours', 'worked_on']);
    expect((await linkKeptColumns(facts, { id: 7 }, read([1], { 1: 'void' }))).size).toBe(0);
    expect((await linkKeptColumns(facts, { id: 7 }, read([], {}))).size).toBe(0);
    // A line with no invoice, or an invoice with no state, keeps them: the server judges so.
    expect((await linkKeptColumns(facts, { id: 7 }, read([null], {}))).size).toBe(2);
    expect((await linkKeptColumns(facts, { id: 7 }, read([1], {}))).size).toBe(2);
    expect((await linkKeptColumns(facts, { id: null }, read([1], { 1: 'draft' }))).size).toBe(0);
  });
});
