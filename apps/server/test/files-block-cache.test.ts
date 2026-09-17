// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The block cache and the page write that has to drop it.
 *
 * ─── The defect this file exists for, live since 37c ───────────────────────
 *
 * `createColumnBlockReader` caches a table's `file` blocks for 30 seconds and
 * has always exposed `clear()`. Nothing outside its own tests ever called it,
 * and `pagesRoutes` was registered as `pagesRoutes({ meta })` — with no way to
 * be told a page had changed.
 *
 * So there was a half-minute window after every page save in which the upload
 * route still saw the OLD blocks. Turn a column into a file column and upload
 * inside it: the route found no block, `limits` was null, and the reference
 * shape fell through to `block?.ref ?? DEFAULT_REF_SHAPE` — a URL, whatever
 * the operator had chosen. Every shape parses on read, so nothing threw and
 * nothing logged; the only evidence was a column whose first values were a
 * different kind of string from the rest of them.
 *
 * 38 makes that window ordinary rather than unlucky: the Attachments card
 * creates a column, saves the page, and the operator uploads seconds later.
 *
 * ─── Why this is a ROUTE test ──────────────────────────────────────────────
 *
 * The reader's own unit tests pass with `clear()` uncalled — they call it
 * themselves. The claim here is that two route groups agree, which is exactly
 * the seam 37's review found broken twice (a missing `/api/v1` prefix, and a
 * page config read one level too high). So the page is saved through
 * `PATCH /pages/:id/config` and the file uploaded through `POST /files`, with
 * the REAL reader between them and no fake clock: the TTL is 30 seconds and
 * these tests take milliseconds, so an uncleared cache is certainly stale.
 *
 * The harness is local rather than `buildDataTestApp` because none of that is
 * needed — the files routes never query the customer's database, so there is
 * no adapter, no registry and no introspection here. It follows
 * `pages-lifecycle.test.ts`, which sets `session` as well as `user` because
 * `requireAuth` demands both.
 */
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  connectionsRepo,
  createSqliteMetaDb,
  firstRun,
  pagesRepo,
  permissionsRepo,
  rolesRepo,
  usersRepo,
  type MetaDb,
  type User,
} from '@adminium/meta';
import type { FastifyInstance } from 'fastify';

import { buildServer } from '../src/app.js';
import { createColumnBlockReader } from '../src/files/column-blocks.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { filesRoutes } from '../src/routes/files/index.js';
import { pagesRoutes } from '../src/routes/pages/index.js';
import { createTestFileStore, TEST_STORAGE_CRYPTO } from './helpers/file-store.js';
import { makeEnv } from './helpers.js';

const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(400, 0x20)]);
const TABLE = 'main.invoices';

const asUser = (user: User): Record<string, string> => ({ 'x-test-user-id': user.id });

interface Harness {
  app: FastifyInstance;
  meta: MetaDb;
  admin: User;
  connId: string;
  pageId: string;
}

describe('a page save is visible to the very next upload', () => {
  let t: Harness;
  let dataDir: string;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'adminium-block-cache-'));
    const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);

    const roles = rolesRepo(meta);
    const users = usersRepo(meta);
    const superAdmin = await roles.findBySlug('super-admin');
    if (superAdmin === null) throw new Error('missing built-in role super-admin');
    const admin = await users.create({
      email: 'ava@adminium.test',
      name: 'ava',
      passwordHash: 'h',
      status: 'active',
    });
    await roles.assignToUser(admin.id, superAdmin.id);

    // A real connection row: `adminium_pages.connection_id` is a foreign key.
    const connection = await connectionsRepo(meta, TEST_STORAGE_CRYPTO).create({
      name: 'source',
      engine: 'postgres',
      introspectDsn: 'postgres://ro@localhost/app',
    });

    // A page whose `pdf_url` carries NO file block — the state before anyone
    // configures one, and the state whose staleness is the bug.
    const page = await pagesRepo(meta).create({
      connectionId: connection.id,
      slug: 'invoices',
      type: 'page-crud',
      title: 'Invoices',
      // A COMPLETE envelope, in the shape generation emits: the config PATCH
      // route validates the assembled envelope, so a fixture missing `id`,
      // `title` or `nav` is refused for reasons that have nothing to do with
      // what is under test.
      config: {
        v: 1,
        kind: 'page',
        id: 'page_invoices',
        template: 'page-crud',
        title: { key: 'nav.invoices', fallback: 'Invoices' },
        source: { connectionId: connection.id, table: TABLE },
        nav: { group: 'workspace', icon: 'file-text', order: 1 },
        access: { minRole: 'viewer', permissions: [] },
        config: { columns: [{ name: 'invoice_id' }, { name: 'pdf_url' }] },
      },
    });

    const app = await buildServer({ env: makeEnv(), logger: false, metaDb: meta });
    app.addHook('onRequest', async (request) => {
      const id = request.headers['x-test-user-id'];
      if (typeof id === 'string') {
        const user = await users.findById(id);
        if (user !== null) {
          const req = request as unknown as { user: unknown; session: unknown };
          req.user = user;
          req.session = { id: 'test-session', userId: user.id };
        }
      }
    });
    await app.register(rbacPlugin, { meta });
    await app.register(
      async (api) => {
        // ONE reader instance shared by both route groups — the production
        // wiring. Two instances would make this test pass for free.
        const columnBlocks = createColumnBlockReader(meta);
        await api.register(pagesRoutes({ meta, onPageChanged: () => { columnBlocks.clear(); } }));
        await api.register(
          filesRoutes({
            meta,
            storage: createTestFileStore({ dataDir, meta }),
            storageCrypto: TEST_STORAGE_CRYPTO,
            columnFileBlock: (input) => columnBlocks.forColumn(input),
            pageAttachments: (input) => columnBlocks.attachmentsFor(input.connectionId, input.table),
          }),
        );
      },
      { prefix: '/api/v1' },
    );
    await app.ready();

    t = { app, meta, admin, connId: connection.id, pageId: page.id };
  });

  afterEach(async () => {
    await t.app.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  /**
   * Save the page body, optionally configuring `pdf_url` to store `ref`.
   *
   * The Studio's own save path (`PATCH /pages/:id/config`), which replaces the
   * BODY: `adminium_pages.config` holds the whole envelope, and the columns
   * live one level down inside it.
   */
  async function savePage(ref?: 'url' | 'id' | 'key'): Promise<void> {
    const pdfUrl = ref === undefined ? { name: 'pdf_url' } : { name: 'pdf_url', file: { ref } };
    const res = await t.app.inject({
      method: 'PATCH',
      url: `/api/v1/pages/${t.pageId}/config`,
      headers: asUser(t.admin),
      payload: { config: { columns: [{ name: 'invoice_id' }, pdfUrl] } },
    });
    expect(res.statusCode).toBe(200);
  }

  function upload() {
    const query = new URLSearchParams({
      filename: 'inv.pdf',
      connectionId: t.connId,
      table: TABLE,
      column: 'pdf_url',
    });
    return t.app.inject({
      method: 'POST',
      url: `/api/v1/files?${query.toString()}`,
      headers: { ...asUser(t.admin), 'content-type': 'application/pdf' },
      payload: PDF,
    });
  }

  it('warms the cache with no block, then honours a block saved a moment later', async () => {
    // 1. Warm the cache while `pdf_url` is a plain column — what an ordinary
    //    page load does before anyone opens the Studio, and what made the
    //    window reachable in practice.
    const before = await upload();
    expect(before.statusCode).toBe(201);
    expect(before.json().ref).toMatch(/^https?:\/\//);

    // 2. Configure the column to store Adminium's file id instead.
    await savePage('id');

    // 3. Upload again IMMEDIATELY. With the cache uncleared the route still
    //    sees no block and mints a URL — silently the wrong kind of value for
    //    the column the operator has just configured.
    const after = await upload();
    expect(after.statusCode).toBe(201);
    const body = after.json();
    expect(body.ref).toBe(body.data.id);
    expect(body.ref).not.toMatch(/^https?:\/\//);
  });

  it('drops a block that a page save REMOVED, just as promptly', async () => {
    await savePage('id');
    expect((await upload()).json().ref).not.toMatch(/^https?:\/\//);

    // Turning the switch off has to be as immediate as turning it on, or the
    // column keeps receiving ids after the operator stopped asking for them.
    await savePage();
    expect((await upload()).json().ref).toMatch(/^https?:\/\//);
  });
});
