// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A COLUMN AN APP SAYS IS NO PERSONAL DATA IS DRAWN IN CLEAR.
 *
 * A print works keeps its own e-mail address and phone number on its
 * settings row (`personal: false`): the shop's, not a person's. The server
 * sends them in clear, and the page tells the dashboard so too: no form,
 * list or record marks them personal, which would draw "•••" over a value
 * the row carries. A customer's e-mail, with no such word, stays personal.
 *
 * Read by the shop's owner (no Super Admin), on every engine this run can
 * reach.
 */
import { rolesRepo, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { addOnHarness, appManifest, type Harness } from './app-add-ons.helpers.js';
import { adminPasswordHash, ADMIN_PASSWORD, sessionCookie } from './auth-helpers.js';
import { LEGS } from './invoicing-install.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';

const pk = { ref: 'id', type: 'int', role: 'pk' } as const;

function works(): Record<string, unknown> {
  return appManifest('works', {
    version: '1.0.0',
    compatibility: { minAdminiumVersion: '0.3.44', engines: ['postgres', 'mysql', 'sqlite'] },
    requiredSchema: {
      prefixed: true,
      tables: [
        {
          ref: 'settings',
          columns: [
            pk,
            { ref: 'name', type: 'text', maxLength: 80, nullable: true },
            { ref: 'email', type: 'text', maxLength: 120, nullable: true, rules: { personal: false } },
            { ref: 'phone', type: 'text', maxLength: 40, nullable: true, rules: { personal: false } },
          ],
        },
        { ref: 'customers', columns: [pk, { ref: 'name', type: 'text', maxLength: 80, nullable: true }, { ref: 'email', type: 'text', maxLength: 120, nullable: true }] },
      ],
    },
    pages: [
      { ref: 'works-settings', template: 'page-crud', title: { key: 'mft.works.settings', fallback: 'Settings' }, nav: { group: 'manage', icon: 'settings', order: 1 }, bindings: { rows: 'settings' } },
      { ref: 'works-customers', template: 'page-crud', title: { key: 'mft.works.customers', fallback: 'Customers' }, nav: { group: 'manage', icon: 'users', order: 2 }, bindings: { rows: 'customers' } },
    ],
    roles: [{ key: 'owner', name: 'Owner', permissions: ['table:@settings:read', 'table:@customers:read', 'page:@works-settings:view', 'page:@works-customers:view'] }],
  });
}

interface PageReply {
  data: { config: { columns: { name: string; pii?: boolean }[] } };
  columnFacts?: { columns: { spec: { name: string; pii?: boolean } }[] };
}

describe.each(LEGS)('a column an app says is no personal data — %s', (dialect, available) => {
  let h: Harness;
  let served: Served;
  let cookie = '';
  const page = async (slug: string): Promise<PageReply> => {
    const row = await h.meta.db.selectFrom('adminium_pages').select('id').where('slug', '=', slug).executeTakeFirstOrThrow();
    const res = await served.composed.app.inject({ method: 'GET', url: `/api/v1/pages/${row.id}`, headers: { cookie } });
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as PageReply;
  };
  const personal = (reply: PageReply, name: string) => ({
    list: reply.data.config.columns.find((column) => column.name === name)?.pii === true,
    form: reply.columnFacts?.columns.find((column) => column.spec.name === name)?.spec.pii === true,
  });

  beforeAll(async () => {
    if (!available) return;
    h = await addOnHarness(dialect);
    await h.stageApp(works());
    const installed = await h.install('works', '1.0.0');
    expect(installed.statusCode, installed.body).toBe(200);
    served = await servePublic(h as never, null, { ADMINIUM_DATA_DIR: h.dataDir });
    const user = await usersRepo(h.meta).create({ email: 'owner@works.test', name: 'Owner', passwordHash: await adminPasswordHash() });
    await rolesRepo(h.meta).assignToUser(user.id, (await rolesRepo(h.meta).findBySlug('works-owner'))!.id);
    const login = await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: '10.15.0.1', payload: { email: 'owner@works.test', password: ADMIN_PASSWORD } });
    expect(login.statusCode, login.body).toBe(200);
    cookie = sessionCookie(login.headers['set-cookie']);
  }, 240_000);
  afterAll(async () => {
    if (!available) return;
    await served?.close();
    await h?.close();
  });

  it.skipIf(!available)("marks the works' own e-mail and phone personal nowhere", async () => {
    const reply = await page('works-settings');
    expect(personal(reply, 'email')).toEqual({ list: false, form: false });
    expect(personal(reply, 'phone')).toEqual({ list: false, form: false });
  });

  it.skipIf(!available)("still marks a customer's e-mail personal", async () => {
    expect(personal(await page('works-customers'), 'email')).toEqual({ list: true, form: true });
  });

  it.skipIf(!available)("keeps a page's own Mask from Studio, except on a column said to hold no personal data", async () => {
    // Studio's column manager: an admin switches "Mask" on for a column the server sends in clear.
    const admin = await usersRepo(h.meta).create({ email: 'studio@works.test', name: 'Studio', passwordHash: await adminPasswordHash() });
    await rolesRepo(h.meta).assignToUser(admin.id, (await rolesRepo(h.meta).findBySlug('super-admin'))!.id);
    const login = await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: '10.15.0.2', payload: { email: 'studio@works.test', password: ADMIN_PASSWORD } });
    expect(login.statusCode, login.body).toBe(200);
    const studio = sessionCookie(login.headers['set-cookie']);
    const mask = async (slug: string, names: string[]) => {
      const row = await h.meta.db.selectFrom('adminium_pages').select(['id', 'config']).where('slug', '=', slug).executeTakeFirstOrThrow();
      const envelope = (typeof row.config === 'string' ? JSON.parse(row.config) : row.config) as { config: { columns: { name: string; pii?: boolean }[] } };
      const body = { ...envelope.config, columns: envelope.config.columns.map((column) => (names.includes(column.name) ? { ...column, pii: true } : column)) };
      const saved = await served.composed.app.inject({ method: 'PATCH', url: `/api/v1/pages/${row.id}/config`, headers: { cookie: studio }, payload: { config: body } });
      expect(saved.statusCode, saved.body).toBe(200);
    };
    await mask('works-customers', ['name']);
    await mask('works-settings', ['name', 'email']);

    // Read back, as Studio reloads it and as the owner's list draws it.
    expect((await page('works-customers')).data.config.columns.find((column) => column.name === 'name')?.pii).toBe(true);
    const settings = await page('works-settings');
    expect(settings.data.config.columns.find((column) => column.name === 'name')?.pii).toBe(true);
    // The app said the works' e-mail is no person's: that word stands over the page's mark.
    expect(personal(settings, 'email')).toEqual({ list: false, form: false });
  });
});
