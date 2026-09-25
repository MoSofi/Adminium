// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An invoicing app installed through the real installer on a REAL database,
 * shared by the tests of the rules such an app asks for: formulas, numbers
 * without gaps, states and locks, stamps and fingerprints.
 *
 * Nothing is faked below the HTTP route: the connection manager, the
 * introspection, the plan, the DDL and the rule writer all run. The harness
 * hands back the write service over the installed tables, so a test writes as
 * the dashboard, an import or a guest would.
 */
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { sql } from 'kysely';
import { parseDatabaseModel } from '@adminium/engine';
import { AdapterRegistry, type AdapterProvider } from '@adminium/engine/adapter';
import {
  connectionTenantConfig,
  createSqliteMetaDb,
  documentSequencesRepo,
  firstRun,
  manifestsRepo,
  overridesRepo,
  snapshotsRepo,
  usersRepo,
  type MetaDb,
} from '@adminium/meta';
import { expect } from 'vitest';

import { createInstalledApps } from '../src/apps/installed.js';
import { createAppSchemaTarget } from '../src/apps/schema-target.js';
import { createAppStore } from '../src/apps/store.js';
import type { SampleDataDeps } from '../src/apps/sample-data.js';
import { sha512Integrity } from '../src/add-ons/store.js';
import { runIntrospection } from '../src/connections/introspect.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { registerAdapters } from '../src/connections/register-adapters.js';
import { applyOverrides } from '../src/connections/effective-schema.js';
import { SnapshotView } from '../src/crud/identifiers.js';
import { createWriteService, type WriteContext, type WriteTarget } from '../src/crud/write-service.js';
import { normalizeWriteValue } from '../src/crud/write-values.js';
import type { FileStore } from '../src/files/store.js';
import { createEndpointService } from '../src/public-api/endpoint-service.js';
import { createPublicViews } from '../src/public-api/runtime.js';
import { appRoutes } from '../src/routes/apps/index.js';
import { packageTarball } from './app-bundle-helpers.js';
import { TEST_SECRET } from './helpers.js';

export type Dialect = 'sqlite' | 'postgres' | 'mysql';
export const POSTGRES_URL = process.env.TEST_POSTGRES_URL;
export const MYSQL_URL = process.env.TEST_MYSQL_URL || undefined;

/** Every engine, and whether this run can reach it. */
export const LEGS: [Dialect, boolean][] = [
  ['sqlite', true],
  ['postgres', POSTGRES_URL !== undefined],
  ['mysql', MYSQL_URL !== undefined],
];

const id = { ref: 'id', type: 'int', role: 'pk' };
const money = (ref: string, rules?: Record<string, unknown>) => ({
  ref,
  type: 'decimal',
  scale: 'currency',
  nullable: true,
  ...(rules === undefined ? {} : { rules }),
});

/** A studio's invoicing tables, every rule written as an app writes it. */
export function invoicingTables(): Record<string, unknown>[] {
  return [
    {
      ref: 'settings',
      columns: [
        id,
        { ref: 'singleton', type: 'text', maxLength: 16, unique: true, default: 'studio' },
        { ref: 'invoice_prefix', type: 'text', maxLength: 12, nullable: true, default: 'INV-' },
        { ref: 'invoice_start', type: 'int', nullable: true, default: 2040 },
        { ref: 'tax_rate', type: 'decimal', scale: 3, nullable: true, default: 20 },
      ],
    },
    {
      ref: 'clients',
      columns: [
        id,
        { ref: 'email', type: 'text', maxLength: 254, unique: true },
        { ref: 'name', type: 'text', maxLength: 120, nullable: true },
        { ref: 'tax_rate', type: 'decimal', scale: 3, nullable: true },
      ],
    },
    {
      ref: 'invoices',
      columns: [
        id,
        { ref: 'client_id', type: 'fk', references: 'clients' },
        { ref: 'number_seq', type: 'int', nullable: true, rules: { sequence: { gapless: true, startSetting: { table: 'settings', column: 'invoice_start' } } } },
        { ref: 'number', type: 'text', maxLength: 24, nullable: true, rules: { format: { from: 'number_seq', prefixSetting: { table: 'settings', column: 'invoice_prefix' }, pad: 4 } } },
        { ref: 'status', type: 'enum', enum: ['draft', 'sent', 'void'], default: 'draft' },
        { ref: 'issued_on', type: 'date', nullable: true, rules: { stamp: { set: 'today', on: { column: 'status', values: ['sent'] } } } },
        { ref: 'terms', type: 'enum', enum: ['net7', 'net14', 'net30', 'on-receipt'], default: 'net14' },
        {
          ref: 'due_on',
          type: 'date',
          nullable: true,
          rules: { stamp: { set: { addDays: { date: 'issued_on', days: 'terms', map: { net7: 7, net14: 14, net30: 30, 'on-receipt': 0 } } }, on: { column: 'status', values: ['sent'] } } },
        },
        { ref: 'currency', type: 'text', maxLength: 3, nullable: true, rules: { default: { from: 'connection.currency' } } },
        { ref: 'tax_rate', type: 'decimal', scale: 3, nullable: true, rules: { copy: { via: 'client_id', from: 'tax_rate' }, default: { from: { table: 'settings', column: 'tax_rate' } } } },
        money('subtotal', { rollup: { from: 'invoice_lines', via: 'invoice_id', sum: 'amount' } }),
        money('tax', { formula: { round: { div: [{ mul: ['subtotal', { coalesce: ['tax_rate', 0] }] }, 100] } } }),
        money('total', { formula: { add: ['subtotal', { coalesce: ['tax', 0] }] } }),
        money('paid', { rollup: { from: 'payments', via: 'invoice_id', sum: 'amount', where: { column: 'voided', eq: false }, balance: { column: 'balance', of: 'total' }, cap: true } }),
        money('balance'),
        { ref: 'client_paid_at', type: 'timestamptz', nullable: true },
      ],
      states: {
        column: 'status',
        initial: 'draft',
        moves: {
          draft: [{ to: 'sent', requires: { children: { invoice_lines: 1 }, where: [{ column: 'total', gt: 0 }] } }, 'void'],
          sent: [{ to: 'void', requires: { where: [{ column: 'paid', eq: 0 }] } }],
        },
        lock: { when: ['sent', 'void'], except: ['due_on', 'client_paid_at'] },
        children: {
          invoice_lines: { via: 'invoice_id', lock: true },
          payments: { via: 'invoice_id', parentIn: ['sent'], clearOnCreate: ['client_paid_at'] },
        },
        noDelete: { when: 'numbered' },
      },
    },
    {
      ref: 'invoice_lines',
      columns: [
        id,
        { ref: 'invoice_id', type: 'fk', references: 'invoices' },
        { ref: 'position', type: 'int', default: 0 },
        { ref: 'qty', type: 'decimal', scale: 3, default: 1 },
        money('rate'),
        money('discount'),
        money('amount', { formula: { max: [0, { sub: [{ mul: ['qty', 'rate'] }, { coalesce: ['discount', 0] }] }] } }),
      ],
    },
    {
      ref: 'payments',
      columns: [
        id,
        { ref: 'invoice_id', type: 'fk', references: 'invoices' },
        { ref: 'amount', type: 'decimal', scale: 'currency' },
        { ref: 'voided', type: 'bool', default: false },
      ],
    },
    {
      ref: 'proposals',
      columns: [
        id,
        { ref: 'client_id', type: 'fk', references: 'clients' },
        { ref: 'status', type: 'enum', enum: ['draft', 'sent', 'accepted'], default: 'draft' },
        { ref: 'signed_name', type: 'text', maxLength: 120, nullable: true },
        {
          ref: 'fingerprint',
          type: 'text',
          maxLength: 64,
          nullable: true,
          rules: {
            stamp: {
              set: { hashOf: { columns: ['signed_name'], children: [{ table: 'proposal_lines', via: 'proposal_id', columns: ['position', 'amount'], orderBy: 'position' }] } },
              on: [{ column: 'status', values: ['accepted'] }, { column: 'signed_name', filled: true }],
            },
          },
        },
      ],
    },
    { ref: 'proposal_lines', columns: [id, { ref: 'proposal_id', type: 'fk', references: 'proposals' }, { ref: 'position', type: 'int', default: 0 }, money('amount')] },
    {
      ref: 'versions',
      columns: [
        id,
        { ref: 'proposal_id', type: 'fk', references: 'proposals' },
        { ref: 'v', type: 'int', nullable: true, rules: { sequence: { gapless: true, scope: 'proposal_id' } } },
      ],
    },
  ];
}

/** The app around the tables: key `studio`, prefixed tables. */
export function invoicingManifest(tables: Record<string, unknown>[] = invoicingTables()): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'studio',
    name: 'Studio',
    version: '0.2.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'AGPL-3.0-only',
    description: { key: 'd', fallback: 'A studio.' },
    categories: ['crm'],
    compatibility: { minAdminiumVersion: '0.3.0' },
    requiredSchema: { prefixed: true, tables },
    pages: [
      {
        ref: 'studio-invoices',
        template: 'page-crud',
        title: { key: 't', fallback: 'Invoices' },
        nav: { group: 'library', icon: 'list', order: 1 },
        bindings: { rows: 'invoices' },
      },
    ],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
  };
}

export interface InvoicingHarness {
  meta: MetaDb;
  manager: ConnectionManager;
  connectionId: string;
  dialect: Dialect;
  app: Awaited<ReturnType<typeof buildApp>>;
  rows: (statement: string) => Promise<Record<string, unknown>[]>;
  /** The real name of one of the app's tables. */
  real: (ref: string) => string;
  close: () => Promise<void>;
}

const memoryFiles = {
  write: async () => ({ storageKey: 'x', sizeBytes: 0, sha256: '', destinationId: null, storage: 'memory' }),
} as unknown as FileStore;

async function buildApp(meta: MetaDb, manager: ConnectionManager, dataDir: string, userId: string) {
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
  const views = createPublicViews(meta);
  const store = createAppStore({ dataDir });
  const manifests = manifestsRepo(meta, { encrypt: (v) => v, decrypt: (v) => v });
  const installed = createInstalledApps({
    store,
    list: async () => (await manifests.list('app')).map((m) => ({ key: m.row.manifestKey, version: m.row.version, status: m.row.status })),
  });
  const sampleData: SampleDataDeps = { meta, manager, store, files: memoryFiles };
  await app.register(
    appRoutes({
      meta,
      store,
      installed,
      credentialCrypto: { encrypt: (v) => v, decrypt: (v) => v },
      directoryKeys: () => [],
      serverVersion: '0.4.0',
      schemaTarget: createAppSchemaTarget({ meta, manager, crypto: dsnCryptoFromSecret(TEST_SECRET) }),
      sampleData,
      publicAccess: {
        service: createEndpointService({ meta, viewFor: views.viewFor, tenantConfigOf: async (cid) => (await connectionTenantConfig(meta, cid)) ?? undefined }),
        viewFor: views.viewFor,
        crypto: dsnCryptoFromSecret(TEST_SECRET),
        origins: ['self'],
        invalidateKey: () => {},
      },
    }),
  );
  await app.ready();
  return app;
}

/** A fresh database on `dialect`, with the app staged, planned and installed. */
export async function installInvoicing(dialect: Dialect, manifest = invoicingManifest()): Promise<InvoicingHarness & { reply: Record<string, unknown> }> {
  const dataDir = await mkdtemp(join(tmpdir(), 'invoicing-'));
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
  const user = await usersRepo(meta).create({ email: 'owner@test', name: 'Owner' });
  const registry = new AdapterRegistry<AdapterProvider>();
  await registerAdapters(registry);
  const manager = new ConnectionManager({ meta, crypto: dsnCryptoFromSecret(TEST_SECRET), registry, metaDsn: null, blockLoopback: false });

  let dsn: string;
  let drop: () => Promise<void> = async () => undefined;
  const name = `adminium_invoicing_${randomBytes(4).toString('hex')}`;
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
  const connection = await manager.connections.create({ name: 'Studio', engine: dialect, introspectDsn: dsn, dataDsn: dsn });
  await runIntrospection({ manager, meta, connectionId: connection.id });
  const app = await buildApp(meta, manager, dataDir, user.id);

  const tarball = packageTarball({
    'manifest.json': JSON.stringify(manifest),
    'staff/index.html': '<!doctype html><html><body data-app="studio"></body></html>',
  });
  const staged = await app.inject({
    method: 'POST',
    url: `/apps/upload?expectedSha512=${encodeURIComponent(sha512Integrity(tarball))}`,
    headers: { 'content-type': 'application/octet-stream' },
    payload: Buffer.from(tarball),
  });
  expect(staged.statusCode, staged.body).toBe(200);
  const body = { key: manifest['key'], version: manifest['version'], connectionId: connection.id };
  const plan = await app.inject({ method: 'POST', url: '/apps/plan', payload: body });
  expect(plan.statusCode, plan.body).toBe(200);
  const install = await app.inject({ method: 'POST', url: '/apps/install', payload: body });
  expect(install.statusCode, install.body).toBe(200);

  const handle = await manager.data(connection.id);
  const prefix = `${String(manifest['key']).replace(/-/g, '_')}_`;
  return {
    meta,
    manager,
    connectionId: connection.id,
    dialect,
    app,
    reply: install.json() as Record<string, unknown>,
    rows: async (statement) => (await sql.raw<Record<string, unknown>>(statement).execute(handle.db)).rows,
    real: (ref) => `${prefix}${ref}`,
    close: async () => {
      await app.close();
      await manager.disposeAll().catch(() => undefined);
      await drop();
      await meta.db.destroy();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

/** The write service over the installed tables, as the dashboard writes. */
export async function writerFor(h: InvoicingHarness, timezone = 'Europe/London') {
  const snapshot = (await snapshotsRepo(h.meta).latest(h.connectionId))!;
  const view = new SnapshotView(
    h.connectionId,
    applyOverrides(parseDatabaseModel(snapshot.schema), await overridesRepo(h.meta).listForConnection(h.connectionId, { status: 'active' })),
    new Map(),
  );
  const { db, dialect } = await h.manager.data(h.connectionId);
  const targetOf = (ref: string): WriteTarget => ({
    connectionId: h.connectionId,
    view,
    table: view.table(view.model.tables.find((t) => t.name === h.real(ref))!.id),
    db,
    dialect,
    timezone,
  });
  const writes = createWriteService({ sequences: documentSequencesRepo(h.meta) });
  const desk: WriteContext = { origin: 'dashboard', hops: 0, actor: { kind: 'user', id: 'usr_ivy', label: 'Ivy Ferreira' }, request: null };
  const prepared = (ref: string, values: Record<string, unknown>) => {
    const table = targetOf(ref).table;
    return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, normalizeWriteValue(table.columns.get(k)!, v)]));
  };
  return {
    view,
    targetOf,
    writes,
    desk,
    create: (ref: string, values: Record<string, unknown>, context: WriteContext = desk) =>
      writes.create({ target: targetOf(ref), values: prepared(ref, values), context, announce: async () => {} }),
    update: (ref: string, id: unknown, values: Record<string, unknown>, context: WriteContext = desk) =>
      writes.update({ target: targetOf(ref), pk: { id }, values: prepared(ref, values), context, announce: async () => {} }),
  };
}
