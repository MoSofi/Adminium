// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN UPDATE THAT WIDENS A PUBLIC ENDPOINT A KEY ALREADY USES ASKS FIRST.
 *
 * A new version may show visitors a column the running one did not (a shop
 * page that now reads which app a ready-made design is for). The endpoint is
 * already on the app's own key, so saving it widens what that key reaches:
 * the operator's call, as a wider role grant is. The update's check lists
 * each such endpoint (`publicWider`), the update is refused before anything
 * moves unless it says `"publicWider": true`, only someone who may manage API
 * keys may say it, and the widening is audited. A narrowing, and an endpoint
 * that does not change, go through without a question.
 *
 * For an app's own endpoint, an add-on's (on the app's key and on its own
 * link key), and an app update that updates the add-on with it ("Update it
 * too"), on every engine this run can reach.
 */
import { auditRepo, manifestsRepo, permissionsRepo, publicEndpointsRepo, rolesRepo, usersRepo, type User } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { parseDefinition } from '../src/public-api/endpoint.js';
import { addOnHarness, CRYPTO, type Harness } from './app-add-ons.helpers.js';
import { BALANCE_REF, CARDS_KIT, LINK_REF, cardsKitManifest, shopManifest } from './fixtures/cards-kit/index.js';
import { LEGS } from './invoicing-install.helpers.js';
import { servePublic } from './public-lane.helpers.js';

/** The shop at `version`, its products read with `select`; the products table gains `sku` from 1.0.1 on. */
function shopAt(version: string, select: string[], over: Record<string, unknown> = {}): Record<string, unknown> {
  const made = shopManifest({ version, publicAccess: [{ table: 'products', methods: ['GET'], select }], ...over });
  if (version !== '1.0.0') {
    ((made['requiredSchema'] as { tables: { columns: unknown[] }[] }).tables[0]!.columns as unknown[]).push({ ref: 'sku', type: 'text', maxLength: 40, nullable: true });
  }
  return made;
}

/** The cards kit at `version`, its balance entry reading `balance` and its link entry reading `link`. */
function kitAt(version: string, balance: string[], link: string[]): Record<string, unknown> {
  const base = cardsKitManifest({ version }) as { publicAccess: Record<string, unknown>[] };
  return { ...base, publicAccess: [{ ...base.publicAccess[0], select: balance }, { ...base.publicAccess[1], select: link }] };
}

describe.each(LEGS)('an update that widens a public endpoint a key uses — %s', (dialect, available) => {
  let h: Harness;
  afterEach(async () => {
    if (available) await h.close();
  });

  const selectOf = async (ref: string): Promise<string[]> => {
    const row = (await publicEndpointsRepo(h.meta).findByRef(h.connectionId, ref))!;
    const parsed = parseDefinition(row.definition);
    if (!parsed.ok) throw new Error('unparseable');
    return parsed.definition.select;
  };
  const versionOf = async (key: string) => (await manifestsRepo(h.meta, CRYPTO).findInScope(key, h.connectionId))!.row.version;
  const audited = async (action: string) => (await auditRepo(h.meta).list({ limit: 300 })).filter((row) => row.action === action).map((row) => (row.changes as { after?: Record<string, unknown> }).after);
  /** Someone who may install and update apps and add-ons, and may not hand out API keys. */
  const fitter = async (): Promise<User> => {
    const member = await usersRepo(h.meta).create({ email: 'fitter@test', name: 'Fitter' });
    const role = await rolesRepo(h.meta).create({ slug: 'fitter', name: 'Fitter' } as never);
    await permissionsRepo(h.meta).grant(role.id, 'system', 'manifests.manage', { allowed: true });
    await rolesRepo(h.meta).assignToUser(member.id, role.id);
    return member;
  };

  it.skipIf(!available)("an app's update: listed on the check, refused unless allowed, saved and audited when allowed", async () => {
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageApp(shopAt('1.0.0', ['id', 'name']));
    const installed = await h.install('shop', '1.0.0');
    expect(installed.statusCode, installed.body).toBe(200);
    const keyId = installed.json().publicAccess.keyId as string;

    // 1.0.1 shows `price` and the new `sku` to the visitors the shop's key already serves.
    await h.stageApp(shopAt('1.0.1', ['id', 'name', 'price', 'sku']));
    const plan = await h.inject({ method: 'POST', url: '/apps/plan', payload: { key: 'shop', version: '1.0.1', connectionId: h.connectionId } });
    expect(plan.statusCode, plan.body).toBe(200);
    expect(plan.json().plan.publicWider).toEqual([
      { ref: 'shop_products', owner: 'shop', columns: ['price', 'sku'], methods: [], rows: false, reasons: [expect.stringContaining('would see more of "shop_products"')] },
    ]);

    // Not allowed: refused, naming the endpoint, before anything moves.
    const refused = await h.inject({ method: 'POST', url: '/apps/shop/update', payload: { publicAccess: true } });
    expect(refused.statusCode, refused.body).toBe(422);
    expect(refused.json().error.details).toMatchObject({ reason: 'PUBLIC_WIDER', publicWider: [{ ref: 'shop_products', columns: ['price', 'sku'] }] });
    expect(refused.json().error.message).toContain('"shop_products" would show price, sku');
    expect(await versionOf('shop')).toBe('1.0.0');
    expect(await selectOf('shop_products')).toEqual(['id', 'name']);
    expect((await h.tableNames()).length).toBeGreaterThan(0);

    // Allowed by someone who may not hand out API keys: refused all the same.
    const member = await fitter();
    const notTheirs = await h.inject({ method: 'POST', url: '/apps/shop/update', payload: { publicWider: true }, as: member });
    expect(notTheirs.statusCode, notTheirs.body).toBe(403);
    expect(await versionOf('shop')).toBe('1.0.0');

    // Allowed: saved as the version defines it, and the key serves the new columns.
    const updated = await h.inject({ method: 'POST', url: '/apps/shop/update', payload: { publicWider: true } });
    expect(updated.statusCode, updated.body).toBe(200);
    expect(await versionOf('shop')).toBe('1.0.1');
    expect(await selectOf('shop_products')).toEqual(['id', 'name', 'price', 'sku']);
    expect(updated.json().app.publicAccess.skipped).toEqual([]);
    expect(await audited('public-endpoint.widen')).toEqual([{ connectionId: h.connectionId, ref: 'shop_products', app: 'shop', columns: ['price', 'sku'], methods: [], rows: false }]);
    await h.rows(`INSERT INTO shop_products (id, name, price, sku) VALUES (1, 'Mug', 9.5, 'MUG-1')`);
    const served = await servePublic(h as never, keyId);
    try {
      const read = await served.composed.app.inject({ method: 'GET', url: '/api/v1/public/records/shop_products', headers: served.headers() });
      expect(read.statusCode, read.body).toBe(200);
      expect((read.json() as { data: Record<string, unknown>[] }).data[0]).toMatchObject({ name: 'Mug', sku: 'MUG-1' });
    } finally {
      await served.close();
    }

    // A narrowing, and a version that changes no endpoint: no question, no refusal.
    await h.stageApp(shopAt('1.0.2', ['id', 'name']));
    const narrowPlan = await h.inject({ method: 'POST', url: '/apps/plan', payload: { key: 'shop', version: '1.0.2', connectionId: h.connectionId } });
    expect(narrowPlan.json().plan).not.toHaveProperty('publicWider');
    const narrowed = await h.inject({ method: 'POST', url: '/apps/shop/update', payload: {} });
    expect(narrowed.statusCode, narrowed.body).toBe(200);
    expect(await selectOf('shop_products')).toEqual(['id', 'name']);
    await h.stageApp(shopAt('1.0.3', ['id', 'name']));
    const same = await h.inject({ method: 'POST', url: '/apps/shop/update', payload: {} });
    expect(same.statusCode, same.body).toBe(200);
    expect(await audited('public-endpoint.widen')).toHaveLength(1);
  }, 120_000);

  it.skipIf(!available)("an add-on's update: its entry on the app's key and on its own link key", async () => {
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageApp(shopManifest());
    expect((await h.install('shop', '1.0.0')).statusCode).toBe(200);
    await h.stageAddOn(kitAt('1.0.0', ['id', 'balance'], ['id', 'balance']));
    const added = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: CARDS_KIT, version: '1.0.0', attachTo: ['shop'], publicAccess: true } });
    expect(added.statusCode, added.body).toBe(200);

    // 1.0.1 shows the card's label through both doors.
    await h.stageAddOn(kitAt('1.0.1', ['id', 'balance', 'label'], ['id', 'balance', 'label']));
    const plan = await h.inject({ method: 'POST', url: `/add-ons/${CARDS_KIT}/update/plan`, payload: {} });
    expect(plan.statusCode, plan.body).toBe(200);
    expect((plan.json().publicWider as { ref: string; owner: string; columns: string[] }[]).map((entry) => [entry.ref, entry.owner, entry.columns]).sort()).toEqual(
      [
        [BALANCE_REF, CARDS_KIT, ['label']],
        [LINK_REF, CARDS_KIT, ['label']],
      ].sort(),
    );

    const refused = await h.inject({ method: 'POST', url: `/add-ons/${CARDS_KIT}/update`, payload: { planChecksum: plan.json().checksum } });
    expect(refused.statusCode, refused.body).toBe(422);
    expect(refused.json().error.details.reason).toBe('PUBLIC_WIDER');
    expect(await versionOf(CARDS_KIT)).toBe('1.0.0');
    expect(await selectOf(BALANCE_REF)).toEqual(['id', 'balance']);

    const member = await fitter();
    const notTheirs = await h.inject({ method: 'POST', url: `/add-ons/${CARDS_KIT}/update`, payload: { publicWider: true }, as: member });
    expect(notTheirs.statusCode, notTheirs.body).toBe(403);
    expect(await versionOf(CARDS_KIT)).toBe('1.0.0');

    const updated = await h.inject({ method: 'POST', url: `/add-ons/${CARDS_KIT}/update`, payload: { publicWider: true } });
    expect(updated.statusCode, updated.body).toBe(200);
    expect(await versionOf(CARDS_KIT)).toBe('1.0.1');
    expect(await selectOf(BALANCE_REF)).toEqual(['id', 'balance', 'label']);
    expect(await selectOf(LINK_REF)).toEqual(['id', 'balance', 'label']);
    expect((await audited('public-endpoint.widen')).map((after) => [after?.['ref'], after?.['columns']]).sort()).toEqual(
      [
        [BALANCE_REF, ['label']],
        [LINK_REF, ['label']],
      ].sort(),
    );

    // Narrowed again: no question.
    await h.stageAddOn(kitAt('1.0.2', ['id', 'balance'], ['id', 'balance', 'label']));
    const narrowed = await h.inject({ method: 'POST', url: `/add-ons/${CARDS_KIT}/update`, payload: {} });
    expect(narrowed.statusCode, narrowed.body).toBe(200);
    expect(await selectOf(BALANCE_REF)).toEqual(['id', 'balance']);
  }, 120_000);

  it.skipIf(!available)('an app update that updates the add-on with it ("Update it too") asks for both', async () => {
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageApp(shopManifest());
    expect((await h.install('shop', '1.0.0')).statusCode).toBe(200);
    await h.stageAddOn(kitAt('1.0.0', ['id', 'balance'], ['id', 'balance']));
    expect((await h.inject({ method: 'POST', url: '/add-ons', payload: { key: CARDS_KIT, version: '1.0.0', attachTo: ['shop'], publicAccess: true } })).statusCode).toBe(200);

    // Shop 1.0.1 needs the kit at 1.0.1, which shows the card's label.
    await h.stageAddOn(kitAt('1.0.1', ['id', 'balance', 'label'], ['id', 'balance']));
    await h.stageApp(shopManifest({ version: '1.0.1', addOns: { requires: [{ key: CARDS_KIT, range: '^1.0.1', reason: { 'en-US': 'Gift cards.' } }] } }));
    const plan = await h.inject({ method: 'POST', url: '/apps/plan', payload: { key: 'shop', version: '1.0.1', connectionId: h.connectionId } });
    expect(plan.statusCode, plan.body).toBe(200);
    expect((plan.json().plan.addOns as { key: string; action: string; offeredVersion: string }[]).map((row) => [row.key, row.action, row.offeredVersion])).toEqual([[CARDS_KIT, 'update', '1.0.1']]);
    expect((plan.json().plan.publicWider as { ref: string; owner: string }[]).map((entry) => [entry.ref, entry.owner])).toEqual([[BALANCE_REF, CARDS_KIT]]);

    // The tick missing: the add-on's own refusal.
    const untick = await h.inject({ method: 'POST', url: '/apps/shop/update', payload: {} });
    expect(untick.statusCode, untick.body).toBe(422);
    expect(untick.json().error.code).toBe('ADD_ON_REQUIRED');
    // Ticked, and the widening not allowed: refused before either moves.
    const tick = { addOns: [{ key: CARDS_KIT, version: '1.0.1', update: true }] };
    const refused = await h.inject({ method: 'POST', url: '/apps/shop/update', payload: tick });
    expect(refused.statusCode, refused.body).toBe(422);
    expect(refused.json().error.details).toMatchObject({ reason: 'PUBLIC_WIDER', publicWider: [{ ref: BALANCE_REF, owner: CARDS_KIT, columns: ['label'] }] });
    expect(await versionOf('shop')).toBe('1.0.0');
    expect(await versionOf(CARDS_KIT)).toBe('1.0.0');

    const updated = await h.inject({ method: 'POST', url: '/apps/shop/update', payload: { ...tick, publicWider: true } });
    expect(updated.statusCode, updated.body).toBe(200);
    expect(await versionOf('shop')).toBe('1.0.1');
    expect(await versionOf(CARDS_KIT)).toBe('1.0.1');
    expect(await selectOf(BALANCE_REF)).toEqual(['id', 'balance', 'label']);
    expect((await audited('public-endpoint.widen')).map((after) => after?.['ref'])).toContain(BALANCE_REF);
  }, 120_000);
});
