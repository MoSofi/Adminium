// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The removed rows a table keeps (wave 0063), on every available dialect: one
 * row per removal and per link that named a row, found under the parent a
 * link named, newest first and paged; taken off by an undo under every
 * parent; swept with the audit log. And the two rule payloads the store
 * keeps beside them (`table.removal`, `column.history`).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ALL_MIGRATIONS, applyMigrations, overridePatchSchema, removedRowsRepo, type RemovedRowInput } from '../src/index.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

const DAY = 86_400_000;

const visit = (id: number, at: number, over: Partial<RemovedRowInput> = {}): RemovedRowInput => ({
  connectionId: 'cnx_1',
  entityTable: 'public.site_visits',
  entityId: String(id),
  pk: { id },
  links: [
    { via: 'deal_id', parentTable: 'public.deals', parentValue: '7' },
    { via: 'job_id', parentTable: 'public.jobs', parentValue: '40' },
  ],
  removedAt: at,
  actorKind: 'user',
  actorId: 'usr_1',
  actorLabel: 'Dana',
  reason: 'Customer cancelled',
  image: { id, deal_id: 7, job_id: 40, note: null, _masked: ['note'] },
  ...over,
});

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`removed rows [${dialect.name}]`, () => {
    let t: TestDb;
    beforeEach(async () => {
      t = await dialect.make();
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });
    });
    afterEach(async () => {
      await t.destroy();
    });
    const under = (parentTable: string, via: string, parentValue: string, more: { limit?: number; before?: { removedAt: number; id: string } } = {}) =>
      removedRowsRepo(t.meta).listUnder({ connectionId: 'cnx_1', entityTable: 'public.site_visits', parentTable, links: [{ via, parentValue }], limit: more.limit ?? 50, before: more.before });

    it('keeps a removal under each row it linked to, as it was told', async () => {
      const repo = removedRowsRepo(t.meta);
      expect(await repo.add(visit(1, 1000))).toBe(2);
      const [byDeal] = await under('public.deals', 'deal_id', '7');
      expect(byDeal).toMatchObject({ entityTable: 'public.site_visits', entityId: '1', pk: { id: 1 }, via: 'deal_id', parentTable: 'public.deals', parentValue: '7', removedAt: 1000, actorKind: 'user', actorId: 'usr_1', actorLabel: 'Dana', reason: 'Customer cancelled', image: { id: 1, deal_id: 7, job_id: 40, note: null, _masked: ['note'] } });
      expect(byDeal!.id.startsWith('rmv_')).toBe(true);
      expect((await under('public.jobs', 'job_id', '40')).map((row) => row.entityId)).toEqual(['1']);
      // Another deal, another link column of the same value, another table: nothing.
      expect(await under('public.deals', 'deal_id', '8')).toEqual([]);
      expect(await under('public.deals', 'job_id', '7')).toEqual([]);
      expect(await removedRowsRepo(t.meta).listUnder({ connectionId: 'cnx_1', entityTable: 'public.contacts', parentTable: 'public.deals', links: [{ via: 'deal_id', parentValue: '7' }], limit: 50 })).toEqual([]);
      // No reason, and no link: the first kept as nothing, the second not kept at all.
      await repo.add(visit(2, 2000, { reason: null }));
      expect((await under('public.deals', 'deal_id', '7'))[0]).toMatchObject({ entityId: '2', reason: null });
      expect(await repo.add(visit(3, 3000, { links: [] }))).toBe(0);
    });

    it('lists newest first, and pages after the last row given', async () => {
      const repo = removedRowsRepo(t.meta);
      for (const [id, at] of [[1, 1000], [2, 3000], [3, 2000], [4, 3000]] as const) await repo.add(visit(id, at));
      const all = await under('public.deals', 'deal_id', '7');
      expect(all.map((row) => row.removedAt)).toEqual([3000, 3000, 2000, 1000]);
      const first = await under('public.deals', 'deal_id', '7', { limit: 2 });
      const last = first.at(-1)!;
      const second = await under('public.deals', 'deal_id', '7', { limit: 2, before: { removedAt: last.removedAt, id: last.id } });
      expect([...first, ...second].map((row) => row.entityId)).toEqual(all.map((row) => row.entityId));
    });

    it('finds one removed row under a parent, and forgets it under every parent when it comes back', async () => {
      const repo = removedRowsRepo(t.meta);
      await repo.add(visit(1, 1000));
      await repo.add(visit(2, 2000));
      const find = (entityId: string, parentTable: string, via: string, parentValue: string) => repo.findUnder({ connectionId: 'cnx_1', entityTable: 'public.site_visits', entityId, parentTable, links: [{ via, parentValue }] });
      expect(await find('1', 'public.jobs', 'job_id', '40')).toMatchObject({ entityId: '1', via: 'job_id' });
      expect(await find('1', 'public.deals', 'deal_id', '8')).toBeNull();
      expect(await repo.forget('cnx_1', 'public.site_visits', ['1'])).toBe(2);
      expect(await find('1', 'public.deals', 'deal_id', '7')).toBeNull();
      expect(await find('1', 'public.jobs', 'job_id', '40')).toBeNull();
      expect((await under('public.deals', 'deal_id', '7')).map((row) => row.entityId)).toEqual(['2']);
      expect(await repo.forget('cnx_1', 'public.site_visits', [])).toBe(0);
    });

    it('sweeps removals older than the audit log keeps', async () => {
      const repo = removedRowsRepo(t.meta);
      const now = 400 * DAY;
      await repo.add(visit(1, now - 100 * DAY));
      await repo.add(visit(2, now - 10 * DAY));
      expect(await repo.gc(now, 90)).toBe(2);
      expect((await under('public.deals', 'deal_id', '7')).map((row) => row.entityId)).toEqual(['2']);
    });
  });
}

describe('the rule payloads', () => {
  it('keeps a removal rule and a column history rule as written, and nothing else', () => {
    const ok = (op: string, value: unknown) => overridePatchSchema.safeParse({ op, value }).success;
    expect(ok('table.removal', { reason: true })).toBe(true);
    expect(ok('table.removal', { reason: 'required', history: true })).toBe(true);
    expect(ok('table.removal', { history: true })).toBe(true);
    expect(ok('table.removal', {})).toBe(false);
    expect(ok('table.removal', { reason: 'maybe' })).toBe(false);
    expect(ok('table.removal', { history: true, keep: 30 })).toBe(false);
    expect(ok('column.history', { history: 'audit' })).toBe(true);
    expect(ok('column.history', { history: true })).toBe(false);
    expect(ok('column.history', {})).toBe(false);
  });
});
