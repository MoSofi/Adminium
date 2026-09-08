// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE READ-ONLY SOURCE STILL TAKES ATTACHMENTS
 * (37-files-and-storage.md §6 criterion 3, §3.5, D11).
 *
 * The criterion is a whole-stack claim and had no test anywhere: "a connection
 * flagged `read_only` with `config.attachments` enabled accepts a sidecar
 * upload on its record page, lists it, and its uploader can delete it; no write
 * reaches the source database (asserted by the adapter's query log)."
 *
 * WHY IT NEEDS ITS OWN SUITE RATHER THAN A CASE IN `files-routes.test.ts`.
 * That suite hands `filesRoutes` a hand-written `pageAttachments` closure, so
 * it proves the ROUTE honours a block and nothing about where a block comes
 * from. The thing this criterion actually promises is that a real stored page
 * turns the panel on — and the stored envelope NESTS its body:
 *
 *   config.source.table        the binding      (envelope level)
 *   config.config.attachments  the sidecar block (body level)
 *
 * Reading that one level too high is exactly how the column-bound half shipped
 * as a silent no-op (see `files/column-blocks.ts`): `attachmentsFor` returns
 * null, the workspace allowlist applies unnarrowed, and every upload succeeds —
 * which looks like a pass. So this suite wires the REAL
 * `createColumnBlockReader` over a REAL `pagesRepo` row, and the discriminating
 * assertion is a REFUSAL: the page says `accept: ['pdf']`, and a PNG (which the
 * workspace allowlist permits) must be turned away with 415. If the nesting
 * were read wrong, that upload would 201.
 *
 * WHY THE QUERY LOG IS THE ONLY HONEST FORM OF "no write reaches the source".
 * Every other formulation is a proxy — the row count did not change, the
 * adapter's `mutate` was not called — and each of them passes for a build that
 * writes through a different door. `sql-recorder.ts` wraps the dialect the
 * `ConnectionManager` actually hands the CRUD path, which is the single seam
 * every statement to the customer's database goes through, so an assertion
 * there is about emitted SQL rather than about observed effects. The suite also
 * asserts the recorder saw a SELECT: "no writes recorded" is vacuously true
 * when nothing is recorded at all.
 */
import BetterSqlite3 from 'better-sqlite3';
import { SqliteDialect } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  AdapterRegistry,
  adapterCapabilitiesSchema,
  parseDatabaseModel,
  type AdapterProvider,
  type DatabaseAdapter,
  type DatabaseModel,
} from '@adminium/engine/adapter';
import { pagesRepo } from '@adminium/meta';

import { createColumnBlockReader } from '../src/files/column-blocks.js';
import { filesRoutes } from '../src/routes/files/index.js';
import { createTestFileStore, TEST_STORAGE_CRYPTO } from './helpers/file-store.js';
import { createSqlSink, recordingDialect, type SqlSink } from './sql-recorder.js';
import {
  asUser,
  buildDataTestApp,
  createConnectionViaApi,
  introspectViaApi,
  type DataTestContext,
} from './connections-helpers.js';

const TABLE = 'main.invoices';
const RECORD = '1042';

const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(400, 0x20)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(120, 7)]);

/**
 * Statements that would change the customer's database. Matched on the leading
 * keyword of the compiled SQL rather than on a substring, so an invoice whose
 * TEXT happens to contain the word "update" cannot fail the assertion, and a
 * DDL statement cannot pass it.
 */
const WRITE_KEYWORDS = /^\s*(insert|update|delete|replace|merge|create|alter|drop|truncate)\b/i;

function seedSqlite(): BetterSqlite3.Database {
  const db = new BetterSqlite3(':memory:');
  db.exec(`
    CREATE TABLE invoices (
      invoice_id TEXT PRIMARY KEY,
      customer TEXT NOT NULL
    );
    INSERT INTO invoices VALUES ('${RECORD}', 'Drift & Fern');
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
        name: 'invoices',
        primaryKey: ['invoice_id'],
        columns: [
          { name: 'invoice_id', logicalType: 'varchar', nullable: false, isPrimaryKey: true },
          { name: 'customer', logicalType: 'varchar', nullable: false },
        ],
      },
    ],
    relations: [],
  });
}

/**
 * The fake adapter of every other CRUD suite, with ONE difference: its probe
 * reports a role that cannot write. That is what makes the connection row come
 * back `readOnly: true` through the ordinary create path — the flag is earned
 * from the probe rather than poked into the meta store afterwards, so the test
 * also covers the mapping that sets it.
 */
function makeReadOnlyRegistry(sqlite: BetterSqlite3.Database, sink: SqlSink): AdapterRegistry<AdapterProvider> {
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
        currentUser: 'reporting',
        canWrite: false,
        ssl: false,
      }),
      probeCapabilities: async () => ({
        capabilities,
        privileges: { canReadSchema: true, canRead: true, canWrite: false, canDDL: false },
        serverVersion: 'FakeSQL 1.0',
        currentRole: { name: 'reporting', readOnly: true },
      }),
      introspect: async () => fakeModel(),
      count: async () => ({ value: 1, capped: false }),
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
      dialect: recordingDialect(new SqliteDialect({ database: sqlite }), sink),
      identifiers: { quote: (identifier: string) => `"${identifier}"`, maxLength: 63 },
      serializers: {},
      destroy: async () => undefined,
    }),
  });
  return registry;
}

describe('a sidecar attachment on a read-only source (§6 criterion 3)', () => {
  let t: DataTestContext;
  let dataDir: string;
  let connId: string;
  let sink: SqlSink;
  let fileId: string;

  function upload(user: Parameters<typeof asUser>[0], body: Buffer, filename: string) {
    const search = new URLSearchParams({ filename, connectionId: connId, table: TABLE, recordId: RECORD });
    return t.app.inject({
      method: 'POST',
      url: `/api/v1/files?${search.toString()}`,
      headers: { ...asUser(user), 'content-type': 'application/octet-stream' },
      payload: body,
    });
  }

  /** Everything the recorder saw that would have changed the customer's data. */
  function sourceWrites(): string[] {
    return sink.queries.filter((sql) => WRITE_KEYWORDS.test(sql));
  }

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'adminium-files-ro-'));
    sink = createSqlSink();
    t = await buildDataTestApp({
      registry: makeReadOnlyRegistry(seedSqlite(), sink),
      extraRoutes: async (api, ctx) => {
        // The REAL block reader over the REAL pages table — see the header on
        // why a hand-written `pageAttachments` closure would prove nothing
        // this criterion is about.
        const columnBlocks = createColumnBlockReader(ctx.meta);
        await api.register(
          filesRoutes({
            meta: ctx.meta,
            storage: createTestFileStore({ dataDir, meta: ctx.meta }),
            storageCrypto: TEST_STORAGE_CRYPTO,
            columnFileBlock: (input) => columnBlocks.forColumn(input),
            pageAttachments: (input) => columnBlocks.attachmentsFor(input.connectionId, input.table),
          }),
        );
      },
    });
    connId = await createConnectionViaApi(t, 'postgres://reporting@fake-host:5432/fakedb', 'reporting-replica');
    await introspectViaApi(t, connId);

    // The stored envelope, in the shape `pagesRepo` actually holds: the binding
    // at the top, the body — columns and `attachments` — one level down.
    await pagesRepo(t.meta).create({
      connectionId: connId,
      slug: 'invoices',
      type: 'page-crud',
      title: 'Invoices',
      config: {
        v: 1,
        kind: 'page',
        template: 'page-crud',
        source: { connectionId: connId, table: TABLE },
        config: {
          columns: [{ name: 'invoice_id' }, { name: 'customer' }],
          attachments: { enabled: true, accept: ['pdf'], maxCount: 5 },
        },
      },
    });

    // The panel's grants: `update` is what authorises an attach (D11), `read`
    // what lets the record page load at all.
    await t.grantTable(t.roles.editor, connId, TABLE, { read: true, create: true, update: true });
  });

  afterAll(async () => {
    await t.app.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('the connection really is flagged read-only, and the source really is closed to writes', async () => {
    expect((await t.manager.connections.findById(connId))?.readOnly).toBe(true);

    // The control. Without this the suite could pass against a build where
    // `read_only` means nothing at all, and "no write reached the source" would
    // be a claim about a connection nobody was stopping.
    const patch = await t.app.inject({
      method: 'PATCH',
      url: `/api/v1/data/${connId}/${TABLE}/${RECORD}`,
      headers: asUser(t.users.editor),
      payload: { values: { customer: 'Someone Else' } },
    });
    expect(patch.statusCode).toBe(403);
    expect(patch.json().error.code).toBe('READ_ONLY_MODE');
  });

  it('the record page loads, and the sidecar upload it offers is accepted', async () => {
    const record = await t.app.inject({
      method: 'GET',
      url: `/api/v1/data/${connId}/${TABLE}/${RECORD}`,
      headers: asUser(t.users.editor),
    });
    expect(record.statusCode).toBe(200);

    const res = await upload(t.users.editor, PDF, 'terms.pdf');
    expect(res.statusCode).toBe(201);
    const body = res.json();
    // Attached on upload, because the record already exists — the sidecar's
    // whole point is that it needs no column to hang off (§3.5).
    expect(body.data.attachedAt).not.toBeNull();
    expect(body.data.entity).toEqual({ connectionId: connId, table: TABLE, recordId: RECORD });
    fileId = body.data.id as string;
  });

  it('reads the stored page’s OWN accept list — the nesting assertion', async () => {
    // `png` is in the default `files.allowedTypes`, so the only thing that can
    // refuse this is the page's `config.config.attachments.accept`. A reader
    // that looked one level too high would return null here and this upload
    // would 201.
    const res = await upload(t.users.editor, PNG, 'screenshot.png');
    expect(res.statusCode).toBe(415);
    expect(res.json().error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    expect(res.json().error.message).toContain('image/png');
  });

  it('lists the attachment under the record — the panel’s query', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/v1/files?connectionId=${connId}&table=${encodeURIComponent(TABLE)}&recordId=${RECORD}`,
      headers: asUser(t.users.editor),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.map((file: { id: string }) => file.id)).toContain(fileId);
  });

  it('its uploader can delete it', async () => {
    const res = await t.app.inject({
      method: 'DELETE',
      url: `/api/v1/files/${fileId}`,
      headers: asUser(t.users.editor),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.deletedAt).not.toBeNull();

    // Trashed, not gone (D12) — and out of the live list the panel renders.
    const listed = await t.app.inject({
      method: 'GET',
      url: `/api/v1/files?connectionId=${connId}&table=${encodeURIComponent(TABLE)}&recordId=${RECORD}`,
      headers: asUser(t.users.editor),
    });
    expect(listed.json().data.map((file: { id: string }) => file.id)).not.toContain(fileId);
  });

  it('sent NO write to the source database across all of it', async () => {
    // The recorder is live — otherwise the assertion below is vacuous.
    expect(sink.queries.some((sql) => /^\s*select\b/i.test(sql))).toBe(true);
    expect(sourceWrites()).toEqual([]);
  });
});
