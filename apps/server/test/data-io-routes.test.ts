// SPDX-License-Identifier: AGPL-3.0-only
/**
 * M7-T07 data-io end-to-end over the fake SQLite-backed adapter (same harness
 * as crud-e2e.test.ts): upload → validate → import-run job → rows in the
 * source db → export-run job → downloadable CSV artifact — plus the RBAC
 * guards (per-table export/import grants), PII masking captured at request
 * time, the xlsx rejection, and the §11.1 stats invariant.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { SqliteDialect } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  AdapterRegistry,
  adapterCapabilitiesSchema,
  parseDatabaseModel,
  type AdapterProvider,
  type DatabaseAdapter,
  type DatabaseModel,
} from '@adminium/engine/adapter';
import { jobsRepo, type Job, type JobsRepo, type User } from '@adminium/meta';

import { parseCsv } from '../src/data-io/csv.js';
import { createFileStorage, type FileStorage } from '../src/files/storage.js';
import { registerExportRunHandler } from '../src/jobs/export-run.js';
import { registerImportRunHandler } from '../src/jobs/import-run.js';
import { createJobRegistry, type JobRegistry } from '../src/jobs/registry.js';
import { RealtimeHub, parseChannel, widgetDataChannel } from '../src/realtime/hub.js';
import { exportsRoutes } from '../src/routes/exports/index.js';
import { importsRoutes } from '../src/routes/imports/index.js';
import {
  asUser,
  buildDataTestApp,
  createConnectionViaApi,
  introspectViaApi,
  type DataTestContext,
} from './connections-helpers.js';

// --- fake source database (customers has a masked-by-default phone column) ----

function seedSqlite(): BetterSqlite3.Database {
  const db = new BetterSqlite3(':memory:');
  db.exec(`
    CREATE TABLE customers (
      customer_id TEXT PRIMARY KEY,
      company_name TEXT NOT NULL,
      phone TEXT,
      credit_limit REAL,
      is_active INTEGER
    );
  `);
  return db;
}

function fakeModel(): DatabaseModel {
  return parseDatabaseModel({
    dialect: 'postgres',
    name: 'fakedb',
    defaultSchema: 'main',
    schemas: ['main'],
    tables: [
      {
        schema: 'main',
        name: 'customers',
        primaryKey: ['customer_id'],
        columns: [
          { name: 'customer_id', logicalType: 'varchar', nullable: false, isPrimaryKey: true },
          { name: 'company_name', logicalType: 'varchar', nullable: false },
          { name: 'phone', logicalType: 'varchar', nullable: true },
          { name: 'credit_limit', logicalType: 'decimal', nullable: true },
          // NOTE integer, not boolean: the fake adapter reports dialect
          // 'postgres' while the engine is better-sqlite3, so real boolean
          // binds cannot be exercised here (coercion is unit-tested in
          // data-io-coerce.test.ts; import-run converts for real sqlite).
          { name: 'is_active', logicalType: 'integer', nullable: true },
        ],
      },
    ],
    relations: [],
  });
}

function makeFakeRegistry(sqlite: BetterSqlite3.Database): AdapterRegistry<AdapterProvider> {
  const capabilities = adapterCapabilitiesSchema.parse({});
  const makeAdapter = (role: string): DatabaseAdapter =>
    ({
      dialect: 'postgres',
      capabilities,
      role,
      connect: async () => undefined,
      test: async () => ({
        ok: true,
        latencyMs: 1,
        serverVersion: 'FakeSQL 1.0',
        currentUser: 'fake',
        canWrite: true,
        ssl: false,
      }),
      probeCapabilities: async () => ({
        capabilities,
        privileges: { canReadSchema: true, canRead: true, canWrite: true, canDDL: true },
        serverVersion: 'FakeSQL 1.0',
        currentRole: { name: 'fake', readOnly: false },
      }),
      introspect: async () => fakeModel(),
      count: async () => ({ value: 0, capped: false }),
      sample: async () => [],
      query: async () => ({ rows: [], columns: [] }),
      mutate: async () => ({ affected: 0, returning: null }),
      close: async () => undefined,
    }) as unknown as DatabaseAdapter;

  const registry = new AdapterRegistry<AdapterProvider>();
  registry.register({
    dialect: 'postgres',
    create: (config) => makeAdapter(config.role) as never,
    createQueryEngine: () => ({
      dialect: new SqliteDialect({ database: sqlite }),
      identifiers: { quote: (identifier: string) => `"${identifier}"`, maxLength: 63 },
      serializers: {},
      destroy: async () => undefined,
    }),
  });
  return registry;
}

// --- job runner (in-test worker: claim → parse → run, no polling loop) ---------

async function runNextJob(jobs: JobsRepo, registry: JobRegistry): Promise<Job> {
  const claimed = await jobs.claim('test-worker');
  if (claimed === null) throw new Error('no claimable job');
  const entry = registry.get(claimed.kind);
  if (entry === undefined) throw new Error(`no handler for ${claimed.kind}`);
  const payload = entry.schema.parse(claimed.payload);
  await entry.run(payload, {
    jobId: claimed.id,
    kind: claimed.kind,
    attempt: claimed.attempts,
    maxAttempts: claimed.maxAttempts,
    signal: new AbortController().signal,
    progress: () => undefined,
    log: () => undefined,
  });
  await jobs.complete(claimed.id);
  const done = await jobs.findById(claimed.id);
  if (done === null) throw new Error('job vanished');
  return done;
}

// --- suite ---------------------------------------------------------------------

const CSV_UPLOAD = [
  'Customer Id,Company,Phone,"Credit",Active,Internal Notes',
  'ALFKI,"Alfreds ""Futterkiste""",030-0074321,1200.50,1,ignore me',
  'ANATR,"Ana, Trujillo",(5) 555-4729,800,0,"multi',
  'line note"',
  'BLAUS,Blauer See,,not-a-number,x,x', // bad credit_limit + bad is_active
  'CHOPS,Chop-suey Chinese,0452-076545,99.9,1,y',
  '',
].join('\r\n');

describe('data-io routes + jobs (fake adapter)', () => {
  let t: DataTestContext;
  let connId: string;
  let dataDir: string;
  let storage: FileStorage;
  let registry: JobRegistry;
  let jobs: JobsRepo;
  const hub = new RealtimeHub();

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'adminium-dataio-'));
    storage = createFileStorage({ dataDir });
    t = await buildDataTestApp({
      registry: makeFakeRegistry(seedSqlite()),
      extraRoutes: async (api, ctx) => {
        jobs = jobsRepo(ctx.meta);
        const enqueue = (input: Parameters<JobsRepo['enqueue']>[0]) => jobs.enqueue(input);
        await api.register(exportsRoutes({ meta: ctx.meta, manager: ctx.manager, storage, enqueue }));
        await api.register(importsRoutes({ meta: ctx.meta, manager: ctx.manager, storage, enqueue }));
      },
    });
    registry = createJobRegistry();
    registerExportRunHandler(registry, { meta: t.meta, manager: t.manager, storage });
    registerImportRunHandler(registry, { meta: t.meta, manager: t.manager, storage, hub });

    connId = await createConnectionViaApi(t, 'postgres://fake@fake-host:5432/fakedb');
    await introspectViaApi(t, connId);

    // Grants: admin everything; editor import+read on customers (no export);
    // viewer read-only (neither import nor export).
    await t.grantTable(t.roles.admin, connId, '*', {
      read: true,
      create: true,
      update: true,
      delete: true,
      export: true,
      import: true,
    });
    await t.grantTable(t.roles.editor, connId, 'main.customers', {
      read: true,
      create: true,
      import: true,
    });
    await t.grantTable(t.roles.viewer, connId, '*', { read: true });
  });

  afterAll(async () => {
    await t.app.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  async function upload(user: User, body: string, filename = 'customers.csv') {
    return t.app.inject({
      method: 'POST',
      url: `/api/v1/imports/upload?filename=${encodeURIComponent(filename)}`,
      headers: { ...asUser(user), 'content-type': 'text/csv' },
      payload: body,
    });
  }

  let fileId: string;
  let importId: string;

  it('uploads a CSV and previews header/samples/row count', async () => {
    const res = await upload(t.users.editor, CSV_UPLOAD);
    expect(res.statusCode).toBe(201);
    const data = res.json().data as {
      fileId: string;
      columns: string[];
      sampleRows: string[][];
      totalRows: number;
    };
    fileId = data.fileId;
    expect(data.columns).toEqual(['Customer Id', 'Company', 'Phone', 'Credit', 'Active', 'Internal Notes']);
    expect(data.totalRows).toBe(4);
    // The quoted multiline cell survived the parse (CRLF preserved verbatim).
    expect(data.sampleRows[1]?.[5]).toBe('multi\r\nline note');
  });

  it('rejects uploads without a session', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/v1/imports/upload',
      headers: { 'content-type': 'text/csv' },
      payload: 'a,b\n1,2\n',
    });
    expect(res.statusCode).toBe(401);
  });

  const MAPPING = {
    columns: [
      { from: 'Customer Id', to: 'customer_id' },
      { from: 'Company', to: 'company_name' },
      { from: 'Phone', to: 'phone' },
      { from: 'Credit', to: 'credit_limit' },
      { from: 'Active', to: 'is_active' },
      { from: 'Internal Notes', to: null }, // "Don't import"
    ],
  };

  it('validates: per-row issues, non-blocking (§11.1)', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/v1/imports',
      headers: asUser(t.users.editor),
      payload: {
        fileId,
        connectionId: connId,
        table: 'main.customers',
        mapping: MAPPING,
        options: { mode: 'insert', skipInvalid: true },
      },
    });
    expect(res.statusCode).toBe(201);
    const { import: imported, report } = res.json().data as {
      import: { id: string; status: string };
      report: { total: number; valid: number; invalid: number; issues: { column: string; code: string }[] };
    };
    importId = imported.id;
    expect(imported.status).toBe('ready');
    expect(report.total).toBe(4);
    expect(report.invalid).toBe(1); // BLAUS: bad credit_limit + bad is_active
    expect(report.valid).toBe(3);
    expect(report.issues.map((issue) => issue.code).sort()).toEqual(['BAD_NUMBER', 'BAD_NUMBER']);
  });

  it('refuses the import for a caller without the per-table import grant', async () => {
    const viewerUpload = await upload(t.users.viewer, 'Customer Id\nX1\n');
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/v1/imports',
      headers: asUser(t.users.viewer),
      payload: {
        fileId: (viewerUpload.json().data as { fileId: string }).fileId,
        connectionId: connId,
        table: 'main.customers',
        mapping: { columns: [{ from: 'Customer Id', to: 'customer_id' }] },
        options: {},
      },
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { code: string } }).error.code).toBe('TABLE_FORBIDDEN');
  });

  it('runs the import job: skips invalid rows, keeps the stats invariant', async () => {
    const run = await t.app.inject({
      method: 'POST',
      url: `/api/v1/imports/${importId}/run`,
      headers: asUser(t.users.editor),
    });
    expect(run.statusCode).toBe(202);
    expect((run.json().data as { jobId: string }).jobId).toBeTruthy();

    const job = await runNextJob(jobs, registry);
    expect(job.status).toBe('succeeded');

    const res = await t.app.inject({
      method: 'GET',
      url: `/api/v1/imports/${importId}`,
      headers: asUser(t.users.editor),
    });
    const view = res.json().data as {
      status: string;
      stats: { total: number; inserted: number; updated: number; skipped: number };
      errorReportFileId: string | null;
    };
    expect(view.status).toBe('succeeded');
    expect(view.stats).toEqual({ total: 4, inserted: 3, updated: 0, skipped: 1 });
    // The §11.1 invariant: total = inserted + updated + skipped.
    expect(view.stats.total).toBe(view.stats.inserted + view.stats.updated + view.stats.skipped);
    expect(view.errorReportFileId).not.toBeNull();

    // The rows really landed — through the ordinary list path.
    const list = await t.app.inject({
      method: 'GET',
      url: `/api/v1/data/${connId}/main.customers?order=customer_id.asc`,
      headers: asUser(t.users.admin),
    });
    const rows = (list.json() as { data: Record<string, unknown>[] }).data;
    expect(rows.map((row) => row.customer_id)).toEqual(['ALFKI', 'ANATR', 'CHOPS']);
    expect(rows[0]?.company_name).toBe('Alfreds "Futterkiste"');
    expect(rows[0]?.credit_limit).toBe(1200.5);
    expect(rows[0]?.is_active).toBe(1); // sqlite stores booleans as 0/1
  });

  it('serves the error report CSV for the skipped rows', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/v1/imports/${importId}/error-report`,
      headers: asUser(t.users.editor),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    const rows = parseCsv(res.body);
    expect(rows[0]).toEqual(['row', 'column', 'code', 'message', 'raw']);
    expect(rows.length).toBeGreaterThan(1);
  });

  it('upserts on a match column instead of duplicating', async () => {
    const upsertCsv = 'Customer Id,Company\nALFKI,Alfreds Renamed\nDUMON,Du monde entier\n';
    const up = await upload(t.users.editor, upsertCsv, 'upsert.csv');
    const created = await t.app.inject({
      method: 'POST',
      url: '/api/v1/imports',
      headers: asUser(t.users.editor),
      payload: {
        fileId: (up.json().data as { fileId: string }).fileId,
        connectionId: connId,
        table: 'main.customers',
        mapping: {
          columns: [
            { from: 'Customer Id', to: 'customer_id' },
            { from: 'Company', to: 'company_name' },
          ],
        },
        options: { mode: 'upsert', matchColumn: 'customer_id' },
      },
    });
    expect(created.statusCode).toBe(201);
    const id = (created.json().data as { import: { id: string } }).import.id;
    await t.app.inject({
      method: 'POST',
      url: `/api/v1/imports/${id}/run`,
      headers: asUser(t.users.editor),
    });
    await runNextJob(jobs, registry);

    const view = (
      await t.app.inject({ method: 'GET', url: `/api/v1/imports/${id}`, headers: asUser(t.users.editor) })
    ).json().data as { stats: { inserted: number; updated: number; total: number; skipped: number } };
    expect(view.stats).toEqual({ total: 2, inserted: 1, updated: 1, skipped: 0 });

    const list = await t.app.inject({
      method: 'GET',
      url: `/api/v1/data/${connId}/main.customers?order=customer_id.asc`,
      headers: asUser(t.users.admin),
    });
    const rows = (list.json() as { data: Record<string, unknown>[] }).data;
    expect(rows).toHaveLength(4); // ALFKI updated, DUMON inserted
    expect(rows[0]?.company_name).toBe('Alfreds Renamed');
  });

  it('rejects an upsert whose match column is not among the mapped columns', async () => {
    const up = await upload(t.users.editor, 'Company\nGhost Co\n', 'unmapped-match.csv');
    const created = await t.app.inject({
      method: 'POST',
      url: '/api/v1/imports',
      headers: asUser(t.users.editor),
      payload: {
        fileId: (up.json().data as { fileId: string }).fileId,
        connectionId: connId,
        table: 'main.customers',
        mapping: { columns: [{ from: 'Company', to: 'company_name' }] },
        options: { mode: 'upsert', matchColumn: 'customer_id' },
      },
    });
    // Every row's match value would be undefined — per-row errors or silent
    // duplicate inserts — so the request itself is the place to refuse.
    expect(created.statusCode).toBe(422);
    expect(created.body).toContain('matchColumn');
  });

  // --- exports -----------------------------------------------------------------

  it('rejects xlsx with a clear validation error (documented deviation)', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/v1/exports',
      headers: asUser(t.users.admin),
      payload: { connectionId: connId, source: { kind: 'table', table: 'main.customers' }, format: 'xlsx' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.body).toContain('xlsx');
  });

  it('refuses the export for a caller without the per-table export grant', async () => {
    for (const user of [t.users.editor, t.users.viewer]) {
      const res = await t.app.inject({
        method: 'POST',
        url: '/api/v1/exports',
        headers: asUser(user),
        payload: { connectionId: connId, source: { kind: 'table', table: 'main.customers' }, format: 'csv' },
      });
      expect(res.statusCode).toBe(403);
      expect((res.json() as { error: { code: string } }).error.code).toBe('TABLE_FORBIDDEN');
    }
  });

  let exportId: string;

  it('runs the export job and downloads the CSV artifact (round trip)', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/v1/exports',
      headers: asUser(t.users.admin),
      payload: {
        connectionId: connId,
        source: { kind: 'table', table: 'main.customers' },
        format: 'csv',
      },
    });
    expect(res.statusCode).toBe(202);
    const created = res.json().data as { id: string; status: string; jobId: string };
    exportId = created.id;
    expect(created.status).toBe('processing');
    expect(created.jobId).toBeTruthy();

    const job = await runNextJob(jobs, registry);
    expect(job.status).toBe('succeeded');

    const view = (
      await t.app.inject({ method: 'GET', url: `/api/v1/exports/${exportId}`, headers: asUser(t.users.admin) })
    ).json().data as { status: string; rowCount: number; filename: string | null; expiresAt: number | null };
    expect(view.status).toBe('ready');
    expect(view.rowCount).toBe(4);
    expect(view.filename).toContain('main.customers');
    expect(view.expiresAt).not.toBeNull();

    const download = await t.app.inject({
      method: 'GET',
      url: `/api/v1/exports/${exportId}/download`,
      headers: asUser(t.users.admin),
    });
    expect(download.statusCode).toBe(200);
    expect(download.headers['content-type']).toContain('text/csv');
    expect(download.headers['content-disposition']).toContain('attachment');

    // Round trip: the imported rows come back out through the CSV artifact.
    const rows = parseCsv(download.body);
    expect(rows[0]).toEqual(['customer_id', 'company_name', 'phone', 'credit_limit', 'is_active']);
    const byId = new Map(rows.slice(1).map((row) => [row[0], row]));
    expect([...byId.keys()].sort()).toEqual(['ALFKI', 'ANATR', 'CHOPS', 'DUMON']);
    expect(byId.get('ALFKI')?.[1]).toBe('Alfreds Renamed');
    expect(byId.get('ANATR')?.[1]).toBe('Ana, Trujillo'); // comma survived quoting
    expect(byId.get('ALFKI')?.[2]).toBe('030-0074321'); // admin exports unmasked PII
  });

  it('exports JSON-lines with PII masked for a non-privileged caller', async () => {
    // Give the viewer an export grant only — masking still applies (mask.ts).
    await t.grantTable(t.roles.viewer, connId, 'main.customers', { read: true, export: true });
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/v1/exports',
      headers: asUser(t.users.viewer),
      payload: { connectionId: connId, source: { kind: 'table', table: 'main.customers' }, format: 'json' },
    });
    expect(res.statusCode).toBe(202);
    const id = (res.json().data as { id: string }).id;
    await runNextJob(jobs, registry);

    const download = await t.app.inject({
      method: 'GET',
      url: `/api/v1/exports/${id}/download`,
      headers: asUser(t.users.viewer),
    });
    expect(download.statusCode).toBe(200);
    const lines = download.body.trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines).toHaveLength(4);
    // phone is auto-masked PII: the captured request-time grant says masked.
    for (const line of lines) expect(line.phone).toBeNull();
    expect(lines.map((line) => line.customer_id).sort()).toEqual(['ALFKI', 'ANATR', 'CHOPS', 'DUMON']);
  });

  it('scopes the exports list to the caller (mine-only without the manage key)', async () => {
    const mine = await t.app.inject({
      method: 'GET',
      url: '/api/v1/exports',
      headers: asUser(t.users.viewer),
    });
    const rows = mine.json().data as { requestedBy: string }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((row) => row.requestedBy)).size).toBe(1);

    const other = await t.app.inject({
      method: 'GET',
      url: `/api/v1/exports/${exportId}`,
      headers: asUser(t.users.viewer),
    });
    expect(other.statusCode).toBe(404); // someone else's export is invisible
  });

  it('download refuses processing and expired exports', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/v1/exports',
      headers: asUser(t.users.admin),
      payload: { connectionId: connId, source: { kind: 'table', table: 'main.customers' }, format: 'csv' },
    });
    const id = (res.json().data as { id: string }).id;
    const processing = await t.app.inject({
      method: 'GET',
      url: `/api/v1/exports/${id}/download`,
      headers: asUser(t.users.admin),
    });
    expect(processing.statusCode).toBe(409);
    await runNextJob(jobs, registry);

    // Force-expire and re-check.
    const { exportsRepo } = await import('@adminium/meta');
    await exportsRepo(t.meta).expireDue(Number.MAX_SAFE_INTEGER);
    const expired = await t.app.inject({
      method: 'GET',
      url: `/api/v1/exports/${id}/download`,
      headers: asUser(t.users.admin),
    });
    expect(expired.statusCode).toBe(410);
  });

  // --- realtime fan-out (wave-2 audit) -------------------------------------------

  it('import-run publishes on the subscribable widget-data channel, not just the legacy table: echo', async () => {
    // parseChannel knows no `table:` prefix — nothing can ever be subscribed
    // to the legacy echo, so the invalidation event must also ride
    // `widget-data:<conn>:<table>` for open grids to refetch after an import.
    const channel = widgetDataChannel(connId, 'main.customers');
    expect(parseChannel(`table:${connId}:main.customers`)).toBeNull();
    expect(parseChannel(channel)).toEqual({
      kind: 'widget-data',
      connectionId: connId,
      table: 'main.customers',
    });

    const seen: { type: string; data: unknown }[] = [];
    const unsubscribe = hub.subscribe(channel, (event) => seen.push({ type: event.type, data: event.data }));
    try {
      const up = await upload(t.users.editor, 'Customer Id,Company\nRTPUB,Realtime Pub Co\n', 'rt.csv');
      const created = await t.app.inject({
        method: 'POST',
        url: '/api/v1/imports',
        headers: asUser(t.users.editor),
        payload: {
          fileId: (up.json().data as { fileId: string }).fileId,
          connectionId: connId,
          table: 'main.customers',
          mapping: {
            columns: [
              { from: 'Customer Id', to: 'customer_id' },
              { from: 'Company', to: 'company_name' },
            ],
          },
          options: { mode: 'insert' },
        },
      });
      expect(created.statusCode).toBe(201);
      const id = (created.json().data as { import: { id: string } }).import.id;
      await t.app.inject({ method: 'POST', url: `/api/v1/imports/${id}/run`, headers: asUser(t.users.editor) });
      await runNextJob(jobs, registry);
      expect(seen).toEqual([{ type: 'record.bulk-create', data: { count: 1 } }]);
    } finally {
      unsubscribe();
    }
  });
});
