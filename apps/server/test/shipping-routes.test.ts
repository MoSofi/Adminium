// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN APP'S SHIPPING ON THE REAL SERVER, on SQLite, Postgres and MySQL: fake
 * carriers in-process (no network), a real app with real orders, real people
 * with real grants and row limits.
 *
 *  - every refusal a screen must explain, each with its stable code;
 *  - an app released before real carriers cannot reach one, whatever is sent;
 *  - an address in the body is refused: the server reads the order;
 *  - a person without the table or the row gets no price and no carrier call;
 *  - a new quote voids the last, and an edited order reads as stale;
 *  - no carrier handle or address in a reply, a quote row, a log or an audit;
 *  - two databases on one server keep their own carrier, choice and Ship from;
 *  - a carrier key is checked before it is saved, says test or live from the
 *    carrier's answer, and reaches no reply, log, audit row or plain column;
 *  - booking is a per-person, per-install right inside the owner's limits, and
 *    someone who cannot see money gets no price, no price order and no carrier words;
 *  - a label is bought once from a stored quote, by a person, and what follows
 *    it writes the tracking number once and moves no status.
 */
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { apiKeysRepo, appTablesRepo, manifestsRepo, permissionsRepo, rolesRepo, settingsRepo, shippingBookingsRepo, shippingRepo, usersRepo, type ManifestsRepo, type ShippingSlot } from '@adminium/meta';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { addOnCredentialCryptoFromSecret } from '../src/add-ons/credential-crypto.js';
import { composeServer, type ComposedServer } from '../src/compose.js';
import { runIntrospection } from '../src/connections/introspect.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import { generateApiKey } from '../src/rbac/api-keys.js';
import { matrixRowsFromGrants } from '../src/rbac/permissions.js';
import { collectKnownSecrets } from '../src/apps/save/gates/secrets.js';
import { readReachedRow } from '../src/crud/row-reached.js';
import { createWriteService, HookRejectedError } from '../src/crud/write-service.js';
import { writeStores } from '../src/crud/write-stores.js';
import { createPayableSources, type PayableSources } from '../src/payments/payables.js';
import { factsViewFor } from '../src/routes/pages/column-facts.js';
import { shippingRoutes } from '../src/routes/shipping/index.js';
import { orderAddress, shipFromAddress } from '../src/shipping/addresses.js';
import { accountFingerprintOf, credentialHash } from '../src/shipping/fingerprint.js';
import type { OpenBookings } from '../src/shipping/keys.js';
import { applyBooking, type ApplyDeps } from '../src/shipping/apply.js';
import { RELEASE_QUIET_MS } from '../src/shipping/bookings.js';
import { QUOTE_LIFE_MS, readQuoteForBooking } from '../src/shipping/quotes.js';
import { addOnHarness, addOnManifest, type Dialect, type Harness } from './app-add-ons.helpers.js';
import { adminPasswordHash, ADMIN_PASSWORD, sessionCookie } from './auth-helpers.js';
import { makeEnv, TEST_SECRET } from './helpers.js';
import { LEGS } from './invoicing-install.helpers.js';

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- a reply read freely

const REF = 'carrier-handle-do-not-show';
const TOKEN = 'carrier-token-do-not-show';
const KEY_ONE = 'test-carrier-value-one';
const KEY_TWO = 'test-carrier-value-two';
const STREET = '12 Kiln Lane';
const PHONE = '+44 7700 900123';
const EMAIL = 'ada@quill.example';
const NAME = 'Ada Quill';
const SHIP_FROM = { name: 'Marlow Press', lines: ['1 Mill Yard'], city: 'Marlow', postcode: 'SL7 1AA', country: 'GB', phone: '+44 1628 000000' };
const PARCEL = { weightKg: 1.25, lengthCm: 30, widthCm: 20, heightCm: 10, contents: 'Printed books' };
const LABEL_ID = 'carrier-label-id-do-not-show';
const SHIPMENT_ID = 'carrier-shipment-id-do-not-show';
const RATE = { code: 'evri-48', service: 'Evri 48', amount: 3.1, amountDecimal: '3.10', currency: 'GBP', ref: REF, carrierToken: TOKEN, carrier: 'Evri', handover: 'drop-off', tracked: true };

const SHIPMENT = { id: SHIPMENT_ID, tracking: 'TRK-1001', labelFileId: LABEL_ID, carrier: 'Evri', rate: { code: 'evri-48', service: 'Evri 48', amount: 3.1, amountDecimal: '3.10', currency: 'GBP', ref: REF } };

/** What each made carrier was handed, and what a test makes `quote` do. */
interface Fake {
  made: { key: string; credentials: Record<string, string>; todayIso: string }[];
  quotes: { key: string; parcel: Doc; from: Doc; to: Doc; options: Doc }[];
  quote?: (key: string) => unknown;
  /** What `checkCredentials` answers; a test key that sells everywhere unless a test says otherwise. */
  check?: (key: string, credentials: Record<string, string>, query: Doc) => unknown;
  checks: { key: string; query: Doc }[];
  /** What `book` answers, and every purchase it was asked for. */
  book?: (key: string) => unknown;
  books: { key: string; rate: Doc; order: Doc; details: Doc }[];
  recover?: (key: string, order: Doc) => unknown;
  /** What `fetchDocument` answers, and every file asked for. */
  fetchDocument?: (key: string, id: string, kind: string) => unknown;
  fetches?: { key: string; id: string; kind: string }[];
}
const globals = globalThis as unknown as { __shippingFake?: Fake };
const fake = (): Fake => globals.__shippingFake!;

const serverJs = (key: string) => `export function createShippingCarrier(context) {
  const fake = globalThis.__shippingFake;
  fake.made.push({ key: ${JSON.stringify(key)}, credentials: { ...context.credentials }, todayIso: context.todayIso });
  return {
    key: ${JSON.stringify(key)},
    quote: async (parcel, from, to, options) => {
      fake.quotes.push({ key: ${JSON.stringify(key)}, parcel, from, to, options });
      return fake.quote(${JSON.stringify(key)});
    },
    book: async (rate, order, details) => {
      fake.books.push({ key: ${JSON.stringify(key)}, rate, order, details });
      return fake.book(${JSON.stringify(key)});
    },
    recover: async (order) => fake.recover(${JSON.stringify(key)}, order),
    fetchDocument: async (id, kind) => {
      fake.fetches.push({ key: ${JSON.stringify(key)}, id, kind });
      return fake.fetchDocument(${JSON.stringify(key)}, id, kind);
    },
    track: async () => [],
    label: async () => { throw new Error('never in these tests'); },
    cancel: async () => undefined,
    checkCredentials: async (query) => {
      fake.checks.push({ key: ${JSON.stringify(key)}, query: query ?? {} });
      return fake.check(${JSON.stringify(key)}, context.credentials, query ?? {});
    },
  };
}
`;

const ADDRESS_COLUMNS = ['ship_name', 'ship_line1', 'ship_line2', 'ship_city', 'ship_region', 'ship_postcode', 'ship_country', 'ship_phone', 'ship_email', 'ship_company'];
const text = (ref: string, maxLength = 120) => ({ ref, type: 'text', maxLength, nullable: true });

function shopDoc(key: string, shipping: boolean): Record<string, unknown> {
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
    compatibility: { minAdminiumVersion: shipping ? '0.3.72' : '0.3.70', engines: ['postgres', 'mysql', 'sqlite'] },
    requiredSchema: {
      prefixed: true,
      tables: [
        {
          ref: 'orders',
          columns: [
            { ref: 'id', type: 'int', role: 'pk' },
            text('number', 40),
            text('ship_name'),
            text('ship_line1'),
            text('ship_line2'),
            text('ship_city'),
            text('ship_region'),
            text('ship_postcode', 20),
            text('ship_country', 40),
            text('ship_phone', 40),
            text('ship_email'),
            text('ship_company'),
            text('tracking', 64),
            text('carrier_name', 80),
            { ref: 'status', type: 'text', maxLength: 20, nullable: true },
            { ...text('owner_id', 36), rules: { staff: true } },
          ],
          belongs: [{ column: 'owner_id', set: 'team' }],
        },
        { ref: 'notes', columns: [{ ref: 'id', type: 'int', role: 'pk' }, text('body')] },
      ],
    },
    roles: [
      { key: 'rep', name: 'Rep', permissions: ['table:@orders:read'], limits: { orders: { rows: { read: { reach: 'own' } } } } },
      ...(shipping
        ? [
            // Reads an order's address and never its money: the role Online Shop's packer has.
            { key: 'packer', name: 'Packer', permissions: ['table:@orders:read', 'shipping:@:book'], limits: { orders: { readable: ['id', 'number', ...ADDRESS_COLUMNS] } } },
            { key: 'picker', name: 'Picker', permissions: ['table:@orders:read', 'shipping:@:book'] },
            { key: 'refunder', name: 'Refunder', permissions: ['table:@orders:read', 'shipping:@:cancel'] },
            { key: 'bench', name: 'Bench', screensOnly: true, permissions: ['app:@:staff', 'table:@orders:read', 'shipping:@:book'], limits: { orders: { readable: ['id', 'number', ...ADDRESS_COLUMNS] } } },
          ]
        : []),
    ],
    pages: [{ ref: `${key}-orders`, template: 'page-crud', title: { key: 't', fallback: 'Orders' }, nav: { group: 'shop', icon: 'home', order: 1 }, bindings: { rows: 'orders' } }],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
    ...(shipping
      ? {
          shipping: {
            orders: [
              {
                table: 'orders',
                reference: 'number',
                tracking: 'tracking',
                carrier: 'carrier_name',
                address: { name: 'ship_name', lines: ['ship_line1', 'ship_line2'], city: 'ship_city', region: 'ship_region', postcode: 'ship_postcode', country: 'ship_country', phone: 'ship_phone', email: 'ship_email', company: 'ship_company' },
              },
            ],
          },
        }
      : {}),
  };
}

const carrierDoc = (key: string) =>
  addOnManifest(key, {
    categories: ['delivery'],
    capabilities: ['outbound-http'],
    settings: [{ key: 'api_key', type: 'string', secret: true }],
    addOn: { provides: [{ contract: 'shipping-carrier', version: 1, server: 'dist/server.js' }], network: { allow: ['api.carrier.example'] } },
  });

/** A database of its own on the same server, whichever the engine. */
async function anotherDatabase(h: Harness, dialect: Dialect): Promise<{ id: string; drop: () => Promise<void> }> {
  if (dialect === 'sqlite') return { id: await h.addConnection('Second'), drop: async () => undefined };
  const name = `adminium_ship_${randomBytes(4).toString('hex')}`;
  let dsn: string;
  let drop: () => Promise<void>;
  if (dialect === 'postgres') {
    const { Client } = await import('pg');
    const base = process.env['TEST_POSTGRES_URL'] as string;
    const admin = new Client({ connectionString: base });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${name}`);
    await admin.end();
    const url = new URL(base);
    url.pathname = `/${name}`;
    dsn = url.toString();
    drop = async () => {
      const again = new Client({ connectionString: base });
      await again.connect();
      await again.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await again.end();
    };
  } else {
    const mysql = await import('mysql2/promise');
    const base = process.env['TEST_MYSQL_URL'] as string;
    const admin = await mysql.createConnection(base);
    await admin.query(`CREATE DATABASE \`${name}\``);
    await admin.end();
    const url = new URL(base);
    url.pathname = `/${name}`;
    dsn = url.toString();
    drop = async () => {
      const again = await mysql.createConnection(base);
      await again.query(`DROP DATABASE IF EXISTS \`${name}\``);
      await again.end();
    };
  }
  const made = await h.manager.connections.create({ name: 'Second', engine: dialect, introspectDsn: dsn, dataDsn: dsn });
  await runIntrospection({ manager: h.manager, meta: h.meta, connectionId: made.id });
  return { id: made.id, drop };
}

describe.each(LEGS)('an app\'s shipping on %s', (dialect, available) => {
  let h: Harness;
  let composed: ComposedServer;
  let root: string;
  let repo: ManifestsRepo;
  let conn = '';
  let second: { id: string; drop: () => Promise<void> };
  let trusted: string | undefined;
  let signIns = 0;
  let nextId = 100;
  const installs: Record<string, string> = {};
  const tables: Record<string, string> = {};
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const logs: string[] = [];

  const call = (who: string, method: 'GET' | 'PUT' | 'POST', path: string, payload?: unknown, url?: string) =>
    composed.app.inject({ method, url: url ?? `/api/v1/apps/${path}?connectionId=${encodeURIComponent(conn)}`, headers: { cookie: cookies[who]! }, ...(payload === undefined ? {} : { payload: payload as Doc }) });
  const quote = (path: string, body: Doc, who = 'boss') => call(who, 'POST', `${path}/shipping/quotes`, body);
  const code = (res: { json(): unknown }) => (res.json() as Doc)['error']?.code as string | undefined;
  const settings = () => shippingRepo(h.meta);

  async function order(app: string, over: Doc = {}, connectionId = conn): Promise<string> {
    nextId += 1;
    const values = { id: nextId, number: `MP-${String(nextId)}`, ship_name: NAME, ship_line1: STREET, ship_line2: null, ship_city: 'Leeds', ship_region: null, ship_postcode: 'LS1 4AB', ship_country: 'GB', ship_phone: PHONE, ship_email: EMAIL, ship_company: null, owner_id: null, ...over };
    const { db } = await h.manager.data(connectionId);
    await db.insertInto(tables[`${connectionId}:${app}`]! as never).values(values as never).execute();
    return String(nextId);
  }

  async function editOrder(app: string, id: string, change: Doc): Promise<void> {
    const { db } = await h.manager.data(conn);
    await db.updateTable(tables[`${conn}:${app}`]! as never).set(change as never).where('id' as never, '=', Number(id) as never).execute();
  }

  const body = (id: string, over: Doc = {}) => ({ source: { table: 'orders', id }, parcel: PARCEL, ...over });
  const slot = (id: string, over: Partial<ShippingSlot> = {}): ShippingSlot => ({ installId: installs['shop']!, connectionId: conn, tableRef: 'orders', rowKey: id, purpose: 'outbound', parcelNumber: 1, ...over });

  async function person(key: string, roleSlugs: string[], grants: string[]): Promise<void> {
    const user = await usersRepo(h.meta).create({ email: `${key}@press.example`, name: key, passwordHash: await adminPasswordHash() });
    ids[key] = user.id;
    for (const slug of roleSlugs) await rolesRepo(h.meta).assignToUser(user.id, (await rolesRepo(h.meta).findBySlug(slug))!.id);
    if (grants.length > 0) {
      const role = await rolesRepo(h.meta).create({ slug: `ship-${key}`, name: `Ship ${key}` });
      for (const row of matrixRowsFromGrants(grants).rows) await permissionsRepo(h.meta).grant(role.id, row.resourceKind, row.resourceRef, row.actions as never);
      await rolesRepo(h.meta).assignToUser(user.id, role.id);
    }
    signIns += 1;
    const res = await composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: `10.9.0.${String(signIns)}`, payload: { email: `${key}@press.example`, password: ADMIN_PASSWORD } });
    expect(res.statusCode, res.body).toBe(200);
    cookies[key] = sessionCookie(res.headers['set-cookie']);
  }

  async function addCarrier(key: string, hosts: { key: string; hostInstall: string }[], connectionId: string = conn, credential?: string): Promise<string> {
    const made = await repo.install({ manifestKey: key, version: '1.0.0', kind: 'add-on', source: 'file', document: carrierDoc(key), connectionId, status: 'installed', attachTo: hosts });
    if (credential !== undefined) await saveChecked(made.row.id, key, credential);
    return made.row.id;
  }

  /** A key saved as the key door saves it: with what the carrier said of it. */
  async function saveChecked(installId: string, key: string, credential: string, mode: 'live' | 'test' = 'live'): Promise<void> {
    const fields = { api_key: credential };
    await repo.setCredential(installId, { kind: 'api-key', secret: fields });
    await settings().saveAccount({ carrierInstallId: installId, mode, fingerprint: accountFingerprintOf(TEST_SECRET, key, mode, undefined, fields), keyHash: credentialHash(TEST_SECRET, key, fields), keyHint: credential.slice(-4), state: 'ok', carriers: ['Evri'], checkedBy: null, checkedAt: 1 });
  }

  beforeAll(async () => {
    if (!available) return;
    globals.__shippingFake = { made: [], quotes: [], checks: [], books: [], fetches: [] };
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    conn = h.connectionId;
    repo = manifestsRepo(h.meta, addOnCredentialCryptoFromSecret(TEST_SECRET));
    second = await anotherDatabase(h, dialect);

    for (const [key, withBlock] of [['shop', true], ['legacy', false], ['solo', true], ['bare', true], ['gone', true]] as const) {
      await h.stageApp(shopDoc(key, withBlock));
      const res = await h.install(key, '1.0.0', { shippingUnticked: [] });
      expect(res.statusCode, res.body).toBe(200);
    }
    const onSecond = await h.inject({ method: 'POST', url: '/apps/install', payload: { shippingUnticked: [], key: 'shop', version: '1.0.0', connectionId: second.id } });
    expect(onSecond.statusCode, onSecond.body).toBe(200);

    for (const install of await repo.list('app')) if (install.row.scopeKey === conn) installs[install.row.manifestKey] = install.row.id;
    installs['shop@second'] = (await repo.findInScope('shop', second.id))!.row.id;
    for (const record of await h.meta.db.selectFrom('adminium_app_tables').select(['connectionId', 'appKey', 'ref', 'tableName']).execute()) {
      if (record.ref === 'orders') tables[`${record.connectionId}:${record.appKey}`] = record.tableName;
    }

    const CARRIERS = ['carrier-one', 'carrier-two', 'carrier-keyless', 'shipping-dhl', 'carrier-unvouched', 'carrier-no-factory', 'carrier-solo', 'carrier-elsewhere'];
    for (const key of CARRIERS) {
      await h.stageAddOn(carrierDoc(key), { files: { 'dist/server.js': key === 'carrier-no-factory' ? 'export const nothing = 1;\n' : serverJs(key) } });
    }
    const on = (key: string) => [{ key, hostInstall: installs[key]! }];
    const shop = on('shop');
    await addCarrier('carrier-one', [...shop, ...on('legacy'), { key: 'shop', hostInstall: installs['shop@second']! }], conn, KEY_ONE);
    // The same carrier's own install, and key, on the second database.
    await repo.install({ manifestKey: 'carrier-one', version: '1.0.0', kind: 'add-on', source: 'file', document: carrierDoc('carrier-one'), connectionId: second.id, instanceSlug: 'second', status: 'installed' }).then((made) => saveChecked(made.row.id, 'carrier-one', KEY_TWO));
    await addCarrier('carrier-two', shop, conn, KEY_TWO);
    await addCarrier('carrier-keyless', shop);
    await addCarrier('shipping-dhl', shop, conn, 'test-dhl-value');
    await addCarrier('carrier-unvouched', shop, conn, KEY_ONE);
    await addCarrier('carrier-no-factory', shop, conn, KEY_ONE);
    await addCarrier('carrier-solo', on('solo'), conn, KEY_ONE);
    await addCarrier('carrier-elsewhere', on('bare'), second.id, KEY_ONE);

    // A server past the release that carried old packages over: a package nobody vouched for stays unloaded.
    await settingsRepo(h.meta).set('addOns.trustCarriedOver', true);
    trusted = process.env['ADMINIUM_ADD_ON_DEV_TRUST'];
    process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = CARRIERS.filter((key) => key !== 'carrier-unvouched').join(',');
    root = await mkdtemp(join(tmpdir(), 'shipping-routes-'));
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
      // Every line the server logs, so a test can say what never reaches one.
      logger: pino({ level: 'trace' }, { write: (line: string) => void logs.push(line) }),
      telemetry: false,
      shippingQuotesPerMinute: 100_000,
    });
    await composed.app.ready();
    await composed.addOnsLoaded;
    await composed.jobs.worker.stop();
    composed.jobs.scheduler.stop();

    await person('boss', ['super-admin'], []);
    await person('nobody', [], []);
    await person('clerk', [], ['system:shipping:manage']);
    await person('rep', ['shop-rep'], ['system:shipping:manage']);
    await person('admin', ['admin'], []);
    await person('packer', ['shop-packer'], []);
    await person('picker', ['shop-picker'], []);
    await person('refunder', ['shop-refunder'], []);
    await person('bench', ['shop-bench'], []);
  }, 300_000);

  afterAll(async () => {
    if (!available) return;
    if (trusted === undefined) delete process.env['ADMINIUM_ADD_ON_DEV_TRUST'];
    else process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = trusted;
    await composed?.app.close();
    await second?.drop();
    await h?.close();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
    delete globals.__shippingFake;
  });

  beforeEach(async () => {
    if (!available) return;
    const state = fake();
    state.made.length = 0;
    state.quotes.length = 0;
    state.checks.length = 0;
    state.books.length = 0;
    state.book = () => SHIPMENT;
    state.recover = () => ({ outcome: 'no-match' });
    state.fetches!.length = 0;
    state.fetchDocument = () => {
      throw new Error('no label in this test');
    };
    await h.meta.db.deleteFrom('adminium_shipping_bookings').execute();
    state.quote = () => [RATE];
    state.check = () => ({ outcome: 'ok', mode: 'live', carriers: ['Evri', 'DPD'] });
    for (const id of Object.values(installs)) await settings().forgetInstall(id);
    for (const key of ['shop', 'legacy', 'solo', 'bare']) await settings().setShipFrom(installs[key]!, SHIP_FROM, null, 1);
    await settings().setActiveCarrier(installs['shop']!, 'carrier-one', null, 1);
  });

  // ── Refusals ────────────────────────────────────────────────────────────

  it.skipIf(!available)('an app released with no shipping block cannot reach a carrier, whatever is sent', async () => {
    const id = await order('legacy');
    await settings().setActiveCarrier(installs['legacy']!, 'carrier-one', null, 1);
    const res = await quote('legacy', body(id));
    expect(res.statusCode, res.body).toBe(409);
    expect((res.json() as Doc)['error']).toMatchObject({ code: 'APP_NOT_UPDATED', details: { app: 'legacy' } });
    expect(fake().made).toEqual([]);
    const status = await call('boss', 'GET', 'legacy/shipping');
    expect((status.json() as Doc)['data']['appUpdated']).toBe(false);
  });

  it.skipIf(!available)('refuses a table the app did not declare', async () => {
    const res = await quote('shop', { ...body('1'), source: { table: 'notes', id: '1' } });
    expect(res.statusCode, res.body).toBe(422);
    expect((res.json() as Doc)['error']).toMatchObject({ code: 'NOT_A_SHIPPING_TABLE', details: { table: 'notes' } });
    expect(fake().made).toEqual([]);
  });

  it.skipIf(!available)('refuses with no carrier chosen among several, and installing another never switches a shop', async () => {
    const id = await order('shop');
    await settings().forgetInstall(installs['shop']!);
    await settings().setShipFrom(installs['shop']!, SHIP_FROM, null, 1);
    const res = await quote('shop', body(id));
    expect(res.statusCode, res.body).toBe(409);
    expect(code(res)).toBe('NO_ACTIVE_CARRIER');
    expect((res.json() as Doc)['error']['details']['carriers']).toContain('carrier-two');
    expect(fake().made).toEqual([]);
  });

  it.skipIf(!available)('refuses DHL as locked and builds nothing, though it may stay the chosen carrier', async () => {
    const id = await order('shop');
    const set = await call('boss', 'PUT', 'shop/shipping/active-carrier', { carrier: 'shipping-dhl' });
    expect(set.statusCode, set.body).toBe(200);
    expect((set.json() as Doc)['data']['activeCarrier']).toBe('shipping-dhl');
    const dhl = ((set.json() as Doc)['data']['carriers'] as Doc[]).find((one) => one['key'] === 'shipping-dhl');
    // Its key is saved, and is not even asked about.
    expect(dhl).toMatchObject({ locked: true, connected: false });
    const res = await quote('shop', body(id));
    expect(res.statusCode, res.body).toBe(409);
    expect(code(res)).toBe('CARRIER_LOCKED');
    expect(fake().made).toEqual([]);
  });

  it.skipIf(!available)('refuses a carrier that is not on this database', async () => {
    const id = await order('bare');
    const res = await quote('bare', body(id));
    expect(res.statusCode, res.body).toBe(409);
    expect((res.json() as Doc)['error']).toMatchObject({ code: 'CARRIER_NOT_INSTALLED', details: { carrier: 'carrier-elsewhere' } });
    expect(fake().made).toEqual([]);
    // And it cannot be chosen, nor can a key nobody attached.
    expect(code(await call('boss', 'PUT', 'bare/shipping/active-carrier', { carrier: 'carrier-elsewhere' }))).toBe('CARRIER_SWITCHED_OFF');
    expect(code(await call('boss', 'PUT', 'bare/shipping/active-carrier', { carrier: 'carrier-nobody' }))).toBe('CARRIER_NOT_INSTALLED');
  });

  it.skipIf(!available)('refuses a carrier switched off, for the whole server or for this app alone', async () => {
    const id = await order('solo');
    const carrier = (await repo.findInScope('carrier-solo', conn))!;
    await repo.setAttachmentEnabled(carrier.row.id, { key: 'solo', hostInstall: installs['solo']! }, false);
    const forApp = await quote('solo', body(id));
    expect(forApp.statusCode, forApp.body).toBe(409);
    expect(code(forApp)).toBe('CARRIER_SWITCHED_OFF');
    expect(code(await call('boss', 'PUT', 'solo/shipping/active-carrier', { carrier: 'carrier-solo' }))).toBe('CARRIER_SWITCHED_OFF');
    await repo.setAttachmentEnabled(carrier.row.id, { key: 'solo', hostInstall: installs['solo']! }, true);

    await h.meta.db.updateTable('adminium_manifests').set({ status: 'disabled' }).where('id', '=', carrier.row.id).execute();
    expect(code(await quote('solo', body(id)))).toBe('CARRIER_SWITCHED_OFF');
    await h.meta.db.updateTable('adminium_manifests').set({ status: 'installed' }).where('id', '=', carrier.row.id).execute();
    expect(fake().made).toEqual([]);
  });

  it.skipIf(!available)('refuses a carrier whose code was not vouched for, has no factory, or has no key', async () => {
    const id = await order('shop');
    for (const [key, expected] of [['carrier-unvouched', 'CARRIER_NOT_LOADED'], ['carrier-no-factory', 'CARRIER_NO_FACTORY'], ['carrier-keyless', 'CARRIER_NO_CREDENTIAL']] as const) {
      await settings().setActiveCarrier(installs['shop']!, key, null, 2);
      const res = await quote('shop', body(id));
      expect(res.statusCode, `${key}: ${res.body}`).toBe(409);
      expect(code(res), key).toBe(expected);
    }
    expect(fake().made).toEqual([]);
    // Choosing a carrier needs a saved key.
    const chosen = await call('boss', 'PUT', 'shop/shipping/active-carrier', { carrier: 'carrier-keyless' });
    expect(code(chosen)).toBe('CARRIER_NO_CREDENTIAL');
  });

  it.skipIf(!available)('names what Ship from lacks, and what the order lacks, before any carrier is built', async () => {
    const id = await order('shop');
    await settings().setShipFrom(installs['shop']!, { name: 'Marlow Press', city: 'Marlow' }, null, 2);
    const from = await quote('shop', body(id));
    expect(from.statusCode, from.body).toBe(422);
    expect((from.json() as Doc)['error']).toMatchObject({ code: 'SHIP_FROM_INCOMPLETE', details: { fields: ['lines', 'postcode', 'country', 'phone'] } });

    await settings().setShipFrom(installs['shop']!, SHIP_FROM, null, 3);
    const gaps = await order('shop', { ship_name: '  ', ship_line1: null, ship_city: '', ship_postcode: null });
    const to = await quote('shop', body(gaps));
    expect(to.statusCode, to.body).toBe(422);
    expect((to.json() as Doc)['error']).toMatchObject({ code: 'ADDRESS_INCOMPLETE', details: { fields: ['name', 'lines', 'city', 'postcode'] } });
    expect(fake().made).toEqual([]);
  });

  it.skipIf(!available)('refuses a country not recorded, and one abroad, before any carrier or key is touched', async () => {
    for (const country of [null, '', 'United Kingdom', 'G1']) {
      const id = await order('shop', { ship_country: country });
      const res = await quote('shop', body(id));
      expect(res.statusCode, res.body).toBe(422);
      expect(code(res), String(country)).toBe('COUNTRY_NOT_RECORDED');
    }
    const abroad = await order('shop', { ship_country: 'ie' });
    const res = await quote('shop', body(abroad));
    expect(res.statusCode, res.body).toBe(422);
    expect((res.json() as Doc)['error']).toMatchObject({ code: 'OUTSIDE_OWN_COUNTRY', details: { from: 'GB', to: 'IE' } });
    expect(fake().made).toEqual([]);
    // Written in lower case, it is still this country.
    expect((await quote('shop', body(await order('shop', { ship_country: 'gb' })))).statusCode).toBe(200);
  });

  it.skipIf(!available)('hands on a carrier refusal cleaned, and reads the error by its shape', async () => {
    const id = await order('shop');
    // A plain object, as another bundle's own copy of the class would look from here.
    fake().quote = () => {
      throw { name: 'CarrierError', code: 'POSTCODE_BAD', carrierMessage: `No such\u0007 postcode‮ for key ${KEY_ONE} ${'x'.repeat(400)}`, retryable: true, reason: 'address' };
    };
    const res = await quote('shop', body(id));
    expect(res.statusCode, res.body).toBe(422);
    const error = (res.json() as Doc)['error'];
    expect(error).toMatchObject({ code: 'CARRIER_REFUSED', details: { carrierCode: 'POSTCODE_BAD', reason: 'address' } });
    const said = error.details.carrierMessage as string;
    expect(said.length).toBeLessThanOrEqual(300);
    expect(said.startsWith('No such postcode for key [hidden] x')).toBe(true);
    expect(res.body).not.toContain(KEY_ONE);
  });

  it.skipIf(!available)('says only "unavailable" of any other failure, and "bad answer" of an answer outside the contract', async () => {
    const id = await order('shop');
    fake().quote = () => {
      throw new Error(`socket hang up at 10.0.0.7 with ${KEY_ONE}`);
    };
    const down = await quote('shop', body(id));
    expect(down.statusCode, down.body).toBe(502);
    expect(code(down)).toBe('CARRIER_UNAVAILABLE');
    expect(down.body).not.toContain('10.0.0.7');
    expect(down.body).not.toContain(KEY_ONE);

    for (const answer of [[{ code: 'x' }], 'nope', [{ ...RATE, amount: -1 }], [{ ...RATE, surprise: true }], [{ ...RATE, amountDecimal: undefined, amount: 1e21 }], [{ ...RATE, expiresAt: 'soon' }], Array.from({ length: 101 }, () => RATE)]) {
      fake().quote = () => answer;
      const bad = await quote('shop', body(id));
      expect(bad.statusCode, bad.body).toBe(502);
      expect(code(bad)).toBe('CARRIER_BAD_ANSWER');
    }
  });

  // ── What a client may send ──────────────────────────────────────────────

  it.skipIf(!available)('refuses an address in the body, and any parcel it would have to guess at', async () => {
    const id = await order('shop');
    for (const bad of [
      { ...body(id), to: { name: 'Mallory', lines: ['1 Elsewhere'], city: 'X', postcode: 'X', country: 'GB' } },
      { ...body(id), address: {} },
      { ...body(id), source: { table: 'orders', id, address: {} } },
      { ...body(id), parcel: { ...PARCEL, to: {} } },
      body(id, { parcel: { ...PARCEL, weightKg: 0 } }),
      body(id, { parcel: { ...PARCEL, weightKg: -1 } }),
      body(id, { parcel: { ...PARCEL, weightKg: 1000.5 } }),
      body(id, { parcel: { ...PARCEL, weightKg: '2' } }),
      body(id, { parcel: { ...PARCEL, lengthCm: 0 } }),
      body(id, { parcel: { ...PARCEL, widthCm: 401 } }),
      body(id, { parcel: { ...PARCEL, heightCm: null } }),
      body(id, { parcel: { ...PARCEL, contents: '   ' } }),
      body(id, { parcel: { ...PARCEL, contents: 'x'.repeat(201) } }),
      body(id, { parcelNumber: 0 }),
      body(id, { parcelNumber: 100 }),
      body(id, { parcelNumber: 1.5 }),
      body(id, { purpose: 'gift' }),
    ]) {
      const res = await quote('shop', bad);
      expect(res.statusCode, JSON.stringify(bad)).toBe(422);
      expect(code(res)).toBe('VALIDATION_FAILED');
    }
    expect(fake().made).toEqual([]);
    expect((await quote('shop', body(id, { parcel: { ...PARCEL, weightKg: 1000, lengthCm: 400 }, parcelNumber: 99 }))).statusCode).toBe(200);
  });

  // ── Who may ask ─────────────────────────────────────────────────────────

  it.skipIf(!available)('asks for the shipping key on every route, which an Admin does not hold', async () => {
    const id = await order('shop');
    for (const who of ['nobody', 'admin']) {
      for (const res of [
        await call(who, 'GET', 'shop/shipping'),
        await call(who, 'PUT', 'shop/shipping/active-carrier', { carrier: 'carrier-one' }),
        await call(who, 'PUT', 'shop/shipping/ship-from', SHIP_FROM),
        await quote('shop', body(id), who),
      ]) {
        expect(res.statusCode, `${who}: ${res.body}`).toBe(403);
      }
    }
    expect(fake().made).toEqual([]);
  });

  it.skipIf(!available)('refuses an API key on all four, even one whose role holds the key', async () => {
    const id = await order('shop');
    const role = await rolesRepo(h.meta).findBySlug('super-admin');
    const token = generateApiKey();
    await apiKeysRepo(h.meta).create({ name: `ship-${String(nextId)}`, tokenHash: token.tokenHash, prefix: token.prefix, roleId: role!.id, createdBy: ids['boss']! });
    const headers = { authorization: `Bearer ${token.key}` };
    for (const [method, path, payload] of [
      ['GET', 'shop/shipping', undefined],
      ['PUT', 'shop/shipping/active-carrier', { carrier: 'carrier-one' }],
      ['PUT', 'shop/shipping/ship-from', SHIP_FROM],
      ['POST', 'shop/shipping/quotes', body(id)],
    ] as const) {
      const res = await composed.app.inject({ method, url: `/api/v1/apps/${path}?connectionId=${encodeURIComponent(conn)}`, headers, ...(payload === undefined ? {} : { payload }) });
      expect(res.statusCode, `${path}: ${res.body}`).toBe(403);
      expect((res.json() as Doc)['error']['details']).toMatchObject({ reason: 'api-key' });
    }
    expect(fake().made).toEqual([]);
  });

  it.skipIf(!available)('gives someone without the table a 403, and a row they do not reach a 404, with no carrier call', async () => {
    const theirs = await order('shop', { owner_id: ids['boss'] });
    const own = await order('shop', { owner_id: ids['rep'] });
    await settings().setShipFrom(installs['shop']!, SHIP_FROM, null, 2);

    const noTable = await quote('shop', body(theirs), 'clerk');
    expect(noTable.statusCode, noTable.body).toBe(403);
    expect(code(noTable)).toBe('TABLE_FORBIDDEN');

    const notTheirs = await quote('shop', body(theirs), 'rep');
    expect(notTheirs.statusCode, notTheirs.body).toBe(404);
    const missing = await quote('shop', body('999999'), 'rep');
    expect(missing.statusCode, missing.body).toBe(404);
    // A row out of reach and one that is not there answer alike.
    expect((notTheirs.json() as Doc)['error']['message']).toBe((missing.json() as Doc)['error']['message']);
    // An id that cannot be a key is simply not there, on an engine that would otherwise fail on its type.
    expect((await quote('shop', body('not-a-number'), 'boss')).statusCode).toBe(404);
    expect(fake().made).toEqual([]);

    const mine = await quote('shop', body(own), 'rep');
    expect(mine.statusCode, mine.body).toBe(200);
    expect(fake().made).toHaveLength(1);
  });

  // ── Stored quotes ───────────────────────────────────────────────────────

  it.skipIf(!available)('hands the carrier the order\'s address from the server, and keeps only a rate id and an exact price in the reply', async () => {
    const id = await order('shop', { ship_line2: 'Flat 2', ship_region: 'West Yorkshire', ship_company: 'Quill Ltd' });
    const before = Date.now();
    fake().quote = () => [RATE, { code: 'plain', service: 'Plain', amount: 7.5, currency: 'GBP' }];
    const res = await quote('shop', body(id));
    expect(res.statusCode, res.body).toBe(200);
    const data = (res.json() as Doc)['data'];

    const asked = fake().quotes[0]!;
    expect(asked.to).toEqual({ name: NAME, lines: [STREET, 'Flat 2'], city: 'Leeds', region: 'West Yorkshire', postcode: 'LS1 4AB', country: 'GB', company: 'Quill Ltd' });
    // A price depends on where a parcel goes, so the customer's phone and email stay here.
    expect(asked.to).not.toHaveProperty('phone');
    expect(asked.to).not.toHaveProperty('email');
    expect(asked.from).toMatchObject(SHIP_FROM);
    expect(asked.options).toEqual({ purpose: 'outbound' });
    expect(fake().made[0]).toMatchObject({ key: 'carrier-one', credentials: { api_key: KEY_ONE } });
    expect(fake().made[0]!.todayIso).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    expect(data.carrier).toBe('carrier-one');
    expect(data.expiresAt).toBeGreaterThanOrEqual(before + QUOTE_LIFE_MS - 1000);
    expect(data.expiresAt).toBeLessThanOrEqual(Date.now() + QUOTE_LIFE_MS);
    expect(data.rates[0]).toEqual({ rateId: expect.stringMatching(/^rate_[0-9a-f]{24}$/), code: 'evri-48', service: 'Evri 48', amountDecimal: '3.10', currency: 'GBP', carrier: 'Evri', handover: 'drop-off', tracked: true, withinLimit: true });
    // With no exact decimal, the carrier's number as a string.
    expect(data.rates[1].amountDecimal).toBe('7.5');
    expect(data.rates[1]).not.toHaveProperty('amount');
  });

  it.skipIf(!available)('keeps a quote no longer than the soonest expiry a rate states', async () => {
    const id = await order('shop');
    const soon = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const later = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    fake().quote = () => [{ ...RATE, expiresAt: later }, { ...RATE, code: 'b', expiresAt: soon }];
    const short = (await quote('shop', body(id))).json() as Doc;
    expect(short['data']['expiresAt']).toBe(Date.parse(soon));
    fake().quote = () => [{ ...RATE, expiresAt: later }];
    const capped = (await quote('shop', body(id))).json() as Doc;
    expect(capped['data']['expiresAt']).toBeLessThanOrEqual(Date.now() + QUOTE_LIFE_MS);
  });

  async function currentDetails(id: string) {
    const { db } = await h.manager.data(conn);
    const row = await db.selectFrom(tables[`${conn}:shop`]! as never).selectAll().where('id' as never, '=', Number(id) as never).executeTakeFirstOrThrow();
    const from = shipFromAddress(SHIP_FROM);
    const columns = { name: 'ship_name', lines: ['ship_line1', 'ship_line2'], city: 'ship_city', region: 'ship_region', postcode: 'ship_postcode', country: 'ship_country', phone: 'ship_phone', email: 'ship_email', company: 'ship_company' };
    return { parcel: PARCEL, from, to: orderAddress(row as Doc, columns, from) };
  }

  it.skipIf(!available)('a second quote voids the first, and an edited address reads as stale', async () => {
    const id = await order('shop');
    const first = ((await quote('shop', body(id))).json() as Doc)['data'];
    const read = (quoteId: string, rateId: string, details: Awaited<ReturnType<typeof currentDetails>>, over: Partial<ShippingSlot> = {}, now = Date.now(), carrierKey = 'carrier-one') =>
      readQuoteForBooking(h.meta, TEST_SECRET, { quoteId, rateId, slot: slot(id, over), carrierKey, accountFingerprint: accountFingerprintOf(TEST_SECRET, 'carrier-one', 'live', undefined, { api_key: KEY_ONE }), details, now });

    // The full rate comes back for the purchase, its handles unsealed.
    const held = await read(first.quoteId, first.rates[0].rateId, await currentDetails(id));
    expect(held).toMatchObject({ ok: true, carrierKey: 'carrier-one', rate: { code: 'evri-48', ref: REF, carrierToken: TOKEN, amountDecimal: '3.10' } });

    const second = ((await quote('shop', body(id))).json() as Doc)['data'];
    expect(await read(first.quoteId, first.rates[0].rateId, await currentDetails(id))).toEqual({ ok: false, code: 'QUOTE_NOT_FOUND' });
    expect((await read(second.quoteId, second.rates[0].rateId, await currentDetails(id))).ok).toBe(true);

    expect(await read(second.quoteId, 'rate_nope', await currentDetails(id))).toEqual({ ok: false, code: 'RATE_NOT_IN_QUOTE' });
    expect(await read(second.quoteId, second.rates[0].rateId, await currentDetails(id), { rowKey: 'other' })).toEqual({ ok: false, code: 'QUOTE_NOT_FOUND' });
    expect(await read(second.quoteId, second.rates[0].rateId, await currentDetails(id), { parcelNumber: 2 })).toEqual({ ok: false, code: 'QUOTE_NOT_FOUND' });
    expect(await read(second.quoteId, second.rates[0].rateId, await currentDetails(id), {}, second.expiresAt)).toEqual({ ok: false, code: 'QUOTE_EXPIRED' });
    // Stored while the owner was moving the shop to another carrier.
    expect(await read(second.quoteId, second.rates[0].rateId, await currentDetails(id), {}, Date.now(), 'carrier-two')).toEqual({ ok: false, code: 'QUOTE_STALE' });
    // A heavier parcel, on the same order.
    expect(await read(second.quoteId, second.rates[0].rateId, { ...(await currentDetails(id)), parcel: { ...PARCEL, weightKg: 2 } })).toEqual({ ok: false, code: 'QUOTE_STALE' });

    await editOrder('shop', id, { ship_line1: '13 Kiln Lane' });
    expect(await read(second.quoteId, second.rates[0].rateId, await currentDetails(id))).toEqual({ ok: false, code: 'QUOTE_STALE' });
    await editOrder('shop', id, { ship_line1: STREET });
    expect((await read(second.quoteId, second.rates[0].rateId, await currentDetails(id))).ok).toBe(true);
  });

  it.skipIf(!available)('keeps a quote per parcel and purpose, and a new Ship from or carrier clears them', async () => {
    const id = await order('shop');
    const first = ((await quote('shop', body(id, { parcelNumber: 1 }))).json() as Doc)['data'];
    const parcelTwo = ((await quote('shop', body(id, { parcelNumber: 2 }))).json() as Doc)['data'];
    const returned = ((await quote('shop', body(id, { purpose: 'return' }))).json() as Doc)['data'];
    expect(new Set([first.quoteId, parcelTwo.quoteId, returned.quoteId]).size).toBe(3);
    for (const one of [first, parcelTwo, returned]) expect(await settings().quote(one.quoteId)).not.toBeNull();

    // The same address sent again changes nothing, and keeps them.
    expect((await call('boss', 'PUT', 'shop/shipping/ship-from', SHIP_FROM)).statusCode).toBe(200);
    expect(await settings().quote(first.quoteId)).not.toBeNull();
    expect((await call('boss', 'PUT', 'shop/shipping/ship-from', { ...SHIP_FROM, postcode: 'SL7 2BB' })).statusCode).toBe(200);
    for (const one of [first, parcelTwo, returned]) expect(await settings().quote(one.quoteId)).toBeNull();

    await settings().setShipFrom(installs['shop']!, SHIP_FROM, null, 5);
    const again = ((await quote('shop', body(id))).json() as Doc)['data'];
    expect((await call('boss', 'PUT', 'shop/shipping/active-carrier', { carrier: 'carrier-one' })).statusCode).toBe(200);
    expect(await settings().quote(again.quoteId)).not.toBeNull();
    expect((await call('boss', 'PUT', 'shop/shipping/active-carrier', { carrier: 'carrier-two' })).statusCode).toBe(200);
    expect(await settings().quote(again.quoteId)).toBeNull();
  });

  it.skipIf(!available)('shows no carrier handle or address in a reply, a quote row, a log line or an audit row', async () => {
    logs.length = 0;
    const id = await order('shop');
    const replies = [
      await quote('shop', body(id)),
      await call('boss', 'PUT', 'shop/shipping/ship-from', { ...SHIP_FROM, phone: PHONE, email: EMAIL }),
      await call('boss', 'PUT', 'shop/shipping/active-carrier', { carrier: 'carrier-two' }),
      await call('boss', 'GET', 'shop/shipping'),
    ];
    await settings().setShipFrom(installs['shop']!, SHIP_FROM, null, 9);
    fake().quote = () => {
      throw new Error(`failed for ${NAME} at ${STREET} ${REF}`);
    };
    replies.push(await quote('shop', body(id)));
    // A carrier's own words are for the person asking, in the reply, and go in no log.
    fake().quote = () => {
      throw { name: 'CarrierError', code: 'REFUSED', carrierMessage: `Cannot deliver to ${NAME}, ${STREET}, with ${KEY_TWO}`, reason: 'address' };
    };
    const refused = await quote('shop', body(id));
    expect(code(refused)).toBe('CARRIER_REFUSED');
    expect(refused.body).toContain(NAME);
    expect(refused.body).not.toContain(KEY_TWO);
    fake().quote = () => [RATE];
    const kept = ((await quote('shop', body(id))).json() as Doc)['data'];

    for (const reply of replies.slice(0, 1)) for (const secret of [REF, TOKEN, STREET, NAME, PHONE, EMAIL]) expect(reply.body).not.toContain(secret);
    for (const secret of [REF, TOKEN, STREET, NAME]) expect(replies[4]!.body).not.toContain(secret);

    const row = await h.meta.db.selectFrom('adminium_shipping_quotes').selectAll().where('id', '=', kept.quoteId).executeTakeFirstOrThrow();
    const stored = JSON.stringify(row);
    for (const secret of [REF, TOKEN, STREET, NAME, PHONE, EMAIL, 'LS1 4AB', 'Leeds']) expect(stored).not.toContain(secret);

    const lines = logs.join('\n');
    expect(lines.length).toBeGreaterThan(0);
    for (const secret of [REF, TOKEN, STREET, NAME, PHONE, EMAIL, KEY_ONE, KEY_TWO]) expect(lines).not.toContain(secret);

    const audit = JSON.stringify(await h.meta.db.selectFrom('adminium_audit_log').selectAll().where('action', 'like', 'shipping.%').execute());
    expect(audit).toContain('shipping.ship-from.saved');
    expect(audit).toContain('phone');
    for (const secret of [REF, TOKEN, STREET, NAME, PHONE, EMAIL, SHIP_FROM.postcode]) expect(audit).not.toContain(secret);
  });

  // ── The carrier in use, and Ship from ───────────────────────────────────

  it.skipIf(!available)('reports the carriers, the one in use, Ship from and what it lacks; never international', async () => {
    await settings().setShipFrom(installs['shop']!, { name: 'Marlow Press', country: 'GB' }, null, 2);
    const res = await call('boss', 'GET', 'shop/shipping');
    expect(res.statusCode, res.body).toBe(200);
    const data = (res.json() as Doc)['data'];
    expect(data).toMatchObject({ appUpdated: true, activeCarrier: 'carrier-one', international: false, shipFrom: { name: 'Marlow Press', country: 'GB' }, shipFromMissing: ['lines', 'city', 'postcode', 'phone'] });
    const by = Object.fromEntries((data.carriers as Doc[]).map((one) => [one['key'], one]));
    expect(by['carrier-one']).toMatchObject({ locked: false, on: true, connected: true });
    expect(by['carrier-keyless']).toMatchObject({ locked: false, on: true, connected: false });
    expect(by['shipping-dhl']).toMatchObject({ locked: true, on: true, connected: false });
    expect(res.body).not.toContain(KEY_ONE);
  });

  it.skipIf(!available)('uses the only attached carrier with no choice made, and audits a choice', async () => {
    const id = await order('solo');
    expect(((await call('boss', 'GET', 'solo/shipping')).json() as Doc)['data']['activeCarrier']).toBe('carrier-solo');
    expect((await quote('solo', body(id))).statusCode).toBe(200);
    expect(fake().made[0]!.key).toBe('carrier-solo');

    const set = await call('boss', 'PUT', 'solo/shipping/active-carrier', { carrier: 'carrier-solo' });
    expect(set.statusCode, set.body).toBe(200);
    const rows = await h.meta.db.selectFrom('adminium_audit_log').select(['action', 'changes']).where('action', '=', 'shipping.active-carrier.set').execute();
    expect(JSON.stringify(rows.at(-1))).toContain('carrier-solo');
  });

  it.skipIf(!available)('saves a half-filled Ship from, audited by field names alone, and refuses a wrong country', async () => {
    const partial = await call('boss', 'PUT', 'shop/shipping/ship-from', { name: ' Marlow Press ', lines: ['1 Mill Yard', ''], city: '', country: 'gb' });
    expect(partial.statusCode, partial.body).toBe(200);
    const data = (partial.json() as Doc)['data'];
    expect(data.shipFrom).toEqual({ name: 'Marlow Press', lines: ['1 Mill Yard'], country: 'GB' });
    expect(data.shipFromMissing).toEqual(['city', 'postcode', 'phone']);

    const rows = await h.meta.db.selectFrom('adminium_audit_log').select('changes').where('action', '=', 'shipping.ship-from.saved').execute();
    const written = JSON.stringify(rows.at(-1));
    expect(written).toContain('postcode');
    expect(written).not.toContain('Mill Yard');

    for (const bad of [{ country: 'Great Britain' }, { name: 'x'.repeat(121) }, { lines: ['a', 'b', 'c', 'd'] }, { fax: '1' }]) {
      const res = await call('boss', 'PUT', 'shop/shipping/ship-from', bad);
      expect(res.statusCode, JSON.stringify(bad)).toBe(422);
    }
  });

  // ── A carrier's key ─────────────────────────────────────────────────────

  const FRESH_KEY = 'pasted-carrier-value-9f3k';
  const saveKey = (carrier: string, fields: Doc = { api_key: FRESH_KEY }, over: Doc = {}, who = 'boss') => call(who, 'PUT', `shop/shipping/carriers/${carrier}/key`, { fields, ...over });
  const checkKey = (carrier: string, who = 'boss') => call(who, 'POST', `shop/shipping/carriers/${carrier}/check`);
  const carrierInstall = async (key: string) => (await repo.findInScope(key, conn))!.row.id;
  const savedKey = async (key: string) => ((await repo.getCredential(await carrierInstall(key)))?.secret as Doc | undefined)?.['api_key'] as string | undefined;
  const carrierOf = (res: { json(): unknown }, key: string) => (((res.json() as Doc)['data']['carriers'] as Doc[]).find((one) => one['key'] === key) as Doc);

  async function restoreKey(key: string, value: string): Promise<void> {
    await saveChecked(await carrierInstall(key), key, value);
  }

  it.skipIf(!available)('checks a key with the carrier before saving it, and takes test or live from its answer, not the key', async () => {
    await settings().setShipFrom(installs['shop']!, SHIP_FROM, null, 2);
    // A key that reads as live, on an account the carrier says is a test one.
    fake().check = () => ({ outcome: 'ok', mode: 'test', carriers: ['Evri'] });
    const res = await saveKey('carrier-two', { api_key: 'live-looking-value-a1b2' }, { confirmAccountChange: true });
    expect(res.statusCode, res.body).toBe(200);
    expect(carrierOf(res, 'carrier-two')['account']).toMatchObject({ mode: 'test', keyHint: 'a1b2', state: 'ok', carriers: ['Evri'] });
    // Asked for this shop's real country.
    expect(fake().checks).toEqual([{ key: 'carrier-two', query: { country: 'GB' } }]);
    expect(await savedKey('carrier-two')).toBe('live-looking-value-a1b2');

    const access = (await call('boss', 'PUT', 'shop/shipping/active-carrier', { carrier: 'carrier-two' }));
    expect(access.statusCode, access.body).toBe(200);
    const id = await order('shop');
    const quoted = await quote('shop', body(id));
    expect(quoted.statusCode, quoted.body).toBe(200);
    expect((quoted.json() as Doc)['data']['mode']).toBe('test');
    expect(((await call('boss', 'GET', 'shop/shipping/access')).json() as Doc)['data']['mode']).toBe('test');
    await restoreKey('carrier-two', KEY_TWO);
  });

  it.skipIf(!available)('never stores a key the carrier refuses, or could not answer for, and the old key stays in force', async () => {
    fake().check = () => ({ outcome: 'refused', carrierMessage: `Bad key ${FRESH_KEY} see https://carrier.example/help?token=abc123` });
    const refused = await saveKey('carrier-one');
    expect(refused.statusCode, refused.body).toBe(422);
    expect(code(refused)).toBe('KEY_REFUSED');
    expect(refused.body).not.toContain(FRESH_KEY);
    expect(refused.body).not.toContain('abc123');
    expect(refused.body).not.toContain('carrier.example');
    expect(await savedKey('carrier-one')).toBe(KEY_ONE);

    fake().check = () => ({ outcome: 'unreachable' });
    const down = await saveKey('carrier-one');
    expect(down.statusCode, down.body).toBe(502);
    expect(code(down)).toBe('CARRIER_UNAVAILABLE');
    expect(await savedKey('carrier-one')).toBe(KEY_ONE);

    fake().check = () => {
      throw new Error(`socket closed with ${FRESH_KEY}`);
    };
    const threw = await saveKey('carrier-one');
    expect(code(threw)).toBe('CARRIER_UNAVAILABLE');
    expect(threw.body).not.toContain(FRESH_KEY);

    fake().check = () => ({ outcome: 'ok', mode: 'sideways', carriers: [] });
    expect(code(await saveKey('carrier-one'))).toBe('CARRIER_BAD_ANSWER');
    expect(await savedKey('carrier-one')).toBe(KEY_ONE);
    expect((await quote('shop', body(await order('shop')))).statusCode).toBe(200);
  });

  it.skipIf(!available)('asks before a key for another account replaces one, and clears the rates priced under the old', async () => {
    const id = await order('shop');
    const quoted = ((await quote('shop', body(id))).json() as Doc)['data'];
    fake().check = () => ({ outcome: 'ok', mode: 'live', accountFingerprint: 'account-b', carriers: ['DPD'] });
    const asked = await saveKey('carrier-one');
    expect(asked.statusCode, asked.body).toBe(409);
    expect((asked.json() as Doc)['error']).toMatchObject({ code: 'KEY_OTHER_ACCOUNT', details: { carrier: 'carrier-one', from: { mode: 'live' }, to: { mode: 'live' } } });
    expect(await savedKey('carrier-one')).toBe(KEY_ONE);
    expect(await settings().quote(quoted.quoteId)).not.toBeNull();

    const meant = await saveKey('carrier-one', { api_key: FRESH_KEY }, { confirmAccountChange: true });
    expect(meant.statusCode, meant.body).toBe(200);
    expect(await savedKey('carrier-one')).toBe(FRESH_KEY);
    expect(await settings().quote(quoted.quoteId)).toBeNull();

    // Another key on the same account needs no confirm.
    const same = await saveKey('carrier-one', { api_key: `${FRESH_KEY}-2` });
    expect(same.statusCode, same.body).toBe(200);
    await restoreKey('carrier-one', KEY_ONE);
  });

  it.skipIf(!available)('takes no key for a locked carrier, nor the wrong fields, and the generic connect form refuses every carrier', async () => {
    const before = fake().made.length;
    const locked = await saveKey('shipping-dhl');
    expect(locked.statusCode, locked.body).toBe(409);
    expect(code(locked)).toBe('CARRIER_LOCKED');
    expect(code(await checkKey('shipping-dhl'))).toBe('CARRIER_LOCKED');
    expect(fake().made.length).toBe(before);

    for (const fields of [{ wrong: 'x' }, { api_key: 'x', extra: 'y' }, {}]) {
      const res = await saveKey('carrier-one', fields);
      expect(res.statusCode, JSON.stringify(fields)).toBe(422);
      expect(code(res)).toBe('KEY_FIELDS');
    }
    expect(code(await saveKey('carrier-nobody'))).toBe('CARRIER_NOT_INSTALLED');

    const connect = await composed.app.inject({ method: 'POST', url: `/api/v1/add-ons/carrier-one/connect?connectionId=${encodeURIComponent(conn)}`, headers: { cookie: cookies['boss']! }, payload: { credentials: { api_key: FRESH_KEY } } });
    expect(connect.statusCode, connect.body).toBe(422);
    expect((connect.json() as Doc)['error']['details']).toMatchObject({ reason: 'shipping' });
    const disconnect = await composed.app.inject({ method: 'DELETE', url: `/api/v1/add-ons/carrier-one/connect?connectionId=${encodeURIComponent(conn)}`, headers: { cookie: cookies['boss']! } });
    expect(disconnect.statusCode, disconnect.body).toBe(422);
    expect(await savedKey('carrier-one')).toBe(KEY_ONE);
  });

  it.skipIf(!available)('stops using a key nobody checked, one changed behind the door, or one the carrier now refuses', async () => {
    const id = await order('shop');
    const install = await carrierInstall('carrier-one');
    // The stored key changed some other way: what was said of the old one says nothing of it.
    await repo.setCredential(install, { kind: 'api-key', secret: { api_key: 'swapped-behind-the-door' } });
    const changed = await quote('shop', body(id));
    expect(changed.statusCode, changed.body).toBe(409);
    expect((changed.json() as Doc)['error']).toMatchObject({ code: 'CARRIER_NOT_CHECKED', details: { reason: 'unchecked' } });
    expect(fake().quotes).toEqual([]);

    // Check connection settles it.
    const checked = await checkKey('carrier-one');
    expect(checked.statusCode, checked.body).toBe(200);
    expect((checked.json() as Doc)['data']).toEqual({ outcome: 'ok', mode: 'live', carriers: ['Evri', 'DPD'], country: 'GB' });
    expect((await quote('shop', body(id))).statusCode).toBe(200);

    fake().check = () => ({ outcome: 'refused' });
    expect(((await checkKey('carrier-one')).json() as Doc)['data']).toEqual({ outcome: 'refused' });
    expect((await settings().account(install))?.state).toBe('refused');
    const stale = await quote('shop', body(id));
    expect((stale.json() as Doc)['error']).toMatchObject({ code: 'CARRIER_NOT_CHECKED', details: { reason: 'refused' } });
    expect(code(await call('boss', 'PUT', 'shop/shipping/active-carrier', { carrier: 'carrier-one' }))).toBe('CARRIER_NOT_CHECKED');

    // A carrier that did not answer changes nothing it said before.
    fake().check = () => ({ outcome: 'unreachable' });
    expect(((await checkKey('carrier-one')).json() as Doc)['data']).toEqual({ outcome: 'unreachable' });
    expect((await settings().account(install))?.state).toBe('refused');
    await restoreKey('carrier-one', KEY_ONE);
  });

  it.skipIf(!available)('removes a key at its own door, with what was said of it and the rates priced under it', async () => {
    const id = await order('shop');
    const quoted = ((await quote('shop', body(id))).json() as Doc)['data'];
    const install = await carrierInstall('carrier-one');
    const res = await composed.app.inject({ method: 'DELETE', url: `/api/v1/apps/shop/shipping/carriers/carrier-one/key?connectionId=${encodeURIComponent(conn)}`, headers: { cookie: cookies['boss']! } });
    expect(res.statusCode, res.body).toBe(200);
    expect(carrierOf(res, 'carrier-one')).toMatchObject({ connected: false, account: null });
    expect(await repo.getCredential(install)).toBeNull();
    expect(await settings().account(install)).toBeNull();
    expect(await settings().quote(quoted.quoteId)).toBeNull();
    await restoreKey('carrier-one', KEY_ONE);
  });

  it.skipIf(!available)('holds no key in a reply, a log line, an audit row or the account record', async () => {
    logs.length = 0;
    const replies = [await saveKey('carrier-two', { api_key: FRESH_KEY }, { confirmAccountChange: true }), await checkKey('carrier-two'), await call('boss', 'GET', 'shop/shipping'), await call('boss', 'GET', 'shop/shipping/access')];
    fake().check = () => ({ outcome: 'refused', carrierMessage: `Refused ${FRESH_KEY}` });
    replies.push(await checkKey('carrier-two'));
    for (const reply of replies) expect(reply.body).not.toContain(FRESH_KEY);
    expect(logs.join('\n')).not.toContain(FRESH_KEY);
    const audit = await h.meta.db.selectFrom('adminium_audit_log').selectAll().where('action', 'like', 'shipping.key.%').execute();
    expect(audit.map((row) => row.action)).toEqual(expect.arrayContaining(['shipping.key.saved', 'shipping.key.checked']));
    expect(JSON.stringify(audit)).toContain('api_key');
    expect(JSON.stringify(audit)).not.toContain(FRESH_KEY);
    const row = await h.meta.db.selectFrom('adminium_shipping_accounts').selectAll().where('carrierInstallId', '=', await carrierInstall('carrier-two')).executeTakeFirstOrThrow();
    expect(JSON.stringify(row)).not.toContain(FRESH_KEY);
    expect(row.keyHint).toBe(FRESH_KEY.slice(-4));
    // In the credential store it is ciphertext.
    const stored = await h.meta.db.selectFrom('adminium_add_on_credentials').selectAll().where('manifestId', '=', await carrierInstall('carrier-two')).executeTakeFirstOrThrow();
    expect(JSON.stringify(stored)).not.toContain(FRESH_KEY);
    await restoreKey('carrier-two', KEY_TWO);
  });

  it.skipIf(!available)('keeps every key route to a signed-in person who manages shipping', async () => {
    const token = generateApiKey();
    await apiKeysRepo(h.meta).create({ name: `keys-${String(nextId)}`, tokenHash: token.tokenHash, prefix: token.prefix, roleId: (await rolesRepo(h.meta).findBySlug('super-admin'))!.id, createdBy: ids['boss']! });
    const routes = [
      ['PUT', 'shop/shipping/carriers/carrier-one/key', { fields: { api_key: FRESH_KEY } }],
      ['POST', 'shop/shipping/carriers/carrier-one/check', undefined],
      ['DELETE', 'shop/shipping/carriers/carrier-one/key', undefined],
      ['PUT', 'shop/shipping/limits', { perLabel: null, dailyLabels: null }],
    ] as const;
    for (const [method, path, payload] of routes) {
      const url = `/api/v1/apps/${path}?connectionId=${encodeURIComponent(conn)}`;
      const byKey = await composed.app.inject({ method, url, headers: { authorization: `Bearer ${token.key}` }, ...(payload === undefined ? {} : { payload }) });
      expect(byKey.statusCode, `${path}: ${byKey.body}`).toBe(403);
      expect((byKey.json() as Doc)['error']['details']).toMatchObject({ reason: 'api-key' });
      for (const who of ['nobody', 'admin', 'packer', 'picker']) {
        const res = await composed.app.inject({ method, url, headers: { cookie: cookies[who]! }, ...(payload === undefined ? {} : { payload }) });
        expect(res.statusCode, `${who} ${path}: ${res.body}`).toBe(403);
      }
    }
    expect(await savedKey('carrier-one')).toBe(KEY_ONE);
  });

  // ── Who may spend ───────────────────────────────────────────────────────

  const setLimits = (amount: string | null, daily: number | null, currency = 'GBP') => call('boss', 'PUT', 'shop/shipping/limits', { perLabel: amount === null ? null : { amount, currency }, dailyLabels: daily });
  const today = async () => (await import('../src/crud/row-limit-context.js')).venueDayOf(h.meta, conn);

  it.skipIf(!available)('with no limit set the owner books: a packer is told so before any carrier is asked', async () => {
    const id = await order('shop');
    const res = await quote('shop', body(id), 'packer');
    expect(res.statusCode, res.body).toBe(403);
    expect((res.json() as Doc)['error']).toMatchObject({ code: 'OWNER_BOOKS', details: { reason: 'no-limit' } });
    expect(fake().made).toEqual([]);
    const access = ((await call('packer', 'GET', 'shop/shipping/access')).json() as Doc)['data'];
    expect(access).toMatchObject({ mayBook: true, mayCancel: false, mayCustoms: false, manages: false, pricesHidden: true, booking: 'no-limit' });
    // The owner still books.
    expect((await quote('shop', body(id))).statusCode).toBe(200);
  });

  it.skipIf(!available)('gives someone who cannot see money no price, no currency and no price order', async () => {
    const id = await order('shop');
    await setLimits('25.00', 20);
    // Cheapest first, as a carrier lists them.
    fake().quote = () => [
      { code: 'z-cheap', service: 'Zebra Post', amount: 2.5, amountDecimal: '2.57', currency: 'GBP' },
      { code: 'm-mid', service: 'Mid Courier', amount: 9, amountDecimal: '9.13', currency: 'GBP' },
      { code: 'a-dear', service: 'Apex Express', amount: 88, amountDecimal: '88.91', currency: 'GBP' },
    ];
    const res = await quote('shop', body(id), 'packer');
    expect(res.statusCode, res.body).toBe(200);
    const data = (res.json() as Doc)['data'];
    expect(data.pricesHidden).toBe(true);
    expect((data.rates as Doc[]).map((rate) => rate['service'])).toEqual(['Apex Express', 'Mid Courier', 'Zebra Post']);
    expect((data.rates as Doc[]).map((rate) => rate['withinLimit'])).toEqual([false, true, true]);
    for (const rate of data.rates as Doc[]) {
      expect(rate).not.toHaveProperty('amountDecimal');
      expect(rate).not.toHaveProperty('amount');
      expect(rate).not.toHaveProperty('currency');
    }
    for (const money of ['2.57', '9.13', '88.91', 'GBP', '25.00']) expect(res.body).not.toContain(money);
    // What they were sent to the carrier for is the real address, read past their masking.
    expect(fake().quotes.at(-1)!.to).toMatchObject({ name: NAME, lines: [STREET], postcode: 'LS1 4AB' });
    // And nothing about the owner's limit in money on their own page.
    const access = await call('packer', 'GET', 'shop/shipping/access');
    expect((access.json() as Doc)['data']).toMatchObject({ booking: 'open', usedToday: 0, dailyLabels: 20 });
    expect(access.body).not.toContain('25.00');
    expect(access.body).not.toContain('GBP');
  });

  it.skipIf(!available)('compares a rate with the limit exactly, and treats another currency as above it', async () => {
    const id = await order('shop');
    await setLimits('25.00', 20);
    fake().quote = () => [
      { code: 'at', service: 'At', amount: 25, amountDecimal: '25', currency: 'GBP' },
      { code: 'over', service: 'Over', amount: 25.001, amountDecimal: '25.001', currency: 'GBP' },
      { code: 'usd', service: 'Usd', amount: 1, amountDecimal: '1.00', currency: 'USD' },
    ];
    const rates = ((await quote('shop', body(id), 'packer')).json() as Doc)['data']['rates'] as Doc[];
    expect(Object.fromEntries(rates.map((rate) => [rate['code'], rate['withinLimit']]))).toEqual({ at: true, over: false, usd: false });
  });

  it.skipIf(!available)('stops at the daily limit for all packers together, on the shop\'s day', async () => {
    const id = await order('shop');
    await setLimits('25.00', 2);
    const day = await today();
    expect(await settings().reserveDayLabel(installs['shop']!, day, 2)).toBe(true);
    expect((await quote('shop', body(id), 'packer')).statusCode).toBe(200);
    expect(await settings().reserveDayLabel(installs['shop']!, day, 2)).toBe(true);
    fake().made.length = 0;
    for (const who of ['packer', 'picker']) {
      const res = await quote('shop', body(id), who);
      expect(res.statusCode, res.body).toBe(403);
      expect((res.json() as Doc)['error']).toMatchObject({ code: 'OWNER_BOOKS', details: { reason: 'daily-limit' } });
    }
    expect(fake().made).toEqual([]);
    expect(((await call('packer', 'GET', 'shop/shipping/access')).json() as Doc)['data']).toMatchObject({ booking: 'daily-limit', usedToday: 2, dailyLabels: 2 });
    // The owner is not bound by it.
    expect((await quote('shop', body(id))).statusCode).toBe(200);
    expect(((await call('boss', 'GET', 'shop/shipping')).json() as Doc)['data']['limits']).toMatchObject({ perLabel: { amount: '25.00', currency: 'GBP' }, dailyLabels: 2, usedToday: 2 });
  });

  it.skipIf(!available)('tells someone who cannot see money what a refusal was about, in none of the carrier\'s words', async () => {
    const id = await order('shop');
    await setLimits('25.00', 20);
    fake().quote = () => {
      throw { name: 'CarrierError', code: 'BALANCE_4_20', carrierMessage: 'Your balance of 4.20 GBP is too low', reason: 'payment' };
    };
    const hidden = await quote('shop', body(id), 'packer');
    expect(hidden.statusCode, hidden.body).toBe(422);
    expect((hidden.json() as Doc)['error']).toMatchObject({ code: 'CARRIER_REFUSED', details: { reason: 'payment' } });
    expect(hidden.body).not.toContain('4.20');
    expect(hidden.body).not.toContain('BALANCE');
    // Someone who can see money gets the words.
    const shown = await quote('shop', body(id), 'picker');
    expect((shown.json() as Doc)['error']['details']['carrierMessage']).toContain('4.20');
  });

  it.skipIf(!available)('shows a booker who reads the money its prices, still inside the limit', async () => {
    const id = await order('shop');
    expect(code(await quote('shop', body(id), 'picker'))).toBe('OWNER_BOOKS');
    await setLimits('2.00', 20);
    const data = ((await quote('shop', body(id), 'picker')).json() as Doc)['data'];
    expect(data.pricesHidden).toBe(false);
    expect(data.rates[0]).toMatchObject({ amountDecimal: '3.10', currency: 'GBP', withinLimit: false });
  });

  it.skipIf(!available)('keeps booking, cancelling and customs apart, and each right to its own install', async () => {
    const id = await order('shop');
    await setLimits('25.00', 20);
    // A right to refund is no right to buy.
    const refunder = await quote('shop', body(id), 'refunder');
    expect(refunder.statusCode, refunder.body).toBe(403);
    expect(((await call('refunder', 'GET', 'shop/shipping/access')).json() as Doc)['data']).toMatchObject({ mayBook: false, mayCancel: true, booking: 'no-right' });
    expect((await call('nobody', 'GET', 'shop/shipping/access')).statusCode).toBe(403);

    // The same app on the second database is another shop: a packer here holds nothing there.
    const there = await order('shop', {}, second.id);
    const away = await composed.app.inject({ method: 'POST', url: `/api/v1/apps/shop/shipping/quotes?connectionId=${encodeURIComponent(second.id)}`, headers: { cookie: cookies['packer']! }, payload: body(there) });
    expect([403, 404], away.body).toContain(away.statusCode);
    expect(fake().made).toEqual([]);
  });

  it.skipIf(!available)('lets a screens-only packer use the bench and nothing else of shipping', async () => {
    const id = await order('shop');
    await setLimits('25.00', 20);
    const res = await quote('shop', body(id), 'bench');
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as Doc)['data']['pricesHidden']).toBe(true);
    expect((await call('bench', 'GET', 'shop/shipping/access')).statusCode).toBe(200);
    for (const [method, path, payload] of [
      ['GET', 'shop/shipping', undefined],
      ['PUT', 'shop/shipping/limits', { perLabel: null, dailyLabels: null }],
      ['PUT', 'shop/shipping/carriers/carrier-one/key', { fields: { api_key: FRESH_KEY } }],
      ['POST', 'shop/shipping/carriers/carrier-one/check', undefined],
      ['PUT', 'shop/shipping/active-carrier', { carrier: 'carrier-one' }],
    ] as const) {
      const refused = await call('bench', method, path, payload);
      expect(refused.statusCode, `${path}: ${refused.body}`).toBe(403);
      expect(code(refused)).toBe('APP_SCREENS_ONLY');
    }
  });

  it.skipIf(!available)('saves limits audited, both figures or neither, and clearing them hands booking back to the owner', async () => {
    const saved = await setLimits('12.50', 5);
    expect(saved.statusCode, saved.body).toBe(200);
    expect((saved.json() as Doc)['data']['limits']).toMatchObject({ perLabel: { amount: '12.50', currency: 'GBP' }, dailyLabels: 5, packersAbroad: false });
    const row = await h.meta.db.selectFrom('adminium_audit_log').select('changes').where('action', '=', 'shipping.limits.saved').execute();
    expect(JSON.stringify(row.at(-1))).toContain('12.50');
    for (const bad of [{ perLabel: { amount: '5', currency: 'GBP' }, dailyLabels: null }, { perLabel: null, dailyLabels: 5 }, { perLabel: { amount: '0.00', currency: 'GBP' }, dailyLabels: 5 }, { perLabel: { amount: '-1', currency: 'GBP' }, dailyLabels: 5 }, { perLabel: { amount: '1', currency: 'pounds' }, dailyLabels: 5 }, { perLabel: { amount: '1', currency: 'GBP' }, dailyLabels: 0 }]) {
      const res = await call('boss', 'PUT', 'shop/shipping/limits', bad);
      expect(res.statusCode, JSON.stringify(bad)).toBe(422);
    }
    expect((await setLimits(null, null)).statusCode).toBe(200);
    expect(code(await quote('shop', body(await order('shop')), 'packer'))).toBe('OWNER_BOOKS');
  });

  it.skipIf(!available)('never buys a rate on an account other than the one that priced it, even one stored as the key changed', async () => {
    const id = await order('shop');
    const quoted = ((await quote('shop', body(id))).json() as Doc)['data'];
    const stored = await settings().quote(quoted.quoteId);
    const account = await settings().account(await carrierInstall('carrier-one'));
    expect(stored?.accountFingerprint).toBe(account?.fingerprint);
    const { db } = await h.manager.data(conn);
    const row = await db.selectFrom(tables[`${conn}:shop`]! as never).selectAll().where('id' as never, '=', Number(id) as never).executeTakeFirstOrThrow();
    const from = shipFromAddress(SHIP_FROM);
    const columns = { name: 'ship_name', lines: ['ship_line1', 'ship_line2'], city: 'ship_city', region: 'ship_region', postcode: 'ship_postcode', country: 'ship_country', phone: 'ship_phone', email: 'ship_email', company: 'ship_company' };
    const details = { parcel: PARCEL, from, to: orderAddress(row as Doc, columns, from) };
    const read = (accountFingerprint: string) => readQuoteForBooking(h.meta, TEST_SECRET, { quoteId: quoted.quoteId, rateId: quoted.rates[0].rateId, slot: slot(id), carrierKey: 'carrier-one', accountFingerprint, details, now: Date.now() });
    expect((await read(account!.fingerprint)).ok).toBe(true);
    expect(await read(accountFingerprintOf(TEST_SECRET, 'carrier-one', 'live', 'another-account', { api_key: KEY_ONE }))).toEqual({ ok: false, code: 'QUOTE_STALE' });
    // The same key, read as the test side of the account.
    expect(await read(accountFingerprintOf(TEST_SECRET, 'carrier-one', 'test', undefined, { api_key: KEY_ONE }))).toEqual({ ok: false, code: 'QUOTE_STALE' });
  });

  it.skipIf(!available)('asks first when a live key replaces a test key of the very same account', async () => {
    fake().check = () => ({ outcome: 'ok', mode: 'test', accountFingerprint: 'account-one', carriers: ['Evri'] });
    expect((await saveKey('carrier-two', { api_key: 'first-value-aaaa' }, { confirmAccountChange: true })).statusCode).toBe(200);
    fake().check = () => ({ outcome: 'ok', mode: 'live', accountFingerprint: 'account-one', carriers: ['Evri'] });
    const asked = await saveKey('carrier-two', { api_key: 'second-value-bbbb' });
    expect(asked.statusCode, asked.body).toBe(409);
    expect((asked.json() as Doc)['error']).toMatchObject({ code: 'KEY_OTHER_ACCOUNT', details: { from: { mode: 'test' }, to: { mode: 'live' } } });
    expect(await savedKey('carrier-two')).toBe('first-value-aaaa');
    await restoreKey('carrier-two', KEY_TWO);
  });

  it.skipIf(!available)('refuses a carrier the OAuth way in too', async () => {
    const res = await composed.app.inject({ method: 'POST', url: `/api/v1/add-ons/carrier-one/connect/oauth/start?connectionId=${encodeURIComponent(conn)}`, headers: { cookie: cookies['boss']! }, payload: { clientId: 'x', clientSecret: 'y', redirectUri: 'https://shop.example/cb' } });
    expect(res.statusCode, res.body).toBe(422);
    expect(res.body).not.toContain('authorizeUrl');
  });

  it.skipIf(!available)('tells a limited reader what is wrong with an order, and nothing from its columns', async () => {
    await setLimits('25.00', 20);
    const abroad = await quote('shop', body(await order('shop', { ship_country: 'IE' })), 'packer');
    expect(code(abroad)).toBe('OUTSIDE_OWN_COUNTRY');
    expect(abroad.body).not.toContain('IE');
    const gaps = await quote('shop', body(await order('shop', { ship_city: '' })), 'packer');
    expect(code(gaps)).toBe('ADDRESS_INCOMPLETE');
    expect((gaps.json() as Doc)['error']['details'] ?? {}).not.toHaveProperty('fields');
    // Someone who reads the whole row is told which.
    const named = await quote('shop', body(await order('shop', { ship_city: '' })), 'picker');
    expect((named.json() as Doc)['error']['details']).toMatchObject({ fields: ['city'] });
  });

  it.skipIf(!available)('keeps no carrier order among tied services for someone who cannot see money', async () => {
    await setLimits('25.00', 20);
    fake().quote = () => [
      { code: 'same', service: 'Same', amount: 1, amountDecimal: '1.00', currency: 'GBP' },
      { code: 'same', service: 'Same', amount: 2, amountDecimal: '2.00', currency: 'GBP' },
      { code: 'same', service: 'Same', amount: 3, amountDecimal: '3.00', currency: 'GBP' },
    ];
    const rates = ((await quote('shop', body(await order('shop')), 'packer')).json() as Doc)['data']['rates'] as Doc[];
    const ids = rates.map((rate) => rate['rateId'] as string);
    expect(ids).toEqual([...ids].sort());
  });

  it.skipIf(!available)('takes a right on an app\'s labels from every role when the app is uninstalled', async () => {
    const role = await rolesRepo(h.meta).create({ slug: `warehouse-${String(nextId)}`, name: 'Warehouse' });
    const held = matrixRowsFromGrants(['shipping:gone:book', 'shipping:gone:cancel', 'shipping:shop:book']).rows;
    for (const row of held) await permissionsRepo(h.meta).grant(role.id, row.resourceKind, row.resourceRef, row.actions as never);
    const res = await h.inject({ method: 'DELETE', url: '/apps/gone', payload: {} });
    expect(res.statusCode, res.body).toBe(200);
    delete installs['gone'];
    const left = (await permissionsRepo(h.meta).listForRole(role.id)).map((row) => row.resourceRef);
    expect(left).toEqual(['shipping-book/shop']);
    // Put back for the test that uninstalls it.
    await h.stageApp(shopDoc('gone', true));
    expect((await h.install('gone', '1.0.0', { shippingUnticked: [] })).statusCode).toBe(200);
    installs['gone'] = (await repo.findInScope('gone', conn))!.row.id;
  });

  // ── Buying a label ──────────────────────────────────────────────────────

  const bookings = () => shippingBookingsRepo(h.meta);
  const quoted = async (id: string, who = 'boss') => {
    const res = await quote('shop', body(id), who);
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as Doc)['data'] as Doc;
  };
  const buy = (q: Doc, who = 'boss', rate = 0) => call(who, 'POST', 'shop/shipping/bookings', { quoteId: q['quoteId'], rateId: q['rates'][rate]['rateId'] });
  const stand = async (id: string, who = 'boss') => {
    const res = await composed.app.inject({ method: 'GET', url: `/api/v1/apps/shop/shipping/bookings?connectionId=${encodeURIComponent(conn)}&table=orders&id=${id}`, headers: { cookie: cookies[who]! } });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as Doc)['data'] as Doc;
  };
  const rowOf = async (id: string) => {
    const { db } = await h.manager.data(conn);
    return (await db.selectFrom(tables[`${conn}:shop`]! as never).selectAll().where('id' as never, '=', Number(id) as never).executeTakeFirstOrThrow()) as Doc;
  };
  const applyDeps = (faults?: ApplyDeps['faults']): ApplyDeps => ({ meta: h.meta, manifests: repo, sources: createPayableSources({ meta: h.meta, manager: h.manager }), writes: createWriteService(writeStores(h.meta)), ...(faults === undefined ? {} : { faults }) });
  const unclear = () => {
    throw new Error('socket hang up');
  };

  // ── A bought label's file ───────────────────────────────────────────────

  const SIGNED_ADDRESS = 'https://deliver.goshippo.com/signed-do-not-show?Signature=abc';
  const LABEL_PDF = Buffer.from('%PDF-1.4\n1 0 obj <</Type/Page/MediaBox [0 0 297.64 419.53]>> endobj\n', 'latin1');
  const labelFile = () => ({ kind: 'label', mediaType: 'application/pdf', bytes: new Uint8Array(LABEL_PDF) });
  const documentPath = (id: string, kind = 'label') => `shop/shipping/bookings/${id}/documents/${kind}`;
  const bookedWithLabel = async (over: Doc = {}) => {
    fake().fetchDocument = labelFile;
    const id = await order('shop', over);
    const res = await buy(await quoted(id));
    expect(res.statusCode, res.body).toBe(200);
    return { orderId: id, booking: (res.json() as Doc)['data'] as Doc };
  };

  it.skipIf(!available)('hands a label over as an attachment, after the purchase fetched it, and leaks no address for it', async () => {
    const { booking } = await bookedWithLabel();
    expect(booking['label']).toEqual({ state: 'ready', size: 'a4', sizeGot: 'a6', sizeDiffers: true, customsInvoice: false });
    expect(fake().books.at(-1)!.details['labelSize']).toBe('a4');
    const res = await call('boss', 'GET', documentPath(booking['id'] as string));
    expect(res.statusCode, res.body).toBe(200);
    expect(res.rawPayload.equals(LABEL_PDF)).toBe(true);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toBe(`attachment; filename="label-${booking['id'] as string}.pdf"`);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('private, no-store');
    const stored = (await bookings().byId(booking['id'] as string))!;
    const audit = await h.meta.db.selectFrom('adminium_audit_log').selectAll().where('action', 'like', 'shipping.%').execute();
    expect(audit.some((row) => row.action === 'shipping.label.downloaded')).toBe(true);
    for (const text of [JSON.stringify(booking), JSON.stringify(stored), JSON.stringify(audit), logs.join('\n')]) {
      expect(text).not.toContain('signed-do-not-show');
      expect(text).not.toContain(LABEL_ID);
    }
    expect(JSON.stringify(audit)).not.toContain(KEY_ONE);
    expect(logs.join('\n')).not.toContain(KEY_ONE);
  });

  it.skipIf(!available)('asks for the row, the right to book and the personal columns, and no other door serves the file', async () => {
    const { booking } = await bookedWithLabel({ owner_id: 'someone-else' });
    const path = documentPath(booking['id'] as string);
    // No right on this app's labels.
    expect((await call('nobody', 'GET', path)).statusCode).toBe(403);
    expect((await call('refunder', 'GET', path)).statusCode).toBe(403);
    // May book and read the order, with its personal columns masked: the label shows them.
    const masked = await call('picker', 'GET', path);
    expect(masked.statusCode, masked.body).toBe(403);
    expect(masked.body).toContain('read_pii');
    expect((await call('picker', 'POST', path)).statusCode).toBe(403);
    // Manages shipping, but cannot reach this row: it is not there.
    expect((await call('rep', 'GET', path)).statusCode).toBe(404);
    // Given the personal columns by name, the same role gets it.
    const orderTable = (await bookings().byId(booking['id'] as string))!.tableName;
    await person('labeller', ['shop-picker'], [`table:${conn}:${orderTable}:read_pii`]);
    expect((await call('labeller', 'GET', path)).statusCode).toBe(200);

    const fileId = (await bookings().byId(booking['id'] as string))!.labelRef!;
    const inject = (method: 'GET' | 'POST', url: string, payload?: unknown) => composed.app.inject({ method, url, headers: { cookie: cookies['boss']! }, ...(payload === undefined ? {} : { payload: payload as never }) });
    expect((await inject('GET', `/api/v1/files/${fileId}`)).statusCode).toBe(404);
    expect((await inject('GET', `/api/v1/files/${fileId}/content`)).statusCode).toBe(404);
    const resolved = await inject('POST', '/api/v1/files/resolve', { refs: [fileId] });
    if (resolved.statusCode === 200) expect((resolved.json() as Doc)['data'][fileId]).toBeNull();
    expect((await inject('GET', '/api/v1/files')).body).not.toContain(fileId);
  });

  it.skipIf(!available)('a failed fetch is a label owed, never a failed booking, and a person retries it', async () => {
    fake().fetchDocument = () => {
      throw new Error(`could not read ${SIGNED_ADDRESS}`);
    };
    const id = await order('shop');
    const res = await buy(await quoted(id));
    expect(res.statusCode, res.body).toBe(200);
    const booking = (res.json() as Doc)['data'] as Doc;
    expect(booking['state']).toBe('booked');
    expect(booking['label']['state']).toBe('owed');
    const path = documentPath(booking['id'] as string);
    expect(code(await call('boss', 'GET', path))).toBe('LABEL_OWED');
    const failed = await call('boss', 'POST', path);
    expect(failed.statusCode).toBe(502);
    expect(code(failed)).toBe('LABEL_FETCH_FAILED');
    expect(failed.body).not.toContain('signed-do-not-show');
    expect(logs.join('\n')).not.toContain('signed-do-not-show');
    fake().fetchDocument = labelFile;
    const retried = await call('boss', 'POST', path);
    expect(retried.statusCode, retried.body).toBe(200);
    expect((retried.json() as Doc)['data']['label']['state']).toBe('ready');
    expect((await call('boss', 'GET', path)).statusCode).toBe(200);
    expect(fake().books).toHaveLength(1);
  });

  it.skipIf(!available)('refuses the file of a label given up or deleted, and never asks the carrier for it again', async () => {
    const { booking } = await bookedWithLabel();
    const id = booking['id'] as string;
    await bookings().markLabelGone(id, 'kept-90', Date.now());
    fake().fetches!.length = 0;
    const path = documentPath(id);
    expect((await call('boss', 'GET', path)).statusCode).toBe(410);
    expect(code(await call('boss', 'POST', path))).toBe('LABEL_GONE');
    expect(fake().fetches).toEqual([]);

    const second = await bookedWithLabel();
    await bookings().move(second.booking['id'] as string, ['booked'], 'released', { reason: 'refund-requested' }, Date.now());
    expect(code(await call('boss', 'GET', documentPath(second.booking['id'] as string)))).toBe('LABEL_NOT_AVAILABLE');
  });

  it.skipIf(!available)('will not fetch a label with a key that opens another account', async () => {
    fake().fetchDocument = () => {
      throw new Error('down');
    };
    const { booking } = await (async () => {
      const id = await order('shop');
      const res = await buy(await quoted(id));
      return { booking: (res.json() as Doc)['data'] as Doc };
    })();
    await h.meta.db.updateTable('adminium_shipping_bookings').set({ accountFingerprint: 'e'.repeat(64) }).where('id', '=', booking['id'] as string).execute();
    fake().fetches!.length = 0;
    expect(code(await call('boss', 'POST', documentPath(booking['id'] as string)))).toBe('LABEL_OTHER_ACCOUNT');
    expect(fake().fetches).toEqual([]);
  });

  it.skipIf(!available)('the label size is the shop\'s setting, set by someone who manages shipping and asked of the carrier', async () => {
    expect(((await call('boss', 'GET', 'shop/shipping')).json() as Doc)['data']['labelSize']).toBe('a4');
    expect((await call('packer', 'PUT', 'shop/shipping/label-size', { size: 'a6' })).statusCode).toBe(403);
    expect((await call('boss', 'PUT', 'shop/shipping/label-size', { size: 'huge' })).statusCode).toBe(422);
    const saved = await call('boss', 'PUT', 'shop/shipping/label-size', { size: '4x6' });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(((await call('boss', 'GET', 'shop/shipping')).json() as Doc)['data']['labelSize']).toBe('4x6');
    const { booking } = await bookedWithLabel();
    expect(fake().books.at(-1)!.details['labelSize']).toBe('4x6');
    expect(booking['label']).toMatchObject({ size: '4x6', sizeGot: 'a6', sizeDiffers: true });
  });

  it.skipIf(!available)('buys one label from a stored quote, and a second press, a reload and a replay buy nothing', async () => {
    const id = await order('shop');
    expect(await stand(id)).toMatchObject({ bookings: [], bookable: true, blockedBy: null });
    const q = await quoted(id);
    const res = await buy(q);
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as Doc)['data']).toMatchObject({ state: 'booked', test: false, tracking: 'TRK-1001', carrier: 'carrier-one', amount: '3.10', currency: 'GBP', applied: false });
    expect(fake().books).toHaveLength(1);
    // The carrier is told who it needs, and the customer's phone and email stay here.
    expect(fake().books[0]!.details['to']).toMatchObject({ name: NAME, postcode: 'LS1 4AB' });
    expect(fake().books[0]!.details['to']).not.toHaveProperty('phone');
    expect(fake().books[0]!.details['to']).not.toHaveProperty('email');
    expect(fake().books[0]!.rate).toMatchObject({ ref: REF, carrierToken: TOKEN });
    expect(fake().books[0]!.order).toMatchObject({ reference: `MP-${id}`, purpose: 'outbound', parcel: 1 });

    // The quote it was bought from is gone, so pressing again cannot replay it.
    expect(await settings().quote(q['quoteId'])).toBeNull();
    expect(code(await buy(q))).toBe('QUOTE_NOT_FOUND');
    const again = await quoted(id);
    const second = await buy(again);
    expect(second.statusCode, second.body).toBe(409);
    expect((second.json() as Doc)['error']).toMatchObject({ code: 'BOOKING_EXISTS', details: { booking: { state: 'booked' } } });
    expect(fake().books).toHaveLength(1);
    expect(await stand(id)).toMatchObject({ bookable: false, blockedBy: 'booking' });
  });

  it.skipIf(!available)('names only a quote and a rate: an address, a price or another rate in the body is refused', async () => {
    const id = await order('shop');
    const q = await quoted(id);
    for (const extra of [{ to: { name: 'Mallory' } }, { amount: '0.01' }, { parcel: PARCEL }, { source: { table: 'orders', id } }]) {
      const res = await call('boss', 'POST', 'shop/shipping/bookings', { quoteId: q['quoteId'], rateId: q['rates'][0]['rateId'], ...extra });
      expect(res.statusCode, JSON.stringify(extra)).toBe(422);
    }
    expect(code(await call('boss', 'POST', 'shop/shipping/bookings', { quoteId: q['quoteId'], rateId: 'rate_nope' }))).toBe('RATE_NOT_IN_QUOTE');
    expect(code(await call('boss', 'POST', 'shop/shipping/bookings', { quoteId: 'shq_nope', rateId: 'rate_nope' }))).toBe('QUOTE_NOT_FOUND');
    expect(fake().books).toEqual([]);
  });

  it.skipIf(!available)('refuses a quote when the order, Ship from or carrier changed since, and buys nothing', async () => {
    const id = await order('shop');
    const edited = await quoted(id);
    await editOrder('shop', id, { ship_line1: '13 Kiln Lane' });
    expect(code(await buy(edited))).toBe('QUOTE_STALE');
    await editOrder('shop', id, { ship_line1: STREET });

    const moved = await quoted(id);
    expect((await call('boss', 'PUT', 'shop/shipping/ship-from', { ...SHIP_FROM, postcode: 'SL7 9ZZ' })).statusCode).toBe(200);
    expect(code(await buy(moved))).toBe('QUOTE_NOT_FOUND');
    expect(fake().books).toEqual([]);
  });

  it.skipIf(!available)('writes the tracking number onto the order once, moves no status, and survives a crash at each step', async () => {
    const id = await order('shop', { status: 'packed' });
    const res = await buy(await quoted(id));
    const bookingId = (res.json() as Doc)['data']['id'] as string;
    expect((await rowOf(id))['tracking']).toBeNull();

    await expect(applyBooking(applyDeps({ afterCopy: () => { throw new Error('died after the copy'); } }), bookingId)).rejects.toThrow('died after the copy');
    expect(await bookings().byId(bookingId)).toMatchObject({ appliedAt: null });
    expect((await bookings().byId(bookingId))?.copiedAt).not.toBeNull();
    expect((await rowOf(id))['tracking']).toBeNull();

    await expect(applyBooking(applyDeps({ afterWrite: () => { throw new Error('died after the write'); } }), bookingId)).rejects.toThrow('died after the write');
    expect(await rowOf(id)).toMatchObject({ tracking: 'TRK-1001', carrier_name: 'Evri', status: 'packed' });
    expect((await bookings().byId(bookingId))?.appliedAt).toBeNull();

    expect(await applyBooking(applyDeps(), bookingId)).toEqual({ state: 'applied', already: false });
    expect(await applyBooking(applyDeps(), bookingId)).toEqual({ state: 'applied', already: true });
    expect(await rowOf(id)).toMatchObject({ tracking: 'TRK-1001', status: 'packed' });
  });

  it.skipIf(!available)('copies a label into the carrier\'s own table once, keyed by the booking', async () => {
    const copies = `carrier_copies_${String(nextId)}`;
    const { db } = await h.manager.data(conn);
    await db.schema
      .createTable(copies)
      .addColumn('id', 'varchar(36)', (col) => col.primaryKey())
      .addColumn('order_reference', 'varchar(191)')
      .addColumn('carrier', 'varchar(191)')
      .addColumn('service', 'varchar(191)')
      .addColumn('tracking', 'varchar(191)')
      .addColumn('label_file', 'varchar(191)')
      .addColumn('amount', 'varchar(24)')
      .addColumn('currency', 'varchar(3)')
      .addColumn('status', 'varchar(20)')
      .execute();
    await h.introspect();
    const carrier = (await repo.findInScope('carrier-solo', conn))!;
    await appTablesRepo(h.meta).record({ appKey: 'carrier-solo', manifestId: carrier.row.id, connectionId: conn, ref: 'shipments', tableName: copies, owned: true, state: 'created' });
    await settings().setActiveCarrier(installs['solo']!, 'carrier-solo', null, 2);
    const id = await order('solo');
    const q = ((await quote('solo', body(id))).json() as Doc)['data'] as Doc;
    const res = await call('boss', 'POST', 'solo/shipping/bookings', { quoteId: q['quoteId'], rateId: q['rates'][0]['rateId'] });
    expect(res.statusCode, res.body).toBe(200);
    const bookingId = (res.json() as Doc)['data']['id'] as string;
    await applyBooking(applyDeps(), bookingId);
    await h.meta.db.updateTable('adminium_shipping_bookings').set({ appliedAt: null, copiedAt: null }).where('id', '=', bookingId).execute();
    await applyBooking(applyDeps(), bookingId);
    const rows = await db.selectFrom(copies as never).selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: bookingId, order_reference: `MP-${id}`, tracking: 'TRK-1001', status: 'booked' });

    // The copy is a write like any other: a shop rule that refuses it does not hold the booking's other steps back.
    const buyAnother = async () => {
      const other = await order('solo');
      const offered = ((await quote('solo', body(other))).json() as Doc)['data'] as Doc;
      const bought = await call('boss', 'POST', 'solo/shipping/bookings', { quoteId: offered['quoteId'], rateId: offered['rates'][0]['rateId'] });
      expect(bought.statusCode, bought.body).toBe(200);
      return (bought.json() as Doc)['data']['id'] as string;
    };
    const failing = (error: Error): ApplyDeps => {
      const deps = applyDeps();
      return { ...deps, writes: { ...deps.writes, create: () => Promise.reject(error) } };
    };
    const refused = await buyAnother();
    await expect(applyBooking(failing(new HookRejectedError('not today', 'beforeCreate')), refused)).resolves.toMatchObject({ state: 'applied' });
    expect((await bookings().byId(refused))?.appliedAt).not.toBeNull();
    // A database that could not answer is tried again, and nothing says the copy was made.
    const dropped = await buyAnother();
    await expect(applyBooking(failing(new Error('connection lost')), dropped)).rejects.toThrow('connection lost');
    expect((await bookings().byId(dropped))?.copiedAt).toBeNull();
    await applyBooking(applyDeps(), dropped);
    expect(await db.selectFrom(copies as never).selectAll().execute()).toHaveLength(2);
    await h.meta.db.deleteFrom('adminium_app_tables').where('appKey', '=', 'carrier-solo').execute();
    await db.schema.dropTable(copies).execute();
    await h.introspect();
  });

  it.skipIf(!available)('a carrier handle sealed in a quote or a booking is one Save as app asks about', async () => {
    const id = await order('shop');
    const held = await quoted(id);
    const known = async (value: string) => (await collectKnownSecrets(h.meta, TEST_SECRET)).find((one) => one.value === value);
    expect(await known(REF)).toMatchObject({ shape: 'whole', soft: true });
    expect(await known(TOKEN)).toMatchObject({ shape: 'whole', soft: true });
    expect((await buy(held)).statusCode).toBe(200);
    await h.meta.db.deleteFrom('adminium_shipping_quotes').execute();
    expect(await known(REF)).toMatchObject({ shape: 'whole', soft: true });
    expect(await known(TOKEN)).toMatchObject({ shape: 'whole', soft: true });
  });

  it.skipIf(!available)('a test key\'s label is marked, and never reaches the order', async () => {
    const install = (await repo.findInScope('carrier-one', conn))!.row.id;
    await saveChecked(install, 'carrier-one', KEY_ONE, 'test');
    const id = await order('shop');
    const res = await buy(await quoted(id));
    expect((res.json() as Doc)['data']).toMatchObject({ state: 'booked', test: true });
    const bookingId = (res.json() as Doc)['data']['id'] as string;
    await applyBooking(applyDeps(), bookingId);
    expect((await rowOf(id))['tracking']).toBeNull();
    expect((await bookings().byId(bookingId))?.appliedAt).not.toBeNull();

    // Going live, the real label has its own place.
    await saveChecked(install, 'carrier-one', KEY_ONE, 'live');
    fake().book = () => ({ ...SHIPMENT, id: 'tx_live', tracking: 'TRK-LIVE' });
    const live = await buy(await quoted(id));
    expect(live.statusCode, live.body).toBe(200);
    expect((live.json() as Doc)['data']).toMatchObject({ state: 'booked', test: false, tracking: 'TRK-LIVE' });
  });

  it.skipIf(!available)('holds an order that already shows a label nobody recorded, as unknown, and buys nothing', async () => {
    const id = await order('shop', { tracking: 'TYPED-BY-HAND' });
    expect(await stand(id)).toMatchObject({ bookable: false, blockedBy: 'label-on-order' });
    const res = await buy(await quoted(id));
    expect(res.statusCode, res.body).toBe(409);
    expect((res.json() as Doc)['error']).toMatchObject({ code: 'BOOKING_EXISTS', details: { booking: { state: 'unknown', reason: 'label-on-order' } } });
    expect(fake().books).toEqual([]);
  });

  it.skipIf(!available)('once someone has looked at an unrecorded label and released it, that number stops holding the order', async () => {
    const id = await order('shop', { tracking: 'TYPED-BY-HAND' });
    const held = (((await buy(await quoted(id))).json() as Doc)['error']['details']['booking']) as Doc;
    expect(held).toMatchObject({ state: 'unknown', tracking: 'TYPED-BY-HAND' });
    await h.meta.db.updateTable('adminium_shipping_bookings').set({ createdAt: Date.now() - RELEASE_QUIET_MS - 1000 }).where('id', '=', held['id'] as string).execute();
    const released = await call('boss', 'POST', `shop/shipping/bookings/${String(held['id'])}/release`, { declaration: 'no-label-exists' });
    expect(released.statusCode, released.body).toBe(200);
    expect(await stand(id)).toMatchObject({ bookable: true, blockedBy: null });
    expect((await buy(await quoted(id))).statusCode).toBe(200);
    expect(fake().books).toHaveLength(1);
    // A different number typed in later is a new question.
    const other = await order('shop', { tracking: 'ANOTHER-NUMBER' });
    expect(await stand(other)).toMatchObject({ blockedBy: 'label-on-order' });
  });

  it.skipIf(!available)('two apps that both call their table `orders` keep their own places on one database', async () => {
    const id = await order('shop');
    expect((await buy(await quoted(id))).statusCode).toBe(200);
    await settings().setActiveCarrier(installs['solo']!, 'carrier-solo', null, 2);
    const { db } = await h.manager.data(conn);
    await db.insertInto(tables[`${conn}:solo`]! as never).values({ id: Number(id), number: `SOLO-${id}`, ship_name: NAME, ship_line1: STREET, ship_city: 'Leeds', ship_postcode: 'LS1 4AB', ship_country: 'GB' } as never).execute();
    const q = ((await quote('solo', body(id))).json() as Doc)['data'] as Doc;
    const res = await call('boss', 'POST', 'solo/shipping/bookings', { quoteId: q['quoteId'], rateId: q['rates'][0]['rateId'] });
    expect(res.statusCode, res.body).toBe(200);
    expect(fake().books).toHaveLength(2);
  });

  it.skipIf(!available)('a look-up under a key nobody checked asks the carrier nothing', async () => {
    const id = await order('shop');
    fake().book = unclear;
    const booking = ((await buy(await quoted(id))).json() as Doc)['data'] as Doc;
    const install = (await repo.findInScope('carrier-one', conn))!.row.id;
    await repo.setCredential(install, { kind: 'api-key', secret: { api_key: 'swapped-behind-the-door' } });
    fake().recover = () => ({ outcome: 'not-bought' });
    const res = await call('boss', 'POST', `shop/shipping/bookings/${String(booking['id'])}/check`);
    expect(code(res)).toBe('CARRIER_NOT_CHECKED');
    expect((await bookings().byId(booking['id'] as string))?.state).toBe('unknown');
    await saveChecked(install, 'carrier-one', KEY_ONE);
  });

  it.skipIf(!available)('a timed-out purchase shows unknown, blocks a rebook, and only someone who manages shipping can release it', async () => {
    const id = await order('shop');
    await setLimits('25.00', 20);
    fake().book = unclear;
    const res = await buy(await quoted(id, 'picker'), 'picker');
    expect(res.statusCode, res.body).toBe(200);
    const booking = (res.json() as Doc)['data'] as Doc;
    expect(booking).toMatchObject({ state: 'unknown', reason: 'carrier-unclear' });
    expect(booking['releaseAfter']).toBeGreaterThan(Date.now());
    expect(await stand(id, 'picker')).toMatchObject({ bookable: false, blockedBy: 'booking' });
    fake().book = () => SHIPMENT;
    expect(code(await buy(await quoted(id, 'picker'), 'picker'))).toBe('BOOKING_EXISTS');
    expect(fake().books).toHaveLength(1);

    const release = (who: string) => call(who, 'POST', `shop/shipping/bookings/${String(booking['id'])}/release`, { declaration: 'no-label-exists' });
    expect((await release('picker')).statusCode).toBe(403);
    expect((await call('boss', 'POST', `shop/shipping/bookings/${String(booking['id'])}/release`, {})).statusCode).toBe(422);
    expect(code(await release('boss'))).toBe('RELEASE_TOO_SOON');

    const past = Date.now() - RELEASE_QUIET_MS - 1000;
    await h.meta.db.updateTable('adminium_shipping_bookings').set({ calledAt: past }).where('id', '=', booking['id'] as string).execute();
    const done = await release('boss');
    expect(done.statusCode, done.body).toBe(200);
    expect((done.json() as Doc)['data']['state']).toBe('released');
    const audit = await h.meta.db.selectFrom('adminium_audit_log').select(['actorId', 'changes']).where('action', '=', 'shipping.booking.released').execute();
    expect(audit.at(-1)?.actorId).toBe(ids['boss']);
    expect(JSON.stringify(audit.at(-1)?.changes)).toContain('no-label-exists');
    expect(await stand(id)).toMatchObject({ bookable: true });
  });

  it.skipIf(!available)('one order is one place, however its id is spelled', async () => {
    const id = await order('shop');
    fake().book = unclear;
    const first = await buy(await quoted(id));
    expect((first.json() as Doc)['data']['state']).toBe('unknown');
    fake().book = () => SHIPMENT;
    const respelled = await quoted(`0${id}`);
    expect(code(await buy(respelled))).toBe('BOOKING_EXISTS');
    expect(fake().books).toHaveLength(1);
  });

  it.skipIf(!available)('checks for a label on the order even when a dead process left the place held', async () => {
    const id = await order('shop');
    const q = await quoted(id);
    const place = { installId: installs['shop']!, connectionId: conn, tableRef: 'orders', tableName: await (async () => { const { table } = (await createPayableSources({ meta: h.meta, manager: h.manager }).table(conn, tables[`${conn}:shop`]!))!; return table.id; })(), rowKey: id, purpose: 'outbound', parcelNumber: 1 };
    const account = (await settings().account((await repo.findInScope('carrier-one', conn))!.row.id))!;
    await bookings().reserve({ ...place, carrierInstallId: account.carrierInstallId, carrierKey: 'carrier-one', reference: `MP-${id}`, mode: 'live', accountFingerprint: account.fingerprint, detailsHash: 'd'.repeat(64), service: 'Evri', rateCode: 'evri', handleSealed: null, quotedAmount: '3.10', quotedCurrency: 'GBP', createdBy: null }, Date.now() - 120_000);
    await editOrder('shop', id, { tracking: 'TYPED-AFTER' });
    const res = await buy(q);
    expect((res.json() as Doc)['error']).toMatchObject({ code: 'BOOKING_EXISTS', details: { booking: { reason: 'label-on-order' } } });
    expect(fake().books).toEqual([]);
  });

  it.skipIf(!available)('writes only the first outbound parcel\'s number onto the order, and never over one already there', async () => {
    const id = await order('shop');
    const q2 = ((await quote('shop', body(id, { parcelNumber: 2 }))).json() as Doc)['data'] as Doc;
    fake().book = () => ({ ...SHIPMENT, id: 'tx_p2', tracking: 'TRK-PARCEL-2' });
    const second = ((await buy(q2)).json() as Doc)['data']['id'] as string;
    await applyBooking(applyDeps(), second);
    expect((await rowOf(id))['tracking']).toBeNull();

    fake().book = () => SHIPMENT;
    const first = ((await buy(await quoted(id))).json() as Doc)['data']['id'] as string;
    await editOrder('shop', id, { tracking: 'TYPED-MEANWHILE' });
    await applyBooking(applyDeps(), first);
    expect((await rowOf(id))['tracking']).toBe('TYPED-MEANWHILE');
  });

  it.skipIf(!available)('someone who manages shipping can still settle a booking whose order was deleted; nobody else can', async () => {
    const id = await order('shop');
    await setLimits('25.00', 20);
    fake().book = unclear;
    const booking = ((await buy(await quoted(id, 'picker'), 'picker')).json() as Doc)['data'] as Doc;
    const { db } = await h.manager.data(conn);
    await db.deleteFrom(tables[`${conn}:shop`]! as never).where('id' as never, '=', Number(id) as never).execute();
    expect((await call('picker', 'POST', `shop/shipping/bookings/${String(booking['id'])}/check`)).statusCode).toBe(404);
    expect(((await call('boss', 'POST', `shop/shipping/bookings/${String(booking['id'])}/check`)).json() as Doc)['data']).toMatchObject({ outcome: 'no-match' });
    await h.meta.db.updateTable('adminium_shipping_bookings').set({ calledAt: Date.now() - RELEASE_QUIET_MS - 1000 }).where('id', '=', booking['id'] as string).execute();
    const released = await call('boss', 'POST', `shop/shipping/bookings/${String(booking['id'])}/release`, { declaration: 'no-label-exists' });
    expect(released.statusCode, released.body).toBe(200);
    expect(await bookings().unresolved((await repo.findInScope('carrier-one', conn))!.row.id)).toEqual([]);
  });

  it.skipIf(!available)('an app with an unresolved label cannot be uninstalled', async () => {
    const id = await order('shop');
    fake().book = unclear;
    await buy(await quoted(id));
    const res = await composed.app.inject({ method: 'DELETE', url: `/api/v1/apps/shop?connectionId=${encodeURIComponent(conn)}`, headers: { cookie: cookies['boss']! }, payload: {} });
    expect(res.statusCode, res.body).toBe(409);
    expect((res.json() as Doc)['error']).toMatchObject({ code: 'SHIPPING_UNRESOLVED', details: { orders: [`MP-${id}`] } });
  });

  it.skipIf(!available)('a person\'s look-up settles an unknown purchase on a clear match', async () => {
    const id = await order('shop');
    fake().book = unclear;
    const booking = ((await buy(await quoted(id))).json() as Doc)['data'] as Doc;
    const check = () => call('boss', 'POST', `shop/shipping/bookings/${String(booking['id'])}/check`);
    expect(((await check()).json() as Doc)['data']).toMatchObject({ outcome: 'no-match', booking: { state: 'unknown' } });
    fake().recover = () => ({ outcome: 'found', shipment: SHIPMENT });
    const found = await check();
    expect(found.statusCode, found.body).toBe(200);
    expect((found.json() as Doc)['data']).toMatchObject({ outcome: 'found', booking: { state: 'booked', tracking: 'TRK-1001' } });
    expect(code(await check())).toBe('BOOKING_NOT_UNKNOWN');
    expect(fake().books).toHaveLength(1);
  });

  it.skipIf(!available)('a packer buys inside the limits with no price in sight, and a refusal gives the day\'s count back', async () => {
    const id = await order('shop');
    await setLimits('25.00', 20);
    fake().quote = () => [RATE, { code: 'dear', service: 'Dear', amount: 90, amountDecimal: '90.00', currency: 'GBP' }];
    const q = await quoted(id, 'packer');
    const dear = (q['rates'] as Doc[]).findIndex((rate) => rate['code'] === 'dear');
    const cheap = (q['rates'] as Doc[]).findIndex((rate) => rate['code'] === 'evri-48');
    const over = await buy(q, 'packer', dear);
    expect(over.statusCode, over.body).toBe(403);
    expect((over.json() as Doc)['error']).toMatchObject({ code: 'OWNER_BOOKS', details: { reason: 'over-limit' } });
    expect(fake().books).toEqual([]);

    fake().book = () => {
      throw { name: 'CarrierError', code: 'BALANCE_4_20', carrierMessage: 'Your balance of 4.20 GBP is too low', outcome: 'refused', reason: 'payment' };
    };
    const refused = await buy(q, 'packer', cheap);
    expect(refused.statusCode, refused.body).toBe(422);
    expect((refused.json() as Doc)['error']).toMatchObject({ code: 'CARRIER_REFUSED', details: { reason: 'payment' } });
    for (const hidden of ['4.20', 'BALANCE', '3.10']) expect(refused.body).not.toContain(hidden);
    const day = await (await import('../src/crud/row-limit-context.js')).venueDayOf(h.meta, conn);
    expect(await settings().dayLabels(installs['shop']!, day)).toBe(0);

    fake().book = () => SHIPMENT;
    const again = await quoted(id, 'packer');
    const res = await buy(again, 'packer', (again['rates'] as Doc[]).findIndex((rate) => rate['code'] === 'evri-48'));
    expect(res.statusCode, res.body).toBe(200);
    const data = (res.json() as Doc)['data'] as Doc;
    expect(data['state']).toBe('booked');
    for (const field of ['amount', 'currency', 'chargeDiffers']) expect(data).not.toHaveProperty(field);
    expect(res.body).not.toContain('3.10');
    expect(await settings().dayLabels(installs['shop']!, day)).toBe(1);
    const shown = await stand(id, 'packer');
    expect(JSON.stringify(shown)).not.toContain('3.10');
    // The owner sees what it cost.
    expect((await stand(id))['bookings'].find((one: Doc) => one['state'] === 'booked')).toMatchObject({ amount: '3.10', currency: 'GBP' });
  });

  it.skipIf(!available)('stops a booker at the daily limit when buying, not only when quoting', async () => {
    await setLimits('25.00', 1);
    const first = await order('shop');
    const second = await order('shop');
    const q1 = await quoted(first, 'picker');
    const q2 = await quoted(second, 'picker');
    expect((await buy(q1, 'picker')).statusCode).toBe(200);
    const res = await buy(q2, 'picker');
    expect(res.statusCode, res.body).toBe(403);
    expect((res.json() as Doc)['error']).toMatchObject({ code: 'OWNER_BOOKS', details: { reason: 'daily-limit' } });
    expect(fake().books).toHaveLength(1);
    // The owner is not bound.
    expect((await buy(await quoted(second))).statusCode).toBe(200);
  });

  it.skipIf(!available)('a bench can book and look up, and never release; a right on another install reaches nothing here', async () => {
    const id = await order('shop');
    await setLimits('25.00', 20);
    fake().book = unclear;
    const res = await buy(await quoted(id, 'bench'), 'bench');
    expect(res.statusCode, res.body).toBe(200);
    const bookingId = (res.json() as Doc)['data']['id'] as string;
    expect((await call('bench', 'POST', `shop/shipping/bookings/${bookingId}/check`)).statusCode).toBe(200);
    const release = await call('bench', 'POST', `shop/shipping/bookings/${bookingId}/release`, { declaration: 'no-label-exists' });
    expect(release.statusCode).toBe(403);
    expect(code(release)).toBe('APP_SCREENS_ONLY');
    // A role with no right on labels sees none of it.
    for (const who of ['nobody', 'admin']) {
      expect((await composed.app.inject({ method: 'GET', url: `/api/v1/apps/shop/shipping/bookings?connectionId=${encodeURIComponent(conn)}&table=orders&id=${id}`, headers: { cookie: cookies[who]! } })).statusCode).toBe(403);
      expect((await call(who, 'POST', `shop/shipping/bookings/${bookingId}/check`)).statusCode).toBe(403);
    }
    expect((await call('refunder', 'POST', 'shop/shipping/bookings', { quoteId: 'shq_x', rateId: 'rate_x' })).statusCode).toBe(403);
  });

  it.skipIf(!available)('refuses an API key on every booking route', async () => {
    const token = generateApiKey();
    await apiKeysRepo(h.meta).create({ name: `book-${String(nextId)}`, tokenHash: token.tokenHash, prefix: token.prefix, roleId: (await rolesRepo(h.meta).findBySlug('super-admin'))!.id, createdBy: ids['boss']! });
    for (const [method, path, payload] of [
      ['GET', 'shop/shipping/bookings', undefined],
      ['GET', 'shop/shipping/attention', undefined],
      ['POST', 'shop/shipping/bookings', { quoteId: 'shq_x', rateId: 'rate_x' }],
      ['POST', 'shop/shipping/bookings/shb_x/check', undefined],
      ['POST', 'shop/shipping/bookings/shb_x/release', { declaration: 'no-label-exists' }],
    ] as const) {
      const query = method === 'GET' ? '&table=orders&id=1' : '';
      const res = await composed.app.inject({ method, url: `/api/v1/apps/${path}?connectionId=${encodeURIComponent(conn)}${query}`, headers: { authorization: `Bearer ${token.key}` }, ...(payload === undefined ? {} : { payload }) });
      expect(res.statusCode, `${path}: ${res.body}`).toBe(403);
    }
    expect(fake().books).toEqual([]);
  });

  it.skipIf(!available)('a key with an unresolved purchase cannot be replaced, removed or uninstalled', async () => {
    const id = await order('shop');
    fake().book = unclear;
    const booking = ((await buy(await quoted(id))).json() as Doc)['data'] as Doc;
    const replaced = await saveKey('carrier-one', { api_key: FRESH_KEY }, { confirmAccountChange: true });
    expect(replaced.statusCode, replaced.body).toBe(409);
    expect((replaced.json() as Doc)['error']).toMatchObject({ code: 'KEY_IN_USE', details: { count: 1, orders: [`MP-${id}`] } });
    const removed = await composed.app.inject({ method: 'DELETE', url: `/api/v1/apps/shop/shipping/carriers/carrier-one/key?connectionId=${encodeURIComponent(conn)}`, headers: { cookie: cookies['boss']! } });
    expect(code(removed)).toBe('KEY_IN_USE');
    expect(await savedKey('carrier-one')).toBe(KEY_ONE);
    const gone = await composed.app.inject({ method: 'DELETE', url: `/api/v1/add-ons/carrier-one?connectionId=${encodeURIComponent(conn)}`, headers: { cookie: cookies['boss']! }, payload: {} });
    expect(gone.statusCode, gone.body).toBe(409);
    expect((gone.json() as Doc)['error']).toMatchObject({ code: 'ADD_ON_IN_USE', details: { bookings: [`MP-${id}`] } });
    expect(await repo.findInScope('carrier-one', conn)).not.toBeNull();
    expect(booking['state']).toBe('unknown');
  });

  it.skipIf(!available)('holds no carrier handle, address or key in a booking reply, its row, a log line or an audit row', async () => {
    logs.length = 0;
    const id = await order('shop');
    const res = await buy(await quoted(id));
    const bookingId = (res.json() as Doc)['data']['id'] as string;
    const shown = await stand(id);
    for (const secret of [REF, TOKEN, SHIPMENT_ID, LABEL_ID, KEY_ONE, STREET, PHONE, EMAIL]) {
      expect(res.body).not.toContain(secret);
      expect(JSON.stringify(shown)).not.toContain(secret);
    }
    const row = JSON.stringify(await h.meta.db.selectFrom('adminium_shipping_bookings').selectAll().where('id', '=', bookingId).executeTakeFirstOrThrow());
    for (const secret of [REF, TOKEN, KEY_ONE, NAME, STREET, PHONE, EMAIL, 'LS1 4AB']) expect(row).not.toContain(secret);
    const lines = logs.join('\n');
    for (const secret of [REF, TOKEN, KEY_ONE, NAME, STREET, PHONE, EMAIL]) expect(lines).not.toContain(secret);
    const audit = JSON.stringify(await h.meta.db.selectFrom('adminium_audit_log').selectAll().where('action', 'like', 'shipping.booking.%').execute());
    expect(audit).toContain('shipping.booking.made');
    for (const secret of [REF, TOKEN, SHIPMENT_ID, KEY_ONE, NAME, STREET, PHONE, EMAIL]) expect(audit).not.toContain(secret);
  });

  // ── Several databases ───────────────────────────────────────────────────

  it.skipIf(!available)('keeps two databases apart: each its own install of the carrier, its key, its choice and its Ship from', async () => {
    const homeInstall = installs['shop']!;
    const otherInstall = installs['shop@second']!;
    const otherShipFrom = { ...SHIP_FROM, name: 'Kiln Works', city: 'Stoke', postcode: 'ST1 1AA' };
    const at = (key: string) => `${key}?connectionId=${encodeURIComponent(second.id)}`;

    const saved = await call('boss', 'PUT', '', otherShipFrom, `/api/v1/apps/${at('shop/shipping/ship-from')}`);
    expect(saved.statusCode, saved.body).toBe(200);
    const chosen = await call('boss', 'PUT', '', { carrier: 'carrier-one' }, `/api/v1/apps/${at('shop/shipping/active-carrier')}`);
    expect(chosen.statusCode, chosen.body).toBe(200);
    expect((await settings().settings(otherInstall))?.shipFrom).toMatchObject({ name: 'Kiln Works' });
    expect((await settings().settings(homeInstall))?.shipFrom).toMatchObject({ name: 'Marlow Press' });

    // Without saying which, the two installs are a question and not a pick.
    expect((await call('boss', 'GET', '', undefined, '/api/v1/apps/shop/shipping')).statusCode).toBe(409);

    const here = await order('shop');
    const home = await composed.app.inject({ method: 'POST', url: `/api/v1/apps/shop/shipping/quotes?connectionId=${encodeURIComponent(conn)}`, headers: { cookie: cookies['boss']! }, payload: body(here) });
    expect(home.statusCode, home.body).toBe(200);
    expect(fake().made.at(-1)).toMatchObject({ key: 'carrier-one', credentials: { api_key: KEY_ONE } });
    expect(fake().quotes.at(-1)!.from).toMatchObject({ name: 'Marlow Press' });

    const there = await order('shop', {}, second.id);
    const away = await composed.app.inject({ method: 'POST', url: `/api/v1/apps/${at('shop/shipping/quotes')}`, headers: { cookie: cookies['boss']! }, payload: body(there) });
    expect(away.statusCode, away.body).toBe(200);
    // That database's own key, never the first install's.
    expect(fake().made.at(-1)).toMatchObject({ key: 'carrier-one', credentials: { api_key: KEY_TWO } });
    expect(fake().quotes.at(-1)!.from).toMatchObject({ name: 'Kiln Works' });

    const rows = await h.meta.db.selectFrom('adminium_shipping_quotes').select(['installId', 'connectionId']).where('id', 'in', [(home.json() as Doc)['data']['quoteId'], (away.json() as Doc)['data']['quoteId']]).execute();
    expect(rows.map((row) => row.connectionId).sort()).toEqual([conn, second.id].sort());
    expect(rows.map((row) => row.installId).sort()).toEqual([homeInstall, otherInstall].sort());

    // One database's Ship from clearing its quotes leaves the other's.
    await call('boss', 'PUT', '', { ...otherShipFrom, city: 'Hanley' }, `/api/v1/apps/${at('shop/shipping/ship-from')}`);
    expect(await settings().quote((away.json() as Doc)['data']['quoteId'])).toBeNull();
    expect(await settings().quote((home.json() as Doc)['data']['quoteId'])).not.toBeNull();
  });

  it.skipIf(!available)('forgets an app\'s choice, Ship from and quotes when it is uninstalled', async () => {
    const goneId = installs['gone']!;
    await settings().setShipFrom(goneId, SHIP_FROM, null, 1);
    await settings().setActiveCarrier(goneId, 'carrier-one', null, 1);
    const made = await settings().replaceQuote({ installId: goneId, connectionId: conn, tableRef: 'orders', rowKey: '1', purpose: 'outbound', parcelNumber: 1, carrierKey: 'carrier-one', detailsHash: 'a'.repeat(64), rates: [], createdBy: null, expiresAt: Date.now() + 1000 }, Date.now());
    const res = await h.inject({ method: 'DELETE', url: '/apps/gone', payload: {} });
    expect(res.statusCode, res.body).toBe(200);
    delete installs['gone'];
    expect(await settings().settings(goneId)).toBeNull();
    expect(await settings().quote(made.id)).toBeNull();
  });
});

/** A database with no payable named: a limited read of it hides money. */
const NO_PAYABLES = { shapeOf: async () => null, profile: async () => null } as unknown as PayableSources;

describe('a server with network features off', () => {
  it('asks no carrier, and reads no key', async () => {
    const made: string[] = [];
    let h: Harness | undefined;
    const reads: string[] = [];
    try {
      h = await addOnHarness('sqlite', {
        unbuiltWords: {},
        routes: ({ meta, manager }) => [
          shippingRoutes({
            meta,
            manifests: new Proxy(manifestsRepo(meta, addOnCredentialCryptoFromSecret(TEST_SECRET)), {
              get(target, property, receiver) {
                if (property === 'getCredential') reads.push('read');
                return Reflect.get(target, property, receiver) as unknown;
              },
            }),
            secret: TEST_SECRET,
            runtime: () => {
              made.push('runtime');
              return null;
            },
            networkFeatures: () => false,
            sources: NO_PAYABLES,
            openBookings: async () => ({ count: 0, own: [] }),
            enqueueApply: async () => undefined,
            readRow: (request, connectionId, tableId, row) => readReachedRow({ meta, data: (id) => manager.data(id), resolve: (one) => request.server.rbac.resolve(one) }, request, connectionId, tableId, row),
          }),
        ],
      });
      await h.stageApp(shopDoc('shop', true));
      expect((await h.install('shop', '1.0.0', { shippingUnticked: [] })).statusCode).toBe(200);
      const manifests = manifestsRepo(h.meta, addOnCredentialCryptoFromSecret(TEST_SECRET));
      const app = (await manifests.findInScope('shop', h.connectionId))!;
      const carrier = await manifests.install({ manifestKey: 'carrier-one', version: '1.0.0', kind: 'add-on', source: 'file', document: carrierDoc('carrier-one'), connectionId: h.connectionId, status: 'installed', attachTo: [{ key: 'shop', hostInstall: app.row.id }] });
      await manifests.setCredential(carrier.row.id, { kind: 'api-key', secret: { api_key: KEY_ONE } });
      await shippingRepo(h.meta).setShipFrom(app.row.id, SHIP_FROM, null, 1);
      const table = (await h.meta.db.selectFrom('adminium_app_tables').select('tableName').where('ref', '=', 'orders').executeTakeFirstOrThrow()).tableName;
      const { db } = await h.manager.data(h.connectionId);
      await db.insertInto(table as never).values({ id: 7, number: 'MP-7', ship_name: NAME, ship_line1: STREET, ship_city: 'Leeds', ship_postcode: 'LS1 4AB', ship_country: 'GB' } as never).execute();

      const res = await h.inject({ method: 'POST', url: '/apps/shop/shipping/quotes', payload: { source: { table: 'orders', id: '7' }, parcel: PARCEL } });
      expect(res.statusCode, res.body).toBe(502);
      expect(res.json().error).toMatchObject({ code: 'CARRIER_UNAVAILABLE', details: { reason: 'network-off' } });
      expect(made).toEqual([]);
      expect(reads).toEqual([]);
    } finally {
      await h?.close();
    }
  }, 120_000);
});

describe('the door of a key still in use, and the pace of quotes', () => {
  it('refuses to replace or remove a key with a booking unresolved, naming the orders, and stops a runaway quoter', async () => {
    let h: Harness | undefined;
    let open: OpenBookings = { count: 0, own: [] };
    let readFails = false;
    try {
      h = await addOnHarness('sqlite', {
        unbuiltWords: {},
        routes: ({ meta, manager }) => [
          shippingRoutes({
            meta,
            manifests: manifestsRepo(meta, addOnCredentialCryptoFromSecret(TEST_SECRET)),
            secret: TEST_SECRET,
            runtime: () => null,
            networkFeatures: () => true,
            sources: NO_PAYABLES,
            openBookings: async () => open,
            enqueueApply: async () => undefined,
            quotesPerMinute: 2,
            readRow: async (request, connectionId, tableId, row) => {
              if (readFails) throw new Error('the database is away');
              return readReachedRow({ meta, data: (id) => manager.data(id), resolve: (one) => request.server.rbac.resolve(one) }, request, connectionId, tableId, row);
            },
          }),
        ],
      });
      await h.stageApp(shopDoc('shop', true));
      expect((await h.install('shop', '1.0.0', { shippingUnticked: [] })).statusCode).toBe(200);
      const manifests = manifestsRepo(h.meta, addOnCredentialCryptoFromSecret(TEST_SECRET));
      const app = (await manifests.findInScope('shop', h.connectionId))!;
      const carrier = await manifests.install({ manifestKey: 'carrier-one', version: '1.0.0', kind: 'add-on', source: 'file', document: carrierDoc('carrier-one'), connectionId: h.connectionId, status: 'installed', attachTo: [{ key: 'shop', hostInstall: app.row.id }] });
      await manifests.setCredential(carrier.row.id, { kind: 'api-key', secret: { api_key: KEY_ONE } });
      await shippingRepo(h.meta).setShipFrom(app.row.id, SHIP_FROM, null, 1);
      const table = (await h.meta.db.selectFrom('adminium_app_tables').select('tableName').where('ref', '=', 'orders').executeTakeFirstOrThrow()).tableName;
      const { db } = await h.manager.data(h.connectionId);
      await db.insertInto(table as never).values({ id: 7, number: 'MP-7', ship_name: NAME, ship_line1: STREET, ship_city: 'Leeds', ship_postcode: 'LS1 4AB', ship_country: 'GB' } as never).execute();
      await db.insertInto(table as never).values({ id: 8, number: 'MP-8', ship_name: NAME, ship_line1: STREET, ship_city: 'Leeds', ship_postcode: 'LS1 4AB', ship_country: 'GB' } as never).execute();
      const tableName = (await factsViewFor(h.meta, h.connectionId))!.table(table).id;
      const onOrder = (rowKey: string) => ({ connectionId: h!.connectionId, installId: app.row.id, tableRef: 'orders', tableName, rowKey });
      open = { count: 2, own: [onOrder('7'), onOrder('8')] };

      for (const [method, payload] of [['PUT', { fields: { api_key: 'another-value' } }], ['DELETE', undefined]] as const) {
        const res = await h.inject({ method, url: '/apps/shop/shipping/carriers/carrier-one/key', ...(payload === undefined ? {} : { payload }) });
        expect(res.statusCode, res.body).toBe(409);
        expect(res.json().error).toMatchObject({ code: 'KEY_IN_USE', details: { count: 2, orders: ['MP-7', 'MP-8'] } });
      }
      expect((await manifests.getCredential(carrier.row.id))?.secret).toEqual({ api_key: KEY_ONE });
      // A database that cannot be read names no order, and the count and the page still stand.
      readFails = true;
      const status = await h.inject({ method: 'GET', url: '/apps/shop/shipping' });
      expect(status.statusCode, status.body).toBe(200);
      expect(status.json().data.carriers[0].openBookings).toEqual({ count: 2, orders: [] });
      readFails = false;
      open = { count: 0, own: [] };

      const ask = () => h!.inject({ method: 'POST', url: '/apps/shop/shipping/quotes', payload: { source: { table: 'orders', id: '7' }, parcel: PARCEL } });
      // No runtime here, so each counted quote stops at the carrier that did not load.
      expect((await ask()).json().error.code).toBe('CARRIER_NOT_LOADED');
      expect((await ask()).json().error.code).toBe('CARRIER_NOT_LOADED');
      const third = await ask();
      expect(third.statusCode, third.body).toBe(429);
      expect(third.json().error).toMatchObject({ code: 'QUOTES_TOO_FAST' });
      expect(third.json().error.details.retryAfterSeconds).toBeGreaterThan(0);
    } finally {
      await h?.close();
    }
  }, 120_000);
});
