// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A LINK INTO AN ADD-ON'S TABLE, SHOWN BY THE LINKED ROW'S NAME; A FILE
 * COLUMN THE APP'S OWN RULE MAKES, OFFERED AS ONE.
 *
 * A print works' closure names the public holiday it is for (`holiday_id`, a
 * link into the holiday calendars' table): no foreign key stands behind it,
 * so the page made from the table saw a number, and the list showed "143".
 * The page's facts now carry the link's table and the column its rows are
 * named by, and a `lookup=` through the link reads that name — for a role
 * that reads both tables; one that does not read the add-on's table gets
 * nothing in its place, never a refusal of the whole list.
 *
 * And a proof's picture: a text column the app's rule (`rules.file`) makes a
 * file column. The facts now carry its file block (the file's id stored, the
 * kinds and size the rule says), so the form uploads instead of offering a box
 * for an id. On every engine this run can reach.
 */
import { parseDatabaseModel } from '@adminium/engine';
import { permissionsRepo, rolesRepo, snapshotsRepo, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { columnFactsFor } from '../src/routes/pages/column-facts.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { ADMIN_PASSWORD, adminPasswordHash, sessionCookie } from './auth-helpers.js';
import { LEGS } from './invoicing-install.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';

type Doc = Record<string, unknown>;
const IDENTITY = { manifestVersion: 1, publisher: { id: 'adminium', name: 'Adminium' }, license: 'MIT', description: { key: 'd', fallback: 'd' } };

const WORKS: Doc = {
  ...IDENTITY,
  kind: 'app',
  key: 'works',
  name: 'Works',
  version: '0.3.0',
  categories: ['commerce'],
  compatibility: { minAdminiumVersion: '0.3.28' },
  pages: [{ ref: 'works-closures', template: 'page-crud', title: { key: 't', fallback: 'Closures' }, nav: { group: 'manage', icon: 'list', order: 1 }, bindings: { main: 'closures' } }],
  frontends: [{ side: 'staff', kind: 'none' }],
  addOns: { suggests: [{ key: 'days', range: '>=1.0.0', reason: { 'en-US': 'Holidays.' } }] },
  requiredSchema: {
    prefixed: true,
    tables: [
      {
        ref: 'closures',
        columns: [
          { ref: 'id', type: 'int', role: 'pk' },
          { ref: 'reason', type: 'text', maxLength: 80, nullable: true },
          { ref: 'holiday_id', type: 'int', nullable: true, rules: { addOnLink: { addOn: 'days', table: 'holidays' } } },
          { ref: 'picture', type: 'text', maxLength: 64, nullable: true, rules: { file: { accept: ['png', 'pdf'], maxBytes: 1048576 } } },
        ],
      },
    ],
  },
};

const DAYS: Doc = {
  ...IDENTITY,
  kind: 'add-on',
  key: 'days',
  name: 'Days',
  version: '1.0.0',
  categories: ['data'],
  compatibility: { minAdminiumVersion: '0.3.18' },
  addOn: { attaches: [{ app: '*', range: '*' }], connect: { kind: 'none' } },
  requiredSchema: {
    prefixed: true,
    tables: [{ ref: 'holidays', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'name', type: 'text', maxLength: 80 }] }],
  },
};

describe.each(LEGS)('a link into an add-on\'s table, named by its row — %s', (dialect, available) => {
  let h: Harness;
  let served: Served;
  let closures: string;
  let holidays: string;
  let at = 0;

  /** Somebody who reads these tables, signed in to the whole server. */
  const signedIn = async (name: string, tables: string[]): Promise<string> => {
    const member = await usersRepo(h.meta).create({ email: `${name}@works.dev`, name, passwordHash: await adminPasswordHash() });
    const role = await rolesRepo(h.meta).create({ slug: name, name } as never);
    for (const id of tables) {
      await permissionsRepo(h.meta).grant(role.id, 'table', `${h.connectionId}/${id}`, { read: true, create: false, update: false, delete: false, export: false, import: false } as never);
    }
    await rolesRepo(h.meta).assignToUser(member.id, role.id);
    at += 1;
    const login = await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: `10.9.0.${String(at)}`, payload: { email: `${name}@works.dev`, password: ADMIN_PASSWORD } });
    expect(login.statusCode, login.body).toBe(200);
    return sessionCookie(login.headers['set-cookie']);
  };
  const list = (cookie: string) =>
    served.composed.app.inject({ method: 'GET', url: `/api/v1/data/${h.connectionId}/${closures}?lookup=${encodeURIComponent('holiday_id__display:holiday_id.name')}`, headers: { cookie } });

  beforeAll(async () => {
    if (!available) return;
    h = await addOnHarness(dialect);
    await h.stageApp(WORKS);
    const app = await h.install('works', '0.3.0');
    expect(app.statusCode, app.body).toBe(200);
    await h.stageAddOn(DAYS, { bundled: true });
    const addOn = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'days', version: '1.0.0', attachTo: ['works'] } });
    expect(addOn.statusCode, addOn.body).toBe(200);
    await h.rows(`INSERT INTO days_holidays (id, name) VALUES (143, 'Good Friday')`);
    await h.rows(`INSERT INTO works_closures (id, reason, holiday_id) VALUES (1, 'Closed for Easter', 143)`);
    const model = parseDatabaseModel((await snapshotsRepo(h.meta).latest(h.connectionId))!.schema);
    closures = model.tables.find((table) => table.name === 'works_closures')!.id;
    holidays = model.tables.find((table) => table.name === 'days_holidays')!.id;
    served = await servePublic(h as never, null, { ADMINIUM_DATA_DIR: h.dataDir });
  }, 240_000);
  afterAll(async () => {
    if (!available) return;
    await served?.close();
    await h?.close();
  });

  it.skipIf(!available)('the facts name the link\'s table and the column its rows are named by, and the rule\'s file block', async () => {
    const facts = await columnFactsFor(h.meta, h.connectionId, closures);
    const spec = (name: string) => facts!.columns.find((column) => column.spec['name'] === name)!.spec;
    expect(spec('holiday_id')['fk']).toMatchObject({ table: holidays, column: 'id', display: 'name' });
    expect(spec('picture')['file']).toEqual({ ref: 'id', accept: ['png', 'pdf'], maxBytes: 1048576 });
    // A plain column is told nothing new.
    expect(spec('reason')['fk']).toBeUndefined();
    expect(spec('reason')['file']).toBeUndefined();
  });

  it.skipIf(!available)('a role that reads both tables sees the holiday\'s name through the link', async () => {
    const res = await list(await signedIn('ola', [closures, holidays]));
    expect(res.statusCode, res.body).toBe(200);
    const row = (res.json() as { data: Doc[] }).data[0]!;
    expect(row['holiday_id__display']).toBe('Good Friday');
    expect(Number(row['holiday_id'])).toBe(143);
  });

  it.skipIf(!available)('a role that does not read the add-on\'s table gets no name, and still its list', async () => {
    const res = await list(await signedIn('pip', [closures]));
    expect(res.statusCode, res.body).toBe(200);
    const row = (res.json() as { data: Doc[] }).data[0]!;
    expect(row['holiday_id__display'] ?? null).toBeNull();
    expect(Number(row['holiday_id'])).toBe(143);
  });
});
