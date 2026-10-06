// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ROWS WRITTEN ONE AT A TIME — the route a list page falls back to when a
 * bulk change is refused because its rows post, and the route an add-on's
 * page sends many new rows through.
 *
 * Each row is a save of its own, through the same write as a single save:
 * a row refused does not stop the next, and the reply says what became of
 * each, in the order sent. Nothing can be undone with a token.
 */
import { rolesRepo, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPasswordHash, ADMIN_PASSWORD, sessionCookie } from './auth-helpers.js';
import { installInvoicing, invoicingManifest, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';

type Reply = { results: { id?: unknown; index?: number; ok: boolean; data?: Record<string, unknown>; error?: { code: string; reason?: string } }[]; done: number; notRun: number };

describe.each(LEGS)('rows written one at a time — %s', (dialect, available) => {
  let h: InvoicingHarness | undefined;
  let w: Awaited<ReturnType<typeof writerFor>>;
  let served: Served;
  let cookie = '';
  const url = () => `/api/v1/data/${h!.connectionId}/${encodeURIComponent(w.targetOf('groups').table.id)}/one-by-one`;
  const send = (payload: unknown) => served.composed.app.inject({ method: 'POST', url: url(), headers: { cookie }, payload: payload as never });
  const sizeOf = async (id: unknown) => Number((await h!.rows(`SELECT size FROM ${h!.real('groups')} WHERE id = ${String(id)}`))[0]!['size']);

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, invoicingManifest([{ ref: 'groups', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'size', type: 'int', default: 1 }] }]));
    w = await writerFor(h);
    served = await servePublic(h, null);
    const desk = await usersRepo(h.meta).create({ email: 'desk@rows.dev', name: 'Desk', passwordHash: await adminPasswordHash() });
    await rolesRepo(h.meta).assignToUser(desk.id, (await rolesRepo(h.meta).findBySlug('super-admin'))!.id);
    const login = await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'desk@rows.dev', password: ADMIN_PASSWORD } });
    cookie = sessionCookie(login.headers['set-cookie']);
  }, 180_000);
  afterAll(async () => {
    if (!available) return;
    await served.close();
    await h!.close();
  });

  it.skipIf(!available)('one change for each row, each its own save: every row is answered, in the order sent, and a row that is refused does not stop the next', async () => {
    const [a, b] = [await w.create('groups', { size: 2 }), await w.create('groups', { size: 3 })];
    const res = await send({ ids: [a['id'], 999_999, b['id']], values: { size: 6 } });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as Reply;
    expect(body.results.map((row) => [row.id, row.ok, row.error?.code])).toEqual([
      [a['id'], true, undefined],
      [999_999, false, 'NOT_FOUND'],
      [b['id'], true, undefined],
    ]);
    expect(body).toMatchObject({ done: 2, notRun: 0 });
    expect([await sizeOf(a['id']), await sizeOf(b['id'])]).toEqual([6, 6]);
    // No token: nothing here is undone as one.
    expect(res.json()).not.toHaveProperty('undoToken');
  });

  it.skipIf(!available)('one new row for each entry, each answered with the row as it was stored — and a bad one with its own refusal', async () => {
    const before = Number((await h!.rows(`SELECT COUNT(*) AS n FROM ${h!.real('groups')}`))[0]!['n']);
    const res = await send({ creates: [{ size: 4 }, { no_such_column: 1 }, { size: 9 }] });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as Reply;
    expect(body.results.map((row) => [row.index, row.ok])).toEqual([[0, true], [1, false], [2, true]]);
    expect(body.results[1]!.error?.code).toBeTruthy();
    expect(Number(body.results[0]!.data!['size'])).toBe(4);
    expect(Number(body.results[2]!.data!['size'])).toBe(9);
    expect(body.results[0]!.id).toBe(body.results[0]!.data!['id']);
    expect(body).toMatchObject({ done: 2, notRun: 0 });
    expect(Number((await h!.rows(`SELECT COUNT(*) AS n FROM ${h!.real('groups')}`))[0]!['n'])).toBe(before + 2);
  });

  it.skipIf(!available)('a body with both forms, with neither, or with ids and nothing to write is refused whole', async () => {
    const row = await w.create('groups', { size: 2 });
    for (const payload of [{ ids: [row['id']], values: { size: 5 }, creates: [{ size: 1 }] }, {}, { ids: [row['id']] }, { creates: [{ size: 1 }], values: { size: 2 } }, { ids: [], values: { size: 1 } }]) {
      const res = await send(payload);
      expect(res.statusCode, JSON.stringify(payload)).toBe(422);
    }
    expect(await sizeOf(row['id'])).toBe(2);
  });

  it.skipIf(!available)('the call needs what a change of the table needs: nobody signed in is turned away', async () => {
    const res = await served.composed.app.inject({ method: 'POST', url: url(), payload: { creates: [{ size: 1 }] } });
    expect(res.statusCode).toBe(401);
  });
});
