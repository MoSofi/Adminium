// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN ADD-ON WITH A COPY ON EACH OF TWO DATABASES IS UPDATED COPY BY COPY.
 *
 * Two copies of a shop, each on its own database, each with its own copy of
 * the cards kit. The Add-ons page updates every copy in turn: each check and
 * each update names its copy (`X-Adminium-Install`), and one that names none
 * is answered with the copies to choose from. Every copy runs one version, so
 * the shop's update that needs the newer kit is refused while a copy is
 * behind (`ONE_VERSION_PER_APP`), and goes through, with no "Update it too",
 * once every copy has moved. The list names each copy's database.
 *
 * On every engine this run can reach.
 */
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { manifestsRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { runIntrospection } from '../src/connections/introspect.js';
import { addOnHarness, CRYPTO, type Harness } from './app-add-ons.helpers.js';
import { CARDS_KIT, cardsKitManifest, shopManifest } from './fixtures/cards-kit/index.js';
import { LEGS } from './invoicing-install.helpers.js';

describe.each(LEGS)('an add-on with a copy on each of two databases — %s', (dialect, available) => {
  let h: Harness;
  afterEach(async () => {
    if (available) await h.close();
  });

  it.skipIf(!available)('is updated copy by copy, each named, and the app follows once every copy has', async () => {
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    const file = join(h.dataDir, 'kiln.db');
    new BetterSqlite3(file).close();
    const kiln = (await h.manager.connections.create({ name: 'Kiln', engine: 'sqlite', introspectDsn: `sqlite:${file}`, dataDsn: `sqlite:${file}` })).id;
    await runIntrospection({ manager: h.manager, meta: h.meta, connectionId: kiln });

    await h.stageApp(shopManifest());
    await h.stageAddOn(cardsKitManifest());
    for (const connectionId of [h.connectionId, kiln]) {
      const shop = await h.install('shop', '1.0.0', { connectionId, addOns: [{ key: CARDS_KIT, version: '1.0.0' }] });
      expect(shop.statusCode, shop.body).toBe(200);
    }
    const copyOn = async (connectionId: string) => (await manifestsRepo(h.meta, CRYPTO).findInScope(CARDS_KIT, connectionId))!.row;
    const studio = (await copyOn(h.connectionId)).id;
    const kilnCopy = (await copyOn(kiln)).id;

    // The list names each copy's database.
    const listed = (await h.inject({ method: 'GET', url: '/add-ons' })).json().addOns as { key: string; installId: string; connectionName: string | null }[];
    expect(listed.filter((row) => row.key === CARDS_KIT).map((row) => [row.installId, row.connectionName]).sort()).toEqual(
      [
        [studio, expect.any(String)],
        [kilnCopy, 'Kiln'],
      ].sort(),
    );

    await h.stageAddOn(cardsKitManifest({ version: '1.0.1' }));
    await h.stageApp(shopManifest({ version: '1.0.1', addOns: { requires: [{ key: CARDS_KIT, range: '^1.0.1', reason: { 'en-US': 'Gift cards.' } }] } }));

    // The shop on the first database needs the kit at 1.0.1, and the other copy runs 1.0.0: its check says to
    // update every copy, and "Update it too" is refused before anything moves.
    const plan = await h.inject({ method: 'POST', url: '/apps/plan', payload: { key: 'shop', version: '1.0.1', connectionId: h.connectionId } });
    expect(plan.statusCode, plan.body).toBe(200);
    expect(plan.json().plan.installable).toBe(false);
    expect((plan.json().plan.addOns as { key: string; problems: { code: string }[] }[])[0]!.problems.map((problem) => problem.code)).toContain('ONE_VERSION_PER_APP');
    const tick = { addOns: [{ key: CARDS_KIT, version: '1.0.1', update: true }] };
    const behind = await h.inject({ method: 'POST', url: `/apps/shop/update?connectionId=${h.connectionId}`, payload: tick });
    expect(behind.statusCode, behind.body).toBe(422);
    expect(behind.body).toContain('every copy');
    expect((await copyOn(h.connectionId)).version).toBe('1.0.0');

    // A check that names no copy is asked which.
    const unnamed = await h.inject({ method: 'POST', url: `/add-ons/${CARDS_KIT}/update/plan`, payload: {} });
    expect(unnamed.statusCode, unnamed.body).toBe(409);
    expect(unnamed.json().error.code).toBe('APP_INSTALL_AMBIGUOUS');

    // Each copy, named: checked and updated on its own, on its own database.
    // The first database's copy first (the list's last row): while the other is behind, the list still offers the newer version.
    for (const [install, connectionId] of [
      [studio, h.connectionId],
      [kilnCopy, kiln],
    ] as const) {
      const check = await h.inject({ method: 'POST', url: `/add-ons/${CARDS_KIT}/update/plan`, payload: {}, headers: { 'x-adminium-install': install } });
      expect(check.statusCode, check.body).toBe(200);
      expect(check.json()).toMatchObject({ from: '1.0.0', to: '1.0.1', connectionId });
      const moved = await h.inject({ method: 'POST', url: `/add-ons/${CARDS_KIT}/update`, payload: { planChecksum: check.json().checksum }, headers: { 'x-adminium-install': install } });
      expect(moved.statusCode, moved.body).toBe(200);
      expect((await copyOn(connectionId)).version).toBe('1.0.1');
      if (install === studio) {
        expect((await copyOn(kiln)).version).toBe('1.0.0');
        const shelf = (await h.inject({ method: 'GET', url: '/add-ons/catalog' })).json().addOns as { key: string; version: string; upgradeTo: string | null }[];
        expect(shelf.find((row) => row.key === CARDS_KIT)).toMatchObject({ version: '1.0.0', upgradeTo: '1.0.1' });
      }
    }

    // Every copy moved: each shop updates with no tick, the kit already in range.
    for (const connectionId of [h.connectionId, kiln]) {
      const updated = await h.inject({ method: 'POST', url: `/apps/shop/update?connectionId=${connectionId}`, payload: {} });
      expect(updated.statusCode, updated.body).toBe(200);
    }
  }, 180_000);

  it.skipIf(!available)("an app's \"Update it too\" moves the copy on its own database, never asks which", async () => {
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    const file = join(h.dataDir, 'kiln.db');
    new BetterSqlite3(file).close();
    const kiln = (await h.manager.connections.create({ name: 'Kiln', engine: 'sqlite', introspectDsn: `sqlite:${file}`, dataDsn: `sqlite:${file}` })).id;
    await runIntrospection({ manager: h.manager, meta: h.meta, connectionId: kiln });
    await h.stageApp(shopManifest());
    await h.stageAddOn(cardsKitManifest());
    for (const connectionId of [h.connectionId, kiln]) {
      expect((await h.install('shop', '1.0.0', { connectionId, addOns: [{ key: CARDS_KIT, version: '1.0.0' }] })).statusCode).toBe(200);
    }
    const copyOn = async (connectionId: string) => (await manifestsRepo(h.meta, CRYPTO).findInScope(CARDS_KIT, connectionId))!.row;
    await h.stageAddOn(cardsKitManifest({ version: '1.0.1' }));
    await h.stageApp(shopManifest({ version: '1.0.1', addOns: { requires: [{ key: CARDS_KIT, range: '^1.0.1', reason: { 'en-US': 'Gift cards.' } }] } }));
    // The first database's copy moved on the Add-ons page; the second shop's update brings its own copy along.
    const install = (await copyOn(h.connectionId)).id;
    const check = await h.inject({ method: 'POST', url: `/add-ons/${CARDS_KIT}/update/plan`, payload: {}, headers: { 'x-adminium-install': install } });
    expect((await h.inject({ method: 'POST', url: `/add-ons/${CARDS_KIT}/update`, payload: { planChecksum: check.json().checksum }, headers: { 'x-adminium-install': install } })).statusCode).toBe(200);
    const updated = await h.inject({ method: 'POST', url: `/apps/shop/update?connectionId=${kiln}`, payload: { addOns: [{ key: CARDS_KIT, version: '1.0.1', update: true }] } });
    expect(updated.statusCode, updated.body).toBe(200);
    expect(updated.json().app.addOns.updated).toEqual([{ key: CARDS_KIT, name: 'Cards kit', from: '1.0.0', to: '1.0.1' }]);
    expect((await copyOn(kiln)).version).toBe('1.0.1');
    expect((await manifestsRepo(h.meta, CRYPTO).findInScope(CARDS_KIT, kiln))!.attachments.map((attachment) => attachment.attachedTo)).toEqual(['shop']);
  }, 180_000);
});
