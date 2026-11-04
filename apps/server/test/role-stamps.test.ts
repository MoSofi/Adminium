// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A COLUMN'S ROLE STAMPS IT, WHATEVER ITS NAME.
 *
 * An app's ticket keeps when it was made in `saved_on` (`role: "created_at"`)
 * and when it last changed in `changed_on` (`role: "updated_at"`). Neither is
 * a name the server would stamp by itself, and both are stamped through every
 * door: a guest's create, a guest's change through the row they found again,
 * and the desk's change. The ticket's `updated_at`, which no role names, is
 * not the row's "last changed" here and stays as it was: the role decides.
 *
 * A last-changed moment the app also fills on a create (`default: "now"`)
 * is stamped on every change too. A table that gives no roles keeps the
 * name: a note's `created_at` and `updated_at` are stamped as they always
 * were. On every engine.
 */
import { rolesRepo, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPublicViews } from '../src/public-api/runtime.js';
import { adminPasswordHash, ADMIN_PASSWORD, sessionCookie } from './auth-helpers.js';
import { installInvoicing, invoicingManifest, LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';

type Doc = Record<string, unknown>;
const pk = { ref: 'id', type: 'int', role: 'pk' };
const moment = (ref: string, role?: 'created_at' | 'updated_at') => ({ ref, type: 'timestamptz', nullable: true, ...(role === undefined ? {} : { role }) });
const LONG_AGO = '2001-02-03 04:05:06';

function manifest(): Doc {
  return {
    ...invoicingManifest([
      {
        ref: 'tickets',
        columns: [
          pk,
          { ref: 'name', type: 'text', maxLength: 80, nullable: true },
          { ref: 'link_code', type: 'text', maxLength: 12, nullable: true, rules: { code: { length: 12 } } },
          moment('saved_on', 'created_at'),
          moment('changed_on', 'updated_at'),
          moment('updated_at'),
        ],
      },
      { ref: 'notes', columns: [pk, { ref: 'body', type: 'text', maxLength: 80, nullable: true }, moment('created_at'), moment('updated_at')] },
      // A last change the app also fills on a create: the default fills the create, the role every change after.
      { ref: 'visits', columns: [pk, { ref: 'note', type: 'text', maxLength: 80, nullable: true }, { ...moment('updated_at', 'updated_at'), default: 'now' }] },
    ]),
    publicAccess: [
      { table: 'tickets', methods: ['POST'], writable: ['name'], select: ['id'] },
      { table: 'tickets', methods: ['GET', 'PATCH'], claim: { match: ['id', 'link_code'] }, select: ['id', 'name'], writable: ['name'] },
    ],
  };
}

/** The year a stored moment falls in, however the engine hands it back. */
const yearOf = (value: unknown): number | null => (value === null || value === undefined ? null : value instanceof Date ? value.getUTCFullYear() : Number(String(value).slice(0, 4)));

describe.each(LEGS)("a column's role stamps it, whatever its name — %s", (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let served: Served;
  let cookie: string;
  let ip = 0;
  const fresh = () => {
    ip += 1;
    return `10.4.${String((ip >> 8) & 255)}.${String(ip & 255)}`;
  };
  const tickets = () => h.real('tickets');
  const stored = async (id: number) => (await h.rows(`select saved_on, changed_on, updated_at from ${tickets()} where id = ${String(id)}`))[0]!;
  const backdate = (table: string, id: number, columns: string[]) => h.rows(`update ${table} set ${columns.map((c) => `${c} = '${LONG_AGO}'`).join(', ')} where id = ${String(id)}`);
  /** The desk's change of one row, through the data routes. */
  const deskChange = async (short: string, id: number, values: Doc) => {
    const table = (await createPublicViews(h.meta).viewFor(h.connectionId))!.table(h.real(short)).id;
    return served.composed.app.inject({ method: 'PATCH', url: `/api/v1/data/${h.connectionId}/${encodeURIComponent(table)}/${String(id)}`, headers: { cookie }, payload: { values } });
  };
  /** A guest's ticket, made through the shop's key. */
  const guestCreate = async (name: string): Promise<number> => {
    const res = await served.composed.app.inject({ method: 'POST', url: `/api/v1/public/records/${tickets()}`, remoteAddress: fresh(), headers: served.headers(), payload: { values: { name } } });
    expect(res.statusCode, res.body).toBe(201);
    return Number((res.json() as { data: { id: unknown } }).data.id);
  };

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, manifest());
    const keys = (h.reply['publicAccess'] as { keys: Record<string, string> }).keys;
    served = await servePublic(h, keys['customer']!);
    const desk = await usersRepo(h.meta).create({ email: 'desk@studio.dev', name: 'Desk', passwordHash: await adminPasswordHash() });
    await rolesRepo(h.meta).assignToUser(desk.id, (await rolesRepo(h.meta).findBySlug('super-admin'))!.id);
    const login = await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: '10.4.255.1', payload: { email: 'desk@studio.dev', password: ADMIN_PASSWORD } });
    cookie = sessionCookie(login.headers['set-cookie']);
  }, 180_000);
  afterAll(async () => {
    if (!available) return;
    await served.close();
    await h.close();
  });

  it.skipIf(!available)("stamps both moments on a guest's create, and not the column no role names", async () => {
    const id = await guestCreate('Ana');
    const row = await stored(id);
    expect(yearOf(row['saved_on'])).toBeGreaterThanOrEqual(2026);
    expect(yearOf(row['changed_on'])).toBeGreaterThanOrEqual(2026);
    expect(row['updated_at'] ?? null).toBeNull();
  });

  it.skipIf(!available)('stamps the change on a guest\'s change through the row they found again, and keeps when it was made', async () => {
    const id = await guestCreate('Ben');
    await backdate(tickets(), id, ['saved_on', 'changed_on']);
    const code = String((await h.rows(`select link_code from ${tickets()} where id = ${String(id)}`))[0]!['link_code']);
    const claim = await served.composed.app.inject({ method: 'POST', url: '/api/v1/public/claim', remoteAddress: fresh(), headers: served.headers(), payload: { match: { id, link_code: code } } });
    expect(claim.statusCode, claim.body).toBe(200);
    const session = (claim.json() as { data: { session: string } }).data.session;
    const res = await served.composed.app.inject({ method: 'PATCH', url: `/api/v1/public/records/${tickets()}_claimed/${String(id)}`, remoteAddress: fresh(), headers: served.headers(session), payload: { values: { name: 'Ben B' } } });
    expect(res.statusCode, res.body).toBe(200);
    const row = await stored(id);
    expect(yearOf(row['changed_on'])).toBeGreaterThanOrEqual(2026);
    expect(yearOf(row['saved_on'])).toBe(2001);
    expect(row['updated_at'] ?? null).toBeNull();
  });

  it.skipIf(!available)("stamps the change on the desk's change, and keeps when it was made", async () => {
    const id = await guestCreate('Cy');
    await backdate(tickets(), id, ['saved_on', 'changed_on']);
    const res = await deskChange('tickets', id, { name: 'Cy C' });
    expect(res.statusCode, res.body).toBe(200);
    const row = await stored(id);
    expect(yearOf(row['changed_on'])).toBeGreaterThanOrEqual(2026);
    expect(yearOf(row['saved_on'])).toBe(2001);
    expect(row['updated_at'] ?? null).toBeNull();
  });

  it.skipIf(!available)('stamps a change of a last-changed moment the app also fills on a create', async () => {
    await h.rows(`insert into ${h.real('visits')} (note) values ('First')`);
    const id = Number((await h.rows(`select max(id) as id from ${h.real('visits')}`))[0]!['id']);
    await backdate(h.real('visits'), id, ['updated_at']);
    const res = await deskChange('visits', id, { note: 'Second' });
    expect(res.statusCode, res.body).toBe(200);
    const row = (await h.rows(`select updated_at from ${h.real('visits')} where id = ${String(id)}`))[0]!;
    expect(yearOf(row['updated_at'])).toBeGreaterThanOrEqual(2026);
  });

  it.skipIf(!available)('keeps the name where a table gives no roles', async () => {
    await h.rows(`insert into ${h.real('notes')} (body) values ('First')`);
    const id = Number((await h.rows(`select max(id) as id from ${h.real('notes')}`))[0]!['id']);
    await backdate(h.real('notes'), id, ['created_at', 'updated_at']);
    const res = await deskChange('notes', id, { body: 'Second' });
    expect(res.statusCode, res.body).toBe(200);
    const row = (await h.rows(`select created_at, updated_at from ${h.real('notes')} where id = ${String(id)}`))[0]!;
    expect(yearOf(row['updated_at'])).toBeGreaterThanOrEqual(2026);
    expect(yearOf(row['created_at'])).toBe(2001);
  });
});
