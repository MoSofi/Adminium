// SPDX-License-Identifier: AGPL-3.0-only
/**
 * TRACKING THROUGH A REAL SERVER, on all three databases: the webhook with no
 * session, the staff routes with real roles, and a sweep of every reply, log
 * line and audit row for the carrier key and the webhook token.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { manifestsRepo, permissionsRepo, realTableOf, rolesRepo, settingsRepo, shippingBookingsRepo, shippingRepo, shippingTrackingRepo, usersRepo, type ManifestsRepo } from '@adminium/meta';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { addOnCredentialCryptoFromSecret } from '../src/add-ons/credential-crypto.js';
import { buildLogger } from '../src/app.js';
import { composeServer, type ComposedServer } from '../src/compose.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import { matrixRowsFromGrants } from '../src/rbac/permissions.js';
import { factsViewFor } from '../src/routes/pages/column-facts.js';
import { ATTENTION_SCAN, QUIET_PARCEL_MS } from '../src/shipping/attention.js';
import { BOOK_ANSWER_MS } from '../src/shipping/bookings.js';
import { accountFingerprintOf, credentialHash } from '../src/shipping/fingerprint.js';
import { REFRESH_OPEN_WINDOW_MS } from '../src/shipping/refresh.js';
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
    // Reads an order's address and never its money.
    { key: 'nomoney', name: 'No money', permissions: ['table:@orders:read', 'shipping:@:book'], limits: { orders: { readable: ['id', 'number', 'ship_name', 'ship_line1', 'ship_city', 'ship_postcode', 'ship_country', 'tracking'] } } },
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

  async function person(key: string, roles: string[], grants: string[] = []): Promise<void> {
    const user = await usersRepo(h.meta).create({ email: `${key}@track.example`, name: key, passwordHash: await adminPasswordHash() });
    userIds[key] = user.id;
    for (const slug of roles) await rolesRepo(h.meta).assignToUser(user.id, (await rolesRepo(h.meta).findBySlug(slug))!.id);
    if (grants.length > 0) {
      const role = await rolesRepo(h.meta).create({ slug: `track-${key}`, name: `Track ${key}` });
      for (const one of matrixRowsFromGrants(grants).rows) await permissionsRepo(h.meta).grant(role.id, one.resourceKind, one.resourceRef, one.actions as never);
      await rolesRepo(h.meta).assignToUser(user.id, role.id);
    }
    signIns += 1;
    const res = await composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: `10.8.0.${String(signIns)}`, payload: { email: `${key}@track.example`, password: ADMIN_PASSWORD } });
    expect(res.statusCode, res.body).toBe(200);
    cookies[key] = sessionCookie(res.headers['set-cookie']);
  }

  async function attempt(over: { mode?: 'live' | 'test'; owner?: string | null; at?: number } = {}): Promise<{ id: string; rowKey: string }> {
    nextId += 1;
    row += 1;
    const { db } = await h.manager.data(conn);
    await db.insertInto(orders as never).values({ id: nextId, number: `MP-${String(nextId)}`, ship_name: 'Ada Quill', ship_line1: '12 Kiln Lane', ship_city: 'Leeds', ship_postcode: 'LS1 4AB', ship_country: 'GB', owner_id: over.owner ?? null } as never).execute();
    const mode = over.mode ?? 'live';
    const made = await shippingBookingsRepo(h.meta).reserve(
      { installId: shop, carrierInstallId: carrierId, carrierKey: CARRIER, connectionId: conn, tableRef: 'orders', tableName: ordersReal, rowKey: String(nextId), purpose: 'outbound', parcelNumber: 1, reference: `MP-${String(nextId)}`, mode, accountFingerprint: accountFingerprintOf(TEST_SECRET, CARRIER, 'live', undefined, fields), detailsHash: 'd'.repeat(64), service: 'Evri 48', rateCode: 'evri-48', handleSealed: null, quotedAmount: '3.10', quotedCurrency: 'GBP', createdBy: null },
      over.at ?? Date.now(),
    );
    if (!made.ok) throw new Error('no booking');
    await shippingBookingsRepo(h.meta).move(made.booking.id, ['reserved'], 'calling', { calledAt: over.at ?? Date.now() }, over.at ?? Date.now());
    return { id: made.booking.id, rowKey: String(nextId) };
  }

  async function booked(number: string, over: { mode?: 'live' | 'test'; owner?: string | null; at?: number } = {}): Promise<{ id: string; rowKey: string }> {
    const made = await attempt(over);
    await shippingBookingsRepo(h.meta).move(made.id, ['calling'], 'booked', { tracking: number, carrierShipmentId: `tx-${String(row)}`, answeredAt: Date.now() }, Date.now());
    return made;
  }

  /** A bought label with its file in hand, so it needs nobody until something else happens to it. */
  async function filed(number: string, over: { mode?: 'live' | 'test'; owner?: string | null; at?: number } = {}): Promise<{ id: string; rowKey: string }> {
    const made = await booked(number, over);
    await shippingBookingsRepo(h.meta).note(made.id, ['booked'], { labelRef: `file-${made.id}` }, Date.now());
    return made;
  }

  async function attention(who: string): Promise<{ items: Doc[]; more: boolean }> {
    const res = await call(who, 'GET', 'attention');
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as Doc)['data'] as { items: Doc[]; more: boolean };
  }
  const reasonsOf = (list: { items: Doc[] }, id: string): string[] | undefined => list.items.find((one) => one['booking']['id'] === id)?.['reasons'] as string[] | undefined;

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
    await person('nomoney', ['shop-nomoney']);
    // Manages shipping, and still reads only their own orders.
    await person('ownmanager', ['shop-ownrep'], ['system:shipping:manage']);
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

  it.skipIf(!available)('lists each reason a label needs a person, and leaves a healthy one out', async () => {
    const now = Date.now();
    const tracking = shippingTrackingRepo(h.meta);
    const bookings = shippingBookingsRepo(h.meta);
    const unknown = await attempt();
    await bookings.move(unknown.id, ['calling'], 'unknown', { reason: 'no-answer' }, now);
    const paidTwice = await filed('TRK-DUP');
    await bookings.raiseDuplicates(paidTwice.id, 2, now);
    const owed = await booked('TRK-OWED');
    const renumbered = await filed('TRK-OLD');
    expect(await tracking.changeNumber({ bookingId: renumbered.id, carrierInstallId: carrierId, from: 'TRK-OLD', to: 'TRK-NEW', trackingUrl: null, carrierAt: now, at: now })).toBe('changed');
    const failed = await filed('TRK-FAIL');
    await tracking.ensureParcel(failed.id, carrierId, now);
    await tracking.applyStatus(failed.id, 'FAILURE', now - 1000, now);
    const returned = await filed('TRK-BACK');
    await tracking.ensureParcel(returned.id, carrierId, now);
    await tracking.applyStatus(returned.id, 'RETURNED', now - 1000, now);
    const twoMatches = await filed('TRK-TWO');
    await tracking.flag(twoMatches.id, carrierId, 'ambiguous', now);
    const quiet = await filed('TRK-QUIET', { at: now - QUIET_PARCEL_MS - 60_000 });
    const healthy = await filed('TRK-FINE');
    const delivered = await filed('TRK-DONE', { at: now - QUIET_PARCEL_MS - 60_000 });
    await tracking.ensureParcel(delivered.id, carrierId, now);
    await tracking.applyStatus(delivered.id, 'DELIVERED', now - QUIET_PARCEL_MS - 1000, now);
    const pastWindow = await filed('TRK-ANCIENT', { at: now - REFRESH_OPEN_WINDOW_MS - 60_000 });

    const list = await attention('boss');
    expect(reasonsOf(list, unknown.id)).toEqual(['unknown']);
    expect(reasonsOf(list, paidTwice.id)).toEqual(['duplicates']);
    expect(reasonsOf(list, owed.id)).toEqual(['label-owed']);
    expect(reasonsOf(list, renumbered.id)).toEqual(['new-number']);
    expect(reasonsOf(list, failed.id)).toEqual(['tracking-failed']);
    expect(reasonsOf(list, returned.id)).toEqual(['returned']);
    expect(reasonsOf(list, twoMatches.id)).toEqual(['ambiguous']);
    expect(reasonsOf(list, quiet.id)).toEqual(['quiet']);
    for (const none of [healthy, delivered, pastWindow]) expect(reasonsOf(list, none.id)).toBeUndefined();
    expect(list.more).toBe(false);
    const item = list.items.find((one) => one['booking']['id'] === failed.id)!;
    expect(item['reference']).toBe(`MP-${failed.rowKey}`);
    expect(item['source']).toEqual({ table: 'orders', id: failed.rowKey });
    expect(item['booking']['track']).toMatchObject({ status: 'FAILURE' });
  });

  it.skipIf(!available)('puts a purchase with no answer first, then the oldest, and changes nothing by reading', async () => {
    const now = Date.now();
    const bookings = shippingBookingsRepo(h.meta);
    const oldest = await booked('TRK-A', { at: now - BOOK_ANSWER_MS - 5_000_000 });
    const middle = await booked('TRK-B', { at: now - BOOK_ANSWER_MS - 3_000_000 });
    // Nobody is waiting on this call any more, so it reads as unknown though the row still says calling.
    const staleAt = now - BOOK_ANSWER_MS - 60_000;
    const stale = await attempt({ at: staleAt });
    const unanswered = await attempt({ at: staleAt + 1_000 });
    await bookings.move(unanswered.id, ['calling'], 'unknown', { reason: 'no-answer' }, now);
    const stillCalling = await attempt();

    const list = await attention('boss');
    expect(list.items.map((one) => one['booking']['id'])).toEqual([stale.id, unanswered.id, oldest.id, middle.id]);
    expect(reasonsOf(list, stale.id)).toEqual(['unknown']);
    expect(list.items[0]!['booking']['state']).toBe('unknown');
    expect(reasonsOf(list, stillCalling.id)).toBeUndefined();
    expect((await bookings.byId(stale.id))!.state).toBe('calling');
  });

  it.skipIf(!available)('lists only the rows this person reaches, and counts no other', async () => {
    const mine = await booked('TRK-MINE', { owner: userIds['ownrep']! });
    const theirs = await booked('TRK-THEIRS', { owner: userIds['boss']! });
    const list = await attention('ownrep');
    expect(list.items.map((one) => one['booking']['id'])).toEqual([mine.id]);
    expect(list.more).toBe(false);
    expect(JSON.stringify(list)).not.toContain('TRK-THEIRS');
    expect(reasonsOf(await attention('boss'), theirs.id)).toEqual(['label-owed']);
  });

  it.skipIf(!available)('gives someone who cannot see money no amount', async () => {
    const parcel = await booked('TRK-PRICE');
    const seen = await attention('boss');
    expect(seen.items[0]!['booking']).toMatchObject({ id: parcel.id, amount: '3.10', currency: 'GBP' });
    const res = await call('nomoney', 'GET', 'attention');
    expect(res.statusCode, res.body).toBe(200);
    const booking = (res.json() as Doc)['data']['items'][0]['booking'];
    expect(booking['id']).toBe(parcel.id);
    for (const field of ['amount', 'currency', 'chargeDiffers']) expect(booking).not.toHaveProperty(field);
    expect(res.body).not.toContain('3.10');
    expect(res.body).not.toContain('GBP');
  });

  it.skipIf(!available)('shows a test booking only while its purchase has no answer, with no tracking reason', async () => {
    const now = Date.now();
    const tracking = shippingTrackingRepo(h.meta);
    const bookings = shippingBookingsRepo(h.meta);
    const unknown = await attempt({ mode: 'test' });
    await bookings.move(unknown.id, ['calling'], 'unknown', { reason: 'no-answer' }, now);
    await bookings.raiseDuplicates(unknown.id, 1, now);
    const sample = await booked('SHIPPO_TRANSIT', { mode: 'test', at: now - QUIET_PARCEL_MS - 60_000 });
    await bookings.raiseDuplicates(sample.id, 1, now);
    await tracking.ensureParcel(sample.id, carrierId, now);
    await tracking.applyStatus(sample.id, 'FAILURE', now - 1000, now);
    await tracking.flag(sample.id, carrierId, 'ambiguous', now);

    const list = await attention('boss');
    expect(list.items.map((one) => one['booking']['id'])).toEqual([unknown.id]);
    expect(list.items[0]!['reasons']).toEqual(['unknown']);
    expect(list.items[0]!['booking']['test']).toBe(true);
  });

  it.skipIf(!available)('refuses someone with no right on the labels, and calls no carrier for anyone', async () => {
    const parcel = await booked('TRK-QUIETLY');
    const refused = await call('reader', 'GET', 'attention');
    expect(refused.statusCode).toBe(403);
    expect(refused.body).not.toContain('TRK-QUIETLY');
    const res = await call('boss', 'GET', 'attention');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.body).toContain(parcel.id);
    expect(globals.__trackingFake!.calls).toEqual([]);
    for (const secret of [KEY, 'tx-', 'Ada', 'Kiln']) expect(res.body).not.toContain(secret);
  });

  async function unknownOnDeletedOrder(over: { owner?: string | null } = {}): Promise<{ id: string; rowKey: string }> {
    const made = await attempt(over);
    await shippingBookingsRepo(h.meta).move(made.id, ['calling'], 'unknown', { reason: 'no-answer' }, Date.now());
    const { db } = await h.manager.data(conn);
    await db.deleteFrom(orders as never).where('id' as never, '=', Number(made.rowKey) as never).execute();
    return made;
  }

  it.skipIf(!available)('shows someone who manages shipping an unknown booking whose order was deleted', async () => {
    const gone = await unknownOnDeletedOrder();
    const live = await booked('TRK-STILL-HERE');
    const list = await attention('boss');
    const item = list.items.find((one) => one['booking']['id'] === gone.id)!;
    expect(item).toMatchObject({ reasons: ['unknown'], orderGone: true, reference: `MP-${gone.rowKey}`, source: { table: 'orders', id: gone.rowKey }, booking: { state: 'unknown', amount: '3.10' } });
    expect(list.items.find((one) => one['booking']['id'] === live.id)!['orderGone']).toBe(false);
    expect(globals.__trackingFake!.calls).toEqual([]);
  });

  it.skipIf(!available)('does not show that booking to someone who only books', async () => {
    const gone = await unknownOnDeletedOrder();
    const res = await call('packer', 'GET', 'attention');
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as Doc)['data']['items']).toEqual([]);
    expect(res.body).not.toContain(gone.id);
    expect(res.body).not.toContain(`MP-${gone.rowKey}`);
  });

  it.skipIf(!available)('leaves out a label on a deleted order once it no longer has an unknown result', async () => {
    const made = await booked('TRK-ORDER-GONE');
    const { db } = await h.manager.data(conn);
    await db.deleteFrom(orders as never).where('id' as never, '=', Number(made.rowKey) as never).execute();
    expect(reasonsOf(await attention('boss'), made.id)).toBeUndefined();
  });

  it.skipIf(!available)('never calls a row someone merely cannot reach a deleted order', async () => {
    const hidden = await attempt({ owner: userIds['boss']! });
    await shippingBookingsRepo(h.meta).move(hidden.id, ['calling'], 'unknown', { reason: 'no-answer' }, Date.now());
    for (const who of ['ownrep', 'ownmanager']) {
      const res = await call(who, 'GET', 'attention');
      expect(res.statusCode, res.body).toBe(200);
      expect((res.json() as Doc)['data']['items'], who).toEqual([]);
      expect(res.body).not.toContain(hidden.id);
    }
    expect((await attention('boss')).items[0]).toMatchObject({ orderGone: false, booking: { id: hidden.id } });
  });

  it.skipIf(!available)('says when the scan was cut, keeping what has no answer in front', async () => {
    const seed = await booked('TRK-SEED');
    const source = await h.meta.db.selectFrom('adminium_shipping_bookings').selectAll().where('id', '=', seed.id).executeTakeFirstOrThrow();
    const copies = Array.from({ length: ATTENTION_SCAN }, (_, index) => ({ ...source, id: `shb_scan_${String(index)}`, openKey: null, createdAt: Number(source.createdAt) - 1000 - index }));
    for (let at = 0; at < copies.length; at += 100) await h.meta.db.insertInto('adminium_shipping_bookings').values(copies.slice(at, at + 100) as never).execute();
    const unknown = await attempt();
    await shippingBookingsRepo(h.meta).move(unknown.id, ['calling'], 'unknown', { reason: 'no-answer' }, Date.now());

    const list = await attention('boss');
    expect(list.more).toBe(true);
    expect(list.items).toHaveLength(ATTENTION_SCAN);
    expect(list.items[0]!['booking']['id']).toBe(unknown.id);
  }, 120_000);

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
