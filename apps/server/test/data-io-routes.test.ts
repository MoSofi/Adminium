// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Data-io end-to-end over the fake SQLite-backed adapter (same harness
 * as crud-e2e.test.ts): upload → validate → import-run job → rows in the
 * source db → export-run job → downloadable CSV artifact — plus the RBAC
 * guards (per-table export/import grants), PII masking captured at request
 * time, the xlsx rejection, and the stats invariant.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { Transform } from 'node:stream';
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
import { importsRepo, jobsRepo, newId, pagesRepo, viewsRepo, type Job, type JobsRepo, type User } from '@adminium/meta';

import { createWriteService, type RecordWriteService } from '../src/crud/write-service.js';
import { writeStores } from '../src/crud/write-stores.js';
import { parseCsv } from '../src/data-io/csv.js';
import { type FileStore } from '../src/files/store.js';
import { createTestFileStore } from './helpers/file-store.js';
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
  let storage: FileStore;
  let registry: JobRegistry;
  let jobs: JobsRepo;
  const hub = new RealtimeHub();
  let writes: RecordWriteService;
  const hooks = { on: false, ran: 0 };
  /** How many bytes of stored files have been read (see the store in `beforeAll`). */
  let bytesRead = 0;

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'adminium-dataio-'));
    const stored = createTestFileStore({ dataDir });
    // The same store, counting the bytes a reader takes of a file: a reader that stops early is seen to.
    storage = {
      ...stored,
      read: async (file) => {
        const counted = new Transform({
          transform(chunk: Buffer, _encoding, done) {
            bytesRead += chunk.byteLength;
            done(null, chunk);
          },
        });
        return (await stored.read(file)).pipe(counted);
      },
    };
    t = await buildDataTestApp({
      registry: makeFakeRegistry(seedSqlite()),
      extraRoutes: async (api, ctx) => {
        jobs = jobsRepo(ctx.meta);
        const enqueue = (input: Parameters<JobsRepo['enqueue']>[0]) => jobs.enqueue(input);
        await api.register(exportsRoutes({ meta: ctx.meta, manager: ctx.manager, storage, enqueue }));
        // One write service for the routes and the job, with a project's hooks a test can switch on.
        writes = createWriteService({
          ...writeStores(ctx.meta),
          hooks: () => ({
            wants: async () => hooks.on,
            before: async () => {
              hooks.ran += 1;
            },
            after: async () => {},
          }),
        });
        await api.register(importsRoutes({ meta: ctx.meta, manager: ctx.manager, storage, enqueue, writes }));
      },
    });
    registry = createJobRegistry();
    registerExportRunHandler(registry, { meta: t.meta, manager: t.manager, storage });
    registerImportRunHandler(registry, { meta: t.meta, manager: t.manager, storage, hub, writes });

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

  async function upload(user: User, body: string, filename = 'customers.csv', query = '') {
    return t.app.inject({
      method: 'POST',
      url: `/api/v1/imports/upload?filename=${encodeURIComponent(filename)}${query}`,
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

  it('validates: per-row issues, non-blocking', async () => {
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
    // The invariant: total = inserted + updated + skipped.
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

  /**
   * A saved view names no table of its own — it names the PAGE it was saved on,
   * and the page carries the binding. The route resolves that before the grant
   * check and stores the resolved table, which is also what stopped
   * `export-run` throwing "source kind \"view\" is not supported yet" on a row
   * the route had already accepted.
   */
  describe('view sources', () => {
    async function seedView(config: unknown, opts: { userId?: string | null } = {}) {
      const page = await pagesRepo(t.meta).create({
        connectionId: connId,
        slug: `customers-${newId('page')}`,
        type: 'page-crud',
        title: 'Customers',
        config: { source: { connectionId: connId, table: 'main.customers' } },
        origin: 'generated',
      });
      const view = await viewsRepo(t.meta).create({
        pageId: page.id,
        userId: opts.userId === undefined ? null : opts.userId,
        kind: 'filters',
        name: 'Active only',
        config,
      });
      return { page, view };
    }

    it('resolves the view to its page\'s table, runs the job, and applies the view filters', async () => {
      const { view } = await seedView({
        filters: [{ column: 'is_active', op: 'eq', value: 1 }],
      });
      const res = await t.app.inject({
        method: 'POST',
        url: '/api/v1/exports',
        headers: asUser(t.users.admin),
        payload: { connectionId: connId, source: { kind: 'view', viewId: view.id }, format: 'csv' },
      });
      expect(res.statusCode).toBe(202);
      const created = res.json().data as { id: string; source: { table: string; kind: string } };
      // Stored resolved: the job never re-derives the binding RBAC ran against.
      expect(created.source.kind).toBe('view');
      expect(created.source.table).toBe('main.customers');

      const job = await runNextJob(jobs, registry);
      expect(job.status).toBe('succeeded');

      const download = await t.app.inject({
        method: 'GET',
        url: `/api/v1/exports/${created.id}/download`,
        headers: asUser(t.users.admin),
      });
      expect(download.statusCode).toBe(200);
      const rows = parseCsv(download.body);
      // Fewer than the four the unfiltered table export returned: the view's
      // own filter reached the query rather than being dropped on the way.
      expect(rows.length - 1).toBeLessThan(4);
      expect(rows.length - 1).toBeGreaterThan(0);
    });

    it('refuses a view whose search it cannot carry, rather than over-exporting', async () => {
      const { view } = await seedView({ search: 'Alfreds' });
      const res = await t.app.inject({
        method: 'POST',
        url: '/api/v1/exports',
        headers: asUser(t.users.admin),
        payload: { connectionId: connId, source: { kind: 'view', viewId: view.id }, format: 'csv' },
      });
      expect(res.statusCode).toBe(422);
      expect(res.body).toContain('search term');
    });

    it('still checks the per-table grant on the RESOLVED table', async () => {
      const { view } = await seedView({ filters: [] });
      const res = await t.app.inject({
        method: 'POST',
        url: '/api/v1/exports',
        headers: asUser(t.users.editor),
        payload: { connectionId: connId, source: { kind: 'view', viewId: view.id }, format: 'csv' },
      });
      expect(res.statusCode).toBe(403);
      expect((res.json() as { error: { code: string } }).error.code).toBe('TABLE_FORBIDDEN');
    });

    it("reports someone else's private view as absent, not forbidden", async () => {
      const { view } = await seedView({ filters: [] }, { userId: t.users.viewer.id });
      const res = await t.app.inject({
        method: 'POST',
        url: '/api/v1/exports',
        headers: asUser(t.users.admin),
        payload: { connectionId: connId, source: { kind: 'view', viewId: view.id }, format: 'csv' },
      });
      expect(res.statusCode).toBe(404);
    });

    it('rejects `page`, which no source shape can identify', async () => {
      const res = await t.app.inject({
        method: 'POST',
        url: '/api/v1/exports',
        headers: asUser(t.users.admin),
        payload: { connectionId: connId, source: { kind: 'page', table: 'main.customers' }, format: 'csv' },
      });
      expect(res.statusCode).toBe(422);
      expect(res.body).toContain('no page id');
    });
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

  // --- paste, match and preview (last: they add rows the tests above count) ---

  /** Make an import of an upload as the editor, and leave it ready. */
  async function ready(fileId: string, columns: [string, string | null][], options: Record<string, unknown>, user: User = t.users.editor) {
    return t.app.inject({
      method: 'POST',
      url: '/api/v1/imports',
      headers: asUser(user),
      payload: { fileId, connectionId: connId, table: 'main.customers', mapping: { columns: columns.map(([from, to]) => ({ from, to })) }, options },
    });
  }
  const companies = async (): Promise<Record<string, unknown>> => {
    const list = await t.app.inject({ method: 'GET', url: `/api/v1/data/${connId}/main.customers?order=customer_id.asc&limit=100`, headers: asUser(t.users.admin) });
    return Object.fromEntries((list.json() as { data: Record<string, unknown>[] }).data.map((row) => [row.customer_id, row.company_name]));
  };

  it('takes rows pasted with tabs, or parted by semicolons, as it takes a comma file', async () => {
    // (As the admin: the editor's ten imports an hour are spent by the tests around this one.)
    const comma = (await upload(t.users.admin, 'Customer Id,Company\nT1,"Tab, Co"\nT2,Plain\n')).json().data as { columns: string[]; sampleRows: string[][]; totalRows: number; delimiter: string };
    for (const [mark, name] of [['\t', 'tab'], [';', 'semicolon']] as const) {
      const res = await upload(t.users.admin, `Customer Id${mark}Company\r\nT1${mark}"Tab, Co"\r\nT2${mark}Plain\r\n`, 'pasted.csv');
      expect(res.statusCode, res.body).toBe(201);
      const data = res.json().data as typeof comma & { fileId: string };
      expect([data.columns, data.sampleRows, data.totalRows, data.delimiter]).toEqual([comma.columns, comma.sampleRows, comma.totalRows, name]);
      expect(comma.delimiter).toBe('comma');
      // Stored as comma CSV: the validate step, which reads the stored file with commas, finds the same two columns and rows.
      const made = await ready(data.fileId, [['Customer Id', 'customer_id'], ['Company', 'company_name']], {}, t.users.admin);
      expect(made.statusCode, made.body).toBe(201);
      expect((made.json().data as { report: { total: number; valid: number } }).report).toMatchObject({ total: 2, valid: 2 });
    }
  });

  it('names the columns by their place when no row holds their names, previews the lines and brings them in', async () => {
    const res = await upload(t.users.editor, 'P1\tPasted One\nP2\tPasted Two\n', 'pasted.csv', '&header=none');
    expect(res.statusCode, res.body).toBe(201);
    const data = res.json().data as { fileId: string; columns: string[]; sampleRows: string[][]; totalRows: number };
    expect([data.columns, data.sampleRows, data.totalRows]).toEqual([['Column 1', 'Column 2'], [['P1', 'Pasted One'], ['P2', 'Pasted Two']], 2]);
    const made = await ready(data.fileId, [['Column 1', 'customer_id'], ['Column 2', 'company_name']], { mode: 'insert' });
    expect(made.statusCode, made.body).toBe(201);
    const id = (made.json().data as { import: { id: string } }).import.id;
    // No match column: every line is new.
    const preview = await t.app.inject({ method: 'GET', url: `/api/v1/imports/${id}/preview`, headers: asUser(t.users.editor) });
    expect(preview.statusCode, preview.body).toBe(200);
    expect((preview.json().data as { counts: unknown; lines: { status: string }[] }).counts).toEqual({ new: 2, here: 0, refused: 0 });
    await t.app.inject({ method: 'POST', url: `/api/v1/imports/${id}/run`, headers: asUser(t.users.editor) });
    await runNextJob(jobs, registry);
    expect(await companies()).toMatchObject({ P1: 'Pasted One', P2: 'Pasted Two' });
  });

  it('leaves a line whose row is already here as it is (skip), and says so before it runs', async () => {
    const before = await companies();
    const up = await upload(t.users.editor, 'Customer Id,Company,Credit\nALFKI,Changed?,1\nNEW01,New One,5\nNEW02,Bad,xx\nNEW01,Twice,6\n', 'skip.csv');
    const made = await ready((up.json().data as { fileId: string }).fileId, [['Customer Id', 'customer_id'], ['Company', 'company_name'], ['Credit', 'credit_limit']], { mode: 'skip', matchColumn: 'customer_id' });
    expect(made.statusCode, made.body).toBe(201);
    const id = (made.json().data as { import: { id: string } }).import.id;

    const preview = await t.app.inject({ method: 'GET', url: `/api/v1/imports/${id}/preview`, headers: asUser(t.users.editor) });
    expect(preview.statusCode, preview.body).toBe(200);
    const told = preview.json().data as { total: number; judged: number; capped: boolean; hooksNotRun: boolean; counts: unknown; lines: { row: number; status: string; code?: string; column?: string; earlierLine?: number }[] };
    expect([told.total, told.judged, told.capped, told.hooksNotRun]).toEqual([4, 4, false, false]);
    expect(told.counts).toEqual({ new: 1, here: 2, refused: 1 });
    expect(told.lines).toMatchObject([
      { row: 1, status: 'here' },
      { row: 2, status: 'new' },
      { row: 3, status: 'refused', code: 'BAD_NUMBER', column: 'credit_limit' },
      { row: 4, status: 'here', earlierLine: 2 },
    ]);
    // Asking wrote nothing.
    expect(await companies()).toEqual(before);
    // Somebody else's import is not there to preview, whatever they hold.
    expect((await t.app.inject({ method: 'GET', url: `/api/v1/imports/${id}/preview`, headers: asUser(t.users.admin) })).statusCode).toBe(404);

    await t.app.inject({ method: 'POST', url: `/api/v1/imports/${id}/run`, headers: asUser(t.users.editor) });
    await runNextJob(jobs, registry);
    const view = (await t.app.inject({ method: 'GET', url: `/api/v1/imports/${id}`, headers: asUser(t.users.editor) })).json().data as { stats: Record<string, number> };
    // The lines already here are part of `skipped`, and no error: the report holds the bad number alone.
    expect(view.stats).toEqual({ total: 4, inserted: 1, updated: 0, skipped: 3, alreadyHere: 2 });
    expect(await companies()).toEqual({ ...before, NEW01: 'New One' });
    const report = parseCsv((await t.app.inject({ method: 'GET', url: `/api/v1/imports/${id}/error-report`, headers: asUser(t.users.editor) })).body).slice(1).filter((line) => line.length > 1);
    expect(report.map((line) => [line[0], line[2]])).toEqual([['3', 'BAD_NUMBER']]);
    // Run, it is no longer there to preview.
    expect((await t.app.inject({ method: 'GET', url: `/api/v1/imports/${id}/preview`, headers: asUser(t.users.editor) })).statusCode).toBe(409);
  });

  it('runs no hook for a preview, and says that the run will', async () => {
    hooks.on = true;
    try {
      const up = await upload(t.users.admin, 'Customer Id,Company\nALFKI,Hooked rename\nHOOK1,Hooked new\n', 'hooked.csv');
      const made = await ready((up.json().data as { fileId: string }).fileId, [['Customer Id', 'customer_id'], ['Company', 'company_name']], { mode: 'upsert', matchColumn: 'customer_id' }, t.users.admin);
      expect(made.statusCode, made.body).toBe(201);
      const id = (made.json().data as { import: { id: string } }).import.id;
      const preview = await t.app.inject({ method: 'GET', url: `/api/v1/imports/${id}/preview`, headers: asUser(t.users.admin) });
      expect(preview.statusCode, preview.body).toBe(200);
      expect(preview.json().data).toMatchObject({ hooksNotRun: true, counts: { new: 1, here: 1, refused: 0 } });
      expect(hooks.ran).toBe(0);
      await t.app.inject({ method: 'POST', url: `/api/v1/imports/${id}/run`, headers: asUser(t.users.admin) });
      await runNextJob(jobs, registry);
      // Once for the update and once for the new row.
      expect(hooks.ran).toBe(2);
      expect(await companies()).toMatchObject({ ALFKI: 'Hooked rename', HOOK1: 'Hooked new' });
    } finally {
      hooks.on = false;
    }
  });

  it('takes a paste of two hundred thousand lines with no header row', async () => {
    // More lines than a function takes arguments: their widths are not handed to one call.
    const res = await upload(t.users.admin, 'x\n'.repeat(200_000), 'long-paste.csv', '&header=none');
    expect(res.statusCode, res.body.slice(0, 300)).toBe(201);
    expect(res.json().data).toMatchObject({ columns: ['Column 1'], totalRows: 200_000 });
    const wide = await upload(t.users.admin, `a\n${'b,c,d\n'.repeat(150_000)}e,f\n`, 'ragged-paste.csv', '&header=none');
    expect(wide.statusCode, wide.body.slice(0, 300)).toBe(201);
    expect(wide.json().data).toMatchObject({ columns: ['Column 1', 'Column 2', 'Column 3'], totalRows: 150_002 });
  });

  it('reads no more of a long file for a preview than the lines it judges', async () => {
    const lines = 40_000;
    const body = `Customer Id,Company\n${Array.from({ length: lines }, (_, at) => `L${String(at).padStart(6, '0')},A company with a name of some length ${String(at)}`).join('\n')}\n`;
    const up = await upload(t.users.admin, body, 'long.csv');
    expect(up.statusCode, up.body).toBe(201);
    // Left ready as its validation leaves it (written here, not asked for: the ten imports an hour are spent by the tests above).
    const imports = importsRepo(t.meta);
    const made = await imports.create({
      connectionId: connId,
      tableName: 'main.customers',
      requestedBy: t.users.admin.id,
      fileId: (up.json().data as { fileId: string }).fileId,
      mapping: { columns: [{ from: 'Customer Id', to: 'customer_id' }, { from: 'Company', to: 'company_name' }] },
      options: { mode: 'insert' },
    });
    await imports.markReady(made.id, { total: lines });
    const id = made.id;

    bytesRead = 0;
    const preview = await t.app.inject({ method: 'GET', url: `/api/v1/imports/${id}/preview?limit=3`, headers: asUser(t.users.admin) });
    expect(preview.statusCode, preview.body).toBe(200);
    const told = preview.json().data as { total: number; judged: number; capped: boolean; counts: unknown; lines: { row: number; status: string }[] };
    // The whole file's count is the one its validation took; the lines judged are the first two thousand.
    expect([told.total, told.judged, told.capped]).toEqual([lines, 2_000, true]);
    expect(told.counts).toEqual({ new: 2_000, here: 0, refused: 0 });
    expect(told.lines).toEqual([1, 2, 3].map((row) => ({ row, status: 'new' })));
    // Two thousand of forty thousand lines: a twentieth of the file, and what the stream had in hand when it was let go.
    expect(bytesRead).toBeGreaterThan(0);
    expect(bytesRead).toBeLessThan(Buffer.byteLength(body) / 4);
    // A later page judges the same lines and reads no further.
    bytesRead = 0;
    const page = (await t.app.inject({ method: 'GET', url: `/api/v1/imports/${id}/preview?offset=1998&limit=5`, headers: asUser(t.users.admin) })).json().data as typeof told;
    expect([page.total, page.judged, page.lines.map((line) => line.row)]).toEqual([lines, 2_000, [1999, 2000]]);
    expect(bytesRead).toBeLessThan(Buffer.byteLength(body) / 4);
  });

  it('rejects a skip that names no match column', async () => {
    const up = await upload(t.users.editor, 'Customer Id\nZ1\n', 'skip-none.csv');
    const made = await ready((up.json().data as { fileId: string }).fileId, [['Customer Id', 'customer_id']], { mode: 'skip' });
    expect(made.statusCode).toBe(422);
  });
});
