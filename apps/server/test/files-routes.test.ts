// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `/files` routes end to end.
 *
 * The assertions that matter most are the authorisation ones, because the
 * model here is deliberately unusual: there is no "can upload" grant. An
 * upload is authorised by `create`/`update` on the table the file is FOR, a
 * download by `read` on that table, and `files.manage` governs only OTHER
 * people's files. Every one of those four rules gets a test that would pass if
 * the rule were "everyone may" — so each also checks the refusal.
 */
import BetterSqlite3 from 'better-sqlite3';
import { SqliteDialect } from 'kysely';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

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
import {
  filesRepo,
  permissionsRepo,
  rolesRepo,
  settingsRepo,
  usersRepo,
  type Role,
  type User,
} from '@adminium/meta';

import type { FileReconciler, ReconcileResult } from '../src/files/reconcile.js';
import { type FileStore } from '../src/files/store.js';
import { authorizeChannel, RealtimeHub, type RealtimeEvent } from '../src/realtime/hub.js';
import { filesRoutes } from '../src/routes/files/index.js';
import { createTestFileStore, TEST_STORAGE_CRYPTO } from './helpers/file-store.js';
import {
  asUser,
  buildDataTestApp,
  createConnectionViaApi,
  introspectViaApi,
  type DataTestContext,
} from './connections-helpers.js';

const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(400, 0x20)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(120, 7)]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect/></svg>');

function seedSqlite(): BetterSqlite3.Database {
  const db = new BetterSqlite3(':memory:');
  db.exec(`
    CREATE TABLE invoices (
      invoice_id TEXT PRIMARY KEY,
      customer TEXT NOT NULL,
      pdf_url TEXT,
      logo_url TEXT
    );
    INSERT INTO invoices VALUES ('1042', 'Drift & Fern', NULL, NULL);
  `);
  return db;
}

/** The data-io suite's fake adapter, narrowed to one invoices table. */
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
          { name: 'pdf_url', logicalType: 'varchar', nullable: true },
          { name: 'logo_url', logicalType: 'varchar', nullable: true },
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

/**
 * A hub that keeps what it published.
 *
 * `RealtimeHub.publish` is a silent no-op with no subscribers, and that is
 * exactly the state of the world at the moment of the write: the record page
 * that wants the event subscribes on some other machine, later or not at all.
 * So the assertion cannot be "a subscriber received it" — it has to be "what
 * went out, and could anyone have been listening for it".
 */
class RecordingHub extends RealtimeHub {
  readonly published: RealtimeEvent[] = [];
  override publish(channel: string, type: string, data: unknown, at?: number): RealtimeEvent {
    const event = super.publish(channel, type, data, at);
    this.published.push(event);
    return event;
  }
}

describe('files routes', () => {
  let t: DataTestContext;
  let storage: FileStore;
  let dataDir: string;
  let connId: string;
  let table: string;
  /**
   * The principal: `read` on the table and nothing else.
   *
   * It cannot be `t.users.viewer`, which is otherwise the read-only user here —
   * the list tests below grant that role `files.manage`, and every test after
   * them would then be about a caller who may see everyone's files rather than
   * about the table grant the criterion is about. This role is created empty
   * and never granted anything else, so a 200 for it has exactly one possible
   * source.
   */
  let reader: User;
  let readerRole: Role;
  /**
   * The LIBRARY principal: `files.manage` and NO table grant at all.
   *
   * Deliberately not `reader`, whose whole value above is that it holds one
   * table grant and nothing else — granting it `files.manage` here would make
   * every later criterion-7 assertion pass for a second reason. And not the
   * editor either: the point of the 403 test is that create+update on a table
   * is exactly the grant that does not authorise a table-less upload.
   */
  let librarian: User;
  let librarianRole: Role;
  /** Mutable so one test can put a cap in place without a second harness. */
  let sidecarConfig: { accept?: readonly string[]; maxBytes?: number; maxCount?: number } | null = null;
  let hub: RecordingHub;
  /**
   * What the reconciler reports for the next data mutation. The reconciler
   * itself has a suite of its own (files-reconcile.test.ts); what has never
   * been covered is what the DATA route does with its answer, so it is a seam
   * here rather than a second copy of that setup.
   */
  let reconciled: ReconcileResult = { attached: [], trashed: [] };
  const reconciler: FileReconciler = {
    reconcile: async () => reconciled,
    // No `multiple` column in this suite's fixture, so the real validator
    // would answer null for every write here anyway; 38's own suite exercises
    // it against real blocks.
    validateWrite: async () => null,
    filesForRecord: async () => [],
    trashForRecord: async () => [],
    restoreAll: async () => undefined,
  };

  /** The stored ref is the DOTTED key (`files.manage`), not the colon grant string. */
  async function grantSystem(role: Role, key: string): Promise<void> {
    await permissionsRepo(t.meta).grant(role.id, 'system', key, { allowed: true });
  }

  function upload(
    user: Parameters<typeof asUser>[0],
    body: Buffer,
    query: Record<string, string>,
    contentType = 'application/octet-stream',
    headers: Record<string, string> = {},
  ) {
    const search = new URLSearchParams(query).toString();
    return t.app.inject({
      method: 'POST',
      url: `/api/v1/files?${search}`,
      headers: { ...asUser(user), 'content-type': contentType, ...headers },
      payload: body,
    });
  }

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'adminium-files-routes-'));
    const db = seedSqlite();
    hub = new RecordingHub();
    t = await buildDataTestApp({
      registry: makeFakeRegistry(db),
      realtime: hub,
      files: reconciler,
      extraRoutes: async (api, ctx) => {
        storage = createTestFileStore({ dataDir, meta: ctx.meta });
        await api.register(
          filesRoutes({
            meta: ctx.meta,
            storage,
            storageCrypto: TEST_STORAGE_CRYPTO,
            // The block reader is exercised by its own suite; here a fixed
            // block proves the route HONOURS one.
            columnFileBlock: async ({ column }) => {
              if (column === 'pdf_url') return { ref: 'url', accept: ['pdf'] };
              // An IMAGES-ONLY column, so the extension/head mismatch below has
              // a column whose allowlist the honest reading and the dishonest
              // one disagree about.
              if (column === 'logo_url') return { ref: 'url', accept: ['png', 'jpeg', 'gif', 'webp'] };
              return null;
            },
            // The SIDECAR half: a page's `config.attachments` narrows
            // the same three things for an upload that names no column, and
            // caps how many one record may hold.
            pageAttachments: async () => sidecarConfig,
          }),
        );
      },
    });
    connId = await createConnectionViaApi(t, 'postgres://fake@fake-host:5432/fakedb');
    await introspectViaApi(t, connId);
    table = 'main.invoices';

    await t.grantTable(t.roles.editor, connId, table, { read: true, create: true, update: true });
    await t.grantTable(t.roles.viewer, connId, table, { read: true });

    readerRole = await rolesRepo(t.meta).create({ slug: 'files-reader', name: 'Files reader' });
    reader = await usersRepo(t.meta).create({ email: 'reader@adminium.test', name: 'Noor' });
    await rolesRepo(t.meta).assignToUser(reader.id, readerRole.id);
    await t.grantTable(readerRole, connId, table, { read: true });

    librarianRole = await rolesRepo(t.meta).create({ slug: 'files-librarian', name: 'Librarian' });
    librarian = await usersRepo(t.meta).create({ email: 'librarian@adminium.test', name: 'Tam' });
    await rolesRepo(t.meta).assignToUser(librarian.id, librarianRole.id);
    await permissionsRepo(t.meta).grant(librarianRole.id, 'system', 'files.manage', { allowed: true });
  });

  afterAll(async () => {
    await t.app.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  describe('upload', () => {
    it('201s, stores the SNIFFED type and returns the configured ref shape', async () => {
      const res = await upload(t.users.editor, PDF, {
        filename: 'inv-1042.pdf',
        connectionId: connId,
        table,
        column: 'pdf_url',
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      // Advisory content-type in, sniffed type out.
      expect(body.data.mime).toBe('application/pdf');
      expect(body.data.filename).toBe('inv-1042.pdf');
      expect(body.data.attachedAt).toBeNull();
      // `url` is the configured shape (D31), and it names THIS instance.
      expect(body.ref).toMatch(new RegExp(`/api/v1/files/${String(body.data.id)}/content$`));
      expect(body.data.contentPath).toBe(`/api/v1/files/${String(body.data.id)}/content`);
    });

    it("names the instance's public origin in a url ref, never the caller's Origin", async () => {
      const query = { filename: 'inv-1043.pdf', connectionId: connId, table, column: 'pdf_url' };
      const forged = { origin: 'https://evil.example', host: 'admin.example.com' };

      // Nothing stored: the host the upload was sent to.
      const before = await upload(t.users.editor, PDF, query, 'application/octet-stream', forged);
      expect(before.statusCode).toBe(201);
      expect(before.json().ref).toBe(`http://admin.example.com/api/v1/files/${String(before.json().data.id)}/content`);

      // Stored: the same address email links use, whatever the request says.
      await settingsRepo(t.meta).set('system.publicOrigin', 'https://admin.example.com', { updatedBy: null });
      try {
        const after = await upload(t.users.editor, PDF, query, 'application/octet-stream', {
          ...forged,
          host: 'evil.example',
        });
        expect(after.statusCode).toBe(201);
        expect(after.json().ref).toBe(`https://admin.example.com/api/v1/files/${String(after.json().data.id)}/content`);
      } finally {
        await settingsRepo(t.meta).unset('system.publicOrigin');
      }
    });

    it('refuses without create OR update on the table, naming the grant', async () => {
      // The viewer has `read` only.
      const res = await upload(t.users.viewer, PDF, { filename: 'x.pdf', connectionId: connId, table });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.details.permission).toBe(`table:${connId}:${table}:update`);
    });

    it('refuses an upload that names no connection at all', async () => {
      // "Must name a table" was reversed; "must belong to a connection"
      // stands, and is what keeps a file findable at all.
      const res = await upload(t.users.editor, PDF, { filename: 'orphan.pdf' });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('VALIDATION_FAILED');
    });

    it('refuses a column upload that names no table, since nothing can resolve the ref', async () => {
      const res = await upload(t.users.editor, PDF, {
        filename: 'x.pdf',
        connectionId: connId,
        column: 'pdf_url',
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.details.table).toBe('required');
    });

    /*
     * The LIBRARY upload — the Files page's own.
     *
     * Three facts are asserted together because getting any one of them wrong
     * is silent: the grant that authorises it, the connection it records, and
     * the `attachedAt` stamp. Without the stamp the file reads as an abandoned
     * create-form upload and the daily sweep deletes it inside a day; the
     * companion assertion lives in files-retention-sweep.test.ts, where the
     * sweep actually runs.
     */
    describe('a file that belongs to the workspace rather than to a record', () => {
      it('201s with files.manage and no table, recording the connection and claiming the file', async () => {
        // The librarian holds NO table grant, so this 201 has exactly one
        // possible source.
        const res = await upload(librarian, PDF, { filename: 'price-list.pdf', connectionId: connId });

        expect(res.statusCode).toBe(201);
        const body = res.json();
        expect(body.data.connectionId).toBe(connId);
        // No record: `entity` is what names one, and there is none.
        expect(body.data.entity).toBeNull();
        // Claimed by the workspace — the sweep's question is "did anything
        // ever claim this", not "does it have a record".
        expect(body.data.attachedAt).not.toBeNull();
        // Nothing to write into a column, so no ref is minted.
        expect(body.ref).toBeUndefined();

        const stored = await filesRepo(t.meta).findById(body.data.id as string);
        expect(stored?.entityTable).toBeNull();
        expect(stored?.entityId).toBeNull();
        expect(stored?.entityConnectionId).toBe(connId);
      });

      it('refuses it without files.manage, naming that grant and not a table grant', async () => {
        // The editor holds create+update on the table — which is exactly the
        // grant that does NOT authorise a file belonging to no table.
        const res = await upload(t.users.editor, PDF, { filename: 'nope.pdf', connectionId: connId });
        expect(res.statusCode).toBe(403);
        expect(res.json().error.details.permission).toBe('system:files:manage');
      });

      it('leaves the create-form upload unclaimed, so an abandoned form is still collected', async () => {
        // The same shape minus the table is claimed; with a table it must not
        // be, or whole unattached lifecycle stops working.
        const res = await upload(t.users.editor, PDF, { filename: 'draft.pdf', connectionId: connId, table });
        expect(res.statusCode).toBe(201);
        expect(res.json().data.attachedAt).toBeNull();
        // …and it still records which connection it was for.
        expect(res.json().data.connectionId).toBe(connId);
      });
    });

    it('415s on a type the column does not accept, naming what it actually is', async () => {
      const res = await upload(t.users.editor, PNG, {
        filename: 'logo.png',
        connectionId: connId,
        table,
        column: 'pdf_url',
      });
      expect(res.statusCode).toBe(415);
      expect(res.json().error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
      expect(res.json().error.message).toContain('image/png');
    });

    it('415s a PDF wearing a.png name at an images-only column (criterion 6)', async () => {
      // THE MISMATCH CASE, and the only one that separates a real sniffer from
      // an extension lookup. The case above sends PNG bytes called `logo.png`,
      // which an extension reader would refuse for the same reason a head
      // reader does; `files-spool-sniff.test.ts` proves the sniffer REPORTS
      // `application/pdf` here and says in its own comment that the refusal is
      // this route's job. So: PDF BYTES, `.png` FILENAME, a column that takes
      // images only — the refusal must name what the bytes ARE.
      const res = await upload(t.users.editor, PDF, {
        filename: 'totally-an-image.png',
        connectionId: connId,
        table,
        column: 'logo_url',
      });
      expect(res.statusCode).toBe(415);
      expect(res.json().error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
      expect(res.json().error.message).toContain('application/pdf');
      // The sniffed type is on `details` as well as in the sentence, so this
      // assertion still holds if the message is ever reworded.
      expect(res.json().error.details.mime).toBe('application/pdf');

      // …and the honest file lands at the same column, so the refusal above is
      // about the CONTENT and not about the column being closed.
      const accepted = await upload(t.users.editor, PNG, {
        filename: 'logo.png',
        connectionId: connId,
        table,
        column: 'logo_url',
      });
      expect(accepted.statusCode).toBe(201);
      expect(accepted.json().data.mime).toBe('image/png');
    });

    it('415s on content no signature matches', async () => {
      const res = await upload(t.users.editor, Buffer.from([1, 2, 3, 4, 5]), {
        filename: 'mystery.bin',
        connectionId: connId,
        table,
      });
      expect(res.statusCode).toBe(415);
    });

    it('413s past files.maxBytes and stores nothing', async () => {
      await settingsRepo(t.meta).set('files.maxBytes', 1024);
      const before = (await filesRepo(t.meta).search({ limit: 200 })).rows.length;
      const res = await upload(t.users.editor, Buffer.concat([PDF, Buffer.alloc(4096)]), {
        filename: 'big.pdf',
        connectionId: connId,
        table,
      });
      expect(res.statusCode).toBe(413);
      expect(res.json().error.code).toBe('FILE_TOO_LARGE');
      expect((await filesRepo(t.meta).search({ limit: 200 })).rows).toHaveLength(before);
      await settingsRepo(t.meta).set('files.maxBytes', 209_715_200);
    });

    it('attaches on upload when a record is named', async () => {
      const res = await upload(t.users.editor, PDF, {
        filename: 'attached.pdf',
        connectionId: connId,
        table,
        recordId: '1042',
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().data.attachedAt).not.toBeNull();
      expect(res.json().data.entity).toEqual({ connectionId: connId, table, recordId: '1042' });
    });
  });

  describe('content', () => {
    let fileId: string;

    beforeAll(async () => {
      const res = await upload(t.users.editor, PDF, {
        filename: 'served.pdf',
        connectionId: connId,
        table,
        recordId: '1042',
      });
      fileId = res.json().data.id as string;
    });

    it('streams the bytes with nosniff and an attachment disposition', async () => {
      const res = await t.app.inject({
        method: 'GET',
        url: `/api/v1/files/${fileId}/content`,
        headers: asUser(t.users.editor),
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-disposition']).toContain('attachment');
      // RFC 5987 alongside the ASCII fallback.
      expect(res.headers['content-disposition']).toContain("filename*=UTF-8''served.pdf");
      expect(res.rawPayload.equals(PDF)).toBe(true);
    });

    it('answers 304 to a matching If-None-Match', async () => {
      const first = await t.app.inject({
        method: 'GET',
        url: `/api/v1/files/${fileId}/content`,
        headers: asUser(t.users.editor),
      });
      const etag = first.headers.etag as string;
      const res = await t.app.inject({
        method: 'GET',
        url: `/api/v1/files/${fileId}/content`,
        headers: { ...asUser(t.users.editor), 'if-none-match': etag },
      });
      expect(res.statusCode).toBe(304);
    });

    it('serves a byte range as 206 with a Content-Range', async () => {
      const res = await t.app.inject({
        method: 'GET',
        url: `/api/v1/files/${fileId}/content`,
        headers: { ...asUser(t.users.editor), range: 'bytes=0-8' },
      });
      expect(res.statusCode).toBe(206);
      expect(res.headers['content-range']).toBe(`bytes 0-8/${String(PDF.byteLength)}`);
      expect(res.rawPayload.toString()).toBe('%PDF-1.7\n');
    });

    it('honours ?inline=1 for a PDF', async () => {
      const res = await t.app.inject({
        method: 'GET',
        url: `/api/v1/files/${fileId}/content?inline=1`,
        headers: asUser(t.users.editor),
      });
      expect(res.headers['content-disposition']).toContain('inline');
      expect(res.headers['content-security-policy']).toBe('sandbox');
    });

    it('serves SVG as an attachment EVEN with ?inline=1', async () => {
      const uploaded = await upload(t.users.editor, SVG, {
        filename: 'logo.svg',
        connectionId: connId,
        table,
        recordId: '1042',
      });
      expect(uploaded.statusCode).toBe(201);
      const res = await t.app.inject({
        method: 'GET',
        url: `/api/v1/files/${String(uploaded.json().data.id)}/content?inline=1`,
        headers: asUser(t.users.editor),
      });
      // Same-origin inline SVG is a stored-XSS primitive; the flag cannot turn
      // it on (D9).
      expect(res.headers['content-disposition']).toContain('attachment');
      // The instance-wide CSP is still on the response; what must NOT be there
      // is the per-response `sandbox` an inline render would add.
      expect(res.headers['content-security-policy']).not.toBe('sandbox');
    });

    it('404s for a caller without read on the entity table', async () => {
      // A user in no role that grants this table anything.
      const res = await t.app.inject({
        method: 'GET',
        url: `/api/v1/files/${fileId}/content`,
        headers: asUser(t.users.admin),
      });
      expect(res.statusCode).toBe(404);
    });

    it('serves an attached file to `read` on its table, to a caller who did not upload it', async () => {
      // THE POSITIVE HALF, and nothing reached it before. Every
      // other download in this file is performed by the editor who uploaded the
      // bytes, and `canRead`'s uploader clause lets an uploader through
      // whatever the table grant says — so the attached branch was only ever
      // entered by a caller who would have passed anyway, and the grant that is
      // supposed to be doing the work was never the reason for a single 200.
      // The reader uploaded nothing here, holds no `update` and holds no
      // `files.manage`, so this 200 can only have come from
      // `table:<conn>:main.invoices:read`.
      const res = await t.app.inject({
        method: 'GET',
        url: `/api/v1/files/${fileId}/content`,
        headers: asUser(reader),
      });
      expect(res.statusCode).toBe(200);
      expect(res.rawPayload.equals(PDF)).toBe(true);
      // The row it served is somebody else's upload — the premise of the test,
      // asserted rather than assumed.
      expect((await filesRepo(t.meta).findById(fileId))?.uploadedBy).toBe(t.users.editor.id);
    });

    it('refuses that same reader an attach — `read` is not `update` (criterion 7)', async () => {
      // The negative half for the SAME principal. Without it the test above
      // would be satisfied by a route that had stopped checking anything: the
      // pair is what says `read` opens the download and only the download.
      // (The other negative — a caller with neither grant — is the 404 case
      // above, which the admin user, granted nothing on this table, covers.)
      const res = await t.app.inject({
        method: 'POST',
        url: `/api/v1/files/${fileId}/attach`,
        headers: asUser(reader),
        payload: { connectionId: connId, table, recordId: '2001' },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.details.permission).toBe(`table:${connId}:${table}:update`);
      // …and the refusal actually refused: the file still belongs to 1042.
      expect((await filesRepo(t.meta).findById(fileId))?.entityId).toBe('1042');
    });

    it('404s once trashed, and serves again after restore', async () => {
      const uploaded = await upload(t.users.editor, PDF, {
        filename: 'temporary.pdf',
        connectionId: connId,
        table,
        recordId: '1042',
      });
      const id = uploaded.json().data.id as string;

      const deleted = await t.app.inject({
        method: 'DELETE',
        url: `/api/v1/files/${id}`,
        headers: asUser(t.users.editor),
      });
      expect(deleted.statusCode).toBe(200);
      expect(deleted.json().data.deletedAt).not.toBeNull();

      const gone = await t.app.inject({
        method: 'GET',
        url: `/api/v1/files/${id}/content`,
        headers: asUser(t.users.editor),
      });
      expect(gone.statusCode).toBe(404);

      const restored = await t.app.inject({
        method: 'POST',
        url: `/api/v1/files/${id}/restore`,
        headers: asUser(t.users.editor),
      });
      expect(restored.statusCode).toBe(200);
      const back = await t.app.inject({
        method: 'GET',
        url: `/api/v1/files/${id}/content`,
        headers: asUser(t.users.editor),
      });
      expect(back.statusCode).toBe(200);
    });
  });

  describe('list and resolve', () => {
    it('is mine-only without files.manage, and everyone’s with it', async () => {
      const mine = await t.app.inject({ method: 'GET', url: '/api/v1/files', headers: asUser(t.users.editor) });
      expect(mine.statusCode).toBe(200);
      expect(mine.json().data.length).toBeGreaterThan(0);
      for (const file of mine.json().data) expect(file.uploadedBy).toBe(t.users.editor.id);

      // The viewer uploaded nothing.
      const empty = await t.app.inject({ method: 'GET', url: '/api/v1/files', headers: asUser(t.users.viewer) });
      expect(empty.json().data).toEqual([]);

      await grantSystem(t.roles.viewer, 'files.manage');
      const all = await t.app.inject({ method: 'GET', url: '/api/v1/files', headers: asUser(t.users.viewer) });
      expect(all.json().data.length).toBeGreaterThan(0);
    });

    it('filters to one record — the Attachments panel’s query', async () => {
      const res = await t.app.inject({
        method: 'GET',
        url: `/api/v1/files?connectionId=${connId}&table=${encodeURIComponent(table)}&recordId=1042`,
        headers: asUser(t.users.editor),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.length).toBeGreaterThan(0);
      for (const file of res.json().data) expect(file.entity.recordId).toBe('1042');
    });

    it('filters to one connection with no table — the Files page’s By-connection preset', async () => {
      // Every upload in this suite records its connection now, library
      // and record-bound alike, which is what makes the preset a single query.
      const res = await t.app.inject({
        method: 'GET',
        url: `/api/v1/files?connectionId=${connId}`,
        headers: asUser(librarian),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.length).toBeGreaterThan(0);
      for (const file of res.json().data) expect(file.connectionId).toBe(connId);
    });

    it('narrows to what arrived recently — the Recent preset', async () => {
      const before = Date.now();
      const fresh = await upload(librarian, PDF, { filename: 'just-now.pdf', connectionId: connId });
      expect(fresh.statusCode).toBe(201);

      const recent = await t.app.inject({
        method: 'GET',
        url: `/api/v1/files?since=${String(before)}`,
        headers: asUser(librarian),
      });
      expect(recent.statusCode).toBe(200);
      const ids = recent.json().data.map((f: { id: string }) => f.id);
      expect(ids).toContain(fresh.json().data.id);
      // Every row is genuinely at or after the cutoff — a filter that returned
      // the whole table would satisfy the assertion above on its own.
      for (const file of recent.json().data) expect(file.createdAt).toBeGreaterThanOrEqual(before);

      // A cutoff in the future is the honest empty case, and proves the
      // parameter is doing the narrowing rather than being ignored.
      const none = await t.app.inject({
        method: 'GET',
        url: `/api/v1/files?since=${String(Date.now() + 60_000)}`,
        headers: asUser(librarian),
      });
      expect(none.json().data).toEqual([]);
    });

    it('resolves a batch of refs and answers null for anything foreign', async () => {
      const uploaded = await upload(t.users.editor, PDF, {
        filename: 'resolvable.pdf',
        connectionId: connId,
        table,
        recordId: '1042',
        column: 'pdf_url',
      });
      const { data, ref } = uploaded.json();

      const res = await t.app.inject({
        method: 'POST',
        url: '/api/v1/files/resolve',
        headers: asUser(t.users.editor),
        payload: {
          refs: [ref as string, data.id as string, 'https://example.com/somebody-elses.pdf', 'file_NOPE'],
        },
      });
      expect(res.statusCode).toBe(200);
      const resolved = res.json().data;
      // Both of our shapes resolve to the same row…
      expect(resolved[ref as string].id).toBe(data.id);
      expect(resolved[data.id as string].id).toBe(data.id);
      // …and a foreign link is left alone, which is what makes a mixed column work.
      expect(resolved['https://example.com/somebody-elses.pdf']).toBeNull();
      expect(resolved['file_NOPE']).toBeNull();
    });

    it('reports usage per destination', async () => {
      const res = await t.app.inject({
        method: 'GET',
        url: '/api/v1/files/usage',
        headers: asUser(t.users.viewer), // holds files.manage from the test above
      });
      expect(res.statusCode).toBe(200);
      const local = res.json().data.find((entry: { destinationId: null | string }) => entry.destinationId === null);
      expect(local.name).toBe("This server's disk");
      expect(local.files).toBeGreaterThan(0);
      expect(local.bytes).toBeGreaterThan(0);
      // Local reports free space; the copy that renders it must never say "of"
      // or "free" (D23, Appendix D) — that is the Files page's test, but the
      // FIGURE has to exist for it to render one.
      expect(typeof local.available).toBe('number');
    });
  });

  describe('attach, detach and rename', () => {
    let id: string;

    beforeAll(async () => {
      const res = await upload(t.users.editor, PDF, {
        filename: 'movable.pdf',
        connectionId: connId,
        table,
      });
      id = res.json().data.id as string;
    });

    it('attaches, then detaches back to unattached', async () => {
      const attached = await t.app.inject({
        method: 'POST',
        url: `/api/v1/files/${id}/attach`,
        headers: asUser(t.users.editor),
        payload: { connectionId: connId, table, recordId: '1042' },
      });
      expect(attached.statusCode).toBe(200);
      expect(attached.json().data.entity.recordId).toBe('1042');

      const detached = await t.app.inject({
        method: 'POST',
        url: `/api/v1/files/${id}/detach`,
        headers: asUser(t.users.editor),
      });
      expect(detached.statusCode).toBe(200);
      expect(detached.json().data.entity).toBeNull();
      expect(detached.json().data.attachedAt).toBeNull();
    });

    it('renames the DISPLAY name and leaves the storage key alone', async () => {
      const before = await filesRepo(t.meta).findById(id);
      const res = await t.app.inject({
        method: 'PATCH',
        url: `/api/v1/files/${id}`,
        headers: asUser(t.users.editor),
        payload: { filename: 'renamed.pdf' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.filename).toBe('renamed.pdf');
      // Renaming the object would break every `key`-shaped reference already
      // written into a customer's column.
      expect((await filesRepo(t.meta).findById(id))?.storageKey).toBe(before?.storageKey);
    });

    it('refuses an attach without update on the target table', async () => {
      const res = await t.app.inject({
        method: 'POST',
        url: `/api/v1/files/${id}/attach`,
        headers: asUser(t.users.admin),
        payload: { connectionId: connId, table, recordId: '1042' },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('the sidecar configuration is enforced on the wire', () => {
    // The Studio's Attachments card offers accept / maxBytes / maxCount. Before
    // this, NOTHING on the server read them — three controls that changed only
    // what the browser was willing to send. A cap the client alone applies is a
    // suggestion; these tests are what make them real.
    afterEach(() => {
      sidecarConfig = null;
    });

    it('narrows the allowlist for an upload that names no column', async () => {
      sidecarConfig = { accept: ['pdf'] };
      const refused = await upload(t.users.editor, PNG, {
        filename: 'logo.png',
        connectionId: connId,
        table,
        recordId: '1042',
      });
      expect(refused.statusCode).toBe(415);
      expect(refused.json().error.message).toContain('image/png');

      // …and a type it DOES allow still lands.
      const accepted = await upload(t.users.editor, PDF, {
        filename: 'ok.pdf',
        connectionId: connId,
        table,
        recordId: '1042',
      });
      expect(accepted.statusCode).toBe(201);
    });

    it('applies the page cap even when the workspace limit is larger', async () => {
      sidecarConfig = { maxBytes: 64 };
      const res = await upload(t.users.editor, PDF, {
        filename: 'big-for-this-page.pdf',
        connectionId: connId,
        table,
        recordId: '1042',
      });
      expect(res.statusCode).toBe(413);
      expect(res.json().error.details.maxBytes).toBe(64);
    });

    it('refuses past maxCount BEFORE spooling the bytes', async () => {
      const record = 'count-capped';
      const first = await upload(t.users.editor, PDF, {
        filename: 'one.pdf',
        connectionId: connId,
        table,
        recordId: record,
      });
      expect(first.statusCode).toBe(201);

      sidecarConfig = { maxCount: 1 };
      const second = await upload(t.users.editor, PDF, {
        filename: 'two.pdf',
        connectionId: connId,
        table,
        recordId: record,
      });
      // A refusal that arrives after a 200 MB upload has landed is a refusal
      // that cost the user two minutes and the server a disk write.
      expect(second.statusCode).toBe(409);
      expect(second.json().error.details.maxCount).toBe(1);
      expect(
        (await filesRepo(t.meta).listByEntity({ connectionId: connId, table, recordId: record })).length,
      ).toBe(1);
    });

    it('does not apply the sidecar block to a COLUMN upload', async () => {
      // A column names its own block; the page's is for the panel.
      sidecarConfig = { accept: ['png'] };
      const res = await upload(t.users.editor, PDF, {
        filename: 'inv.pdf',
        connectionId: connId,
        table,
        column: 'pdf_url',
      });
      expect(res.statusCode).toBe(201);
    });
  });

  describe('the realtime fan-out an open record page listens for', () => {
    /**
     * The producer existed and the event reached nobody. `table:<conn>:<table>`
     * is a PUBLISH-ONLY channel — `parseChannel` has no case for it, so
     * `authorizeChannel` denies every subscription (realtime-hub.test.ts pins
     * that as its deny-by-default example) — so an event addressed there is
     * dropped by the gateway before any browser sees it, in silence and on
     * both transports. Hence the assertion below is not "an event was
     * published" but "an event was published somewhere a reader of this table
     * is allowed to listen".
     */
    const reader = { id: 'usr_reader' };
    /** RBAC as the WS/SSE gateway would run it: table read and nothing else. */
    const tableReadOnly = { can: (_u: { id: string }, permission: string) => permission === `table:${connId}:${table}:read` };

    async function patchPdfUrl(value: string) {
      return t.app.inject({
        method: 'PATCH',
        url: `/api/v1/data/${connId}/${table}/1042`,
        headers: asUser(t.users.editor),
        payload: { values: { pdf_url: value } },
      });
    }

    afterEach(() => {
      reconciled = { attached: [], trashed: [] };
      hub.published.length = 0;
    });

    it('publishes record.attachments where a reader of the table may subscribe', async () => {
      reconciled = { attached: ['file_attached'], trashed: [] };
      hub.published.length = 0;

      expect((await patchPdfUrl('https://files.example.test/inv-1042.pdf')).statusCode).toBe(200);

      const event = hub.published.find((published) => published.type === 'record.attachments');
      expect(event).toBeDefined();
      expect(await authorizeChannel(reader, (event as RealtimeEvent).channel, tableReadOnly)).toBe(true);
    });

    it('carries no unmasked row, and never a raw value beyond the pk', async () => {
      reconciled = { attached: [], trashed: ['file_replaced'] };
      hub.published.length = 0;

      expect((await patchPdfUrl('https://files.example.test/inv-1042-v2.pdf')).statusCode).toBe(200);

      const event = hub.published.find((published) => published.type === 'record.attachments');
      expect(event?.data).toEqual({
        type: 'record.attachments',
        pk: { invoice_id: '1042' },
        row: null,
      });
    });

    /**
     * THE SIDECAR HALF of D27, which the column-bound tests above do not reach.
     * `routes/data` publishes only for a write that went through a file COLUMN;
     * a file dropped on the record page's own Attachments panel never touches
     * `routes/data` at all, so before this the panel only refreshed in the tab
     * that did the writing — the exact case sidecar mode exists for.
     */
    async function sidecarFile() {
      const res = await upload(t.users.editor, PDF, {
        filename: 'sidecar.pdf',
        connectionId: connId,
        table,
        recordId: '1042',
      });
      expect(res.statusCode).toBe(201);
      return res.json().data.id as string;
    }

    const attachmentEvents = () => hub.published.filter((p) => p.type === 'record.attachments');

    it('publishes when a SIDECAR upload attaches, on a channel a reader may join', async () => {
      hub.published.length = 0;
      await sidecarFile();
      const event = attachmentEvents()[0];
      expect(event, 'a sidecar upload must reach an open panel in another tab').toBeDefined();
      expect(await authorizeChannel(reader, (event as RealtimeEvent).channel, tableReadOnly)).toBe(true);
      // No pk and no row: there is nothing here worth masking, and the panel
      // only needs to know that this table's attachments moved.
      expect(event?.data).toEqual({ type: 'record.attachments', pk: null, row: null });
    });

    it('publishes on detach, trash and restore', async () => {
      // A FRESH attached file per operation, deliberately. Chaining them
      // (detach → trash → restore on one file) proves nothing after the first
      // step: detach clears the entity columns, so the later routes correctly
      // have no panel to notify and publish nothing. That is right behaviour
      // and a wrong test — it was the first version of this one.
      for (const [label, method, path] of [
        ['detach', 'POST', 'detach'],
        ['trash', 'DELETE', ''],
        ['restore', 'POST', 'restore'],
      ] as const) {
        const id = await sidecarFile();
        if (label === 'restore') {
          // Restore only means anything to a trashed file.
          const trashed = await t.app.inject({
            method: 'DELETE',
            url: `/api/v1/files/${id}`,
            headers: asUser(t.users.editor),
          });
          expect(trashed.statusCode).toBe(200);
        }
        hub.published.length = 0;
        const res = await t.app.inject({
          method,
          url: path === '' ? `/api/v1/files/${id}` : `/api/v1/files/${id}/${path}`,
          headers: asUser(t.users.editor),
        });
        expect(res.statusCode, `${label} should succeed`).toBe(200);
        expect(attachmentEvents().length, `${label} must publish`).toBeGreaterThan(0);
      }
    });

    it('says nothing for an upload that named no record', async () => {
      // Scoped to the table but attached to no row — it belongs to nobody's
      // panel yet, so a refetch would be pure noise on every open record page
      // for this table. (An upload naming no table at all is refused 422
      // upstream, so this is the real "unattached" shape.)
      hub.published.length = 0;
      const res = await upload(t.users.editor, PDF, {
        filename: 'loose.pdf',
        connectionId: connId,
        table,
      });
      expect(res.statusCode).toBe(201);
      expect(attachmentEvents()).toEqual([]);
    });

    it('says nothing when the write touched no file', async () => {
      // The common case by far: an ordinary column edit. A panel that reloaded
      // on every row update would be re-reading the file list all day.
      expect((await patchPdfUrl('https://files.example.test/inv-1042-v3.pdf')).statusCode).toBe(200);
      expect(hub.published.some((published) => published.type === 'record.attachments')).toBe(false);
      // …while the row's own fan-out still went out, so this is not a test of
      // a hub that published nothing at all.
      expect(hub.published.some((published) => published.type === 'record.update')).toBe(true);
    });
  });

  it('does not serve an EXPORT artifact — those keep their own route and rules', async () => {
    const artifact = await filesRepo(t.meta).create({
      filename: 'orders.csv',
      mime: 'text/csv',
      sizeBytes: 3,
      sha256: 'a'.repeat(64),
      kind: 'export',
      uploadedBy: t.users.editor.id,
    });
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/v1/files/${artifact.id}`,
      headers: asUser(t.users.editor),
    });
    // A deliberate refusal, not an oversight: `GET /exports/:id/download` has
    // its own expiry and ownership semantics.
    expect(res.statusCode).toBe(404);
  });
});
