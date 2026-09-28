// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A limit's counts are made of the rule's own columns (a stay's dates, its
 * state, a pool's size). A role that may not read one of them is refused the
 * counts on every door that answers them — the desk's counts route, a
 * capacity-counts card (a list or a KPI), and a list card's `counts` — the
 * same 403 a masked column gets, never the figures. A role that reads them
 * all is answered as before.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { permissionsRepo, rolesRepo, usersRepo } from '@adminium/meta';

import { ADMIN_EMAIL, ADMIN_PASSWORD, adminPasswordHash, login } from './auth-helpers.js';
import { LEGS, type World } from './capacity.helpers.js';
import { house } from './capacity-worlds.js';

const NOW = new Date('2026-07-20T09:00:00.000Z');

describe.each(LEGS)('the counts under a read limit — %s', (dialect, available) => {
  let w: World | undefined;
  let admin = '';
  let counter = '';
  let reader = '';
  beforeAll(async () => {
    if (!available) return;
    w = await house(dialect);
    await w.staff(`${encodeURIComponent(w.id('stays'))}?limit=1`);
    admin = (await login(w.app as never, ADMIN_EMAIL, ADMIN_PASSWORD)).cookie ?? '';
    const person = async (slug: string, stays: Record<string, unknown>) => {
      const role = await rolesRepo(w!.meta).create({ slug, name: slug });
      const grant = (table: string, actions: Record<string, unknown>) =>
        permissionsRepo(w!.meta).grant(role.id, 'table', `${w!.connectionId}/${w!.id(table)}`, { read: true, create: false, update: false, delete: false, export: false, import: false, ...actions } as never);
      for (const table of ['room_types', 'rooms', 'room_closures', 'settings']) await grant(table, {});
      await grant('stays', stays);
      const user = await usersRepo(w!.meta).create({ email: `${slug}@venue.example.com`, name: slug, passwordHash: await adminPasswordHash(), status: 'active' });
      await rolesRepo(w!.meta).assignToUser(user.id, role.id);
      return (await login(w!.app as never, `${slug}@venue.example.com`, ADMIN_PASSWORD)).cookie ?? '';
    };
    // The stays' dates hidden: only the links and the state.
    counter = await person('counter', { readLimit: { readable: ['room_type_id', 'room_id', 'status'] } });
    // Every column the rule names readable (a note left out): the counts are theirs.
    reader = await person('reader', { readLimit: { readable: ['room_type_id', 'room_id', 'status', 'arrive', 'depart'] } });
    for (let i = 0; i < 3; i += 1) await w.create('stays', { arrive: '2026-08-10', depart: '2026-08-12', room_type_id: 1 });
  }, 180_000);
  afterAll(async () => w?.close());
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  const source = (table: string) => {
    const id = w!.id(table);
    return { name: id.includes('.') ? id.split('.')[1]! : id, ...(id.includes('.') ? { schema: id.split('.')[0] } : {}) };
  };
  const card = (cookie: string, table: string, rest: Record<string, unknown>, params?: Record<string, unknown>) =>
    w!.app.inject({
      method: 'POST',
      url: '/api/v1/widget-data/query',
      headers: { cookie },
      payload: { descriptor: { connectionId: w!.connectionId, source: source(table), ...rest }, ...(params === undefined ? {} : { params }) } as never,
    });
  const refusedByDates = (res: { statusCode: number; body: string; json: () => unknown }) => {
    expect(res.statusCode, res.body).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'COLUMN_FORBIDDEN', details: { reason: 'read-limit' } } });
    // Nothing counted leaks: no pool's taken figure, no occupancy.
    expect(res.body).not.toContain('taken');
    expect(res.body).not.toContain('Loft');
  };
  const list = { kind: 'capacity-counts', shape: 'record-list', capacity: {} };
  const kpi = { kind: 'capacity-counts', shape: 'single-metric', capacity: { metric: 'occupancy' } };
  const taken = { kind: 'capacity-counts', shape: 'single-metric', capacity: { metric: 'taken' } };
  const withCounts = { shape: 'record-list', select: ['id', 'name'], orderBy: [{ column: 'id', dir: 'asc' }], counts: { table: 'stays' } };

  it.runIf(available)('the desk counts route refuses them', async () => {
    const url = `/api/v1/data/${w!.connectionId}/${encodeURIComponent(w!.id('stays'))}/capacity-counts?rule=0&from=2026-08-10&days=2`;
    refusedByDates(await w!.app.inject({ method: 'GET', url, headers: { cookie: counter } }));
    const read = await w!.app.inject({ method: 'GET', url, headers: { cookie: reader } });
    expect(read.statusCode, read.body).toBe(200);
  });

  it.runIf(available)('a capacity-counts card refuses them, as a list and as a KPI', async () => {
    refusedByDates(await card(counter, 'stays', list, { day: '2026-08-10' }));
    refusedByDates(await card(counter, 'stays', kpi, { day: '2026-08-10' }));
    refusedByDates(await card(counter, 'stays', taken, { day: '2026-08-11' }));
    // Answered as before to those who read the rule's columns (the cache holds per read limit, never across).
    for (const cookie of [admin, reader]) {
      const res = await card(cookie, 'stays', list, { day: '2026-08-10' });
      expect(res.statusCode, res.body).toBe(200);
      const rows = (res.json() as { result: { rows: Record<string, unknown>[] } }).result.rows;
      expect(rows.find((row) => row['pool'] === '1')).toMatchObject({ date: '2026-08-10', size: 4, taken: 3, left: 1 });
      const occupancy = await card(cookie, 'stays', kpi, { day: '2026-08-10' });
      expect(occupancy.statusCode, occupancy.body).toBe(200);
    }
    // And refused again after them: no answer cached for another role reaches this one.
    refusedByDates(await card(counter, 'stays', list, { day: '2026-08-10' }));
  });

  it.runIf(available)("a list card's counts refuse them", async () => {
    refusedByDates(await card(counter, 'room_types', withCounts, { day: '2026-08-10' }));
    for (const cookie of [admin, reader]) {
      const res = await card(cookie, 'room_types', withCounts, { day: '2026-08-10' });
      expect(res.statusCode, res.body).toBe(200);
      const rows = (res.json() as { result: { rows: Record<string, unknown>[] } }).result.rows;
      expect(rows.find((row) => row['name'] === 'Loft')!['counts']).toEqual({ taken: 3, held: 0, size: 4, left: 1 });
    }
    // The list itself, without counts, is still the counter's to read.
    const plain = await card(counter, 'room_types', { shape: 'record-list', select: ['id', 'name'], orderBy: [{ column: 'id', dir: 'asc' }] });
    expect(plain.statusCode, plain.body).toBe(200);
  });
});
