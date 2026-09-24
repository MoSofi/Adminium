// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An installed app's words for a choice column's values, read in each
 * reader's language wherever a page reads them — on every engine.
 *
 * A status's value labels and an inline list of allowed values both keep
 * their words per locale at install. The page reply's column facts (what a
 * page's grid, form, filters and record view read) and a card's answer
 * resolve them for the person reading: "Eingecheckt" and "Bar" to a German
 * reader, "Checked in" and "Cash" to an English one. A row kept before the
 * words were stored per language holds plain strings and still reads as it
 * did, for everyone.
 *
 * Nothing is faked below the HTTP routes: the install, the introspection, the
 * override store and the page and card routes all run.
 */
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { sql } from 'kysely';
import { afterEach, describe, expect, it } from 'vitest';
import { AdapterRegistry, type AdapterProvider } from '@adminium/engine/adapter';
import {
  MetaValidationError,
  createSqliteMetaDb,
  firstRun,
  manifestsRepo,
  overridesRepo,
  pagesRepo,
  userPrefsRepo,
  usersRepo,
  validateOverrideInput,
  type MetaDb,
} from '@adminium/meta';

import { sha512Integrity } from '../src/add-ons/store.js';
import { createInstalledApps } from '../src/apps/installed.js';
import { createAppSchemaTarget } from '../src/apps/schema-target.js';
import { createAppStore } from '../src/apps/store.js';
import { resolveColumnOptions } from '../src/connections/effective-schema.js';
import { runIntrospection } from '../src/connections/introspect.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { registerAdapters } from '../src/connections/register-adapters.js';
import { appRoutes } from '../src/routes/apps/index.js';
import { pagesRoutes } from '../src/routes/pages/index.js';
import { widgetDataRoutes } from '../src/routes/widget-data/index.js';
import { WidgetDataCache } from '../src/widget-data/cache.js';
import { packageTarball } from './app-bundle-helpers.js';
import { TEST_SECRET } from './helpers.js';

type Dialect = 'sqlite' | 'postgres' | 'mysql';
const POSTGRES_URL = process.env.TEST_POSTGRES_URL;
const MYSQL_URL = process.env.TEST_MYSQL_URL || undefined;

const STATUS_LABELS = {
  waiting: { 'en-US': 'Waiting', 'de-DE': 'Wartend' },
  checked_in: { 'en-US': 'Checked in', 'de-DE': 'Eingecheckt' },
};
const PAID_WITH = [
  { value: 'cash', label: { 'en-US': 'Cash', 'de-DE': 'Bar' }, tone: 'pos' },
  { value: 'card', label: 'Card' },
];

function manifest(version: string, extraColumns: Record<string, unknown>[] = []) {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'desk',
    name: 'Front desk',
    version,
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'AGPL-3.0-only',
    description: { key: 'd', fallback: 'A front desk.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: '0.1.0' },
    requiredSchema: {
      prefixed: true,
      tables: [
        {
          ref: 'visits',
          columns: [
            { ref: 'id', type: 'int', role: 'pk' },
            { ref: 'name', type: 'text', maxLength: 80 },
            {
              ref: 'status',
              type: 'enum',
              enum: ['waiting', 'checked_in'],
              default: 'waiting',
              rules: { enumLabels: { labels: STATUS_LABELS, tones: { checked_in: 'pos' } } },
            },
            { ref: 'paid_with', type: 'text', maxLength: 16, nullable: true, rules: { options: { values: PAID_WITH } } },
            ...extraColumns,
          ],
        },
      ],
    },
    pages: [
      {
        ref: 'desk-visits',
        template: 'page-crud',
        title: { key: 't', fallback: 'Visits' },
        nav: { group: 'library', icon: 'list', order: 1 },
        bindings: { rows: 'visits' },
      },
    ],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
  };
}

interface Harness {
  meta: MetaDb;
  manager: ConnectionManager;
  connectionId: string;
  /** The routes an operator installs through. */
  admin: Awaited<ReturnType<typeof adminApp>>;
  run: (statement: string) => Promise<void>;
  close: () => Promise<void>;
}

let open: Harness | null = null;
afterEach(async () => {
  await open?.close();
  open = null;
});

async function adminApp(meta: MetaDb, manager: ConnectionManager, dataDir: string, userId: string) {
  const Fastify = (await import('fastify')).default;
  const { serializerCompiler, validatorCompiler } = await import('fastify-type-provider-zod');
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('rbac', { require: () => async () => {}, resolve: async () => ({ superAdmin: true }) } as never);
  app.decorate('requireAuth', (async () => {}) as never);
  app.decorateRequest('user', null);
  app.addHook('onRequest', async (request) => {
    (request as { user?: unknown }).user = { id: userId, email: 'owner@test' };
  });
  const store = createAppStore({ dataDir });
  const manifests = manifestsRepo(meta, { encrypt: (v) => v, decrypt: (v) => v });
  const installed = createInstalledApps({
    store,
    list: async () =>
      (await manifests.list('app')).map((m) => ({ key: m.row.manifestKey, version: m.row.version, status: m.row.status })),
  });
  await app.register(
    appRoutes({
      meta,
      store,
      installed,
      credentialCrypto: { encrypt: (v) => v, decrypt: (v) => v },
      directoryKeys: () => [],
      serverVersion: '0.4.0',
      schemaTarget: createAppSchemaTarget({ meta, manager, crypto: dsnCryptoFromSecret(TEST_SECRET) }),
    }),
  );
  await app.ready();
  return app;
}

/**
 * The routes a page and its cards are read through, signed in as the user an
 * `x-user` header names and allowed everything: what each reader is shown.
 */
async function readingApp(h: Harness) {
  const Fastify = (await import('fastify')).default;
  const { serializerCompiler, validatorCompiler } = await import('fastify-type-provider-zod');
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('rbac', {
    require: () => async () => {},
    resolve: async () => ({ roleIds: new Set<string>(), superAdmin: true }),
    audit: async () => {},
    now: () => Date.now(),
  } as never);
  app.decorate('requireAuth', (async () => {}) as never);
  app.decorateRequest('user', null);
  app.addHook('onRequest', async (request) => {
    const id = request.headers['x-user'];
    (request as { user?: unknown }).user = typeof id === 'string' ? { id, email: `${id}@test` } : null;
    (request as { can?: unknown }).can = async () => true;
  });
  await app.register(pagesRoutes({ meta: h.meta }));
  await app.register(widgetDataRoutes({ manager: h.manager, meta: h.meta, cache: new WidgetDataCache() }));
  await app.ready();
  return app;
}

async function harness(dialect: Dialect): Promise<Harness> {
  const dataDir = await mkdtemp(join(tmpdir(), 'app-labels-'));
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
  const owner = await usersRepo(meta).create({ email: 'owner@test', name: 'Owner' });
  const registry = new AdapterRegistry<AdapterProvider>();
  await registerAdapters(registry);
  const manager = new ConnectionManager({ meta, crypto: dsnCryptoFromSecret(TEST_SECRET), registry, metaDsn: null, blockLoopback: false });

  let dsn: string;
  let drop: () => Promise<void> = async () => undefined;
  const name = `adminium_labels_${randomBytes(4).toString('hex')}`;
  if (dialect === 'sqlite') {
    const file = join(dataDir, 'source.db');
    new BetterSqlite3(file).close();
    dsn = `sqlite:${file}`;
  } else if (dialect === 'postgres') {
    const { Client } = await import('pg');
    const admin = new Client({ connectionString: POSTGRES_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${name}`);
    await admin.end();
    const url = new URL(POSTGRES_URL as string);
    url.pathname = `/${name}`;
    dsn = url.toString();
    drop = async () => {
      const again = new Client({ connectionString: POSTGRES_URL });
      await again.connect();
      await again.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await again.end();
    };
  } else {
    const mysql = await import('mysql2/promise');
    const admin = await mysql.createConnection(MYSQL_URL as string);
    await admin.query(`CREATE DATABASE \`${name}\``);
    await admin.end();
    const url = new URL(MYSQL_URL as string);
    url.pathname = `/${name}`;
    dsn = url.toString();
    drop = async () => {
      const again = await mysql.createConnection(MYSQL_URL as string);
      await again.query(`DROP DATABASE IF EXISTS \`${name}\``);
      await again.end();
    };
  }
  const connection = await manager.connections.create({ name: 'Clinic', engine: dialect, introspectDsn: dsn, dataDsn: dsn });
  await runIntrospection({ manager, meta, connectionId: connection.id });
  const admin = await adminApp(meta, manager, dataDir, owner.id);
  const handle = await manager.data(connection.id);
  return {
    meta,
    manager,
    connectionId: connection.id,
    admin,
    run: async (statement) => {
      await sql.raw(statement).execute(handle.db);
    },
    close: async () => {
      await admin.close();
      await manager.disposeAll().catch(() => undefined);
      await drop();
      await meta.db.destroy();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

async function stage(h: Harness, doc: Record<string, unknown>): Promise<void> {
  const tarball = packageTarball({
    'manifest.json': JSON.stringify(doc),
    'staff/index.html': '<!doctype html><html><body data-app="desk"></body></html>',
  });
  const res = await h.admin.inject({
    method: 'POST',
    url: `/apps/upload?expectedSha512=${encodeURIComponent(sha512Integrity(tarball))}`,
    headers: { 'content-type': 'application/octet-stream' },
    payload: Buffer.from(tarball),
  });
  expect(res.statusCode, res.body).toBe(200);
}

async function install(h: Harness): Promise<void> {
  await stage(h, manifest('1.0.0'));
  const res = await h.admin.inject({
    method: 'POST',
    url: '/apps/install',
    payload: { key: 'desk', version: '1.0.0', connectionId: h.connectionId },
  });
  expect(res.statusCode, res.body).toBe(200);
  expect(res.json().rules.skipped).toEqual([]);
}

/** A German reader and an English one. */
async function readers(meta: MetaDb): Promise<{ anna: string; ada: string }> {
  const users = usersRepo(meta);
  const anna = await users.create({ email: 'anna@test', name: 'Anna' });
  const ada = await users.create({ email: 'ada@test', name: 'Ada' });
  await userPrefsRepo(meta).set(anna.id, { locale: 'de_DE' });
  await userPrefsRepo(meta).set(ada.id, { locale: 'en_US' });
  return { anna: anna.id, ada: ada.id };
}

interface FactReply {
  spec: { name: string };
  options?: { values: { value: string; label?: string; tone?: string }[] } | { list: string };
  enumLabels?: Record<string, string>;
  enumTones?: Record<string, string>;
}

/** What a page's grid, form and filters read for a column, as one reader. */
async function factsOf(app: Awaited<ReturnType<typeof readingApp>>, pageId: string, user: string) {
  const res = await app.inject({ method: 'GET', url: `/pages/${pageId}`, headers: { 'x-user': user } });
  expect(res.statusCode, res.body).toBe(200);
  const columns = (res.json().columnFacts?.columns ?? []) as FactReply[];
  return (name: string) => columns.find((column) => column.spec.name === name);
}

describe('an inline list’s words, as the store keeps and reads them', () => {
  const rule = (label: unknown) => ({
    connectionId: 'conn_1',
    op: 'column.options',
    tableName: 'public.visits',
    columnName: 'paid_with',
    value: { values: [{ value: 'cash', label }] },
  });

  it('takes a plain word or one per locale, and refuses a map with no language in it', () => {
    expect(() => validateOverrideInput(rule('Cash'))).not.toThrow();
    expect(() => validateOverrideInput(rule({ en_US: 'Cash', de_DE: 'Bar' }))).not.toThrow();
    expect(() => validateOverrideInput(rule({}))).toThrow(MetaValidationError);
    expect(() => validateOverrideInput(rule({ en_US: 42 }))).toThrow(MetaValidationError);
  });

  it('reads each value for the reader, falling back to US English, and drops a word with nothing to show', () => {
    const value = {
      values: [
        { value: 'cash', label: { en_US: 'Cash', de_DE: 'Bar' }, tone: 'pos' },
        { value: 'card', label: 'Card' },
        { value: 'voucher', label: { de_DE: 'Gutschein' } },
        { value: 'iou', label: '' },
      ],
    };
    expect(resolveColumnOptions(value, 'de_DE')).toEqual({
      values: [
        { value: 'cash', label: 'Bar', tone: 'pos' },
        { value: 'card', label: 'Card' },
        { value: 'voucher', label: 'Gutschein' },
        { value: 'iou' },
      ],
    });
    expect(resolveColumnOptions(value, 'fr_FR')).toEqual({
      values: [{ value: 'cash', label: 'Cash', tone: 'pos' }, { value: 'card', label: 'Card' }, { value: 'voucher' }, { value: 'iou' }],
    });
    // A named list is resolved from the list itself, where the reader's language is known.
    expect(resolveColumnOptions({ list: 'builtin:countries' }, 'de_DE')).toEqual({ list: 'builtin:countries' });
  });
});

const legs: [Dialect, boolean][] = [
  ['sqlite', true],
  ['postgres', POSTGRES_URL !== undefined],
  ['mysql', MYSQL_URL !== undefined],
];

for (const [dialect, available] of legs) {
  describe.skipIf(!available)(`an app's words for its values on ${dialect}`, () => {
    it('keeps them in every language at install, and each reader reads their own on the page', async () => {
      const h = (open = await harness(dialect));
      await install(h);

      // Kept per locale, keyed the way Adminium's locales are; a plain word stays one.
      const rows = await overridesRepo(h.meta).listForConnection(h.connectionId);
      expect(rows.find((row) => row.op === 'column.options')?.value).toEqual({
        values: [
          { value: 'cash', label: { en_US: 'Cash', de_DE: 'Bar' }, tone: 'pos' },
          { value: 'card', label: 'Card' },
        ],
      });

      const page = (await pagesRepo(h.meta).findBySlug(h.connectionId, 'desk-visits'))!;
      const { anna, ada } = await readers(h.meta);
      const reader = await readingApp(h);
      try {
        // The English reader first, so a kept answer would leak into the German one.
        const english = await factsOf(reader, page.id, ada);
        expect(english('status')).toMatchObject({ enumLabels: { waiting: 'Waiting', checked_in: 'Checked in' }, enumTones: { checked_in: 'pos' } });
        expect(english('paid_with')?.options).toEqual({ values: [{ value: 'cash', label: 'Cash', tone: 'pos' }, { value: 'card', label: 'Card' }] });

        const german = await factsOf(reader, page.id, anna);
        // The grid's status cell and the form's choices.
        expect(german('status')).toMatchObject({ enumLabels: { waiting: 'Wartend', checked_in: 'Eingecheckt' }, enumTones: { checked_in: 'pos' } });
        // The dialog's choice and the filter menu: the app's German, and its one plain word.
        expect(german('paid_with')?.options).toEqual({ values: [{ value: 'cash', label: 'Bar', tone: 'pos' }, { value: 'card', label: 'Card' }] });
      } finally {
        await reader.close();
      }
    }, 60_000);

    it('carries an inline list’s words on a card’s answer, in the reader’s language', async () => {
      const h = (open = await harness(dialect));
      await install(h);
      await h.run(`insert into desk_visits (name, status, paid_with) values ('Ada', 'checked_in', 'cash')`);
      const { anna, ada } = await readers(h.meta);
      const source = { name: 'desk_visits', type: 'table' };
      const list = { connectionId: h.connectionId, kind: 'table-query', source, shape: 'record-list', select: ['id', 'status', 'paid_with'] };
      const reader = await readingApp(h);
      const card = async (user: string) => {
        const res = await reader.inject({ method: 'POST', url: '/widget-data/batch', headers: { 'x-user': user }, payload: { requests: [{ instanceId: 'list', descriptor: list }] } });
        expect(res.statusCode, res.body).toBe(200);
        const columns = res.json().results['list'].result['columns'] as { name: string; enumLabels?: Record<string, string>; enumTones?: Record<string, string> }[];
        return Object.fromEntries(columns.filter((c) => c.name !== 'id').map((c) => [c.name, { labels: c.enumLabels, tones: c.enumTones }]));
      };
      try {
        expect(await card(ada)).toEqual({
          status: { labels: { waiting: 'Waiting', checked_in: 'Checked in' }, tones: { checked_in: 'pos' } },
          paid_with: { labels: { cash: 'Cash', card: 'Card' }, tones: { cash: 'pos' } },
        });
        expect(await card(anna)).toEqual({
          status: { labels: { waiting: 'Wartend', checked_in: 'Eingecheckt' }, tones: { checked_in: 'pos' } },
          paid_with: { labels: { cash: 'Bar', card: 'Card' }, tones: { cash: 'pos' } },
        });
      } finally {
        await reader.close();
      }
    }, 60_000);

    it('gives a choice column an update adds as text its words in every language', async () => {
      const h = (open = await harness(dialect));
      await install(h);
      // 1.1.0 adds a choice column to a table that exists: it reaches the database as text.
      const stageLabels = { labels: { queued: { 'en-US': 'Queued', 'de-DE': 'In der Warteschlange' }, ready: 'Ready' } };
      await stage(h, manifest('1.1.0', [{ ref: 'stage', type: 'enum', enum: ['queued', 'ready'], nullable: true, rules: { enumLabels: stageLabels } }]));
      const updated = await h.admin.inject({ method: 'POST', url: '/apps/desk/update' });
      expect(updated.statusCode, updated.body).toBe(200);

      const rule = (await overridesRepo(h.meta).listForConnection(h.connectionId)).find((row) => row.op === 'column.options' && row.columnName === 'stage');
      expect(rule?.value).toEqual({ values: [{ value: 'queued', label: { en_US: 'Queued', de_DE: 'In der Warteschlange' } }, { value: 'ready', label: 'Ready' }] });

      const page = (await pagesRepo(h.meta).findBySlug(h.connectionId, 'desk-visits'))!;
      const { anna, ada } = await readers(h.meta);
      const reader = await readingApp(h);
      try {
        expect((await factsOf(reader, page.id, anna))('stage')?.options).toEqual({
          values: [{ value: 'queued', label: 'In der Warteschlange' }, { value: 'ready', label: 'Ready' }],
        });
        expect((await factsOf(reader, page.id, ada))('stage')?.options).toEqual({
          values: [{ value: 'queued', label: 'Queued' }, { value: 'ready', label: 'Ready' }],
        });
      } finally {
        await reader.close();
      }
    }, 90_000);

    it('still reads a row kept before the words were stored per language, for every reader', async () => {
      const h = (open = await harness(dialect));
      await install(h);
      const overrides = overridesRepo(h.meta);
      const rule = (await overrides.listForConnection(h.connectionId)).find((row) => row.op === 'column.options')!;
      await overrides.delete(rule.id);
      await overrides.create({
        connectionId: h.connectionId,
        op: 'column.options',
        tableName: rule.tableName,
        columnName: 'paid_with',
        value: { values: [{ value: 'cash', label: 'Cash' }, { value: 'card', label: 'Card' }] },
        origin: 'app',
      });

      const page = (await pagesRepo(h.meta).findBySlug(h.connectionId, 'desk-visits'))!;
      const { anna } = await readers(h.meta);
      const reader = await readingApp(h);
      try {
        expect((await factsOf(reader, page.id, anna))('paid_with')?.options).toEqual({
          values: [{ value: 'cash', label: 'Cash' }, { value: 'card', label: 'Card' }],
        });
      } finally {
        await reader.close();
      }
    }, 60_000);
  });
}
