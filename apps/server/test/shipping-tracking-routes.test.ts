// SPDX-License-Identifier: AGPL-3.0-only
/**
 * TRACKING THROUGH A REAL SERVER, on all three databases: the webhook with no
 * session, the staff routes with real roles, and a sweep of every reply, log
 * line and audit row for the carrier key and the webhook token.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { manifestsRepo, realTableOf, rolesRepo, settingsRepo, shippingBookingsRepo, shippingRepo, shippingTrackingRepo, usersRepo, type ManifestsRepo } from '@adminium/meta';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { addOnCredentialCryptoFromSecret } from '../src/add-ons/credential-crypto.js';
import { buildLogger } from '../src/app.js';
import { composeServer, type ComposedServer } from '../src/compose.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import { factsViewFor } from '../src/routes/pages/column-facts.js';
import { accountFingerprintOf, credentialHash } from '../src/shipping/fingerprint.js';
import { followTrackEvent } from '../src/shipping/tracking.js';
import { addOnHarness, addOnManifest, type Harness } from './app-add-ons.helpers.js';
import { adminPasswordHash, ADMIN_PASSWORD, sessionCookie } from './auth-helpers.js';
import { makeEnv, TEST_SECRET } from './helpers.js';
import { LEGS } from './invoicing-install.helpers.js';

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- a reply read freely

const CARRIER = 'shipping-shippo';
const KEY = 'test-carrier-value-never-shown';
const NEW_KEY = 'test-carrier-second-value-never-shown';
const fields = { api_key: KEY };

interface Fake {
  calls: string[];
  check: () => unknown;
  track: (number: string) => unknown;
}
const globals = globalThis as unknown as { __trackingFake?: Fake };

const serverJs = `export function createShippingCarrier() {
  const fake = globalThis.__trackingFake;
  return {
    key: ${JSON.stringify(CARRIER)},
    quote: async () => [],
    book: async () => { throw new Error('never'); },
    track: async (number) => { fake.calls.push(number); return fake.track(number); },
    label: async () => { throw new Error('never'); },
    cancel: async () => undefined,
    checkCredentials: async () => fake.check(),
  };
}
`;

const shopDoc = (key: string): Record<string, unknown> => ({
  kind: 'app',
  manifestVersion: 1,
  key,
  name: key,
  version: '1.0.0',
  publisher: { id: 'adminium', name: 'Adminium' },
  license: 'AGPL-3.0-only',
  description: { key: 'd', fallback: 'A shop.' },
  categories: ['operations'],
  compatibility: { minAdminiumVersion: '0.3.72', engines: ['postgres', 'mysql', 'sqlite'] },
  requiredSchema: {
    prefixed: true,
    tables: [
      {
        ref: 'orders',
        columns: [
          { ref: 'id', type: 'int', role: 'pk' },
          { ref: 'number', type: 'text', maxLength: 40, nullable: true },
          { ref: 'ship_name', type: 'text', maxLength: 120, nullable: true },
          { ref: 'ship_line1', type: 'text', maxLength: 120, nullable: true },
          { ref: 'ship_city', type: 'text', maxLength: 120, nullable: true },
          { ref: 'ship_postcode', type: 'text', maxLength: 20, nullable: true },
          { ref: 'ship_country', type: 'text', maxLength: 40, nullable: true },
          { ref: 'tracking', type: 'text', maxLength: 64, nullable: true },
          { ref: 'owner_id', type: 'text', maxLength: 36, nullable: true, rules: { staff: true } },
        ],
        belongs: [{ column: 'owner_id', set: 'team' }],
      },
    ],
  },
  roles: [
    { key: 'packer', name: 'Packer', permissions: ['table:@orders:read', 'shipping:@:book'] },
    { key: 'ownrep', name: 'Own rep', permissions: ['table:@orders:read', 'shipping:@:book'], limits: { orders: { rows: { read: { reach: 'own' } } } } },
    { key: 'reader', name: 'Reader', permissions: ['table:@orders:read'] },
  ],
  pages: [{ ref: `${key}-orders`, template: 'page-crud', title: { key: 't', fallback: 'Orders' }, nav: { group: 'shop', icon: 'home', order: 1 }, bindings: { rows: 'orders' } }],
  frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
  shipping: { orders: [{ table: 'orders', reference: 'number', tracking: 'tracking', address: { name: 'ship_name', lines: ['ship_line1'], city: 'ship_city', postcode: 'ship_postcode', country: 'ship_country' } }] },
});

const carrierDoc = addOnManifest(CARRIER, {
  categories: ['delivery'],
  capabilities: ['outbound-http'],
  settings: [{ key: 'api_key', type: 'string', secret: true }],
  addOn: { provides: [{ contract: 'shipping-carrier', version: 1, server: 'dist/server.js' }], network: { allow: ['api.goshippo.com'] } },
});

const liveEvent = (number: string, status: string, at: number) =>
  JSON.stringify({ event: 'track_updated', test: false, data: { tracking_number: number, address_to: { name: 'Ada Quill' }, tracking_status: { status, status_date: new Date(at).toISOString() } } });

describe.each(LEGS)('tracking through the server on %s', (dialect, available) => {
  let h: Harness;
  let composed: ComposedServer;
  let root: string;
  let repo: ManifestsRepo;
  let conn = '';
  let shop = '';
  let carrierId = '';
  let orders = '';
  let ordersReal = '';
  let trusted: string | undefined;
  let nextId = 500;
  let signIns = 40;
  let row = 0;
  const cookies: Record<string, string> = {};
  const userIds: Record<string, string> = {};
  const logs: string[] = [];
  const replies: string[] = [];

  async function call(who: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, payload?: unknown) {
    const res = await composed.app.inject({ method, url: `/api/v1/apps/shop/shipping/${path}?connectionId=${encodeURIComponent(conn)}`, headers: { cookie: cookies[who]! }, ...(payload === undefined ? {} : { payload: payload as Doc }) });
    replies.push(res.body);
    return res;
  }
  const hook = (id: string, token: string, body: string) =>
    composed.app.inject({ method: 'POST', url: `/api/v1/shipping/webhook/${id}?token=${encodeURIComponent(token)}`, headers: { 'content-type': 'application/json' }, payload: body });

  async function person(key: string, roles: string[]): Promise<void> {
    const user = await usersRepo(h.meta).create({ email: `${key}@track.example`, name: key, passwordHash: await adminPasswordHash() });
    userIds[key] = user.id;
    for (const slug of roles) await rolesRepo(h.meta).assignToUser(user.id, (await rolesRepo(h.meta).findBySlug(slug))!.id);
    signIns += 1;
    const res = await composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: `10.8.0.${String(signIns)}`, payload: { email: `${key}@track.example`, password: ADMIN_PASSWORD } });
    expect(res.statusCode, res.body).toBe(200);
    cookies[key] = sessionCookie(res.headers['set-cookie']);
  }

  async function booked(number: string, over: { mode?: 'live' | 'test'; owner?: string | null } = {}): Promise<{ id: string; rowKey: string }> {
    nextId += 1;
    row += 1;
    const { db } = await h.manager.data(conn);
    await db.insertInto(orders as never).values({ id: nextId, number: `MP-${String(nextId)}`, ship_name: 'Ada Quill', ship_line1: '12 Kiln Lane', ship_city: 'Leeds', ship_postcode: 'LS1 4AB', ship_country: 'GB', owner_id: over.owner ?? null } as never).execute();
    const mode = over.mode ?? 'live';
    const made = await shippingBookingsRepo(h.meta).reserve(
      { installId: shop, carrierInstallId: carrierId, carrierKey: CARRIER, connectionId: conn, tableRef: 'orders', tableName: ordersReal, rowKey: String(nextId), purpose: 'outbound', parcelNumber: 1, reference: `MP-${String(nextId)}`, mode, accountFingerprint: accountFingerprintOf(TEST_SECRET, CARRIER, 'live', undefined, fields), detailsHash: 'd'.repeat(64), service: 'Evri 48', rateCode: 'evri-48', handleSealed: null, quotedAmount: '3.10', quotedCurrency: 'GBP', createdBy: null },
      Date.now(),
    );
    if (!made.ok) throw new Error('no booking');
    await shippingBookingsRepo(h.meta).move(made.booking.id, ['reserved'], 'calling', { calledAt: Date.now() }, Date.now());
    await shippingBookingsRepo(h.meta).move(made.booking.id, ['calling'], 'booked', { tracking: number, carrierShipmentId: `tx-${String(row)}`, answeredAt: Date.now() }, Date.now());
    return { id: made.booking.id, rowKey: String(nextId) };
  }

  async function saveKey(value: string): Promise<void> {
    const saved = { api_key: value };
    await repo.setCredential(carrierId, { kind: 'api-key', secret: saved });
    await shippingRepo(h.meta).saveAccount({ carrierInstallId: carrierId, mode: 'live', fingerprint: accountFingerprintOf(TEST_SECRET, CARRIER, 'live', undefined, saved), keyHash: credentialHash(TEST_SECRET, CARRIER, saved), keyHint: value.slice(-4), state: 'ok', carriers: ['Evri'], checkedBy: null, checkedAt: 1 });
  }

  const makeAddress = async (): Promise<{ address: string; token: string }> => {
    const res = await call('boss', 'POST', `carriers/${CARRIER}/webhook`);
    expect(res.statusCode, res.body).toBe(200);
    const address = (res.json() as Doc)['data']['address'] as string;
    return { address, token: new URL(address).searchParams.get('token')! };
  };
  const followAll = async () => {
    const rows = await h.meta.db.selectFrom('adminium_shipping_track_events').select('id').where('state', '=', 'waiting').execute();
    for (const one of rows) await followTrackEvent({ meta: h.meta, secret: TEST_SECRET, now: () => Date.now(), enqueueApply: async () => undefined }, one.id);
  };

  beforeAll(async () => {
    if (!available) return;
    globals.__trackingFake = { calls: [], check: () => ({ outcome: 'ok', mode: 'live', carriers: ['Evri'] }), track: () => [] };
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    conn = h.connectionId;
    repo = manifestsRepo(h.meta, addOnCredentialCryptoFromSecret(TEST_SECRET));
    await h.stageApp(shopDoc('shop'));
    const res = await h.install('shop', '1.0.0', { shippingUnticked: [] });
    expect(res.statusCode, res.body).toBe(200);
    shop = (await repo.findInScope('shop', conn))!.row.id;
    for (const record of await h.meta.db.selectFrom('adminium_app_tables').select(['connectionId', 'appKey', 'ref', 'tableName', 'schemaName']).execute()) {
      if (record.ref === 'orders' && record.appKey === 'shop') {
        orders = record.tableName;
        ordersReal = realTableOf(record);
      }
    }
    // A booking holds the table as the order's reach names it.
    ordersReal = (await factsViewFor(h.meta, conn))!.table(ordersReal).id;
    await h.stageAddOn(carrierDoc, { files: { 'dist/server.js': serverJs } });
    const made = await repo.install({ manifestKey: CARRIER, version: '1.0.0', kind: 'add-on', source: 'file', document: carrierDoc, connectionId: conn, status: 'installed', attachTo: [{ key: 'shop', hostInstall: shop }] });
    carrierId = made.row.id;
    await saveKey(KEY);
    await settingsRepo(h.meta).set('addOns.trustCarriedOver', true);
    await settingsRepo(h.meta).set('system.publicOrigin', 'https://shop.adminium-test.dev');
    trusted = process.env['ADMINIUM_ADD_ON_DEV_TRUST'];
    process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = CARRIER;
    root = await mkdtemp(join(tmpdir(), 'shipping-tracking-'));
    await mkdir(join(root, 'dist'), { recursive: true });
    await writeFile(join(root, 'dist', 'index.html'), '<!doctype html><html><body></body></html>');
    const runService = createRunService({ meta: h.meta });
    const env = makeEnv({ ADMINIUM_DATA_DIR: h.dataDir, HOST: '127.0.0.1', ADMINIUM_SECRET: TEST_SECRET, ADMINIUM_LOG_LEVEL: 'trace' });
    composed = await composeServer({
      env,
      metaStore: { meta: h.meta, url: 'sqlite::memory:', engine: 'sqlite', source: 'embedded', close: async () => Promise.resolve() },
      manager: h.manager,
      runService,
      applyService: createApplyService({ meta: h.meta, runService }),
      allowed: null,
      staticRoot: join(root, 'dist'),
      // The product's own logger, so this proves what a real log line holds.
      logger: buildLogger(env, { pretty: false, stream: { write: (line: string) => void logs.push(line) } }),
      telemetry: false,
    });
    await composed.app.ready();
    await composed.addOnsLoaded;
    await composed.jobs.worker.stop();
    composed.jobs.scheduler.stop();
    await person('boss', ['super-admin']);
    await person('packer', ['shop-packer']);
    await person('ownrep', ['shop-ownrep']);
    await person('reader', ['shop-reader']);
  }, 300_000);

  afterAll(async () => {
    if (!available) return;
    if (trusted === undefined) delete process.env['ADMINIUM_ADD_ON_DEV_TRUST'];
    else process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = trusted;
    await composed?.app.close();
    await h?.close();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
    delete globals.__trackingFake;
  });

  beforeEach(async () => {
    if (!available) return;
    const fake = globals.__trackingFake!;
    fake.calls = [];
    fake.track = () => [];
    for (const table of ['adminium_shipping_track_events', 'adminium_shipping_parcels', 'adminium_shipping_track_installs', 'adminium_shipping_bookings'] as const) await h.meta.db.deleteFrom(table).execute();
    await saveKey(KEY);
    await shippingRepo(h.meta).setActiveCarrier(shop, CARRIER, null, 1);
  });

  it.skipIf(!available)('takes a webhook with no session, follows it, and shows the status on the order\'s bookings', async () => {
    const { token } = await makeAddress();
    const parcel = await booked('TRK-E2E');
    const at = Date.now() - 60_000;
    expect((await hook(carrierId, token, liveEvent('TRK-E2E', 'TRANSIT', at))).statusCode).toBe(200);
    await followAll();
    const res = await composed.app.inject({ method: 'GET', url: `/api/v1/apps/shop/shipping/bookings?connectionId=${encodeURIComponent(conn)}&table=orders&id=${parcel.rowKey}`, headers: { cookie: cookies['boss']! } });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as Doc)['data']['bookings'][0]['track']).toMatchObject({ status: 'TRANSIT', statusAt: at, checkedAt: null, newNumber: false });
    expect(globals.__trackingFake!.calls).toEqual([]);
  });

  it.skipIf(!available)('answers 404 to a wrong token, with no CSRF or session in the way of the right one', async () => {
    const { token } = await makeAddress();
    expect((await hook(carrierId, 'wrong', liveEvent('X', 'TRANSIT', Date.now()))).statusCode).toBe(404);
    expect((await hook('mft_nobody', token, liveEvent('X', 'TRANSIT', Date.now()))).statusCode).toBe(404);
    expect((await hook(carrierId, token, liveEvent('X', 'TRANSIT', Date.now()))).statusCode).toBe(200);
  });

  it.skipIf(!available)('shows the full address once, and after that only a masked one with the webhook\'s own health', async () => {
    const { address, token } = await makeAddress();
    expect(address.startsWith(`https://shop.adminium-test.dev/api/v1/shipping/webhook/${carrierId}?token=`)).toBe(true);
    const first = await call('boss', 'GET', `carriers/${CARRIER}/tracking`);
    const data = (first.json() as Doc)['data'];
    expect(first.body).not.toContain(token);
    expect(data['webhook']).toMatchObject({ supported: true, made: true, firstAt: null, lastAt: null });
    expect(data['webhook']['address']).toContain(`••••${token.slice(-4)}`);
    expect(data['polling']).toEqual({ allowed: false, on: false });

    // A person's Refresh is not a webhook arriving.
    const parcel = await booked('TRK-HEALTH');
    await call('boss', 'POST', `bookings/${parcel.id}/refresh`);
    expect(((await call('boss', 'GET', `carriers/${CARRIER}/tracking`)).json() as Doc)['data']['webhook']['lastAt']).toBeNull();
    await hook(carrierId, token, liveEvent('TRK-HEALTH', 'TRANSIT', Date.now()));
    expect(((await call('boss', 'GET', `carriers/${CARRIER}/tracking`)).json() as Doc)['data']['webhook']['lastAt']).toEqual(expect.any(Number));
  });

  it.skipIf(!available)('makes a new address that ends the old one', async () => {
    const one = await makeAddress();
    const two = await makeAddress();
    expect(two.token).not.toBe(one.token);
    expect((await hook(carrierId, one.token, liveEvent('X', 'TRANSIT', Date.now()))).statusCode).toBe(404);
    expect((await hook(carrierId, two.token, liveEvent('X', 'TRANSIT', Date.now()))).statusCode).toBe(200);
  });

  it.skipIf(!available)('refuses to make an address without a public https one, and keeps the working address', async () => {
    const { token } = await makeAddress();
    await settingsRepo(h.meta).set('system.publicOrigin', 'http://192.168.1.20:4600');
    const res = await call('boss', 'POST', `carriers/${CARRIER}/webhook`);
    await settingsRepo(h.meta).set('system.publicOrigin', 'https://shop.adminium-test.dev');
    expect(res.statusCode).toBe(409);
    expect((res.json() as Doc)['error']['code']).toBe('NO_PUBLIC_ADDRESS');
    expect((await hook(carrierId, token, liveEvent('X', 'TRANSIT', Date.now()))).statusCode).toBe(200);
  });

  it.skipIf(!available)('ends the address when the carrier key is replaced or removed', async () => {
    const { token } = await makeAddress();
    const saved = await call('boss', 'PUT', `carriers/${CARRIER}/key`, { fields: { api_key: NEW_KEY }, confirmAccountChange: true });
    expect(saved.statusCode, saved.body).toBe(200);
    expect((await hook(carrierId, token, liveEvent('X', 'TRANSIT', Date.now()))).statusCode).toBe(404);
    expect((await shippingTrackingRepo(h.meta).install(carrierId))!.tokenHash).toBeNull();

    await saveKey(KEY);
    const second = await makeAddress();
    const removed = await call('boss', 'DELETE', `carriers/${CARRIER}/key`);
    expect(removed.statusCode, removed.body).toBe(200);
    expect((await hook(carrierId, second.token, liveEvent('X', 'TRANSIT', Date.now()))).statusCode).toBe(404);
  });

  it.skipIf(!available)('keeps the address when the same key is saved again', async () => {
    const { token } = await makeAddress();
    const saved = await call('boss', 'PUT', `carriers/${CARRIER}/key`, { fields });
    expect(saved.statusCode, saved.body).toBe(200);
    expect((await hook(carrierId, token, liveEvent('X', 'TRANSIT', Date.now()))).statusCode).toBe(200);
  });

  it.skipIf(!available)('lets someone with the booking right refresh a parcel, and shows no one else', async () => {
    const parcel = await booked('TRK-ROLE');
    globals.__trackingFake!.track = () => [{ at: new Date(Date.now() - 1000).toISOString(), status: 'TRANSIT', description: 'Moving' }];
    const ok = await call('packer', 'POST', `bookings/${parcel.id}/refresh`);
    expect(ok.statusCode, ok.body).toBe(200);
    expect((ok.json() as Doc)['data']).toMatchObject({ outcome: 'updated', track: { status: 'TRANSIT' } });
    expect((await call('reader', 'POST', `bookings/${parcel.id}/refresh`)).statusCode).toBe(403);
    expect((await call('reader', 'POST', 'tracking/refresh')).statusCode).toBe(403);
    expect((await call('packer', 'GET', `carriers/${CARRIER}/tracking`)).statusCode).toBe(403);
    expect((await call('packer', 'POST', `carriers/${CARRIER}/webhook`)).statusCode).toBe(403);
    expect(globals.__trackingFake!.calls).toEqual(['TRK-ROLE']);
  });

  it.skipIf(!available)('hides a parcel on an order this person does not reach, and leaves it out of Refresh open parcels', async () => {
    const mine = await booked('TRK-OWN', { owner: userIds['ownrep']! });
    const theirs = await booked('TRK-OTHER', { owner: userIds['boss']! });
    expect((await call('ownrep', 'POST', `bookings/${theirs.id}/refresh`)).statusCode).toBe(404);
    expect(globals.__trackingFake!.calls).toEqual([]);
    const open = await call('ownrep', 'POST', 'tracking/refresh');
    expect(open.statusCode, open.body).toBe(200);
    expect((open.json() as Doc)['data']).toMatchObject({ outcome: 'done', checked: 1, remaining: 0 });
    expect(globals.__trackingFake!.calls).toEqual(['TRK-OWN']);
    expect((await shippingTrackingRepo(h.meta).parcel(mine.id))!.checkedAt).toEqual(expect.any(Number));
    expect(await shippingTrackingRepo(h.meta).parcel(theirs.id)).toBeNull();
  });

  it.skipIf(!available)('never asks about a test booking, even through the route', async () => {
    const sample = await booked('SHIPPO_TRANSIT', { mode: 'test' });
    const res = await call('boss', 'POST', `bookings/${sample.id}/refresh`);
    expect((res.json() as Doc)['data']['outcome']).toBe('test');
    expect(globals.__trackingFake!.calls).toEqual([]);
  });

  it.skipIf(!available)('refuses to switch polling on, and stores nothing', async () => {
    const res = await call('boss', 'PUT', `carriers/${CARRIER}/polling`, { on: true });
    expect(res.statusCode).toBe(409);
    expect((res.json() as Doc)['error']['code']).toBe('POLLING_LOCKED');
    expect((await shippingTrackingRepo(h.meta).install(carrierId))?.pollOnAt ?? null).toBeNull();
    expect((await call('packer', 'PUT', `carriers/${CARRIER}/polling`, { on: true })).statusCode).toBe(403);
  });

  it.skipIf(!available)('has no polling job or schedule on a booted server', () => {
    const registry = composed.jobs.registry as unknown as { handlers?: Map<string, unknown>; has?: (kind: string) => boolean };
    const kinds = registry.handlers instanceof Map ? [...registry.handlers.keys()] : [];
    expect(kinds).not.toContain('shipping.poll');
    if (registry.has !== undefined) expect(registry.has('shipping.poll')).toBe(false);
  });

  it.skipIf(!available)('writes neither the carrier key nor a webhook token to any reply, log line or audit row', async () => {
    const one = await makeAddress();
    const two = await makeAddress();
    const parcel = await booked('TRK-SWEEP');
    await hook(carrierId, one.token, liveEvent('TRK-SWEEP', 'TRANSIT', Date.now()));
    await hook(carrierId, two.token, liveEvent('TRK-SWEEP', 'TRANSIT', Date.now()));
    await followAll();
    await call('boss', 'POST', `bookings/${parcel.id}/refresh`);
    await call('boss', 'GET', `carriers/${CARRIER}/tracking`);
    const audit = JSON.stringify(await h.meta.db.selectFrom('adminium_audit_log').selectAll().execute());
    const stored = JSON.stringify(await h.meta.db.selectFrom('adminium_shipping_track_installs').selectAll().execute());
    const events = JSON.stringify(await h.meta.db.selectFrom('adminium_shipping_track_events').selectAll().execute());
    expect(audit).toContain('shipping.webhook.made');
    for (const secret of [KEY, one.token, two.token]) {
      expect(logs.some((line) => line.includes(secret)), 'a log line').toBe(false);
      expect(audit, 'an audit row').not.toContain(secret);
      expect(stored, 'the install row').not.toContain(secret);
      expect(events, 'an event row').not.toContain(secret);
    }
    // The address itself is the one reply that holds a token, once.
    expect(replies.filter((body) => body.includes(two.token))).toHaveLength(1);
    expect(replies.some((body) => body.includes(KEY))).toBe(false);
    // The webhook's own request lines were written, with the token taken out.
    expect(logs.some((line) => line.includes('/api/v1/shipping/webhook/'))).toBe(true);
    expect(events).not.toContain('Ada');
  });
});
