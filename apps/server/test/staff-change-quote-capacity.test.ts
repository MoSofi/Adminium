// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The desk's quote of a change to a stay, in a house whose rooms are sold by
 * the night, on every engine at a fixed time:
 *
 *  - the stay's own nights are left out of what it is judged against: a full
 *    house quotes the stay's own dates, where a quote of a new stay with the
 *    same dates is full;
 *  - it refuses what the save refuses (a night another stay filled);
 *  - it holds no named lock: it answers while another writer holds the
 *    house's night lock (Postgres, MySQL);
 *  - quotes racing saves for the last room change nothing: one save wins,
 *    every quote answers, none keeps a row — also on a pool of one.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { withNamedLocks } from '../src/crud/capacity/locks.js';
import { permissionsRepo, rolesRepo, usersRepo } from '@adminium/meta';

import { ADMIN_EMAIL, ADMIN_PASSWORD, adminPasswordHash, login } from './auth-helpers.js';
import { LEGS, type World } from './capacity.helpers.js';
import { house } from './capacity-worlds.js';

const NOW = new Date('2026-07-20T09:00:00.000Z');

describe.each(LEGS)('a change quote of a stay, in a house sold by the night — %s', (dialect, available) => {
  let w: World | undefined;
  let cookie = '';
  beforeAll(async () => {
    if (!available) return;
    w = await house(dialect);
    await w.staff(`${encodeURIComponent(w.id('stays'))}?limit=1`);
    cookie = (await login(w.app as never, ADMIN_EMAIL, ADMIN_PASSWORD)).cookie ?? '';
  }, 180_000);
  afterAll(async () => w?.close());
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const path = (rest: string) => `/api/v1/data/${w!.connectionId}/${encodeURIComponent(w!.id('stays'))}${rest}`;
  const quote = (id: unknown, values: Record<string, unknown>) => w!.app.inject({ method: 'POST', url: path(`/${String(id)}/dry-run`), headers: { cookie }, payload: { values } });
  const quoteNew = (values: Record<string, unknown>) => w!.app.inject({ method: 'POST', url: path('/dry-run'), headers: { cookie }, payload: { values } });
  const save = (id: unknown, values: Record<string, unknown>) => w!.app.inject({ method: 'PATCH', url: path(`/${String(id)}`), headers: { cookie }, payload: { values } });
  const codeOf = (res: { json: () => unknown }) => (res.json() as { error?: { code: string } }).error?.code;
  const stays = async () => w!.query(`select id, arrive, depart, room_type_id, status from stays order by id`);
  const fill = async (type: number, arrive: string, depart: string, n: number) => {
    const out: unknown[] = [];
    for (let i = 0; i < n; i += 1) out.push((await w!.create('stays', { arrive, depart, room_type_id: type }))['id']);
    return out;
  };

  it.runIf(available)("leaves the stay's own nights out, where a new stay on the same nights is full", async () => {
    // Four Lofts, all taken on the nights of 10 and 11 August.
    const [first] = await fill(1, '2026-08-10', '2026-08-12', 4);
    const own = await quote(first, { arrive: '2026-08-10', depart: '2026-08-12' });
    expect(own.statusCode, own.body).toBe(200);
    const fresh = await quoteNew({ arrive: '2026-08-10', depart: '2026-08-12', room_type_id: 1 });
    expect(fresh.statusCode, fresh.body).toBe(409);
    expect(codeOf(fresh)).toBe('CAPACITY_FULL');
    // A night later is free: the stay may take it.
    const longer = await quote(first, { depart: '2026-08-13' });
    expect(longer.statusCode, longer.body).toBe(200);
    expect(String((longer.json() as { data: Record<string, unknown> }).data['depart'])).toContain('2026-08-13');
  });

  it.runIf(available)('refuses what the save refuses, and keeps nothing either way', async () => {
    const [mine] = await fill(3, '2026-08-25', '2026-08-27', 1);
    // Harbour is three rooms; all three are taken on the night of the 27th.
    await fill(3, '2026-08-27', '2026-08-28', 3);
    const before = await stays();
    const quoted = await quote(mine, { depart: '2026-08-28' });
    const saved = await save(mine, { depart: '2026-08-28' });
    expect([quoted.statusCode, codeOf(quoted)]).toEqual([409, 'CAPACITY_FULL']);
    expect([saved.statusCode, codeOf(saved)]).toEqual([409, 'CAPACITY_FULL']);
    expect(await stays()).toEqual(before);
    const fine = await quote(mine, { arrive: '2026-08-24' });
    expect(fine.statusCode, fine.body).toBe(200);
    expect(await stays()).toEqual(before);
  });

  it.runIf(available && dialect !== 'sqlite')('holds no named lock: it answers while another writer holds the night lock', async () => {
    const [mine] = await fill(2, '2026-09-01', '2026-09-03', 1);
    const other = await w!.twin();
    const target = await other.target('stays');
    let answered: { statusCode: number; body: string } | undefined;
    // The house's night lock, held by another server for as long as the quote takes.
    await withNamedLocks(target, [{ name: `${w!.connectionId}|${w!.id('stays')}|cap|night`, busy: 'CAPACITY_BUSY' }], async () => {
      answered = await quote(mine, { depart: '2026-09-04' });
    });
    expect(answered?.statusCode, answered?.body).toBe(200);
  });

  it.runIf(available)('changes nothing when quotes race saves for the last room: one save wins', async () => {
    // Loft: three of four taken on the night of 5 October; four stays each want to add it.
    await fill(1, '2026-10-05', '2026-10-06', 3);
    const wanting = await fill(1, '2026-10-03', '2026-10-05', 4);
    const replies = await Promise.all(
      wanting.flatMap((id) => [save(id, { depart: '2026-10-06' }), quote(id, { depart: '2026-10-06' }), quote(id, { depart: '2026-10-06' })]),
    );
    const saves = replies.filter((_, i) => i % 3 === 0);
    const quotes = replies.filter((_, i) => i % 3 !== 0);
    expect(saves.filter((res) => res.statusCode === 200)).toHaveLength(1);
    for (const res of saves) expect([200, 409], res.body).toContain(res.statusCode);
    for (const res of quotes) {
      expect([200, 409], res.body).toContain(res.statusCode);
      // A quote waits for no lock: never busy, never a conflict it cannot say.
      if (res.statusCode === 409) expect(['CAPACITY_FULL', 'WRITE_CONFLICT']).toContain(codeOf(res));
    }
    const taken = await w!.query(`select count(*) as n from stays where room_type_id = 1 and arrive <= '2026-10-05' and depart > '2026-10-05'`);
    expect(Number(taken[0]!['n'])).toBe(4);
  });

  it.runIf(available)("refuses the house's night counts to a role that may not read a stay's dates, as a masked column", async () => {
    const role = await rolesRepo(w!.meta).create({ slug: 'counter', name: 'Counter' });
    const grant = (table: string, actions: Record<string, unknown>) =>
      permissionsRepo(w!.meta).grant(role.id, 'table', `${w!.connectionId}/${w!.id(table)}`, { read: true, create: false, update: false, delete: false, export: false, import: false, ...actions } as never);
    for (const table of ['room_types', 'rooms', 'room_closures']) await grant(table, {});
    await grant('stays', { readLimit: { readable: ['room_type_id', 'room_id', 'status'] } });
    const user = await usersRepo(w!.meta).create({ email: 'counter@venue.example.com', name: 'Counter', passwordHash: await adminPasswordHash(), status: 'active' });
    await rolesRepo(w!.meta).assignToUser(user.id, role.id);
    const counter = (await login(w!.app as never, 'counter@venue.example.com', ADMIN_PASSWORD)).cookie ?? '';
    const counts = (who: string) => w!.app.inject({ method: 'GET', url: path('/capacity-counts?rule=0&from=2026-08-10&days=2'), headers: { cookie: who } });
    const refused = await counts(counter);
    expect(refused.statusCode, refused.body).toBe(403);
    expect(refused.json().error).toMatchObject({ code: 'COLUMN_FORBIDDEN', details: { reason: 'read-limit' } });
    expect((await counts(cookie)).statusCode).toBe(200);
    // A role that reads the dates too is answered.
    await grant('stays', { readLimit: { readable: ['room_type_id', 'room_id', 'status', 'arrive', 'depart'] } });
    expect((await counts(counter)).statusCode).toBe(200);
  });

  it.runIf(available)('answers a quote of a stay that is not there as the save does', async () => {
    const gone = await quote(987654, { depart: '2026-09-04' });
    expect(gone.statusCode, gone.body).toBe(404);
    expect((await save(987654, { depart: '2026-09-04' })).statusCode).toBe(404);
  });
});
