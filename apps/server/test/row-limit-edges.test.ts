// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Three edges of the row test that no table of the test firm reaches, found
 * by breaking `crud/row-limit.ts` on purpose and watching which breakage no
 * suite noticed: a read with nobody behind it, a table reached through a
 * parent that leads back to itself, and a chain of parents longer than the
 * two links a row is reached through.
 */
import { DummyDriver, Kysely, SqliteAdapter, SqliteIntrospector, SqliteQueryCompiler } from 'kysely';
import { describe, expect, it } from 'vitest';

import { rowLimitFor, type RowLimitContext } from '../src/crud/row-limit.js';

const db = new Kysely<Record<string, never>>({
  dialect: { createAdapter: () => new SqliteAdapter(), createDriver: () => new DummyDriver(), createIntrospector: (k) => new SqliteIntrospector(k), createQueryCompiler: () => new SqliteQueryCompiler() },
});
const text = (name: string, staff = false) => ({ name, logicalType: 'text', nullable: true, ...(staff ? { staff: true as const } : {}) });
const int = (name: string) => ({ name, logicalType: 'integer', nullable: true });
const table = (id: string, columns: unknown[], more: Record<string, unknown> = {}) => ({ id, name: id, schema: 'main', primaryKey: ['id'], columns: [int('id'), ...columns], ...more });
const link = (from: string, column: string, to: string) => ({ id: `fk:${from}(${column})->${to}(id)`, kind: 'declared-fk', through: null, from: { tableId: from, columns: [column] }, to: { tableId: to, columns: ['id'] } });

const OWN = { superAdmin: false, reach: { userId: 'usr_dana', ledIds: [] }, rowLimits: undefined as never };
function context(tables: unknown[], relations: unknown[], limited: string[], more: Partial<RowLimitContext> = {}): RowLimitContext {
  const rowLimits = { read: [{ limited: limited.map((id) => ({ grant: `table:c1:${id}:read`, reach: { reach: 'own' as const } })), unlimited: new Set<string>() }] };
  return { set: { ...OWN, rowLimits }, connectionId: 'c1', model: { tables, relations, dialect: 'sqlite' } as never, today: '2026-07-28', ...more };
}
const sqlOf = (ctx: RowLimitContext, id: string): string | null => {
  const test = rowLimitFor(ctx, id, 'read');
  return test === null ? null : db.selectFrom(id as never).select('id' as never).where(test(db as never, id)).compile().sql;
};

describe('the row test, at its edges', () => {
  it('a read with nobody behind it reaches no row of a table that says whose its rows are, and every row of one that does not', () => {
    const deals = table('deals', [text('owner_id', true)], { belongs: [{ column: 'owner_id' }] });
    const notes = table('notes', [text('rep_id', true)], { belongs: [{ column: 'rep_id' }], private: true });
    const plain = table('plain', [text('name')]);
    const ctx = context([deals, notes, plain], [], [], { set: { superAdmin: false }, nobody: true });
    // Reaches nothing: a test that is never true, not "no test".
    expect(sqlOf(ctx, 'deals')).toContain('1 = 0');
    expect(sqlOf(ctx, 'notes')).toContain('1 = 0');
    expect(sqlOf(ctx, 'plain')).toBeNull();
  });

  it('a table reached through a parent that is itself ends: the ring is followed once, and reaches nobody through it', () => {
    // A comment belongs to its writer, or to whoever reaches the comment it answers.
    const comments = table('comments', [text('author_id', true), int('parent_id')], { belongs: [{ column: 'author_id' }, { via: 'parent_id' }] });
    const built = sqlOf(context([comments], [link('comments', 'parent_id', 'comments')], ['comments']), 'comments')!;
    // One step up to the parent comment, and no further: its own writer, never the parent's parent.
    expect(built.match(/exists/g) ?? []).toHaveLength(1);
    expect(built.match(/"author_id"/g) ?? []).toHaveLength(2);
  });

  it('two tables that reach each other through a link end too', () => {
    const a = table('a', [int('b_id')], { belongs: [{ via: 'b_id' }] });
    const b = table('b', [int('a_id'), text('owner_id', true)], { belongs: [{ column: 'owner_id' }, { via: 'a_id' }] });
    const built = sqlOf(context([a, b], [link('a', 'b_id', 'b'), link('b', 'a_id', 'a')], ['a']), 'a')!;
    // a → b (its owner, and not back to a).
    expect(built.match(/exists/g) ?? []).toHaveLength(1);
  });

  it('a row is reached through two links and not a third', () => {
    const top = table('deals', [text('owner_id', true)], { belongs: [{ column: 'owner_id' }] });
    const second = table('jobs', [int('deal_id')], { belongs: [{ via: 'deal_id' }] });
    const third = table('visits', [int('job_id')], { belongs: [{ via: 'job_id' }] });
    const fourth = table('ticks', [int('visit_id')], { belongs: [{ via: 'visit_id' }] });
    const relations = [link('jobs', 'deal_id', 'deals'), link('visits', 'job_id', 'jobs'), link('ticks', 'visit_id', 'visits')];
    const ctx = context([top, second, third, fourth], relations, ['visits', 'ticks']);
    // visits → jobs → deals: the owner is found two links up.
    expect(sqlOf(ctx, 'visits')).toContain('"owner_id"');
    // ticks → visits → jobs, and no further: nobody is found, so nobody reaches a row.
    const ticks = sqlOf(ctx, 'ticks')!;
    expect(ticks).not.toContain('"owner_id"');
    expect(ticks).toContain('1 = 0');
  });
});
