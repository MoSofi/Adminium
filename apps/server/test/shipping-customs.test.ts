// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A PARCEL GOING ABROAD on the real server, on SQLite, Postgres and MySQL, with
 * a fake carrier in-process (no network), real orders and real people:
 *
 *  - a shop that has not been set up is refused, exactly as before;
 *  - who lacks the customs right can neither quote nor buy nor read the invoice;
 *  - what is declared is read from the order, and a changed order voids a quote;
 *  - the owner stays the named signer, and the audit row says who ticked.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { manifestsRepo, permissionsRepo, rolesRepo, shippingBookingsRepo, shippingRepo, settingsRepo, usersRepo, type ManifestsRepo } from '@adminium/meta';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { addOnCredentialCryptoFromSecret } from '../src/add-ons/credential-crypto.js';
import { composeServer, type ComposedServer } from '../src/compose.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import { matrixRowsFromGrants } from '../src/rbac/permissions.js';
import { cleanInternational, declarationOf, draftOf, exporterFor, filingCodeFor, hsDigits, internationalBody, orderFactsOf, type GoodsLine, type InternationalSettings, type OrderFacts } from '../src/shipping/customs.js';
import { accountFingerprintOf, credentialHash } from '../src/shipping/fingerprint.js';
import { ShippingRefusal } from '../src/shipping/refusals.js';
import { addOnHarness, addOnManifest, type Harness } from './app-add-ons.helpers.js';
import { adminPasswordHash, ADMIN_PASSWORD, sessionCookie } from './auth-helpers.js';
import { makeEnv, TEST_SECRET } from './helpers.js';
import { LEGS } from './invoicing-install.helpers.js';

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- a reply read freely

const SHIP_FROM = { name: 'Marlow Press', lines: ['1 Mill Yard'], city: 'Marlow', postcode: 'SL7 1AA', country: 'GB', phone: '+44 1628 000000' };
const PARCEL = { weightKg: 1.25, lengthCm: 30, widthCm: 20, heightCm: 10, contents: 'Printed cards' };
const RATE = { code: 'dpd-classic', service: 'DPD Classic', amount: 14.2, amountDecimal: '14.20', currency: 'GBP', ref: 'carrier-handle', carrierToken: 'dpd_uk', carrier: 'DPD', handover: 'unknown' };
const SHIPMENT = { id: 'carrier-shipment', tracking: 'TRK-77', labelFileId: 'carrier-label', carrier: 'DPD', rate: RATE, carrierToken: 'dpd_uk', test: false, documents: [{ kind: 'label' }, { kind: 'customs-invoice' }] };
const PHONE = '+49 30 1234567';
const EMAIL = 'kund@example.com';
const PDF = new TextEncoder().encode('%PDF-1.4 sample');
const KEY = 'test-carrier-value';

interface Fake {
  quotes: { to: Doc; options: Doc }[];
  books: { details: Doc }[];
  fetches: string[];
  made: number;
}
const globals = globalThis as unknown as { __customsFake?: Fake };
const fake = (): Fake => globals.__customsFake!;

const serverJs = `export function createShippingCarrier() {
  const fake = globalThis.__customsFake;
  fake.made += 1;
  return {
    key: 'carrier-one',
    quote: async (parcel, from, to, options) => { fake.quotes.push({ to, options }); return [${JSON.stringify(RATE)}]; },
    book: async (rate, order, details) => { fake.books.push({ details }); return ${JSON.stringify(SHIPMENT)}; },
    recover: async () => ({ outcome: 'no-match' }),
    fetchDocument: async (id, kind) => { fake.fetches.push(kind); return { kind, mediaType: 'application/pdf', bytes: new TextEncoder().encode('%PDF-1.4 sample') }; },
    track: async () => [],
    label: async () => { throw new Error('never in these tests'); },
    cancel: async () => undefined,
    checkCredentials: async () => ({ outcome: 'ok', mode: 'live', carriers: ['DPD'] }),
  };
}
`;

const text = (ref: string, maxLength = 120) => ({ ref, type: 'text', maxLength, nullable: true });

function shopDoc(key: string, customs: boolean): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key,
    name: key,
    version: '1.0.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'AGPL-3.0-only',
    description: { key: 'd', fallback: 'A shop.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: customs ? '0.3.74' : '0.3.72', engines: ['postgres', 'mysql', 'sqlite'] },
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'products', columns: [{ ref: 'id', type: 'int', role: 'pk' }, text('code', 40)] },
        {
          ref: 'orders',
          states: { column: 'status', initial: 'placed', moves: { placed: ['cancelled'] } },
          columns: [
            { ref: 'id', type: 'int', role: 'pk' },
            text('number', 40),
            text('ship_name'),
            text('ship_line1'),
            text('ship_city'),
            text('ship_postcode', 20),
            text('ship_country', 40),
            text('ship_phone', 40),
            text('ship_email'),
            text('tracking', 64),
            text('carrier_name', 80),
            { ref: 'status', type: 'enum', enum: ['placed', 'cancelled'], default: 'placed', nullable: true },
            { ref: 'refunded', type: 'decimal', scale: 'currency', nullable: true },
          ],
        },
        {
          ref: 'order_lines',
          columns: [
            { ref: 'id', type: 'int', role: 'pk' },
            { ref: 'order_id', type: 'fk', references: 'orders' },
            { ref: 'product_id', type: 'fk', references: 'products', nullable: true },
            text('name'),
            { ref: 'qty', type: 'int', nullable: true },
            { ref: 'unit_price', type: 'decimal', scale: 'currency', nullable: true },
            { ref: 'grams', type: 'int', nullable: true },
            text('cancelled_at'),
            { ref: 'stage', type: 'enum', enum: ['make', 'ready', 'cancelled'], nullable: true },
          ],
        },
      ],
    },
    roles: [
      { key: 'picker', name: 'Picker', permissions: ['table:@orders:read', 'shipping:@:book'] },
      { key: 'declarer', name: 'Declarer', permissions: ['table:@orders:read', 'shipping:@:book', 'shipping:@:customs'] },
    ],
    pages: [{ ref: `${key}-orders`, template: 'page-crud', title: { key: 't', fallback: 'Orders' }, nav: { group: 'shop', icon: 'home', order: 1 }, bindings: { rows: 'orders' } }],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
    shipping: {
      orders: [
        {
          table: 'orders',
          reference: 'number',
          tracking: 'tracking',
          carrier: 'carrier_name',
          address: { name: 'ship_name', lines: ['ship_line1'], city: 'ship_city', postcode: 'ship_postcode', country: 'ship_country', phone: 'ship_phone', email: 'ship_email' },
          ...(customs
            ? { customs: { lines: { table: 'order_lines', order: 'order_id', quantity: 'qty', unitValue: 'unit_price', description: 'name', unitWeight: 'grams', weightUnit: 'g', product: { column: 'product_id', table: 'products', sku: 'code' }, unlessSet: 'cancelled_at', unless: { column: 'stage', in: ['cancelled'] } }, refunded: 'refunded' } }
            : {}),
        },
      ],
    },
  };
}

const carrierDoc = () =>
  addOnManifest('carrier-one', {
    categories: ['delivery'],
    capabilities: ['outbound-http'],
    settings: [{ key: 'api_key', type: 'string', secret: true }],
    addOn: { provides: [{ contract: 'shipping-carrier', version: 1, server: 'dist/server.js' }], network: { allow: ['api.carrier.example'] } },
  });

const SETUP = { countries: ['DE', 'US'], currency: 'GBP', originCountry: 'GB', hsCode: '4909.00', description: 'Printed greeting cards' };

describe.each(LEGS)('a parcel going abroad on %s', (dialect, available) => {
  let h: Harness;
  let composed: ComposedServer;
  let root: string;
  let repo: ManifestsRepo;
  let conn = '';
  let trusted: string | undefined;
  let signIns = 0;
  let nextId = 500;
  const installs: Record<string, string> = {};
  const tables: Record<string, string> = {};
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const call = (who: string, method: 'GET' | 'PUT' | 'POST', path: string, payload?: unknown, query = '') =>
    composed.app.inject({ method, url: `/api/v1/apps/${path}?connectionId=${encodeURIComponent(conn)}${query}`, headers: { cookie: cookies[who]! }, ...(payload === undefined ? {} : { payload: payload as Doc }) });
  const code = (res: { json(): unknown }) => (res.json() as Doc)['error']?.code as string | undefined;
  const settings = () => shippingRepo(h.meta);
  const quoteBody = (id: string, over: Doc = {}) => ({ source: { table: 'orders', id }, parcel: PARCEL, ...over });
  const ticked = { customs: { certified: true } };
  const quote = (id: string, over: Doc = {}, who = 'boss', app = 'shop') => call(who, 'POST', `${app}/shipping/quotes`, quoteBody(id, over));
  const setUp = (over: Doc = {}, who = 'boss') => call(who, 'PUT', 'shop/shipping/international', { ...SETUP, ...over });
  const form = (id: string, who = 'boss') => call(who, 'GET', 'shop/shipping/customs', undefined, `&table=orders&id=${id}`);

  async function order(over: Doc = {}, lines: Doc[] = [{ name: 'Thank-you cards', qty: 3, unit_price: '19.99', grams: 100, product_id: 1 }], app = 'shop'): Promise<string> {
    nextId += 1;
    const { db } = await h.manager.data(conn);
    await db
      .insertInto(tables[`${app}:orders`]! as never)
      .values({ id: nextId, number: `MP-${String(nextId)}`, ship_name: 'Kund', ship_line1: 'Hauptstr. 1', ship_city: 'Berlin', ship_postcode: '10115', ship_country: 'DE', ship_phone: PHONE, ship_email: EMAIL, ...over } as never)
      .execute();
    for (const line of lines) {
      nextId += 1;
      await db.insertInto(tables[`${app}:order_lines`]! as never).values({ id: nextId, order_id: nextId - 1 - lines.indexOf(line), ...line } as never).execute();
    }
    return String(nextId - lines.length);
  }

  async function firstLine(orderId: string): Promise<{ id: number }> {
    const { db } = await h.manager.data(conn);
    const row = await db.selectFrom(tables['shop:order_lines']! as never).select('id' as never).where('order_id' as never, '=', Number(orderId) as never).executeTakeFirstOrThrow();
    return row as { id: number };
  }

  async function person(key: string, roleSlugs: string[], grants: string[] = []): Promise<void> {
    const user = await usersRepo(h.meta).create({ email: `${key}@press.example`, name: `${key} name`, passwordHash: await adminPasswordHash() });
    ids[key] = user.id;
    for (const slug of roleSlugs) await rolesRepo(h.meta).assignToUser(user.id, (await rolesRepo(h.meta).findBySlug(slug))!.id);
    if (grants.length > 0) {
      const role = await rolesRepo(h.meta).create({ slug: `ship-${key}`, name: `Ship ${key}` });
      for (const row of matrixRowsFromGrants(grants).rows) await permissionsRepo(h.meta).grant(role.id, row.resourceKind, row.resourceRef, row.actions as never);
      await rolesRepo(h.meta).assignToUser(user.id, role.id);
    }
    signIns += 1;
    const res = await composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: `10.9.1.${String(signIns)}`, payload: { email: `${key}@press.example`, password: ADMIN_PASSWORD } });
    expect(res.statusCode, res.body).toBe(200);
    cookies[key] = sessionCookie(res.headers['set-cookie']);
  }

  const limits = (packersAbroad: boolean) => settings().setLimits({ installId: installs['shop']!, labelLimit: '50', labelCurrency: 'GBP', dailyLabels: 20, packersAbroad, updatedBy: null, updatedAt: 1 });

  beforeAll(async () => {
    if (!available) return;
    globals.__customsFake = { quotes: [], books: [], fetches: [], made: 0 };
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    conn = h.connectionId;
    await h.manager.connections.update(conn, { currency: 'GBP' });
    repo = manifestsRepo(h.meta, addOnCredentialCryptoFromSecret(TEST_SECRET));
    for (const [key, customs] of [['shop', true], ['plain', false]] as const) {
      await h.stageApp(shopDoc(key, customs));
      const res = await h.install(key, '1.0.0', { shippingUnticked: [] });
      expect(res.statusCode, res.body).toBe(200);
    }
    for (const install of await repo.list('app')) if (install.row.scopeKey === conn) installs[install.row.manifestKey] = install.row.id;
    for (const record of await h.meta.db.selectFrom('adminium_app_tables').select(['appKey', 'ref', 'tableName']).execute()) tables[`${record.appKey}:${record.ref}`] = record.tableName;

    await h.stageAddOn(carrierDoc(), { files: { 'dist/server.js': serverJs } });
    const made = await repo.install({ manifestKey: 'carrier-one', version: '1.0.0', kind: 'add-on', source: 'file', document: carrierDoc(), connectionId: conn, status: 'installed', attachTo: [{ key: 'shop', hostInstall: installs['shop']! }, { key: 'plain', hostInstall: installs['plain']! }] });
    const fields = { api_key: KEY };
    await repo.setCredential(made.row.id, { kind: 'api-key', secret: fields });
    await settings().saveAccount({ carrierInstallId: made.row.id, mode: 'live', fingerprint: accountFingerprintOf(TEST_SECRET, 'carrier-one', 'live', undefined, fields), keyHash: credentialHash(TEST_SECRET, 'carrier-one', fields), keyHint: KEY.slice(-4), state: 'ok', carriers: ['DPD'], checkedBy: null, checkedAt: 1 });

    const { db } = await h.manager.data(conn);
    await db.insertInto(tables['shop:products']! as never).values({ id: 1, code: 'CARD-1' } as never).execute();

    await settingsRepo(h.meta).set('addOns.trustCarriedOver', true);
    trusted = process.env['ADMINIUM_ADD_ON_DEV_TRUST'];
    process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = 'carrier-one';
    root = await mkdtemp(join(tmpdir(), 'shipping-customs-'));
    await mkdir(join(root, 'dist'), { recursive: true });
    await writeFile(join(root, 'dist', 'index.html'), '<!doctype html><html><body></body></html>');
    const runService = createRunService({ meta: h.meta });
    composed = await composeServer({
      env: makeEnv({ ADMINIUM_DATA_DIR: h.dataDir, HOST: '127.0.0.1', ADMINIUM_SECRET: TEST_SECRET }),
      metaStore: { meta: h.meta, url: 'sqlite::memory:', engine: 'sqlite', source: 'embedded', close: async () => Promise.resolve() },
      manager: h.manager,
      runService,
      applyService: createApplyService({ meta: h.meta, runService }),
      allowed: null,
      staticRoot: join(root, 'dist'),
      logger: pino({ level: 'silent' }),
      telemetry: false,
      shippingQuotesPerMinute: 100_000,
    });
    await composed.app.ready();
    await composed.addOnsLoaded;
    await composed.jobs.worker.stop();
    composed.jobs.scheduler.stop();

    await person('boss', ['super-admin']);
    await person('picker', ['shop-picker']);
    await person('declarer', ['shop-declarer']);
  }, 300_000);

  afterAll(async () => {
    if (!available) return;
    if (trusted === undefined) delete process.env['ADMINIUM_ADD_ON_DEV_TRUST'];
    else process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = trusted;
    await composed?.app.close();
    await h?.close();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
    delete globals.__customsFake;
  });

  beforeEach(async () => {
    if (!available) return;
    Object.assign(fake(), { quotes: [], books: [], fetches: [], made: 0 });
    await h.meta.db.deleteFrom('adminium_shipping_bookings').execute();
    for (const key of ['shop', 'plain']) {
      await settings().forgetInstall(installs[key]!);
      await settings().setShipFrom(installs[key]!, SHIP_FROM, null, 1);
      await settings().setActiveCarrier(installs[key]!, 'carrier-one', null, 1);
    }
  });

  // ── Refused by default ──────────────────────────────────────────────────

  it.skipIf(!available)('a shop nobody set up refuses a parcel abroad, as it always did, and builds no carrier', async () => {
    const id = await order();
    for (const body of [{}, ticked]) {
      const res = await quote(id, body);
      expect(res.statusCode, res.body).toBe(422);
      expect((res.json() as Doc)['error']).toMatchObject({ code: 'OUTSIDE_OWN_COUNTRY', details: { from: 'GB', to: 'DE' } });
    }
    expect(fake().made).toBe(0);
    const status = (await call('boss', 'GET', 'shop/shipping')).json() as Doc;
    expect(status['data']).toMatchObject({ international: false, customs: null });
    expect((await form(id)).json()).toMatchObject({ data: { abroad: true, offered: false, to: 'DE' } });
  });

  it.skipIf(!available)('an app that does not say where its goods are cannot be set up to ship abroad', async () => {
    const res = await call('boss', 'PUT', 'plain/shipping/international', SETUP);
    expect(res.statusCode, res.body).toBe(409);
    expect(code(res)).toBe('CUSTOMS_NOT_DECLARED');
    // Even a row written some other way opens nothing for it.
    await settings().setInternational(installs['plain']!, { ...SETUP, hsCode: '49090000', signerId: ids['boss']!, products: [] }, null, 1);
    const id = await order({}, [{ name: 'Cards', qty: 1, unit_price: '5.00', grams: 10 }], 'plain');
    expect(code(await quote(id, ticked, 'boss', 'plain'))).toBe('OUTSIDE_OWN_COUNTRY');
    expect(fake().made).toBe(0);
  });

  it.skipIf(!available)('declares only the lines still in the parcel, with a cancelled one left off', async () => {
    expect((await setUp()).statusCode).toBe(200);
    const id = await order({}, [
      { name: 'Kept cards', qty: 2, unit_price: '5.00', grams: 100, product_id: 1 },
      { name: 'Cancelled posters', qty: 9, unit_price: '9.00', grams: 100, product_id: 1, cancelled_at: '2026-11-23' },
    ]);
    const lines = ((await form(id)).json() as Doc)['data']['lines'] as { description: string; quantity: number }[];
    expect(lines.map((line) => [line.description, line.quantity])).toEqual([['Kept cards', 2]]);
    expect((await setUp({ countries: [] })).statusCode).toBe(200);
  });

  it.skipIf(!available)('leaves a line out by the value of its state, and keeps a line with no state', async () => {
    expect((await setUp()).statusCode).toBe(200);
    const id = await order({}, [
      { name: 'Lamp', qty: 1, unit_price: '40.00', grams: 500, product_id: 1, stage: 'ready' },
      { name: 'Sign', qty: 2, unit_price: '30.00', grams: 400, product_id: 1, stage: 'cancelled' },
      { name: 'Old line', qty: 1, unit_price: '5.00', grams: 100, product_id: 1 },
    ]);
    const lines = ((await form(id)).json() as Doc)['data']['lines'] as { description: string }[];
    expect(lines.map((line) => line.description)).toEqual(['Lamp', 'Old line']);
    const res = await quote(id, ticked);
    expect(res.statusCode, res.body).toBe(200);
    expect((fake().quotes.at(-1)!.options['customs']['items'] as { description: string }[]).map((one) => one.description)).toEqual(['Lamp', 'Old line']);
  });

  it.skipIf(!available)('stops the form and the quote while an order has a refund', async () => {
    expect((await setUp()).statusCode).toBe(200);
    for (const none of [null, '0.00']) {
      const clean = await order({ refunded: none });
      expect((await form(clean)).json()).toMatchObject({ data: { problems: [] } });
    }
    const id = await order({ refunded: '30.00' });
    expect(((await form(id)).json() as Doc)['data']['problems']).toContainEqual({ field: 'unitValue', reason: 'refunded' });
    const res = await quote(id, ticked);
    expect(res.statusCode, res.body).toBe(422);
    expect((res.json() as Doc)['error']).toMatchObject({ code: 'CUSTOMS_INCOMPLETE', details: { problems: [{ field: 'unitValue', reason: 'refunded' }] } });
    expect(fake().quotes).toHaveLength(0);
  });

  it.skipIf(!available)('stops when the shop has no currency, or another one than the declarations were set up in', async () => {
    expect((await setUp()).statusCode).toBe(200);
    const id = await order();
    expect((await form(id)).json()).toMatchObject({ data: { currency: 'GBP', problems: [] } });
    try {
      for (const now of ['USD', null]) {
        await h.manager.connections.update(conn, { currency: now });
        const data = ((await form(id)).json() as Doc)['data'];
        expect(data['currency']).toBeNull();
        expect(data['problems']).toContainEqual({ field: 'currency', reason: 'shop-currency' });
        const res = await quote(id, ticked);
        expect(res.statusCode, res.body).toBe(422);
        expect((res.json() as Doc)['error']['code']).toBe('CUSTOMS_INCOMPLETE');
      }
      expect(fake().quotes).toHaveLength(0);
      // The status says what the shop's currency is now, so a save can follow it.
      await h.manager.connections.update(conn, { currency: 'USD' });
      expect(((await call('boss', 'GET', 'shop/shipping')).json() as Doc)['data']['shopCurrency']).toBe('USD');
    } finally {
      await h.manager.connections.update(conn, { currency: 'GBP' });
    }
  });

  it.skipIf(!available)('refuses every label but a return for a cancelled order', async () => {
    expect((await setUp()).statusCode).toBe(200);
    const home = await order({ ship_country: 'GB', ship_city: 'Leeds', ship_postcode: 'LS1 4AB', status: 'cancelled' });
    for (const purpose of ['outbound', 'replacement']) {
      const res = await quote(home, { purpose });
      expect(code(res), res.body).toBe('ORDER_CANCELLED');
    }
  });

  it.skipIf(!available)('listing no country takes a shop back to its own', async () => {
    expect((await setUp()).statusCode).toBe(200);
    const off = await setUp({ countries: [] });
    expect((off.json() as Doc)['data']['international']).toBe(false);
    expect(code(await quote(await order(), ticked))).toBe('OUTSIDE_OWN_COUNTRY');
  });

  it.skipIf(!available)('a parcel inside the country is exactly what it was: no declaration, no phone, no customs on the quote', async () => {
    await setUp();
    const id = await order({ ship_country: 'GB', ship_city: 'Leeds', ship_postcode: 'LS1 4AB' });
    const res = await quote(id);
    expect(res.statusCode, res.body).toBe(200);
    expect(fake().quotes[0]!.options).toEqual({ purpose: 'outbound' });
    expect(fake().quotes[0]!.to).not.toHaveProperty('phone');
    expect((await settings().quote((res.json() as Doc)['data']['quoteId']))!.customs).toBeNull();
    expect(code(await quote(id, ticked))).toBe('CUSTOMS_NOT_NEEDED');
  });

  // ── Who may ─────────────────────────────────────────────────────────────

  it.skipIf(!available)('someone without the customs right can neither quote nor buy a label abroad, even with the switch on', async () => {
    await setUp();
    await limits(true);
    const id = await order();
    const asked = await quote(id, ticked, 'picker');
    expect(asked.statusCode, asked.body).toBe(403);
    expect((asked.json() as Doc)['error']).toMatchObject({ code: 'OWNER_BOOKS', details: { reason: 'abroad' } });
    expect(fake().quotes).toEqual([]);

    // A quote the owner made is no way round it.
    const owners = (await quote(id, ticked)).json() as Doc;
    const before = fake().books.length;
    const bought = await call('picker', 'POST', 'shop/shipping/bookings', { quoteId: owners['data']['quoteId'], rateId: owners['data']['rates'][0].rateId });
    expect(bought.statusCode, bought.body).toBe(403);
    expect((bought.json() as Doc)['error']).toMatchObject({ code: 'OWNER_BOOKS', details: { reason: 'abroad' } });
    expect(fake().books).toHaveLength(before);
    expect((await form(id, 'picker')).statusCode).toBe(403);
  });

  it.skipIf(!available)('the customs right alone is not enough until the owner turns the switch on', async () => {
    await setUp();
    await limits(false);
    const id = await order();
    const res = await quote(id, ticked, 'declarer');
    expect(res.statusCode, res.body).toBe(403);
    expect((res.json() as Doc)['error']).toMatchObject({ code: 'OWNER_BOOKS', details: { reason: 'abroad' } });
    expect((await form(id, 'declarer')).statusCode).toBe(403);
    await limits(true);
    expect((await quote(id, ticked, 'declarer')).statusCode).toBe(200);
    expect(((await call('declarer', 'GET', 'shop/shipping/access')).json() as Doc)['data']['mayShipAbroad']).toBe(true);
  });

  it.skipIf(!available)('the owner stays the named signer, and the audit row says who really ticked', async () => {
    await setUp();
    await limits(true);
    const id = await order();
    const offered = (await quote(id, ticked, 'declarer')).json() as Doc;
    expect(fake().quotes[0]!.options['customs'].signer).toBe('boss name');
    const res = await call('declarer', 'POST', 'shop/shipping/bookings', { quoteId: offered['data']['quoteId'], rateId: offered['data']['rates'][0].rateId });
    expect(res.statusCode, res.body).toBe(200);
    const audit = await h.meta.db.selectFrom('adminium_audit_log').select(['changes']).where('action', '=', 'shipping.booking.made').execute();
    const last = JSON.stringify(audit.at(-1)!.changes);
    expect(last).toContain(ids['declarer']!);
    expect(last).toContain(ids['boss']!);
    expect(last).not.toContain('19.99');
  });

  it.skipIf(!available)('only people holding the customs right can be the named signer', async () => {
    const list = (await call('boss', 'GET', 'shop/shipping/customs/signers')).json() as Doc;
    const names = (list['data']['signers'] as Doc[]).map((one) => one['id']);
    expect(names).toContain(ids['boss']);
    expect(names).toContain(ids['declarer']);
    expect(names).not.toContain(ids['picker']);
    const res = await setUp({ signerId: ids['picker'] });
    expect(res.statusCode, res.body).toBe(409);
    expect(code(res)).toBe('CUSTOMS_SIGNER');
    expect((await setUp({ signerId: ids['declarer'] })).statusCode).toBe(200);
    expect(((await call('boss', 'GET', 'shop/shipping')).json() as Doc)['data']['customs']).toMatchObject({ signerId: ids['declarer'], signerName: 'declarer name' });
    expect((await call('picker', 'PUT', 'shop/shipping/international', SETUP)).statusCode).toBe(403);
  });

  it.skipIf(!available)('a signer who has lost the right stops the declaration', async () => {
    await setUp();
    const stored = (await settings().settings(installs['shop']!))!.international as Doc;
    await settings().setInternational(installs['shop']!, { ...stored, signerId: ids['picker'] }, null, 1);
    const res = await quote(await order(), ticked);
    expect(res.statusCode, res.body).toBe(409);
    expect(code(res)).toBe('CUSTOMS_SIGNER');
    expect(fake().quotes).toEqual([]);
  });

  // ── What is declared ────────────────────────────────────────────────────

  it.skipIf(!available)('declares the order\'s own goods, buys once with them, and keeps the customs invoice', async () => {
    await setUp();
    const id = await order();
    const none = await quote(id);
    expect(none.statusCode, none.body).toBe(422);
    expect(code(none)).toBe('CUSTOMS_NOT_CONFIRMED');
    expect(fake().quotes).toEqual([]);

    const offered = await quote(id, ticked);
    expect(offered.statusCode, offered.body).toBe(200);
    const sent = fake().quotes[0]!;
    expect(sent.to).toMatchObject({ country: 'DE', phone: PHONE });
    expect(sent.to).not.toHaveProperty('email');
    expect(sent.options['customs']).toMatchObject({
      contents: 'merchandise',
      signer: 'boss name',
      certified: true,
      nonDelivery: 'return',
      items: [{ description: 'Thank-you cards', quantity: 3, currency: 'GBP', unitWeightKg: 0.1, originCountry: 'GB', hsCode: '490900', skuCode: 'CARD-1' }],
    });
    expect(Number(sent.options['customs'].items[0].unitValue)).toBe(19.99);

    const data = (offered.json() as Doc)['data'];
    const bought = await call('boss', 'POST', 'shop/shipping/bookings', { quoteId: data['quoteId'], rateId: data['rates'][0].rateId });
    expect(bought.statusCode, bought.body).toBe(200);
    expect(fake().books).toHaveLength(1);
    expect(fake().books[0]!.details['customs']).toEqual(sent.options['customs']);
    expect(fake().books[0]!.details['to']).not.toHaveProperty('email');
    expect(fake().fetches).toEqual(['label', 'customs-invoice']);
    expect((bought.json() as Doc)['data']['label']).toMatchObject({ state: 'ready', customsInvoice: true, customsInvoiceOwed: false });
    const row = (await shippingBookingsRepo(h.meta).byId((bought.json() as Doc)['data']['id']))!;
    expect(row.customsDue).toBe(true);

    const file = await call('boss', 'GET', `shop/shipping/bookings/${row.id}/documents/customs-invoice`);
    expect(file.statusCode, file.body).toBe(200);
    expect(file.rawPayload.subarray(0, 5).toString()).toBe(Buffer.from(PDF).subarray(0, 5).toString());
  });

  it.skipIf(!available)('someone without the customs right cannot read the customs invoice, though they can read the label', async () => {
    await setUp();
    const id = await order();
    const data = ((await quote(id, ticked)).json() as Doc)['data'];
    const bought = (await call('boss', 'POST', 'shop/shipping/bookings', { quoteId: data['quoteId'], rateId: data['rates'][0].rateId })).json() as Doc;
    const booking = bought['data']['id'] as string;
    await limits(true);
    for (const method of ['GET', 'POST'] as const) {
      const res = await call('picker', method, `shop/shipping/bookings/${booking}/documents/customs-invoice`);
      expect(res.statusCode, res.body).toBe(403);
    }
  });

  it.skipIf(!available)('a request cannot change a value, a quantity or an origin', async () => {
    await setUp();
    const id = await order();
    const line = String((await firstLine(id)).id);
    for (const change of [{ unitValue: '0.01' }, { quantity: 1 }, { originCountry: 'CN' }]) {
      const res = await quote(id, { customs: { certified: true, lines: [{ line, ...change }] } });
      expect(res.statusCode, res.body).toBe(422);
      expect(code(res)).toBe('VALIDATION_FAILED');
    }
    expect(code(await quote(id, { customs: { certified: false } }))).toBe('VALIDATION_FAILED');
    expect(fake().quotes).toEqual([]);
  });

  it.skipIf(!available)('a person may correct a description, an HS code and a manufacturer code, and the purchase declares the same', async () => {
    await setUp();
    const id = await order();
    const line = String((await firstLine(id)).id);
    const res = await quote(id, { customs: { certified: true, lines: [{ line, description: 'Letterpress cards', hsCode: '4909 00 10', manufacturerCode: 'GB-MFR-1' }] } });
    expect(res.statusCode, res.body).toBe(200);
    expect(fake().quotes[0]!.options['customs'].items[0]).toMatchObject({ description: 'Letterpress cards', hsCode: '49090010', manufacturerCode: 'GB-MFR-1' });
    const data = (res.json() as Doc)['data'];
    const bought = await call('boss', 'POST', 'shop/shipping/bookings', { quoteId: data['quoteId'], rateId: data['rates'][0].rateId });
    expect(bought.statusCode, bought.body).toBe(200);
    expect(fake().books[0]!.details['customs'].items[0]).toMatchObject({ description: 'Letterpress cards', hsCode: '49090010', manufacturerCode: 'GB-MFR-1' });
  });

  it.skipIf(!available)('a changed price voids the quote before anything is bought', async () => {
    await setUp();
    const id = await order();
    const data = ((await quote(id, ticked)).json() as Doc)['data'];
    const { db } = await h.manager.data(conn);
    await db.updateTable(tables['shop:order_lines']! as never).set({ unit_price: '9.99' } as never).where('order_id' as never, '=', Number(id) as never).execute();
    const res = await call('boss', 'POST', 'shop/shipping/bookings', { quoteId: data['quoteId'], rateId: data['rates'][0].rateId });
    expect(res.statusCode, res.body).toBe(409);
    expect(code(res)).toBe('QUOTE_STALE');
    expect(fake().books).toEqual([]);
  });

  it.skipIf(!available)('saving new defaults voids every quote', async () => {
    await setUp();
    const id = await order();
    const data = ((await quote(id, ticked)).json() as Doc)['data'];
    await setUp({ hsCode: '49090090' });
    const res = await call('boss', 'POST', 'shop/shipping/bookings', { quoteId: data['quoteId'], rateId: data['rates'][0].rateId });
    expect(code(res)).toBe('QUOTE_NOT_FOUND');
    expect(fake().books).toEqual([]);
  });

  it.skipIf(!available)('a country the shop did not list is refused, and says so', async () => {
    await setUp();
    const res = await quote(await order({ ship_country: 'JP' }), ticked);
    expect(res.statusCode, res.body).toBe(422);
    expect((res.json() as Doc)['error']).toMatchObject({ code: 'COUNTRY_NOT_OFFERED', details: { to: 'JP' } });
    expect(fake().made).toBe(0);
  });

  it.skipIf(!available)('an order abroad with no phone is stopped before a carrier is asked', async () => {
    await setUp();
    const res = await quote(await order({ ship_phone: null }), ticked);
    expect(res.statusCode, res.body).toBe(422);
    expect((res.json() as Doc)['error']).toMatchObject({ code: 'ADDRESS_INCOMPLETE', details: { fields: ['phone'] } });
    expect(fake().made).toBe(0);
  });

  it.skipIf(!available)('only the order\'s first outbound parcel can carry its declaration', async () => {
    await setUp();
    const res = await quote(await order(), { ...ticked, parcelNumber: 2 });
    expect(res.statusCode, res.body).toBe(422);
    expect(code(res)).toBe('CUSTOMS_ONE_PARCEL');
    expect(fake().quotes).toEqual([]);
  });

  it.skipIf(!available)('a line with no value is named, and nothing is declared for it', async () => {
    await setUp();
    const id = await order({}, [{ name: 'Free sample', qty: 1, unit_price: null, grams: 5 }]);
    const res = await quote(id, ticked);
    expect(res.statusCode, res.body).toBe(422);
    expect((res.json() as Doc)['error']['code']).toBe('CUSTOMS_INCOMPLETE');
    expect((res.json() as Doc)['error']['details']['problems'][0]).toMatchObject({ field: 'unitValue' });
    expect(fake().quotes).toEqual([]);
  });

  it.skipIf(!available)('a parcel lighter than its goods is a wrong weight, and is not declared', async () => {
    await setUp();
    const id = await order({}, [{ name: 'Heavy cards', qty: 10, unit_price: '5.00', grams: 500, product_id: 1 }]);
    const res = await quote(id, ticked);
    expect(res.statusCode, res.body).toBe(422);
    expect((res.json() as Doc)['error']['details']['problems']).toEqual([{ field: 'weight' }]);
  });

  it.skipIf(!available)('says whether the shop sends parcels abroad, to anyone with a right on its labels', async () => {
    const shipsAbroad = async () => ((await call('boss', 'GET', 'shop/shipping/access')).json() as Doc)['data']['shipsAbroad'];
    expect(await shipsAbroad()).toBe(false);
    await setUp();
    expect(await shipsAbroad()).toBe(true);
    await setUp({ countries: [] });
    expect(await shipsAbroad()).toBe(false);
  });

  it.skipIf(!available)('states the shop\'s export numbers only when it has them, and audits that they changed, never what they are', async () => {
    const id = await order();
    await setUp();
    expect((await quote(id, ticked)).statusCode).toBe(200);
    expect(fake().quotes.at(-1)!.options['customs']).not.toHaveProperty('exporter');
    expect(fake().quotes.at(-1)!.options['customs']).not.toHaveProperty('filingCode');

    const saved = await setUp({ exporter: { eori: 'gb 123456789000', ioss: 'IM3720000224', taxId: { type: 'VAT', number: 'GB123456789' } } });
    expect(saved.statusCode, saved.body).toBe(200);
    expect((saved.json() as Doc)['data']['customs']['exporter']).toEqual({ eori: 'GB123456789000', ioss: 'IM3720000224', taxId: { type: 'VAT', number: 'GB123456789' } });
    expect((await quote(id, ticked)).statusCode).toBe(200);
    // In pounds there is no way to know the parcel is under the euro limit, so the IOSS number stays home.
    expect(fake().quotes.at(-1)!.options['customs']['exporter']).toEqual({ eori: 'GB123456789000', taxId: { type: 'VAT', number: 'GB123456789' } });
    await h.manager.connections.update(conn, { currency: 'EUR' });
    try {
      expect((await setUp({ currency: 'EUR' })).statusCode).toBe(200);
      expect((await quote(id, ticked)).statusCode).toBe(200);
      expect(fake().quotes.at(-1)!.options['customs']['exporter']).toEqual({ eori: 'GB123456789000', ioss: 'IM3720000224', taxId: { type: 'VAT', number: 'GB123456789' } });
    } finally {
      await h.manager.connections.update(conn, { currency: 'GBP' });
      await setUp();
    }

    // A save that does not mention them keeps them, and an IOSS number never leaves on a parcel outside the EU.
    expect((await setUp({ description: 'Cards' })).statusCode).toBe(200);
    expect((await quote(await order({ ship_country: 'US' }), ticked)).statusCode).toBe(200);
    expect(fake().quotes.at(-1)!.options['customs']['exporter']).toEqual({ eori: 'GB123456789000', taxId: { type: 'VAT', number: 'GB123456789' } });

    const rows = await h.meta.db.selectFrom('adminium_audit_log').select(['changes']).where('action', '=', 'shipping.international.saved').execute();
    const written = JSON.stringify(rows);
    expect(written).not.toContain('123456789');
    expect(written).not.toContain('IM3720000224');

    // This shop ships from outside the US: its statement is kept and shown, and never reaches the carrier.
    const filed = await setUp({ filingCode: 'NOEEI_30_37_a' });
    expect(filed.statusCode, filed.body).toBe(200);
    expect((filed.json() as Doc)['data']['customs']['filingCode']).toBe('NOEEI_30_37_a');
    expect((await quote(id, ticked)).statusCode).toBe(200);
    expect(fake().quotes.at(-1)!.options['customs']).not.toHaveProperty('filingCode');
    expect((await setUp({ filingCode: null })).json()['data']['customs']).not.toHaveProperty('filingCode');

    const cleared = await setUp({ exporter: { eori: '', ioss: '', taxId: { type: 'VAT', number: '' } } });
    expect((cleared.json() as Doc)['data']['customs']).not.toHaveProperty('exporter');
    expect((await setUp({ exporter: { ioss: 'not-a-number' } })).statusCode).toBe(422);
  });

  it.skipIf(!available)('the form is filled in from the order and warns of a code the EU asks for', async () => {
    await setUp();
    const res = await form(await order());
    expect(res.statusCode, res.body).toBe(200);
    const data = (res.json() as Doc)['data'];
    expect(data).toMatchObject({ abroad: true, offered: true, to: 'DE', signer: 'boss name', currency: 'GBP', problems: [] });
    expect(data['lines'][0]).toMatchObject({ quantity: 3, skuCode: 'CARD-1', originCountry: 'GB', hsCode: '490900' });
    expect(data['warnings'].map((one: Doc) => one['field'])).toEqual(['manufacturerCode']);
    const home = await form(await order({ ship_country: 'GB' }));
    expect((home.json() as Doc)['data']).toEqual({ abroad: false });
    // Not knowing a country is never read as "no form needed".
    expect(code(await form(await order({ ship_country: 'Germany' })))).toBe('COUNTRY_NOT_RECORDED');
    await settings().setShipFrom(installs['shop']!, { name: 'Marlow Press' }, null, 2);
    expect(code(await form(await order()))).toBe('SHIP_FROM_INCOMPLETE');
  });
});

describe('what a declaration states', () => {
  const plain = (currency?: string): OrderFacts => ({ currency, shopCurrency: 'GBP', refunded: false });
  const refusal = (run: () => unknown) => {
    try {
      run();
    } catch (error) {
      return error as ShippingRefusal;
    }
    throw new Error('expected a refusal');
  };
  const settings: InternationalSettings = { countries: ['DE'], currency: 'GBP', originCountry: 'GB', signerId: 'usr_1', products: [{ sku: 'OWN', hsCode: '12345678', originCountry: 'CN', manufacturerCode: 'MFR' }] };
  const good = (over: Partial<GoodsLine> = {}): GoodsLine => ({ key: '1', description: 'Cards', quantity: 2, unitValue: '4.50', unitWeightKg: null, ...over });

  it('takes a product\'s own codes over the shop\'s, and a person\'s correction over both', () => {
    const line = draftOf([good({ sku: 'OWN' })], { ...settings, hsCode: '99999999' }, plain(), { country: 'US' }).lines[0]!;
    expect(line).toMatchObject({ hsCode: '12345678', originCountry: 'CN', manufacturerCode: 'MFR' });
    const edited = draftOf([good({ sku: 'OWN' })], settings, plain(), { country: 'US' }, [{ line: '1', hsCode: '1111.11', manufacturerCode: 'NEW' }]).lines[0]!;
    expect(edited).toMatchObject({ hsCode: '111111', manufacturerCode: 'NEW' });
  });

  it('never makes up a code, and warns only where the rule applies', () => {
    // A line's own name wins: a shop-wide default must not declare one product as another on a single tick.
    expect(draftOf([good({ description: 'Waxed cap' })], { ...settings, description: 'Canvas bags' }, plain(), { country: 'US' }).lines[0]!.description).toBe('Waxed cap');
    expect(draftOf([good({ description: null })], { ...settings, description: 'Canvas bags' }, plain(), { country: 'US' }).lines[0]!.description).toBe('Canvas bags');
    const toEu = draftOf([good()], settings, plain(), { country: 'FR' });
    expect(toEu.warnings.map((one) => one.field)).toEqual(['hsCode', 'skuCode', 'manufacturerCode']);
    expect(toEu.lines[0]).not.toHaveProperty('hsCode');
    const toUs = draftOf([good()], settings, plain(), { country: 'US' });
    expect(toUs.warnings.map((one) => one.field)).toEqual(['hsCode']);
    const madeInEu = draftOf([good()], { ...settings, originCountry: 'DE' }, plain(), { country: 'FR' });
    expect(madeInEu.warnings.map((one) => one.field)).toEqual(['hsCode']);
  });

  it('shares a parcel\'s weight across units with no weight of their own, never adding up to more', () => {
    const declared = declarationOf(draftOf([good({ quantity: 3 })], settings, plain(), { country: 'US' }), 'Ada', 1);
    expect(declared.items[0]!.unitWeightKg).toBe(0.333);
    expect(declared.items[0]!.unitWeightKg * 3).toBeLessThanOrEqual(1);
  });

  it('refuses goods heavier than their parcel, a parcel too light to share, and an unreadable currency', () => {
    expect(refusal(() => declarationOf(draftOf([good({ unitWeightKg: 1 })], settings, plain(), { country: 'US' }), 'Ada', 1.5)).code).toBe('CUSTOMS_INCOMPLETE');
    expect(refusal(() => declarationOf(draftOf([good({ quantity: 5000 })], settings, plain(), { country: 'US' }), 'Ada', 1)).code).toBe('CUSTOMS_INCOMPLETE');
    expect(refusal(() => declarationOf(draftOf([good()], settings, plain('pounds'), { country: 'US' }), 'Ada', 1)).code).toBe('CUSTOMS_INCOMPLETE');
  });

  it('refuses a correction to a line the order does not have', () => {
    const draft = draftOf([good()], settings, plain(), { country: 'US' }, [{ line: '99', description: 'Other' }]);
    expect(draft.problems).toEqual([{ line: '99', field: 'lines' }]);
  });

  describe('the shop\'s export numbers', () => {
    const numbers = { eori: 'GB123456789000', ioss: 'IM3720000224', taxId: { type: 'VAT' as const, number: 'GB123456789' } };
    const withNumbers: InternationalSettings = { ...settings, exporter: numbers };

    it('states nothing for a shop that has none', () => {
      expect(exporterFor(settings, { country: 'DE' }, draftOf([good()], settings, plain('EUR'), { country: 'DE' }))).toBeUndefined();
      expect(declarationOf(draftOf([good()], settings, plain(), { country: 'US' }), 'Ada', 1)).not.toHaveProperty('exporter');
    });

    it('keeps an IOSS number to parcels into the EU, in euros', () => {
      expect(exporterFor(withNumbers, { country: 'FR' }, draftOf([good()], withNumbers, plain('EUR'), { country: 'FR' }))).toEqual(numbers);
      expect(exporterFor(withNumbers, { country: 'US' }, draftOf([good()], withNumbers, plain('EUR'), { country: 'US' }))).toEqual({ eori: numbers.eori, taxId: numbers.taxId });
    });

    it('sends no IOSS number when the value in euros is not known', () => {
      const noIoss = { eori: numbers.eori, taxId: numbers.taxId };
      expect(exporterFor(withNumbers, { country: 'DE' }, draftOf([good({ unitValue: '900.00' })], withNumbers, plain('GBP'), { country: 'DE' }))).toEqual(noIoss);
      expect(exporterFor(withNumbers, { country: 'DE' }, draftOf([good({ unitValue: '1.00' })], withNumbers, plain('USD'), { country: 'DE' }))).toEqual(noIoss);
      expect(exporterFor(withNumbers, { country: 'DE' }, draftOf([good({ unitValue: null })], withNumbers, plain('EUR'), { country: 'DE' }))).toEqual(noIoss);
    });

    it('leaves an IOSS number off goods in euros above its 150 ceiling, to the cent', () => {
      const at = (unitValue: string) => exporterFor(withNumbers, { country: 'FR' }, draftOf([good({ quantity: 2, unitValue })], withNumbers, plain('EUR'), { country: 'FR' }));
      expect(at('75.00')).toHaveProperty('ioss');
      expect(at('75.01')).not.toHaveProperty('ioss');
    });

    it('drops blanks, and keeps what a save did not mention', () => {
      const base = { countries: ['DE'], currency: 'GBP', originCountry: 'GB' };
      expect(cleanInternational(internationalBody.parse(base), 'usr_1', withNumbers).exporter).toEqual(numbers);
      expect(cleanInternational(internationalBody.parse({ ...base, exporter: { eori: ' gb 123456789000 ' } }), 'usr_1').exporter).toEqual({ eori: 'GB123456789000' });
      expect(cleanInternational(internationalBody.parse({ ...base, exporter: { eori: '' } }), 'usr_1', withNumbers)).not.toHaveProperty('exporter');
    });
  });

  describe('the shop\'s US export filing statement', () => {
    const low: InternationalSettings = { ...settings, filingCode: 'NOEEI_30_37_a' };
    const canada: InternationalSettings = { ...settings, filingCode: 'NOEEI_30_36' };
    const us = { country: 'US' };
    const code = (held: InternationalSettings, from: { country: string }, to: { country: string }, goods: GoodsLine[], currency = 'USD') =>
      filingCodeFor(held, from, to, draftOf(goods, held, plain(currency), to));

    it('states nothing for a shop that chose none', () => {
      expect(code(settings, us, { country: 'DE' }, [good()])).toBeUndefined();
      expect(declarationOf(draftOf([good()], settings, plain('USD'), { country: 'DE' }), 'Ada', 1)).not.toHaveProperty('filingCode');
    });

    it('carries a chosen statement on the declaration', () => {
      const draft = draftOf([good()], low, plain('USD'), { country: 'DE' });
      expect(declarationOf(draft, 'Ada', 1, undefined, filingCodeFor(low, us, { country: 'DE' }, draft)).filingCode).toBe('NOEEI_30_37_a');
    });

    it('never states a US filing on a parcel leaving another country', () => {
      expect(code(low, { country: 'GB' }, { country: 'DE' }, [good()])).toBeUndefined();
      expect(code(canada, { country: 'GB' }, { country: 'CA' }, [good()])).toBeUndefined();
    });

    it('keeps the Canadian exemption to parcels into Canada', () => {
      expect(code(canada, us, { country: 'CA' }, [good()])).toBe('NOEEI_30_36');
      expect(code(canada, us, { country: 'MX' }, [good()])).toBeUndefined();
    });

    it('holds the low-value exemption to 2,500 dollars a commodity code, to the cent', () => {
      const line = (key: string, unitValue: string, hsCode?: string) => good({ key, quantity: 1, unitValue, ...(hsCode === undefined ? {} : { sku: hsCode }) });
      const coded: InternationalSettings = { ...low, products: [{ sku: 'A', hsCode: '111111' }, { sku: 'B', hsCode: '222222' }] };
      expect(code(coded, us, { country: 'DE' }, [line('1', '2500.00', 'A')])).toBe('NOEEI_30_37_a');
      expect(code(coded, us, { country: 'DE' }, [line('1', '2500.01', 'A')])).toBeUndefined();
      expect(code(coded, us, { country: 'DE' }, [line('1', '2000.00', 'A'), line('2', '2000.00', 'B')])).toBe('NOEEI_30_37_a');
      expect(code(coded, us, { country: 'DE' }, [line('1', '2000.00', 'A'), line('2', '501.00', 'A')])).toBeUndefined();
      // Lines with no code cannot be told apart, so they count as one.
      expect(code(low, us, { country: 'DE' }, [line('1', '2000.00'), line('2', '501.00')])).toBeUndefined();
    });

    it('guesses no exchange rate for the low-value exemption', () => {
      expect(code(low, us, { country: 'DE' }, [good()], 'EUR')).toBeUndefined();
    });

    it('keeps a statement a save left out, removes one on null, and refuses one a sale cannot make', () => {
      const base = { countries: ['DE'], currency: 'USD', originCountry: 'US' };
      expect(cleanInternational(internationalBody.parse(base), 'usr_1', low).filingCode).toBe('NOEEI_30_37_a');
      expect(cleanInternational(internationalBody.parse({ ...base, filingCode: 'NOEEI_30_36' }), 'usr_1', low).filingCode).toBe('NOEEI_30_36');
      expect(cleanInternational(internationalBody.parse({ ...base, filingCode: null }), 'usr_1', low)).not.toHaveProperty('filingCode');
      for (const refused of ['NOEEI_30_37_h', 'NOEEI_30_37_f', 'AES_ITN']) expect(internationalBody.safeParse({ ...base, filingCode: refused }).success).toBe(false);
    });
  });

  describe('what cannot be trusted stops it', () => {
    const facts = (over: Partial<OrderFacts> = {}): OrderFacts => ({ currency: undefined, shopCurrency: 'GBP', refunded: false, ...over });

    it('reads a refund from the order: nothing, zero, or else it stands', () => {
      const columns = { refunded: 'refunded' } as never;
      for (const none of [null, 0, '0', '0.00', 0n]) expect(orderFactsOf(columns, { refunded: none }, 'GBP').refunded).toBe(false);
      for (const some of ['30.00', 0.01, '-1.00', 'not a number', undefined]) expect(orderFactsOf(columns, { refunded: some }, 'GBP').refunded).toBe(true);
      expect(orderFactsOf({} as never, {}, 'GBP').refunded).toBe(false);
    });

    it('stops on a refund, on the value and for the whole order', () => {
      const draft = draftOf([good()], settings, facts({ refunded: true }), { country: 'DE' });
      expect(draft.problems).toContainEqual({ field: 'unitValue', reason: 'refunded' });
      expect(refusal(() => declarationOf(draft, 'Ada', 1)).code).toBe('CUSTOMS_INCOMPLETE');
    });

    it('declares only in the shop\'s real currency', () => {
      for (const shopCurrency of [null, '', '  ', 'USD']) {
        const draft = draftOf([good()], settings, facts({ shopCurrency }), { country: 'DE' });
        expect(draft.currency).toBeNull();
        expect(draft.problems).toContainEqual({ field: 'currency', reason: 'shop-currency' });
      }
      expect(draftOf([good()], settings, facts({ shopCurrency: 'gbp' }), { country: 'DE' })).toMatchObject({ currency: 'GBP', problems: [] });
      // An order that says its own currency is not held to the shop's.
      expect(draftOf([good()], settings, facts({ currency: 'EUR', shopCurrency: 'USD' }), { country: 'DE' })).toMatchObject({ currency: 'EUR', problems: [] });
    });

    it('keeps the shop-wide code off an order of several products, and warns', () => {
      const held: InternationalSettings = { ...settings, hsCode: '49090000' };
      const two = draftOf([good({ key: '1', sku: 'A' }), good({ key: '2', sku: 'B' })], held, facts(), { country: 'US' });
      expect(two.lines.map((line) => line.hsCode)).toEqual([undefined, undefined]);
      expect(two.warnings.filter((one) => one.field === 'hsCode').map((one) => one.line)).toEqual(['1', '2']);
      expect(two.problems).toEqual([]);
      // No SKU to tell them apart: two products as far as anyone can say.
      const unnamed = draftOf([good({ key: '1' }), good({ key: '2' })], held, facts(), { country: 'US' });
      expect(unnamed.warnings.filter((one) => one.field === 'hsCode')).toHaveLength(2);
      // One product over two lines is one product, and a product's own code is never lost.
      const same = draftOf([good({ key: '1', sku: 'A' }), good({ key: '2', sku: 'A' })], held, facts(), { country: 'US' });
      expect(same.lines.map((line) => line.hsCode)).toEqual(['49090000', '49090000']);
      expect(same.warnings.filter((one) => one.field === 'hsCode')).toEqual([]);
      const own = draftOf([good({ key: '1', sku: 'OWN' }), good({ key: '2', sku: 'B' })], held, facts(), { country: 'US' });
      expect(own.lines[0]!.hsCode).toBe('12345678');
      expect(own.warnings.filter((one) => one.field === 'hsCode').map((one) => one.line)).toEqual(['2']);
    });

    it('stops when only some lines have a weight, rather than share the parcel over them', () => {
      const draft = draftOf([good({ key: '1', unitWeightKg: 0.2 }), good({ key: '2', unitWeightKg: null })], settings, facts(), { country: 'DE' });
      expect(draft.problems).toEqual([{ line: '2', field: 'weight', reason: 'no-line-weight' }]);
      expect(refusal(() => declarationOf(draft, 'Ada', 2)).code).toBe('CUSTOMS_INCOMPLETE');
      // None at all is still shared, as it always was.
      expect(draftOf([good({ key: '1' }), good({ key: '2' })], settings, facts(), { country: 'DE' }).problems).toEqual([]);
    });
  });

  it('reads an order\'s own currency, and an HS code with its dots and spaces', () => {
    expect(draftOf([good()], settings, plain('eur'), { country: 'US' }).currency).toBe('EUR');
    expect(hsDigits('4909.00 10')).toBe('49090010');
  });
});
