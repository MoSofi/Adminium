// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A WEBSITE TEMPLATE BUILT AS AN APP, on a whole server, on every engine.
 *
 * When the Designer builds an app from a shop template, the model writes
 * ordinary app files by the plan the person approved: a table per kind of
 * repeated block (the products, each with its picture), a dashboard page per
 * table with a staff role's grants, public reads of only the shown columns,
 * the template's own blocks as sample rows with a picture each, the forms as
 * limited public creates, and the cart as an order with its lines. Here those
 * files are written into a project folder exactly as the guides describe
 * them, checked, built, and applied by a server that runs the folder, as
 * `adminium dev` and the Designer's apply do. Then the customer side's calls
 * are made through the app's own key, with nothing faked below the route.
 */
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { sql } from 'kysely';
import { AdapterRegistry, type AdapterProvider } from '@adminium/engine/adapter';
import { publicEndpointsRepo, publicKeysRepo, type MetaDb } from '@adminium/meta';
import { pictureUrl, type PublicConfig } from '@adminium/public-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { composeServer, type ComposedServer } from '../src/compose.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { registerAdapters } from '../src/connections/register-adapters.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import { checkApp } from '../src/project/apps/check-app.js';
import { scaffoldApp } from '../src/project/apps/scaffold-app.js';
import { buildProject } from '../src/project/build.js';
import { syncProjectDatabases } from '../src/project/databases.js';
import { openPublishableKey } from '../src/public-api/keys.js';
import { solveProof } from '../src/public-api/proof.js';
import { APP_VERSION } from '../src/version.js';
import { asProject, canBuildSides } from './app-project-helpers.js';
import { makeEnv, TEST_SECRET } from './helpers.js';
import { META_ENGINES, type MetaEngine } from './meta-dialects.js';
import { png } from './picture-images.js';

const KEY = 'shop';
const APP = `apps/${KEY}`;
const ORIGIN = 'https://shop.example.com';

// ── the files the model writes, by the approved plan ────────────────────────

const id = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength: number, more: Record<string, unknown> = {}) => ({ ref, type: 'text', maxLength, label: { 'en-US': ref }, ...more });
const money = (ref: string, rules?: Record<string, unknown>) => ({ ref, type: 'decimal', scale: 'currency', nullable: true, ...(rules === undefined ? {} : { rules }) });
/** A picture column: an image the app's own file rule keeps. */
const PICTURE_RULE = { file: { accept: ['png', 'jpeg', 'webp', 'gif'], maxBytes: 5242880 } };
const table = (ref: string, label: string, plural: string, keyField: string, columns: unknown[]) => ({ ref, label: { 'en-US': label }, labelPlural: { 'en-US': plural }, keyField, columns });

/** The template's pictures, as `use_site` copies them into the app's sample folder. */
const PICTURES = {
  chair: png({ fill: 40, text: 'Shot on a phone, 14 Elm Row' }),
  aero: png({ fill: 90 }),
  ergo: png({ fill: 160 }),
};
const sha = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

/**
 * The shop page's four product cards, in its order. The fourth is the
 * template's filler: the first chair again, with the same picture file, and
 * still an asset label of its own.
 */
const CARDS = [
  { label: 'product:nordic', name: 'Nordic Chair', price: '50.00', picture: 'chair' },
  { label: 'product:kruzo', name: 'Kruzo Aero Chair', price: '78.00', picture: 'aero' },
  { label: 'product:ergonomic', name: 'Ergonomic Chair', price: '43.00', picture: 'ergo' },
  { label: 'product:nordic-2', name: 'Nordic Chair', price: '50.00', picture: 'chair' },
] as const;
const COLUMNS_SHOWN = ['id', 'name', 'price', 'picture', 'position'];

function appFiles(): Record<string, unknown> {
  const pages = (refs: [string, string, string][]) =>
    Object.fromEntries(
      refs.map(([ref, title, icon], i) => [
        `manifest/pages/${KEY}-${ref.replace(/_/g, '-')}.json`,
        { ref: `${KEY}-${ref.replace(/_/g, '-')}`, template: 'page-crud', title: { key: `${KEY}.${ref}`, fallback: title }, nav: { group: 'main', icon, order: i + 1 }, bindings: { rows: ref } },
      ]),
    );
  return {
    // What becomes a table: the product cards.
    'manifest/tables/products.json': table('products', 'Product', 'Products', 'name', [
      id,
      text('name', 80),
      { ref: 'price', type: 'decimal', scale: 'currency', default: 0, label: { 'en-US': 'Price' } },
      { ref: 'picture', type: 'text', maxLength: 400, nullable: true, semantic: 'image', rules: PICTURE_RULE, label: { 'en-US': 'Picture' } },
      { ref: 'position', type: 'int', nullable: true, label: { 'en-US': 'Position' } },
      { ref: 'published', type: 'bool', default: true, label: { 'en-US': 'Published' } },
    ]),
    // What the forms write to: the contact form and the newsletter.
    'manifest/tables/messages.json': table('messages', 'Message', 'Messages', 'name', [
      id,
      text('name', 80),
      text('email', 254, { rules: { validation: { format: 'email' } } }),
      text('body', 1000),
      { ref: 'handled', type: 'bool', default: false, label: { 'en-US': 'Handled' } },
      { ref: 'created_at', type: 'timestamptz', role: 'created_at', default: 'now' },
    ]),
    'manifest/tables/subscribers.json': table('subscribers', 'Subscriber', 'Subscribers', 'email', [
      id,
      text('name', 80, { nullable: true }),
      text('email', 254, { rules: { validation: { format: 'email' } } }),
      { ref: 'created_at', type: 'timestamptz', role: 'created_at', default: 'now' },
    ]),
    // The cart and the checkout: an order with its lines.
    'manifest/tables/orders.json': table('orders', 'Order', 'Orders', 'number', [
      id,
      { ref: 'number', type: 'int', nullable: true, rules: { sequence: { gapless: true } }, label: { 'en-US': 'Number' } },
      text('name', 80),
      text('email', 254, { rules: { validation: { format: 'email' } } }),
      text('address', 300),
      { ref: 'payment', type: 'enum', enum: ['transfer', 'on_delivery', 'card'], label: { 'en-US': 'Payment' } },
      text('client_key', 64, { nullable: true, unique: true }),
      money('subtotal', { rollup: { from: 'order_lines', via: 'order_id', sum: 'line_total' } }),
      money('total', { formula: { add: [{ coalesce: ['subtotal', 0] }, 0] } }),
      { ref: 'created_at', type: 'timestamptz', role: 'created_at', default: 'now' },
    ]),
    'manifest/tables/order_lines.json': table('order_lines', 'Order line', 'Order lines', 'id', [
      id,
      { ref: 'order_id', type: 'fk', references: 'orders' },
      { ref: 'product_id', type: 'fk', references: 'products' },
      { ref: 'qty', type: 'int', default: 1, rules: { validation: { min: 1, max: 20 } }, label: { 'en-US': 'Quantity' } },
      { ref: 'position', type: 'int', nullable: true },
      money('unit_price', { copy: { via: 'product_id', from: 'price' } }),
      money('line_total', { formula: { mul: ['qty', { coalesce: ['unit_price', 0] }] } }),
      // The line keeps the product's picture as it was when ordered, for the staff's order page.
      { ref: 'picture', type: 'text', maxLength: 400, nullable: true, semantic: 'image', rules: { copy: { via: 'product_id', from: 'picture' } } },
    ]),
    // A dashboard page per table, and a staff role that may use them.
    ...pages([
      ['products', 'Products', 'package'],
      ['orders', 'Orders', 'shopping-cart'],
      ['order_lines', 'Order lines', 'list'],
      ['messages', 'Messages', 'inbox'],
      ['subscribers', 'Subscribers', 'mail'],
    ]),
    'manifest/roles.json': [
      {
        key: 'staff',
        name: 'Shop staff',
        permissions: [
          'table:@products:read',
          'table:@products:create',
          'table:@products:update',
          'table:@orders:read',
          'table:@orders:update',
          'table:@order_lines:read',
          'table:@messages:read',
          'table:@messages:update',
          'table:@subscribers:read',
          ...['products', 'orders', 'order-lines', 'messages', 'subscribers'].map((page) => `page:@${KEY}-${page}:view`),
        ],
      },
    ],
    'manifest/access.json': {
      publicAccess: [
        // The shop's grid: only the columns a card shows, only what is published, its pictures for every visitor.
        { table: 'products', methods: ['GET'], select: COLUMNS_SHOWN, filters: [{ column: 'published', op: 'eq', value: true }], pictures: ['picture'] },
        // The contact form.
        {
          table: 'messages',
          methods: ['POST'],
          select: ['id'],
          writable: ['name', 'email', 'body'],
          requires: ['name', 'email', 'body'],
          humanCheck: true,
          anonymous: { perValue: { columns: ['email'], n: 5 }, perKeyHour: 100, perIpHour: 3, plainText: ['name'] },
        },
        // The newsletter form.
        {
          table: 'subscribers',
          methods: ['POST'],
          select: ['id'],
          writable: ['name', 'email'],
          requires: ['email'],
          humanCheck: true,
          anonymous: { perValue: { columns: ['email'], n: 2 }, perKeyHour: 100, perIpHour: 10, plainText: ['name'] },
        },
        // The cart: one order with its lines, a quote first, the total checked, a retry key.
        {
          table: 'orders',
          methods: ['POST'],
          select: ['id', 'number', 'subtotal', 'total'],
          writable: ['name', 'email', 'address', 'payment', 'client_key'],
          writableValues: { payment: ['transfer', 'on_delivery'] },
          requires: ['name', 'email', 'address', 'payment'],
          humanCheck: true,
          anonymous: { perValue: { columns: ['email'], n: 20 }, perKeyHour: 300, perIpHour: 20, plainText: ['name'] },
          children: {
            order_lines: {
              via: 'order_id',
              writable: ['product_id', 'qty'],
              select: ['id', 'qty', 'unit_price', 'line_total'],
              requires: ['product_id'],
              position: 'position',
              min: 1,
              max: 40,
            },
          },
          dryRun: true,
          expect: 'total',
          clientKey: 'client_key',
        },
      ],
    },
    // The template's own blocks, one row each, each picture an asset of its own.
    'manifest/sample.json': { sampleData: { file: 'seeds/sample.json' } },
    'seeds/sample.json': {
      format: 'adminium.sample/1',
      app: KEY,
      assets: Object.fromEntries(CARDS.map((card, i) => [`picture-own-${String(i + 1)}`, { file: `seeds/pictures/${card.picture}.png`, sha256: sha(PICTURES[card.picture].bytes) }])),
      tables: [
        {
          ref: 'products',
          rows: CARDS.map((card, i) => ({ '@label': card.label, name: card.name, price: card.price, picture: { '@asset': `picture-own-${String(i + 1)}` }, position: i + 1, published: true })),
        },
      ],
    },
  };
}

/** The customer side's screen: the template's grid filled from the products, the form sending a message. */
const SCREEN = `import { useEffect, useMemo, useState } from 'react';
import { createPublicClient, pictureUrl, type PublicConfig, type Row } from '@adminiumjs/public-client';
import { en, useCustomer, type CustomerConfig } from '@adminiumjs/adminium/side';

const PRODUCTS = 'products';
const MESSAGES = 'messages';

export function App() {
  const loaded = useCustomer();
  if (loaded.state === 'loading') return <p>{en('Loading…')}</p>;
  if (loaded.state === 'error') return <p>{loaded.message}</p>;
  return <Shop config={loaded.value} />;
}

function Shop({ config }: { config: CustomerConfig }) {
  const client = useMemo(() => createPublicClient({ baseUrl: config.baseUrl, publishableKey: config.publishableKey }), [config]);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [setup, setSetup] = useState<PublicConfig | null>(null);
  useEffect(() => {
    if (client === null) return;
    void client.config().then(setSetup);
    void client.list(PRODUCTS).then((list) => setRows(list.data));
  }, [client]);
  if (client === null) return <p>{en('This page is not connected yet.')}</p>;
  const send = (name: string, email: string, body: string) => client.create(MESSAGES, { name, email, body });
  return (
    <div className="product-section">
      {(rows ?? []).map((row) => (
        <div className="product-item" key={String(row['id'])}>
          {setup === null ? null : <img src={pictureUrl(config.baseUrl, setup, PRODUCTS, String(row['id']), 'picture', row['picture']) ?? ''} alt={String(row['name'])} />}
          <h3 className="product-title">{String(row['name'])}</h3>
        </div>
      ))}
      <button type="button" onClick={() => void send('Ana', 'ana@example.com', 'Hello')}>{en('Send')}</button>
    </div>
  );
}
`;

// ── a project on an engine, and a server that runs it ──────────────────────

interface Shop {
  root: string;
  meta: MetaDb;
  manager: ConnectionManager;
  mainId: string;
  dataDir: string;
  /** What the check said was wrong with the app, as `adminium app check` prints it. */
  errors: string[];
  lines: { log: string[]; warn: string[] };
  composed: ComposedServer | null;
  token: string;
  close: () => Promise<void>;
}

/** A project whose meta store and `main` database are both on the engine, each a database of its own, dropped after. */
async function projectOn(engine: MetaEngine): Promise<Omit<Shop, 'errors' | 'composed' | 'token' | 'lines'>> {
  const dir = await mkdtemp(join(tmpdir(), 'adminium-template-app-'));
  const handle = await engine.make();
  const { meta } = handle;
  const name = `adminium_template_${randomBytes(4).toString('hex')}`;
  let dsn: string;
  let drop: () => Promise<void> = async () => undefined;
  if (engine.name === 'sqlite') {
    const file = join(dir, 'main.db');
    new BetterSqlite3(file).close();
    dsn = `sqlite:${file}`;
  } else if (engine.name === 'postgres') {
    const base = process.env['TEST_POSTGRES_URL'] as string;
    const { default: pg } = await import('pg');
    const admin = new pg.Client({ connectionString: base });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${name}"`);
    await admin.end();
    const url = new URL(base);
    url.pathname = `/${name}`;
    dsn = url.toString();
    drop = async () => {
      const again = new pg.Client({ connectionString: base });
      await again.connect();
      await again.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await again.end();
    };
  } else {
    const base = process.env['TEST_MYSQL_URL'] as string;
    const mysql = await import('mysql2/promise');
    const admin = await mysql.createConnection({ uri: base });
    await admin.query(`CREATE DATABASE \`${name}\``);
    await admin.end();
    const url = new URL(base);
    url.pathname = `/${name}`;
    dsn = url.toString();
    drop = async () => {
      const again = await mysql.createConnection({ uri: base });
      await again.query(`DROP DATABASE IF EXISTS \`${name}\``);
      await again.end();
    };
  }
  const registry = new AdapterRegistry<AdapterProvider>();
  await registerAdapters(registry);
  const manager = new ConnectionManager({ meta, crypto: dsnCryptoFromSecret(TEST_SECRET), registry, metaDsn: null, blockLoopback: false });
  await syncProjectDatabases({ manager, meta, root: dir, databases: new Map([['main', dsn]]), missing: [], log: () => undefined, warn: () => undefined });
  const main = await manager.connections.findByProjectKey('main');
  if (main === null) throw new Error('the project database was not connected');
  const dataDir = join(dir, '.data');
  mkdirSync(dataDir, { recursive: true });
  return {
    root: asProject(dir),
    meta,
    manager,
    mainId: main.id,
    dataDir,
    async close() {
      await manager.disposeAll().catch(() => undefined);
      await handle.destroy().catch(() => undefined);
      await drop().catch(() => undefined);
      await rm(dir, { recursive: true, force: true });
    },
  };
}

/** Write the app's files as the model does, replacing the starter's tables, pages and side screen. */
function writeApp(root: string): void {
  scaffoldApp({ root, key: KEY, name: 'Furni', sides: ['customer'], version: APP_VERSION, bare: true });
  for (const [file, value] of Object.entries(appFiles())) {
    const path = join(root, APP, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  }
  for (const [name, picture] of Object.entries(PICTURES)) {
    mkdirSync(join(root, APP, 'seeds', 'pictures'), { recursive: true });
    writeFileSync(join(root, APP, 'seeds', 'pictures', `${name}.png`), picture.bytes);
  }
  writeFileSync(join(root, APP, 'customer', 'src', 'App.tsx'), SCREEN);
}

/** A server in dev mode over the folder: composing it applies the folder's apps, as every start does. */
async function serve(shop: Shop, engine: MetaEngine): Promise<ComposedServer> {
  const runService = createRunService({ meta: shop.meta });
  const composed = await composeServer({
    env: makeEnv({ HOST: '127.0.0.1', ADMINIUM_DATA_DIR: shop.dataDir, ADMINIUM_PUBLIC_API_ORIGINS: ORIGIN }),
    metaStore: { meta: shop.meta, url: `${engine.name}://test`, engine: engine.name, source: 'embedded', close: async () => Promise.resolve() },
    manager: shop.manager,
    runService,
    applyService: createApplyService({ meta: shop.meta, runService }),
    allowed: null,
    logger: false,
    telemetry: false,
    project: { root: shop.root, mode: 'dev', log: (line) => shop.lines.log.push(line), warn: (line) => shop.lines.warn.push(line), databases: ['main'] },
  });
  await composed.app.ready();
  await composed.addOnsLoaded;
  // Nothing in the background races the test.
  await composed.jobs.worker.stop();
  composed.jobs.scheduler.stop();
  return composed;
}

async function openShop(engine: MetaEngine): Promise<Shop> {
  const project = await projectOn(engine);
  writeApp(project.root);
  const errors = checkApp(project.root, KEY, { version: APP_VERSION })
    .findings.filter((finding) => finding.level === 'error')
    .map((finding) => `${finding.file} · ${finding.path} · ${finding.message}`);
  const shop: Shop = { ...project, errors, lines: { log: [], warn: [] }, composed: null, token: '' };
  if (errors.length > 0) return shop;
  await buildProject({ root: shop.root, configFile: join(shop.root, 'adminium.config.ts') }, { version: APP_VERSION });
  shop.composed = await serve(shop, engine);
  const key = await publicKeysRepo(shop.meta).newestLiveByApp(KEY, 'customer');
  if (key?.tokenEncrypted === null || key?.tokenEncrypted === undefined) throw new Error(`the app has no customer key: ${[...shop.lines.warn, ...shop.lines.log].join('\n')}`);
  shop.token = await openPublishableKey(dsnCryptoFromSecret(TEST_SECRET), key.tokenEncrypted);
  return shop;
}

// ── the customer side's calls, through the app's own key ────────────────────

let visitors = 0;
/** A visitor's address of its own, so one test's limits are not another's. */
const visitor = (): string => {
  visitors += 1;
  return `10.42.${String((visitors >> 8) & 255)}.${String(visitors & 255)}`;
};

describe.each(META_ENGINES)('a website template built as an app, on $name', (engine) => {
  describe.skipIf(!engine.available || !canBuildSides)('', { timeout: 240_000 }, () => {
    let shop: Shop;
    beforeAll(async () => {
      shop = await openShop(engine);
    }, 240_000);
    afterAll(async () => {
      await shop?.composed?.app.close();
      await shop?.close();
    });

    const app = () => {
      if (shop.composed === null) throw new Error(`the app was not applied: ${shop.errors.join('\n')}`);
      return shop.composed.app;
    };
    const headers = (proof?: string) => ({ authorization: `Bearer ${shop.token}`, origin: ORIGIN, ...(proof === undefined ? {} : { 'x-adminium-proof': proof }) });
    /** A solved human check, asked from `address`, as the public client solves one. */
    const proofFor = async (address: string): Promise<string> => {
      const res = await app().inject({ method: 'GET', url: '/api/v1/public/challenge?purpose=write', remoteAddress: address, headers: headers() });
      expect(res.statusCode, res.body).toBe(200);
      const challenge = (res.json() as { data: { id: string; salt: string; difficulty: number } }).data;
      return `${challenge.id}.${solveProof(challenge.salt, challenge.difficulty)}`;
    };
    const get = (url: string, address = visitor()) => app().inject({ method: 'GET', url: `/api/v1/public${url}`, remoteAddress: address, headers: headers() });
    const create = async (ref: string, payload: Record<string, unknown>, opts: { proof?: boolean; address?: string; path?: string } = {}) => {
      const address = opts.address ?? visitor();
      const proof = opts.proof === false ? undefined : await proofFor(address);
      return app().inject({ method: 'POST', url: `/api/v1/public/records/${ref}${opts.path ?? ''}`, remoteAddress: address, headers: headers(proof), payload });
    };
    const codeOf = (res: { json: () => unknown }): string | undefined => (res.json() as { error?: { code?: string } }).error?.code;
    /** An `<img>`'s request: no key, no session, no origin. */
    const image = (url: string) => app().inject({ method: 'GET', url, remoteAddress: visitor() });

    const db = async () => (await shop.manager.data(shop.mainId)).db;
    const rows = async (statement: string) => (await sql.raw<Record<string, unknown>>(statement).execute(await db())).rows;
    const count = async (ref: string) => Number((await rows(`SELECT COUNT(*) AS n FROM ${KEY}_${ref}`))[0]?.['n']);
    const products = async () => (await rows(`SELECT id, name, price, picture, position FROM ${KEY}_products ORDER BY id`)).map((row) => ({ id: Number(row['id']), name: row['name'], price: row['price'], picture: row['picture'], position: row['position'] }));
    /** Every file Adminium keeps, as stored: who holds it, and whether it is in the bin. */
    const files = async () =>
      (await shop.meta.db.selectFrom('adminium_files').select(['id', 'sha256', 'entityTable', 'entityId', 'attachedAt', 'deletedAt']).orderBy('id').execute()).map((file) => ({
        ...file,
        attachedAt: file.attachedAt === null ? null : Number(file.attachedAt),
        deletedAt: file.deletedAt === null ? null : Number(file.deletedAt),
      }));
    /** The app's own tables in the database, by name. */
    const tables = async () => (await (await db()).introspection.getTables()).map((found) => found.name).filter((found) => found.startsWith(`${KEY}_`)).sort();
    const cents = (value: unknown): string | null => (value === null || value === undefined ? null : Number(value).toFixed(2));
    /** Each product's picture's address on the public page, as `pictureUrl` makes it from `/public/config`. */
    const pictureAddresses = async (): Promise<Map<number, string | null>> => {
      const config = (await get('/config')).json() as { data: PublicConfig };
      const list = (await get(`/records/${KEY}_products`)).json() as { data: Record<string, unknown>[] };
      return new Map(list.data.map((row) => [Number(row['id']), pictureUrl('', config.data, `${KEY}_products`, Number(row['id']), 'picture', row['picture'])]));
    };

    it('passes the check, installs, and puts each template block in as a product with a picture file of its own', async () => {
      expect(shop.errors).toEqual([]);
      expect(shop.lines.warn).toEqual([]);
      expect(shop.lines.log).toContain(`App "${KEY}": its sample data was added.`);
      // The plan's five tables, and the ledger Adminium keeps of the app's sample rows.
      expect(await tables()).toEqual(['messages', 'order_lines', 'orders', 'products', 'sample_data', 'subscribers'].map((ref) => `${KEY}_${ref}`));

      // One row for each card the template shows, in its order, with its words.
      const made = await products();
      expect(made.map((row) => [row['name'], cents(row['price']), Number(row['position'])])).toEqual(CARDS.map((card, i) => [card.name, card.price, i + 1]));
      // Every row's picture is a file of its own, attached to that row: the filler's too, though it is the first card's picture.
      const pictures = made.map((row) => String(row['picture']));
      expect(new Set(pictures).size).toBe(CARDS.length);
      const kept = new Map((await files()).map((file) => [file.id, file]));
      for (const row of made) {
        const file = kept.get(String(row['picture']));
        expect(file, String(row['picture'])).toMatchObject({ entityId: String(row['id']), deletedAt: null });
        expect(file?.attachedAt).not.toBeNull();
      }
      const [first, , , filler] = made;
      expect(kept.get(String(first?.['picture']))?.sha256).toBe(sha(PICTURES.chair.bytes));
      expect(kept.get(String(filler?.['picture']))?.sha256).toBe(sha(PICTURES.chair.bytes));

      // Both copies of the chair are served on the public page, each at its own address.
      const addresses = await pictureAddresses();
      for (const row of [first!, filler!]) {
        const address = addresses.get(row.id);
        expect(address, `product ${String(row.id)}`).toContain(String(row['picture']));
        const served = await image(address!);
        expect(served.statusCode, served.body).toBe(200);
        // Cleaned of what the camera wrote beside it.
        expect(served.rawPayload.equals(PICTURES.chair.clean)).toBe(true);
      }
    });

    it('reads only the columns the cards show, only what is published, with each row’s picture address', async () => {
      // A product staff have not published yet.
      await rows(`INSERT INTO ${KEY}_products (name, price, position, published) VALUES ('Draft stool', 30, 99, false)`);
      const res = await get(`/records/${KEY}_products`);
      expect(res.statusCode, res.body).toBe(200);
      const list = (res.json() as { data: Record<string, unknown>[] }).data;
      expect(list.map((row) => row['name'])).toEqual(CARDS.map((card) => card.name));
      for (const row of list) expect(Object.keys(row).sort()).toEqual([...COLUMNS_SHOWN].sort());

      const config = (await get('/config')).json() as { data: { pictures?: string; refs: Record<string, { pictures?: string[] }> } };
      expect(config.data.refs[`${KEY}_products`]?.pictures).toEqual(['picture']);
      const addresses = await pictureAddresses();
      expect([...addresses.keys()]).toEqual(list.map((row) => Number(row['id'])));
      for (const [row, address] of addresses) {
        expect(address, `product ${String(row)}`).toMatch(new RegExp(`^${config.data.pictures ?? '-'}/${KEY}_products/${String(row)}/picture/file_`));
        expect((await image(address!)).statusCode).toBe(200);
      }
    });

    it('takes a stranger’s message with the human check, and refuses it without, with a column it does not offer, a name with a link, and past the visitor’s hourly limit', async () => {
      const message = { name: 'Ana Lima', email: 'ana@example.com', body: 'Do you deliver to Porto?' };
      const before = await count('messages');
      const sent = await create(`${KEY}_messages`, { values: message });
      expect(sent.statusCode, sent.body).toBe(201);
      expect(Object.keys((sent.json() as { data: Record<string, unknown> }).data)).toEqual(['id']);
      expect(await count('messages')).toBe(before + 1);

      const unchecked = await create(`${KEY}_messages`, { values: message }, { proof: false });
      expect(unchecked.statusCode, unchecked.body).toBe(403);
      expect(codeOf(unchecked)).toBe('PUBLIC_PROOF_REQUIRED');

      const marked = await create(`${KEY}_messages`, { values: { ...message, handled: true } });
      expect(marked.statusCode, marked.body).toBe(400);
      expect(codeOf(marked)).toBe('PUBLIC_WRITE_REFUSED');

      const linked = await create(`${KEY}_messages`, { values: { ...message, name: 'refund-desk.com' } });
      expect(linked.statusCode, linked.body).toBe(400);
      expect(linked.json()).toMatchObject({ error: { code: 'PUBLIC_WRITE_REFUSED', params: { column: 'name' } } });
      expect(await count('messages')).toBe(before + 1);

      // Three an hour from one visitor; the fourth is refused, whoever it says it is.
      const address = visitor();
      for (let i = 0; i < 3; i += 1) {
        const ok = await create(`${KEY}_messages`, { values: { ...message, email: `guest${String(i)}@example.com` } }, { address });
        expect(ok.statusCode, ok.body).toBe(201);
      }
      const over = await create(`${KEY}_messages`, { values: { ...message, email: 'guest9@example.com' } }, { address });
      expect(over.statusCode, over.body).toBe(409);
      expect(codeOf(over)).toBe('PUBLIC_LIMIT_REACHED');
      expect(await count('messages')).toBe(before + 4);
      // Another visitor is not held to that one's count.
      expect((await create(`${KEY}_messages`, { values: { ...message, email: 'other@example.com' } })).statusCode).toBe(201);

      // The newsletter form is the same kind of create, on its own table.
      const subscribed = await create(`${KEY}_subscribers`, { values: { email: 'news@example.com' } });
      expect(subscribed.statusCode, subscribed.body).toBe(201);
    });

    it('prices an order of two lines first, refuses it at another total, makes it once per retry key, and takes each price from the product', async () => {
      const [nordic, kruzo] = await products();
      const lines = [
        { values: { product_id: nordic!.id, qty: 2 } },
        { values: { product_id: kruzo!.id, qty: 1 } },
      ];
      const total = (2 * Number(nordic!['price']) + Number(kruzo!['price'])).toFixed(2);

      // The cart page's quote: every figure, before the guest typed their details.
      const quote = await create(`${KEY}_orders`, { values: { payment: 'transfer' }, children: { order_lines: lines } }, { proof: false, path: '/dry-run' });
      expect(quote.statusCode, quote.body).toBe(200);
      const quoted = quote.json() as { data: Record<string, unknown>; children: { order_lines: { data: Record<string, unknown> }[] } };
      expect([cents(quoted.data['subtotal']), cents(quoted.data['total'])]).toEqual([total, total]);
      expect(quoted.children.order_lines.map((line) => [cents(line.data['unit_price']), cents(line.data['line_total'])])).toEqual([
        [cents(nordic!['price']), cents(2 * Number(nordic!['price']))],
        [cents(kruzo!['price']), cents(kruzo!['price'])],
      ]);

      const orders = await count('orders');
      const clientKey = randomBytes(32).toString('base64url');
      const order = (expect: string, more: Record<string, unknown> = {}) => ({
        values: { name: 'Mia Costa', email: 'mia@example.com', address: '12 Rua das Flores, Porto', payment: 'transfer', client_key: clientKey, ...more },
        children: { order_lines: lines },
        expect: { total: expect },
      });

      // The total the guest was shown is not what it comes to: nothing is made.
      const moved = await create(`${KEY}_orders`, order('10.00'));
      expect(moved.statusCode, moved.body).toBe(409);
      expect(moved.json()).toMatchObject({ error: { code: 'PUBLIC_PRICE_CHANGED', params: { total } } });
      expect(await count('orders')).toBe(orders);

      // Placed at the total shown, with the cart's retry key.
      const placed = await create(`${KEY}_orders`, order(total));
      expect(placed.statusCode, placed.body).toBe(201);
      const made = placed.json() as { data: Record<string, unknown>; replayed?: boolean };
      expect(cents(made.data['total'])).toBe(total);
      expect(made.replayed).toBeUndefined();
      // Pressed again: the same order, not a second one.
      const again = await create(`${KEY}_orders`, order(total));
      expect(again.statusCode, again.body).toBe(200);
      expect(again.json()).toMatchObject({ replayed: true, data: { id: made.data['id'], number: made.data['number'] } });
      expect(await count('orders')).toBe(orders + 1);

      // Each line's price is the product's, copied when the order was made.
      const kept = await rows(`SELECT product_id, qty, unit_price, line_total, position FROM ${KEY}_order_lines WHERE order_id = ${String(made.data['id'])} ORDER BY position`);
      expect(kept.map((line) => [Number(line['product_id']), Number(line['qty']), cents(line['unit_price']), Number(line['position'])])).toEqual([
        [nordic!.id, 2, cents(nordic!['price']), 1],
        [kruzo!.id, 1, cents(kruzo!['price']), 2],
      ]);

      // A page that sends a price of its own is refused, whole.
      const cheap = await create(`${KEY}_orders`, {
        values: { name: 'Mia Costa', email: 'mia@example.com', address: '12 Rua das Flores, Porto', payment: 'transfer' },
        children: { order_lines: [{ values: { product_id: nordic!.id, qty: 1, unit_price: '0.01' } }] },
      });
      expect(cheap.statusCode, cheap.body).toBe(400);
      expect(codeOf(cheap)).toBe('PUBLIC_WRITE_REFUSED');
      // So is a way to pay the shop does not take online, and a product nobody may see.
      const byCard = await create(`${KEY}_orders`, { values: { name: 'Mia Costa', email: 'mia@example.com', address: '12 Rua das Flores, Porto', payment: 'card' }, children: { order_lines: [lines[0]] } });
      expect(byCard.statusCode, byCard.body).toBe(400);
      const draft = Number((await rows(`SELECT id FROM ${KEY}_products WHERE name = 'Draft stool'`))[0]?.['id']);
      const hidden = await create(`${KEY}_orders`, { values: { name: 'Mia Costa', email: 'mia@example.com', address: '12 Rua das Flores, Porto', payment: 'transfer' }, children: { order_lines: [{ values: { product_id: draft, qty: 1 } }] } });
      expect(hidden.statusCode, hidden.body).toBe(400);
      expect(hidden.json()).toMatchObject({ error: { code: 'PUBLIC_WRITE_REFUSED', params: { reason: 'not-offered' } } });
      expect(await count('orders')).toBe(orders + 1);
    });

    it('reconciles no files on a public write: an order whose lines copy the product’s picture leaves every file where it was', async () => {
      const before = await files();
      const [nordic] = await products();
      const placed = await create(`${KEY}_orders`, {
        values: { name: 'Rui Lopes', email: 'rui@example.com', address: '3 Largo do Carmo, Lisboa', payment: 'on_delivery' },
        children: { order_lines: [{ values: { product_id: nordic!.id, qty: 1 } }] },
      });
      expect(placed.statusCode, placed.body).toBe(201);
      const line = (await rows(`SELECT picture FROM ${KEY}_order_lines WHERE order_id = ${String((placed.json() as { data: { id: number } }).data.id)}`))[0];
      // The line names the product's own file…
      expect(String(line?.['picture'])).toBe(String(nordic!['picture']));
      expect((await create(`${KEY}_messages`, { values: { name: 'Rui Lopes', email: 'rui@example.com', body: 'Is it in stock?' } })).statusCode).toBe(201);
      // …and no file was attached, moved or put in the bin by either write.
      expect(await files()).toEqual(before);
      const address = (await pictureAddresses()).get(nordic!.id);
      expect((await image(address!)).statusCode).toBe(200);
    });

    it('applied again, as a second apply does, adds no table and no sample row, and keeps each picture', async () => {
      const snapshot = async () => ({
        tables: await tables(),
        counts: Object.fromEntries(await Promise.all(['products', 'messages', 'subscribers', 'orders', 'order_lines'].map(async (ref) => [ref, await count(ref)] as const))),
        pictures: (await products()).map((row) => [row.id, row['picture']]),
        files: (await files()).filter((file) => file.deletedAt === null).length,
      });
      const before = await snapshot();
      const restart = async () => {
        await shop.composed?.app.close();
        shop.composed = null;
        shop.lines.log.length = 0;
        await buildProject({ root: shop.root, configFile: join(shop.root, 'adminium.config.ts') }, { version: APP_VERSION });
        shop.composed = await serve(shop, engine);
      };

      // The same files again: nothing to apply.
      await restart();
      expect(shop.lines.warn).toEqual([]);
      expect(await snapshot()).toEqual(before);

      // A change of words in the plan's table, applied in place: the sample is not added again.
      const file = join(shop.root, APP, 'manifest', 'tables', 'products.json');
      const declared = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
      writeFileSync(file, `${JSON.stringify({ ...declared, labelPlural: { 'en-US': 'Chairs and sofas' } }, null, 2)}\n`);
      await restart();
      expect(shop.lines.warn).toEqual([]);
      expect(shop.lines.log.some((line) => line.startsWith(`App "${KEY}" applied from ${APP}`)), shop.lines.log.join('\n')).toBe(true);
      expect(shop.lines.log).not.toContain(`App "${KEY}": its sample data was added.`);
      expect(await snapshot()).toEqual(before);
      for (const address of (await pictureAddresses()).values()) expect((await image(address!)).statusCode).toBe(200);
    });

    it('keeps the forms’ human check and limits on the entries the server stored', async () => {
      const stored = (await publicEndpointsRepo(shop.meta).listByConnection(shop.mainId)).map((endpoint) => JSON.parse(endpoint.definition) as { path: string });
      expect(stored.find((entry) => entry.path === `/${KEY}_messages`)).toMatchObject({
        human_check: true,
        anonymous: { per_ip_hour: 3, per_key_hour: 100, per_value: { columns: ['email'], n: 5 }, plain_text: ['name'] },
      });
      expect(stored.find((entry) => entry.path === `/${KEY}_subscribers`)).toMatchObject({ human_check: true, anonymous: { per_ip_hour: 10, per_value: { columns: ['email'], n: 2 } } });
    });
  });
});
