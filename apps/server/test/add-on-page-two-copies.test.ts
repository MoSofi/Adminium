// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN ADD-ON PAGE WHEN TWO APPS EACH HOLD A COPY OF THE ADD-ON.
 *
 * A maker's shop and a print shop run on one server, each on its own
 * database, and each has its own copy of the design kit. The kit's set-up
 * page is one page of code, but it opens one copy: the rail lists it once per
 * copy the reader reaches, each row naming its address, its install and its
 * database, and the kit a page asks for with that install answers. With one
 * app there is one row, which still names its install.
 *
 * Asked with no copy named, the kit answers 409: it counts every copy, and
 * names only those the reader reaches.
 *
 * As the shop's owner, the print shop's owner and Super Admin, on every
 * engine this run can reach.
 */
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { manifestsRepo, rolesRepo, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runIntrospection } from '../src/connections/introspect.js';
import { addOnHarness, CRYPTO, type Harness } from './app-add-ons.helpers.js';
import { adminPasswordHash, ADMIN_PASSWORD, sessionCookie } from './auth-helpers.js';
import { DESIGN_KIT, DESIGN_KIT_FILES, designKitManifest, designShopManifest } from './fixtures/design-kit/index.js';
import { LEGS } from './invoicing-install.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';

const PAGE = `${DESIGN_KIT}-setup`;
const FILES = { ...DESIGN_KIT_FILES, 'dist/pages/setup.js': 'export default function Setup() { return null; }\n' };

interface Row {
  addOnKey: string;
  ref: string;
  address?: string;
  installId?: string;
  connectionId?: string | null;
  connectionName?: string | null;
}

const shop = (key: 'maker' | 'printing') =>
  designShopManifest(key, {
    addOns: { suggests: [{ key: DESIGN_KIT, range: '^1.0.0', reason: { 'en-US': 'Shoppers design their products.' } }] },
    people: undefined,
    compatibility: { minAdminiumVersion: '0.3.44', engines: ['postgres', 'mysql', 'sqlite'] },
    roles: [
      { key: 'owner', name: 'Owner', permissions: ['table:@orders:read', `page:@${PAGE}:view`] },
      // Opens the set-up page and reads no table of the shop's database.
      { key: 'viewer', name: 'Viewer', permissions: [`page:@${PAGE}:view`] },
    ],
  });

describe.each(LEGS)('an add-on page with a copy of the add-on per app — %s', (dialect, available) => {
  let h: Harness;
  let served: Served;
  let kiln = '';
  let signIns = 0;
  const copies = { studio: '', kiln: '' };
  const people: Record<'admin' | 'maker' | 'print' | 'viewer', { cookie: string }> = {} as never;

  const person = async (email: string, slug: string) => {
    const user = await usersRepo(h.meta).create({ email, name: email.split('@')[0]!, passwordHash: await adminPasswordHash() });
    await rolesRepo(h.meta).assignToUser(user.id, (await rolesRepo(h.meta).findBySlug(slug))!.id);
    signIns += 1;
    const res = await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: `10.12.0.${String(signIns)}`, payload: { email, password: ADMIN_PASSWORD } });
    expect(res.statusCode, res.body).toBe(200);
    return { cookie: sessionCookie(res.headers['set-cookie']) };
  };
  const rows = async (who: { cookie: string }): Promise<Row[]> => {
    const res = await served.composed.app.inject({ method: 'GET', url: '/api/v1/bootstrap', headers: { cookie: who.cookie } });
    expect(res.statusCode, res.body).toBe(200);
    return ((res.json() as { data: { addOnNav?: { pages: Row[] } } }).data.addOnNav?.pages ?? []).filter((page) => page.addOnKey === DESIGN_KIT && page.ref === PAGE);
  };
  const kit = (who: { cookie: string }, install?: string) =>
    served.composed.app.inject({ method: 'GET', url: `/api/v1/add-ons/${DESIGN_KIT}/kit`, headers: { cookie: who.cookie, ...(install === undefined ? {} : { 'x-adminium-install': install }) } });

  beforeAll(async () => {
    if (!available) return;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    const made = designKitManifest({}, { panel: true }) as { addOn: Record<string, unknown> };
    made.addOn['hostApi'] = 2;
    made.addOn['pages'] = [{ ref: PAGE, title: { key: 'design-kit.page.setup', fallback: 'Design set-up' }, icon: 'settings-2', client: 'dist/pages/setup.js', nav: { group: 'library', order: 30 } }];
    await h.stageAddOn(made, { files: FILES });
    await h.stageApp(shop('maker'));
    await h.stageApp(shop('printing'));
    // One app first: the maker's shop, with its copy of the kit on the first database.
    const maker = await h.install('maker', '1.0.0', { addOns: [{ key: DESIGN_KIT, version: '1.0.0' }] });
    expect(maker.statusCode, maker.body).toBe(200);
    copies.studio = (await manifestsRepo(h.meta, CRYPTO).findInScope(DESIGN_KIT, h.connectionId))!.row.id;
    served = await servePublic(h as never, null, { ADMINIUM_DATA_DIR: h.dataDir });
    people.admin = await person('admin@shops.test', 'super-admin');
    people.maker = await person('owner@maker.test', 'maker-owner');
    people.viewer = await person('viewer@maker.test', 'maker-viewer');
  }, 240_000);
  afterAll(async () => {
    if (!available) return;
    await served?.close();
    await h?.close();
  });

  it.skipIf(!available)('with one app: one row, naming its install and no database, and the kit answers with or without it', async () => {
    // The viewer reads no table of the shop's database: it is not told which database that is.
    for (const who of [people.admin, people.maker, people.viewer]) {
      const listed = await rows(who);
      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({ address: DESIGN_KIT, installId: copies.studio });
      expect(listed[0]).not.toHaveProperty('connectionId');
      expect(listed[0]).not.toHaveProperty('connectionName');
      expect((await kit(who)).statusCode).toBe(200);
      expect((await kit(who, copies.studio)).statusCode).toBe(200);
    }
  });

  describe('with a second app holding its own copy', () => {
    beforeAll(async () => {
      if (!available) return;
      const file = join(h.dataDir, 'kiln.db');
      new BetterSqlite3(file).close();
      kiln = (await h.manager.connections.create({ name: 'Kiln', engine: 'sqlite', introspectDsn: `sqlite:${file}`, dataDsn: `sqlite:${file}` })).id;
      await runIntrospection({ manager: h.manager, meta: h.meta, connectionId: kiln });
      const printing = await h.install('printing', '1.0.0', { connectionId: kiln, addOns: [{ key: DESIGN_KIT, version: '1.0.0' }] });
      expect(printing.statusCode, printing.body).toBe(200);
      copies.kiln = (await manifestsRepo(h.meta, CRYPTO).findInScope(DESIGN_KIT, kiln))!.row.id;
      expect(copies.kiln).not.toBe(copies.studio);
      people.print = await person('owner@print.test', 'printing-owner');
    }, 240_000);

    it.skipIf(!available)('lists the page once per copy Super Admin reaches, each by its address, install and database', async () => {
      const listed = await rows(people.admin);
      expect(listed.map((row) => [row.address, row.installId, row.connectionId])).toEqual([
        [DESIGN_KIT, copies.studio, h.connectionId],
        [`${DESIGN_KIT}~kiln`, copies.kiln, kiln],
      ]);
      // Two rows of one page are told apart by their databases.
      expect(listed[1]!.connectionName).toBe('Kiln');
      expect(listed[0]!.connectionName).not.toBe('Kiln');
      expect(typeof listed[0]!.connectionName).toBe('string');
    });

    it.skipIf(!available)('names no database to a reader who reaches neither copy', async () => {
      const res = await served.composed.app.inject({ method: 'GET', url: '/api/v1/bootstrap', headers: { cookie: people.viewer.cookie } });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.body).not.toContain('Kiln');
      expect(res.body).not.toContain(kiln);
      for (const row of await rows(people.viewer)) {
        expect(row).not.toHaveProperty('connectionId');
        expect(row).not.toHaveProperty('connectionName');
      }
    });

    it.skipIf(!available)("lists each shop's owner their own copy alone", async () => {
      expect((await rows(people.maker)).map((row) => [row.address, row.installId])).toEqual([[DESIGN_KIT, copies.studio]]);
      expect((await rows(people.print)).map((row) => [row.address, row.installId])).toEqual([[`${DESIGN_KIT}~kiln`, copies.kiln]]);
    });

    it.skipIf(!available)('answers the kit for the install each row names', async () => {
      for (const [who, install] of [
        [people.admin, copies.studio],
        [people.admin, copies.kiln],
        [people.maker, copies.studio],
        [people.print, copies.kiln],
      ] as const) {
        const res = await kit(who, install);
        expect(res.statusCode, res.body).toBe(200);
      }
    });

    it.skipIf(!available)('with no copy named, counts every copy and names only those the reader reaches', async () => {
      const mine = await kit(people.maker);
      expect(mine.statusCode, mine.body).toBe(409);
      const refused = mine.json() as { error: { code: string; message: string; details: { installedOn: number; installs: { installId: string }[] } } };
      expect(refused.error.code).toBe('APP_INSTALL_AMBIGUOUS');
      expect(refused.error.message).toContain('installed on 2 databases (1 of them is yours to open)');
      expect(refused.error.details.installedOn).toBe(2);
      expect(refused.error.details.installs.map((one) => one.installId)).toEqual([copies.studio]);
      expect(mine.body).not.toContain(copies.kiln);
      const all = (await kit(people.admin)).json() as { error: { message: string; details: { installedOn: number; installs: unknown[] } } };
      expect(all.error.message).toContain('installed on 2 databases. Say which one');
      expect(all.error.details.installs).toHaveLength(2);
    });
  });
});
