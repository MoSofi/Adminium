// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE OPT-OUT MARK, AS DECIDE WRITES IT (`crud/decide.ts`): a strict stamp
 * whose own trigger never fires. Only a signed-in staff member's own save
 * that says the line was shown sets it, on a create or a change of the
 * address, with an address in the row; or a create carrying the mark of the
 * row the person is made from. Every other writer — a rule, a guest, an API
 * key, a file brought in, an undo — never does, whatever its context says.
 * Pure: no database is read (the whole-server tests run it on three engines).
 */
import { describe, expect, it } from 'vitest';

import type { ColumnStamp, TableRules } from '../src/crud/column-rules.js';
import { decideRow, type DecideContext } from '../src/crud/decide.js';
import type { WriteContext } from '../src/crud/write-service.js';

const NOW = new Date('2026-10-26T09:30:00Z');
const MARK: ColumnStamp = { column: 'offered_at', set: 'now', on: { columns: ['email'] }, strict: true, logicalType: 'timestamptz' };
const rules = { fills: [], checks: [], stamps: [MARK] } as unknown as TableRules;
const staff = { kind: 'user' as const, id: 'usr_rita', label: 'Rita' };

function context(origin: WriteContext['origin'], optOut: DecideContext['optOut'] | null, actor: DecideContext['actor'] = staff, more: Partial<DecideContext> = {}): DecideContext {
  return {
    db: null as never,
    dialect: 'postgres',
    table: { id: 'public.contacts', primaryKey: ['id'], columns: new Map() } as never,
    origin,
    actor,
    now: NOW,
    zone: 'UTC',
    ...(optOut === null ? {} : { optOut }),
    ...more,
  };
}

const shown = { column: 'offered_at', email: 'email', shown: true, carried: null };
const mark = async (action: 'create' | 'update', values: Record<string, unknown>, ctx: DecideContext, before: Record<string, unknown> | null = null) =>
  (await decideRow(rules, action, values, before, ctx))['offered_at'];

describe('the opt-out mark', () => {
  it('is set by a staff save that showed the line, on a create with an address', async () => {
    expect(await mark('create', { email: 'a@b.example' }, context('dashboard', shown))).toBe(NOW.toISOString());
    // No address in the row: no line about mailing it.
    expect(await mark('create', { name: 'No address' }, context('dashboard', shown))).toBeUndefined();
  });

  it('is set again only when the address changes, from a screen that showed the line', async () => {
    const before = { id: 1, email: 'a@b.example', offered_at: '2025-01-01T00:00:00Z' };
    expect(await mark('update', { email: 'a@b.example', name: 'x' }, context('dashboard', shown), before)).toBeUndefined();
    expect(await mark('update', { email: ' A@B.example ' }, context('dashboard', shown), before)).toBeUndefined();
    expect(await mark('update', { email: 'new@b.example' }, context('dashboard', shown), before)).toBe(NOW.toISOString());
    expect(await mark('update', { email: 'new@b.example' }, context('dashboard', { ...shown, shown: false }), before)).toBeUndefined();
  });

  it('is never fired by its own trigger, whoever writes', async () => {
    for (const origin of ['dashboard', 'bulk', 'automation', 'hook', 'action', 'public'] as const) {
      expect(await mark('create', { email: 'a@b.example' }, context(origin, { ...shown, shown: false })), origin).toBeUndefined();
    }
    // A brought file's line is stamped where it leaves a stamp out, but never this one.
    expect(await mark('create', { email: 'a@b.example' }, context('import', shown, staff, { stamps: 'left-out' }))).toBeUndefined();
  });

  it('is set by no other writer, even with a context that says the line was shown', async () => {
    for (const origin of ['bulk', 'automation', 'hook', 'action', 'public', 'import', 'undo'] as const) {
      expect(await mark('create', { email: 'a@b.example' }, context(origin, shown)), origin).toBeUndefined();
    }
    expect(await mark('create', { email: 'a@b.example' }, context('dashboard', shown, { kind: 'api-key', id: 'key_1', label: 'tablet' }))).toBeUndefined();
  });

  it('is carried on a create from the row the person is made from, and only on a create', async () => {
    const carried = { ...shown, shown: false, carried: '2026-01-02T03:04:05.000Z' };
    expect(await mark('create', { email: 'a@b.example' }, context('dashboard', carried))).toBe('2026-01-02T03:04:05.000Z');
    expect(await mark('update', { email: 'new@b.example' }, context('dashboard', carried), { id: 1, email: 'a@b.example' })).toBeUndefined();
  });

  it('drops what a writer sends for it, as for any strict stamp', async () => {
    expect(await mark('create', { email: 'a@b.example', offered_at: '2020-01-01T00:00:00Z' }, context('dashboard', { ...shown, shown: false }))).toBeUndefined();
  });

  it('a table with no declared mark stamps it by its trigger, as before', async () => {
    expect(await mark('create', { email: 'a@b.example' }, context('dashboard', null))).toBe(NOW.toISOString());
  });
});
