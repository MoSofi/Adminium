// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE PAGES OF AN ADD-ON MADE FOR CERTAIN APPS ONLY.
 *
 * The design kit names the two shops it serves and not the dashboard, so it
 * is installed with no dashboard attachment. Its set-up page is still on the
 * dashboard while a shop it is connected to is installed and has it switched
 * on: in the rail, its code served and the files beside it, to whoever holds
 * the page's own permission — Super Admin, and an app's role that grants it
 * (`page:@design-kit-setup:view`). A screens-only desk that holds it fetches
 * the page's files (its record panel draws with the starter fonts); without
 * the permission it is refused, as is a desk of an app that does not use the
 * kit. Switched off for the shop, the page is gone.
 *
 * On every engine this run can reach, through the real installer and the
 * whole server, people signing in with a password.
 */
import { rolesRepo, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { adminPasswordHash, ADMIN_PASSWORD, sessionCookie } from './auth-helpers.js';
import { DESIGN_KIT, DESIGN_KIT_FILES, designKitManifest, designShopManifest } from './fixtures/design-kit/index.js';
import { LEGS } from './invoicing-install.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';

const PAGE = `${DESIGN_KIT}-setup`;
const FONT = 'wOF2-starter-font-bytes';
const FILES = { ...DESIGN_KIT_FILES, 'dist/pages/setup.js': 'export default function Setup() { return null; }\n', 'dist/pages/fonts/Starter.woff2': FONT };

describe.each(LEGS)('the pages of an add-on attached only to an app — %s', (dialect, available) => {
  let h: Harness;
  let served: Served;
  let signIns = 0;
  const people: Record<'admin' | 'owner' | 'clerk' | 'desk' | 'deskNoPage' | 'otherDesk', { cookie: string }> = {} as never;

  /** Somebody in these roles (by slug), signed in. */
  const person = async (email: string, slugs: string[]) => {
    const user = await usersRepo(h.meta).create({ email, name: email.split('@')[0]!, passwordHash: await adminPasswordHash() });
    for (const slug of slugs) {
      const role = (await rolesRepo(h.meta).findBySlug(slug)) ?? (await rolesRepo(h.meta).create({ slug, name: slug, ...(slug === 'bakery-desk' ? { appKey: 'bakery', screensOnly: true } : {}) }));
      await rolesRepo(h.meta).assignToUser(user.id, role.id);
    }
    signIns += 1;
    const res = await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: `10.9.${String(signIns >> 8)}.${String(signIns & 255)}`, payload: { email, password: ADMIN_PASSWORD } });
    expect(res.statusCode, res.body).toBe(200);
    return { cookie: sessionCookie(res.headers['set-cookie']) };
  };
  const get = (who: { cookie: string }, url: string) => served.composed.app.inject({ method: 'GET', url: `/api/v1${url}`, headers: { cookie: who.cookie } });
  /** The kit's pages the rail tells this person of. */
  const railPages = async (who: { cookie: string }) => {
    const res = await get(who, '/bootstrap');
    expect(res.statusCode, res.body).toBe(200);
    return ((res.json() as { data: { addOnNav?: { pages: { addOnKey: string; ref: string }[] } } }).data.addOnNav?.pages ?? []).filter((page) => page.addOnKey === DESIGN_KIT).map((page) => page.ref);
  };
  const code = (who: { cookie: string }) => get(who, `/add-ons/${DESIGN_KIT}/pages/${PAGE}/bundle`);
  const font = (who: { cookie: string }) => get(who, `/add-ons/${DESIGN_KIT}/pages/${PAGE}/files/fonts/Starter.woff2`);

  beforeAll(async () => {
    if (!available) return;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    const kit = designKitManifest({}, { panel: true }) as { addOn: Record<string, unknown> };
    kit.addOn['hostApi'] = 2;
    kit.addOn['pages'] = [{ ref: PAGE, title: { key: 'design-kit.page.setup', fallback: 'Design set-up' }, icon: 'settings-2', client: 'dist/pages/setup.js', nav: { group: 'library', order: 30 } }];
    await h.stageAddOn(kit, { files: FILES });
    await h.stageApp(
      designShopManifest('printing', {
        addOns: { suggests: [{ key: DESIGN_KIT, range: '^1.0.0', reason: { 'en-US': 'Shoppers design their products.' } }] },
        people: undefined,
        compatibility: { minAdminiumVersion: '0.3.44', engines: ['postgres', 'mysql', 'sqlite'] },
        roles: [
          { key: 'owner', name: 'Owner', permissions: ['table:@orders:read', `page:@${PAGE}:view`] },
          { key: 'clerk', name: 'Clerk', permissions: ['table:@orders:read'] },
          { key: 'desk', name: 'Desk', screensOnly: true, permissions: ['table:@orders:read', `page:@${PAGE}:view`] },
          { key: 'desk-plain', name: 'Plain desk', screensOnly: true, permissions: ['table:@orders:read'] },
        ],
      }),
    );
    const installed = await h.install('printing', '1.0.0', { addOns: [{ key: DESIGN_KIT, version: '1.0.0' }] });
    expect(installed.statusCode, installed.body).toBe(200);
    served = await servePublic(h as never, null, { ADMINIUM_DATA_DIR: h.dataDir });
    people.admin = await person('admin@shop.test', ['super-admin']);
    people.owner = await person('owner@shop.test', ['printing-owner']);
    people.clerk = await person('clerk@shop.test', ['printing-clerk']);
    people.desk = await person('desk@shop.test', ['printing-desk']);
    people.deskNoPage = await person('plain@shop.test', ['printing-desk-plain']);
    people.otherDesk = await person('bakery@shop.test', ['bakery-desk']);
  }, 240_000);
  afterAll(async () => {
    if (!available) return;
    await served?.close();
    await h?.close();
  });

  it.skipIf(!available)('is installed with no dashboard attachment, as a kit that names only its shops is', async () => {
    const res = await get(people.admin, '/add-ons');
    const kit = (res.json() as { addOns: { key: string; attachments: { attachedTo: string }[] }[] }).addOns.find((addOn) => addOn.key === DESIGN_KIT);
    expect(kit?.attachments.map((one) => one.attachedTo)).toEqual(['printing']);
  });

  it.skipIf(!available)("is in the rail of Super Admin and of the shop's owner, whose role grants the page; not of a clerk's", async () => {
    expect(await railPages(people.admin)).toEqual([PAGE]);
    expect(await railPages(people.owner)).toEqual([PAGE]);
    expect(await railPages(people.clerk)).toEqual([]);
  });

  it.skipIf(!available)('serves its code to who holds the page, and refuses who does not', async () => {
    for (const who of [people.admin, people.owner]) {
      const res = await code(who);
      expect(res.statusCode, res.body).toBe(200);
      expect(res.body).toBe(FILES['dist/pages/setup.js']);
    }
    expect((await code(people.clerk)).statusCode).toBe(403);
  });

  it.skipIf(!available)('serves the files beside it to the owner and to a screens-only desk that holds the page', async () => {
    for (const who of [people.admin, people.owner, people.desk]) {
      const res = await font(who);
      expect(res.statusCode, res.body).toBe(200);
      expect(res.body).toBe(FONT);
    }
  });

  it.skipIf(!available)('refuses its files to a desk without the page, and to a desk of an app that does not use the kit', async () => {
    const plain = await font(people.deskNoPage);
    expect([plain.statusCode, plain.json().error?.code]).toEqual([403, 'FORBIDDEN']);
    const other = await font(people.otherDesk);
    expect([other.statusCode, other.json().error?.code]).toEqual([403, 'APP_SCREENS_ONLY']);
    // The page itself is the dashboard's: a screens-only desk opens its app's screens, not the page's code.
    expect((await code(people.desk)).json().error?.code).toBe('APP_SCREENS_ONLY');
  });

  it.skipIf(!available)('is gone from the rail, and its code and files refused, while the kit is switched off for the shop', async () => {
    const off = await h.inject({ method: 'PATCH', url: `/add-ons/${DESIGN_KIT}`, payload: { attachedTo: 'printing', enabled: false } });
    expect(off.statusCode, off.body).toBe(200);
    try {
      expect(await railPages(people.admin)).toEqual([]);
      expect((await code(people.admin)).statusCode).toBe(404);
      expect((await font(people.owner)).statusCode).toBe(404);
    } finally {
      const on = await h.inject({ method: 'PATCH', url: `/add-ons/${DESIGN_KIT}`, payload: { attachedTo: 'printing', enabled: true } });
      expect(on.statusCode, on.body).toBe(200);
    }
    expect(await railPages(people.admin)).toEqual([PAGE]);
  });
});
