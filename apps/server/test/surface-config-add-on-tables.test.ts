// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT AN APP'S SCREENS LEARN OF AN ADD-ON'S TABLES AND LINK KEY.
 *
 *  - the STAFF config names each attached, switched-on add-on's tables as
 *    they are really called here — from its records, never built from a
 *    prefix;
 *  - the CUSTOMER config, which is public, carries the add-on's own link key
 *    (a handle that opens nothing without a row's link) and nothing else;
 *  - an add-on switched off for the app gives neither.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { applyClassification, parseDatabaseModel } from '@adminium/engine';
import { appTablesRepo, connectionsRepo, manifestsRepo, publicKeysRepo, publicScopesRepo, snapshotsRepo } from '@adminium/meta';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { discoverSurfaces, type HostedSurface } from '../src/cli/surfaces-root.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { generatePublishableKey, sealPublishableKey } from '../src/public-api/keys.js';
import { buildAuthApp, login, type AuthTestApp } from './auth-helpers.js';
import { makeEnv } from './helpers.js';

const IDENTITY = { encrypt: (v: string) => v, decrypt: (v: string) => v };
const table = (name: string) => ({
  schema: 'public',
  name,
  primaryKey: ['id'],
  columns: [{ name: 'id', logicalType: 'integer', nullable: false, isPrimaryKey: true, default: { kind: 'autoincrement' } }],
});

let dist: string;
let surfacesDir: string;
let surfaces: HostedSurface[];
let t: AuthTestApp | undefined;

beforeAll(async () => {
  dist = await mkdtemp(join(tmpdir(), 'adminium-dash-'));
  await writeFile(join(dist, 'index.html'), '<!doctype html><body data-app="dashboard"></body>', 'utf8');
  surfacesDir = await mkdtemp(join(tmpdir(), 'adminium-surfaces-'));
  for (const side of ['staff', 'customer']) {
    await mkdir(join(surfacesDir, 'shop', side), { recursive: true });
    await writeFile(join(surfacesDir, 'shop', side, 'index.html'), `<body data-app="shop-${side}"></body>`, 'utf8');
  }
  surfaces = discoverSurfaces(surfacesDir);
});
afterAll(async () => {
  await rm(dist, { recursive: true, force: true });
  await rm(surfacesDir, { recursive: true, force: true });
});
afterEach(async () => {
  await t?.destroy();
  t = undefined;
});

/** The shop, the cards kit attached to it with its tables recorded under the names an owner's rename left them with, and both keys. */
async function seed(fixture: AuthTestApp, opts: { enabled?: boolean } = {}) {
  const crypto = dsnCryptoFromSecret(makeEnv().ADMINIUM_SECRET);
  const conn = await connectionsRepo(fixture.meta, crypto).create({ name: 'src', engine: 'postgres', introspectDsn: 'postgres://ro:s@db/prod', dataDsn: 'postgres://rw:s@db/prod' });
  const repo = manifestsRepo(fixture.meta, IDENTITY);
  await repo.install({ manifestKey: 'shop', version: '1.0.0', kind: 'app', source: 'file', connectionId: conn.id, document: { name: 'Shop' } });
  const addOn = await repo.install({
    manifestKey: 'cards-kit',
    version: '1.0.0',
    kind: 'add-on',
    source: 'marketplace',
    connectionId: conn.id,
    document: { name: 'Cards kit', requiredSchema: { prefixed: true, tables: [{ ref: 'cards' }, { ref: 'notes' }] } },
    attachTo: ['shop'],
  });
  if (opts.enabled === false) await repo.setAttachmentEnabled(addOn.row.id, 'shop', false);
  const records = appTablesRepo(fixture.meta);
  await records.record({ appKey: 'shop', manifestId: null, connectionId: conn.id, ref: 'products', tableName: 'shop_products', owned: true, state: 'created', prefix: 'shop_' });
  await records.record({ appKey: 'cards-kit', manifestId: addOn.row.id, connectionId: conn.id, ref: 'cards', tableName: 'cards_kit_cards', owned: true, state: 'created', prefix: 'cards_kit_' });
  // Renamed by the owner since: the record follows the table, and a name built from the prefix would be wrong.
  await records.record({ appKey: 'cards-kit', manifestId: addOn.row.id, connectionId: conn.id, ref: 'notes', tableName: 'card_remarks', owned: true, state: 'created', prefix: 'cards_kit_' });
  const model = applyClassification(
    parseDatabaseModel({ dialect: 'postgres', name: 'shop', defaultSchema: 'public', schemas: ['public'], tables: ['shop_products', 'cards_kit_cards', 'card_remarks'].map(table), relations: [] }),
  );
  await snapshotsRepo(fixture.meta).create({ connectionId: conn.id, source: 'introspection', schema: model, checksum: 'c1' } as never);
  const scope = await publicScopesRepo(fixture.meta).create({ connectionId: conn.id, side: 'customer', name: 'shop', timezone: 'Europe/London', document: JSON.stringify({ version: 1 }) });
  // The add-on's key has a scope of its own, derived for it, as the key an install makes does.
  const linkScope = await publicScopesRepo(fixture.meta).create({ connectionId: conn.id, side: 'customer', name: 'cards link', timezone: 'Europe/London', document: JSON.stringify({ version: 1 }), derivedForKey: 'cards-link' } as never);
  const make = async (name: string, more: Record<string, unknown>) => {
    const generated = generatePublishableKey();
    await publicKeysRepo(fixture.meta).create({ name, prefix: generated.prefix, tokenHash: generated.tokenHash, tokenEncrypted: sealPublishableKey(crypto, generated.token), scopeId: scope.id, side: 'customer', ...more } as never);
    return generated.token;
  };
  await make('shop key', { appKey: 'shop', managedBy: 'shop' });
  const link = await make('cards link', { appKey: 'cards-kit', managedBy: 'cards-kit', purpose: 'cards-link', scopeId: linkScope.id });
  fixture.app.surfaceSettings?.invalidate();
  return { conn, link };
}

describe("an add-on's tables and link key in its app's surface config", () => {
  it('the staff config names an attached add-on\'s real tables', async () => {
    t = await buildAuthApp({ staticRoot: dist, surfaces });
    await seed(t);
    const { cookie } = await login(t.app);
    const staff = await t.app.inject({ method: 'GET', url: '/apps/shop/staff/surface-config.json', headers: { cookie: cookie! } });
    expect(staff.statusCode, staff.body).toBe(200);
    // By its records: `notes` is `card_remarks` here, not `cards_kit_notes`.
    expect(staff.json().addOns['cards-kit'].tables).toEqual({ cards: 'cards_kit_cards', notes: 'card_remarks' });
    expect(staff.body).not.toContain('cards_kit_notes');
    expect(staff.json().tables).toEqual({ products: 'shop_products' });
  });

  it('the customer config carries the add-on\'s link key and nothing else of it', async () => {
    t = await buildAuthApp({ staticRoot: dist, surfaces });
    const { link } = await seed(t);
    const customer = await t.app.inject({ method: 'GET', url: '/apps/shop/customer/surface-config.json' });
    expect(customer.statusCode, customer.body).toBe(200);
    expect(customer.json().addOns).toEqual({ 'cards-kit': { present: true, keys: { 'cards-link': link } } });
    expect(customer.body).not.toContain('card_remarks');
  });

  it('a link key that was revoked is not handed out', async () => {
    t = await buildAuthApp({ staticRoot: dist, surfaces });
    const { link } = await seed(t);
    const key = (await publicKeysRepo(t.meta).listManagedBy('cards-kit'))[0]!;
    await publicKeysRepo(t.meta).revoke(key.id);
    t.app.surfaceSettings?.invalidate();
    const customer = await t.app.inject({ method: 'GET', url: '/apps/shop/customer/surface-config.json' });
    expect(customer.json().addOns).toEqual({ 'cards-kit': { present: true } });
    expect(customer.body).not.toContain(link);
  });

  it('a switched-off add-on lists none', async () => {
    t = await buildAuthApp({ staticRoot: dist, surfaces });
    const { link } = await seed(t, { enabled: false });
    const { cookie } = await login(t.app);
    const staff = await t.app.inject({ method: 'GET', url: '/apps/shop/staff/surface-config.json', headers: { cookie: cookie! } });
    expect(staff.json()).not.toHaveProperty('addOns');
    const customer = await t.app.inject({ method: 'GET', url: '/apps/shop/customer/surface-config.json' });
    expect(customer.json()).not.toHaveProperty('addOns');
    expect(customer.body).not.toContain(link);
  });
});
