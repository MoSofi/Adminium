// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN ADD-ON'S PUBLIC ENTRIES RIDE ITS APP'S KEY.
 *
 * The endpoints are the add-on's; the key is the app's. An entry goes on the
 * key only when somebody who may hand out API keys says so, and leaves it the
 * moment the add-on stops being there for the app — switched off, updated to
 * a version that drops it, removed — whoever does that and before the reply.
 * An update of the app keeps what the add-on gave it. On every engine this
 * run can reach.
 */
import { auditRepo, permissionsRepo, publicEndpointsRepo, publicKeysRepo, rolesRepo, usersRepo, type User } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { BALANCE_REF, CARDS_KIT, LINK_KEY, LINK_REF, cardsKitManifest, shopManifest } from './fixtures/cards-kit/index.js';
import { LEGS } from './invoicing-install.helpers.js';
import { servePublic } from './public-lane.helpers.js';

describe.each(LEGS)("an add-on's public entries on its app's key — %s", (dialect, available) => {
  let h: Harness;
  afterEach(async () => {
    if (available) await h.close();
  });

  /** The shop installed with its own public side; the cards kit staged. Answers the shop's key id. */
  const shop = async (): Promise<string> => {
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageApp(shopManifest());
    const installed = await h.install('shop', '1.0.0');
    expect(installed.statusCode, installed.body).toBe(200);
    await h.stageAddOn(cardsKitManifest());
    return installed.json().publicAccess.keyId as string;
  };
  const addOn = (extra: Record<string, unknown> = {}, as?: Parameters<Harness['inject']>[0]['as']) =>
    h.inject({ method: 'POST', url: '/add-ons', payload: { key: CARDS_KIT, version: '1.0.0', attachTo: ['shop'], ...extra }, ...(as === undefined ? {} : { as }) });
  /** The refs a key holds, sorted. */
  const held = async (keyId: string): Promise<string[]> => {
    const key = (await publicKeysRepo(h.meta).findById(keyId))!;
    const refs = new Map((await publicEndpointsRepo(h.meta).listByConnection(h.connectionId)).map((endpoint) => [endpoint.id, endpoint.ref]));
    const access = (typeof key.access === 'string' ? JSON.parse(key.access) : key.access) as Record<string, string[]>;
    return Object.keys(access).map((id) => refs.get(id) ?? id).sort();
  };
  const endpoints = async () => (await publicEndpointsRepo(h.meta).listByConnection(h.connectionId)).map((endpoint) => ({ ref: endpoint.ref, managedBy: endpoint.managedBy }));
  /** Someone who may install add-ons and may not hand out API keys. */
  const fitter = async (): Promise<User> => {
    const member = await usersRepo(h.meta).create({ email: 'fitter@test', name: 'Fitter' });
    const role = await rolesRepo(h.meta).create({ slug: 'fitter', name: 'Fitter' } as never);
    await permissionsRepo(h.meta).grant(role.id, 'system', 'manifests.manage', { allowed: true });
    await rolesRepo(h.meta).assignToUser(member.id, role.id);
    return member;
  };
  const audited = async (action: string) => (await auditRepo(h.meta).list({ limit: 200 })).filter((row) => row.action === action);

  it.skipIf(!available)('endpoints are the add-on\'s, the key the app\'s', async () => {
    const keyId = await shop();
    const res = await addOn({ publicAccess: true });
    expect(res.statusCode, res.body).toBe(200);
    // The endpoints belong to the add-on, whoever serves them.
    expect((await endpoints()).filter((endpoint) => endpoint.managedBy === CARDS_KIT).map((endpoint) => endpoint.ref).sort()).toEqual([LINK_REF, BALANCE_REF].sort());
    // The shop's key holds its own entry and the add-on's; never the link key's.
    expect(await held(keyId)).toEqual([BALANCE_REF, 'shop_products'].sort());
    expect((await publicKeysRepo(h.meta).findById(keyId))!.managedBy).toBe('shop');
    expect(res.json().publicAccessByApp).toEqual({ shop: { granted: [BALANCE_REF], withdrawn: [], skipped: [] } });
    expect((await audited('public-key.grant')).some((row) => JSON.stringify(row.changes).includes(BALANCE_REF))).toBe(true);
    // Its own link key: made on the same say, the add-on's, holding its one read.
    const link = (await publicKeysRepo(h.meta).listManagedBy(CARDS_KIT)).filter((key) => key.revokedAt === null);
    expect(link.map((key) => key.purpose)).toEqual([LINK_KEY]);
    expect(await held(link[0]!.id)).toEqual([LINK_REF]);
  });

  it.skipIf(!available)('served through the shop\'s key: a card opens by its code, and stops when the add-on is switched off', async () => {
    const keyId = await shop();
    expect((await addOn({ publicAccess: true })).statusCode).toBe(200);
    await h.rows(`INSERT INTO cards_kit_cards (id, code, status, balance) VALUES (1, 'GC-7K2M9QXA41TR', 'active', 50), (2, 'GC-3HHW8PZC65NE', 'active', 20)`);
    const read = async (typed: string) => {
      // A server of its own each time: what it answers is what the store says now, with nothing remembered.
      const served = await servePublic(h as never, keyId);
      try {
        return await served.composed.app.inject({ method: 'GET', url: `/api/v1/public/records/${BALANCE_REF}`, headers: served.headers(undefined, { 'x-adminium-code': typed }) });
      } finally {
        await served.close();
      }
    };
    const one = await read('GC-7K2M9QXA41TR');
    expect(one.statusCode, one.body).toBe(200);
    expect((one.json() as { data: { id: number }[] }).data.map((row) => Number(row.id))).toEqual([1]);
    // Switched off for the shop: off the key before the reply, and the door answers nothing.
    const off = await h.inject({ method: 'PATCH', url: `/add-ons/${CARDS_KIT}`, payload: { attachedTo: 'shop', enabled: false } });
    expect(off.statusCode, off.body).toBe(200);
    expect(off.json().publicAccess).toMatchObject({ withdrawn: [BALANCE_REF], granted: [] });
    expect(await held(keyId)).toEqual(['shop_products']);
    const after = await read('GC-7K2M9QXA41TR');
    expect(after.statusCode, after.body).not.toBe(200);
  });

  it.skipIf(!available)('attach without consent grants nothing and says so', async () => {
    const keyId = await shop();
    // Installed with no say: its endpoints are stored, and no key holds one.
    const res = await addOn();
    expect(res.statusCode, res.body).toBe(200);
    expect((await endpoints()).some((endpoint) => endpoint.ref === BALANCE_REF)).toBe(true);
    expect(await held(keyId)).toEqual(['shop_products']);
    expect(res.json().publicAccessByApp.shop).toMatchObject({ granted: [], skipped: [{ ref: BALANCE_REF }] });
    expect((await publicKeysRepo(h.meta).listManagedBy(CARDS_KIT)).length).toBe(0);
    // Attached again, still with no say: the same answer.
    const again = await h.inject({ method: 'POST', url: `/add-ons/${CARDS_KIT}/attachments`, payload: { app: 'shop' } });
    expect(again.statusCode, again.body).toBe(200);
    expect(again.json().publicAccess).toMatchObject({ granted: [], skipped: [{ ref: BALANCE_REF, reason: expect.stringContaining('publicAccess') }] });
    expect(await held(keyId)).toEqual(['shop_products']);
    // Said by someone who may not hand out keys: nothing, and the reason.
    const member = await fitter();
    const refused = await h.inject({ method: 'POST', url: `/add-ons/${CARDS_KIT}/attachments`, payload: { app: 'shop', publicAccess: true }, as: member });
    expect(refused.statusCode, refused.body).toBe(200);
    expect(refused.json().publicAccess).toMatchObject({ granted: [], skipped: [{ ref: BALANCE_REF, reason: expect.stringContaining('API keys') }] });
    expect(await held(keyId)).toEqual(['shop_products']);
    // Said by the owner: given.
    const given = await h.inject({ method: 'POST', url: `/add-ons/${CARDS_KIT}/attachments`, payload: { app: 'shop', publicAccess: true } });
    expect(given.json().publicAccess).toEqual({ granted: [BALANCE_REF], withdrawn: [], skipped: [] });
    expect(await held(keyId)).toEqual([BALANCE_REF, 'shop_products'].sort());
  });

  it.skipIf(!available)('an install that asks for public access by someone who may not hand out keys is refused before anything moves', async () => {
    await shop();
    const member = await fitter();
    const res = await addOn({ publicAccess: true }, member);
    expect(res.statusCode, res.body).toBe(403);
    expect(await h.tableNames()).not.toContain('cards_kit_cards');
    expect((await endpoints()).some((endpoint) => endpoint.managedBy === CARDS_KIT)).toBe(false);
  });

  it.skipIf(!available)('switch-off removes the entry before the reply; switched on again it comes back only when said', async () => {
    const keyId = await shop();
    expect((await addOn({ publicAccess: true })).statusCode).toBe(200);
    const before = h.invalidatedKeys.length;
    const off = await h.inject({ method: 'PATCH', url: `/add-ons/${CARDS_KIT}`, payload: { attachedTo: 'shop', enabled: false } });
    expect(off.statusCode, off.body).toBe(200);
    expect(await held(keyId)).toEqual(['shop_products']);
    expect((await audited('public-key.withdraw')).some((row) => JSON.stringify(row.changes).includes(BALANCE_REF))).toBe(true);
    // The resolver was told to forget the key: it does not serve the entry for another half minute.
    expect(h.invalidatedKeys.slice(before)).toContain(keyId);
    const on = await h.inject({ method: 'PATCH', url: `/add-ons/${CARDS_KIT}`, payload: { attachedTo: 'shop', enabled: true } });
    expect(on.json().publicAccess).toMatchObject({ granted: [], skipped: [{ ref: BALANCE_REF }] });
    expect(await held(keyId)).toEqual(['shop_products']);
    const said = await h.inject({ method: 'PATCH', url: `/add-ons/${CARDS_KIT}`, payload: { attachedTo: 'shop', enabled: false } });
    expect(said.statusCode).toBe(200);
    const back = await h.inject({ method: 'PATCH', url: `/add-ons/${CARDS_KIT}`, payload: { attachedTo: 'shop', enabled: true, publicAccess: true } });
    expect(back.json().publicAccess).toMatchObject({ granted: [BALANCE_REF] });
    expect(await held(keyId)).toEqual([BALANCE_REF, 'shop_products'].sort());
  });

  it.skipIf(!available)('an app update keeps the add-on\'s entry on the key, and one that stops naming the add-on takes it off', async () => {
    const keyId = await shop();
    expect((await addOn({ publicAccess: true })).statusCode).toBe(200);
    // A version that only adds a column: the key still holds what the add-on gave it.
    const next = shopManifest({ version: '1.0.1' });
    ((next['requiredSchema'] as { tables: { columns: unknown[] }[] }).tables[0]!.columns as unknown[]).push({ ref: 'sku', type: 'text', maxLength: 40, nullable: true });
    await h.stageApp(next);
    const updated = await h.inject({ method: 'POST', url: '/apps/shop/update', payload: { to: '1.0.1' } });
    expect(updated.statusCode, updated.body).toBe(200);
    expect(await held(keyId)).toEqual([BALANCE_REF, 'shop_products'].sort());
    // A version that no longer names the add-on: its entry leaves the key, whatever is allowed.
    const { addOns: _dropped, ...without } = shopManifest({ version: '1.0.2' });
    await h.stageApp(without);
    const last = await h.inject({ method: 'POST', url: '/apps/shop/update', payload: { to: '1.0.2', publicAccess: true } });
    expect(last.statusCode, last.body).toBe(200);
    expect(await held(keyId)).toEqual(['shop_products']);
  });

  it.skipIf(!available)('an update of the add-on that drops an entry takes it off the key and removes the endpoint', async () => {
    const keyId = await shop();
    expect((await addOn({ publicAccess: true })).statusCode).toBe(200);
    const link = (await publicKeysRepo(h.meta).listManagedBy(CARDS_KIT))[0]!;
    // 1.0.1 has no public side at all.
    const { publicAccess: _entries, publicKeys: _keys, ...bare } = cardsKitManifest({ version: '1.0.1' });
    await h.stageAddOn(bare);
    const res = await h.inject({ method: 'POST', url: `/add-ons/${CARDS_KIT}/update`, payload: { to: '1.0.1' } });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().publicAccessByApp).toEqual({ shop: { granted: [], withdrawn: [BALANCE_REF], skipped: [] } });
    expect(res.json().publicAccessRemoved).toEqual({ removed: expect.arrayContaining([BALANCE_REF, LINK_REF]), kept: [] });
    expect(await held(keyId)).toEqual(['shop_products']);
    expect((await endpoints()).some((endpoint) => endpoint.managedBy === CARDS_KIT)).toBe(false);
    expect((await publicKeysRepo(h.meta).findById(link.id))!.revokedAt).not.toBeNull();
  });

  it.skipIf(!available)('uninstall of the add-on narrows every app\'s key, removes its endpoints and revokes its link key', async () => {
    const keyId = await shop();
    expect((await addOn({ publicAccess: true })).statusCode).toBe(200);
    const link = (await publicKeysRepo(h.meta).listManagedBy(CARDS_KIT))[0]!;
    const gone = await h.inject({ method: 'DELETE', url: `/add-ons/${CARDS_KIT}` });
    expect(gone.statusCode, gone.body).toBe(200);
    expect(await held(keyId)).toEqual(['shop_products']);
    expect((await endpoints()).some((endpoint) => endpoint.managedBy === CARDS_KIT)).toBe(false);
    expect((await publicKeysRepo(h.meta).findById(link.id))!.revokedAt).not.toBeNull();
    expect(gone.json().removed).toMatchObject({ endpoints: 2, keys: 1 });
  });

  it.skipIf(!available)('the check says what each app would gain, and who may allow it', async () => {
    await shop();
    const plan = await h.inject({ method: 'POST', url: '/add-ons/plan', payload: { key: CARDS_KIT, version: '1.0.0', attachTo: ['shop'] } });
    expect(plan.statusCode, plan.body).toBe(200);
    expect(plan.json().publicAccess).toMatchObject({ byApp: { shop: { adds: [BALANCE_REF], held: [] } }, linkKey: LINK_KEY, canGrant: true });
    expect((plan.json().publicAccess.endpoints as { ref: string }[]).map((entry) => entry.ref).sort()).toEqual([LINK_REF, BALANCE_REF].sort());
    // Nothing was written by asking.
    expect((await endpoints()).some((endpoint) => endpoint.managedBy === CARDS_KIT)).toBe(false);
  });

  it.skipIf(!available)('the app\'s own check shows what an add-on it would bring serves through its key', async () => {
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageAddOn(cardsKitManifest());
    const plan = await h.plan(shopManifest());
    expect(plan.statusCode, plan.body).toBe(200);
    const listed = plan.json().plan.publicAccess.endpoints as { ref: string; owner: string }[];
    expect(listed.map((entry) => `${entry.owner}:${entry.ref}`).sort()).toEqual([`${CARDS_KIT}:${BALANCE_REF}`, 'shop:shop_products'].sort());
  });

  it.skipIf(!available)('another app\'s update that moves the add-on to a version without the entry takes it off THIS app\'s key too', async () => {
    const keyId = await shop();
    // A second app that names the kit, with a key of its own.
    const kiosk = shopManifest({ key: 'kiosk', name: 'Kiosk', pages: [{ ref: 'kiosk-home', template: 'page-dashboard', title: { key: 'mft.kiosk.page.home', fallback: 'Home' }, nav: { group: 'manifest:sample', icon: 'layout-dashboard', order: 1 } }] });
    await h.stageApp(kiosk);
    const second = await h.install('kiosk', '1.0.0');
    expect(second.statusCode, second.body).toBe(200);
    const kioskKey = second.json().publicAccess.keyId as string;
    expect((await h.inject({ method: 'POST', url: '/add-ons', payload: { key: CARDS_KIT, version: '1.0.0', attachTo: ['shop', 'kiosk'], publicAccess: true } })).statusCode).toBe(200);
    expect(await held(keyId)).toContain(BALANCE_REF);
    expect(await held(kioskKey)).toContain(BALANCE_REF);
    // The kiosk moves to a version that needs the kit at 1.0.1, which has no public side.
    const { publicAccess: _entries, publicKeys: _keys, ...bare } = cardsKitManifest({ version: '1.0.1' });
    await h.stageAddOn(bare);
    await h.stageApp({ ...kiosk, version: '1.0.1', addOns: { requires: [{ key: CARDS_KIT, range: '>=1.0.1', reason: { 'en-US': 'Gift cards.' } }] } });
    const updated = await h.inject({ method: 'POST', url: '/apps/kiosk/update', payload: { to: '1.0.1', addOns: [{ key: CARDS_KIT, version: '1.0.1', update: true }] } });
    expect(updated.statusCode, updated.body).toBe(200);
    // The shop asked for nothing and updated nothing: its key lost the entry all the same.
    expect(await held(keyId)).toEqual(['shop_products']);
    expect(await held(kioskKey)).toEqual(['kiosk_products']);
    expect((await endpoints()).some((endpoint) => endpoint.managedBy === CARDS_KIT)).toBe(false);
  });

  it.skipIf(!available)('an app whose stored manifest no longer reads still loses the add-on\'s entries at switch-off', async () => {
    const keyId = await shop();
    expect((await addOn({ publicAccess: true })).statusCode).toBe(200);
    await h.meta.db.updateTable('adminium_manifests').set({ manifest: JSON.stringify({ kind: 'app', key: 'shop' }) }).where('manifestKey', '=', 'shop').execute();
    const off = await h.inject({ method: 'PATCH', url: `/add-ons/${CARDS_KIT}`, payload: { attachedTo: 'shop', enabled: false } });
    expect(off.statusCode, off.body).toBe(200);
    expect(off.json().publicAccess.withdrawn).toEqual([BALANCE_REF]);
    expect(await held(keyId)).toEqual(['shop_products']);
  });

  it.skipIf(!available)('an endpoint of the same name that is the owner\'s is never written over, and never put on the key', async () => {
    const keyId = await shop();
    // The owner's own endpoint, made by hand before the add-on came, under the name the add-on would use.
    // A sound one (the shop's own products, read under another name): it could be granted, were it anybody's to grant.
    const products = (await publicEndpointsRepo(h.meta).findByRef(h.connectionId, 'shop_products'))!;
    const theirs = await publicEndpointsRepo(h.meta).create({
      connectionId: h.connectionId,
      ref: BALANCE_REF,
      definition: JSON.stringify({ ...(JSON.parse(products.definition) as Record<string, unknown>), path: `/${BALANCE_REF}` }),
      origin: 'custom',
    });
    const res = await addOn({ publicAccess: true });
    expect(res.statusCode, res.body).toBe(200);
    const after = (await publicEndpointsRepo(h.meta).findById(theirs.id))!;
    expect(after.definition).toBe(theirs.definition);
    expect(after.managedBy ?? null).toBeNull();
    expect(await held(keyId)).toEqual(['shop_products']);
    expect(JSON.stringify(res.json().publicAccess.skipped)).toContain('is not this add-on');
    expect(res.json().publicAccessByApp.shop).toMatchObject({ granted: [], skipped: [{ ref: BALANCE_REF }] });
  });
});
