// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE ADD-ON CODE A SCREENS-ONLY ROLE IS TOLD OF IS THE CODE IT IS SERVED.
 *
 * A print works' counter and prepress open only the app's own screens. Those
 * screens read the add-ons list and load every bundle it names, so the list
 * and the bundle route must agree: a screens-only person is told of (and
 * served) an add-on's file exactly when it fills a slot their screens draw
 * (a staff-side slot, or one of both sides): the carrier's "Book a
 * collection". A fill of the dashboard's settings panel alone, and a page's
 * code (the dashboard's), are left out of their list, and the route refuses
 * them. Everybody else's list is as it was.
 *
 * A slot file's address names its bytes (`?v=`), and under that address the
 * reply may be kept, so a screen that fetches a file to hash it and then
 * imports it asks once.
 *
 * As the counter, prepress and the owner, on every engine this run can reach.
 */
import { rolesRepo, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { addOnHarness, addOnManifest, type Harness } from './app-add-ons.helpers.js';
import { ADMIN_PASSWORD, adminPasswordHash, sessionCookie } from './auth-helpers.js';
import { LEGS } from './invoicing-install.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';

type Doc = Record<string, unknown>;
interface Listed {
  key: string;
  bundles: { path: string; url: string; ref?: string; panel?: string }[];
}

const IDENTITY = { manifestVersion: 1, publisher: { id: 'adminium', name: 'Adminium' }, license: 'MIT', description: { key: 'd', fallback: 'd' } };
const PAGE = 'extras-setup';

const works: Doc = {
  ...IDENTITY,
  kind: 'app',
  key: 'works',
  name: 'Works',
  version: '0.3.0',
  categories: ['commerce'],
  compatibility: { minAdminiumVersion: '0.3.44' },
  pages: [{ ref: 'works-orders', template: 'page-crud', title: { key: 't', fallback: 'Orders' }, nav: { group: 'manage', icon: 'list', order: 1 }, bindings: { main: 'orders' } }],
  frontends: [{ side: 'staff', kind: 'none' }],
  addOns: { suggests: ['carrier', 'calendar', 'extras'].map((key) => ({ key, range: '>=1.0.0', reason: { 'en-US': 'Used on the screens.' } })) },
  requiredSchema: { prefixed: true, tables: [{ ref: 'orders', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'note', type: 'text', maxLength: 80, nullable: true }] }] },
  roles: [
    { key: 'owner', name: 'Owner', permissions: ['app:@:staff', 'table:@orders:read', `page:@${PAGE}:view`] },
    { key: 'counter', name: 'Counter', screensOnly: true, permissions: ['app:@:staff', 'table:@orders:read'] },
    { key: 'prepress', name: 'Prepress', screensOnly: true, permissions: ['app:@:staff', 'table:@orders:read', `page:@${PAGE}:view`] },
  ],
};

// The carrier fills the dispatch screen (staff) and the dashboard's settings panel.
const carrier = addOnManifest('carrier', {
  compatibility: { minAdminiumVersion: '0.3.18', requires: [] },
  addOn: {
    slots: [
      { slot: 'order.dispatch.actions', client: 'dist/client.js', order: 10 },
      { slot: 'settings.add-on.panel', client: 'dist/client.js', order: 10 },
    ],
  },
});
// The calendar fills the dashboard's settings panel alone.
const calendar = addOnManifest('calendar', { compatibility: { minAdminiumVersion: '0.3.18', requires: [] } });
// The extras keep a page of the dashboard, behind its own permission.
const extras = addOnManifest('extras', {
  compatibility: { minAdminiumVersion: '0.3.18', requires: [] },
  addOn: { hostApi: 2, pages: [{ ref: PAGE, title: { key: 'extras.page', fallback: 'Extras' }, icon: 'settings-2', client: 'dist/pages/setup.js', nav: { group: 'library', order: 30 } }] },
});

describe.each(LEGS)('the add-on code a screens-only role is served — %s', (dialect, available) => {
  let h: Harness;
  let served: Served;
  let signIns = 0;
  const people: Record<'owner' | 'counter' | 'prepress', string> = {} as never;
  const get = (cookie: string, url: string) => served.composed.app.inject({ method: 'GET', url, headers: { cookie } });
  const list = async (cookie: string): Promise<Listed[]> => {
    const res = await get(cookie, '/api/v1/add-ons');
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { addOns: Listed[] }).addOns;
  };
  const bundlesOf = async (cookie: string, key: string) => (await list(cookie)).find((one) => one.key === key)?.bundles ?? [];
  const person = async (email: string, slug: string): Promise<string> => {
    const user = await usersRepo(h.meta).create({ email, name: email.split('@')[0]!, passwordHash: await adminPasswordHash() });
    await rolesRepo(h.meta).assignToUser(user.id, (await rolesRepo(h.meta).findBySlug(slug))!.id);
    signIns += 1;
    const login = await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: `10.13.0.${String(signIns)}`, payload: { email, password: ADMIN_PASSWORD } });
    expect(login.statusCode, login.body).toBe(200);
    return sessionCookie(login.headers['set-cookie']);
  };

  beforeAll(async () => {
    if (!available) return;
    h = await addOnHarness(dialect);
    await h.stageAddOn(carrier);
    await h.stageAddOn(calendar);
    await h.stageAddOn(extras, { files: { 'dist/pages/setup.js': 'export default function Setup() { return null; }\n' } });
    await h.stageApp(works);
    // The app with its three add-ons, as an app installs the add-ons it suggests: its roles' grants on them hold.
    const installed = await h.install('works', '0.3.0', { addOns: ['carrier', 'calendar', 'extras'].map((key) => ({ key, version: '1.0.0' })) });
    expect(installed.statusCode, installed.body).toBe(200);
    served = await servePublic(h as never, null, { ADMINIUM_DATA_DIR: h.dataDir });
    people.owner = await person('owner@works.dev', 'works-owner');
    people.counter = await person('counter@works.dev', 'works-counter');
    people.prepress = await person('prepress@works.dev', 'works-prepress');
  }, 240_000);
  afterAll(async () => {
    if (!available) return;
    await served?.close();
    await h?.close();
  });

  it.skipIf(!available)("tells the counter of the carrier's dispatch code, and serves it", async () => {
    const bundles = await bundlesOf(people.counter, 'carrier');
    expect(bundles.map((one) => one.path)).toEqual(['dist/client.js']);
    const res = await get(people.counter, bundles[0]!.url);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.body).toBe('export const register = () => {};');
  });

  it.skipIf(!available)('names no file a screens-only person is refused: every URL in their list answers 200', async () => {
    for (const who of [people.counter, people.prepress]) {
      const addOns = await list(who);
      expect(addOns.map((one) => one.key).sort()).toEqual(['calendar', 'carrier', 'extras']);
      // The calendar fills only the dashboard's settings panel; the extras' page is the dashboard's.
      expect(addOns.find((one) => one.key === 'calendar')!.bundles).toEqual([]);
      expect(addOns.find((one) => one.key === 'extras')!.bundles).toEqual([]);
      for (const bundle of addOns.flatMap((one) => one.bundles)) {
        const res = await get(who, bundle.url);
        expect(res.statusCode, `${bundle.url} ${res.body}`).toBe(200);
      }
    }
  });

  it.skipIf(!available)('refuses a screens-only person the code their screens never draw', async () => {
    const calendarFile = await get(people.counter, '/api/v1/add-ons/calendar/bundle/dist/client.js');
    expect(calendarFile.statusCode, calendarFile.body).toBe(403);
    const page = await get(people.prepress, `/api/v1/add-ons/extras/pages/${PAGE}/bundle`);
    expect(page.statusCode, page.body).toBe(403);
  });

  it.skipIf(!available)('still tells the owner of every file, their page included, and serves them', async () => {
    expect((await bundlesOf(people.owner, 'calendar')).map((one) => one.path)).toEqual(['dist/client.js']);
    const page = (await bundlesOf(people.owner, 'extras')).find((one) => one.ref === PAGE);
    expect(page?.url).toBe(`/api/v1/add-ons/extras/pages/${PAGE}/bundle`);
    for (const key of ['carrier', 'calendar', 'extras']) {
      for (const bundle of await bundlesOf(people.owner, key)) expect((await get(people.owner, bundle.url)).statusCode, bundle.url).toBe(200);
    }
  });

  it.skipIf(!available)("lets a slot file be kept under the address naming its bytes, and only there", async () => {
    const [bundle] = await bundlesOf(people.owner, 'carrier');
    expect(bundle!.url).toMatch(/^\/api\/v1\/add-ons\/carrier\/bundle\/dist\/client\.js\?v=[0-9a-f]{16}$/);
    expect((await get(people.owner, bundle!.url)).headers['cache-control']).toBe('private, max-age=31536000, immutable');
    expect((await get(people.owner, '/api/v1/add-ons/carrier/bundle/dist/client.js')).headers['cache-control']).toBe('no-cache');
    expect((await get(people.owner, '/api/v1/add-ons/carrier/bundle/dist/client.js?v=0000000000000000')).headers['cache-control']).toBe('no-cache');
    // A page's code is asked each time.
    expect((await get(people.owner, `/api/v1/add-ons/extras/pages/${PAGE}/bundle`)).headers['cache-control']).toBe('no-cache');
  });
});
