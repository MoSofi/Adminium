// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An app install, end to end, against a REAL database on every engine: the
 * live plan, the operator's answers, and the apply — renames through the schema
 * editor, prefixed creates with prefixed foreign keys, and the safe edits a
 * reused table needs.
 *
 * Nothing here is faked below the HTTP route: the connection manager, the
 * introspection, the schema editor's plan and apply, and the DDL all run.
 */
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { sql } from 'kysely';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { desiredTableSchema, parseDatabaseModel } from '@adminium/engine';
import { AdapterRegistry, type AdapterProvider } from '@adminium/engine/adapter';
import {
  appOutboxesRepo,
  appTablesRepo,
  connectionTenantConfig,
  createSqliteMetaDb,
  documentSequencesRepo,
  emailTemplatesRepo,
  snapshotsRepo,
  firstRun,
  manifestsRepo,
  optionListsRepo,
  overridesRepo,
  pagesRepo,
  permissionsRepo,
  publicEndpointsRepo,
  publicKeysRepo,
  publicSessionsRepo,
  rolesRepo,
  settingsRepo,
  usersRepo,
  userPrefsRepo,
  type MetaDb,
} from '@adminium/meta';

import { createInstalledApps } from '../src/apps/installed.js';
import { resolveForRoles } from '../src/rbac/resolver.js';
import { createAppSchemaTarget } from '../src/apps/schema-target.js';
import { createAppStore } from '../src/apps/store.js';
import { createSampleDataService, findSampleApp, normaliseValue, type SampleDataDeps } from '../src/apps/sample-data.js';
import type { FileStore } from '../src/files/store.js';
import { sha512Integrity } from '../src/add-ons/store.js';
import { runIntrospection } from '../src/connections/introspect.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { registerAdapters } from '../src/connections/register-adapters.js';
import { applyOverrides } from '../src/connections/effective-schema.js';
import { SnapshotView } from '../src/crud/identifiers.js';
import { resolveLookups } from '../src/crud/lookups.js';
import { tableRulesFor } from '../src/crud/column-rules.js';
import { slotInstant, venueClock } from '../src/crud/capacity-guard.js';
import type { Row } from '../src/crud/mask.js';
import { createWriteService, GuardedBatchError, insertRow, type WriteContext, type WriteTarget } from '../src/crud/write-service.js';
import { normalizeWriteValue } from '../src/crud/write-values.js';
import { wallTimeToInstant } from '../src/crud/venue-time.js';
import { writeStores } from '../src/crud/write-stores.js';
import { columnFactsFor } from '../src/routes/pages/column-facts.js';
import { compileWidgetQuery } from '../src/widget-data/compiler.js';
import { WidgetDataCache } from '../src/widget-data/cache.js';
import { schemaRoutes } from '../src/routes/schema/index.js';
import { widgetDataRoutes } from '../src/routes/widget-data/index.js';
import { shapeRows } from '../src/widget-data/shapers.js';
import { queryDescriptorSchema } from '@adminium/engine/config';
import { POS_OVERVIEW_LAYOUT, POS_OVERVIEW_TABLES } from './fixtures/pos-overview.js';
import { createEndpointService, EndpointSaveRefused } from '../src/public-api/endpoint-service.js';
import { endpointIssues, parseDefinition } from '../src/public-api/endpoint.js';
import { createPublicViews } from '../src/public-api/runtime.js';
import { appRoutes } from '../src/routes/apps/index.js';
import { packageTarball } from './app-bundle-helpers.js';
import { composeServer } from '../src/compose.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import { hashPublishableKey, openPublishableKey } from '../src/public-api/keys.js';
import { solveProof } from '../src/public-api/proof.js';
import { adminPasswordHash, ADMIN_PASSWORD, sessionCookie } from './auth-helpers.js';
import type { OutboxProducers } from '../src/outbox/producers.js';
import { decryptSecret, encryptSecret } from '../src/config/secrets.js';
import { emailSecretKey } from '../src/email/config.js';
import { emailEnvelopeKey, type EmailSendReport } from '../src/email/send.js';
import { makeEnv, TEST_SECRET } from './helpers.js';

/**
 * The code generator's dice, loaded on request: a queued number is the next
 * `randomInt`, so a test can make a code collide. Empty, it is the real one.
 */
const forcedInts = vi.hoisted(() => [] as number[]);
vi.mock('node:crypto', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:crypto')>();
  return {
    ...real,
    randomInt: ((...args: Parameters<typeof real.randomInt>) =>
      forcedInts.length > 0 ? forcedInts.shift()! : (real.randomInt as (...a: unknown[]) => unknown)(...args)) as typeof real.randomInt,
  };
});

type Dialect = 'sqlite' | 'postgres' | 'mysql';
const POSTGRES_URL = process.env.TEST_POSTGRES_URL;
const MYSQL_URL = process.env.TEST_MYSQL_URL || undefined;

/** Keys the routes told the public resolver to forget. */
const INVALIDATED_KEYS: string[] = [];

const TABLES = [
  {
    ref: 'menu_items',
    columns: [
      { ref: 'id', type: 'int', role: 'pk' },
      { ref: 'name', type: 'text', maxLength: 80 },
      { ref: 'price', type: 'money', default: 0 },
    ],
  },
  {
    ref: 'payments',
    columns: [
      { ref: 'id', type: 'int', role: 'pk' },
      { ref: 'amount', type: 'money' },
      { ref: 'tip', type: 'money', nullable: true },
      { ref: 'method', type: 'text', maxLength: 16 },
    ],
  },
  {
    ref: 'shifts',
    columns: [
      { ref: 'id', type: 'int', role: 'pk' },
      { ref: 'opened_at', type: 'timestamptz', default: 'now' },
    ],
  },
  {
    ref: 'lines',
    columns: [
      { ref: 'id', type: 'bigint', role: 'pk' },
      { ref: 'item_id', type: 'fk', references: 'menu_items' },
    ],
  },
];

const MANIFEST = {
  kind: 'app',
  manifestVersion: 1,
  key: 'pos',
  name: 'Point of Sale',
  version: '1.0.0',
  publisher: { id: 'adminium', name: 'Adminium' },
  license: 'AGPL-3.0-only',
  description: { key: 'd', fallback: 'A till.' },
  categories: ['hospitality'],
  compatibility: { minAdminiumVersion: '0.1.0' },
  requiredSchema: { prefixed: true, tables: TABLES },
  pages: [
    {
      ref: 'pos-menu',
      template: 'page-crud',
      title: { key: 't', fallback: 'Menu' },
      nav: { group: 'library', icon: 'list', order: 1 },
      bindings: { rows: 'menu_items' },
    },
  ],
  frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
};

interface Harness {
  app: Awaited<ReturnType<typeof buildApp>>;
  meta: MetaDb;
  manager: ConnectionManager;
  connectionId: string;
  run: (statement: string) => Promise<void>;
  rows: (statement: string) => Promise<Record<string, unknown>[]>;
  dataDir: string;
  columns: (table: string) => Promise<Record<string, { type: string; width: number | null }>>;
  close: () => Promise<void>;
}

let open: Harness | null = null;
afterEach(async () => {
  await open?.close();
  open = null;
});

interface AppOpts {
  superAdmin?: boolean;
  /** Whether the signed-in user may manage API keys; unset, the request has no `can` at all. */
  canManageKeys?: boolean;
}

async function buildApp(meta: MetaDb, manager: ConnectionManager, dataDir: string, userId: string, opts: AppOpts = {}) {
  const superAdmin = opts.superAdmin ?? false;
  const Fastify = (await import('fastify')).default;
  const { serializerCompiler, validatorCompiler } = await import('fastify-type-provider-zod');
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('rbac', { require: () => async () => {}, resolve: async () => ({ superAdmin }) } as never);
  app.decorate('requireAuth', (async () => {}) as never);
  app.decorateRequest('user', null);
  app.addHook('onRequest', async (request) => {
    (request as { user?: unknown }).user = { id: userId, email: 'owner@test' };
    if (opts.canManageKeys !== undefined) {
      (request as { can?: unknown }).can = async (permission: string) =>
        permission === 'system:api-keys:manage' ? opts.canManageKeys : true;
    }
  });
  const views = createPublicViews(meta);
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
      sampleData: sampleDeps(meta, manager, store),
      publicAccess: {
        service: createEndpointService({ meta, viewFor: views.viewFor, tenantConfigOf: async (id) => (await connectionTenantConfig(meta, id)) ?? undefined }),
        viewFor: views.viewFor,
        crypto: dsnCryptoFromSecret(TEST_SECRET),
        origins: ['self'],
        invalidateKey: (keyId) => INVALIDATED_KEYS.push(keyId),
      },
    }),
  );
  await app.ready();
  return app;
}

/**
 * The routes a dashboard reads a card and the schema through, signed in as the
 * user an `x-user` header names and allowed every table: what a card shows a
 * reader, in their language.
 */
async function readingApp(h: Harness) {
  const Fastify = (await import('fastify')).default;
  const { serializerCompiler, validatorCompiler } = await import('fastify-type-provider-zod');
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('rbac', { require: () => async () => {}, resolve: async () => ({ roleIds: new Set<string>(), superAdmin: true }), audit: async () => {} } as never);
  app.decorateRequest('user', null);
  app.addHook('onRequest', async (request) => {
    const id = request.headers['x-user'];
    (request as { user?: unknown }).user = typeof id === 'string' ? { id, email: `${id}@test` } : null;
    (request as { can?: unknown }).can = async () => true;
  });
  await app.register(schemaRoutes({ manager: h.manager, meta: h.meta }));
  await app.register(widgetDataRoutes({ manager: h.manager, meta: h.meta, cache: new WidgetDataCache() }));
  await app.ready();
  return app;
}

/** The Files library, as far as the sample service uses it: bytes in, a location out. */
const memoryFiles = {
  write: async (input: { id: string; bytes: Buffer | string }) => ({
    storageKey: input.id,
    sizeBytes: Buffer.byteLength(input.bytes),
    sha256: createHash('sha256').update(input.bytes).digest('hex'),
    destinationId: null,
    storage: 'memory',
  }),
} as unknown as FileStore;

function sampleDeps(meta: MetaDb, manager: ConnectionManager, store: ReturnType<typeof createAppStore>): SampleDataDeps {
  return { meta, manager, store, files: memoryFiles };
}

async function harness(dialect: Dialect, opts: AppOpts = {}): Promise<Harness> {
  const dataDir = await mkdtemp(join(tmpdir(), 'app-pipeline-'));
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
  const user = await usersRepo(meta).create({ email: 'owner@test', name: 'Owner' });
  const registry = new AdapterRegistry<AdapterProvider>();
  await registerAdapters(registry);
  const manager = new ConnectionManager({
    meta,
    crypto: dsnCryptoFromSecret(TEST_SECRET),
    registry,
    metaDsn: null,
    blockLoopback: false,
  });

  let dsn: string;
  let drop: () => Promise<void> = async () => undefined;
  const name = `adminium_pipeline_${randomBytes(4).toString('hex')}`;
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
  const connection = await manager.connections.create({ name: 'Cafe', engine: dialect, introspectDsn: dsn, dataDsn: dsn });
  await runIntrospection({ manager, meta, connectionId: connection.id });

  const app = await buildApp(meta, manager, dataDir, user.id, opts);
  const handle = await manager.data(connection.id);
  const h: Harness = {
    app,
    meta,
    manager,
    connectionId: connection.id,
    run: async (statement) => {
      await sql.raw(statement).execute(handle.db);
    },
    rows: async (statement) => (await sql.raw<Record<string, unknown>>(statement).execute(handle.db)).rows,
    dataDir,
    columns: async (table) => {
      const adapter = await manager.introspectAdapter(connection.id);
      try {
        const model = await adapter.introspect({ tableFilter: (t) => t.name === table, collectRowEstimates: false, collectActivityStats: false });
        const found = model.tables.find((t) => t.name === table);
        return Object.fromEntries((found?.columns ?? []).map((c) => [c.name, { type: c.logicalType, width: c.maxLength }]));
      } finally {
        await adapter.close();
      }
    },
    close: async () => {
      await app.close();
      await manager.disposeAll().catch(() => undefined);
      await drop();
      await meta.db.destroy();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
  return h;
}

async function stage(h: Harness): Promise<void> {
  const tarball = packageTarball({
    'manifest.json': JSON.stringify(MANIFEST),
    'staff/index.html': '<!doctype html><html><body data-app="pos"></body></html>',
  });
  const res = await h.app.inject({
    method: 'POST',
    url: `/apps/upload?expectedSha512=${encodeURIComponent(sha512Integrity(tarball))}`,
    headers: { 'content-type': 'application/octet-stream' },
    payload: Buffer.from(tarball),
  });
  expect(res.statusCode, res.body).toBe(200);
}

/** Stages a different manifest: another version, or another shape. */
async function stageManifest(
  h: Harness,
  manifest: Record<string, unknown>,
  files: Record<string, string> = {},
): Promise<void> {
  const tarball = packageTarball({
    'manifest.json': JSON.stringify(manifest),
    'staff/index.html': '<!doctype html><html><body data-app="pos"></body></html>',
    ...files,
  });
  const res = await h.app.inject({
    method: 'POST',
    url: `/apps/upload?expectedSha512=${encodeURIComponent(sha512Integrity(tarball))}`,
    headers: { 'content-type': 'application/octet-stream' },
    payload: Buffer.from(tarball),
  });
  expect(res.statusCode, res.body).toBe(200);
}

/** The clinic-shaped tables a booking rule reads, prefixed `pos_` by the harness's app. */
function bookingManifest() {
  const id = { ref: 'id', type: 'int', role: 'pk' };
  const hhmm = (ref: string, nullable = false) => ({ ref, type: 'text', maxLength: 5, ...(nullable ? { nullable: true } : {}) });
  const weekday = { ref: 'weekday', type: 'enum', enum: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] };
  return {
    ...MANIFEST,
    requiredSchema: {
      prefixed: true,
      tables: [
        TABLES[0],
        {
          ref: 'booking_settings',
          columns: [
            id,
            { ref: 'slot_minutes', type: 'int', default: 15 },
            { ref: 'booking_days', type: 'int', default: 5 },
            { ref: 'notice_minutes', type: 'int', default: 60 },
            { ref: 'cancel_hours', type: 'int', default: 24 },
          ],
        },
        { ref: 'opening_hours', columns: [id, weekday, { ref: 'open', type: 'bool', default: true }, hhmm('opens'), hhmm('closes'), hhmm('break_start', true), hhmm('break_end', true)] },
        {
          ref: 'clinicians',
          columns: [id, { ref: 'name', type: 'text', maxLength: 40 }, { ref: 'position', type: 'int', default: 0 }, { ref: 'active', type: 'bool', default: true }, { ref: 'bookable_online', type: 'bool', default: true }],
        },
        { ref: 'visit_types', columns: [id, { ref: 'name', type: 'text', maxLength: 40 }, { ref: 'minutes', type: 'int', default: 15 }] },
        { ref: 'clinician_visit_types', columns: [id, { ref: 'clinician_id', type: 'fk', references: 'clinicians' }, { ref: 'visit_type_id', type: 'fk', references: 'visit_types' }] },
        { ref: 'clinician_hours', columns: [id, { ref: 'clinician_id', type: 'fk', references: 'clinicians' }, weekday, hhmm('opens'), hhmm('closes')] },
        {
          ref: 'closures',
          columns: [id, { ref: 'clinician_id', type: 'fk', references: 'clinicians', nullable: true }, { ref: 'from_date', type: 'date' }, { ref: 'to_date', type: 'date' }, { ref: 'active', type: 'bool', default: true }],
        },
        {
          ref: 'visits',
          booking: {
            start: 'starts_at',
            minutes: 'minutes',
            resource: 'clinician_id',
            kind: 'visit_type_id',
            countWhere: { column: 'status', values: ['booked', 'checked_in', 'seen'] },
            eligible: {
              table: 'clinician_visit_types',
              resource: 'clinician_id',
              kind: 'visit_type_id',
              order: { table: 'clinicians', column: 'position', active: 'active', public: 'bookable_online' },
            },
            hours: {
              practice: { table: 'opening_hours', weekday: 'weekday', open: 'open', opens: 'opens', closes: 'closes', breakStart: 'break_start', breakEnd: 'break_end' },
              own: { table: 'clinician_hours', resource: 'clinician_id', weekday: 'weekday', opens: 'opens', closes: 'closes' },
            },
            closures: { table: 'closures', from: 'from_date', to: 'to_date', resource: 'clinician_id', active: 'active' },
            grid: { table: 'booking_settings', column: 'slot_minutes' },
            windowDays: { table: 'booking_settings', column: 'booking_days' },
            noticeMinutes: { table: 'booking_settings', column: 'notice_minutes' },
            cancel: { hours: { table: 'booking_settings', column: 'cancel_hours' }, mode: 'flag', flag: 'late_cancel', when: { column: 'status', to: 'cancelled' } },
          },
          columns: [
            id,
            { ref: 'clinician_id', type: 'fk', references: 'clinicians', nullable: true },
            { ref: 'visit_type_id', type: 'fk', references: 'visit_types' },
            { ref: 'starts_at', type: 'timestamptz', rules: { venueLocal: true } },
            { ref: 'minutes', type: 'int', default: 15, rules: { copy: { via: 'visit_type_id', from: 'minutes', mode: 'always' } } },
            { ref: 'status', type: 'enum', enum: ['booked', 'checked_in', 'seen', 'no_show', 'cancelled'], default: 'booked' },
            { ref: 'late_cancel', type: 'bool', default: false },
          ],
        },
      ],
    },
  };
}

/** The booking guard, end to end, against the harness's real database. */
async function bookPeople(h: Harness, zone: string): Promise<void> {
  await stageManifest(h, bookingManifest());
  const installed = await post(h, '/apps/install');
  expect(installed.statusCode, installed.body).toBe(200);
  expect(installed.json().rules.skipped).toEqual([]);

  const snapshot = (await snapshotsRepo(h.meta).latest(h.connectionId))!;
  const view = new SnapshotView(
    h.connectionId,
    applyOverrides(parseDatabaseModel(snapshot.schema), await overridesRepo(h.meta).listForConnection(h.connectionId, { status: 'active' })),
    new Map(),
  );
  const { db, dialect: d } = await h.manager.data(h.connectionId);
  const targetOf = (name: string): WriteTarget => ({
    connectionId: h.connectionId,
    view,
    table: view.table(view.model.tables.find((t) => t.name === `pos_${name}`)!.id),
    db,
    dialect: d,
    timezone: zone,
  });
  const writes = createWriteService({ sequences: documentSequencesRepo(h.meta) });
  const staff: WriteContext = { origin: 'dashboard', hops: 0, actor: null, request: null };
  const guest: WriteContext = { ...staff, origin: 'public' };
  // As the data routes prepare a value — leaving a venue-local time to the write service.
  const prepared = (name: string, values: Record<string, unknown>) => {
    const table = targetOf(name).table;
    const local = new Set(table.table?.columns.filter((c) => c.venueLocal === true).map((c) => c.name));
    return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, local.has(k) ? v : normalizeWriteValue(table.columns.get(k)!, v)]));
  };
  const create = (name: string, values: Record<string, unknown>, context: typeof staff = staff) =>
    writes.create({ target: targetOf(name), values: prepared(name, values), context, announce: async () => {} });
  const update = (id: unknown, values: Record<string, unknown>, context: typeof staff = staff) =>
    writes.update({ target: targetOf('visits'), pk: { id }, values: prepared('visits', values), context, announce: async () => {} });
  /** What a write came to: `written`, or the refusal's code (a 422's reason). */
  const outcome = (run: Promise<unknown>) =>
    run.then(
      () => 'written',
      (error: { code?: string; details?: { reason?: string } }) => (error.code === 'VALIDATION_FAILED' ? String(error.details?.reason) : String(error.code)),
    );
  /** A wall time on the venue's clock, as the instant a guest's browser sends. */
  const at = (day: string, hhmm: string) => wallTimeToInstant(`${day} ${hhmm}`, zone)!.toISOString();
  const TUE = '2026-07-28';
  const WED = '2026-07-29';
  const THU = '2026-07-30';
  const FRI = '2026-07-31';

  await create('booking_settings', { slot_minutes: 15, booking_days: 5, notice_minutes: 60, cancel_hours: 24 });
  for (const weekday of ['mon', 'tue', 'wed', 'thu', 'fri']) {
    await create('opening_hours', { weekday, opens: '08:30', closes: '17:30', break_start: '12:30', break_end: '13:15' });
  }
  const ada = await create('clinicians', { name: 'Ada', position: 1 });
  const ben = await create('clinicians', { name: 'Ben', position: 2, bookable_online: false });
  const cal = await create('clinicians', { name: 'Cal', position: 3, active: false });
  const routine = await create('visit_types', { name: 'Routine', minutes: 15 });
  const long = await create('visit_types', { name: 'Long', minutes: 45 });
  const flu = await create('visit_types', { name: 'Flu', minutes: 15 });
  for (const [who, what] of [[ada, routine], [ada, long], [ben, routine], [ben, long], [ben, flu], [cal, routine]] as const) {
    await create('clinician_visit_types', { clinician_id: who['id'], visit_type_id: what['id'] });
  }
  // Ben keeps his own hours: Tuesday afternoons only.
  await create('clinician_hours', { clinician_id: ben['id'], weekday: 'tue', opens: '13:15', closes: '17:30' });
  // The practice is shut on Friday; Ada is away on Thursday.
  await create('closures', { from_date: FRI, to_date: FRI });
  await create('closures', { clinician_id: ada['id'], from_date: THU, to_date: THU });

  const visit = (who: Row | null, what: Row, day: string, hhmm: string, extra: Record<string, unknown> = {}) => ({
    clinician_id: who === null ? null : who['id'],
    visit_type_id: what['id'],
    starts_at: at(day, hhmm),
    ...extra,
  });
  const book = (who: Row | null, what: Row, day: string, hhmm: string, extra: Record<string, unknown> = {}, context = staff) =>
    outcome(create('visits', visit(who, what, day, hhmm, extra), context));

  // ── overlap: half-open intervals, each visit its own length ────────────
  const nine = await create('visits', visit(ada, routine, TUE, '09:00'));
  expect(Number(nine['minutes'])).toBe(15);
  expect(await book(ada, routine, TUE, '09:00')).toBe('BOOKING_TAKEN');
  expect(await book(ada, long, TUE, '08:30')).toBe('BOOKING_TAKEN'); // 08:30–09:15 covers 09:00
  expect(await book(ada, routine, TUE, '08:45')).toBe('written'); // ends at 09:00, exactly
  expect(await book(ada, routine, TUE, '09:15')).toBe('written');
  expect(await book(ben, routine, WED, '09:00')).toBe('BOOKING_OUT_OF_HOURS'); // his own hours: Tuesday only

  // ── hours, breaks and the grid ─────────────────────────────────────────
  expect(await book(ada, long, WED, '11:45')).toBe('written'); // 11:45 + 45 = 12:30, the break: fits by nothing
  expect(await book(ada, long, WED, '12:15')).toBe('BOOKING_OUT_OF_HOURS'); // runs into lunch
  expect(await book(ada, routine, WED, '13:00')).toBe('BOOKING_OUT_OF_HOURS'); // inside lunch
  expect(await book(ada, routine, WED, '13:15')).toBe('written');
  expect(await book(ada, routine, WED, '09:10')).toBe('BOOKING_OUT_OF_HOURS'); // off the grid
  expect(await book(ada, routine, WED, '17:15')).toBe('written'); // ends at closing
  expect(await book(ada, routine, WED, '17:30')).toBe('BOOKING_OUT_OF_HOURS');
  expect(await book(ada, routine, WED, '08:15')).toBe('BOOKING_OUT_OF_HOURS');
  expect(await book(ben, routine, TUE, '10:00')).toBe('BOOKING_OUT_OF_HOURS'); // before his own Tuesday hours
  expect(await book(ben, routine, TUE, '13:15')).toBe('written');

  // ── who does what ──────────────────────────────────────────────────────
  expect(await book(ada, flu, TUE, '10:00')).toBe('BOOKING_NOT_OFFERED');
  expect(await book(cal, routine, TUE, '10:00')).toBe('BOOKING_NOT_OFFERED'); // not active

  // ── closures ───────────────────────────────────────────────────────────
  expect(await book(ada, routine, FRI, '10:00')).toBe('BOOKING_CLOSED');
  expect(await book(ada, routine, THU, '10:00')).toBe('BOOKING_CLOSED');
  // A closure switched off ("reopen this day") closes nothing.
  await db.updateTable(targetOf('closures').table.id as never).set({ active: d === 'sqlite' ? 0 : false } as never).where('clinician_id' as never, '=', ada['id'] as never).execute();
  expect(await book(ada, routine, THU, '10:00')).toBe('written');

  // ── the past, the window of working days, a guest's notice ─────────────
  expect(await book(ada, routine, '2026-07-27', '10:00')).toBe('BOOKING_OUT_OF_RANGE');
  // Five working days from Tuesday, both counted: Tue, Wed, Thu, (Fri shut), Mon 3, Tue 4.
  expect(await book(ada, routine, '2026-08-04', '10:00')).toBe('written');
  expect(await book(ada, routine, '2026-08-05', '10:00')).toBe('BOOKING_OUT_OF_RANGE');
  expect(await book(ada, routine, TUE, '09:30', {}, guest)).toBe('written'); // 70 minutes ahead
  expect(await book(ada, routine, TUE, '08:30', {}, guest)).toBe('BOOKING_OUT_OF_RANGE'); // 10 minutes: under the notice
  expect(await book(ada, routine, TUE, '08:30')).toBe('written'); // staff are never held to it
  expect(await book(ben, routine, TUE, '14:00', {}, guest)).toBe('BOOKING_NOT_OFFERED'); // not bookable online

  // ── "anyone": the first eligible person the time suits, in order ───────
  const anyone = (day: string, hhmm: string, context = staff) => create('visits', visit(null, routine, day, hhmm), context);
  expect(Number((await anyone(TUE, '10:00'))['clinician_id'])).toBe(Number(ada['id']));
  expect(await outcome(anyone(TUE, '09:00'))).toBe('BOOKING_TAKEN'); // Ada has it; Ben is not in yet; Cal is inactive
  expect(await book(ada, routine, TUE, '14:30')).toBe('written');
  expect(Number((await anyone(TUE, '14:30'))['clinician_id'])).toBe(Number(ben['id']));
  expect(await book(ada, routine, TUE, '14:45')).toBe('written');
  expect(await outcome(anyone(TUE, '14:45', guest))).toBe('BOOKING_TAKEN'); // a guest is never given Ben
  expect(await outcome(anyone(FRI, '10:00'))).toBe('BOOKING_CLOSED');
  expect(await outcome(create('visits', visit(null, flu, WED, '10:00')))).toBe('BOOKING_OUT_OF_HOURS'); // only Ben does it, and not on Wednesdays

  // ── updates: a move is judged; a status step is not ────────────────────
  const moving = await create('visits', visit(ada, long, WED, '09:00'));
  expect(await outcome(update(moving['id'], { starts_at: at(WED, '09:15') }))).toBe('written'); // overlaps only itself
  expect(await outcome(update(moving['id'], { starts_at: at(WED, '11:15') }))).toBe('BOOKING_TAKEN'); // into 11:45's visit
  expect(await outcome(update(moving['id'], { visit_type_id: routine['id'] }))).toBe('written'); // a length change is a move
  expect(Number((await db.selectFrom(targetOf('visits').table.id as never).select('minutes' as never).where('id' as never, '=', moving['id'] as never).executeTakeFirst() as { minutes: unknown }).minutes)).toBe(15);
  // A cancelled visit that is booked again is judged for overlap only.
  const cancelled = await create('visits', visit(ada, routine, WED, '15:00', { status: 'cancelled' }));
  await create('visits', visit(ada, routine, WED, '15:00'));
  expect(await outcome(update(cancelled['id'], { status: 'booked' }))).toBe('BOOKING_TAKEN');

  // Later that morning a closure is added for Ada today; checking in her
  // 09:00 visit, now in the past, is a status step and is never refused.
  vi.setSystemTime(wallTimeToInstant(`${TUE} 10:37`, zone)!);
  await create('closures', { clinician_id: ada['id'], from_date: TUE, to_date: TUE });
  expect(await outcome(update(nine['id'], { status: 'checked_in' }))).toBe('written');
  expect(await outcome(update(nine['id'], { status: 'seen', starts_at: at(TUE, '09:00') }))).toBe('written'); // the same time sent again is no move
  await db.deleteFrom(targetOf('closures').table.id as never).where('from_date' as never, '=', TUE as never).execute();

  // ── a walk-in: the desk books the slot that holds now, already checked in ─
  expect(await book(ada, routine, TUE, '10:30', { status: 'checked_in' })).toBe('written');
  expect(await book(ada, routine, TUE, '10:45')).toBe('written'); // the next slot is ordinary
  expect(await book(ben, routine, TUE, '10:15', { status: 'checked_in' })).toBe('BOOKING_OUT_OF_RANGE'); // a slot already over
  expect(await book(ada, long, TUE, '10:30', { status: 'booked' })).toBe('BOOKING_OUT_OF_RANGE'); // a booking, not a walk-in
  expect(await book(ada, routine, TUE, '10:30', { status: 'checked_in' }, guest)).toBe('BOOKING_OUT_OF_RANGE'); // never from outside

  // ── two writers, one slot: one of them gets it ─────────────────────────
  const race = await Promise.all(Array.from({ length: 5 }, () => book(ada, routine, WED, '16:00')));
  expect(race.filter((o) => o === 'written')).toHaveLength(1);
  expect(race.filter((o) => o !== 'written').every((o) => o === 'BOOKING_TAKEN' || o === 'BOOKING_BUSY')).toBe(true);
  // "Anyone" at a time two people are free: two bookings, then none.
  const both = await Promise.all(Array.from({ length: 4 }, () => outcome(anyone(TUE, '16:00'))));
  expect(both.filter((o) => o === 'written')).toHaveLength(2);

  // ── rows written together cannot each hold their time ──────────────────
  await expect(writes.check('create', targetOf('visits'), staff, [visit(ada, routine, WED, '16:30')])).rejects.toBeInstanceOf(GuardedBatchError);

  // ── a clock change: 09:00 stays 09:00 on the venue's wall ──────────────
  vi.setSystemTime(wallTimeToInstant('2026-10-23 08:00', zone)!);
  await db.updateTable(targetOf('booking_settings').table.id as never).set({ booking_days: 30 } as never).execute();
  const friday = await create('visits', visit(ada, routine, '2026-10-23', '09:00')); // BST
  const monday = await create('visits', visit(ada, routine, '2026-10-26', '09:00')); // GMT, after the clocks go back
  const instant = (row: Row) => slotInstantOf(row['starts_at']);
  expect(instant(friday)).toBe('2026-10-23T08:00:00.000Z');
  expect(instant(monday)).toBe('2026-10-26T09:00:00.000Z');
  expect(await book(ada, routine, '2026-10-26', '08:15')).toBe('BOOKING_OUT_OF_HOURS');
  expect(await book(ada, routine, '2026-10-26', '08:30')).toBe('written');
}

/** The cancellation window: 24 hours, flagged; then the same rule refusing. */
async function cancelLate(h: Harness, zone: string): Promise<void> {
  await stageManifest(h, bookingManifest());
  const installed = await post(h, '/apps/install');
  expect(installed.statusCode, installed.body).toBe(200);
  expect(installed.json().rules.skipped).toEqual([]);

  const snapshot = (await snapshotsRepo(h.meta).latest(h.connectionId))!;
  const model = parseDatabaseModel(snapshot.schema);
  const viewOf = async () =>
    new SnapshotView(h.connectionId, applyOverrides(model, await overridesRepo(h.meta).listForConnection(h.connectionId, { status: 'active' })), new Map());
  let view = await viewOf();
  const { db, dialect: d } = await h.manager.data(h.connectionId);
  const targetOf = (name: string): WriteTarget => ({
    connectionId: h.connectionId,
    view,
    table: view.table(view.model.tables.find((t) => t.name === `pos_${name}`)!.id),
    db,
    dialect: d,
    timezone: zone,
  });
  const writes = createWriteService({ sequences: documentSequencesRepo(h.meta) });
  const staff: WriteContext = { origin: 'dashboard', hops: 0, actor: null, request: null };
  const guest: WriteContext = { ...staff, origin: 'public' };
  const create = (name: string, values: Record<string, unknown>) =>
    writes.create({ target: targetOf(name), values, context: staff, announce: async () => {} });
  const update = (id: unknown, values: Record<string, unknown>, context = staff) =>
    writes.update({ target: targetOf('visits'), pk: { id }, values, context, announce: async () => {} });
  const outcome = (run: Promise<unknown>) =>
    run.then(
      () => 'written',
      (error: { code?: string }) => String(error.code),
    );
  const at = (day: string, hhmm: string) => wallTimeToInstant(`${day} ${hhmm}`, zone)!.toISOString();
  const late = async (id: unknown) =>
    [true, 1, '1'].includes(
      ((await db.selectFrom(targetOf('visits').table.id as never).select('late_cancel' as never).where('id' as never, '=', id as never).executeTakeFirst()) as { late_cancel: unknown })
        .late_cancel as never,
    );

  await create('booking_settings', { slot_minutes: 15, booking_days: 5, notice_minutes: 60, cancel_hours: 24 });
  for (const weekday of ['mon', 'tue', 'wed', 'thu', 'fri']) await create('opening_hours', { weekday, opens: '08:30', closes: '17:30' });
  const ada = await create('clinicians', { name: 'Ada', position: 1 });
  const routine = await create('visit_types', { name: 'Routine', minutes: 15 });
  await create('clinician_visit_types', { clinician_id: ada['id'], visit_type_id: routine['id'] });
  const visit = (day: string, hhmm: string) => create('visits', { clinician_id: ada['id'], visit_type_id: routine['id'], starts_at: at(day, hhmm) });

  // Inside 24 hours, cancelled by the desk: through, and flagged — in the
  // same statement, and in what undo is handed.
  const soon = await visit('2026-07-28', '10:00');
  const cancelled = await update(soon['id'], { status: 'cancelled' });
  expect(cancelled.values['status']).toBe('cancelled');
  // "Yes" as the column keeps it: a boolean, or 1 where the engine stores one as a number.
  expect([true, 1]).toContain(cancelled.values['late_cancel']);
  expect(await late(soon['id'])).toBe(true);
  // Outside it: not late.
  const later = await visit('2026-07-30', '10:00');
  expect((await update(later['id'], { status: 'cancelled' })).values).not.toHaveProperty('late_cancel');
  expect(await late(later['id'])).toBe(false);
  // A guest cancelling inside the window is let through too, and flagged.
  const guests = await visit('2026-07-28', '16:00');
  expect(await outcome(update(guests['id'], { status: 'cancelled' }, guest))).toBe('written');
  expect(await late(guests['id'])).toBe(true);
  // A visit already cancelled is not cancelled "again" and late.
  const noShow = await visit('2026-07-28', '11:30');
  expect((await update(noShow['id'], { status: 'no_show' })).values).not.toHaveProperty('late_cancel');

  // A guest may not MOVE a visit inside the window; the desk may.
  const eleven = await visit('2026-07-28', '11:00');
  expect(await outcome(update(eleven['id'], { starts_at: at('2026-07-28', '14:00') }, guest))).toBe('BOOKING_TOO_LATE');
  expect(await outcome(update(eleven['id'], { starts_at: at('2026-07-28', '14:00') }))).toBe('written');
  const thursday = await visit('2026-07-30', '11:00');
  expect(await outcome(update(thursday['id'], { starts_at: at('2026-07-30', '11:30') }, guest))).toBe('written');

  // Many rows at once: each decided against its own stored row.
  const a = await visit('2026-07-28', '12:00');
  const b = await visit('2026-07-30', '12:00');
  const prepared = await writes.beforeEach('update', targetOf('visits'), staff, [
    { values: { status: 'cancelled' }, match: { id: a['id'] } },
    { values: { status: 'cancelled' }, match: { id: b['id'] } },
  ]);
  expect(prepared.map((row) => (row.values['late_cancel'] === undefined ? null : Boolean(row.values['late_cancel'])))).toEqual([true, null]);
  const moves = await writes.beforeEach('update', targetOf('visits'), guest, [{ values: { starts_at: at('2026-07-28', '15:00') }, match: { id: a['id'] } }]).catch((error: { code?: string }) => error.code);
  // A batch that moves visits is refused whole, before anything is decided.
  expect(moves).toBe('CONFLICT');
  // Marking visits no-show together needs no lock, and goes through as one batch.
  await expect(writes.check('update', targetOf('visits'), staff, [{ status: 'no_show' }])).resolves.toBeDefined();
  await expect(writes.check('update', targetOf('visits'), staff, [{ status: 'booked' }])).rejects.toBeInstanceOf(GuardedBatchError);

  // Mode `refuse`: a guest is turned away inside the window, the desk is not, and nothing is flagged.
  const [rule] = (await overridesRepo(h.meta).listForConnection(h.connectionId)).filter((o) => o.op === 'table.booking');
  const value = rule!.value as { cancel: Record<string, unknown> };
  await overridesRepo(h.meta).delete(rule!.id);
  await overridesRepo(h.meta).create({
    connectionId: h.connectionId,
    op: 'table.booking',
    tableName: rule!.tableName,
    columnName: null,
    value: { ...value, cancel: { hours: value.cancel['hours'], mode: 'refuse', when: value.cancel['when'] } },
  });
  view = await viewOf();
  const refused = await visit('2026-07-28', '16:30');
  expect(await outcome(update(refused['id'], { status: 'cancelled' }, guest))).toBe('BOOKING_TOO_LATE');
  expect((await update(refused['id'], { status: 'cancelled' })).values).not.toHaveProperty('late_cancel');
  expect(await late(refused['id'])).toBe(false);
}

/** The booking manifest with stamped columns: who booked, when checked in, who cancelled, who voided. */
function stampManifest() {
  const base = bookingManifest();
  const tables = (base.requiredSchema.tables as { ref: string; columns: Record<string, unknown>[] }[]).map((table) =>
    table.ref !== 'visits'
      ? table
      : {
          ...table,
          columns: [
            ...table.columns,
            { ref: 'booked_by', type: 'text', nullable: true, rules: { stamp: { set: 'user-name', on: 'create' } } },
            { ref: 'checked_in_at', type: 'timestamptz', nullable: true, rules: { stamp: { set: 'now', on: { column: 'status', values: ['checked_in'] } } } },
            {
              ref: 'cancelled_by',
              type: 'enum',
              enum: ['patient', 'desk'],
              nullable: true,
              rules: { stamp: { set: { byOrigin: { public: 'patient', staff: 'desk' } }, on: { column: 'status', values: ['cancelled'] } } },
            },
          ],
        },
  );
  const payments = {
    ref: 'payments',
    columns: [
      { ref: 'id', type: 'int', role: 'pk' },
      { ref: 'visit_id', type: 'fk', references: 'visits' },
      { ref: 'amount', type: 'money' },
      { ref: 'voided', type: 'bool', default: false },
      { ref: 'taken_by', type: 'text', nullable: true, rules: { stamp: { set: 'user-name', on: 'create' } } },
      { ref: 'voided_by', type: 'text', nullable: true, rules: { stamp: { set: 'user-id', on: { column: 'voided', values: [true] } } } },
      { ref: 'voided_at', type: 'timestamptz', nullable: true, rules: { stamp: { set: 'now', on: { column: 'voided', values: [true] } } } },
    ],
  };
  return { ...base, requiredSchema: { ...base.requiredSchema, tables: [...tables, payments] } };
}

/** Stamps: on a create, on a change against the stored row, per origin, and never over history. */
async function stampRows(h: Harness, zone: string): Promise<void> {
  await stageManifest(h, stampManifest());
  const installed = await post(h, '/apps/install');
  expect(installed.statusCode, installed.body).toBe(200);
  expect(installed.json().rules.skipped).toEqual([]);
  const stamps = (await overridesRepo(h.meta).listForConnection(h.connectionId)).filter((o) => o.op === 'column.stamp');
  expect(stamps.map((o) => `${o.tableName.split('.').pop()}.${o.columnName}`).sort()).toEqual([
    'pos_payments.taken_by',
    'pos_payments.voided_at',
    'pos_payments.voided_by',
    'pos_visits.booked_by',
    'pos_visits.cancelled_by',
    'pos_visits.checked_in_at',
  ]);

  const snapshot = (await snapshotsRepo(h.meta).latest(h.connectionId))!;
  const view = new SnapshotView(
    h.connectionId,
    applyOverrides(parseDatabaseModel(snapshot.schema), await overridesRepo(h.meta).listForConnection(h.connectionId, { status: 'active' })),
    new Map(),
  );
  const { db, dialect: d } = await h.manager.data(h.connectionId);
  const targetOf = (name: string): WriteTarget => ({
    connectionId: h.connectionId,
    view,
    table: view.table(view.model.tables.find((t) => t.name === `pos_${name}`)!.id),
    db,
    dialect: d,
    timezone: zone,
  });
  const writes = createWriteService({ sequences: documentSequencesRepo(h.meta) });
  const staff: WriteContext = { origin: 'dashboard', hops: 0, actor: { kind: 'user', id: 'usr_ivy', label: 'Ivy' }, request: null };
  const guest: WriteContext = { origin: 'public', hops: 0, actor: { kind: 'public', id: null, label: 'public:key_1' }, request: null };
  const rule: WriteContext = { origin: 'automation', hops: 1, actor: { kind: 'automation', id: 'rul_1', label: 'Tidy the day' }, request: null };
  const history: WriteContext = { origin: 'import', hops: 0, actor: { kind: 'user', id: 'usr_ivy', label: 'Ivy' }, request: null };
  const prepared = (name: string, values: Record<string, unknown>) => {
    const table = targetOf(name).table;
    const local = new Set(table.table?.columns.filter((c) => c.venueLocal === true).map((c) => c.name));
    return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, local.has(k) ? v : normalizeWriteValue(table.columns.get(k)!, v)]));
  };
  const create = (name: string, values: Record<string, unknown>, context: WriteContext = staff) =>
    writes.create({ target: targetOf(name), values: prepared(name, values), context, announce: async () => {} });
  const update = (name: string, id: unknown, values: Record<string, unknown>, context: WriteContext = staff) =>
    writes.update({ target: targetOf(name), pk: { id }, values: prepared(name, values), context, announce: async () => {} });
  const stored = async (name: string, id: unknown) =>
    (await db.selectFrom(targetOf(name).table.id as never).selectAll().where('id' as never, '=', id as never).executeTakeFirst()) as Row;
  const at = (day: string, hhmm: string) => wallTimeToInstant(`${day} ${hhmm}`, zone)!.toISOString();
  /** A stamped time as the instant it names, to the second. */
  const when = (value: unknown) => (value === null || value === undefined ? null : slotInstantOf(value).slice(0, 19));
  const nowIso = () => new Date().toISOString().slice(0, 19);

  await create('booking_settings', { slot_minutes: 15, booking_days: 5, notice_minutes: 0, cancel_hours: 24 });
  for (const weekday of ['mon', 'tue', 'wed', 'thu', 'fri']) await create('opening_hours', { weekday, opens: '08:30', closes: '17:30' });
  const ada = await create('clinicians', { name: 'Ada', position: 1 });
  const routine = await create('visit_types', { name: 'Routine', minutes: 15 });
  await create('clinician_visit_types', { clinician_id: ada['id'], visit_type_id: routine['id'] });
  const visit = (hhmm: string, extra: Record<string, unknown> = {}, context: WriteContext = staff) =>
    create('visits', { clinician_id: ada['id'], visit_type_id: routine['id'], starts_at: at('2026-07-29', hhmm), ...extra }, context);

  // On a create: who booked it — and the stamp wins over a name the writer sent.
  const first = await visit('09:00', { booked_by: 'Mallory' });
  expect(first['booked_by']).toBe('Ivy');
  expect(first['checked_in_at'] ?? null).toBeNull();
  // A status change stamps the time, once: re-sending the status the row holds stamps nothing again.
  const checkedIn = await update('visits', first['id'], { status: 'checked_in' });
  expect(when(checkedIn.values['checked_in_at'])).toBe(nowIso());
  expect(when((await stored('visits', first['id']))['checked_in_at'])).toBe(nowIso());
  const stampedAt = when((await stored('visits', first['id']))['checked_in_at']);
  vi.setSystemTime(new Date(Date.now() + 5 * 60_000));
  const again = await update('visits', first['id'], { status: 'checked_in' });
  expect(again.values).not.toHaveProperty('checked_in_at');
  expect(when((await stored('visits', first['id']))['checked_in_at'])).toBe(stampedAt);
  // A create whose watched value is already one of them stamps too: a walk-in.
  const walkIn = await visit('09:15', { status: 'checked_in' });
  expect(when(walkIn['checked_in_at'])).toBe(nowIso());

  // Staff cancelling: "desk". A guest: "patient", and never a person's name.
  const byDesk = await visit('10:00');
  await update('visits', byDesk['id'], { status: 'cancelled' });
  expect((await stored('visits', byDesk['id']))['cancelled_by']).toBe('desk');
  const online = await visit('10:30', {}, guest);
  expect(online['booked_by'] ?? null).toBeNull();
  const cancelledOnline = await update('visits', online['id'], { status: 'cancelled' }, guest);
  expect(cancelledOnline.values['cancelled_by']).toBe('patient');
  expect((await stored('visits', online['id']))['cancelled_by']).toBe('patient');
  // An automation stamps its rule's name.
  expect((await visit('11:00', {}, rule))['booked_by']).toBe('Tidy the day');

  // History keeps what it says: an import stamps nothing, neither over a value nor into an empty one.
  const imported = await writes.check('create', targetOf('visits'), history, [
    prepared('visits', { clinician_id: ada['id'], visit_type_id: routine['id'], starts_at: at('2026-07-20', '09:00'), status: 'checked_in', booked_by: 'Old desk' }),
  ], { capacity: 'unchecked' });
  expect(imported.rows[0]!['booked_by']).toBe('Old desk');
  expect(imported.rows[0]).not.toHaveProperty('checked_in_at');
  const [restated] = await writes.beforeEach('update', targetOf('visits'), history, [{ values: { status: 'checked_in' }, match: { id: byDesk['id'] } }], {
    capacity: 'unchecked',
  });
  expect(restated!.values).not.toHaveProperty('checked_in_at');

  // A create through the multi-row path is stamped as a single one is.
  const bulkCreate = await writes.beforeEach('create', targetOf('payments'), staff, [
    { values: prepared('payments', { visit_id: first['id'], amount: 5 }) },
    { values: prepared('payments', { visit_id: first['id'], amount: 6, taken_by: 'Mallory' }) },
  ]);
  expect(bulkCreate.map((row) => row.values['taken_by'])).toEqual(['Ivy', 'Ivy']);

  // A switch: voiding stamps who and when, on each row of a bulk write; un-voiding stamps nothing.
  const paid = await create('payments', { visit_id: first['id'], amount: 30 });
  expect(paid['taken_by']).toBe('Ivy');
  const other = await create('payments', { visit_id: first['id'], amount: 10 });
  const voided = await update('payments', paid['id'], { voided: true });
  expect(voided.values['voided_by']).toBe('usr_ivy');
  expect(when((await stored('payments', paid['id']))['voided_at'])).toBe(nowIso());
  const bulk = await writes.beforeEach('update', targetOf('payments'), staff, [
    { values: prepared('payments', { voided: true }), match: { id: paid['id'] } },
    // A switch as MySQL and SQLite spell one.
    { values: { voided: 1 }, match: { id: other['id'] } },
  ]);
  expect(bulk.map((row) => row.values['voided_by'] ?? null)).toEqual([null, 'usr_ivy']);
  const unvoid = await update('payments', paid['id'], { voided: false });
  expect(unvoid.values).not.toHaveProperty('voided_by');

  // And a public endpoint may offer a guest none of them, nor the late flag.
  const visits = targetOf('visits').table;
  const definition = {
    path: '/pos_visits',
    source: visits.id,
    methods: ['POST'],
    select: ['id', 'starts_at', 'status'],
    writable: ['starts_at', 'checked_in_at', 'cancelled_by', 'late_cancel'],
    filters: [],
    pagination: { default_limit: 50, max_limit: 200, order: 'id.asc' },
    auth: { role: 'anon' },
    rate_limit: { requests: 60, window: '1m' },
    response: { shape: 'object', envelope: 'data' },
  } as never;
  expect(endpointIssues(definition, { ref: 'pos_visits', view }).map((i) => [i.code, i.column])).toEqual([
    ['ENDPOINT_WRITABLE_DECIDED', 'checked_in_at'],
    ['ENDPOINT_WRITABLE_DECIDED', 'cancelled_by'],
    ['ENDPOINT_WRITABLE_DECIDED', 'late_cancel'],
  ]);
}

/** The booking manifest with money on each visit: a fee, what is paid, what is written off, and the balance. */
function moneyManifest() {
  const base = bookingManifest();
  const tables = (base.requiredSchema.tables as { ref: string; columns: Record<string, unknown>[] }[]).map((table) => {
    if (table.ref === 'visit_types') return { ...table, columns: [...table.columns, { ref: 'fee', type: 'money', default: 0 }] };
    if (table.ref !== 'visits') return table;
    return {
      ...table,
      columns: [
        ...table.columns,
        { ref: 'fee', type: 'money', nullable: true, rules: { copy: { via: 'visit_type_id', from: 'fee' } } },
        {
          ref: 'paid',
          type: 'money',
          nullable: true,
          rules: {
            rollup: { from: 'payments', via: 'visit_id', sum: 'amount', where: { column: 'voided', eq: false }, balance: { column: 'balance', of: 'fee', minus: ['waived'] }, cap: true },
          },
        },
        { ref: 'waived', type: 'money', nullable: true, rules: { rollup: { from: 'write_offs', via: 'visit_id', sum: 'amount', cap: true } } },
        { ref: 'balance', type: 'money', nullable: true },
      ],
    };
  });
  const id = { ref: 'id', type: 'int', role: 'pk' };
  return {
    ...base,
    requiredSchema: {
      ...base.requiredSchema,
      tables: [
        ...tables,
        { ref: 'payments', columns: [id, { ref: 'visit_id', type: 'fk', references: 'visits' }, { ref: 'amount', type: 'money' }, { ref: 'voided', type: 'bool', default: false }] },
        { ref: 'write_offs', columns: [id, { ref: 'visit_id', type: 'fk', references: 'visits' }, { ref: 'amount', type: 'money' }] },
      ],
    },
  };
}

/** A visit's money: a filtered total, a balance worked out from it, and a cap no path gets past. */
async function keepBalances(h: Harness, zone: string): Promise<void> {
  await stageManifest(h, moneyManifest());
  const installed = await post(h, '/apps/install');
  expect(installed.statusCode, installed.body).toBe(200);
  expect(installed.json().rules.skipped).toEqual([]);
  // The filter, the balance and the cap are stored as the app asked: none of them dropped on the way.
  const [paidRule] = (await overridesRepo(h.meta).listForConnection(h.connectionId)).filter((o) => o.op === 'column.rollup' && o.columnName === 'paid');
  expect(paidRule!.value).toMatchObject({ where: { column: 'voided', eq: false }, balance: { column: 'balance', of: 'fee', minus: ['waived'] }, cap: true });

  const snapshot = (await snapshotsRepo(h.meta).latest(h.connectionId))!;
  const viewOf = async () =>
    new SnapshotView(
      h.connectionId,
      applyOverrides(parseDatabaseModel(snapshot.schema), await overridesRepo(h.meta).listForConnection(h.connectionId, { status: 'active' })),
      new Map(),
    );
  let view = await viewOf();
  const { db, dialect: d } = await h.manager.data(h.connectionId);
  const targetOf = (name: string): WriteTarget => ({
    connectionId: h.connectionId,
    view,
    table: view.table(view.model.tables.find((t) => t.name === `pos_${name}`)!.id),
    db,
    dialect: d,
    timezone: zone,
  });
  const writes = createWriteService({ sequences: documentSequencesRepo(h.meta) });
  const staff: WriteContext = { origin: 'dashboard', hops: 0, actor: { kind: 'user', id: 'usr_ivy', label: 'Ivy' }, request: null };
  const history: WriteContext = { ...staff, origin: 'import' };
  const prepared = (name: string, values: Record<string, unknown>) => {
    const table = targetOf(name).table;
    const local = new Set(table.table?.columns.filter((c) => c.venueLocal === true).map((c) => c.name));
    return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, local.has(k) ? v : normalizeWriteValue(table.columns.get(k)!, v)]));
  };
  const create = (name: string, values: Record<string, unknown>) =>
    writes.create({ target: targetOf(name), values: prepared(name, values), context: staff, announce: async () => {} });
  const update = (name: string, id: unknown, values: Record<string, unknown>) =>
    writes.update({ target: targetOf(name), pk: { id }, values: prepared(name, values), context: staff, announce: async () => {} });
  const outcome = (run: Promise<unknown>) =>
    run.then(
      () => 'written',
      (error: { code?: string; details?: { reason?: string } }) => String(error.details?.reason ?? error.code),
    );
  const refusal = (run: Promise<unknown>) => run.then(() => null, (error: { details?: unknown }) => error.details);
  const money = async (id: unknown) => {
    const row = (await db.selectFrom(targetOf('visits').table.id as never).selectAll().where('id' as never, '=', id as never).executeTakeFirst()) as Row;
    return Object.fromEntries(['fee', 'paid', 'waived', 'balance'].map((k) => [k, row[k] === null ? null : Number(row[k])]));
  };
  const count = async (name: string) =>
    Number(((await db.selectFrom(targetOf(name).table.id as never).select(sql<number>`count(*)`.as('n')).executeTakeFirst()) as { n: unknown }).n);
  const at = (hhmm: string) => wallTimeToInstant(`2026-07-29 ${hhmm}`, zone)!.toISOString();

  await create('booking_settings', { slot_minutes: 15, booking_days: 5, notice_minutes: 0, cancel_hours: 24 });
  for (const weekday of ['mon', 'tue', 'wed', 'thu', 'fri']) await create('opening_hours', { weekday, opens: '08:30', closes: '17:30' });
  const ada = await create('clinicians', { name: 'Ada', position: 1 });
  const routine = await create('visit_types', { name: 'Routine', minutes: 15, fee: 40 });
  const long = await create('visit_types', { name: 'Long', minutes: 15, fee: 60 });
  await create('clinician_visit_types', { clinician_id: ada['id'], visit_type_id: routine['id'] });
  await create('clinician_visit_types', { clinician_id: ada['id'], visit_type_id: long['id'] });
  const visit = (hhmm: string) => create('visits', { clinician_id: ada['id'], visit_type_id: routine['id'], starts_at: at(hhmm) });

  // A new visit owes its fee: its totals are settled when it is made.
  const v = await visit('09:00');
  expect(await money(v['id'])).toEqual({ fee: 40, paid: 0, waived: 0, balance: 40 });

  // Payments count while they are not voided, and never past the balance.
  const first = await create('payments', { visit_id: v['id'], amount: 25 });
  expect(await money(v['id'])).toMatchObject({ paid: 25, balance: 15 });
  expect(await refusal(create('payments', { visit_id: v['id'], amount: 20 }))).toEqual({ column: 'balance', balance: 15 });
  // Refused whole: the payment is not there, and nothing moved.
  expect(await count('payments')).toBe(1);
  expect(await money(v['id'])).toMatchObject({ paid: 25, balance: 15 });
  await create('payments', { visit_id: v['id'], amount: 15 });
  expect(await money(v['id'])).toMatchObject({ paid: 40, balance: 0 });
  // Voiding one gives its amount back.
  await update('payments', first['id'], { voided: true });
  expect(await money(v['id'])).toMatchObject({ paid: 15, balance: 25 });

  // A write-off is capped by the same balance, which it lowers.
  expect(await outcome(create('write_offs', { visit_id: v['id'], amount: 30 }))).toBe('BALANCE_EXCEEDED');
  await create('write_offs', { visit_id: v['id'], amount: 5 });
  expect(await money(v['id'])).toEqual({ fee: 40, paid: 15, waived: 5, balance: 20 });

  // A lower fee is held to what is already paid and written off.
  expect(await refusal(update('visits', v['id'], { fee: 10 }))).toEqual({ column: 'balance', balance: 20 });
  expect(await money(v['id'])).toEqual({ fee: 40, paid: 15, waived: 5, balance: 20 });
  await update('visits', v['id'], { fee: 25 });
  expect(await money(v['id'])).toEqual({ fee: 25, paid: 15, waived: 5, balance: 5 });
  // A whole-row edit that sends the totals back as it read them — or anything else — changes none of them.
  await update('visits', v['id'], { status: 'booked', paid: 999, waived: 999, balance: 999 });
  expect(await money(v['id'])).toEqual({ fee: 25, paid: 15, waived: 5, balance: 5 });
  // Another visit type copies its fee again, and the balance follows.
  await update('visits', v['id'], { visit_type_id: long['id'] });
  expect(await money(v['id'])).toEqual({ fee: 60, paid: 15, waived: 5, balance: 40 });
  // A deleted payment gives its amount back too.
  const later = await create('payments', { visit_id: v['id'], amount: 10 });
  await writes.delete({ target: targetOf('payments'), pk: { id: later['id'] }, context: staff, announce: async () => {} });
  expect(await money(v['id'])).toMatchObject({ paid: 15, balance: 40 });

  // Five desks taking 10 at once from a balance of 25: two are paid, three are refused.
  const busy = await visit('10:00');
  await create('payments', { visit_id: busy['id'], amount: 15 });
  const race = await Promise.all(Array.from({ length: 5 }, () => outcome(create('payments', { visit_id: busy['id'], amount: 10 }))));
  expect(race.filter((r) => r === 'written')).toHaveLength(2);
  expect(race.filter((r) => r === 'BALANCE_EXCEEDED')).toHaveLength(3);
  expect(await money(busy['id'])).toMatchObject({ paid: 35, balance: 5 });

  // Many rows at once cannot be held to a balance, so they are refused — unless they are history.
  await expect(outcome(writes.beforeEach('create', targetOf('payments'), staff, [{ values: prepared('payments', { visit_id: v['id'], amount: 1 }) }]))).resolves.toBe(
    'BALANCE_ONE_AT_A_TIME',
  );
  await expect(outcome(writes.beforeEach('delete', targetOf('payments'), staff, [{ values: {}, match: { id: first['id'] } }]))).resolves.toBe('BALANCE_ONE_AT_A_TIME');
  await expect(outcome(writes.beforeEach('update', targetOf('visits'), staff, [{ values: { fee: 5 }, match: { id: v['id'] } }]))).resolves.toBe('BALANCE_ONE_AT_A_TIME');
  await expect(outcome(writes.beforeEach('update', targetOf('visits'), staff, [{ values: { status: 'no_show' }, match: { id: busy['id'] } }]))).resolves.toBe('written');
  const imported = await writes.check('create', targetOf('payments'), history, [prepared('payments', { visit_id: busy['id'], amount: 5 })], { capacity: 'unchecked' });
  const row = await insertRow(db, d, targetOf('payments').table, imported.rows[0]!);
  await writes.settle('create', targetOf('payments'), [{ record: row, before: null }]);
  expect(await money(busy['id'])).toMatchObject({ paid: 40, balance: 0 });
  // A visit brought in by an import is settled like one made at the desk.
  const [old] = (await writes.check('create', targetOf('visits'), history, [prepared('visits', { clinician_id: ada['id'], visit_type_id: routine['id'], starts_at: at('11:00'), paid: 70 })], { capacity: 'unchecked' })).rows;
  expect(old).not.toHaveProperty('paid');
  const oldRow = await insertRow(db, d, targetOf('visits').table, old!);
  await writes.settle('create', targetOf('visits'), [{ record: oldRow, before: null }]);
  expect(await money(oldRow['id'])).toEqual({ fee: 40, paid: 0, waived: 0, balance: 40 });

  // What is stored may lag the rows (a rule added since, a write made elsewhere): the cap judges the truth.
  const table = (name: string) => targetOf(name).table.id;
  const lagging = await visit('12:00');
  // Stored as far below zero while it truly is 40: judged against what it was, 50 would pass.
  await db.updateTable(table('visits') as never).set({ balance: -100, paid: null } as never).where('id' as never, '=', lagging['id'] as never).execute();
  expect(await outcome(create('payments', { visit_id: lagging['id'], amount: 50 }))).toBe('BALANCE_EXCEEDED');
  await db.updateTable(table('visits') as never).set({ balance: null } as never).where('id' as never, '=', lagging['id'] as never).execute();
  await create('payments', { visit_id: lagging['id'], amount: 10 });
  expect(await money(lagging['id'])).toMatchObject({ paid: 10, balance: 30 });
  // A visit already overpaid by old data can still be edited, and have a payment voided; not paid again.
  const legacy = await visit('12:15');
  const overpaid = await insertRow(db, d, targetOf('payments').table, (await writes.check('create', targetOf('payments'), history, [prepared('payments', { visit_id: legacy['id'], amount: 50 })], { capacity: 'unchecked' })).rows[0]!);
  expect(await outcome(update('visits', legacy['id'], { status: 'booked', fee: 40 }))).toBe('written');
  expect(await outcome(create('payments', { visit_id: legacy['id'], amount: 1 }))).toBe('BALANCE_EXCEEDED');
  expect(await outcome(update('payments', overpaid['id'], { voided: true }))).toBe('written');
  expect(await money(legacy['id'])).toMatchObject({ paid: 0, balance: 40 });

  // A total is the settle's alone, whatever a project hook sets.
  const hooked = createWriteService({
    sequences: documentSequencesRepo(h.meta),
    hooks: () => ({
      wants: () => Promise.resolve(true),
      before: (event) => {
        event.values['paid'] = 999;
        event.values['balance'] = 999;
        return Promise.resolve();
      },
      after: () => Promise.resolve(),
    }),
  });
  await hooked.update({ target: targetOf('visits'), pk: { id: lagging['id'] }, values: { status: 'booked' }, context: staff, announce: async () => {} });
  expect(await money(lagging['id'])).toMatchObject({ paid: 10, balance: 30 });

  // A parent form's payment rows are written inside its transaction, settled and judged there.
  const inForm = (amount: number) =>
    db.transaction().execute(async (trx) => {
      const within = { ...targetOf('payments'), db: trx as unknown as typeof db };
      const [row] = await writes.beforeEach('create', within, staff, [{ values: prepared('payments', { visit_id: lagging['id'], amount }) }]);
      const written = await insertRow(within.db, d, within.table, row!.values);
      await writes.settle('create', within, [{ record: written, before: null }], { cap: true });
    });
  expect(await outcome(inForm(31))).toBe('BALANCE_EXCEEDED');
  expect(await money(lagging['id'])).toMatchObject({ paid: 10, balance: 30 });
  expect(await outcome(inForm(30))).toBe('written');
  expect(await money(lagging['id'])).toMatchObject({ paid: 40, balance: 0 });
  // A batch that re-copies a lower fee through a new visit type moves a booking, and is refused as one…
  const cheap = await create('visit_types', { name: 'Check', minutes: 15, fee: 5 });
  await create('clinician_visit_types', { clinician_id: ada['id'], visit_type_id: cheap['id'] });
  const recopy = () =>
    outcome(writes.beforeEach('update', targetOf('visits'), staff, [{ values: prepared('visits', { visit_type_id: cheap['id'] }), match: { id: lagging['id'] } }]));
  await expect(recopy()).resolves.toBe('CAPACITY_ONE_AT_A_TIME');
  // …and without the booking rule, as the fee change it also is. One sending the same fee is neither.
  const [bookingRule] = (await overridesRepo(h.meta).listForConnection(h.connectionId)).filter((o) => o.op === 'table.booking');
  await overridesRepo(h.meta).setStatus(bookingRule!.id, 'disabled');
  view = await viewOf();
  await expect(recopy()).resolves.toBe('BALANCE_ONE_AT_A_TIME');
  await expect(
    outcome(writes.beforeEach('update', targetOf('visits'), staff, [{ values: prepared('visits', { status: 'booked', fee: 40 }), match: { id: lagging['id'] } }])),
  ).resolves.toBe('written');

  // And a guest may never write a balance.
  const definition = {
    path: '/pos_visits',
    source: targetOf('visits').table.id,
    methods: ['POST'],
    select: ['id', 'starts_at'],
    writable: ['starts_at', 'balance', 'paid'],
    filters: [],
    pagination: { default_limit: 50, max_limit: 200, order: 'id.asc' },
    auth: { role: 'anon' },
    rate_limit: { requests: 60, window: '1m' },
    response: { shape: 'object', envelope: 'data' },
  } as never;
  expect(endpointIssues(definition, { ref: 'pos_visits', view }).map((i) => [i.code, i.column])).toEqual([
    ['ENDPOINT_WRITABLE_DECIDED', 'balance'],
    ['ENDPOINT_WRITABLE_DECIDED', 'paid'],
  ]);
}

/** A practice's patients, their visits and a waiting list, opened to each patient alone. */
function patientsManifest(opts: { proofs?: boolean } = {}) {
  const proof = opts.proofs === true ? { humanCheck: true } : {};
  const id = { ref: 'id', type: 'int', role: 'pk' };
  return {
    ...MANIFEST,
    requiredSchema: {
      prefixed: true,
      tables: [
        TABLES[0],
        {
          ref: 'patients',
          columns: [
            id,
            { ref: 'name', type: 'text', maxLength: 40 },
            { ref: 'mobile', type: 'text', maxLength: 20 },
            { ref: 'born_on', type: 'date' },
            { ref: 'email', type: 'text', maxLength: 80, nullable: true },
            { ref: 'remind', type: 'bool', default: false },
          ],
        },
        {
          ref: 'appointments',
          columns: [
            id,
            { ref: 'patient_id', type: 'fk', references: 'patients', nullable: true },
            { ref: 'starts_at', type: 'timestamptz' },
            { ref: 'status', type: 'enum', enum: ['booked', 'seen', 'cancelled'], default: 'booked' },
            { ref: 'new_name', type: 'text', maxLength: 80, nullable: true },
            { ref: 'check_status', type: 'enum', enum: ['to_check', 'done'], nullable: true },
          ],
        },
        {
          ref: 'waiting_list',
          columns: [
            id,
            { ref: 'patient_id', type: 'fk', references: 'patients' },
            { ref: 'status', type: 'enum', enum: ['waiting', 'done'], default: 'waiting' },
            { ref: 'note', type: 'text', maxLength: 80, nullable: true },
            { ref: 'created_at', type: 'timestamptz', default: 'now' },
          ],
        },
      ],
    },
    publicAccess: [
      // "Found you": the name, and a code emailed to go further.
      { table: 'patients', methods: ['GET'], select: ['name'], sensitive: true, claim: { match: ['mobile', 'born_on'], verify: 'email-code', email: 'email' }, ...proof },
      { table: 'patients', methods: ['GET', 'PATCH'], select: ['name', 'email', 'remind'], writable: ['remind'], claimedBy: { table: 'patients', column: 'id' }, level: 'verified', sensitive: true },
      {
        table: 'appointments',
        methods: ['POST'],
        select: ['id', 'starts_at', 'status'],
        writable: ['starts_at', 'new_name'],
        defaults: { status: 'booked', check_status: 'to_check' },
        claimedBy: { table: 'patients', column: 'patient_id', optional: true },
        onClaim: { clear: ['new_name', 'check_status'] },
        maxOpen: { column: 'status', values: ['booked'], n: 2, upcoming: 'starts_at' },
        sensitive: false,
        reason: 'the reply names the booking just made and nothing else',
        ...proof,
      },
      {
        table: 'appointments',
        methods: ['GET', 'PATCH'],
        select: ['id', 'starts_at', 'status'],
        writable: ['status'],
        writableValues: { status: ['cancelled'] },
        writableWhen: { status: ['booked'] },
        claimedBy: { table: 'patients', column: 'patient_id' },
        level: 'verified',
        sensitive: true,
      },
      {
        table: 'waiting_list',
        methods: ['POST'],
        select: ['id', 'status'],
        writable: ['note'],
        defaults: { status: 'waiting' },
        claimedBy: { table: 'patients', column: 'patient_id' },
        rank: { orderBy: 'created_at', where: { column: 'status', eq: 'waiting' } },
        maxOpen: { column: 'status', values: ['waiting'], n: 1 },
        sensitive: false,
        reason: 'the reply says only where they stand',
      },
    ],
  };
}

/** The whole server over the harness's store, answering with an app's own key. */
async function servePublic(h: Harness, keyId: string, opts: { serveApps?: boolean } = {}) {
  await settingsRepo(h.meta).set('publicApi.enabled', true);
  const runService = createRunService({ meta: h.meta });
  const composed = await composeServer({
    env: makeEnv({
      // `self`: the app's own pages on this server (a kiosk) may call it too.
      ADMINIUM_PUBLIC_API_ORIGINS: opts.serveApps === true ? 'self,https://clinic.example.com' : 'https://clinic.example.com',
      HOST: '127.0.0.1',
      ADMINIUM_SECRET: TEST_SECRET,
      // The installed apps' files, where the harness's install put them: their sides are served.
      ...(opts.serveApps === true ? { ADMINIUM_DATA_DIR: h.dataDir } : {}),
    }),
    metaStore: { meta: h.meta, url: 'sqlite::memory:', engine: 'sqlite', source: 'embedded', close: async () => Promise.resolve() },
    manager: h.manager,
    runService,
    applyService: createApplyService({ meta: h.meta, runService }),
    allowed: null,
    logger: false,
    telemetry: false,
  });
  await composed.app.ready();
  // The test drives the outbox, the reminder scan and the jobs itself: no tick or poll may race it.
  await composed.jobs.worker.stop();
  composed.jobs.scheduler.stop();
  const key = (await publicKeysRepo(h.meta).findById(keyId))!;
  const token = openPublishableKey(dsnCryptoFromSecret(TEST_SECRET), key.tokenEncrypted!);
  const headers = (session?: string) => ({
    authorization: `Bearer ${token}`,
    origin: 'https://clinic.example.com',
    ...(session === undefined ? {} : { 'x-adminium-public-session': session }),
  });
  const call = (method: 'GET' | 'POST' | 'PATCH', url: string, session?: string, values?: Record<string, unknown>) =>
    composed.app.inject({ method, url: `/api/v1/public${url}`, headers: headers(session), ...(values === undefined ? {} : { payload: { values } }) });
  const post = (url: string, payload: Record<string, unknown>, session?: string, extra: Record<string, string> = {}) =>
    composed.app.inject({ method: 'POST', url: `/api/v1/public${url}`, headers: { ...headers(session), ...extra }, payload });
  const codeOf = (res: { json: () => unknown }) => (res.json() as { error?: { code: string } }).error?.code;
  return { composed, headers, call, post, codeOf };
}

/** A patient's own rows: one identity, two levels, an optional claim, caps and a rank — and never another's rows. */
async function claimPatients(h: Harness): Promise<void> {
  await stageManifest(h, patientsManifest());
  const installed = await post(h, '/apps/install');
  expect(installed.statusCode, installed.body).toBe(200);
  expect(installed.json().rules.skipped).toEqual([]);
  const made = installed.json().publicAccess as { endpoints: string[]; keyId: string };
  expect(made.endpoints).toEqual(['pos_patients_claimed', 'pos_patients_verified', 'pos_appointments_claimed', 'pos_appointments_verified', 'pos_waiting_list_claimed']);
  const definitionOf = async (ref: string) =>
    JSON.parse((await publicEndpointsRepo(h.meta).listByConnection(h.connectionId)).find((e) => e.ref === ref)!.definition) as Record<string, unknown>;
  expect((await definitionOf('pos_patients_claimed'))['identity']).toEqual({
    strategy: 'lookup',
    match: ['mobile', 'born_on'],
    column: 'id',
    verify: 'email-code',
    email: 'email',
  });
  expect(await definitionOf('pos_appointments_claimed')).toMatchObject({
    auth: { role: 'anon' },
    claim: { column: 'patient_id', ref: 'pos_patients_claimed', optional: true },
    on_claim: { clear: ['new_name', 'check_status'] },
  });
  expect(await definitionOf('pos_appointments_verified')).toMatchObject({
    auth: { role: 'authenticated' },
    claim: { column: 'patient_id', ref: 'pos_patients_claimed' },
    level: 'verified',
    sensitive: true,
  });

  const served = await servePublic(h, made.keyId);
  const composed = served.composed;
  try {
    const { headers, call, codeOf } = served;
    const ids = (res: { json: () => unknown }) => (res.json() as { data: { id: unknown }[] }).data.map((row) => Number(row.id));

    await h.run(`insert into pos_patients (name, mobile, born_on, email) values ('Ada', '07700900001', '1980-01-01', 'ada@example.com')`);
    await h.run(`insert into pos_patients (name, mobile, born_on, email) values ('Ben', '07700900002', '1981-02-02', 'ben@example.com')`);
    const future = (day: string) => `'${day} 10:00:00'`;
    await h.run(`insert into pos_appointments (patient_id, starts_at, status) values (2, ${future('2099-01-05')}, 'booked')`);
    await h.run(`insert into pos_appointments (patient_id, starts_at, status) values (1, ${future('2000-01-05')}, 'booked')`);
    await h.run(`insert into pos_waiting_list (patient_id, status, created_at) values (2, 'waiting', ${future('2020-01-01')})`);

    // The page learns a found session can be verified by a code.
    const config = await composed.app.inject({ method: 'GET', url: '/api/v1/public/config', headers: headers() });
    expect((config.json() as { data: { claim: unknown } }).data.claim).toEqual({
      strategy: 'lookup',
      ref: 'pos_patients_claimed',
      match: ['mobile', 'born_on'],
      verify: 'email-code',
    });

    // A first visit, by nobody on file: no session, marked to check, their own name kept.
    const first = await call('POST', '/records/pos_appointments_claimed', undefined, { starts_at: '2099-02-01T10:00:00Z', new_name: 'Cara' });
    expect(first.statusCode, first.body).toBe(201);
    expect((await h.rows('select patient_id, new_name, check_status from pos_appointments where id = 3'))[0]).toMatchObject({ patient_id: null, new_name: 'Cara', check_status: 'to_check' });

    const claim = await composed.app.inject({ method: 'POST', url: '/api/v1/public/claim', headers: headers(), payload: { match: { mobile: '07700900001', born_on: '1980-01-01' } } });
    expect(claim.statusCode, claim.body).toBe(200);
    const ada = (claim.json() as { data: { session: string } }).data.session;

    // Found: a name, and nothing more until the code is confirmed.
    const found = await call('GET', '/records/pos_patients_claimed', ada);
    expect((found.json() as { data: unknown[] }).data).toEqual([{ name: 'Ada' }]);
    for (const ref of ['pos_patients_verified', 'pos_appointments_verified']) {
      const refused = await call('GET', `/records/${ref}`, ada);
      expect(refused.statusCode, refused.body).toBe(403);
      expect(codeOf(refused)).toBe('PUBLIC_CLAIM_LEVEL');
    }
    // No session at all is still no such thing.
    expect((await call('GET', '/records/pos_appointments_verified')).statusCode).toBe(404);

    // Booked by a found session: theirs, and what a stranger would type is emptied.
    const mine = await call('POST', '/records/pos_appointments_claimed', ada, { starts_at: '2099-03-01T10:00:00Z', new_name: 'Mallory' });
    expect(mine.statusCode, mine.body).toBe(201);
    const mineId = Number((mine.json() as { data: { id: unknown } }).data.id);
    expect((await h.rows(`select patient_id, new_name, check_status from pos_appointments where id = ${mineId}`))[0]).toMatchObject({
      patient_id: 1,
      new_name: null,
      check_status: null,
    });
    // Two booked visits still ahead is as many as a found session may make; one long past does not count.
    expect((await call('POST', '/records/pos_appointments_claimed', ada, { starts_at: '2099-03-02T10:00:00Z' })).statusCode).toBe(201);
    const third = await call('POST', '/records/pos_appointments_claimed', ada, { starts_at: '2099-03-03T10:00:00Z' });
    expect(third.statusCode, third.body).toBe(409);
    expect(codeOf(third)).toBe('PUBLIC_LIMIT_REACHED');
    // …which a stranger's first visit never meets: it holds no session.
    expect((await call('POST', '/records/pos_appointments_claimed', undefined, { starts_at: '2099-03-04T10:00:00Z', new_name: 'Dee' })).statusCode).toBe(201);

    // On the list: where they stand, and once.
    const joined = await call('POST', '/records/pos_waiting_list_claimed', ada, { note: 'mornings' });
    expect(joined.statusCode, joined.body).toBe(201);
    expect((joined.json() as { rank?: number }).rank).toBe(2);
    expect(codeOf(await call('POST', '/records/pos_waiting_list_claimed', ada, { note: 'again' }))).toBe('PUBLIC_LIMIT_REACHED');

    // The code confirmed (the code step itself is the next piece): Ada's rows, and never Ben's.
    const sessionRow = await publicSessionsRepo(h.meta).findValid(hashPublishableKey(ada));
    await publicSessionsRepo(h.meta).raise(sessionRow!.id, 'verified', Date.now() + 30 * 60_000);
    expect(ids(await call('GET', '/records/pos_appointments_verified', ada)).sort()).toEqual([2, mineId, mineId + 1].sort());
    expect((await call('GET', '/records/pos_appointments_verified/1', ada)).statusCode).toBe(404);
    expect((await call('PATCH', '/records/pos_appointments_verified/1', ada, { status: 'cancelled' })).statusCode).toBe(404);
    expect((await h.rows('select status from pos_appointments where id = 1'))[0]!['status']).toBe('booked');
    expect((await call('PATCH', `/records/pos_appointments_verified/${mineId}`, ada, { status: 'cancelled' })).statusCode).toBe(200);
    expect((await call('GET', '/records/pos_patients_verified', ada)).json()).toMatchObject({ data: [{ name: 'Ada', email: 'ada@example.com' }] });
    expect((await call('GET', '/records/pos_patients_verified/2', ada)).statusCode).toBe(404);
    expect((await call('PATCH', '/records/pos_patients_verified/2', ada, { remind: true })).statusCode).toBe(404);
    // Ben, claimed in his own session, reaches his own and not Ada's.
    const benClaim = await composed.app.inject({ method: 'POST', url: '/api/v1/public/claim', headers: headers(), payload: { match: { mobile: '07700900002', born_on: '1981-02-02' } } });
    const ben = (benClaim.json() as { data: { session: string } }).data.session;
    const benRow = await publicSessionsRepo(h.meta).findValid(hashPublishableKey(ben));
    await publicSessionsRepo(h.meta).raise(benRow!.id, 'verified', Date.now() + 30 * 60_000);
    expect(ids(await call('GET', '/records/pos_appointments_verified', ben))).toEqual([1]);
    expect((await call('GET', `/records/pos_appointments_verified/${mineId}`, ben)).statusCode).toBe(404);
  } finally {
    await composed.app.close();
  }
}

/** The patients app with an outbox: a log table, who a row goes to, and a template in two languages. */
function outboxManifest(version: string, opts: { subject?: string; dropReminder?: boolean; block?: string } = {}) {
  const base = patientsManifest();
  const id = { ref: 'id', type: 'int', role: 'pk' };
  const template = (key: string, subject: string) => ({
    key,
    name: { 'en-US': 'Confirmation', 'de-DE': 'Bestätigung' },
    vars: ['patient.name'],
    locales: {
      'en-US': { subject, blocks: [{ block: opts.block ?? 'email.heading', data: { text: 'Hello {{patient.name}}' } }, { block: 'email.text', data: { text: 'See you soon.' } }] },
      'de-DE': { subject: `DE ${subject}`, blocks: [{ block: 'email.heading', data: { text: 'Hallo {{patient.name}}' } }] },
    },
  });
  return {
    ...base,
    version,
    publicAccess: [],
    requiredSchema: {
      ...base.requiredSchema,
      tables: [
        ...base.requiredSchema.tables,
        {
          ref: 'messages',
          columns: [
            id,
            { ref: 'kind', type: 'enum', enum: ['confirmation', 'reminder'] },
            { ref: 'status', type: 'enum', enum: ['queued', 'sent', 'failed', 'skipped'], default: 'queued' },
            { ref: 'to_address', type: 'text', maxLength: 254, nullable: true },
            { ref: 'patient_id', type: 'fk', references: 'patients', nullable: true },
            { ref: 'appointment_id', type: 'fk', references: 'appointments', nullable: true },
            { ref: 'sent_at', type: 'timestamptz', nullable: true },
            { ref: 'error', type: 'text', maxLength: 200, nullable: true },
          ],
        },
      ],
    },
    outbox: {
      table: 'messages',
      columns: { kind: 'kind', status: 'status', to: 'to_address', sentAt: 'sent_at', error: 'error' },
      links: { patient: 'patient_id', appointment: 'appointment_id' },
      recipient: { via: 'patient_id', table: 'patients', email: 'email', name: 'name' },
      kinds: opts.dropReminder === true ? { confirmation: 'pos-confirmation' } : { confirmation: 'pos-confirmation', reminder: 'pos-reminder' },
      producers: [{ kind: 'confirmation', link: 'appointment_id', onCreate: { table: 'appointments' } }],
    },
    emailTemplates: [
      template('pos-confirmation', opts.subject ?? 'You are booked'),
      ...(opts.dropReminder === true ? [] : [template('pos-reminder', 'See you tomorrow')]),
    ],
  };
}

/** The app's emails: stored with real names, its templates the operator may edit and keep, taken back at uninstall. */
async function installEmails(h: Harness): Promise<void> {
  // A template of the app's name the operator already made is theirs.
  await emailTemplatesRepo(h.meta).upsert('pos-reminder', 'de_DE', { name: 'Mine', subject: 'Mine', blocks: [{ id: 'a', block: 'email.text', data: { text: 'mine' } }], enabled: true });
  // A block the renderer cannot draw stops the install before anything is made.
  await stageManifest(h, outboxManifest('1.0.0', { block: 'email.hologram' }));
  const refused = await post(h, '/apps/plan');
  expect(refused.json().plan.problems.map((p: { code: string }) => p.code)).toContain('EMAIL_TEMPLATE_INVALID');

  await stageManifest(h, outboxManifest('1.0.0'));
  const installed = await post(h, '/apps/install');
  expect(installed.statusCode, installed.body).toBe(200);
  expect(installed.json().outbox).toEqual({
    defined: true,
    templates: {
      written: ['pos-confirmation/en_US', 'pos-confirmation/de_DE', 'pos-reminder/en_US'],
      kept: [],
      skipped: [{ key: 'pos-reminder', locale: 'de_DE', reason: 'An email template of this name and language is not this app’s.' }],
      removed: 0,
    },
  });
  // Stored with the real tables' ids, as the producers and the sender will read it.
  const stored = JSON.parse((await appOutboxesRepo(h.meta).findByApp('pos'))!.definition) as { table: string; recipient: { table: string }; producers: { onCreate: { table: string } }[] };
  expect([stored.table, stored.recipient.table, stored.producers[0]!.onCreate.table].map((t) => t.split('.').pop())).toEqual([
    'pos_messages',
    'pos_patients',
    'pos_appointments',
  ]);
  const templates = emailTemplatesRepo(h.meta);
  const confirmation = (await templates.findByKeyLocale('pos-confirmation', 'en_US'))!;
  expect(confirmation).toMatchObject({ managedBy: 'pos', subject: 'You are booked', name: 'Confirmation' });
  expect((await templates.findByKeyLocale('pos-confirmation', 'de_DE'))!.name).toBe('Bestätigung');

  // The operator rewrites the German one; an update then brings the English one up to date and leaves hers.
  const german = (await templates.findByKeyLocale('pos-confirmation', 'de_DE'))!;
  await templates.upsert('pos-confirmation', 'de_DE', { name: german.name, subject: 'Ihr Termin', blocks: german.blocks, enabled: true });
  await stageManifest(h, outboxManifest('1.1.0', { subject: 'Your visit is booked', dropReminder: true }));
  const updated = await h.app.inject({ method: 'POST', url: '/apps/pos/update' });
  expect(updated.statusCode, updated.body).toBe(200);
  expect(updated.json().app.outbox.templates).toMatchObject({ written: ['pos-confirmation/en_US'], kept: ['pos-confirmation/de_DE'], removed: 1 });
  expect((await templates.findByKeyLocale('pos-confirmation', 'en_US'))!.subject).toBe('Your visit is booked');
  expect((await templates.findByKeyLocale('pos-confirmation', 'de_DE'))!.subject).toBe('Ihr Termin');
  expect(await templates.findByKeyLocale('pos-reminder', 'en_US')).toBeNull();
  expect((await templates.findByKeyLocale('pos-reminder', 'de_DE'))!.subject).toBe('Mine');

  // Uninstalled: the definition and the unedited template go; hers and the operator's own stay.
  const gone = await h.app.inject({ method: 'DELETE', url: '/apps/pos' });
  expect(gone.statusCode, gone.body).toBe(200);
  expect(gone.json().removed.emails).toBe(1);
  expect(await appOutboxesRepo(h.meta).findByApp('pos')).toBeNull();
  expect(await templates.findByKeyLocale('pos-confirmation', 'en_US')).toBeNull();
  expect((await templates.findByKeyLocale('pos-confirmation', 'de_DE'))!.subject).toBe('Ihr Termin');
  expect((await templates.findByKeyLocale('pos-reminder', 'de_DE'))!.subject).toBe('Mine');
}

/** The patients app open to each patient, whose outbox names the practice's settings row: the name its emails are signed with and the number to ring. */
function contactManifest() {
  const base = outboxManifest('1.0.0');
  const id = { ref: 'id', type: 'int', role: 'pk' };
  const settings = { ref: 'settings', columns: [id, { ref: 'practice_name', type: 'text', maxLength: 80, nullable: true }, { ref: 'phone', type: 'text', maxLength: 30, nullable: true }] };
  return {
    ...base,
    publicAccess: patientsManifest().publicAccess,
    requiredSchema: { ...base.requiredSchema, tables: [...base.requiredSchema.tables, settings] },
    outbox: { ...base.outbox, settings: { table: 'settings', name: 'practice_name', phone: 'phone' } },
  };
}

/** A found session raised to verified by an emailed code, the guards around it, and a change of address. */
async function verifyByCode(h: Harness): Promise<void> {
  await stageManifest(h, contactManifest());
  const installed = await post(h, '/apps/install');
  expect(installed.statusCode, installed.body).toBe(200);
  const served = await servePublic(h, (installed.json().publicAccess as { keyId: string }).keyId);
  const { call, post: send, codeOf } = served;
  const mailOn = () =>
    settingsRepo(h.meta).set('email.smtp', {
      host: 'localhost',
      port: 587,
      user: 'postmaster',
      passEncrypted: encryptSecret('hunter2', emailSecretKey(TEST_SECRET)),
      from: 'Clinic <no-reply@clinic.test>',
      secure: false,
    } as never);
  /** Every email queued so far: who it went to, its template and its text. */
  const mail = async () =>
    (await h.meta.db.selectFrom('adminium_jobs').selectAll().where('kind', '=', 'email.send').orderBy('createdAt').execute()).map((job) => {
      const payload = (typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload) as { templateKey: string; envelope: string };
      const envelope = JSON.parse(decryptSecret(payload.envelope, emailEnvelopeKey(TEST_SECRET))) as { to: string; subject: string; text: string };
      return { template: payload.templateKey, to: envelope.to, subject: envelope.subject, text: envelope.text };
    });
  const lastCode = async () => /\b(\d{6})\b/.exec((await mail()).filter((m) => m.template === 'sign-in-code').at(-1)!.subject)![1]!;
  const claim = async (mobile: string, born: string) => {
    const res = await send('/claim', { match: { mobile, born_on: born } });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: { session: string } }).data.session;
  };
  const tick = (ms: number) => vi.setSystemTime(new Date(Date.now() + ms));
  try {
    await h.run(`insert into pos_patients (name, mobile, born_on, email) values ('Ada', '07700900001', '1980-01-01', 'ada@example.com')`);
    await h.run(`insert into pos_patients (name, mobile, born_on, email) values ('Ben', '07700900002', '1981-02-02', 'ben@gmail.com')`);
    await h.run(`insert into pos_patients (name, mobile, born_on) values ('Cy', '07700900003', '1982-03-03')`);
    await h.run(`insert into pos_settings (practice_name, phone) values ('Hill Surgery', '0117 496 0142')`);

    // No mail set up: no code is pretended, and none is left open.
    const ada = await claim('07700900001', '1980-01-01');
    const unavailable = await send('/claim/code', { purpose: 'verify' }, ada);
    expect(unavailable.statusCode, unavailable.body).toBe(503);
    expect(codeOf(unavailable)).toBe('PUBLIC_CODE_UNAVAILABLE');
    expect(codeOf(await send('/claim/verify', { code: '000000' }, ada))).toBe('PUBLIC_CODE_EXPIRED');

    await mailOn();
    tick(31_000);
    // Sent to the address on her row, shown masked; a big provider's domain is shown whole.
    const sent = await send('/claim/code', { purpose: 'verify' }, ada);
    expect(sent.statusCode, sent.body).toBe(200);
    expect((sent.json() as { data: { sentTo: string; resendAfter: number } }).data).toMatchObject({ sentTo: 'a•••@e•••.com', resendAfter: 30 });
    expect((await mail()).at(-1)).toMatchObject({ template: 'sign-in-code', to: 'ada@example.com' });
    // Not again for thirty seconds.
    expect(codeOf(await send('/claim/code', { purpose: 'verify' }, ada))).toBe('PUBLIC_CODE_TOO_SOON');
    const wrong = await send('/claim/verify', { code: '999999' === (await lastCode()) ? '999998' : '999999' }, ada);
    expect(wrong.statusCode).toBe(403);
    expect((wrong.json() as { error: { params: { triesLeft: number } } }).error.params.triesLeft).toBe(4);
    const right = await send('/claim/verify', { code: await lastCode() }, ada);
    expect(right.statusCode, right.body).toBe(200);
    expect((right.json() as { data: { level: string } }).data.level).toBe('verified');
    expect((await call('GET', '/records/pos_patients_verified', ada)).statusCode).toBe(200);
    // A used code is used.
    expect(codeOf(await send('/claim/verify', { code: await lastCode() }, ada))).toBe('PUBLIC_CODE_EXPIRED');

    // No address on file: said so, nothing sent.
    const cy = await claim('07700900003', '1982-03-03');
    expect(codeOf(await send('/claim/code', { purpose: 'verify' }, cy))).toBe('PUBLIC_CLAIM_NO_EMAIL');

    // Guesses sent all at once are each charged before they are compared: five tries, then nothing.
    const ben = await claim('07700900002', '1981-02-02');
    expect((await send('/claim/code', { purpose: 'verify' }, ben)).json()).toMatchObject({ data: { sentTo: 'b•••@gmail.com' } });
    const benCode = await lastCode();
    const guesses = Array.from({ length: 8 }, (_, i) => String((Number(benCode) + 1 + i) % 1_000_000).padStart(6, '0'));
    const answers = await Promise.all(guesses.map((code) => send('/claim/verify', { code }, ben)));
    expect(answers.filter((a) => codeOf(a) === 'PUBLIC_CODE_WRONG')).toHaveLength(5);
    expect(answers.filter((a) => codeOf(a) === 'PUBLIC_CODE_EXPIRED')).toHaveLength(3);
    // The code died with its fifth wrong try: the right one opens nothing, and the session waits.
    expect(codeOf(await send('/claim/verify', { code: benCode }, ben))).toBe('PUBLIC_CODE_EXPIRED');
    // (A minute on: ten code requests a minute per session is its own limit.)
    tick(61_000);
    expect(codeOf(await send('/claim/code', { purpose: 'verify' }, ben))).toBe('PUBLIC_CODE_LOCKED');
    // Another session is another five tries — until ten wrong ones in a day lock Ben out, whoever asks.
    const again = await claim('07700900002', '1981-02-02');
    await send('/claim/code', { purpose: 'verify' }, again);
    for (let i = 0; i < 5; i += 1) await send('/claim/verify', { code: String((Number(await lastCode()) + 1 + i) % 1_000_000).padStart(6, '0') }, again);
    tick(31_000);
    const third = await claim('07700900002', '1981-02-02');
    expect(codeOf(await send('/claim/code', { purpose: 'verify' }, third))).toBe('PUBLIC_CLAIM_LOCKED');
    // The desk sees the lock on Ben's record, and lifts it.
    const desk = await usersRepo(h.meta).create({ email: 'desk@clinic.dev', name: 'Desk', passwordHash: await adminPasswordHash() });
    await rolesRepo(h.meta).assignToUser(desk.id, (await rolesRepo(h.meta).findBySlug('super-admin'))!.id);
    const login = await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'desk@clinic.dev', password: ADMIN_PASSWORD } });
    const cookie = sessionCookie(login.headers['set-cookie']);
    const patients = (await createPublicViews(h.meta).viewFor(h.connectionId))!.model.tables.find((t) => t.name === 'pos_patients')!.id;
    const lockUrl = (id: number) => `/api/v1/data/${h.connectionId}/${encodeURIComponent(patients)}/${String(id)}/claim-lock`;
    const lockOf = async (id: number) => (await served.composed.app.inject({ method: 'GET', url: lockUrl(id), headers: { cookie } })).json() as { locked: boolean; failures: number };
    expect(await lockOf(2)).toEqual({ locked: true, failures: 10 });
    expect((await lockOf(1)).locked).toBe(false);
    const lifted = await served.composed.app.inject({ method: 'DELETE', url: lockUrl(2), headers: { cookie } });
    expect(lifted.statusCode, lifted.body).toBe(200);
    expect((lifted.json() as { cleared: number }).cleared).toBeGreaterThan(0);
    expect(await lockOf(2)).toEqual({ locked: false, failures: 0 });
    expect((await send('/claim/code', { purpose: 'verify' }, third)).statusCode).toBe(200);

    // A new address: from a session verified moments ago, confirmed at the NEW address; the old one is told.
    tick(31_000);
    const change = await send('/claim/code', { purpose: 'email-change', email: 'ada.new@example.org' }, ada);
    expect(change.statusCode, change.body).toBe(200);
    expect((await mail()).at(-1)).toMatchObject({ template: 'sign-in-code', to: 'ada.new@example.org' });
    const changed = await send('/claim/verify', { purpose: 'email-change', code: await lastCode() }, ada);
    expect(changed.statusCode, changed.body).toBe(200);
    expect((await h.rows("select email from pos_patients where name = 'Ada'"))[0]!['email']).toBe('ada.new@example.org');
    // Told by the practice, with the number on its settings row to ring.
    const told = (await mail()).at(-1)!;
    expect(told).toMatchObject({ template: 'email-changed', to: 'ada@example.com', subject: 'Your email address at Hill Surgery was changed' });
    expect(told.text).toContain('If this wasn’t you, ring us on 0117 496 0142.');
    expect(told.text).not.toContain('contact us');
    expect(told.text).not.toContain('{{');
    // Every session of hers ended; found again, the address cannot change twice in a day.
    expect((await call('GET', '/records/pos_patients_claimed', ada)).statusCode).toBe(404);
    const back = await claim('07700900001', '1980-01-01');
    // Three codes to Ada in fifteen minutes is all a stranger could make her get: a fourth is held, silently.
    const held = await send('/claim/code', { purpose: 'verify' }, back);
    expect(held.statusCode, held.body).toBe(200);
    expect((await mail()).at(-1)!.template).toBe('email-changed');
    tick(15 * 60_000);
    await send('/claim/code', { purpose: 'verify' }, back);
    await send('/claim/verify', { code: await lastCode() }, back);
    tick(31_000);
    expect(codeOf(await send('/claim/code', { purpose: 'email-change', email: 'ada.third@example.org' }, back))).toBe('PUBLIC_EMAIL_CHANGE_LIMIT');
    // …nor from a session verified long enough ago.
    const bens = await claim('07700900002', '1981-02-02');
    tick(31_000);
    await send('/claim/code', { purpose: 'verify' }, bens);
    await send('/claim/verify', { code: await lastCode() }, bens);
    tick(11 * 60_000);
    expect(codeOf(await send('/claim/code', { purpose: 'email-change', email: 'ben@example.org' }, bens))).toBe('PUBLIC_CODE_STEP_UP');

    // No number on the settings row: the old address is told to get in touch, as it always was.
    await h.run(`update pos_settings set phone = null`);
    await send('/claim/code', { purpose: 'verify' }, bens);
    await send('/claim/verify', { code: await lastCode() }, bens);
    tick(31_000);
    expect((await send('/claim/code', { purpose: 'email-change', email: 'ben@example.org' }, bens)).statusCode).toBe(200);
    const benChanged = await send('/claim/verify', { purpose: 'email-change', code: await lastCode() }, bens);
    expect(benChanged.statusCode, benChanged.body).toBe(200);
    const plain = (await mail()).at(-1)!;
    expect(plain).toMatchObject({ template: 'email-changed', to: 'ben@gmail.com' });
    expect(plain.text).toContain('If this wasn’t you, contact us straight away.');
    expect(plain.text).not.toContain('ring us');
    expect(plain.text).not.toContain('{{');
  } finally {
    await served.composed.app.close();
  }
}

/** Sample visits whose statuses follow the adding clock, on working days, with their money settled. */
async function sampleByClock(h: Harness): Promise<void> {
  const day0 = (time: string) => ({ '@day': 0, '@time': time, '@workdays': true });
  const clock = { at: 'starts_at', before: { status: 'seen' }, around: { status: 'checked_in' }, after: { status: 'booked' } };
  // A payment exists only for a visit already over.
  const paidIf = (time: string) => ({ at: day0(time), before: {}, around: { '@skip': true }, after: { '@skip': true } });
  const bundle = {
    format: 'adminium.sample/1',
    app: 'pos',
    tables: [
      { ref: 'booking_settings', rows: [{ slot_minutes: 15, booking_days: 5, notice_minutes: 0, cancel_hours: 24 }] },
      { ref: 'clinicians', rows: [{ '@label': 'ada', name: 'Ada', position: 1 }] },
      { ref: 'visit_types', rows: [{ '@label': 'routine', name: 'Routine', minutes: 15, fee: 40 }] },
      {
        ref: 'visits',
        rows: [
          { '@label': 'v9', clinician_id: { '@ref': 'ada' }, visit_type_id: { '@ref': 'routine' }, starts_at: day0('09:00'), '@byClock': clock },
          { '@label': 'v10', clinician_id: { '@ref': 'ada' }, visit_type_id: { '@ref': 'routine' }, starts_at: day0('10:00'), '@byClock': clock },
          { '@label': 'v15', clinician_id: { '@ref': 'ada' }, visit_type_id: { '@ref': 'routine' }, starts_at: day0('15:00'), '@byClock': clock },
        ],
      },
      {
        ref: 'payments',
        rows: [
          { visit_id: { '@ref': 'v9' }, amount: 40, '@byClock': paidIf('09:00') },
          { visit_id: { '@ref': 'v15' }, amount: 40, '@byClock': paidIf('15:00') },
        ],
      },
      { ref: 'closures', rows: [{ from_date: { '@day': 1, '@workdays': true }, to_date: { '@day': 1, '@workdays': true } }] },
    ],
  };
  await stageManifest(h, { ...moneyManifest(), sampleData: { file: 'seeds/pos.sample.json' } }, { 'seeds/pos.sample.json': JSON.stringify(bundle) });
  expect((await post(h, '/apps/install')).statusCode).toBe(200);
  await h.meta.db.updateTable('adminium_connections').set({ timezone: 'Europe/London' }).execute();
  const service = createSampleDataService(sampleDeps(h.meta, h.manager, createAppStore({ dataDir: h.dataDir })));
  const app = (await findSampleApp(h.meta, 'pos'))!;
  const visits = async () =>
    (await h.rows('SELECT starts_at, status, paid, balance FROM pos_visits ORDER BY starts_at')).map((r) => ({
      at: slotInstantOf(r['starts_at']),
      status: r['status'],
      paid: Number(r['paid']),
      balance: Number(r['balance']),
    }));
  const closure = async () => {
    const [row] = await h.rows('SELECT from_date FROM pos_closures');
    const value = row!['from_date'];
    return value instanceof Date ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}` : String(value).slice(0, 10);
  };

  // Tuesday 28 July 2026, 10:05 in London: 09:00 is over, 10:00 is now, 15:00 is to come.
  const added = await service.add(app, { locale: 'en-US', userId: null, userLabel: 'test', now: Date.UTC(2026, 6, 28, 9, 5) });
  // The 15:00 payment was left out: that visit has not happened yet.
  expect(added.counts).toMatchObject({ visits: 3, payments: 1, closures: 1 });
  expect(await visits()).toEqual([
    { at: '2026-07-28T08:00:00.000Z', status: 'seen', paid: 40, balance: 0 },
    { at: '2026-07-28T09:00:00.000Z', status: 'checked_in', paid: 0, balance: 40 },
    { at: '2026-07-28T14:00:00.000Z', status: 'booked', paid: 0, balance: 40 },
  ]);
  // A date is the venue's day: tomorrow, a working day.
  expect(await closure()).toBe('2026-07-29');
  // Settled totals are how the rows were written, not an edit: removal takes everything.
  const plan = (await h.app.inject({ method: 'POST', url: '/apps/pos/sample-data/remove-plan' })).json();
  expect(plan.changed).toEqual([]);
  const removed = await h.app.inject({ method: 'POST', url: '/apps/pos/sample-data/remove', payload: { keepChanged: false } });
  expect(removed.statusCode, removed.body).toBe(200);
  expect((await h.rows('SELECT id FROM pos_visits')).length).toBe(0);

  // Added on a Saturday, "today" is Monday and tomorrow Tuesday; nothing has happened yet.
  await service.add(app, { locale: 'en-US', userId: null, userLabel: 'test', now: Date.UTC(2026, 7, 1, 9, 5) });
  expect((await visits()).map((v) => [v.at, v.status])).toEqual([
    ['2026-08-03T08:00:00.000Z', 'booked'],
    ['2026-08-03T09:00:00.000Z', 'booked'],
    ['2026-08-03T14:00:00.000Z', 'booked'],
  ]);
  expect(await closure()).toBe('2026-08-04');
  expect((await h.rows('SELECT id FROM pos_payments')).length).toBe(0);
}

/** The human check: a session-less booking and every claim carry a proof, spent once; a found person's booking does not. */
async function proveAPerson(h: Harness): Promise<void> {
  await stageManifest(h, patientsManifest({ proofs: true }));
  const installed = await post(h, '/apps/install');
  expect(installed.statusCode, installed.body).toBe(200);
  const served = await servePublic(h, (installed.json().publicAccess as { keyId: string }).keyId);
  const { post: send, codeOf, headers } = served;
  const app = served.composed.app;
  try {
    await h.run(`insert into pos_patients (name, mobile, born_on, email) values ('Ada', '07700900001', '1980-01-01', 'ada@example.com')`);
    const proof = async (purpose: 'write' | 'claim') => {
      const res = await app.inject({ method: 'GET', url: `/api/v1/public/challenge?purpose=${purpose}`, headers: headers() });
      expect(res.statusCode, res.body).toBe(200);
      const { id, salt, difficulty } = (res.json() as { data: { id: string; salt: string; difficulty: number } }).data;
      return { 'x-adminium-proof': `${id}.${solveProof(salt, difficulty)}` };
    };
    // A browser may send the header.
    const preflight = await app.inject({ method: 'OPTIONS', url: '/api/v1/public/records/pos_appointments_claimed', headers: { origin: 'https://clinic.example.com', 'access-control-request-method': 'POST' } });
    expect(String(preflight.headers['access-control-allow-headers'])).toContain('x-adminium-proof');

    const visit = { starts_at: '2099-02-01T10:00:00Z', new_name: 'Cara' };
    const bare = await send('/records/pos_appointments_claimed', { values: visit });
    expect(bare.statusCode, bare.body).toBe(403);
    expect(codeOf(bare)).toBe('PUBLIC_PROOF_REQUIRED');
    // A proof for a claim is not one for a write.
    expect(codeOf(await send('/records/pos_appointments_claimed', { values: visit }, undefined, await proof('claim')))).toBe('PUBLIC_PROOF_REQUIRED');
    const good = await proof('write');
    expect((await send('/records/pos_appointments_claimed', { values: visit }, undefined, good)).statusCode).toBe(201);
    // Spent: the same proof buys nothing twice.
    expect(codeOf(await send('/records/pos_appointments_claimed', { values: visit }, undefined, good))).toBe('PUBLIC_PROOF_REQUIRED');

    // Every claim start carries one.
    const match = { match: { mobile: '07700900001', born_on: '1980-01-01' } };
    expect(codeOf(await send('/claim', match))).toBe('PUBLIC_PROOF_REQUIRED');
    const claimed = await send('/claim', match, undefined, await proof('claim'));
    expect(claimed.statusCode, claimed.body).toBe(200);
    const session = (claimed.json() as { data: { session: string } }).data.session;
    // A found person's booking is theirs, and capped: no second proof.
    const mine = await send('/records/pos_appointments_claimed', { values: { starts_at: '2099-03-01T10:00:00Z' } }, session);
    expect(mine.statusCode, mine.body).toBe(201);
    expect(Number((await h.rows('select count(*) as n from pos_appointments where patient_id = 1'))[0]!['n'])).toBe(1);
  } finally {
    await served.composed.app.close();
  }
}

/** The patients app with producers: a confirmation, a cancellation behind the switch, reminders at each person's hour, and a stranger's caps. */
function producersManifest() {
  const base = outboxManifest('1.0.0');
  const id = { ref: 'id', type: 'int', role: 'pk' };
  const extra: Record<string, Record<string, unknown>[]> = {
    patients: [
      { ref: 'language', type: 'text', maxLength: 10, nullable: true },
      { ref: 'lead_hours', type: 'int', nullable: true },
    ],
    appointments: [
      { ref: 'new_email', type: 'text', maxLength: 80, nullable: true, rules: { validation: { format: 'email' } } },
      { ref: 'new_mobile', type: 'text', maxLength: 20, nullable: true },
    ],
    messages: [
      { ref: 'language', type: 'text', maxLength: 10, nullable: true },
      { ref: 'due_at', type: 'timestamptz', nullable: true },
    ],
  };
  const tables = base.requiredSchema.tables.map((table) => {
    const t = table as { ref: string; columns: Record<string, unknown>[] };
    const columns = t.columns.map((c) => (t.ref === 'messages' && c['ref'] === 'kind' ? { ...c, enum: ['confirmation', 'cancelled', 'reminder'] } : c));
    return { ...t, columns: [...columns, ...(extra[t.ref] ?? [])] };
  });
  const template = (key: string) => ({ key, name: 'Email', locales: { 'en-US': { subject: key, blocks: [{ block: 'email.text', data: { text: 'Hello' } }] } } });
  const publicAccess = patientsManifest().publicAccess.map((entry) =>
    entry.table === 'appointments' && entry.methods.includes('POST')
      ? {
          ...entry,
          writable: ['starts_at', 'new_name', 'new_email', 'new_mobile'],
          onClaim: { clear: ['new_name', 'new_email', 'new_mobile', 'check_status'] },
          anonymous: { perValue: { columns: ['new_mobile', 'new_email'], n: 2 }, perKeyHour: 5, plainText: ['new_name'] },
        }
      : entry,
  );
  return {
    ...base,
    publicAccess,
    sampleData: { file: 'seeds/pos.sample.json' },
    requiredSchema: {
      ...base.requiredSchema,
      tables: [...tables, { ref: 'settings', columns: [id, { ref: 'emails_on', type: 'bool', default: true }, { ref: 'lead_default', type: 'int', default: 24 }] }],
    },
    outbox: {
      ...base.outbox,
      columns: { ...base.outbox.columns, language: 'language', due: 'due_at' },
      recipient: { ...base.outbox.recipient, language: 'language', optIn: 'remind', fallback: { via: 'appointment_id', email: 'new_email' } },
      settings: { table: 'settings', enabled: 'emails_on' },
      kinds: { confirmation: 'pos-confirmation', cancelled: 'pos-cancelled', reminder: 'pos-reminder' },
      producers: [
        { kind: 'confirmation', link: 'appointment_id', onCreate: { table: 'appointments', where: { column: 'status', eq: 'booked' } } },
        { kind: 'cancelled', link: 'appointment_id', gate: 'enabled', onChange: { table: 'appointments', column: 'status', to: 'cancelled' } },
        {
          kind: 'reminder',
          link: 'appointment_id',
          optIn: true,
          before: {
            table: 'appointments',
            at: 'starts_at',
            lead: { via: 'patient_id', table: 'patients', column: 'lead_hours', fallback: { table: 'settings', column: 'lead_default' }, max: 48 },
            where: { column: 'status', eq: 'booked' },
          },
        },
      ],
    },
    emailTemplates: [template('pos-confirmation'), template('pos-cancelled'), template('pos-reminder')],
  };
}

/** What queues an app's emails: its writes (whoever makes them), a minute's scan for reminders, once each — and never for a sample visit or a stranger's flood. */
async function produceEmails(h: Harness, dialect: Dialect): Promise<void> {
  const bundle = {
    format: 'adminium.sample/1',
    app: 'pos',
    tables: [
      { ref: 'patients', rows: [{ '@label': 'sam', name: 'Sam', mobile: '07700900777', born_on: '1970-01-01', email: 'sam@example.com', remind: true, lead_hours: 48 }] },
      { ref: 'appointments', rows: [{ patient_id: { '@ref': 'sam' }, starts_at: { '@day': 1, '@time': '10:00' }, status: 'booked' }] },
    ],
  };
  await stageManifest(h, producersManifest(), { 'seeds/pos.sample.json': JSON.stringify(bundle) });
  const installed = await post(h, '/apps/install');
  expect(installed.statusCode, installed.body).toBe(200);
  expect(installed.json().rules.skipped).toEqual([]);
  const service = createSampleDataService(sampleDeps(h.meta, h.manager, createAppStore({ dataDir: h.dataDir })));
  await service.add((await findSampleApp(h.meta, 'pos'))!, { locale: 'en-US', userId: null, userLabel: 'test', now: Date.now() });

  const served = await servePublic(h, (installed.json().publicAccess as { keyId: string }).keyId);
  const app = served.composed.app;
  const outbox = app.outbox as OutboxProducers;
  const { call, codeOf, headers } = served;
  const bool = (on: boolean) => (dialect === 'postgres' ? String(on) : on ? '1' : '0');
  // An instant as each engine keeps one written through Adminium.
  const at = (ms: number) =>
    dialect === 'sqlite'
      ? `'${String(normalizeWriteValue({ logicalType: 'timestamp' } as never, new Date(ms).toISOString()))}'`
      : `'${new Date(ms).toISOString().slice(0, 19).replace('T', ' ')}+00:00'`;
  const messages = async (where = '1 = 1') =>
    (await h.rows(`select kind, status, to_address, language, patient_id, appointment_id, due_at, error from pos_messages where ${where} order by id`)).map((r) => ({
      kind: r['kind'],
      status: r['status'],
      to: r['to_address'] ?? null,
      language: r['language'] ?? null,
      patient: r['patient_id'] === null ? null : Number(r['patient_id']),
      appointment: r['appointment_id'] === null ? null : Number(r['appointment_id']),
      due: r['due_at'] === null ? null : slotInstantOf(r['due_at']),
      error: r['error'] ?? null,
    }));
  const idOf = async (statement: string) => Number((await h.rows(statement))[0]!['id']);
  const created = (res: { json: () => unknown }) => Number((res.json() as { data: { id: unknown } }).data.id);
  try {
    await h.run(`insert into pos_settings (emails_on, lead_default) values (${bool(true)}, 24)`);
    await h.run(`insert into pos_patients (name, mobile, born_on, email, remind, language, lead_hours) values ('Ada', '07700900001', '1980-01-01', 'ada@example.com', ${bool(true)}, 'de', 2)`);
    await h.run(`insert into pos_patients (name, mobile, born_on, email, remind) values ('Ben', '07700900002', '1981-02-02', null, ${bool(true)})`);
    await h.run(`insert into pos_patients (name, mobile, born_on, email, remind) values ('Cy', '07700900003', '1982-03-03', 'cy@example.com', ${bool(false)})`);
    await h.run(`insert into pos_patients (name, mobile, born_on, email, remind) values ('Dee', '07700900004', '1983-04-04', 'dee@example.com', ${bool(true)})`);
    const ada = await idOf(`select id from pos_patients where name = 'Ada'`);
    const ben = await idOf(`select id from pos_patients where name = 'Ben'`);
    const cy = await idOf(`select id from pos_patients where name = 'Cy'`);
    const dee = await idOf(`select id from pos_patients where name = 'Dee'`);
    const sam = await idOf(`select id from pos_patients where name = 'Sam'`);
    // Sample data makes no mail of its own.
    expect(await messages()).toEqual([]);

    // A stranger's first visit: the confirmation goes to the address on the visit itself.
    const visit = (mobile: string, email: string, extra: Record<string, unknown> = {}) => ({ starts_at: '2099-02-01T10:00:00Z', new_name: 'Cara O’Neil', new_mobile: mobile, new_email: email, ...extra });
    const first = await call('POST', '/records/pos_appointments_claimed', undefined, visit('07700 900123', 'cara@example.com'));
    expect(first.statusCode, first.body).toBe(201);
    expect(await messages(`appointment_id = ${created(first)}`)).toEqual([
      { kind: 'confirmation', status: 'queued', to: 'cara@example.com', language: null, patient: null, appointment: created(first), due: null, error: null },
    ]);
    // The same number spelled another way is the same person: two a day, then no more.
    expect((await call('POST', '/records/pos_appointments_claimed', undefined, visit('+44 7700 900123', 'Cara@Example.com'))).statusCode).toBe(201);
    const third = await call('POST', '/records/pos_appointments_claimed', undefined, visit('07700900123', 'other@example.com'));
    expect(third.statusCode, third.body).toBe(409);
    expect(codeOf(third)).toBe('PUBLIC_LIMIT_REACHED');
    // A name is only a name.
    const linked = await call('POST', '/records/pos_appointments_claimed', undefined, visit('07700 900888', 'x@example.com', { new_name: 'Deals at www.example.com' }));
    expect(linked.statusCode, linked.body).toBe(400);
    expect((linked.json() as { error: { params?: unknown } }).error.params).toEqual({ column: 'new_name' });
    // A booking that fails for another reason is not counted against the person.
    expect((await call('POST', '/records/pos_appointments_claimed', undefined, visit('07700 900999', 'not an address'))).statusCode).toBe(400);
    expect((await call('POST', '/records/pos_appointments_claimed', undefined, visit('07700 900999', 'dan@example.com'))).statusCode).toBe(201);
    expect((await call('POST', '/records/pos_appointments_claimed', undefined, visit('07700 900999', 'dan@example.com'))).statusCode).toBe(201);
    // Five strangers' bookings an hour through the key, however many people.
    expect((await call('POST', '/records/pos_appointments_claimed', undefined, visit('07700 900555', 'eve@example.com'))).statusCode).toBe(201);
    const flood = await call('POST', '/records/pos_appointments_claimed', undefined, visit('07700 900444', 'fay@example.com'));
    expect(flood.statusCode, flood.body).toBe(409);
    expect((await messages(`kind = 'confirmation'`)).length).toBe(5);

    // A found person's booking goes to them, in their language; with no address it is logged, not dropped.
    const claim = async (mobile: string, born: string) => {
      const res = await app.inject({ method: 'POST', url: '/api/v1/public/claim', headers: headers(), payload: { match: { mobile, born_on: born } } });
      const session = (res.json() as { data: { session: string } }).data.session;
      const row = await publicSessionsRepo(h.meta).findValid(hashPublishableKey(session));
      await publicSessionsRepo(h.meta).raise(row!.id, 'verified', Date.now() + 30 * 60_000);
      return session;
    };
    const adaSession = await claim('07700900001', '1980-01-01');
    const benSession = await claim('07700900002', '1981-02-02');
    const adaVisit = created(await call('POST', '/records/pos_appointments_claimed', adaSession, { starts_at: '2099-03-01T10:00:00Z' }));
    const benVisit = created(await call('POST', '/records/pos_appointments_claimed', benSession, { starts_at: '2099-03-02T10:00:00Z' }));
    expect(await messages(`appointment_id in (${adaVisit}, ${benVisit})`)).toEqual([
      { kind: 'confirmation', status: 'queued', to: 'ada@example.com', language: 'de', patient: ada, appointment: adaVisit, due: null, error: null },
      { kind: 'confirmation', status: 'skipped', to: null, language: null, patient: ben, appointment: benVisit, due: null, error: 'No email on file' },
    ]);

    // Cancelled by the patient: "changed to" is seen on the public PATCH too.
    expect((await call('PATCH', `/records/pos_appointments_verified/${adaVisit}`, adaSession, { status: 'cancelled' })).statusCode).toBe(200);
    expect(await messages(`kind = 'cancelled'`)).toEqual([
      { kind: 'cancelled', status: 'queued', to: 'ada@example.com', language: 'de', patient: ada, appointment: adaVisit, due: null, error: null },
    ]);
    // With the practice's emails switched off, a cancellation queues nothing.
    await h.run(`update pos_settings set emails_on = ${bool(false)}`);
    expect((await call('PATCH', `/records/pos_appointments_verified/${benVisit}`, benSession, { status: 'cancelled' })).statusCode).toBe(200);
    expect((await messages(`kind = 'cancelled'`)).length).toBe(1);
    // With no settings row at all, the same: a switch nobody set is not on.
    await h.run('delete from pos_settings');
    const another = created(await call('POST', '/records/pos_appointments_claimed', adaSession, { starts_at: '2099-04-01T10:00:00Z' }));
    expect((await call('PATCH', `/records/pos_appointments_verified/${another}`, adaSession, { status: 'cancelled' })).statusCode).toBe(200);
    expect((await messages(`kind = 'cancelled'`)).length).toBe(1);
    await h.run(`insert into pos_settings (emails_on, lead_default) values (${bool(true)}, 24)`);
    // Reminders: each person's lead, or the practice's; never an opted-out one, never a cancelled visit.
    const now = Math.floor(Date.now() / 1000) * 1000;
    const book = async (patient: number, ms: number, status = 'booked') => {
      await h.run(`insert into pos_appointments (patient_id, starts_at, status) values (${patient}, ${at(ms)}, '${status}')`);
      return idOf(`select max(id) as id from pos_appointments`);
    };
    const HOUR = 3_600_000;
    const soon = await book(ada, now + HOUR);
    await book(ada, now + 5 * HOUR);
    await book(cy, now + HOUR);
    const deeVisit = await book(dee, now + 20 * HOUR);
    await book(dee, now + HOUR, 'cancelled');
    // Two servers scanning at once add each reminder once: the check and the insert share a lock.
    const [one, two] = await Promise.all([outbox.scan(now), outbox.scan(now)]);
    expect(one + two).toBe(2);
    expect(await messages(`kind = 'reminder'`)).toEqual([
      { kind: 'reminder', status: 'queued', to: 'ada@example.com', language: 'de', patient: ada, appointment: soon, due: new Date(now + HOUR).toISOString(), error: null },
      { kind: 'reminder', status: 'queued', to: 'dee@example.com', language: null, patient: dee, appointment: deeVisit, due: new Date(now + 20 * HOUR).toISOString(), error: null },
    ]);
    // A sample visit is never reminded of, though its patient asked for 48 hours.
    const samVisit = await idOf(`select id from pos_appointments where patient_id = ${sam}`);
    expect(await messages(`appointment_id = ${samVisit}`)).toEqual([]);
    // Once: the next minute's scan finds them already there.
    expect(await outbox.scan(now + 60_000)).toBe(0);
    // A visit moved is a new moment, and a new reminder.
    await h.run(`update pos_appointments set starts_at = ${at(now + 90 * 60_000)} where id = ${soon}`);
    expect(await outbox.scan(now + 60_000)).toBe(1);
    expect((await messages(`appointment_id = ${soon}`)).map((m) => m.due)).toEqual([new Date(now + HOUR).toISOString(), new Date(now + 90 * 60_000).toISOString()]);

    // Switched off, the app queues nothing; switched on, the reminder comes.
    const later = await book(ada, now + 100 * 60_000);
    expect((await h.app.inject({ method: 'POST', url: '/apps/pos/disable' })).statusCode).toBe(200);
    // (Another server's list refreshes on its own install routes; this one is told.)
    outbox.reset();
    expect(await outbox.scan(now)).toBe(0);
    expect((await h.app.inject({ method: 'POST', url: '/apps/pos/enable' })).statusCode).toBe(200);
    outbox.reset();
    expect(await outbox.scan(now)).toBe(1);
    expect((await messages(`appointment_id = ${later}`)).length).toBe(1);
  } finally {
    await app.close();
  }
}

/** The producers' app with a sender to read: a practice name and phone, a clinician, a fee, and templates full of variables. */
function senderManifest() {
  const { sampleData: _sample, ...base } = producersManifest();
  const tables = base.requiredSchema.tables.map((table) => {
    const t = table as { ref: string; columns: Record<string, unknown>[] };
    if (t.ref === 'settings') return { ...t, columns: [...t.columns, { ref: 'practice_name', type: 'text', maxLength: 80, nullable: true }, { ref: 'phone', type: 'text', maxLength: 30, nullable: true }] };
    if (t.ref === 'appointments') {
      return {
        ...t,
        columns: [
          ...t.columns,
          { ref: 'clinician_id', type: 'fk', references: 'clinicians', nullable: true },
          { ref: 'minutes', type: 'int', default: 15 },
          { ref: 'fee', type: 'money', nullable: true },
          { ref: 'reason', type: 'text', maxLength: 120, nullable: true },
          { ref: 'cancelled_at', type: 'timestamptz', nullable: true },
        ],
      };
    }
    return t;
  });
  const text = 'Hi {{recipient.first_name}}: {{appointment.starts_at.relative_day}}, {{appointment.time_range}}, with {{clinician.name}}. Fee {{appointment.fee}}. Call {{practice.phone}}. Manage: {{manage_url}}';
  // An optional value alone in its own blocks: gone when the visit has none. A name no row has stays loud.
  const blocks = [
    { block: 'email.text', data: { text } },
    { block: 'email.quote', data: { text: '{{appointment.reason}}' } },
    { block: 'email.list', data: { items: ['Why: {{appointment.reason}}', '{{appointment.reason}}', 'Ends {{appointment.cancelled_at.time}}Z'] } },
    { block: 'email.text', data: { paras: ['{{appointment.reason}}', 'Typo: {{appointment.nope}}'] } },
  ];
  const template = (key: string) => ({
    key,
    name: 'Email',
    locales: {
      'en-US': { subject: `Booked at {{appName}}`, blocks },
      'de-DE': { subject: `Gebucht bei {{appName}}`, blocks },
    },
  });
  return {
    ...base,
    requiredSchema: {
      ...base.requiredSchema,
      tables: [...tables.slice(0, 1), { ref: 'clinicians', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'name', type: 'text', maxLength: 40 }] }, ...tables.slice(1)],
    },
    outbox: { ...base.outbox, settings: { ...base.outbox.settings, name: 'practice_name' }, pages: { manage: '/my-visits' } },
    emailTemplates: [template('pos-confirmation'), template('pos-cancelled'), template('pos-reminder')],
  };
}

/** The sender: rendered in the row's language on the venue's clock, the log settled, never twice, and never to an example address. */
async function sendEmails(h: Harness, dialect: Dialect): Promise<void> {
  await stageManifest(h, senderManifest());
  const installed = await post(h, '/apps/install');
  expect(installed.statusCode, installed.body).toBe(200);
  expect(installed.json().rules.skipped).toEqual([]);
  await h.meta.db.updateTable('adminium_connections').set({ timezone: 'Europe/London', currency: 'GBP' }).execute();
  await settingsRepo(h.meta).set('surfaces.domains', { 'book.hill.dev': { appKey: 'pos', side: 'customer' } });
  const served = await servePublic(h, (installed.json().publicAccess as { keyId: string }).keyId);
  const app = served.composed.app;
  const outbox = app.outbox as OutboxProducers;
  const sender = app.outboxSender;
  await settingsRepo(h.meta).set('email.smtp', {
    host: 'localhost',
    port: 587,
    user: 'postmaster',
    passEncrypted: encryptSecret('hunter2', emailSecretKey(TEST_SECRET)),
    from: 'Clinic <no-reply@clinic.test>',
    secure: false,
  } as never);
  const mail = async () =>
    (await h.meta.db.selectFrom('adminium_jobs').selectAll().where('kind', '=', 'email.send').orderBy('createdAt').execute()).map((job) => {
      const payload = (typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload) as { templateKey: string; locale: string; envelope: string; report?: EmailSendReport };
      const envelope = JSON.parse(decryptSecret(payload.envelope, emailEnvelopeKey(TEST_SECRET))) as { to: string; subject: string; text: string };
      return { template: payload.templateKey, locale: payload.locale, to: envelope.to, subject: envelope.subject, text: envelope.text, report: payload.report };
    });
  const bool = (on: boolean) => (dialect === 'postgres' ? String(on) : on ? '1' : '0');
  const log = async () =>
    (await h.rows('select id, kind, status, sent_at, error from pos_messages order by id')).map((r) => ({ id: Number(r['id']), status: r['status'], sent: r['sent_at'] !== null, error: r['error'] ?? null }));
  const idOf = async (statement: string) => Number((await h.rows(statement))[0]!['id']);
  try {
    await h.run(`insert into pos_settings (emails_on, lead_default, practice_name, phone) values (${bool(true)}, 24, 'Hill Clinic', '020 7946 0000')`);
    await h.run(`insert into pos_clinicians (name) values ('Dr Rao')`);
    await h.run(`insert into pos_patients (name, mobile, born_on, email, remind, language) values ('Ada Lovelace', '07700900001', '1980-01-01', 'ada@hill.dev', ${bool(true)}, 'de')`);
    await h.run(`insert into pos_patients (name, mobile, born_on, email, remind) values ('Ben', '07700900002', '1981-02-02', 'ben@example.com', ${bool(true)})`);
    const ada = await idOf(`select id from pos_patients where name = 'Ada Lovelace'`);
    const ben = await idOf(`select id from pos_patients where name = 'Ben'`);
    const clinician = await idOf(`select id from pos_clinicians`);
    // Tomorrow at 10:00 in London.
    const now = Date.now();
    const tomorrow = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now + 86_400_000));
    const at = wallTimeToInstant(`${tomorrow}T10:00`, 'Europe/London')!;
    const spelled = dialect === 'sqlite' ? String(normalizeWriteValue({ logicalType: 'timestamp' } as never, at.toISOString())) : `${at.toISOString().slice(0, 19).replace('T', ' ')}+00:00`;
    for (const patient of [ada, ben]) {
      await h.run(`insert into pos_appointments (patient_id, starts_at, status, clinician_id, minutes, fee) values (${patient}, '${spelled}', 'booked', ${clinician}, 15, 40)`);
    }
    const [adaVisit, benVisit] = (await h.rows('select id from pos_appointments order by id')).map((r) => Number(r['id']));
    // The desk's "Send now": rows queued by hand.
    const queue = async (kind: string, to: string | null, patient: number, visit: number, language: string | null = null) => {
      await h.run(
        `insert into pos_messages (kind, status, to_address, patient_id, appointment_id, language) values ('${kind}', 'queued', ${to === null ? 'null' : `'${to}'`}, ${patient}, ${visit}, ${language === null ? 'null' : `'${language}'`})`,
      );
      return idOf('select max(id) as id from pos_messages');
    };
    const adaRow = await queue('confirmation', 'ada@hill.dev', ada, adaVisit!, 'de');
    const benRow = await queue('confirmation', 'ben@example.com', ben, benVisit!);
    const nobody = await queue('confirmation', null, ben, benVisit!);
    // A kind whose email the operator switched off.
    const off = (await emailTemplatesRepo(h.meta).findByKeyLocale('pos-cancelled', 'en_US'))!;
    await emailTemplatesRepo(h.meta).upsert('pos-cancelled', 'en_US', { name: off.name, subject: off.subject, blocks: off.blocks, enabled: false });
    const offRow = await queue('cancelled', 'ada@hill.dev', ada, adaVisit!, 'en');
    // One the operator gave an HTML block: what a stranger typed would go out unescaped in it.
    const reminder = (await emailTemplatesRepo(h.meta).findByKeyLocale('pos-reminder', 'en_US'))!;
    await emailTemplatesRepo(h.meta).upsert('pos-reminder', 'en_US', {
      name: reminder.name,
      subject: reminder.subject,
      blocks: [...reminder.blocks, { id: 'raw', block: 'email.html', data: { code: '<p>{{recipient.name}}</p>' } }],
      enabled: true,
    });
    const htmlRow = await queue('reminder', 'ada@hill.dev', ada, adaVisit!, 'en');

    // Two senders at once settle each row once.
    const [one, two] = await Promise.all([sender.sendApp('pos', now), sender.sendApp('pos', now)]);
    expect(one + two).toBe(5);
    expect(await log()).toEqual([
      { id: adaRow, status: 'sent', sent: true, error: null },
      { id: benRow, status: 'skipped', sent: false, error: 'A reserved address (for examples and tests)' },
      // No address on the row: the sender finds Ben's through the patient, and his is a reserved one.
      { id: nobody, status: 'skipped', sent: false, error: 'A reserved address (for examples and tests)' },
      { id: offRow, status: 'failed', sent: false, error: 'The email is switched off, or has no text' },
      { id: htmlRow, status: 'failed', sent: false, error: 'The email has an HTML block, which cannot carry what a person typed' },
    ]);
    // In her language, on the venue's clock, in the connection's currency, linking to the app's own host.
    const [message, ...others] = await mail();
    expect(others).toEqual([]);
    const tag = 'de-DE';
    const time = new Intl.DateTimeFormat(tag, { timeStyle: 'short', timeZone: 'Europe/London' });
    expect(message).toMatchObject({ template: 'pos-confirmation', locale: 'de_DE', to: 'ada@hill.dev', subject: 'Gebucht bei Hill Clinic' });
    expect(message!.report).toMatchObject({ app: 'pos', connectionId: h.connectionId });
    for (const piece of [
      'Hi Ada:',
      new Intl.RelativeTimeFormat(tag, { numeric: 'auto' }).format(1, 'day'),
      time.formatRange(at, new Date(at.getTime() + 15 * 60_000)),
      'with Dr Rao',
      new Intl.NumberFormat(tag, { style: 'currency', currency: 'GBP' }).format(40),
      'Call 020 7946 0000',
      'Manage: https://book.hill.dev/my-visits',
    ]) {
      expect(message!.text).toContain(piece);
    }
    // Her visit has no reason: the quote and the reason's own item and paragraph are left out,
    // a sentence around it keeps its words, and a name no row has is still printed as written.
    expect(message!.text).not.toContain('{{appointment.reason}}');
    expect(message!.text).not.toContain('{{appointment.cancelled_at');
    expect(message!.text).not.toContain('“”');
    expect(message!.text).toContain('• Why:\n');
    expect(message!.text).toContain('Ends Z');
    expect(message!.text).toContain('Typo: {{appointment.nope}}');

    // Undelivered for good: the row says so, and the desk may queue it again.
    await sender.markUndelivered(message!.report!, new Error('550 5.1.1 mailbox unavailable'));
    expect((await log()).find((row) => row.id === adaRow)).toEqual({ id: adaRow, status: 'failed', sent: true, error: 'Not delivered: 550 5.1.1 mailbox unavailable' });
    await h.run(`update pos_messages set status = 'queued' where id = ${adaRow}`);
    expect(await sender.sweep(now + 60_000)).toBe(1);
    expect((await mail()).length).toBe(2);
    // …and a late report of the first message no longer touches it.
    await sender.markUndelivered(message!.report!, new Error('late'));
    expect((await log()).find((row) => row.id === adaRow)!.status).toBe('sent');

    // Switched off, nothing goes; switched on, it does.
    const waiting = await queue('confirmation', 'ada@hill.dev', ada, adaVisit!);
    expect((await h.app.inject({ method: 'POST', url: '/apps/pos/disable' })).statusCode).toBe(200);
    outbox.reset();
    expect(await sender.sweep(now)).toBe(0);
    expect((await log()).find((row) => row.id === waiting)!.status).toBe('queued');
    expect((await h.app.inject({ method: 'POST', url: '/apps/pos/enable' })).statusCode).toBe(200);
    outbox.reset();
    expect(await sender.sweep(now)).toBe(1);

    // A row the producers queue asks for a send at once.
    const booked = await served.call('POST', '/records/pos_appointments_claimed', undefined, { starts_at: '2099-02-01T10:00:00Z', new_name: 'Dan', new_email: 'dan@hill.dev', new_mobile: '07700 900321' });
    expect(booked.statusCode, booked.body).toBe(201);
    const jobs = await h.meta.db.selectFrom('adminium_jobs').selectAll().where('kind', '=', 'app-outbox-send').execute();
    expect(jobs.map((job) => (typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload))).toEqual([{ app: 'pos' }]);

    // A person's sign-in code, through the app's own key, is signed with the practice's name.
    const claimed = await app.inject({ method: 'POST', url: '/api/v1/public/claim', headers: served.headers(), payload: { match: { mobile: '07700900001', born_on: '1980-01-01' } } });
    const session = (claimed.json() as { data: { session: string } }).data.session;
    expect((await served.post('/claim/code', { purpose: 'verify' }, session)).statusCode).toBe(200);
    expect((await mail()).at(-1)).toMatchObject({ template: 'sign-in-code', to: 'ada@hill.dev' });
    expect((await mail()).at(-1)!.subject).toContain('Hill Clinic');
  } finally {
    await app.close();
  }
}

/** The patients app with a waiting-room kiosk: a second key bound to a screens-only role and switched by the settings row. */
function kioskManifest(opts: { kiosk?: boolean; role?: string } = {}) {
  const base = patientsManifest();
  const id = { ref: 'id', type: 'int', role: 'pk' };
  const screen = (key: string) => ({ key, name: `Screen ${key}`, screensOnly: true, permissions: ['app:@:staff'] });
  const kiosk = opts.kiosk !== false;
  return {
    ...base,
    requiredSchema: {
      ...base.requiredSchema,
      tables: [
        ...base.requiredSchema.tables,
        {
          ref: 'settings',
          columns: [id, { ref: 'kiosk_on', type: 'bool', default: true }, { ref: 'online_on', type: 'bool', default: true }, { ref: 'new_online', type: 'bool', default: true }],
        },
      ],
    },
    roles: [
      screen('kiosk'),
      screen('kiosk2'),
      { key: 'desk', name: 'Desk', permissions: ['app:@:staff', 'table:@appointments:read', 'table:@appointments:update', 'table:@patients:read'] },
    ],
    frontends: [...MANIFEST.frontends, { side: 'customer', kind: 'spa', entry: 'index.html' }],
    ...(kiosk ? { publicKeys: { kiosk: { requiresStaff: { role: opts.role ?? 'kiosk' }, enabledBy: { table: 'settings', column: 'kiosk_on' } } } } : {}),
    publicAccess: [
      ...base.publicAccess.map((entry) =>
        entry.table === 'appointments' && entry.methods.includes('POST')
          ? { ...entry, requireSetting: [{ table: 'settings', column: 'online_on' }, { table: 'settings', column: 'new_online', when: 'anonymous' }] }
          : entry,
      ),
      ...(kiosk
        ? [
            { table: 'patients', key: 'kiosk', methods: ['GET'], select: ['name'], claim: { match: ['mobile', 'born_on'] }, sensitive: false, reason: 'the screen greets the person standing at it by name' },
            {
              table: 'appointments',
              key: 'kiosk',
              methods: ['GET', 'PATCH'],
              select: ['id', 'status'],
              // Today's visits, booked or already in; checked in ("seen" here) from booked only, and up to an hour early.
              filters: [
                { column: 'starts_at', op: 'today' },
                { column: 'status', op: 'in', value: ['booked', 'seen'] },
              ],
              writable: ['status'],
              writableValues: { status: ['seen'] },
              writableWhen: { status: ['booked'], starts_at: { within: 60 } },
              claimedBy: { table: 'patients', column: 'patient_id' },
              sensitive: false,
              reason: 'the screen shows only whether a visit is booked',
            },
          ]
        : []),
    ],
  };
}

/**
 * The kiosk's key: served only to its staff screen, answering only beside that sign-in, switched by
 * the app, and following the version. Its check-in takes a visit up to an hour early, or late, and
 * tells an early arrival the time — and nothing about any visit it would not take anyway.
 */
async function kioskKey(h: Harness, dialect: Dialect): Promise<void> {
  const files = { 'customer/index.html': '<!doctype html><html><body data-app="pos-customer"></body></html>' };
  // The venue's clock, and a day on it: tomorrow at noon, so every visit below is "today" there.
  await h.meta.db.updateTable('adminium_connections').set({ timezone: 'Europe/London' }).execute();
  const tomorrow = new Date(Date.now() + 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const noon = wallTimeToInstant(`${tomorrow} 12:00`, 'Europe/London')!.getTime();
  const minutes = (n: number) => new Date(noon + n * 60_000).toISOString();
  const spell = (n: number) =>
    dialect === 'sqlite' ? String(normalizeWriteValue({ logicalType: 'timestamp' } as never, minutes(n))) : `${minutes(n).slice(0, 19).replace('T', ' ')}+00:00`;
  await stageManifest(h, kioskManifest(), files);
  const installed = await post(h, '/apps/install');
  expect(installed.statusCode, installed.body).toBe(200);
  expect(installed.json().rules.skipped).toEqual([]);
  const made = installed.json().publicAccess as { keyId: string; keys: Record<string, string> };
  expect(Object.keys(made.keys).sort()).toEqual(['customer', 'kiosk']);
  const keys = publicKeysRepo(h.meta);
  const kioskRow = (await keys.findById(made.keys['kiosk']!))!;
  expect(kioskRow).toMatchObject({ purpose: 'kiosk', managedBy: 'pos', name: 'Point of Sale · kiosk' });
  expect(JSON.parse(kioskRow.requiresStaff!)).toEqual({ appKey: 'pos', roleSlug: 'pos-kiosk' });
  expect(JSON.parse(kioskRow.enabledBy!)).toMatchObject({ column: 'kiosk_on' });

  const served = await servePublic(h, made.keyId, { serveApps: true });
  const app = served.composed.app;
  const bool = (on: boolean) => (dialect === 'postgres' ? String(on) : on ? '1' : '0');
  try {
    await h.run(`insert into pos_settings (kiosk_on, online_on, new_online) values (${bool(true)}, ${bool(true)}, ${bool(false)})`);
    await h.run(`insert into pos_patients (name, mobile, born_on, email) values ('Ada', '07700900001', '1980-01-01', 'ada@example.com')`);
    // Ada's visit an hour and a half after noon.
    await h.run(`insert into pos_appointments (patient_id, starts_at, status) values (1, '${spell(90)}', 'booked')`);

    // Staff: one on the kiosk role, one on the desk's.
    const signIn = async (email: string, roleSlug: string) => {
      const user = await usersRepo(h.meta).create({ email, name: email, passwordHash: await adminPasswordHash() });
      await rolesRepo(h.meta).assignToUser(user.id, (await rolesRepo(h.meta).findBySlug(roleSlug))!.id);
      const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: ADMIN_PASSWORD } });
      expect(res.statusCode, res.body).toBe(200);
      return sessionCookie(res.headers['set-cookie']);
    };
    const tablet = await signIn('tablet@clinic.dev', 'pos-kiosk');
    const desk = await signIn('desk@clinic.dev', 'pos-desk');
    const config = async (side: string, cookie?: string) =>
      (await app.inject({ method: 'GET', url: `/apps/pos/${side}/surface-config.json`, headers: cookie === undefined ? {} : { cookie } })).json() as {
        publicKeys?: Record<string, string>;
        publishableKey?: string;
        csrfToken?: string;
      };
    // Only the kiosk's own screen is handed the kiosk key; the public side gets its own.
    const staff = await config('staff', tablet);
    const kioskToken = staff.publicKeys?.['kiosk'];
    expect(kioskToken).toMatch(/^adm_pub_/);
    expect((await config('staff', desk)).publicKeys).toBeUndefined();
    // What each person may do with the app's tables, and whose screen it is: the desk's grants, the tablet's none.
    const accessOf = async (cookie: string) => ((await app.inject({ method: 'GET', url: '/apps/pos/staff/surface-config.json', headers: { cookie } })).json() as { access?: unknown }).access;
    expect(await accessOf(desk)).toEqual({ tables: { appointments: ['read', 'update'], patients: ['read'] }, roles: [{ slug: 'pos-desk', name: 'Desk' }] });
    expect(await accessOf(tablet)).toEqual({ tables: {}, roles: [{ slug: 'pos-kiosk', name: 'Screen kiosk' }] });
    const guests = await config('customer');
    expect(guests.publishableKey).toMatch(/^adm_pub_/);
    expect(guests.publishableKey).not.toBe(kioskToken);

    const host = 'clinic.local';
    const kiosk = (method: 'GET' | 'POST' | 'PATCH', url: string, opts: { cookie?: string; csrf?: string | undefined; origin?: string; host?: string; payload?: unknown; session?: string } = {}) =>
      app.inject({
        method,
        url: `/api/v1/public${url}`,
        headers: {
          authorization: `Bearer ${kioskToken}`,
          host: opts.host ?? host,
          'sec-fetch-site': opts.origin === undefined ? 'same-origin' : 'cross-site',
          ...(method !== 'GET' ? { origin: opts.origin ?? `http://${opts.host ?? host}` } : {}),
          ...(opts.cookie === undefined ? {} : { cookie: opts.cookie }),
          ...(opts.csrf === undefined ? {} : { 'x-adminium-csrf': opts.csrf }),
          ...(opts.session === undefined ? {} : { 'x-adminium-public-session': opts.session }),
        },
        ...(opts.payload === undefined ? {} : { payload: opts.payload as never }),
      });
    const claim = { match: { mobile: '07700900001', born_on: '1980-01-01' } };
    const refused = async (res: { statusCode: number; json: () => unknown }, code: string) => {
      expect(res.statusCode).toBe(code === 'PUBLIC_KEY_OFF' || code === 'APP_DISABLED' ? 503 : 403);
      expect((res.json() as { error: { code: string } }).error.code).toBe(code);
    };
    // The token alone opens nothing; nor another staff member's sign-in; nor another page; nor a write without the CSRF token.
    await refused(await kiosk('POST', '/claim', { payload: claim }), 'PUBLIC_STAFF_REQUIRED');
    await refused(await kiosk('POST', '/claim', { payload: claim, cookie: desk, csrf: (await config('staff', desk)).csrfToken }), 'PUBLIC_STAFF_REQUIRED');
    await refused(await kiosk('POST', '/claim', { payload: claim, cookie: tablet, csrf: staff.csrfToken, origin: 'https://clinic.example.com' }), 'PUBLIC_STAFF_REQUIRED');
    await refused(await kiosk('POST', '/claim', { payload: claim, cookie: tablet }), 'PUBLIC_STAFF_REQUIRED');

    // Switched off in the settings row: off within fifteen seconds, back on after.
    await h.run(`update pos_settings set kiosk_on = ${bool(false)}`);
    await refused(await kiosk('POST', '/claim', { payload: claim, cookie: tablet, csrf: staff.csrfToken }), 'PUBLIC_KEY_OFF');
    await h.run(`update pos_settings set kiosk_on = ${bool(true)}`);
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      // Hours on, well past the switch's fifteen seconds: noon on the venue's day.
      vi.setSystemTime(noon);
      // Signed in on this screen: found, for minutes, with no proof of work.
      const found = await kiosk('POST', '/claim', { payload: claim, cookie: tablet, csrf: staff.csrfToken });
      expect(found.statusCode, found.body).toBe(200);
      const { session, expiresAt } = (found.json() as { data: { session: string; expiresAt: number } }).data;
      expect(expiresAt - Date.now()).toBeLessThanOrEqual(3 * 60_000);
      const visits = await kiosk('GET', '/records/pos_appointments_claimed_2', { cookie: tablet, session });
      expect(visits.statusCode, visits.body).toBe(200);
      expect((visits.json() as { data: { status: string }[] }).data).toEqual([{ id: expect.anything(), status: 'booked' }]);
      // The customer side switched off leaves the kiosk; the app switched off stops it.
      await settingsRepo(h.meta).set('surfaces.apps', { pos: { off: ['customer'] } } as never);
      app.surfaceSettings?.invalidate();
      expect((await kiosk('GET', '/records/pos_appointments_claimed_2', { cookie: tablet, session })).statusCode).toBe(200);
      expect((await served.call('GET', '/config')).statusCode).toBe(503);
      await settingsRepo(h.meta).set('surfaces.apps', {} as never);
      // Served on its own host once the operator maps one, and on no other.
      await settingsRepo(h.meta).set('surfaces.domains', { 'desk.clinic.dev': { appKey: 'pos', side: 'staff' } });
      app.surfaceSettings?.invalidate();
      await refused(await kiosk('GET', '/records/pos_appointments_claimed_2', { cookie: tablet, session }), 'PUBLIC_STAFF_REQUIRED');
      expect((await kiosk('GET', '/records/pos_appointments_claimed_2', { cookie: tablet, session, host: 'desk.clinic.dev' })).statusCode).toBe(200);
      await settingsRepo(h.meta).set('surfaces.domains', {});
      app.surfaceSettings?.invalidate();

      // Checking in. Ada's other visits: half an hour ahead, twenty minutes late, one checked in already
      // (two hours ahead), tomorrow's, a cancelled one; and Ben's, as far ahead as her first.
      await h.run(`insert into pos_patients (name, mobile, born_on, email) values ('Ben', '07700900002', '1981-02-02', 'ben@example.com')`);
      const visit = async (patient: number, at: number, status: string) => {
        await h.run(`insert into pos_appointments (patient_id, starts_at, status) values (${patient}, '${spell(at)}', '${status}')`);
        const row = (await h.rows(`select max(id) as id from pos_appointments`))[0] as { id: unknown };
        return String(row.id);
      };
      const soon = await visit(1, 30, 'booked');
      const late = await visit(1, -20, 'booked');
      const already = await visit(1, 120, 'seen');
      const nextDay = await visit(1, 24 * 60 + 90, 'booked');
      const cancelled = await visit(1, 90, 'cancelled');
      const bens = await visit(2, 90, 'booked');
      const checkIn = (id: string, as = session) =>
        kiosk('PATCH', `/records/pos_appointments_claimed_2/${id}`, { cookie: tablet, csrf: staff.csrfToken, session: as, payload: { values: { status: 'seen' } } });
      const statusOf = async (id: string) => ((await h.rows(`select status from pos_appointments where id = ${id}`))[0] as { status: string }).status;

      // More than an hour early: refused, with the visit's time and when she may check in — and nothing changed.
      const early = await checkIn('1');
      expect(early.statusCode, early.body).toBe(409);
      expect(early.json()).toEqual({ error: { code: 'PUBLIC_TOO_EARLY', params: { at: minutes(90), from: minutes(30) }, message: expect.any(String) } });
      expect(await statusOf('1')).toBe('booked');
      // Inside the hour, and late: checked in.
      for (const id of [soon, late]) {
        const res = await checkIn(id);
        expect(res.statusCode, res.body).toBe(200);
        expect(res.json()).toEqual({ data: { id: expect.anything(), status: 'seen' } });
        expect(await statusOf(id)).toBe('seen');
      }
      // Every other miss is the one "no such record", with no time in it: another patient's, one
      // checked in already (however far ahead), tomorrow's, a cancelled one, one that does not exist —
      // and a second check-in of the visit just checked in.
      for (const id of [bens, already, nextDay, cancelled, '99999', soon]) {
        const res = await checkIn(id);
        expect(res.statusCode, `${id}: ${res.body}`).toBe(404);
        expect(res.json()).toEqual({ error: { code: 'PUBLIC_REF_NOT_FOUND', message: 'No such record.' } });
      }
      expect([await statusOf(nextDay), await statusOf(bens)]).toEqual(['booked', 'booked']);
      // The screen tells "already" from its own read: booked and checked-in visits of today, no others.
      const today = (await kiosk('GET', '/records/pos_appointments_claimed_2', { cookie: tablet, session })).json() as { data: { id: unknown; status: string }[] };
      expect(today.data.map((row) => [String(row.id), row.status]).sort()).toEqual([['1', 'booked'], [already, 'seen'], [late, 'seen'], [soon, 'seen']].sort());
      // Half an hour on, the window has opened: a fresh claim checks her in.
      vi.setSystemTime(noon + 31 * 60_000);
      const again = (await kiosk('POST', '/claim', { payload: claim, cookie: tablet, csrf: staff.csrfToken })).json() as { data: { session: string } };
      const opened = await checkIn('1', again.data.session);
      expect(opened.statusCode, opened.body).toBe(200);
      expect(await statusOf('1')).toBe('seen');
    } finally {
      vi.useRealTimers();
    }

    // Booking online: a stranger's create while new patients are off is refused; a found person's is not.
    const stranger = await served.call('POST', '/records/pos_appointments_claimed', undefined, { starts_at: '2099-02-01T10:00:00Z', new_name: 'Cara' });
    expect(stranger.statusCode, stranger.body).toBe(403);
    expect(served.codeOf(stranger)).toBe('PUBLIC_SWITCHED_OFF');
    // A staff member signed in on this browser does not break the public side: its key, not the cookie, is the credential.
    const found = await app.inject({ method: 'POST', url: '/api/v1/public/claim', headers: { ...served.headers(), cookie: desk, 'sec-fetch-site': 'cross-site' }, payload: claim });
    expect(found.statusCode, found.body).toBe(200);
    const guest = (found.json() as { data: { session: string } }).data.session;
    expect((await served.call('POST', '/records/pos_appointments_claimed', guest, { starts_at: '2099-02-02T10:00:00Z' })).statusCode).toBe(201);

    // An update follows the version: a changed role rebinds the key, a dropped kiosk revokes it…
    await stageManifest(h, { ...kioskManifest({ role: 'kiosk2' }), version: '1.1.0' }, files);
    expect((await h.app.inject({ method: 'POST', url: '/apps/pos/update' })).statusCode).toBe(200);
    expect(JSON.parse((await keys.findById(made.keys['kiosk']!))!.requiresStaff!)).toEqual({ appKey: 'pos', roleSlug: 'pos-kiosk2' });
    await stageManifest(h, { ...kioskManifest({ kiosk: false }), version: '1.2.0' }, files);
    expect((await h.app.inject({ method: 'POST', url: '/apps/pos/update' })).statusCode).toBe(200);
    expect((await keys.findById(made.keys['kiosk']!))!.revokedAt).not.toBeNull();
    // …and a kiosk key the operator took back is not made again by an update.
    await stageManifest(h, { ...kioskManifest(), version: '1.3.0' }, files);
    expect((await h.app.inject({ method: 'POST', url: '/apps/pos/update' })).statusCode).toBe(200);
    expect((await keys.listManagedBy('pos')).filter((k) => k.purpose === 'kiosk' && k.revokedAt === null)).toEqual([]);
  } finally {
    await app.close();
  }
}

/** A stored start as an ISO instant, however the driver hands it back. */
function slotInstantOf(value: unknown): string {
  return slotInstant(value)!.toISOString();
}

const post = (h: Harness, url: string, extra: Record<string, unknown> = {}) =>
  h.app.inject({ method: 'POST', url, payload: { key: 'pos', version: '1.0.0', connectionId: h.connectionId, ...extra } });

const legs: [Dialect, boolean][] = [
  ['sqlite', true],
  ['postgres', POSTGRES_URL !== undefined],
  ['mysql', MYSQL_URL !== undefined],
];

for (const [dialect, available] of legs) {
  describe.skipIf(!available)(`an app install on ${dialect}`, () => {
    it('creates every table under the prefix, links them by their real names, and records them', async () => {
      const h = (open = await harness(dialect));
      await stage(h);
      const res = await post(h, '/apps/install');
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().schema.created).toEqual(['pos_menu_items', 'pos_payments', 'pos_shifts', 'pos_lines']);

      // The key numbers itself and the foreign key points at the prefixed table.
      await h.run(`INSERT INTO pos_menu_items (name) VALUES ('Latte')`);
      await h.run(`INSERT INTO pos_lines (item_id) VALUES (1)`);
      await expect(h.run(`INSERT INTO pos_lines (item_id) VALUES (999)`)).rejects.toThrow();

      // The page binds the short name and composes from the real table.
      expect(res.json().pages.warnings).toEqual([]);
      const page = await pagesRepo(h.meta).findBySlug(h.connectionId, 'pos-menu');
      expect((page?.config as { source: { table: string } }).source.table).toMatch(/(^|\.)pos_menu_items$/);

      const records = await appTablesRepo(h.meta).forInstall(h.connectionId, 'pos');
      expect(records.map((r) => [r.ref, r.tableName, r.state, r.owned])).toEqual([
        ['menu_items', 'pos_menu_items', 'created', true],
        ['payments', 'pos_payments', 'created', true],
        ['shifts', 'pos_shifts', 'created', true],
        ['lines', 'pos_lines', 'created', true],
      ]);
    }, 60_000);

    it('asks about a hand-made table, then adapts it with only safe edits', async () => {
      const h = (open = await harness(dialect));
      // Made by hand: no tip column, a method column too narrow, rows in it.
      await h.run(`CREATE TABLE pos_payments (id integer PRIMARY KEY, amount decimal(19,4) NOT NULL, method varchar(8) NOT NULL)`);
      await h.run(`INSERT INTO pos_payments (id, amount, method) VALUES (1, 4.5, 'cash')`);
      await stage(h);

      const asked = await post(h, '/apps/plan');
      const payments = asked.json().plan.tables.find((t: { ref: string }) => t.ref === 'payments');
      expect(payments).toMatchObject({ class: 'taken', action: 'undecided' });
      // The declared columns ride along, so the check's count and its list agree.
      expect(payments.columns).toEqual([
        { ref: 'id', type: 'int' },
        { ref: 'amount', type: 'money' },
        { ref: 'tip', type: 'money' },
        { ref: 'method', type: 'text' },
      ]);
      expect((await post(h, '/apps/install')).statusCode).toBe(422);

      const choices = { payments: { action: 'reuse' } };
      const planned = await post(h, '/apps/plan', { choices });
      const edits = planned.json().plan.tables.find((t: { ref: string }) => t.ref === 'payments').edits;
      expect(edits).toContainEqual({ kind: 'add-column', column: 'tip' });
      expect(edits).toContainEqual({ kind: 'widen', column: 'method', from: 'varchar(8)', to: 'varchar(16)' });

      const res = await post(h, '/apps/install', { choices, planChecksum: planned.json().plan.checksum });
      expect(res.statusCode, res.body).toBe(200);
      const columns = await h.columns('pos_payments');
      expect(columns['tip']).toBeDefined();
      if (dialect !== 'sqlite') expect(columns['method']?.width).toBe(16);
      // The row survived, and a new one needs no id any more.
      await h.run(`INSERT INTO pos_payments (amount, method) VALUES (2, 'card')`);
      const [record] = (await appTablesRepo(h.meta).forInstall(h.connectionId, 'pos')).filter((r) => r.ref === 'payments');
      expect(record).toMatchObject({ state: 'adopted', owned: false });
    }, 60_000);

    it('renames a table it cannot use out of the way, and creates its own', async () => {
      const h = (open = await harness(dialect));
      // Another system's table: it requires a column the app never fills.
      await h.run(`CREATE TABLE pos_shifts (id integer PRIMARY KEY, location_id integer NOT NULL)`);
      await h.run(`INSERT INTO pos_shifts (id, location_id) VALUES (1, 7)`);
      await stage(h);

      const plan = (await post(h, '/apps/plan')).json().plan;
      const shifts = plan.tables.find((t: { ref: string }) => t.ref === 'shifts');
      expect(shifts.offers).toEqual(['rename-existing', 'alt-prefix']);
      expect(shifts.reuseRefusal).toContain('"location_id"');

      const res = await post(h, '/apps/install', { choices: { shifts: { action: 'rename-existing', to: 'shifts_2019' } } });
      expect(res.statusCode, res.body).toBe(200);
      expect(Object.keys(await h.columns('shifts_2019'))).toContain('location_id');
      expect(Object.keys(await h.columns('pos_shifts'))).toEqual(['id', 'opened_at']);
      // The app's record names the table it made, not the one it moved aside:
      // the rename's repair must not carry the app's own record with it.
      const records = await appTablesRepo(h.meta).forInstall(h.connectionId, 'pos');
      expect(records.find((r) => r.ref === 'shifts')).toMatchObject({ tableName: 'pos_shifts', state: 'created', owned: true });
      expect(records.some((r) => r.tableName === 'shifts_2019')).toBe(false);
    }, 60_000);

    it('gives the whole app a different prefix', async () => {
      const h = (open = await harness(dialect));
      await h.run(`CREATE TABLE pos_menu_items (id integer PRIMARY KEY, sku varchar(20) NOT NULL)`);
      await stage(h);
      const res = await post(h, '/apps/install', { altPrefix: 'pos2_' });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().schema.created).toEqual(['pos2_menu_items', 'pos2_payments', 'pos2_shifts', 'pos2_lines']);
      await h.run(`INSERT INTO pos2_menu_items (name) VALUES ('Mocha')`);
      await h.run(`INSERT INTO pos2_lines (item_id) VALUES (1)`);
    }, 60_000);

    it('adds the link columns an update needs, with their foreign keys, to a table that has rows', async () => {
      const h = (open = await harness(dialect));
      await stage(h);
      expect((await post(h, '/apps/install')).statusCode).toBe(200);
      await h.run(`INSERT INTO pos_shifts (opened_at) VALUES (CURRENT_TIMESTAMP)`);
      await h.run(`INSERT INTO pos_payments (amount, method) VALUES (4.5, 'cash')`);
      // 1.1.0: payments links to shifts (there already) and to customers (new in 1.1.0).
      const next = {
        ...MANIFEST,
        version: '1.1.0',
        requiredSchema: {
          prefixed: true,
          tables: [
            ...TABLES.map((t) =>
              t.ref === 'payments'
                ? {
                    ...t,
                    columns: [
                      ...t.columns,
                      { ref: 'shift_id', type: 'fk', references: 'shifts', nullable: true },
                      { ref: 'customer_id', type: 'fk', references: 'customers', nullable: true },
                    ],
                  }
                : t,
            ),
            { ref: 'customers', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'name', type: 'text', maxLength: 80 }] },
          ],
        },
      };
      await stageManifest(h, next);
      const planned = (await post(h, '/apps/plan', { version: '1.1.0' })).json().plan;
      expect(planned.problems).toEqual([]);
      expect(planned.tables.find((t: { ref: string }) => t.ref === 'payments').edits).toEqual([
        { kind: 'add-column', column: 'shift_id' },
        { kind: 'add-column', column: 'customer_id' },
      ]);
      const res = await h.app.inject({ method: 'POST', url: '/apps/pos/update', payload: { planChecksum: planned.checksum } });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().app.schema.created).toEqual(['pos_customers']);

      // The row that was there is unlinked; a link must point at a real row.
      expect(await h.rows('SELECT shift_id, customer_id FROM pos_payments')).toEqual([{ shift_id: null, customer_id: null }]);
      await h.run(`INSERT INTO pos_customers (name) VALUES ('Dana')`);
      await h.run(`INSERT INTO pos_payments (amount, method, shift_id, customer_id) VALUES (3, 'card', 1, 1)`);
      await expect(h.run(`INSERT INTO pos_payments (amount, method, customer_id) VALUES (3, 'card', 999)`)).rejects.toThrow();
      await expect(h.run(`INSERT INTO pos_payments (amount, method, shift_id) VALUES (3, 'card', 999)`)).rejects.toThrow();
      const [row] = (await h.app.inject({ method: 'GET', url: '/apps' })).json().apps;
      expect(row.version).toBe('1.1.0');
    }, 90_000);

    it('grows a choice column on update and keeps refusing what is not on it', async () => {
      const h = (open = await harness(dialect));
      const withMethods = (values: string[], version: string) => ({
        ...MANIFEST,
        version,
        requiredSchema: {
          prefixed: true,
          tables: TABLES.map((t) =>
            t.ref === 'payments'
              ? { ...t, columns: t.columns.map((c) => (c.ref === 'method' ? { ref: 'method', type: 'enum', enum: values } : c)) }
              : t,
          ),
        },
      });
      await stageManifest(h, withMethods(['cash', 'card', 'walk_in'], '1.0.0'));
      expect((await post(h, '/apps/install')).statusCode).toBe(200);
      await stageManifest(h, withMethods(['cash', 'card', 'walk_in', 'gift_card'], '1.1.0'));
      const planned = (await post(h, '/apps/plan', { version: '1.1.0' })).json().plan;
      // Only the value that is new — an underscore in one already there is not a change.
      expect(planned.tables.find((t: { ref: string }) => t.ref === 'payments').edits).toEqual([
        { kind: 'enum-values', column: 'method', values: ['gift_card'] },
      ]);
      const res = await h.app.inject({ method: 'POST', url: '/apps/pos/update', payload: { planChecksum: planned.checksum } });
      expect(res.statusCode, res.body).toBe(200);
      await h.run(`INSERT INTO pos_payments (amount, method) VALUES (5, 'gift_card')`);
      await h.run(`INSERT INTO pos_payments (amount, method) VALUES (5, 'walk_in')`);
      // The list grew; it did not go away.
      await expect(h.run(`INSERT INTO pos_payments (amount, method) VALUES (5, 'bitcoin')`)).rejects.toThrow();
    }, 90_000);

    it('adds a choice column on update and still keeps its values on every write', async () => {
      const h = (open = await harness(dialect));
      await stage(h);
      expect((await post(h, '/apps/install')).statusCode).toBe(200);
      const next = {
        ...MANIFEST,
        version: '1.1.0',
        requiredSchema: {
          prefixed: true,
          tables: TABLES.map((t) =>
            t.ref === 'payments' ? { ...t, columns: [...t.columns, { ref: 'stage', type: 'enum', enum: ['queued', 'ready'], nullable: true }] } : t,
          ),
        },
      };
      await stageManifest(h, next);
      const updated = await h.app.inject({ method: 'POST', url: '/apps/pos/update' });
      expect(updated.statusCode, updated.body).toBe(200);

      const snapshot = (await snapshotsRepo(h.meta).latest(h.connectionId))!;
      const view = new SnapshotView(
        h.connectionId,
        applyOverrides(parseDatabaseModel(snapshot.schema), await overridesRepo(h.meta).listForConnection(h.connectionId, { status: 'active' })),
        new Map(),
      );
      const { db, dialect: d } = await h.manager.data(h.connectionId);
      const target: WriteTarget = { connectionId: h.connectionId, view, table: view.table(view.model.tables.find((t) => t.name === 'pos_payments')!.id), db, dialect: d };
      const writes = createWriteService(writeStores(h.meta));
      const context = { origin: 'dashboard' as const, hops: 0, actor: null, request: null };
      const write = (stage: string) =>
        writes.create({ target, values: { amount: 1, method: 'cash', stage }, context, announce: async () => {} }).then(
          () => 'written',
          (error: { details?: { fields?: Record<string, { code?: string }> } }) => `refused:${String(error.details?.fields?.['stage']?.code)}`,
        );
      expect(await write('ready')).toBe('written');
      // An update adds the column as text; the list the app declared still holds.
      expect(await write('lost')).toBe('refused:not-allowed');
    }, 90_000);

    it('refuses an update whose table needs a column no safe edit can add, before it changes anything', async () => {
      const h = (open = await harness(dialect));
      await stage(h);
      expect((await post(h, '/apps/install')).statusCode).toBe(200);
      // 1.1.0: payments gains a REQUIRED reference to shifts — the rows already there would have none.
      const next = {
        ...MANIFEST,
        version: '1.1.0',
        requiredSchema: {
          prefixed: true,
          tables: TABLES.map((t) =>
            t.ref === 'payments' ? { ...t, columns: [...t.columns, { ref: 'shift_id', type: 'fk', references: 'shifts' }] } : t,
          ),
        },
      };
      await stageManifest(h, next);
      const planned = (await post(h, '/apps/plan', { version: '1.1.0' })).json().plan;
      expect(planned.problems.map((p: { code: string }) => p.code)).toEqual(['COLUMNS_REQUIRED']);
      const res = await h.app.inject({ method: 'POST', url: '/apps/pos/update', payload: { planChecksum: planned.checksum } });
      expect(res.statusCode, res.body).toBe(422);
      // The plan's own refusal, naming the update (its problems ride in `details`) —
      // not the DDL step's bare "this plan was refused".
      expect(res.json()).toMatchObject({ code: 'VALIDATION_FAILED', message: '"pos" cannot be updated on this database.' });
      expect(Object.keys(await h.columns('pos_payments'))).not.toContain('shift_id');
      const [row] = (await h.app.inject({ method: 'GET', url: '/apps' })).json().apps;
      expect(row.version).toBe('1.0.0');
    }, 60_000);

    it('refuses to update an install its release no longer updates, at the upload, the plan, the update and the offer', async () => {
      const h = (open = await harness(dialect));
      const next = { ...MANIFEST, version: '2.0.0', compatibility: { ...MANIFEST.compatibility, updatesFrom: '>=1.5.0' } };
      // Staged before anything is installed, as a download from the catalogue lands it.
      await stageManifest(h, next);
      await stage(h);
      expect((await post(h, '/apps/install')).statusCode).toBe(200);

      // (This harness's bare error handler drops `details`; the app's keeps
      // `reason: UPDATE_NOT_SUPPORTED` with the versions and the range.)
      const refusal = {
        code: 'VALIDATION_FAILED',
        message: 'Point of Sale 1.0.0 used a different layout, so 2.0.0 cannot update it in place. Uninstall it first, then install 2.0.0.',
      };
      const planned = await post(h, '/apps/plan', { version: '2.0.0' });
      expect(planned.statusCode, planned.body).toBe(422);
      expect(planned.json()).toMatchObject(refusal);
      const updated = await h.app.inject({ method: 'POST', url: '/apps/pos/update' });
      expect(updated.statusCode, updated.body).toBe(422);
      expect(updated.json()).toMatchObject(refusal);
      const [row] = (await h.app.inject({ method: 'GET', url: '/apps' })).json().apps;
      expect(row.version).toBe('1.0.0');

      // The shelf offers no update, and says why.
      const catalog = (await h.app.inject({ method: 'GET', url: '/apps/catalog' })).json();
      expect(catalog.apps.find((a: { key: string }) => a.key === 'pos')).toMatchObject({
        updateTo: null,
        cannotUpdate: { version: '2.0.0', updatesFrom: '>=1.5.0' },
      });

      // Once installed, uploading such a release is refused outright.
      const later = { ...next, version: '2.0.1' };
      const tarball = packageTarball({ 'manifest.json': JSON.stringify(later), 'staff/index.html': '<!doctype html><html></html>' });
      const upload = await h.app.inject({
        method: 'POST',
        url: `/apps/upload?expectedSha512=${encodeURIComponent(sha512Integrity(tarball))}`,
        headers: { 'content-type': 'application/octet-stream' },
        payload: Buffer.from(tarball),
      });
      expect(upload.statusCode, upload.body).toBe(422);
      expect(upload.json().message).toBe(
        'Point of Sale 1.0.0 used a different layout, so 2.0.1 cannot update it in place. Uninstall it first, then install 2.0.1.',
      );

      // A release whose range takes the installed version updates as before.
      await stageManifest(h, { ...MANIFEST, version: '2.1.0', compatibility: { ...MANIFEST.compatibility, updatesFrom: '^1.0.0 || >=2.0.0' } });
      const ok = await h.app.inject({ method: 'POST', url: '/apps/pos/update' });
      expect(ok.statusCode, ok.body).toBe(200);
      expect(ok.json()).toMatchObject({ from: '1.0.0', to: '2.1.0' });
    }, 60_000);

    it('renames an install made before prefixes to the prefix, every table, as reviewed', async () => {
      const h = (open = await harness(dialect));
      // The version an older install came from: plain names.
      await stageManifest(h, { ...MANIFEST, requiredSchema: { tables: TABLES } });
      expect((await post(h, '/apps/install')).statusCode).toBe(200);
      await h.run(`INSERT INTO menu_items (name) VALUES ('Latte')`);
      // The version that prefixes its tables: an update keeps the names it has.
      await stageManifest(h, { ...MANIFEST, version: '1.1.0' });
      const updated = await h.app.inject({ method: 'POST', url: '/apps/pos/update' });
      expect(updated.statusCode, updated.body).toBe(200);

      const listed = (await h.app.inject({ method: 'GET', url: '/apps' })).json();
      expect(listed.apps[0].oldTableNames).toEqual({ prefix: 'pos_', count: 4 });

      const planned = await h.app.inject({ method: 'POST', url: '/apps/pos/rename-tables/plan' });
      expect(planned.statusCode, planned.body).toBe(200);
      const preview = planned.json();
      // Every table, not a sample of them.
      expect(preview.tables).toEqual([
        { ref: 'lines', from: 'lines', to: 'pos_lines' },
        { ref: 'menu_items', from: 'menu_items', to: 'pos_menu_items' },
        { ref: 'payments', from: 'payments', to: 'pos_payments' },
        { ref: 'shifts', from: 'shifts', to: 'pos_shifts' },
      ]);
      expect(preview.plan.refusals).toEqual([]);

      const stale = await h.app.inject({
        method: 'POST',
        url: '/apps/pos/rename-tables',
        payload: { checksum: 'f'.repeat(64) },
      });
      expect(stale.statusCode).toBe(409);
      expect(stale.body).toContain('SCHEMA_DRIFT');
      expect(await h.columns('menu_items')).not.toEqual({});

      const renamed = await h.app.inject({
        method: 'POST',
        url: '/apps/pos/rename-tables',
        payload: { checksum: preview.plan.checksum },
      });
      expect(renamed.statusCode, renamed.body).toBe(200);
      expect(await h.columns('menu_items')).toEqual({});
      // The row came along, and the foreign key follows the new name.
      await h.run(`INSERT INTO pos_lines (item_id) VALUES (1)`);
      await expect(h.run(`INSERT INTO pos_lines (item_id) VALUES (999)`)).rejects.toThrow();

      const records = await appTablesRepo(h.meta).forInstall(h.connectionId, 'pos');
      expect(records.map((r) => r.tableName).sort()).toEqual(['pos_lines', 'pos_menu_items', 'pos_payments', 'pos_shifts']);
      const page = await pagesRepo(h.meta).findBySlug(h.connectionId, 'pos-menu');
      expect((page?.config as { source: { table: string } }).source.table).toMatch(/(^|\.)pos_menu_items$/);
      const after = (await h.app.inject({ method: 'GET', url: '/apps' })).json();
      expect(after.apps[0].oldTableNames).toBeUndefined();
    }, 60_000);

    it('asks about a new version\'s taken table, and updates with the answer', async () => {
      const h = (open = await harness(dialect));
      await stage(h);
      expect((await post(h, '/apps/install')).statusCode).toBe(200);
      // The new version brings a table somebody already made by hand.
      await h.run(`CREATE TABLE pos_staff (id integer PRIMARY KEY, badge varchar(10) NOT NULL)`);
      const next = {
        ...MANIFEST,
        version: '1.1.0',
        requiredSchema: {
          prefixed: true,
          tables: [...TABLES, { ref: 'staff', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'name', type: 'text' }] }],
        },
      };
      await stageManifest(h, next);

      const refused = await h.app.inject({ method: 'POST', url: '/apps/pos/update' });
      expect(refused.statusCode).toBe(422);

      const choices = { staff: { action: 'rename-existing', to: 'pos_staff_2019' } };
      const planned = (await post(h, '/apps/plan', { version: '1.1.0', choices })).json().plan;
      expect(planned.tables.find((t: { ref: string }) => t.ref === 'staff')).toMatchObject({
        class: 'taken',
        action: 'rename-existing',
      });
      // Payment tables and the rest are the app's own, taken back as they are.
      expect(planned.tables.find((t: { ref: string }) => t.ref === 'payments').class).toBe('own-leftover');

      const drifted = await h.app.inject({
        method: 'POST',
        url: '/apps/pos/update',
        payload: { choices, planChecksum: 'f'.repeat(64) },
      });
      expect(drifted.statusCode).toBe(409);
      expect(drifted.body).toContain('SCHEMA_DRIFT');

      const updated = await h.app.inject({
        method: 'POST',
        url: '/apps/pos/update',
        payload: { choices, planChecksum: planned.checksum },
      });
      expect(updated.statusCode, updated.body).toBe(200);
      expect(updated.json().app.schema.created).toEqual(['pos_staff']);
      expect(await h.columns('pos_staff_2019')).toHaveProperty('badge');
      expect(await h.columns('pos_staff')).toHaveProperty('name');
    }, 60_000);

    it('uninstalls, dropping only its own tables and only when the key is typed back', async () => {
      const h = (open = await harness(dialect, { superAdmin: true }));
      await stage(h);
      expect((await post(h, '/apps/install')).statusCode).toBe(200);

      const plan = (await h.app.inject({ method: 'GET', url: '/apps/pos/uninstall-plan' })).json();
      expect(plan.canDropTables).toBe(true);
      expect(plan.pages.removed.map((p: { slug: string }) => p.slug)).toEqual(['pos-menu']);
      expect(plan.tables.map((t: { table: string; droppable: boolean }) => [t.table, t.droppable])).toEqual([
        ['pos_menu_items', true],
        ['pos_payments', true],
        ['pos_shifts', true],
        ['pos_lines', true],
      ]);

      const unconfirmed = await h.app.inject({ method: 'DELETE', url: '/apps/pos', payload: { dropTables: true, confirmKey: 'nope' } });
      expect(unconfirmed.statusCode).toBe(422);
      expect(await h.columns('pos_menu_items')).not.toEqual({});

      // What Adminium noticed about a table on its own (a personal-data mark) goes with the table.
      const snapshot = (await snapshotsRepo(h.meta).latest(h.connectionId))!;
      const menuTable = parseDatabaseModel(snapshot.schema).tables.find((t) => t.name === 'pos_menu_items')!.id!;
      await overridesRepo(h.meta).create({ connectionId: h.connectionId, op: 'column.pii', tableName: menuTable, columnName: 'name', value: { masked: true, kind: 'name' }, origin: 'auto' });
      const res = await h.app.inject({ method: 'DELETE', url: '/apps/pos', payload: { dropTables: true, confirmKey: 'pos' } });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().dropped.sort()).toEqual(['pos_lines', 'pos_menu_items', 'pos_payments', 'pos_shifts']);
      const left = (await overridesRepo(h.meta).listForConnection(h.connectionId)).filter((o) => /pos_(menu_items|payments|shifts|lines)$/.test(o.tableName));
      expect(left).toEqual([]);
      for (const table of ['pos_menu_items', 'pos_payments', 'pos_shifts', 'pos_lines']) {
        expect(await h.columns(table), table).toEqual({});
      }
      const records = await appTablesRepo(h.meta).forInstall(h.connectionId, 'pos');
      expect(new Set(records.map((r) => r.state))).toEqual(new Set(['dropped']));
      expect(await pagesRepo(h.meta).findBySlug(h.connectionId, 'pos-menu')).toBeNull();
    }, 60_000);

    it('keeps the tables and an edited page, and takes its roles with it', async () => {
      const h = (open = await harness(dialect));
      await stage(h);
      expect((await post(h, '/apps/install')).statusCode).toBe(200);
      const page = (await pagesRepo(h.meta).findBySlug(h.connectionId, 'pos-menu'))!;
      await pagesRepo(h.meta).replaceConfig(page.id, { ...(page.config as Record<string, unknown>), edited: true });
      const role = await rolesRepo(h.meta).create({ slug: 'pos-cashier', name: 'POS cashier', appKey: 'pos' });
      const user = await usersRepo(h.meta).create({ email: 'cashier@test', name: 'Cashier' });
      await rolesRepo(h.meta).assignToUser(user.id, role.id);

      const plan = (await h.app.inject({ method: 'GET', url: '/apps/pos/uninstall-plan' })).json();
      expect(plan.pages.kept.map((p: { slug: string }) => p.slug)).toEqual(['pos-menu']);
      expect(plan.roles).toEqual([{ slug: 'pos-cashier', name: 'POS cashier', members: 1, apiKeys: 0 }]);

      const res = await h.app.inject({ method: 'DELETE', url: '/apps/pos' });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json()).toMatchObject({ removed: { pages: 0, roles: 1 }, kept: { pages: 1 }, dropped: [] });
      expect(await h.columns('pos_menu_items')).not.toEqual({});
      const kept = (await pagesRepo(h.meta).findBySlug(h.connectionId, 'pos-menu'))!;
      expect(kept.origin).toBe('user');
      expect(kept.manifestId).toBeNull();
      expect((await rolesRepo(h.meta).list()).some((r) => r.slug === 'pos-cashier')).toBe(false);
      const records = await appTablesRepo(h.meta).forInstall(h.connectionId, 'pos');
      expect(new Set(records.map((r) => r.state))).toEqual(new Set(['released']));
    }, 60_000);

    it('reinstalls over its kept tables, adding the one column a table lost', async () => {
      const h = (open = await harness(dialect));
      // A table with a foreign key: SQLite's edit rebuilds such a table rather than altering it.
      const withNote = {
        ...MANIFEST,
        requiredSchema: {
          prefixed: true,
          tables: [
            ...TABLES.map((t) => (t.ref === 'lines' ? { ...t, columns: [...t.columns, { ref: 'note', type: 'text', nullable: true }] } : t)),
            {
              ref: 'tabs',
              columns: [
                { ref: 'id', type: 'uuid', role: 'pk' },
                { ref: 'line_id', type: 'fk', references: 'lines', label: { 'en-US': 'Line' } },
                { ref: 'method', type: 'enum', enum: ['cash', 'card'] },
                { ref: 'amount', type: 'money', default: 0 },
                { ref: 'reference', type: 'text', maxLength: 64, nullable: true },
                { ref: 'paid_at', type: 'timestamptz', default: 'now' },
                { ref: 'item_id', type: 'fk', references: 'menu_items', nullable: true },
              ],
            },
          ],
        },
      };
      await stageManifest(h, withNote);
      expect((await post(h, '/apps/install')).statusCode).toBe(200);
      await h.run(`INSERT INTO pos_menu_items (name) VALUES ('Latte')`);
      await h.run(`INSERT INTO pos_lines (item_id, note) VALUES (1, 'oat')`);
      expect((await h.app.inject({ method: 'DELETE', url: '/apps/pos' })).statusCode).toBe(200);
      // Dropped by another program, as an operator's own tool would: on SQLite
      // that is another connection to the same file, which the server's own
      // connection must notice.
      const outside = dialect === 'sqlite' ? new BetterSqlite3(join(h.dataDir, 'source.db')) : null;
      for (const statement of ['ALTER TABLE pos_lines DROP COLUMN note', 'ALTER TABLE pos_tabs DROP COLUMN reference', 'DROP TABLE pos_shifts']) {
        if (outside === null) await h.run(statement);
        else outside.exec(statement);
      }
      outside?.close();
      await stageManifest(h, withNote);

      const planned = (await post(h, '/apps/plan')).json().plan;
      const lines = planned.tables.find((t: { ref: string }) => t.ref === 'lines');
      expect(lines).toMatchObject({ class: 'own-leftover', action: 'reuse', edits: [{ kind: 'add-column', column: 'note' }] });
      const res = await post(h, '/apps/install', { planChecksum: planned.checksum });
      expect(res.statusCode, res.body).toBe(200);
      expect(await h.columns('pos_lines')).toHaveProperty('note');
      await h.run(`INSERT INTO pos_lines (item_id, note) VALUES (1, 'soy')`);
      // A table dropped outside is made again, not taken for still there.
      expect(res.json().schema.created).toEqual(['pos_shifts']);
      await h.run('INSERT INTO pos_shifts (id) VALUES (1)');
    }, 60_000);

    it('refuses a drop it may not make before it changes anything', async () => {
      const h = (open = await harness(dialect));
      await stage(h);
      expect((await post(h, '/apps/install')).statusCode).toBe(200);
      expect((await h.app.inject({ method: 'GET', url: '/apps/pos/uninstall-plan' })).json().canDropTables).toBe(false);
      const res = await h.app.inject({ method: 'DELETE', url: '/apps/pos', payload: { dropTables: true, confirmKey: 'pos' } });
      expect(res.statusCode).toBe(403);
      // Still installed, pages and all.
      expect((await h.app.inject({ method: 'GET', url: '/apps' })).json().apps).toHaveLength(1);
      expect(await pagesRepo(h.meta).findBySlug(h.connectionId, 'pos-menu')).not.toBeNull();
    }, 60_000);

    it('books people: hours, breaks, closures, the window, notice, overlap, anyone and walk-ins, on the venue clock', async () => {
      const h = (open = await harness(dialect));
      const zone = 'Europe/London';
      // Tuesday 28 July 2026, 08:20 in London: the clock every check below reads.
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(wallTimeToInstant('2026-07-28 08:20', zone)!);
      try {
        await bookPeople(h, zone);
      } finally {
        vi.useRealTimers();
      }
    }, 90_000);

    it('flags a late cancellation, refuses a guest\u2019s late move, and hands both to undo', async () => {
      const h = (open = await harness(dialect));
      const zone = 'Europe/London';
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(wallTimeToInstant('2026-07-28 08:20', zone)!);
      try {
        await cancelLate(h, zone);
      } finally {
        vi.useRealTimers();
      }
    }, 90_000);

    it('stamps who and when on a create and on a change, per origin, and never over history', async () => {
      const h = (open = await harness(dialect));
      const zone = 'Europe/London';
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(wallTimeToInstant('2026-07-28 08:20', zone)!);
      try {
        await stampRows(h, zone);
      } finally {
        vi.useRealTimers();
      }
    }, 90_000);

    it('keeps a visit’s balance from its fee, payments and write-offs, and never lets it go below zero', async () => {
      const h = (open = await harness(dialect));
      const zone = 'Europe/London';
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(wallTimeToInstant('2026-07-28 08:20', zone)!);
      try {
        await keepBalances(h, zone);
      } finally {
        vi.useRealTimers();
      }
    }, 90_000);

    it('makes a unique column under the real table’s name, and the database keeps it', async () => {
      const h = (open = await harness(dialect));
      await stageManifest(h, {
        ...MANIFEST,
        requiredSchema: {
          prefixed: true,
          tables: [
            TABLES[0],
            {
              ref: 'day_closes',
              columns: [
                { ref: 'id', type: 'int', role: 'pk' },
                { ref: 'day', type: 'date', unique: true },
                { ref: 'client_key', type: 'text', maxLength: 36, nullable: true, unique: true },
              ],
            },
          ],
        },
      });
      const installed = await post(h, '/apps/install');
      expect(installed.statusCode, installed.body).toBe(200);
      const model = parseDatabaseModel((await snapshotsRepo(h.meta).latest(h.connectionId))!.schema);
      const table = model.tables.find((t) => t.name === 'pos_day_closes')!;
      const uniques = [...table.uniques, ...table.indexes.filter((i) => i.unique)].map((u) => u.columns.join(','));
      expect(uniques).toEqual(expect.arrayContaining(['day', 'client_key']));
      if (dialect !== 'sqlite') {
        // Named after the real table, so another app's `day_closes.day` never collides with it.
        const names = [...table.uniques, ...table.indexes].map((u) => u.name ?? '');
        expect(names).toEqual(expect.arrayContaining(['uq_pos_day_closes_day', 'uq_pos_day_closes_client_key']));
      }
      await h.run(`insert into pos_day_closes (day, client_key) values ('2026-07-28', 'a')`);
      await expect(h.run(`insert into pos_day_closes (day, client_key) values ('2026-07-28', 'b')`)).rejects.toThrow();
      // Empty is not a value: any number of rows may leave the key empty.
      await h.run(`insert into pos_day_closes (day) values ('2026-07-29')`);
      await h.run(`insert into pos_day_closes (day) values ('2026-07-30')`);
      await expect(h.run(`insert into pos_day_closes (day, client_key) values ('2026-07-31', 'a')`)).rejects.toThrow();
    }, 60_000);

    it('opens a patient\u2019s own rows through one identity, at the level each asks, and never another\u2019s', async () => {
      const h = (open = await harness(dialect));
      await claimPatients(h);
    }, 90_000);

    it('installs the emails an app sends, keeps an operator\u2019s edit across an update, and takes the rest back', async () => {
      const h = (open = await harness(dialect));
      await installEmails(h);
    }, 90_000);

    it('raises a found session by an emailed code, charges every try first, and changes an address only with care', async () => {
      const h = (open = await harness(dialect));
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-07-28T08:00:00Z'));
      try {
        await verifyByCode(h);
      } finally {
        vi.useRealTimers();
      }
    }, 120_000);

    it('adds sample visits whose statuses follow the clock, on working days, and settles their money', async () => {
      const h = (open = await harness(dialect));
      await sampleByClock(h);
    }, 90_000);

    it('sends an app\u2019s queued emails in each person\u2019s language on the venue\u2019s clock, once, and never to an example address', async () => {
      const h = (open = await harness(dialect));
      await sendEmails(h, dialect);
    });

    it('serves a kiosk\u2019s key only to its staff screen, answering only beside that sign-in, switched by the app, and following the version', async () => {
      const h = (open = await harness(dialect));
      await kioskKey(h, dialect);
    });

    it('queues an app\u2019s emails from its writes and its reminders, once each, never for sample or history, and caps a stranger', async () => {
      const h = (open = await harness(dialect));
      await produceEmails(h, dialect);
    });

    it('asks a proof of work before a stranger\u2019s booking and every claim, spent once', async () => {
      const h = (open = await harness(dialect));
      await proveAPerson(h);
    }, 90_000);

    it('stores a booking rule with every table it reads under its real, prefixed name', async () => {
      const h = (open = await harness(dialect));
      const id = { ref: 'id', type: 'int', role: 'pk' };
      const hhmm = (ref: string, nullable = false) => ({ ref, type: 'text', maxLength: 5, ...(nullable ? { nullable: true } : {}) });
      const weekday = { ref: 'weekday', type: 'enum', enum: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] };
      const booking = {
        start: 'starts_at',
        minutes: 'minutes',
        resource: 'clinician_id',
        kind: 'visit_type_id',
        countWhere: { column: 'status', values: ['booked', 'seen'] },
        eligible: { table: 'clinician_visit_types', resource: 'clinician_id', kind: 'visit_type_id', order: { table: 'clinicians', column: 'position', active: 'active' } },
        hours: {
          practice: { table: 'opening_hours', weekday: 'weekday', opens: 'opens', closes: 'closes', breakStart: 'break_start', breakEnd: 'break_end' },
          own: { table: 'clinician_hours', resource: 'clinician_id', weekday: 'weekday', opens: 'opens', closes: 'closes' },
        },
        closures: { table: 'closures', from: 'from_date', to: 'to_date', resource: 'clinician_id' },
        grid: { table: 'booking_settings', column: 'slot_minutes' },
        windowDays: 10,
        noticeMinutes: { table: 'booking_settings', column: 'notice_minutes' },
        cancel: { hours: { table: 'booking_settings', column: 'cancel_hours' }, mode: 'flag', flag: 'late_cancel', when: { column: 'status', to: 'cancelled' } },
      };
      const tables = [
        ...TABLES,
        { ref: 'booking_settings', columns: [id, { ref: 'slot_minutes', type: 'int', default: 15 }, { ref: 'notice_minutes', type: 'int', default: 60 }, { ref: 'cancel_hours', type: 'int', default: 24 }] },
        { ref: 'opening_hours', columns: [id, weekday, hhmm('opens'), hhmm('closes'), hhmm('break_start', true), hhmm('break_end', true)] },
        { ref: 'clinicians', columns: [id, { ref: 'position', type: 'int', default: 0 }, { ref: 'active', type: 'bool', default: true }] },
        { ref: 'visit_types', columns: [id, { ref: 'minutes', type: 'int', default: 15 }] },
        { ref: 'clinician_visit_types', columns: [id, { ref: 'clinician_id', type: 'fk', references: 'clinicians' }, { ref: 'visit_type_id', type: 'fk', references: 'visit_types' }] },
        { ref: 'clinician_hours', columns: [id, { ref: 'clinician_id', type: 'fk', references: 'clinicians' }, weekday, hhmm('opens'), hhmm('closes')] },
        { ref: 'closures', columns: [id, { ref: 'clinician_id', type: 'fk', references: 'clinicians', nullable: true }, { ref: 'from_date', type: 'date' }, { ref: 'to_date', type: 'date' }] },
        {
          ref: 'visits',
          booking,
          columns: [
            id,
            { ref: 'clinician_id', type: 'fk', references: 'clinicians', nullable: true },
            { ref: 'visit_type_id', type: 'fk', references: 'visit_types' },
            { ref: 'starts_at', type: 'timestamptz' },
            { ref: 'minutes', type: 'int', default: 15 },
            { ref: 'status', type: 'enum', enum: ['booked', 'seen', 'cancelled'], default: 'booked' },
            { ref: 'late_cancel', type: 'bool', default: false },
          ],
        },
      ];
      await stageManifest(h, { ...MANIFEST, requiredSchema: { prefixed: true, tables } });
      const installed = await post(h, '/apps/install');
      expect(installed.statusCode, installed.body).toBe(200);
      expect(installed.json().rules).toMatchObject({ written: 1, skipped: [] });

      const snapshot = (await snapshotsRepo(h.meta).latest(h.connectionId))!;
      const model = parseDatabaseModel(snapshot.schema);
      const real = (name: string) => model.tables.find((t) => t.name === name)!.id;
      const [row] = (await overridesRepo(h.meta).listForConnection(h.connectionId)).filter((o) => o.op === 'table.booking');
      expect(row).toMatchObject({ tableName: real('pos_visits'), columnName: null, origin: 'app' });
      const expected = {
        ...booking,
        eligible: { ...booking.eligible, table: real('pos_clinician_visit_types'), order: { ...booking.eligible.order, table: real('pos_clinicians') } },
        hours: {
          practice: { ...booking.hours.practice, table: real('pos_opening_hours') },
          own: { ...booking.hours.own, table: real('pos_clinician_hours') },
        },
        closures: { ...booking.closures, table: real('pos_closures') },
        grid: { table: real('pos_booking_settings'), column: 'slot_minutes' },
        noticeMinutes: { table: real('pos_booking_settings'), column: 'notice_minutes' },
        cancel: { ...booking.cancel, hours: { table: real('pos_booking_settings'), column: 'cancel_hours' } },
      };
      expect(row!.value).toEqual(expected);
      // No short name survives anywhere in the stored rule: every `table`, at any depth, is a real one.
      const named: string[] = [];
      const walk = (node: unknown): void => {
        if (typeof node !== 'object' || node === null) return;
        for (const [key, child] of Object.entries(node)) {
          if (key === 'table' && typeof child === 'string') named.push(child);
          else walk(child);
        }
      };
      walk(row!.value);
      expect(named).toHaveLength(8); // eligible, order, both hours, closures, grid, notice, cancel hours
      const realIds = new Set(model.tables.map((t) => t.id));
      expect(named.filter((table) => !realIds.has(table) || !table.includes('pos_'))).toEqual([]);

      // The write path sees it: on the effective table, and in the table's rules.
      const view = new SnapshotView(h.connectionId, applyOverrides(model, await overridesRepo(h.meta).listForConnection(h.connectionId, { status: 'active' })), new Map());
      const visits = view.table(real('pos_visits'));
      expect(visits.table?.booking).toEqual(expected);
      expect(tableRulesFor({ view, table: visits })?.booking).toEqual(expected);
    }, 60_000);

    it('keeps the rules its manifest asks for, and takes back only the ones still its own', async () => {
      const h = (open = await harness(dialect));
      const withRules = (version: string, rules: Record<string, Record<string, unknown>>) => ({
        ...MANIFEST,
        version,
        optionLists: { zones: { label: { 'en-US': 'Zones', 'de-DE': 'Bereiche' }, values: [{ value: 'bar' }, { value: 'terrace', label: 'Terrace' }] } },
        requiredSchema: {
          prefixed: true,
          tables: TABLES.map((table) => {
            const columns = table.columns.map((column) => {
              const own = rules[`${table.ref}.${column.ref}`];
              return own === undefined ? column : { ...column, rules: own };
            });
            if (table.ref !== 'shifts') return { ...table, columns };
            return {
              ...table,
              columns: [
                ...columns,
                { ref: 'zone', type: 'text', maxLength: 16, nullable: true, rules: rules['shifts.zone'] },
                { ref: 'state', type: 'enum', enum: ['open', 'closed'], default: 'open', rules: rules['shifts.state'] },
              ],
            };
          }),
        },
      });
      const v1 = withRules('1.0.0', {
        'menu_items.name': { required: true, validation: { maxLength: 60 } },
        'payments.method': { options: { values: [{ value: 'cash', label: { 'en-US': 'Cash', 'de-DE': 'Bar' } }, { value: 'card' }] } },
        'shifts.zone': { options: { list: 'zones' } },
        'shifts.state': { enumLabels: { labels: { open: 'Open', closed: { 'en-US': 'Closed' } } } },
      });
      await stageManifest(h, v1);
      const installed = await post(h, '/apps/install');
      expect(installed.statusCode, installed.body).toBe(200);
      expect(installed.json().rules).toEqual({ written: 5, removed: 0, lists: ['pos-zones'], skipped: [] });

      const overrides = overridesRepo(h.meta);
      const appRules = async () =>
        (await overrides.listForConnection(h.connectionId))
          .map((o) => ({ op: o.op, at: `${o.tableName.split('.').at(-1)!}.${o.columnName ?? ''}`, origin: o.origin, value: o.value }))
          .sort((a, b) => `${a.at}${a.op}`.localeCompare(`${b.at}${b.op}`));
      expect(await appRules()).toEqual([
        { op: 'column.required', at: 'pos_menu_items.name', origin: 'app', value: { required: true } },
        { op: 'column.validation', at: 'pos_menu_items.name', origin: 'app', value: { maxLength: 60 } },
        {
          op: 'column.options',
          at: 'pos_payments.method',
          origin: 'app',
          value: { values: [{ value: 'cash', label: { en_US: 'Cash', de_DE: 'Bar' } }, { value: 'card' }] },
        },
        { op: 'column.enumLabels', at: 'pos_shifts.state', origin: 'app', value: { labels: { open: 'Open', closed: { en_US: 'Closed' } } } },
        { op: 'column.options', at: 'pos_shifts.zone', origin: 'app', value: { list: 'pos-zones' } },
      ]);
      expect(await optionListsRepo(h.meta).findByKey('pos-zones')).toMatchObject({
        name: 'Zones',
        origin: 'app:pos',
        items: [{ value: 'bar' }, { value: 'terrace', label: 'Terrace' }],
      });

      // A Studio save rewrites every row under a new id, keeping each one's
      // origin: the rules are still the app's.
      const before = await overrides.listForConnection(h.connectionId);
      await overrides.replaceForConnection(
        h.connectionId,
        before.map((o) => ({ op: o.op, tableName: o.tableName, columnName: o.columnName, value: o.value, origin: o.origin })),
      );
      // The operator changes the payment methods, and keeps their own rule on the tip.
      const method = (await overrides.listForConnection(h.connectionId)).find((o) => o.columnName === 'method')!;
      await h.meta.db
        .updateTable('adminium_schema_overrides')
        .set({ value: JSON.stringify({ values: [{ value: 'cash' }, { value: 'card' }, { value: 'voucher' }] }) } as never)
        .where('id', '=', method.id)
        .execute();
      const tipTable = before.find((o) => o.tableName.endsWith('pos_payments'))!.tableName;
      await overrides.create({ connectionId: h.connectionId, op: 'column.required', tableName: tipTable, columnName: 'tip', value: { required: true } });

      // v2: no length limit, new labels, other methods, and a tip it wants required.
      await stageManifest(
        h,
        withRules('1.1.0', {
          'menu_items.name': { required: true },
          'payments.method': { options: { values: [{ value: 'cash' }, { value: 'card' }, { value: 'online' }] } },
          'payments.tip': { required: true },
          'shifts.zone': { options: { list: 'zones' } },
          'shifts.state': { enumLabels: { labels: { open: 'Open now', closed: 'Closed' } } },
        }),
      );
      const updated = await h.app.inject({ method: 'POST', url: '/apps/pos/update' });
      expect(updated.statusCode, updated.body).toBe(200);
      const rules = updated.json().app.rules;
      expect(rules).toMatchObject({ written: 1, removed: 1, lists: [] });
      // The operator's two rules win: their methods, their tip.
      expect(rules.skipped.map((skip: { column: string; op: string }) => `${skip.column}:${skip.op}`).sort()).toEqual([
        'method:column.options',
        'tip:column.required',
      ]);
      expect((await appRules()).map((r) => `${r.at}:${r.op}:${r.origin}`)).toEqual([
        'pos_menu_items.name:column.required:app',
        'pos_payments.method:column.options:app',
        'pos_payments.tip:column.required:user',
        'pos_shifts.state:column.enumLabels:app',
        'pos_shifts.zone:column.options:app',
      ]);
      expect((await appRules()).find((r) => r.at === 'pos_shifts.state')?.value).toEqual({
        labels: { open: 'Open now', closed: 'Closed' },
      });

      // After the update the operator relabels the shift states — the rule the
      // app just recorded, under the id it recorded.
      const state = (await overrides.listForConnection(h.connectionId)).find((o) => o.columnName === 'state')!;
      await h.meta.db
        .updateTable('adminium_schema_overrides')
        .set({ value: JSON.stringify({ labels: { open: 'Serving', closed: 'Closed' } }) } as never)
        .where('id', '=', state.id)
        .execute();

      // Uninstall takes back the two still as it wrote them.
      const plan = (await h.app.inject({ method: 'GET', url: '/apps/pos/uninstall-plan' })).json();
      expect(plan.rules).toBe(2);
      const removed = await h.app.inject({ method: 'DELETE', url: '/apps/pos' });
      expect(removed.statusCode, removed.body).toBe(200);
      expect(removed.json().removed.rules).toBe(2);
      expect((await appRules()).map((r) => `${r.at}:${r.op}`)).toEqual([
        'pos_payments.method:column.options',
        'pos_payments.tip:column.required',
        'pos_shifts.state:column.enumLabels',
      ]);
      // The list stays: the operator's own rules may name it.
      expect(await optionListsRepo(h.meta).findByKey('pos-zones')).not.toBeNull();
    }, 60_000);

    it('names its tables and columns in every language it speaks, and the operator’s own name wins', async () => {
      const h = (open = await harness(dialect));
      const labelled = {
        ...MANIFEST,
        requiredSchema: {
          prefixed: true,
          tables: TABLES.map((table) => {
            if (table.ref === 'menu_items') {
              return {
                ...table,
                label: { 'en-US': 'Menu item', 'de-DE': 'Gericht' },
                labelPlural: { 'en-US': 'Menu items', 'de-DE': 'Gerichte' },
                keyField: 'name',
                columns: table.columns.map((column) =>
                  column.ref === 'price' ? { ...column, label: { 'en-US': 'Unit price', 'de-DE': 'Stückpreis' } } : column,
                ),
              };
            }
            if (table.ref === 'payments') {
              return { ...table, columns: table.columns.map((column) => (column.ref === 'method' ? { ...column, label: 'How paid' } : column)) };
            }
            if (table.ref === 'shifts') {
              return {
                ...table,
                columns: [
                  ...table.columns,
                  { ref: 'state', type: 'enum', enum: ['open', 'closed'], default: 'open', rules: { enumLabels: { labels: { open: 'Open now', closed: 'Closed' } } } },
                ],
              };
            }
            return table;
          }),
        },
      };
      await stageManifest(h, labelled);
      const overrides = overridesRepo(h.meta);
      const installed = await post(h, '/apps/install');
      expect(installed.statusCode, installed.body).toBe(200);
      expect(installed.json().rules).toMatchObject({ written: 5, skipped: [] });
      const labels = async () =>
        (await overrides.listForConnection(h.connectionId))
          .filter((o) => o.op === 'table.label' || o.op === 'table.keyField' || o.op === 'column.label')
          .map((o) => ({ op: o.op, at: `${o.tableName.split('.').at(-1)!}.${o.columnName ?? ''}`, origin: o.origin, value: o.value }))
          .sort((a, b) => `${a.at}${a.op}`.localeCompare(`${b.at}${b.op}`));
      expect(await labels()).toEqual([
        { op: 'column.label', at: 'pos_menu_items.price', origin: 'app', value: { label: { en_US: 'Unit price', de_DE: 'Stückpreis' } } },
        { op: 'table.keyField', at: 'pos_menu_items.', origin: 'app', value: { column: 'name' } },
        {
          op: 'table.label',
          at: 'pos_menu_items.',
          origin: 'app',
          value: { label: { en_US: 'Menu item', de_DE: 'Gericht' }, labelPlural: { en_US: 'Menu items', de_DE: 'Gerichte' } },
        },
        { op: 'column.label', at: 'pos_payments.method', origin: 'app', value: { label: 'How paid' } },
      ]);

      // A form reads them in its reader's language: the title's noun, a field's name, a link's.
      const items = (await overrides.listForConnection(h.connectionId)).find((o) => o.op === 'table.label')!.tableName;
      const german = await columnFactsFor(h.meta, h.connectionId, items, 'de_DE');
      const english = await columnFactsFor(h.meta, h.connectionId, items);
      expect([german?.table.labelSingular, english?.table.labelSingular]).toEqual(['Gericht', 'Menu item']);
      const priceLabel = (block: typeof german) => block?.columns.find((c) => c.spec['name'] === 'price')?.spec['label'];
      expect([priceLabel(german), priceLabel(english)]).toEqual(['Stückpreis', 'Unit price']);
      expect([german?.table.labelPlural, english?.table.labelPlural]).toEqual(['Gerichte', 'Menu items']);
      // A reference names its table the reader's way; an enum names its values.
      const lines = items.replace('pos_menu_items', 'pos_lines');
      const itemRef = (await columnFactsFor(h.meta, h.connectionId, lines, 'de_DE'))?.columns.find((c) => c.spec['name'] === 'item_id');
      expect((itemRef?.spec['fk'] as { label?: string } | undefined)?.label).toBe('Gerichte');
      const shifts = items.replace('pos_menu_items', 'pos_shifts');
      const state = (await columnFactsFor(h.meta, h.connectionId, shifts))?.columns.find((c) => c.spec['name'] === 'state');
      expect(state?.enumLabels).toEqual({ open: 'Open now', closed: 'Closed' });
      // The page the app ships is composed with them: its list heads the column the app's way.
      const menu = await pagesRepo(h.meta).findBySlug(h.connectionId, 'pos-menu');
      expect(JSON.stringify(menu?.config)).toContain('"label":"Unit price"');

      // The operator renames the payment method; an update leaves their name alone.
      const method = (await overrides.listForConnection(h.connectionId)).find((o) => o.op === 'column.label' && o.columnName === 'method')!;
      await overrides.delete(method.id);
      await overrides.create({ connectionId: h.connectionId, op: 'column.label', tableName: method.tableName, columnName: 'method', value: { label: 'Tender' } });
      await stageManifest(h, { ...labelled, version: '1.1.0' });
      const updated = await h.app.inject({ method: 'POST', url: '/apps/pos/update' });
      expect(updated.statusCode, updated.body).toBe(200);
      expect(updated.json().app.rules.skipped.map((skip: { column: string; op: string }) => `${skip.column}:${skip.op}`)).toEqual([
        'method:column.label',
      ]);

      // Uninstall takes back the three still its own; the operator's stays.
      const removed = await h.app.inject({ method: 'DELETE', url: '/apps/pos' });
      expect(removed.statusCode, removed.body).toBe(200);
      expect(removed.json().removed.rules).toBe(4);
      expect((await labels()).map((r) => `${r.at}:${r.op}:${r.origin}`)).toEqual(['pos_payments.method:column.label:user']);
    }, 60_000);

    it('shows a choice column’s values in each reader’s language on a card and in the schema, and an older row as it was', async () => {
      const h = (open = await harness(dialect));
      const stateLabels = { waiting: { 'en-US': 'Waiting', 'de-DE': 'Wartend' }, seen: { 'en-US': 'Seen', 'de-DE': 'Behandelt' } };
      await stageManifest(h, {
        ...MANIFEST,
        requiredSchema: {
          prefixed: true,
          tables: TABLES.map((table) =>
            table.ref !== 'shifts'
              ? table
              : {
                  ...table,
                  columns: [
                    ...table.columns,
                    { ref: 'state', type: 'enum', enum: ['waiting', 'seen'], default: 'waiting', rules: { enumLabels: { labels: stateLabels, tones: { waiting: 'warn' } } } },
                  ],
                },
          ),
        },
      });
      const installed = await post(h, '/apps/install');
      expect(installed.statusCode, installed.body).toBe(200);

      // Kept in every language, keyed the way Adminium's locales are.
      const overrides = overridesRepo(h.meta);
      const rule = (await overrides.listForConnection(h.connectionId)).find((o) => o.op === 'column.enumLabels')!;
      expect(rule.value).toEqual({
        labels: { waiting: { en_US: 'Waiting', de_DE: 'Wartend' }, seen: { en_US: 'Seen', de_DE: 'Behandelt' } },
        tones: { waiting: 'warn' },
      });

      await h.run(`insert into pos_shifts (state) values ('waiting')`);
      await h.run(`insert into pos_shifts (state) values ('waiting')`);
      await h.run(`insert into pos_shifts (state) values ('seen')`);
      const users = usersRepo(h.meta);
      const anna = await users.create({ email: 'anna@test', name: 'Anna' });
      const ada = await users.create({ email: 'ada@test', name: 'Ada' });
      await userPrefsRepo(h.meta).set(anna.id, { locale: 'de_DE' });
      await userPrefsRepo(h.meta).set(ada.id, { locale: 'en_US' });

      const source = { name: 'pos_shifts', type: 'table' };
      const byState = { connectionId: h.connectionId, kind: 'table-query', source, shape: 'categorical', aggregations: [{ fn: 'count', alias: 'shifts' }], groupBy: ['state'] };
      const list = { connectionId: h.connectionId, kind: 'table-query', source, shape: 'record-list', select: ['id', 'state'], orderBy: [{ column: 'id', dir: 'asc' }] };
      const readCards = async (app: Awaited<ReturnType<typeof readingApp>>, user: string) => {
        const res = await app.inject({
          method: 'POST',
          url: '/widget-data/batch',
          headers: { 'x-user': user },
          payload: { requests: [{ instanceId: 'by-state', descriptor: byState }, { instanceId: 'list', descriptor: list }] },
        });
        expect(res.statusCode, res.body).toBe(200);
        const results = res.json().results as Record<string, { ok: boolean; result: Record<string, unknown> }>;
        const legend = (results['by-state']!.result['items'] as { key: string; label: string }[]).map((item) => `${item.key}=${item.label}`).sort();
        const state = (results['list']!.result['columns'] as { name: string; enumLabels?: Record<string, string> }[]).find((c) => c.name === 'state');
        return { legend, pill: state?.enumLabels };
      };

      const reader = await readingApp(h);
      try {
        // The English reader first, so the German one would get a kept English answer if the language were not part of it.
        expect(await readCards(reader, ada.id)).toEqual({ legend: ['seen=Seen', 'waiting=Waiting'], pill: { waiting: 'Waiting', seen: 'Seen' } });
        expect(await readCards(reader, anna.id)).toEqual({ legend: ['seen=Behandelt', 'waiting=Wartend'], pill: { waiting: 'Wartend', seen: 'Behandelt' } });

        // The schema reads them in the language asked for.
        const schemaState = async (query: string) => {
          const res = await reader.inject({ method: 'GET', url: `/connections/${h.connectionId}/schema${query}`, headers: { 'x-user': anna.id } });
          expect(res.statusCode, res.body).toBe(200);
          const model = res.json().model as { tables: { name: string; columns: { name: string; enumLabels?: Record<string, string> }[] }[] };
          return model.tables.find((t) => t.name === 'pos_shifts')?.columns.find((c) => c.name === 'state')?.enumLabels;
        };
        expect(await schemaState('?locale=de_DE')).toEqual({ waiting: 'Wartend', seen: 'Behandelt' });
        expect(await schemaState('')).toEqual({ waiting: 'Waiting', seen: 'Seen' });
      } finally {
        await reader.close();
      }

      // An install made before labels were kept per language holds plain strings: every reader still gets them.
      await overrides.delete(rule.id);
      await overrides.create({
        connectionId: h.connectionId,
        op: 'column.enumLabels',
        tableName: rule.tableName,
        columnName: 'state',
        value: { labels: { waiting: 'Waiting', seen: 'Seen' } },
        origin: 'app',
      });
      const later = await readingApp(h);
      try {
        expect(await readCards(later, anna.id)).toEqual({ legend: ['seen=Seen', 'waiting=Waiting'], pill: { waiting: 'Waiting', seen: 'Seen' } });
      } finally {
        await later.close();
      }
    }, 60_000);

    it('installs its roles with their grants filled in, seeded once, and suspended while it is off', async () => {
      const h = (open = await harness(dialect));
      const withRoles = (version: string, cashier: string[]) => ({
        ...MANIFEST,
        version,
        roles: [
          { key: 'cashier', name: 'POS cashier', screensOnly: true, permissions: cashier },
          { key: 'manager', name: 'POS manager', cloneFrom: 'cashier', permissions: ['table:@payments:delete', 'page:@pos-menu:edit'] },
        ],
      });
      const v1 = ['table:@menu_items:read', 'table:@payments:read', 'table:@payments:create', 'page:@pos-menu:view', 'app:@:staff'];
      await stageManifest(h, withRoles('1.0.0', v1));
      const installed = await post(h, '/apps/install');
      expect(installed.statusCode, installed.body).toBe(200);
      // Five for the cashier (its staff screens included), seven for the manager.
      expect(installed.json().roles).toEqual({ created: ['pos-cashier', 'pos-manager'], seeded: 12 });

      const roles = rolesRepo(h.meta);
      const cashier = (await roles.findBySlug('pos-cashier'))!;
      expect(cashier).toMatchObject({ appKey: 'pos', screensOnly: true, name: 'POS cashier' });
      const rowsOf = async (roleId: string) =>
        Object.fromEntries(
          (await permissionsRepo(h.meta).listForRole(roleId)).map((row) => [
            row.resourceKind === 'table'
              ? row.resourceRef.split('/')[1]!.split('.').at(-1)!
              : `${row.resourceKind}:${row.resourceKind === 'app' ? row.resourceRef : 'page'}`,
            Object.entries(row.actions as Record<string, boolean>)
              .filter(([, on]) => on)
              .map(([action]) => action)
              .sort(),
          ]),
        );
      expect(await rowsOf(cashier.id)).toEqual({
        pos_menu_items: ['read'],
        pos_payments: ['create', 'read'],
        'page:page': ['view'],
        'app:pos': ['staff'],
      });
      const manager = (await roles.findBySlug('pos-manager'))!;
      expect(await rowsOf(manager.id)).toEqual({
        pos_menu_items: ['read'],
        pos_payments: ['create', 'delete', 'read'],
        'page:page': ['edit', 'view'],
        'app:pos': ['staff'],
      });

      // The operator takes creating payments away from the cashier.
      const payments = (await permissionsRepo(h.meta).listForRole(cashier.id)).find((row) => row.resourceRef.endsWith('pos_payments'))!;
      await permissionsRepo(h.meta).grant(cashier.id, 'table', payments.resourceRef, { ...(payments.actions as object), create: false } as never);

      // v1.1 asks for shifts too: only that is given (to the cashier, and to
      // the manager that clones it); the narrowing stays.
      await stageManifest(h, withRoles('1.1.0', [...v1, 'table:@shifts:read']));
      const updated = await h.app.inject({ method: 'POST', url: '/apps/pos/update' });
      expect(updated.statusCode, updated.body).toBe(200);
      expect(updated.json().app.roles).toEqual({ created: [], seeded: 2 });
      expect(await rowsOf(cashier.id)).toEqual({
        pos_menu_items: ['read'],
        pos_payments: ['read'],
        pos_shifts: ['read'],
        'page:page': ['view'],
        'app:pos': ['staff'],
      });

      // Switched off, its roles grant nothing; nothing about them is deleted.
      const on = await resolveForRoles(h.meta, [cashier]);
      expect(on.grants.size).toBeGreaterThan(0);
      const row = (await manifestsRepo(h.meta, { encrypt: (v) => v, decrypt: (v) => v }).list('app'))[0]!;
      await manifestsRepo(h.meta, { encrypt: (v) => v, decrypt: (v) => v }).setStatus(row.row.id, 'disabled');
      expect((await resolveForRoles(h.meta, [cashier])).grants.size).toBe(0);
      await manifestsRepo(h.meta, { encrypt: (v) => v, decrypt: (v) => v }).setStatus(row.row.id, 'installed');

      // Uninstalled and installed again: the roles come back with every grant.
      expect((await h.app.inject({ method: 'DELETE', url: '/apps/pos' })).statusCode).toBe(200);
      expect(await roles.findBySlug('pos-cashier')).toBeNull();
      await stageManifest(h, withRoles('1.1.0', [...v1, 'table:@shifts:read']));
      const again = await h.app.inject({
        method: 'POST',
        url: '/apps/install',
        payload: { key: 'pos', version: '1.1.0', connectionId: h.connectionId },
      });
      expect(again.statusCode, again.body).toBe(200);
      expect(again.json().roles.created).toEqual(['pos-cashier', 'pos-manager']);
      const back = (await roles.findBySlug('pos-cashier'))!;
      expect((await rowsOf(back.id))['pos_payments']).toEqual(['create', 'read']);
    }, 60_000);

    it('makes the public access its manifest asks for, as the app’s own, and takes it back at uninstall', async () => {
      const h = (open = await harness(dialect));
      const withAccess = (version: string) => ({
        ...MANIFEST,
        version,
        publicAccess: [
          { table: 'menu_items', methods: ['GET'], select: ['id', 'name', 'price'] },
          { table: 'payments', methods: ['GET'], claim: { match: ['id', 'method'] } },
        ],
      });
      await stageManifest(h, withAccess('1.0.0'));
      const planned = await post(h, '/apps/plan');
      expect(planned.statusCode, planned.body).toBe(200);
      const access = planned.json().plan.publicAccess;
      expect(access.canGrant).toBe(true);
      expect(access.endpoints.map((e: { ref: string; pending: boolean }) => [e.ref, e.pending])).toEqual([
        ['pos_menu_items', false],
        ['pos_payments_claimed', false],
      ]);
      // `self` is an allowed origin and the database has a time zone: only the switch is said.
      expect(access.warnings.map((w: { code: string }) => w.code)).toEqual(['PUBLIC_API_OFF']);

      const installed = await post(h, '/apps/install');
      expect(installed.statusCode, installed.body).toBe(200);
      const made = installed.json().publicAccess;
      expect(made.endpoints).toEqual(['pos_menu_items', 'pos_payments_claimed']);
      expect(made.keyId).not.toBeNull();

      const endpoints = () => publicEndpointsRepo(h.meta).listByConnection(h.connectionId);
      const saved = await endpoints();
      expect(saved.map((e) => [e.ref, e.managedBy]).sort()).toEqual([
        ['pos_menu_items', 'pos'],
        ['pos_payments_claimed', 'pos'],
      ]);
      const claimed = JSON.parse(saved.find((e) => e.ref === 'pos_payments_claimed')!.definition) as Record<string, unknown>;
      expect(claimed['identity']).toEqual({ strategy: 'lookup', match: ['id', 'method'], column: 'id' });
      expect(claimed['auth']).toEqual({ role: 'authenticated' });
      const key = (await publicKeysRepo(h.meta).findById(made.keyId))!;
      expect(key).toMatchObject({ name: 'Point of Sale · guests', kind: 'browser', appKey: 'pos', managedBy: 'pos', side: 'customer' });

      // An update saves the endpoints again and keeps the one key.
      await stageManifest(h, withAccess('1.1.0'));
      const updated = await h.app.inject({ method: 'POST', url: '/apps/pos/update' });
      expect(updated.statusCode, updated.body).toBe(200);
      expect(updated.json().app.publicAccess).toEqual({ endpoints: ['pos_menu_items', 'pos_payments_claimed'], keyId: null, keys: {}, skipped: [] });
      expect((await publicKeysRepo(h.meta).list()).filter((k) => k.managedBy === 'pos')).toHaveLength(1);

      // Uninstalled: the key is revoked and the endpoints are gone.
      expect((await h.app.inject({ method: 'DELETE', url: '/apps/pos' })).statusCode).toBe(200);
      expect((await publicKeysRepo(h.meta).findById(made.keyId))!.revokedAt).not.toBeNull();
      // …and stops at once: the resolver's cached scope is dropped.
      expect(INVALIDATED_KEYS).toContain(made.keyId);
      expect(await endpoints()).toEqual([]);
    }, 60_000);

    it('holds the app’s own key to the safe list, and an update may not widen it', async () => {
      const h = (open = await harness(dialect));
      const withAccess = (version: string, select: string[]) => ({
        ...MANIFEST,
        version,
        publicAccess: [
          { table: 'menu_items', methods: ['GET'], select },
          { table: 'payments', methods: ['GET', 'PATCH'], writable: ['tip'], claim: { match: ['id', 'method'] } },
        ],
      });
      await stageManifest(h, withAccess('1.0.0', ['id', 'name']));
      const installed = await post(h, '/apps/install');
      expect(installed.statusCode, installed.body).toBe(200);
      const keyId = installed.json().publicAccess.keyId as string;

      const views = createPublicViews(h.meta);
      const service = createEndpointService({
        meta: h.meta,
        viewFor: views.viewFor,
        tenantConfigOf: async (id) => (await connectionTenantConfig(h.meta, id)) ?? undefined,
      });
      const stored = async (ref: string) => {
        const row = await publicEndpointsRepo(h.meta).findByRef(h.connectionId, ref);
        const parsed = parseDefinition(row!.definition);
        if (!parsed.ok) throw new Error('unparseable');
        return parsed.definition;
      };
      const refusal = async (ref: string, change: (d: Awaited<ReturnType<typeof stored>>) => void) => {
        const definition = structuredClone(await stored(ref));
        change(definition);
        try {
          await service.saveEndpoint({ connectionId: h.connectionId, ref, definition });
        } catch (error) {
          if (error instanceof EndpointSaveRefused) return error.issues.map((i) => i.code);
          throw error;
        }
        return [];
      };
      // A write method, more columns, the sign-in taken away: each refused.
      expect(await refusal('pos_menu_items', (d) => d.methods.push('POST'))).toContain('KEY_MANAGED_UNSAFE');
      expect(await refusal('pos_menu_items', (d) => d.select.push('price'))).toContain('KEY_MANAGED_UNSAFE');
      expect(await refusal('pos_payments_claimed', (d) => d.methods.push('DELETE'))).toContain('KEY_MANAGED_UNSAFE');
      // A narrowing is fine.
      expect(await refusal('pos_menu_items', (d) => d.select.splice(1))).toEqual([]);

      // The app's own key may not be made with DELETE, nor with PATCH where no guest signs in;
      // a hand-made key may.
      const shifts = structuredClone(await stored('pos_menu_items'));
      const table = shifts.source.replace(/menu_items$/, 'shifts');
      await service.saveEndpoint({
        connectionId: h.connectionId,
        ref: 'pos_shifts',
        definition: { ...shifts, path: '/pos_shifts', source: table, select: ['id'], methods: ['GET', 'PATCH', 'DELETE'], writable: ['opened_at'] },
      });
      const made = (methods: string[], managedBy: string | null) =>
        service
          .createKey({
            connectionId: h.connectionId,
            name: 'another',
            access: [{ ref: 'pos_shifts', methods: methods as never }],
            secret: { prefix: 'pk_x', tokenHash: `h${String(Math.random())}`, tokenEncrypted: 'e' },
            managedBy,
          })
          .then(
            () => [],
            (error: { issues?: { code: string }[] }) => [...new Set((error.issues ?? []).map((i) => i.code))],
          );
      expect(await made(['GET'], 'pos')).toEqual([]);
      expect(await made(['GET', 'PATCH'], 'pos')).toEqual(['KEY_MANAGED_UNSAFE']);
      expect(await made(['GET', 'DELETE'], 'pos')).toEqual(['KEY_MANAGED_UNSAFE']);
      expect(await made(['GET', 'PATCH', 'DELETE'], null)).toEqual([]);

      // v1.1 shows one more column: the key keeps what was allowed, and the reply says why.
      await stageManifest(h, withAccess('1.1.0', ['id', 'name', 'price']));
      const updated = await h.app.inject({ method: 'POST', url: '/apps/pos/update' });
      expect(updated.statusCode, updated.body).toBe(200);
      const access = updated.json().app.publicAccess;
      expect(access.skipped.map((s: { ref: string }) => s.ref)).toEqual(['pos_menu_items']);
      expect(access.skipped[0].reason).toContain('would see more of');
      expect((await stored('pos_menu_items')).select).toEqual(['id']);
      expect((await publicKeysRepo(h.meta).findById(keyId))!.revokedAt).toBeNull();
    }, 60_000);

    it('copies a price, numbers a ticket and codes a booking, whoever writes', async () => {
      const h = (open = await harness(dialect));
      const decided = {
        ...MANIFEST,
        requiredSchema: {
          prefixed: true,
          tables: [
            TABLES[0],
            {
              ref: 'lines',
              columns: [
                { ref: 'id', type: 'bigint', role: 'pk' },
                { ref: 'item_id', type: 'fk', references: 'menu_items' },
                { ref: 'unit_price', type: 'money', nullable: true, rules: { copy: { via: 'item_id', from: 'price' } } },
              ],
            },
            {
              ref: 'tickets',
              columns: [
                { ref: 'id', type: 'int', role: 'pk' },
                { ref: 'number', type: 'text', maxLength: 16, nullable: true, rules: { sequence: { start: 100 } } },
                { ref: 'covers', type: 'int', nullable: true, rules: { validation: { min: 1 } } },
              ],
            },
            {
              ref: 'bookings',
              columns: [
                { ref: 'id', type: 'int', role: 'pk' },
                { ref: 'code', type: 'text', rules: { code: { prefix: 'MR-', length: 4 } } },
                { ref: 'name', type: 'text', maxLength: 40 },
              ],
            },
          ],
        },
      };
      await stageManifest(h, decided);
      const installed = await post(h, '/apps/install');
      expect(installed.statusCode, installed.body).toBe(200);
      expect(installed.json().rules.written).toBe(4);

      // The view every write path builds: the snapshot with its overrides.
      const snapshot = (await snapshotsRepo(h.meta).latest(h.connectionId))!;
      const view = new SnapshotView(
        h.connectionId,
        applyOverrides(parseDatabaseModel(snapshot.schema), await overridesRepo(h.meta).listForConnection(h.connectionId, { status: 'active' })),
        new Map(),
      );
      const { db, dialect: d } = await h.manager.data(h.connectionId);
      const targetOf = (name: string): WriteTarget => ({
        connectionId: h.connectionId,
        view,
        table: view.table(view.model.tables.find((t) => t.name === name)!.id),
        db,
        dialect: d,
      });
      const writes = createWriteService({ sequences: documentSequencesRepo(h.meta) });
      const context = { origin: 'dashboard' as const, hops: 0, actor: null, request: null };
      const create = (name: string, values: Record<string, unknown>, target = targetOf(name)) =>
        writes.create({ target, values, context, announce: async () => {} });

      const item = await create('pos_menu_items', { name: 'Flat white', price: 4.5 });
      // Copied from the item; a value the till sends wins (`default` mode).
      expect(Number((await create('pos_lines', { item_id: item['id'] }))['unit_price'])).toBe(4.5);
      expect(Number((await create('pos_lines', { item_id: item['id'], unit_price: 3 }))['unit_price'])).toBe(3);

      // Numbered from the rule's start, past a sample's own number; a refused
      // write burns none.
      expect((await create('pos_tickets', { number: 'S-1042' }))['number']).toBe('S-1042');
      expect((await create('pos_tickets', {}))['number']).toBe('100');
      await expect(create('pos_tickets', { covers: 0 })).rejects.toThrow('Some values were refused.');
      expect((await create('pos_tickets', {}))['number']).toBe('101');

      // A code, and a fresh one when the first collides.
      const code = (await create('pos_bookings', { name: 'Ada' }))['code'] as string;
      expect(code).toMatch(/^MR-[0-9A-HJKMNP-TV-Z]{4}$/);
      const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
      const dice = (text: string) => [...text].map((c) => CROCKFORD.indexOf(c));
      forcedInts.push(...dice(code.slice(3)), ...dice('7Q2K'));
      expect((await create('pos_bookings', { name: 'Grace' }))['code']).toBe('MR-7Q2K');
      // …inside a transaction too, where Postgres would otherwise abort it.
      forcedInts.push(...dice('7Q2K'), ...dice('8R3M'));
      const inTx = await db.transaction().execute((trx) => create('pos_bookings', { name: 'Hedy' }, { ...targetOf('pos_bookings'), db: trx }));
      expect(inTx['code']).toBe('MR-8R3M');
      expect(forcedInts).toEqual([]);

      // The multi-row paths — an import's fast path and a bulk write — decide the same.
      const checked = await writes.check('create', targetOf('pos_tickets'), context, [{}, { covers: 0 }, {}]);
      expect(checked.rows.map((row) => row?.['number'] ?? null)).toEqual(['102', null, '103']);
      const prepared = await writes.beforeEach('create', targetOf('pos_lines'), context, [{ values: { item_id: item['id'] } }]);
      expect(Number(prepared[0]!.values['unit_price'])).toBe(4.5);

      // And a public endpoint may not offer a guest any of them.
      const bookings = targetOf('pos_bookings').table;
      const definition = {
        path: '/pos_bookings',
        source: bookings.id,
        methods: ['POST'],
        select: ['id', 'code', 'name'],
        writable: ['code', 'name'],
        filters: [],
        pagination: { default_limit: 50, max_limit: 200, order: 'id.asc' },
        auth: { role: 'anon' },
        rate_limit: { requests: 60, window: '1m' },
        response: { shape: 'object', envelope: 'data' },
      } as never;
      expect(endpointIssues(definition, { ref: 'pos_bookings', view }).map((i) => [i.code, i.column])).toEqual([
        ['ENDPOINT_WRITABLE_DECIDED', 'code'],
      ]);
    }, 60_000);

    it('holds a slot to its limit, on the venue clock, and keeps a ticket’s total in step with its lines', async () => {
      const h = (open = await harness(dialect));
      const guarded = {
        ...MANIFEST,
        requiredSchema: {
          prefixed: true,
          tables: [
            TABLES[0],
            { ref: 'booking_rules', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'covers', type: 'int' }] },
            {
              ref: 'reservations',
              columns: [
                { ref: 'id', type: 'int', role: 'pk' },
                { ref: 'starts_at', type: 'timestamptz' },
                { ref: 'party', type: 'int' },
                { ref: 'status', type: 'enum', enum: ['booked', 'cancelled'] },
              ],
              capacity: {
                slot: 'starts_at',
                amount: 'party',
                perSlot: { table: 'booking_rules', column: 'covers' },
                countWhere: { column: 'status', values: ['booked'] },
                slotMinutes: 30,
                windowDays: 5,
                opens: '17:00',
                closes: '21:00',
              },
            },
            {
              ref: 'tickets',
              columns: [
                { ref: 'id', type: 'int', role: 'pk' },
                { ref: 'subtotal', type: 'money', nullable: true, rules: { rollup: { from: 'lines', via: 'ticket_id', sum: 'unit_price', times: 'qty' } } },
              ],
            },
            {
              ref: 'lines',
              columns: [
                { ref: 'id', type: 'bigint', role: 'pk' },
                { ref: 'ticket_id', type: 'fk', references: 'tickets' },
                { ref: 'unit_price', type: 'money' },
                { ref: 'qty', type: 'int' },
              ],
            },
          ],
        },
        publicAccess: [{ table: 'reservations', kind: 'availability', methods: ['GET'] }],
      };
      await stageManifest(h, guarded);
      const installed = await post(h, '/apps/install');
      expect(installed.statusCode, installed.body).toBe(200);
      expect(installed.json().rules).toMatchObject({ written: 2, skipped: [] });
      // The guests' free-or-full endpoint is made, on the guarded table.
      expect(installed.json().publicAccess.endpoints).toEqual(['pos_reservations_availability']);

      const snapshot = (await snapshotsRepo(h.meta).latest(h.connectionId))!;
      const view = new SnapshotView(
        h.connectionId,
        applyOverrides(parseDatabaseModel(snapshot.schema), await overridesRepo(h.meta).listForConnection(h.connectionId, { status: 'active' })),
        new Map(),
      );
      const { db, dialect: d } = await h.manager.data(h.connectionId);
      const zone = 'Europe/London';
      const targetOf = (name: string): WriteTarget => ({
        connectionId: h.connectionId,
        view,
        table: view.table(view.model.tables.find((t) => t.name === name)!.id),
        db,
        dialect: d,
        timezone: zone,
      });
      const writes = createWriteService({ sequences: documentSequencesRepo(h.meta) });
      const context = { origin: 'dashboard' as const, hops: 0, actor: null, request: null };
      // As the data routes prepare a value: a naive timestamp as this server's wall clock.
      const prepared = (name: string, values: Record<string, unknown>) => {
        const table = targetOf(name).table;
        return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, normalizeWriteValue(table.columns.get(k)!, v)]));
      };
      const create = (name: string, values: Record<string, unknown>) =>
        writes.create({ target: targetOf(name), values: prepared(name, values), context, announce: async () => {} });
      const update = (name: string, id: unknown, values: Record<string, unknown>) =>
        writes.update({ target: targetOf(name), pk: { id }, values: prepared(name, values), context, announce: async () => {} });
      const failure = (run: Promise<unknown>) =>
        run.then(
          () => 'written',
          (error: { code?: string; details?: { fields?: Record<string, unknown> } }) =>
            error.code === 'VALIDATION_FAILED' ? `refused:${Object.keys(error.details?.fields ?? {}).join(',')}` : String(error.code),
        );

      /** `days` from today at `hh:mm` on the venue's clock, as an ISO instant. */
      const at = (days: number, hh: number, mm = 0) => {
        const today = venueClock(new Date(), zone).day;
        const guess = Date.parse(`${today}T00:00:00Z`) + days * 86_400_000 + (hh * 60 + mm) * 60_000;
        const drift = venueClock(new Date(guess), zone).minute - (hh * 60 + mm);
        return new Date(guess - drift * 60_000).toISOString();
      };

      await create('pos_booking_rules', { covers: 6 });
      const slot = at(1, 19);
      const first = await create('pos_reservations', { starts_at: slot, party: 4, status: 'booked' });
      expect(await failure(create('pos_reservations', { starts_at: slot, party: 3, status: 'booked' }))).toBe('CAPACITY_FULL');
      const second = await create('pos_reservations', { starts_at: slot, party: 2, status: 'booked' });
      // A cancelled booking holds no seats.
      expect(await failure(create('pos_reservations', { starts_at: slot, party: 5, status: 'cancelled' }))).toBe('written');
      await update('pos_reservations', first['id'], { status: 'cancelled' });
      await create('pos_reservations', { starts_at: slot, party: 3, status: 'booked' });
      // A change to a booking leaves its own party out of the sum: 3 + 3 fits, 3 + 4 does not.
      expect(await failure(update('pos_reservations', second['id'], { party: 3 }))).toBe('written');
      expect(await failure(update('pos_reservations', second['id'], { party: 4 }))).toBe('CAPACITY_FULL');
      // The limit is the venue's setting, read at write time.
      await db.updateTable(targetOf('pos_booking_rules').table.id as never).set({ covers: 7 } as never).execute();
      expect(await failure(update('pos_reservations', second['id'], { party: 4 }))).toBe('written');

      // Only a slot the venue offers: its grid, its hours, its window, not the past.
      const offered = (iso: string) => failure(create('pos_reservations', { starts_at: iso, party: 1, status: 'booked' }));
      expect(await offered(at(1, 19, 15))).toBe('refused:starts_at');
      expect(await offered(at(1, 16, 30))).toBe('refused:starts_at');
      expect(await offered(at(1, 21))).toBe('refused:starts_at');
      expect(await offered(at(1, 20, 30))).toBe('written');
      expect(await offered(at(6, 19))).toBe('refused:starts_at');
      expect(await offered(at(-1, 19))).toBe('refused:starts_at');

      // Five guests at once for six seats, two each: three get in.
      const busy = at(2, 18);
      const outcomes = await Promise.all(
        Array.from({ length: 5 }, () => failure(create('pos_reservations', { starts_at: busy, party: 2, status: 'booked' }))),
      );
      expect(outcomes.filter((o) => o === 'written')).toHaveLength(3);
      expect(outcomes.filter((o) => o === 'CAPACITY_FULL')).toHaveLength(2);

      // Rows written together cannot each hold their slot: refused, unless it is history.
      await expect(writes.check('create', targetOf('pos_reservations'), context, [{ starts_at: busy, party: 1 }])).rejects.toBeInstanceOf(
        GuardedBatchError,
      );
      const history = await writes.check('create', targetOf('pos_reservations'), context, [prepared('pos_reservations', { starts_at: at(-3, 19), party: 9, status: 'booked' })], {
        capacity: 'unchecked',
      });
      expect(history.rows[0]).not.toBeNull();

      // A ticket's subtotal follows its lines, however they change.
      const total = async (id: unknown) =>
        Number(
          ((await db.selectFrom(targetOf('pos_tickets').table.id as never).select('subtotal' as never).where('id' as never, '=', id as never).executeTakeFirst()) as { subtotal: unknown })
            .subtotal,
        );
      const ticket = await create('pos_tickets', { subtotal: 0 });
      const other = await create('pos_tickets', { subtotal: 0 });
      const line = await create('pos_lines', { ticket_id: ticket['id'], unit_price: 4.5, qty: 2 });
      expect(await total(ticket['id'])).toBe(9);
      await create('pos_lines', { ticket_id: ticket['id'], unit_price: 3, qty: 1 });
      expect(await total(ticket['id'])).toBe(12);
      await update('pos_lines', line['id'], { qty: 3 });
      expect(await total(ticket['id'])).toBe(16.5);
      await update('pos_lines', line['id'], { ticket_id: other['id'] });
      expect([await total(ticket['id']), await total(other['id'])]).toEqual([3, 13.5]);
      await writes.delete({ target: targetOf('pos_lines'), pk: { id: line['id'] }, context, announce: async () => {} });
      expect(await total(other['id'])).toBe(0);

      // And a guest may never write a total.
      const tickets = targetOf('pos_tickets').table;
      expect(
        endpointIssues(
          {
            path: '/pos_tickets',
            source: tickets.id,
            methods: ['POST'],
            select: ['id', 'subtotal'],
            writable: ['subtotal'],
            filters: [],
            pagination: { default_limit: 50, max_limit: 200, order: 'id.asc' },
            auth: { role: 'anon' },
            rate_limit: { requests: 60, window: '1m' },
            response: { shape: 'object', envelope: 'data' },
          } as never,
          { ref: 'pos_tickets', view },
        ).map((i) => i.code),
      ).toContain('ENDPOINT_WRITABLE_DECIDED');
    }, 60_000);

    it('reads a booking’s wall time on the venue’s clock, from the connection’s own zone', async () => {
      const h = (open = await harness(dialect));
      const booking = {
        ...MANIFEST,
        requiredSchema: {
          prefixed: true,
          tables: [
            TABLES[0],
            {
              ref: 'reservations',
              columns: [
                { ref: 'id', type: 'int', role: 'pk' },
                { ref: 'starts_at', type: 'timestamptz', rules: { venueLocal: true } },
                { ref: 'noted_at', type: 'timestamptz', nullable: true },
                { ref: 'party', type: 'int' },
              ],
              capacity: { slot: 'starts_at', amount: 'party', perSlot: 8, slotMinutes: 30, opens: '17:00', closes: '21:00' },
            },
          ],
        },
      };
      await stageManifest(h, booking);
      expect((await post(h, '/apps/install')).statusCode).toBe(200);
      await h.meta.db.updateTable('adminium_connections').set({ timezone: 'Asia/Tokyo' }).where('id', '=', h.connectionId).execute();

      const snapshot = (await snapshotsRepo(h.meta).latest(h.connectionId))!;
      const view = new SnapshotView(
        h.connectionId,
        applyOverrides(parseDatabaseModel(snapshot.schema), await overridesRepo(h.meta).listForConnection(h.connectionId, { status: 'active' })),
        new Map(),
      );
      const { db, dialect: d } = await h.manager.data(h.connectionId);
      const table = view.table(view.model.tables.find((t) => t.name === 'pos_reservations')!.id);
      // No zone on the target: the service looks up the connection's.
      const target: WriteTarget = { connectionId: h.connectionId, view, table, db, dialect: d };
      const writes = createWriteService(writeStores(h.meta));
      const context = { origin: 'dashboard' as const, hops: 0, actor: null, request: null };
      const tomorrow = venueClock(new Date(Date.now() + 86_400_000), 'Asia/Tokyo').day;
      const create = (values: Record<string, unknown>, on: WriteTarget = target) =>
        writes.create({ target: on, values, context, announce: async () => {} });
      const instantOf = (value: unknown) =>
        value instanceof Date ? value.toISOString() : new Date(String(value).includes('T') ? String(value) : String(value).replace(' ', 'T')).toISOString();

      const row = await create({ starts_at: `${tomorrow} 19:00`, noted_at: `${tomorrow} 19:00`, party: 2 });
      // 19:00 in Tokyo is 10:00 UTC; the column without the rule is left as written.
      expect(instantOf(row['starts_at'])).toBe(`${tomorrow}T10:00:00.000Z`);
      expect(instantOf(row['noted_at'])).not.toBe(`${tomorrow}T10:00:00.000Z`);
      // Tokyo's hours: 16:30 there is refused, whatever it is in UTC.
      await expect(create({ starts_at: `${tomorrow} 16:30`, party: 2 })).rejects.toThrow('Some values were refused.');
      // A zone the writer names — the public API's key — wins over the connection's.
      const london = await create({ starts_at: `${tomorrow} 19:00`, party: 2 }, { ...target, timezone: 'Europe/London' });
      expect(instantOf(london['starts_at'])).toBe(wallTimeToInstant(`${tomorrow} 19:00`, 'Europe/London')!.toISOString());
    }, 60_000);

    it('installs the Overview, and every card of it reads the till’s day', async () => {
      const h = (open = await harness(dialect));
      await stageManifest(h, {
        ...MANIFEST,
        requiredSchema: { prefixed: true, tables: POS_OVERVIEW_TABLES },
        pages: [
          {
            ref: 'pos-overview',
            template: 'page-dashboard',
            title: { key: 't', fallback: 'Overview' },
            nav: { group: 'library', icon: 'layout-dashboard', order: 0 },
            config: { layout: POS_OVERVIEW_LAYOUT },
          },
        ],
      });
      const installed = await post(h, '/apps/install');
      expect(installed.statusCode, installed.body).toBe(200);
      expect(installed.json().pages.created).toEqual(['pos-overview']);

      // The layout as installed: every card bound to this connection's real tables.
      const page = (await pagesRepo(h.meta).findBySlug(h.connectionId, 'pos-overview'))!;
      const findLayout = (value: unknown): { toolbar?: unknown; items: { i: string; config: { binding?: unknown } }[] } | null => {
        if (typeof value !== 'object' || value === null) return null;
        const node = value as Record<string, unknown>;
        if (Array.isArray(node['items']) && node['version'] === 1) return node as never;
        for (const child of Object.values(node)) {
          const found = findLayout(child);
          if (found !== null) return found;
        }
        return null;
      };
      const layout = findLayout(page.config)!;
      expect(layout.toolbar).toEqual({ day: true });
      expect(layout.items).toHaveLength(14);

      // A little of today at the till, written as the till writes.
      const snapshot = (await snapshotsRepo(h.meta).latest(h.connectionId))!;
      const view = new SnapshotView(h.connectionId, applyOverrides(parseDatabaseModel(snapshot.schema), []), new Map());
      const { db, dialect: d } = await h.manager.data(h.connectionId);
      const writes = createWriteService(writeStores(h.meta));
      const context = { origin: 'dashboard' as const, hops: 0, actor: null, request: null };
      const put = (name: string, values: Record<string, unknown>) =>
        writes.create({
          target: { connectionId: h.connectionId, view, table: view.table(view.model.tables.find((t) => t.name === `pos_${name}`)!.id), db, dialect: d },
          values,
          context,
          announce: async () => {},
        });
      const now = new Date();
      const stamp = now.toISOString();
      const ticket = await put('tickets', { number: '1042', status: 'paid', guests: 2, total: 12.5, opened_at: stamp, closed_at: stamp });
      await put('tickets', { number: '1043', status: 'open', guests: 1, opened_at: stamp });
      await put('payments', { ticket_id: ticket['id'], method: 'card', amount: 12.5, tip: 1.5, paid_at: stamp });
      await put('ticket_items', { ticket_id: ticket['id'], name: 'Flat white', qty: 2, unit_price: 4.5, sent_at: stamp });
      await put('refunds', { ticket_id: ticket['id'], amount: 2, reason: 'Wrong item', refunded_at: stamp });
      await put('reservations', { name: 'Ada', party_size: 4, starts_at: stamp, status: 'confirmed' });
      await put('menu_items', { name: 'Almond croissant', price: 3, available: d === 'sqlite' ? 0 : false });
      await put('shifts', { opening_float: 200, started_at: stamp });
      const alex = await put('staff', { name: 'Alex' });
      await put('time_clock', { staff_id: alex['id'], clock_in: stamp });

      const cards: Record<string, Record<string, unknown>> = {};
      for (const item of layout.items) {
        const descriptor = queryDescriptorSchema.parse(item.config.binding);
        // As the widget-data route does: a card's lookups are resolved for the reader first.
        const lookups = await resolveLookups({
          view,
          table: view.table(view.model.tables.find((t) => t.name === descriptor.source.name)!.id),
          raw: descriptor.lookups ?? [],
          canReadPii: true,
          canReadTable: async () => true,
        });
        const compiled = compileWidgetQuery({ db, view, descriptor, params: { day: 'today' }, canReadPii: true, dialect: d, now: () => now, timezone: 'UTC', lookups });
        const rows = (await compiled.query.execute()) as Record<string, unknown>[];
        const priorRows = compiled.prior === null ? undefined : ((await compiled.prior.execute()) as Record<string, unknown>[]);
        cards[item.i] = shapeRows({ compiled, rows, priorRows, canReadPii: true }) as unknown as Record<string, unknown>;
      }
      expect(Object.keys(cards)).toHaveLength(14);
      expect(Number(cards['kpi-sales']!['value'])).toBe(12.5);
      expect(Number(cards['kpi-tickets']!['value'])).toBe(1);
      expect(Number(cards['kpi-tips']!['value'])).toBe(1.5);
      expect(Number(cards['kpi-guests']!['value'])).toBe(2);
      expect(JSON.stringify(cards['payments'])).toContain('card');
      expect(JSON.stringify(cards['best-sellers'])).toContain('Flat white');
      expect(JSON.stringify(cards['right-now'])).toContain('1043');
      expect(JSON.stringify(cards['right-now'])).not.toContain('1042');
      expect(JSON.stringify(cards['bookings'])).toContain('Ada');
      expect(JSON.stringify(cards['sold-out'])).toContain('Almond croissant');
      expect(JSON.stringify(cards['refunds'])).toContain('Wrong item');
      expect(JSON.stringify(cards['on-shift'])).toContain('Alex');
      // The looked-up name is one of the answer's columns, so a card draws it.
      expect((cards['on-shift']!['columns'] as { name: string }[]).map((c) => c.name)).toContain('staff_name');
      expect(JSON.stringify(cards['sales-by-hour'])).toContain('points');
    }, 90_000);

    it('installs a booking endpoint that confirms by email, and says when mail is not set up', async () => {
      const h = (open = await harness(dialect));
      await stageManifest(h, {
        ...MANIFEST,
        requiredSchema: {
          prefixed: true,
          tables: [
            TABLES[0],
            {
              ref: 'bookings',
              columns: [
                { ref: 'id', type: 'int', role: 'pk' },
                { ref: 'name', type: 'text', maxLength: 40 },
                { ref: 'email', type: 'text', maxLength: 80, nullable: true },
              ],
            },
            { ref: 'venue', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'venue_name', type: 'text', maxLength: 40 }] },
          ],
        },
        publicAccess: [
          {
            table: 'bookings',
            methods: ['POST'],
            // Never the email back out: a guest's address is personal data.
            select: ['id', 'name'],
            writable: ['name', 'email'],
            confirm: { template: 'booking-confirmation', to: 'email', name: 'name', venue: { table: 'venue', name: 'venue_name' }, link: 'manage?code={code}' },
          },
        ],
      });
      const planned = await post(h, '/apps/plan');
      expect(planned.statusCode, planned.body).toBe(200);
      const access = planned.json().plan.publicAccess;
      expect(access.endpoints.map((e: { ref: string; confirms: boolean }) => [e.ref, e.confirms])).toEqual([['pos_bookings', true]]);
      // No SMTP here: the check step says guests will get no confirmation.
      expect(access.warnings.map((w: { code: string }) => w.code)).toContain('NO_EMAIL');

      const installed = await post(h, '/apps/install');
      expect(installed.statusCode, installed.body).toBe(200);
      const saved = (await publicEndpointsRepo(h.meta).findByRef(h.connectionId, 'pos_bookings'))!;
      const confirm = (JSON.parse(saved.definition) as { confirm: { to: string; venue: { table: string } } }).confirm;
      expect(confirm.to).toBe('email');
      // The venue named by its short ref, bound to the real table.
      expect(confirm.venue.table).toMatch(/(^|\.)pos_venue$/);
    }, 60_000);

    it('shows a venue’s own phone publicly only when the app says it is not personal data', async () => {
      const venue = (rules: Record<string, unknown>) => ({
        ...MANIFEST,
        requiredSchema: {
          prefixed: true,
          tables: [
            TABLES[0],
            {
              ref: 'venue',
              columns: [
                { ref: 'id', type: 'int', role: 'pk' },
                { ref: 'venue_name', type: 'text', maxLength: 40 },
                { ref: 'phone', type: 'text', maxLength: 32, nullable: true, rules },
              ],
            },
          ],
        },
        publicAccess: [{ table: 'venue', methods: ['GET'], select: ['id', 'venue_name', 'phone'] }],
      });
      // A column named `phone` is taken for a person's: no anonymous endpoint may show it.
      const h = (open = await harness(dialect));
      await stageManifest(h, venue({}));
      const refused = await post(h, '/apps/install');
      expect(refused.statusCode, refused.body).toBe(409);
      expect(refused.json().message).toContain('"phone" is marked personal data');
      await h.close();

      // The app knows better: it is the venue's own number.
      const again = (open = await harness(dialect));
      await stageManifest(again, venue({ personal: false }));
      const installed = await post(again, '/apps/install');
      expect(installed.statusCode, installed.body).toBe(200);
      expect(installed.json().publicAccess.endpoints).toEqual(['pos_venue']);
      const rule = (await overridesRepo(again.meta).listForConnection(again.connectionId)).find((o) => o.op === 'column.pii');
      expect(rule?.value).toEqual({ masked: false });
      expect(rule?.origin).toBe('app');
    }, 90_000);

    it('makes no public access when it is declined, and refuses it to someone who may not manage keys', async () => {
      const h = (open = await harness(dialect, { canManageKeys: false }));
      await stageManifest(h, { ...MANIFEST, publicAccess: [{ table: 'menu_items', methods: ['GET'] }] });
      await h.meta.db.updateTable('adminium_connections').set({ timezone: null }).where('id', '=', h.connectionId).execute();
      const planned = await post(h, '/apps/plan');
      expect(planned.json().plan.publicAccess.canGrant).toBe(false);
      expect(planned.json().plan.publicAccess.warnings.map((w: { code: string }) => w.code)).toEqual(['PUBLIC_API_OFF', 'NO_TIME_ZONE']);

      const refused = await post(h, '/apps/install');
      expect(refused.statusCode, refused.body).toBe(403);
      expect(refused.json().message).toContain('asks for public access');
      // Refused before anything was written.
      expect(await manifestsRepo(h.meta, { encrypt: (v) => v, decrypt: (v) => v }).list('app')).toEqual([]);

      const declined = await post(h, '/apps/install', { publicAccess: false });
      expect(declined.statusCode, declined.body).toBe(200);
      expect(declined.json().publicAccess).toBeUndefined();
      expect(await publicEndpointsRepo(h.meta).listByConnection(h.connectionId)).toEqual([]);
      expect((await publicKeysRepo(h.meta).list()).filter((k) => k.appKey === 'pos')).toEqual([]);
    }, 60_000);

    it('adds sample rows holding a list, a switch and a uuid key', async () => {
      const h = (open = await harness(dialect));
      const bundle = {
        format: 'adminium.sample/1',
        app: 'pos',
        tables: [
          { ref: 'venue', rows: [{ name: 'Daybreak', open: true, tip_presets: [0, 10, 15, 20] }] },
          { ref: 'tenders', rows: [{ id: '5a3b1e00-0000-4000-8000-000000000001', amount: '4.50', settled: false }] },
        ],
      };
      await stageManifest(
        h,
        {
          ...MANIFEST,
          requiredSchema: {
            prefixed: true,
            tables: [
              TABLES[0],
              {
                ref: 'venue',
                columns: [
                  { ref: 'id', type: 'int', role: 'pk' },
                  { ref: 'name', type: 'text', maxLength: 40 },
                  { ref: 'open', type: 'bool', default: true },
                  { ref: 'tip_presets', type: 'json', nullable: true },
                ],
              },
              {
                ref: 'tenders',
                columns: [
                  { ref: 'id', type: 'uuid', role: 'pk' },
                  { ref: 'amount', type: 'money' },
                  { ref: 'settled', type: 'bool', default: false },
                ],
              },
            ],
          },
          sampleData: { file: 'seeds/pos.sample.json' },
        },
        { 'seeds/pos.sample.json': JSON.stringify(bundle) },
      );
      expect((await post(h, '/apps/install')).statusCode).toBe(200);
      const service = createSampleDataService(sampleDeps(h.meta, h.manager, createAppStore({ dataDir: h.dataDir })));
      // Each driver refused one of these raw: an array went out as a Postgres
      // array or a MySQL parameter list, and SQLite binds no boolean at all.
      // A uuid key has no sequence to move on afterwards (Postgres: max(uuid)).
      const added = await service.add((await findSampleApp(h.meta, 'pos'))!, { locale: 'en-US', userId: null, userLabel: 'test' });
      expect(added.counts).toEqual({ venue: 1, tenders: 1 });
      const venue = (await h.rows('SELECT open, tip_presets FROM pos_venue'))[0]!;
      const presets = typeof venue['tip_presets'] === 'string' ? JSON.parse(venue['tip_presets']) : venue['tip_presets'];
      expect(presets).toEqual([0, 10, 15, 20]);
      expect(Boolean(Number(venue['open']) || venue['open'] === true)).toBe(true);
      const tender = (await h.rows('SELECT id, settled FROM pos_tenders'))[0]!;
      expect(String(tender['id']).toLowerCase()).toBe('5a3b1e00-0000-4000-8000-000000000001');
      expect(Boolean(Number(tender['settled']) || tender['settled'] === true)).toBe(false);
    }, 60_000);

    it('adds sample data after your own records, leaving a code you already hold for Adminium to make', async () => {
      const h = (open = await harness(dialect));
      const bundle = {
        format: 'adminium.sample/1',
        app: 'pos',
        assets: {},
        tables: [{ ref: 'bookings', rows: [{ code: 'MR-4829', guest: 'Mara' }, { code: 'MR-7777', guest: 'Noah' }] }],
      };
      const manifest = {
        ...MANIFEST,
        sampleData: { file: 'seeds/pos.sample.json' },
        requiredSchema: {
          prefixed: true,
          tables: [
            ...TABLES,
            {
              ref: 'bookings',
              columns: [
                { ref: 'id', type: 'int', role: 'pk' },
                { ref: 'code', type: 'text', maxLength: 12, rules: { code: { prefix: 'MR-', length: 4 } } },
                { ref: 'guest', type: 'text', maxLength: 40 },
              ],
            },
          ],
        },
      };
      await stageManifest(h, manifest, { 'seeds/pos.sample.json': JSON.stringify(bundle) });
      expect((await post(h, '/apps/install')).statusCode).toBe(200);
      // The operator's own booking already holds the code the sample ships.
      await h.run(`INSERT INTO pos_bookings (code, guest) VALUES ('MR-4829', 'Own')`);
      const service = createSampleDataService(sampleDeps(h.meta, h.manager, createAppStore({ dataDir: h.dataDir })));
      const app = (await findSampleApp(h.meta, 'pos'))!;
      await service.add(app, { locale: 'en-US', userId: null, userLabel: 'test' });
      const rows = await h.rows('SELECT code, guest FROM pos_bookings ORDER BY id');
      expect(rows.map((r) => r.guest)).toEqual(['Own', 'Mara', 'Noah']);
      // The free code is the sample's own; the taken one was made anew, and stays unique.
      expect(rows[2]!.code).toBe('MR-7777');
      expect(String(rows[1]!.code)).toMatch(/^MR-[0-9A-Z]{4}$/);
      expect(new Set(rows.map((r) => r.code)).size).toBe(3);
    }, 90_000);

    it('stops a sample row that repeats a one-of-a-kind value of your own, naming it, and keeps nothing', async () => {
      const h = (open = await harness(dialect));
      const bundle = {
        format: 'adminium.sample/1',
        app: 'pos',
        assets: {},
        tables: [{ ref: 'rotas', rows: [{ weekday: 'mon', person: 'Mara' }, { weekday: 'tue', person: 'Noah' }] }],
      };
      const manifest = {
        ...MANIFEST,
        sampleData: { file: 'seeds/pos.sample.json' },
        requiredSchema: {
          prefixed: true,
          tables: [
            ...TABLES,
            {
              ref: 'rotas',
              columns: [
                { ref: 'id', type: 'int', role: 'pk' },
                { ref: 'weekday', type: 'text', maxLength: 3, unique: true },
                { ref: 'person', type: 'text', maxLength: 40 },
              ],
            },
          ],
        },
      };
      await stageManifest(h, manifest, { 'seeds/pos.sample.json': JSON.stringify(bundle) });
      expect((await post(h, '/apps/install')).statusCode).toBe(200);
      // The operator already set up Tuesday themselves.
      await h.run(`INSERT INTO pos_rotas (weekday, person) VALUES ('tue', 'Own')`);
      const service = createSampleDataService(sampleDeps(h.meta, h.manager, createAppStore({ dataDir: h.dataDir })));
      const app = (await findSampleApp(h.meta, 'pos'))!;
      const refused = await service.add(app, { locale: 'en-US', userId: null, userLabel: 'test' }).then(
        () => null,
        (error: { details?: unknown; message?: string }) => error,
      );
      expect(refused?.details).toEqual({ reason: 'SAMPLE_ROW_CLASH', table: 'rotas', column: 'weekday' });
      expect(refused?.message).toContain('weekday "tue"');
      // One transaction: Monday's sample row went with it, and the ledger holds nothing.
      expect((await h.rows('SELECT weekday, person FROM pos_rotas ORDER BY id')).map((r) => [r.weekday, r.person])).toEqual([['tue', 'Own']]);
      expect((await service.status(app)).loaded).toBe(false);
    }, 90_000);

    it('adds sample data in one go, then removes it without touching what you use or changed', async () => {
      const h = (open = await harness(dialect));
      const image = 'not really a webp, but bytes';
      const bundle = {
        format: 'adminium.sample/1',
        app: 'pos',
        assets: { 'img:latte': { file: 'seeds/images/latte.webp', sha256: createHash('sha256').update(image).digest('hex') } },
        tables: [
          {
            ref: 'menu_items',
            rows: [
              { '@label': 'item:latte', name: { '@t': { 'en-US': 'Latte', 'de-DE': 'Milchkaffee' } }, price: '4.50' },
              { '@label': 'item:tea', name: 'Tea', price: '3' },
              { '@label': 'item:cake', name: 'Cake', price: '5.25' },
            ],
          },
          { ref: 'shifts', rows: [{ opened_at: { '@day': -1, '@time': '09:30' } }] },
          { ref: 'payments', rows: [{ amount: '4.50', method: 'cash', tip: null }] },
          { ref: 'lines', rows: [{ item_id: { '@ref': 'item:latte' } }, { item_id: { '@ref': 'item:tea' } }] },
        ],
      };
      await stageManifest(h, { ...MANIFEST, sampleData: { file: 'seeds/pos.sample.json' } }, {
        'seeds/pos.sample.json': JSON.stringify(bundle),
        'seeds/images/latte.webp': image,
      });
      expect((await post(h, '/apps/install')).statusCode).toBe(200);

      const before = (await h.app.inject({ method: 'GET', url: '/apps/pos/sample-data' })).json();
      expect(before).toMatchObject({ offered: true, loaded: false, available: { total: 7, assets: 1 } });

      // The route queues the add as a job…
      const queued = await h.app.inject({ method: 'POST', url: '/apps/pos/sample-data' });
      expect(queued.statusCode, queued.body).toBe(200);
      expect(queued.json().jobId).toMatch(/.+/);
      // …which runs the service; run it here, in the adding person's language.
      const service = createSampleDataService(sampleDeps(h.meta, h.manager, createAppStore({ dataDir: h.dataDir })));
      const app = (await findSampleApp(h.meta, 'pos'))!;
      const now = Date.UTC(2026, 8, 23, 12, 0);
      // The venue's own zone decides what "yesterday at 09:30" is.
      await h.meta.db.updateTable('adminium_connections').set({ timezone: 'America/New_York' }).execute();
      const added = await service.add(app, { locale: 'de-DE', userId: null, userLabel: 'test', now });
      expect(added).toEqual({ counts: { menu_items: 3, shifts: 1, payments: 1, lines: 2 }, files: 1 });

      const items = await h.rows('SELECT id, name FROM pos_menu_items ORDER BY id');
      expect(items.map((r) => r.name)).toEqual(['Milchkaffee', 'Tea', 'Cake']);
      const lines = await h.rows('SELECT item_id FROM pos_lines ORDER BY id');
      expect(lines.map((r) => Number(r.item_id))).toEqual([Number(items[0]!.id), Number(items[1]!.id)]);
      const shift = await h.rows('SELECT opened_at FROM pos_shifts');
      // Yesterday at 09:30 in New York (EDT, UTC-4).
      expect(normaliseValue(shift[0]!.opened_at, 'timestamptz')).toBe('2026-09-22T13:30:00.000Z');
      const status = (await h.app.inject({ method: 'GET', url: '/apps/pos/sample-data' })).json();
      expect(status).toMatchObject({ offered: true, loaded: true, total: 7, available: null });
      // The ledger now exists, and the app's page lists it last, as its own.
      const overview = (await h.app.inject({ method: 'GET', url: '/apps/pos/overview' })).json();
      expect(overview.tables.at(-1)).toMatchObject({ table: 'pos_sample_data', role: 'sample-ledger' });
      expect(overview.tables.slice(0, -1).every((t: { role: string }) => t.role === 'app')).toBe(true);
      // Adding twice is refused rather than writing the café again.
      await expect(service.add(app, { locale: 'en-US', userId: null, userLabel: 'test' })).rejects.toThrow(/already/);

      // Your own line uses the cake; you renamed the tea.
      await h.run(`INSERT INTO pos_lines (item_id) VALUES (${String(items[2]!.id)})`);
      await h.run(`UPDATE pos_menu_items SET name = 'Green tea' WHERE id = ${String(items[1]!.id)}`);
      const plan = (await h.app.inject({ method: 'POST', url: '/apps/pos/sample-data/remove-plan' })).json();
      // Named as they read now: the renamed tea is "Green tea".
      expect(plan.kept).toEqual([{ ref: 'menu_items', label: 'item:cake', title: 'Cake', usedBy: 1 }]);
      expect(plan.changed).toEqual([{ ref: 'menu_items', label: 'item:tea', title: 'Green tea', columns: ['name'] }]);

      const removed = await h.app.inject({ method: 'POST', url: '/apps/pos/sample-data/remove', payload: { keepChanged: true } });
      expect(removed.statusCode, removed.body).toBe(200);
      expect(removed.json()).toEqual({ removed: 5, kept: 2, byTable: { lines: 2, payments: 1, shifts: 1, menu_items: 1 } });
      expect((await h.rows('SELECT name FROM pos_menu_items ORDER BY id')).map((r) => r.name)).toEqual(['Green tea', 'Cake']);
      expect(await h.rows('SELECT id FROM pos_shifts')).toEqual([]);
      // Your own line is untouched.
      expect(await h.rows('SELECT id FROM pos_lines')).toHaveLength(1);
      // The two that stay are the operator's now: the ledger is empty, and sample data can be added again.
      const after = (await h.app.inject({ method: 'GET', url: '/apps/pos/sample-data' })).json();
      expect(after).toMatchObject({ loaded: false, total: 0 });
      const again = await h.app.inject({ method: 'POST', url: '/apps/pos/sample-data' });
      expect(again.statusCode, again.body).toBeLessThan(300);
    }, 90_000);

    /*
     * Two tables that point at each other. Every FK used to be created inline,
     * which SQLite accepts and Postgres and MySQL refuse ("relation pos_tickets
     * does not exist", "Failed to open the referenced table"): the install
     * stopped at the tables step with the first table made.
     */
    const CYCLE = {
      ...MANIFEST,
      requiredSchema: {
        prefixed: true,
        tables: [
          {
            ref: 'tickets',
            columns: [
              { ref: 'id', type: 'int', role: 'pk' },
              { ref: 'reservation_id', type: 'fk', references: 'reservations', nullable: true },
            ],
          },
          {
            ref: 'reservations',
            columns: [
              { ref: 'id', type: 'int', role: 'pk' },
              { ref: 'ticket_id', type: 'fk', references: 'tickets', nullable: true },
            ],
          },
        ],
      },
      pages: [{ ...MANIFEST.pages[0]!, ref: 'pos-tickets', bindings: { rows: 'tickets' } }],
    };
    const cycleFks = async (h: Harness): Promise<string[]> => {
      const schema = dialect === 'mysql' ? 'database()' : 'current_schema()';
      const rows = await h.rows(
        `SELECT constraint_name AS name FROM information_schema.table_constraints ` +
          `WHERE table_schema = ${schema} AND constraint_type = 'FOREIGN KEY' ` +
          `AND table_name IN ('pos_tickets', 'pos_reservations') ORDER BY constraint_name`,
      );
      return rows.map((r) => String(r.name ?? r.NAME));
    };

    it('installs two tables that reference each other, with both links enforced', async () => {
      const h = (open = await harness(dialect));
      await stageManifest(h, CYCLE);
      const res = await post(h, '/apps/install');
      expect(res.statusCode, res.body).toBe(200);
      expect([...res.json().schema.created].sort()).toEqual(['pos_reservations', 'pos_tickets']);
      if (dialect !== 'sqlite') {
        expect(await cycleFks(h)).toEqual(['fk_pos_reservations_ticket_id', 'fk_pos_tickets_reservation_id']);
      }

      // Both directions refuse a dangling id and accept a real one.
      await h.run(`INSERT INTO pos_tickets (id) VALUES (1)`);
      await h.run(`INSERT INTO pos_reservations (id, ticket_id) VALUES (1, 1)`);
      await h.run(`UPDATE pos_tickets SET reservation_id = 1 WHERE id = 1`);
      await expect(h.run(`INSERT INTO pos_tickets (id, reservation_id) VALUES (2, 999)`)).rejects.toThrow();
      await expect(h.run(`INSERT INTO pos_reservations (id, ticket_id) VALUES (2, 999)`)).rejects.toThrow();

      // The snapshot knows both links.
      const model = parseDatabaseModel((await snapshotsRepo(h.meta).latest(h.connectionId))!.schema);
      const links = model.relations
        .filter((r) => r.kind === 'declared-fk')
        .map((r) => `${r.from.tableId.split('.').at(-1)!}->${r.to.tableId.split('.').at(-1)!}`)
        .sort();
      expect(links).toEqual(['pos_reservations->pos_tickets', 'pos_tickets->pos_reservations']);
    }, 60_000);

    it.skipIf(dialect === 'sqlite')('finishes a cycle a stopped install left unlinked when it is run again', async () => {
      const h = (open = await harness(dialect));
      await stageManifest(h, CYCLE);
      expect((await post(h, '/apps/install')).statusCode).toBe(200);
      // Stopped between the CREATEs and the ALTER that closes the cycle.
      await h.run(
        dialect === 'mysql'
          ? 'ALTER TABLE pos_reservations DROP FOREIGN KEY fk_pos_reservations_ticket_id'
          : 'ALTER TABLE pos_reservations DROP CONSTRAINT fk_pos_reservations_ticket_id',
      );
      const manifests = manifestsRepo(h.meta, { encrypt: (v) => v, decrypt: (v) => v });
      const row = (await manifests.list('app')).find((m) => m.row.manifestKey === 'pos')!;
      await manifests.setStatus(row.row.id, 'installing');

      const again = await post(h, '/apps/install');
      expect(again.statusCode, again.body).toBe(200);
      expect(again.json().schema.created).toEqual([]);
      expect(await cycleFks(h)).toEqual(['fk_pos_reservations_ticket_id', 'fk_pos_tickets_reservation_id']);
      await expect(h.run(`INSERT INTO pos_reservations (id, ticket_id) VALUES (1, 999)`)).rejects.toThrow();
    }, 60_000);

    it('takes the tables away again when rows link them both ways', async () => {
      const h = (open = await harness(dialect, { superAdmin: true }));
      await stageManifest(h, CYCLE);
      expect((await post(h, '/apps/install')).statusCode).toBe(200);
      // A ticket and its reservation, each pointing at the other: no drop
      // order empties either table first, on any engine.
      await h.run(`INSERT INTO pos_tickets (id) VALUES (1)`);
      await h.run(`INSERT INTO pos_reservations (id, ticket_id) VALUES (1, 1)`);
      await h.run(`UPDATE pos_tickets SET reservation_id = 1 WHERE id = 1`);

      const gone = await h.app.inject({ method: 'DELETE', url: '/apps/pos', payload: { dropTables: true, confirmKey: 'pos' } });
      expect(gone.statusCode, gone.body).toBe(200);
      expect([...gone.json().dropped].sort()).toEqual(['pos_reservations', 'pos_tickets']);
      expect(await h.columns('pos_tickets')).toEqual({});
      expect(await h.columns('pos_reservations')).toEqual({});
      // SQLite turned enforcement off for the drop; it is back on after it.
      if (dialect === 'sqlite') expect(await h.rows('PRAGMA foreign_keys')).toEqual([{ foreign_keys: 1 }]);
    }, 60_000);

    it('creates two tables that reference each other in one schema edit', async () => {
      const h = (open = await harness(dialect));
      const target = createAppSchemaTarget({ meta: h.meta, manager: h.manager, crypto: dsnCryptoFromSecret(TEST_SECRET) });
      const table = (name: string, fk: string, to: string, schema: string | null) =>
        desiredTableSchema.parse({
          name,
          schema,
          columns: [
            { name: 'id', logicalType: 'integer', nullable: false },
            { name: fk, logicalType: 'integer' },
          ],
          primaryKey: ['id'],
          // A table this edit creates has no id yet: it is named bare.
          foreignKeys: [{ columns: [fk], toTable: to, toColumns: ['id'] }],
        });
      const result = await target.edit(
        h.connectionId,
        (model) => ({
          upsertTables: [
            table('orders', 'invoice_id', 'invoices', model.defaultSchema),
            table('invoices', 'order_id', 'orders', model.defaultSchema),
          ],
        }),
        { superAdmin: true, createdBy: null },
      );
      expect(result.status, JSON.stringify(result)).toBe('applied');

      await h.run(`INSERT INTO orders (id) VALUES (1)`);
      await h.run(`INSERT INTO invoices (id, order_id) VALUES (1, 1)`);
      await h.run(`UPDATE orders SET invoice_id = 1 WHERE id = 1`);
      await expect(h.run(`INSERT INTO orders (id, invoice_id) VALUES (2, 999)`)).rejects.toThrow();
      await expect(h.run(`INSERT INTO invoices (id, order_id) VALUES (2, 999)`)).rejects.toThrow();
    }, 60_000);
  });
}
