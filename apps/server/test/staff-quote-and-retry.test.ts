// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The desk's own quote of a change, its price check and its retry key, over a
 * small hotel priced by the night, on every engine:
 *
 *  - a change tried first (`POST …/:id/dry-run`) answers the stay as the change
 *    leaves it — new nights, each with its rate and its rate before what was
 *    added, the extras that follow, the total — and keeps nothing;
 *  - a create or a change that sends the price the desk showed (`expect`) is
 *    saved at that price, or refused 409 `PRICE_CHANGED` with the figure it
 *    would have saved, nothing kept;
 *  - a create sent again under the same retry key (`clientKey`) answers the
 *    stay the first made (`replayed`), one row; two sent at once make one;
 *    another person's same key is another booking.
 */
import { permissionsRepo, rolesRepo, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPasswordHash, ADMIN_PASSWORD, login } from './auth-helpers.js';
import { installInvoicing, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';
import { seedWren, wrenManifest, wrenTables } from './wren-house-fixture.js';

const money = (value: unknown) => (value === null || value === undefined ? null : Number(value).toFixed(2));

/** The hotel with a guest's booking entry that checks the total and keeps a retry key. */
function pricedWren(): Record<string, unknown> {
  const tables = wrenTables();
  const stays = tables.find((table) => table['ref'] === 'stays')!;
  (stays['columns'] as Record<string, unknown>[]).push({ ref: 'client_key', type: 'text', maxLength: 64, nullable: true, unique: true });
  const manifest = wrenManifest(tables);
  manifest['frontends'] = [
    { side: 'staff', kind: 'spa', entry: 'index.html' },
    { side: 'customer', kind: 'spa', entry: 'index.html' },
  ];
  manifest['publicAccess'] = [
    { table: 'room_types', methods: ['GET'], select: ['id', 'name', 'base_rate'] },
    {
      table: 'stays',
      methods: ['POST'],
      select: ['nights', 'room_total', 'total'],
      writable: ['first_name', 'last_name', 'room_type_id', 'arrive', 'depart', 'guests', 'client_key'],
      requires: ['first_name'],
      dryRun: true,
      expect: 'total',
      clientKey: 'client_key',
    },
  ];
  return manifest;
}

describe.each(LEGS)("the desk's change quote, price check and retry key — %s", (dialect, available) => {
  let h: (InvoicingHarness & { reply: Record<string, unknown> }) | undefined;
  let w: Awaited<ReturnType<typeof writerFor>>;
  let seed: Awaited<ReturnType<typeof seedWren>>;
  let served: Served;
  let desk = '';
  let other = '';
  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, pricedWren());
    w = await writerFor(h, 'Europe/London');
    seed = await seedWren((ref, values) => w.create(ref, values));
    served = await servePublic(h, null);
    const superAdmin = (await rolesRepo(h.meta).findBySlug('super-admin'))!.id;
    for (const email of ['desk@wren.example', 'night@wren.example']) {
      const user = await usersRepo(h.meta).create({ email, name: email, passwordHash: await adminPasswordHash(), status: 'active' });
      await rolesRepo(h.meta).assignToUser(user.id, superAdmin);
    }
    desk = (await login(served.composed.app as never, 'desk@wren.example', ADMIN_PASSWORD)).cookie ?? '';
    other = (await login(served.composed.app as never, 'night@wren.example', ADMIN_PASSWORD)).cookie ?? '';
  }, 180_000);
  afterAll(async () => {
    await served?.close();
    await h?.close();
  });

  const url = (ref: string, rest = '') => `/api/v1/data/${h!.connectionId}/${encodeURIComponent(w.targetOf(ref).table.id)}${rest}`;
  const send = (method: 'POST' | 'PATCH', path: string, payload: unknown, cookie = desk) =>
    served.composed.app.inject({ method, url: path, headers: { cookie }, payload: payload as never });
  const stayRow = async (id: unknown) => (await h!.rows(`SELECT * FROM ${h!.real('stays')} WHERE id = ${String(id)}`))[0]!;
  const count = async (ref: string, where = '1 = 1') => Number((await h!.rows(`SELECT COUNT(*) AS n FROM ${h!.real(ref)} WHERE ${where}`))[0]!['n']);
  const codeOf = (res: { json: () => unknown }) => (res.json() as { error?: { code: string; details?: Record<string, unknown> } }).error;

  it.runIf(available)('answers a change of dates with its new nights, rates, base and total, and keeps nothing', async () => {
    const stay = await w.create('stays', { first_name: 'Ava', room_type_id: seed.garden['id'], arrive: '2026-08-03', depart: '2026-08-05', guests: 1 });
    const res = await send('POST', url('stays', `/${String(stay['id'])}/dry-run`), { values: { depart: '2026-08-08' } });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { data: Record<string, unknown>; nights: { date: string; rate: string; base: string; tags: string[] }[]; children: Record<string, unknown> };
    // Mon 3 – Sat 8 August: four August nights and an August Friday.
    expect(body.nights).toEqual([
      { date: '2026-08-03', rate: '170.00', base: '150.00', tags: ['August'] },
      { date: '2026-08-04', rate: '170.00', base: '150.00', tags: ['August'] },
      { date: '2026-08-05', rate: '170.00', base: '150.00', tags: ['August'] },
      { date: '2026-08-06', rate: '170.00', base: '150.00', tags: ['August'] },
      { date: '2026-08-07', rate: '195.00', base: '150.00', tags: ['Weekend', 'August'] },
    ]);
    expect(money(body.data['room_total'])).toBe('875.00');
    // 875 + 9 % tax.
    expect(money(body.data['total'])).toBe('953.75');
    expect(body.children).toEqual({});
    const kept = await stayRow(stay['id']);
    expect(money(kept['room_total'])).toBe('340.00');
    expect(Number(kept['nights'])).toBe(2);
  });

  it.runIf(available)('answers the extras that follow the change, as the save leaves them, and keeps none', async () => {
    const stay = await w.create('stays', { first_name: 'Mia', room_type_id: seed.garden['id'], arrive: '2026-08-03', depart: '2026-08-05', guests: 2 });
    const breakfast = await w.create('stay_extras', { stay_id: stay['id'], extra_id: seed.breakfast['id'] });
    const relation = (await served.composed.app.inject({ method: 'GET', url: `/api/v1/connections/${h!.connectionId}/schema`, headers: { cookie: desk } }))
      .json<{ model: { relations: { id: string; through: unknown; from: { tableId: string }; to: { tableId: string } }[] } }>()
      .model.relations.find((r) => r.through === null && r.from.tableId === w.targetOf('stay_extras').table.id && r.to.tableId === w.targetOf('stays').table.id)!.id;
    // Three guests now, and parking added: the breakfast follows the guests, the parking is new.
    const res = await send('POST', url('stays', `/${String(stay['id'])}/dry-run`), {
      values: { guests: 3 },
      children: { [relation]: [{ key: { id: breakfast['id'] }, values: {} }, { values: { extra_id: seed.parking['id'] } }] },
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { data: Record<string, unknown>; children: Record<string, { data: Record<string, unknown> }[]> };
    const lines = body.children[relation]!.map((line) => [Number(line.data['extra_id']), money(line.data['amount'])]).sort((a, b) => Number(a[0]) - Number(b[0]));
    // Breakfast 16 × 3 guests × 2 nights; parking 14 × 2 nights.
    expect(lines).toEqual([
      [Number(seed.breakfast['id']), '96.00'],
      [Number(seed.parking['id']), '28.00'],
    ].sort((a, b) => Number(a[0]) - Number(b[0])));
    expect(money(body.data['extras_total'])).toBe('124.00');
    // Nothing kept: the stay, its breakfast, and no parking.
    expect(Number((await stayRow(stay['id']))['guests'])).toBe(2);
    expect(await count('stay_extras', `stay_id = ${String(stay['id'])}`)).toBe(1);
    expect(money((await h!.rows(`SELECT amount FROM ${h!.real('stay_extras')} WHERE id = ${String(breakfast['id'])}`))[0]!['amount'])).toBe('64.00');
  });

  it.runIf(available)('refuses in a quote what the save refuses, and names a row that is gone', async () => {
    const stay = await w.create('stays', { first_name: 'Noa', room_type_id: seed.garden['id'], arrive: '2026-08-03', depart: '2026-08-05', guests: 1 });
    const bad = await send('POST', url('stays', `/${String(stay['id'])}/dry-run`), { values: { guests: 9 } });
    expect(bad.statusCode, bad.body).toBe(422);
    const gone = await send('POST', url('stays', '/987654/dry-run'), { values: { guests: 2 } });
    expect(gone.statusCode, gone.body).toBe(404);
  });

  it.runIf(available)('saves a change at the price the desk showed, and refuses another price keeping nothing', async () => {
    const stay = await w.create('stays', { first_name: 'Ivy', room_type_id: seed.garden['id'], arrive: '2026-08-03', depart: '2026-08-05', guests: 1 });
    const quoted = (await send('POST', url('stays', `/${String(stay['id'])}/dry-run`), { values: { depart: '2026-08-06' } })).json() as { data: Record<string, unknown> };
    const wrong = await send('PATCH', url('stays', `/${String(stay['id'])}`), { values: { depart: '2026-08-06' }, expect: { total: '1.00' } });
    expect(wrong.statusCode, wrong.body).toBe(409);
    expect(codeOf(wrong)).toMatchObject({ code: 'PRICE_CHANGED', details: { column: 'total', total: money(quoted.data['total']) } });
    expect(money((await stayRow(stay['id']))['room_total'])).toBe('340.00');
    const right = await send('PATCH', url('stays', `/${String(stay['id'])}`), { values: { depart: '2026-08-06' }, expect: { total: String(quoted.data['total']) } });
    expect(right.statusCode, right.body).toBe(200);
    expect(money((await stayRow(stay['id']))['total'])).toBe(money(quoted.data['total']));
  });

  it.runIf(available)('saves a new stay at the price the desk showed, with its rows or none, and refuses another', async () => {
    const values = { first_name: 'Kai', room_type_id: seed.loft['id'], arrive: '2026-07-23', depart: '2026-07-25', guests: 2 };
    const quoted = (await send('POST', url('stays', '/dry-run'), { values })).json() as { data: Record<string, unknown> };
    // Loft 215 + 240 (a Friday), 9 % tax.
    expect(money(quoted.data['total'])).toBe('495.95');
    const before = await count('stays');
    const wrong = await send('POST', url('stays'), { values, expect: { total: '495.94' } });
    expect(wrong.statusCode, wrong.body).toBe(409);
    expect(codeOf(wrong)).toMatchObject({ code: 'PRICE_CHANGED', details: { column: 'total', total: '495.95' } });
    expect(await count('stays')).toBe(before);
    const right = await send('POST', url('stays'), { values, expect: { total: '495.95' } });
    expect(right.statusCode, right.body).toBe(201);
    expect(money((right.json() as { data: Record<string, unknown> }).data['total'])).toBe('495.95');
    // Another money column may be named, and one that holds no price may not.
    const named = await send('POST', url('stays'), { values, expect: { total: '455.00', column: 'room_total' } });
    expect(named.statusCode, named.body).toBe(201);
    const text = await send('POST', url('stays'), { values, expect: { total: '1.00', column: 'first_name' } });
    expect(text.statusCode, text.body).toBe(422);
    const unknown = await send('POST', url('stays'), { values, expect: { total: '1.00', column: 'no_such_column' } });
    expect(unknown.statusCode, unknown.body).toBe(422);
    // A table whose entries check no price must be told which column.
    const charge = await send('POST', url('charges'), { values: { stay_id: (right.json() as { data: { id: unknown } }).data.id, label: 'Minibar', amount: '4.00' }, expect: { total: '4.00' } });
    expect(charge.statusCode, charge.body).toBe(422);
  });

  it.runIf(available)('answers a create sent again under its retry key with the stay the first made', async () => {
    const values = { first_name: 'Zoe', room_type_id: seed.garden['id'], arrive: '2026-09-01', depart: '2026-09-03', guests: 1 };
    const key = 'desk-retry-key-000000000001';
    const first = await send('POST', url('stays'), { values, clientKey: key });
    expect(first.statusCode, first.body).toBe(201);
    const made = (first.json() as { data: Record<string, unknown> }).data;
    // The key is kept as a keyed hash, never as sent.
    expect(made['client_key']).not.toBe(key);
    expect(String(made['client_key'])).toHaveLength(43);
    const again = await send('POST', url('stays'), { values: { ...values, first_name: 'Zoe again' }, clientKey: key });
    expect(again.statusCode, again.body).toBe(200);
    expect(again.json()).toMatchObject({ data: { id: made['id'], first_name: 'Zoe' }, undoToken: null, replayed: true });
    expect(await count('stays', "first_name LIKE 'Zoe%'")).toBe(1);
    // Another person's same key is theirs: a stay of its own.
    const theirs = await send('POST', url('stays'), { values, clientKey: key }, other);
    expect(theirs.statusCode, theirs.body).toBe(201);
    expect((theirs.json() as { data: Record<string, unknown> }).data['id']).not.toBe(made['id']);
    // A key that is not one a client mints, or with a repeated field, is refused.
    expect((await send('POST', url('stays'), { values, clientKey: 'short' })).statusCode).toBe(422);
    // A table that keeps no retry key refuses one.
    expect((await send('POST', url('charges'), { values: { stay_id: made['id'], label: 'x', amount: '1.00' }, clientKey: key })).statusCode).toBe(422);
  });

  it.runIf(available)("shows no night to a role that may not read a stay's dates: not its nights, nor a change quote's", async () => {
    const role = await rolesRepo(h!.meta).create({ slug: 'night-porter', name: 'Night porter' });
    const grant = (ref: string, actions: Record<string, unknown>) =>
      permissionsRepo(h!.meta).grant(role.id, 'table', `${h!.connectionId}/${w.targetOf(ref).table.id}`, { read: true, create: false, update: false, delete: false, export: false, import: false, ...actions } as never);
    await grant('stays', { update: true, readLimit: { readable: ['room_total', 'guests', 'first_name', 'room_type_id'] } });
    for (const ref of ['room_types', 'rate_rules', 'stay_extras', 'extras']) await grant(ref, {});
    const user = await usersRepo(h!.meta).create({ email: 'porter@wren.example', name: 'Porter', passwordHash: await adminPasswordHash(), status: 'active' });
    await rolesRepo(h!.meta).assignToUser(user.id, role.id);
    const porter = (await login(served.composed.app as never, 'porter@wren.example', ADMIN_PASSWORD)).cookie ?? '';
    const stay = await w.create('stays', { first_name: 'Eve', room_type_id: seed.garden['id'], arrive: '2026-08-03', depart: '2026-08-05', guests: 1 });
    const nightly = await served.composed.app.inject({ method: 'GET', url: url('stays', `/${String(stay['id'])}/nightly`), headers: { cookie: porter } });
    expect(nightly.statusCode, nightly.body).toBe(403);
    expect(nightly.json().error.code).toBe('COLUMN_FORBIDDEN');
    const quoted = await send('POST', url('stays', `/${String(stay['id'])}/dry-run`), { values: { guests: 2 } }, porter);
    expect(quoted.statusCode, quoted.body).toBe(200);
    expect(quoted.json()).not.toHaveProperty('nights');
    expect(quoted.json().data).not.toHaveProperty('arrive');
    // The desk, who reads the dates, sees the nights.
    expect((await send('POST', url('stays', `/${String(stay['id'])}/dry-run`), { values: { guests: 2 } })).json().nights).toHaveLength(2);
  });

  it.runIf(available)('makes one stay of two creates sent at once under one retry key', async () => {
    const values = { first_name: 'Rui', room_type_id: seed.harbour['id'], arrive: '2026-09-10', depart: '2026-09-12', guests: 1 };
    const key = 'desk-retry-key-concurrent-01';
    const replies = await Promise.all([0, 1, 2].map(() => send('POST', url('stays'), { values, clientKey: key })));
    for (const res of replies) expect([200, 201], res.body).toContain(res.statusCode);
    expect(replies.filter((res) => res.statusCode === 201)).toHaveLength(1);
    const ids = new Set(replies.map((res) => String((res.json() as { data: { id: unknown } }).data.id)));
    expect(ids.size).toBe(1);
    expect(await count('stays', "first_name = 'Rui'")).toBe(1);
  });
});
