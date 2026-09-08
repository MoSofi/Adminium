// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The lifecycle hook that keeps `adminium_files` honest about what a
 * customer's own columns say (37-files-and-storage.md §3.7, D12, 37-T13), and
 * the daily sweep that collects what nothing claims (D12, 37-T14).
 *
 * WHY THIS IS THE TEST THAT MATTERS MOST IN 37b. Without the hook, an upload
 * attached through a form stays `attached_at = NULL` and the sweep trashes it
 * twenty-four hours later — the file the user attached would vanish from a
 * record that still points at it, a day after everything looked fine. Nothing
 * in the route tests would catch that: the upload 201s, the value saves, the
 * grid renders. Only time reveals it.
 *
 * The block reader is exercised against REAL stored pages rather than a stub,
 * because "which columns hold files" is read out of page configs written by a
 * different part of the system, and a stub would agree with whatever shape
 * this code expected.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  connectionsRepo,
  createSqliteMetaDb,
  destinationsRepo,
  filesRepo,
  firstRun,
  newId,
  pagesRepo,
  settingsRepo,
  type MetaDb,
  type RecordRef,
} from '@adminium/meta';

import { createColumnBlockReader } from '../src/files/column-blocks.js';
import { createDestinationResolver } from '../src/files/destinations.js';
import { FILES_DIR } from '../src/files/drivers/local.js';
import { createFileReconciler, type FileReconciler } from '../src/files/reconcile.js';
import { createSpool } from '../src/files/spool.js';
import { createFileStore, type FileStore } from '../src/files/store.js';
import { TEST_STORAGE_CRYPTO } from './helpers/file-store.js';

const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64, 0x20)]);
const TABLE = 'public.invoices';
const ORIGIN = 'https://admin.example.com';

/** Set per test: `adminium_pages.connection_id` is a real FK. */
let CONN = '';

const entity = (recordId: string): RecordRef => ({
  connectionId: CONN,
  table: TABLE,
  pk: { invoice_id: recordId },
  label: recordId,
});

describe('file reconcile', () => {
  let meta: MetaDb;
  let dataDir: string;
  let storage: FileStore;
  let reconciler: FileReconciler;

  /**
   * A stored page whose `pdf_url` column carries a `file` block — in the shape
   * `adminium_pages.config` REALLY holds, which is the whole envelope with the
   * body nested under `config`.
   *
   * The first version of this helper wrote a flat `{ source, columns }`, which
   * matched the reader's assumption rather than the store. Both agreed, both
   * were wrong, and the suite passed while the feature did nothing on every
   * real page. Building the fixture the way generation does is the only version
   * of this test that can fail.
   */
  async function seedPage(over: Record<string, unknown> = {}): Promise<void> {
    await pagesRepo(meta).create({
      connectionId: CONN,
      slug: 'invoices',
      type: 'page-crud',
      title: 'Invoices',
      navOrder: 1,
      config: {
        v: 1,
        kind: 'page',
        template: 'page-crud',
        source: { connectionId: CONN, table: TABLE },
        config: {
          columns: [
            { name: 'invoice_id', label: 'Invoice' },
            { name: 'pdf_url', label: 'PDF', file: { ref: 'url', ...over } },
          ],
        },
      },
    });
  }

  /** Upload a file the way the route does, and hand back its `url` reference. */
  async function upload(filename = 'inv.pdf'): Promise<{ id: string; ref: string }> {
    const { Readable } = await import('node:stream');
    const { file } = await storage.putUpload({
      kind: 'upload',
      filename,
      source: Readable.from([PDF]),
      maxBytes: 1_000_000,
      allowedTypes: ['pdf'],
    });
    return { id: file.id, ref: `${ORIGIN}/api/v1/files/${file.id}/content` };
  }

  beforeEach(async () => {
    meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    // A real connection row: `adminium_pages.connection_id` is a foreign key,
    // so a fictional id makes every page insert fail with a constraint error
    // rather than with anything about files.
    CONN = (
      await connectionsRepo(meta, TEST_STORAGE_CRYPTO).create({
        name: 'source',
        engine: 'postgres',
        introspectDsn: 'postgres://ro@localhost/app',
      })
    ).id;
    dataDir = await mkdtemp(join(tmpdir(), 'adminium-reconcile-'));
    const destinations = createDestinationResolver({
      repo: destinationsRepo(meta, TEST_STORAGE_CRYPTO),
      localRoot: resolve(dataDir, FILES_DIR),
    });
    storage = createFileStore({
      spool: createSpool({ dataDir }),
      destinations,
      files: filesRepo(meta),
    });
    reconciler = createFileReconciler({
      meta,
      blocks: createColumnBlockReader(meta),
      destinations,
    });
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it('attaches a file whose reference APPEARED in a configured column', async () => {
    await seedPage();
    const { id, ref } = await upload();
    expect((await filesRepo(meta).findById(id))?.attachedAt).toBeNull();

    const result = await reconciler.reconcile({
      connectionId: CONN,
      table: TABLE,
      entity: entity('1042'),
      before: null,
      after: { invoice_id: '1042', pdf_url: ref },
    });

    expect(result.attached).toEqual([id]);
    const after = await filesRepo(meta).findById(id);
    expect(after?.attachedAt).not.toBeNull();
    expect(after?.entityId).toBe('1042');
    // The full ref survives beside the lookup keys — the pk map is what a UI
    // renders, the columns are how the row is found.
    expect(after?.entity?.pk).toEqual({ invoice_id: '1042' });
  });

  it('trashes the file a REPLACED reference used to name', async () => {
    await seedPage();
    const first = await upload('old.pdf');
    const second = await upload('new.pdf');
    await reconciler.reconcile({
      connectionId: CONN,
      table: TABLE,
      entity: entity('1042'),
      before: null,
      after: { pdf_url: first.ref },
    });

    const result = await reconciler.reconcile({
      connectionId: CONN,
      table: TABLE,
      entity: entity('1042'),
      before: { pdf_url: first.ref },
      after: { pdf_url: second.ref },
    });

    expect(result.attached).toEqual([second.id]);
    expect(result.trashed).toEqual([first.id]);
    // Trash, never delete: the bytes belong to the retention sweep (D12).
    expect((await filesRepo(meta).findById(first.id))?.deletedAt).not.toBeNull();
    expect((await filesRepo(meta).findById(second.id))?.attachedAt).not.toBeNull();
  });

  it('trashes on a CLEARED reference', async () => {
    await seedPage();
    const { id, ref } = await upload();
    await reconciler.reconcile({ connectionId: CONN, table: TABLE, entity: entity('1042'), before: null, after: { pdf_url: ref } });

    const result = await reconciler.reconcile({
      connectionId: CONN,
      table: TABLE,
      entity: entity('1042'),
      before: { pdf_url: ref },
      after: { pdf_url: null },
    });
    expect(result.trashed).toEqual([id]);
  });

  it('does nothing at all to a value that is not ours', async () => {
    await seedPage();
    const foreign = 'https://someone-elses-cdn.example.com/legacy/invoice.pdf';
    const result = await reconciler.reconcile({
      connectionId: CONN,
      table: TABLE,
      entity: entity('1042'),
      before: { pdf_url: 'https://someone-elses-cdn.example.com/older.pdf' },
      after: { pdf_url: foreign },
    });
    // A column may already hold links a foreign app wrote. This code never
    // attaches one and, crucially, never TRASHES one.
    expect(result).toEqual({ attached: [], trashed: [] });
  });

  it('is a no-op on a table with no file columns configured', async () => {
    const { ref } = await upload();
    const result = await reconciler.reconcile({
      connectionId: CONN,
      table: TABLE,
      entity: entity('1042'),
      before: null,
      after: { pdf_url: ref },
    });
    // No page, no block, no behaviour — which is why every suite that predates
    // 37 is unchanged.
    expect(result).toEqual({ attached: [], trashed: [] });
  });

  it('accepts an id-shaped reference as readily as a url one', async () => {
    await seedPage({ ref: 'id' });
    const { id } = await upload();
    const result = await reconciler.reconcile({
      connectionId: CONN,
      table: TABLE,
      entity: entity('1042'),
      before: null,
      after: { pdf_url: id },
    });
    // Reading is generous even though writing is not: a column can carry a mix
    // from before it was configured, or from a foreign app.
    expect(result.attached).toEqual([id]);
  });

  it('does not re-stamp attached_at when the value did not change', async () => {
    await seedPage();
    const { id, ref } = await upload();
    await reconciler.reconcile({ connectionId: CONN, table: TABLE, entity: entity('1042'), before: null, after: { pdf_url: ref } });
    const first = (await filesRepo(meta).findById(id))?.attachedAt;

    const result = await reconciler.reconcile({
      connectionId: CONN,
      table: TABLE,
      entity: entity('1042'),
      before: { pdf_url: ref, customer: 'a' },
      after: { pdf_url: ref, customer: 'b' },
    });
    expect(result).toEqual({ attached: [], trashed: [] });
    expect((await filesRepo(meta).findById(id))?.attachedAt).toBe(first);
  });

  describe('delete and undo', () => {
    it('trashes both the sidecar and the column-bound files, and restores them', async () => {
      await seedPage();
      const columnBound = await upload('column.pdf');
      await reconciler.reconcile({
        connectionId: CONN,
        table: TABLE,
        entity: entity('1042'),
        before: null,
        after: { pdf_url: columnBound.ref },
      });

      // A sidecar attachment: no column at all, attached on upload.
      const { Readable } = await import('node:stream');
      const { file: sidecar } = await storage.putUpload({
        kind: 'upload',
        filename: 'sidecar.pdf',
        source: Readable.from([PDF]),
        maxBytes: 1_000_000,
        allowedTypes: ['pdf'],
        entity: entity('1042'),
      });

      const trashed = await reconciler.trashForRecord({
        connectionId: CONN,
        table: TABLE,
        entity: entity('1042'),
        row: { invoice_id: '1042', pdf_url: columnBound.ref },
      });
      expect(new Set(trashed)).toEqual(new Set([columnBound.id, sidecar.id]));
      for (const id of trashed) expect((await filesRepo(meta).findById(id))?.deletedAt).not.toBeNull();

      await reconciler.restoreAll(trashed);
      for (const id of trashed) expect((await filesRepo(meta).findById(id))?.deletedAt).toBeNull();
    });

    it('leaves another record’s files alone', async () => {
      await seedPage();
      const mine = await upload('mine.pdf');
      const theirs = await upload('theirs.pdf');
      await reconciler.reconcile({ connectionId: CONN, table: TABLE, entity: entity('1042'), before: null, after: { pdf_url: mine.ref } });
      await reconciler.reconcile({ connectionId: CONN, table: TABLE, entity: entity('9'), before: null, after: { pdf_url: theirs.ref } });

      await reconciler.trashForRecord({
        connectionId: CONN,
        table: TABLE,
        entity: entity('1042'),
        row: { pdf_url: mine.ref },
      });
      expect((await filesRepo(meta).findById(mine.id))?.deletedAt).not.toBeNull();
      expect((await filesRepo(meta).findById(theirs.id))?.deletedAt).toBeNull();
    });
  });

  /**
   * A column that holds MANY files (38-files-library-and-attachments.md D1/D5).
   *
   * The diff is a SET difference, and the case that makes it necessary is the
   * one a pairwise compare gets wrong: a file that stays but moves position.
   * With one value per column `before !== after` said everything; with a list it
   * says nothing about which files left.
   */
  describe('a multiple column', () => {
    const listOf = (...refs: string[]): string => JSON.stringify(refs);

    it('attaches every id in the list, not just the first', async () => {
      await seedPage({ ref: 'id', multiple: true });
      const a = await upload('a.pdf');
      const b = await upload('b.pdf');

      const result = await reconciler.reconcile({
        connectionId: CONN,
        table: TABLE,
        entity: entity('1042'),
        before: null,
        after: { invoice_id: '1042', pdf_url: listOf(a.id, b.id) },
      });

      expect(result.attached.sort()).toEqual([a.id, b.id].sort());
      for (const { id } of [a, b]) {
        const stored = await filesRepo(meta).findById(id);
        expect(stored?.attachedAt).not.toBeNull();
        expect(stored?.entityId).toBe('1042');
      }
    });

    it('trashes only what LEFT the list, and never a file that merely moved', async () => {
      await seedPage({ ref: 'id', multiple: true });
      const a = await upload('a.pdf');
      const b = await upload('b.pdf');
      const c = await upload('c.pdf');
      await reconciler.reconcile({
        connectionId: CONN,
        table: TABLE,
        entity: entity('1042'),
        before: null,
        after: { invoice_id: '1042', pdf_url: listOf(a.id, b.id) },
      });

      // `a` moves to the end and `b` is replaced by `c`. A pairwise compare
      // would see position 0 change from `a` to `c` and trash `a`.
      const result = await reconciler.reconcile({
        connectionId: CONN,
        table: TABLE,
        entity: entity('1042'),
        before: { invoice_id: '1042', pdf_url: listOf(a.id, b.id) },
        after: { invoice_id: '1042', pdf_url: listOf(c.id, a.id) },
      });

      expect(result.trashed).toEqual([b.id]);
      expect((await filesRepo(meta).findById(a.id))?.deletedAt).toBeNull();
      expect((await filesRepo(meta).findById(c.id))?.deletedAt).toBeNull();
      expect((await filesRepo(meta).findById(b.id))?.deletedAt).not.toBeNull();
    });

    it('trashes everything when the list is cleared', async () => {
      await seedPage({ ref: 'id', multiple: true });
      const a = await upload('a.pdf');
      const b = await upload('b.pdf');
      await reconciler.reconcile({
        connectionId: CONN,
        table: TABLE,
        entity: entity('1042'),
        before: null,
        after: { invoice_id: '1042', pdf_url: listOf(a.id, b.id) },
      });

      const result = await reconciler.reconcile({
        connectionId: CONN,
        table: TABLE,
        entity: entity('1042'),
        before: { invoice_id: '1042', pdf_url: listOf(a.id, b.id) },
        // `null`, not `'[]'` — what `formatRefList` writes for an empty list.
        after: { invoice_id: '1042', pdf_url: null },
      });

      expect(result.trashed.sort()).toEqual([a.id, b.id].sort());
    });

    it('leaves a foreign link in the list alone', async () => {
      await seedPage({ ref: 'id', multiple: true });
      const a = await upload('a.pdf');
      const result = await reconciler.reconcile({
        connectionId: CONN,
        table: TABLE,
        entity: entity('1042'),
        before: { invoice_id: '1042', pdf_url: listOf(a.id, 'https://example.com/theirs.pdf') },
        after: { invoice_id: '1042', pdf_url: listOf('https://example.com/theirs.pdf') },
      });
      // `a` left the list and is trashed; the foreign link was never ours to
      // touch in either direction.
      expect(result.trashed).toEqual([a.id]);
      expect(result.attached).toEqual([]);
    });

    it('reads a single legacy value as a list of one', async () => {
      // A column made `multiple` after it already held one plain reference. No
      // migration runs, so the old value has to keep working.
      await seedPage({ ref: 'id', multiple: true });
      const a = await upload('a.pdf');
      const result = await reconciler.reconcile({
        connectionId: CONN,
        table: TABLE,
        entity: entity('1042'),
        before: null,
        after: { invoice_id: '1042', pdf_url: a.id },
      });
      expect(result.attached).toEqual([a.id]);
    });
  });

  /**
   * The write-time cap (38 D5) — the ONLY place a per-record count is knowable.
   *
   * A column upload for a new record names no record, so the upload route cannot
   * ask "how many will this record have"; the write that sets the column is the
   * first moment anything can. And it has to be PRE-commit: the reconcile hook
   * runs after the row is written and may never throw.
   */
  describe('validateWrite', () => {
    it('passes a list within the cap', async () => {
      await seedPage({ ref: 'id', multiple: true, maxCount: 2 });
      const problem = await reconciler.validateWrite({
        connectionId: CONN,
        table: TABLE,
        values: { pdf_url: JSON.stringify(['file_01M1Q2R3S4T5V6W7X8Y9Z0ABCD']) },
      });
      expect(problem).toBeNull();
    });

    it('refuses a list past the cap, naming the column and both numbers', async () => {
      await seedPage({ ref: 'id', multiple: true, maxCount: 2 });
      const problem = await reconciler.validateWrite({
        connectionId: CONN,
        table: TABLE,
        values: { pdf_url: JSON.stringify(['a', 'b', 'c']) },
      });
      expect(problem).toEqual({ column: 'pdf_url', reason: 'too-many', maxCount: 2, count: 3 });
    });

    it('refuses a non-array on a multiple column', async () => {
      await seedPage({ ref: 'id', multiple: true });
      const problem = await reconciler.validateWrite({
        connectionId: CONN,
        table: TABLE,
        values: { pdf_url: 'file_01M1Q2R3S4T5V6W7X8Y9Z0ABCD' },
      });
      expect(problem).toEqual({ column: 'pdf_url', reason: 'not-a-list' });
    });

    it('says nothing about a single-value column, whatever it holds', async () => {
      // The cap and the array shape are facts about `multiple` columns only; a
      // plain file column keeps accepting exactly what it always did.
      await seedPage({ ref: 'url' });
      expect(
        await reconciler.validateWrite({
          connectionId: CONN,
          table: TABLE,
          values: { pdf_url: 'https://example.com/theirs.pdf' },
        }),
      ).toBeNull();
    });

    it('says nothing about a column this write does not touch, or one being cleared', async () => {
      await seedPage({ ref: 'id', multiple: true, maxCount: 1 });
      expect(
        await reconciler.validateWrite({ connectionId: CONN, table: TABLE, values: { customer: 'x' } }),
      ).toBeNull();
      expect(
        await reconciler.validateWrite({ connectionId: CONN, table: TABLE, values: { pdf_url: null } }),
      ).toBeNull();
    });
  });

});

describe('the retention sweep’s two halves (D12)', () => {
  let meta: MetaDb;

  beforeEach(async () => {
    meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
  });

  it('collects unattached uploads past files.unattachedHours and nothing else', async () => {
    const files = filesRepo(meta);
    const at = 1_750_000_000_000;
    const hours = await settingsRepo(meta).get('files.unattachedHours');
    expect(hours).toBe(24);

    const stale = await files.create(
      { filename: 'abandoned.pdf', mime: 'application/pdf', sizeBytes: 1, sha256: 'a'.repeat(64), kind: 'upload' },
      at - 25 * 3_600_000,
    );
    const claimed = await files.create(
      { filename: 'used.pdf', mime: 'application/pdf', sizeBytes: 1, sha256: 'a'.repeat(64), kind: 'upload' },
      at - 25 * 3_600_000,
    );
    await files.attach(claimed.id, entity('1042'), at);
    const fresh = await files.create(
      { filename: 'fresh.pdf', mime: 'application/pdf', sizeBytes: 1, sha256: 'a'.repeat(64), kind: 'upload' },
      at - 3_600_000,
    );
    // An export is attached to nothing BY DESIGN and belongs to the exports
    // sweep and its own retention setting.
    const artifact = await files.create(
      { filename: 'orders.csv', mime: 'text/csv', sizeBytes: 1, sha256: 'a'.repeat(64), kind: 'export' },
      at - 100 * 3_600_000,
    );

    const worklist = await files.listUnattachedBefore(at - hours * 3_600_000);
    expect(worklist.map((f) => f.id)).toEqual([stale.id]);
    expect(worklist.map((f) => f.id)).not.toContain(claimed.id);
    expect(worklist.map((f) => f.id)).not.toContain(fresh.id);
    expect(worklist.map((f) => f.id)).not.toContain(artifact.id);
  });

  it('purges trashed uploads past retention.filesTrashDays, and only uploads', async () => {
    const files = filesRepo(meta);
    const at = 1_750_000_000_000;
    const days = await settingsRepo(meta).get('retention.filesTrashDays');
    expect(days).toBe(30);

    const upload = await files.create(
      { id: newId('file'), filename: 'old.pdf', mime: 'application/pdf', sizeBytes: 1, sha256: 'a'.repeat(64), kind: 'upload' },
      at,
    );
    const artifact = await files.create(
      { id: newId('file'), filename: 'old.csv', mime: 'text/csv', sizeBytes: 1, sha256: 'a'.repeat(64), kind: 'export' },
      at,
    );
    await files.markDeleted(upload.id, at - 31 * 86_400_000);
    await files.markDeleted(artifact.id, at - 31 * 86_400_000);

    const due = await files.listDeletedBefore(at - days * 86_400_000);
    // The sweep filters to `upload` — the export's bytes are the exports
    // sweep's business under a different setting.
    expect(due.map((f) => f.id)).toContain(upload.id);
    expect(due.filter((f) => f.kind === 'upload').map((f) => f.id)).toEqual([upload.id]);
  });
});

describe('the sidecar block reader (37 §3.5, 37-T22)', () => {
  let meta: MetaDb;
  let conn: string;

  beforeEach(async () => {
    meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    conn = (
      await connectionsRepo(meta, TEST_STORAGE_CRYPTO).create({
        name: 'source',
        engine: 'postgres',
        introspectDsn: 'postgres://ro@localhost/app',
      })
    ).id;
  });

  /** Same real-envelope shape as `seedPage` above — see its docblock. */
  async function page(body: Record<string, unknown>, slug = 'invoices'): Promise<void> {
    await pagesRepo(meta).create({
      connectionId: conn,
      slug,
      type: 'page-crud',
      title: 'Invoices',
      navOrder: 1,
      config: {
        v: 1,
        kind: 'page',
        template: 'page-crud',
        source: { connectionId: conn, table: TABLE },
        config: { columns: [], ...body },
      },
    });
  }

  it('reads an enabled block', async () => {
    await page({ attachments: { enabled: true, accept: ['pdf'], maxBytes: 4096, maxCount: 3 } });
    const blocks = createColumnBlockReader(meta);
    expect(await blocks.attachmentsFor(conn, TABLE)).toEqual({
      enabled: true,
      accept: ['pdf'],
      maxBytes: 4096,
      maxCount: 3,
    });
  });

  it('treats `enabled: false` as no block at all', async () => {
    // That is how an operator turns the panel off without losing the rest of
    // the configuration — it must not read as an enabled, empty block.
    await page({ attachments: { enabled: false, accept: ['pdf'] } });
    expect(await createColumnBlockReader(meta).attachmentsFor(conn, TABLE)).toBeNull();
  });

  it('answers null for a table no page configures', async () => {
    await page({});
    expect(await createColumnBlockReader(meta).attachmentsFor(conn, TABLE)).toBeNull();
    expect(await createColumnBlockReader(meta).attachmentsFor(conn, 'public.other')).toBeNull();
  });

  it('ignores a malformed block rather than trusting it into the upload path', async () => {
    await page({ attachments: { enabled: true, maxBytes: 'lots' } });
    expect(await createColumnBlockReader(meta).attachmentsFor(conn, TABLE)).toBeNull();
  });
});
