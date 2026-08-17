// SPDX-License-Identifier: AGPL-3.0-only
/**
 * filesRepo / exportsRepo / importsRepo (07-meta-store.md §3.25–§3.27) —
 * M7-T07 data-io wave. Same dialect-parameterized harness as the sibling
 * repo suites.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  connectionsRepo,
  exportsRepo,
  filesRepo,
  firstRun,
  importsRepo,
  usersRepo,
  type DsnCrypto,
} from '../src/index.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

const testCrypto: DsnCrypto = {
  encrypt: (plaintext) => `enc:test:${Buffer.from(plaintext, 'utf8').toString('base64')}`,
  decrypt: (token) => Buffer.from(token.slice('enc:test:'.length), 'base64').toString('utf8'),
};

const SHA = 'a'.repeat(64);

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`data-io repos [${dialect.name}]`, () => {
    let t: TestDb;
    let userId: string;
    let connectionId: string;

    beforeEach(async () => {
      t = await dialect.make();
      await firstRun(t.meta);
      userId = (await usersRepo(t.meta).create({ email: 'ava@adminium.test', name: 'Ava' })).id;
      connectionId = (
        await connectionsRepo(t.meta, testCrypto).create({
          name: 'northwind',
          engine: 'postgres',
          introspectDsn: 'postgres://ro@localhost/northwind',
        })
      ).id;
    });
    afterEach(async () => {
      await t.destroy();
    });

    it('files: creates, round-trips, soft-deletes, purges', async () => {
      const files = filesRepo(t.meta);
      const file = await files.create({
        filename: 'orders.csv',
        mime: 'text/csv',
        sizeBytes: 1234,
        sha256: SHA,
        kind: 'export',
        uploadedBy: userId,
      });
      expect(file.storage).toBe('local');
      expect(file.storageKey).toBe(file.id);
      const fetched = await files.findById(file.id);
      expect(fetched?.filename).toBe('orders.csv');
      expect(fetched?.sizeBytes).toBe(1234);
      expect(fetched?.deletedAt).toBeNull();

      expect(await files.markDeleted(file.id, 1000)).toBe(true);
      expect(await files.markDeleted(file.id, 1000)).toBe(false); // idempotent guard
      const deleted = await files.listDeletedBefore(2000);
      expect(deleted.map((f) => f.id)).toContain(file.id);
      expect(await files.purge(file.id)).toBe(true);
      expect(await files.findById(file.id)).toBeNull();
    });

    it('files: honours a pre-minted id from the storage layer', async () => {
      const files = filesRepo(t.meta);
      const { newId } = await import('../src/ids.js');
      const id = newId('file');
      const file = await files.create({
        id,
        filename: 'up.csv',
        mime: 'text/csv',
        sizeBytes: 1,
        sha256: SHA,
        kind: 'import',
      });
      expect(file.id).toBe(id);
      expect(file.storageKey).toBe(id);
    });

    it('exports: lifecycle processing → ready and retention expiry', async () => {
      const exports = exportsRepo(t.meta);
      const files = filesRepo(t.meta);
      const row = await exports.create({
        connectionId,
        requestedBy: userId,
        source: { kind: 'table', table: 'public.orders' },
        format: 'csv',
      });
      expect(row.status).toBe('processing');
      expect(row.source.table).toBe('public.orders');

      const artifact = await files.create({
        filename: 'orders.csv',
        mime: 'text/csv',
        sizeBytes: 10,
        sha256: SHA,
        kind: 'export',
      });
      expect(
        await exports.markReady(row.id, { fileId: artifact.id, rowCount: 42, expiresAt: 5000 }, 4000),
      ).toBe(true);
      const ready = await exports.findById(row.id);
      expect(ready?.status).toBe('ready');
      expect(ready?.rowCount).toBe(42);
      expect(ready?.fileId).toBe(artifact.id);

      // Terminal rows refuse further transitions.
      expect(await exports.markFailed(row.id, 'nope')).toBe(false);

      expect(await exports.expireDue(6000)).toBe(1);
      expect((await exports.findById(row.id))?.status).toBe('expired');

      // Byte-GC worklist: the expired row surfaces its live artifact once,
      // then drops out after the file row is soft-deleted (self-healing scan).
      const worklist = await exports.listExpiredArtifacts();
      expect(worklist).toEqual([
        { id: row.id, fileId: artifact.id, storageKey: artifact.storageKey },
      ]);
      expect(await files.markDeleted(artifact.id, 7000)).toBe(true);
      expect(await exports.listExpiredArtifacts()).toEqual([]);
    });

    it('exports: list scopes to requestedBy, newest first', async () => {
      const exports = exportsRepo(t.meta);
      const other = (await usersRepo(t.meta).create({ email: 'noah@adminium.test', name: 'Noah' })).id;
      await exports.create(
        { connectionId, requestedBy: userId, source: { kind: 'table', table: 'a' }, format: 'csv' },
        1000,
      );
      await exports.create(
        { connectionId, requestedBy: userId, source: { kind: 'table', table: 'b' }, format: 'json' },
        2000,
      );
      await exports.create(
        { connectionId, requestedBy: other, source: { kind: 'table', table: 'c' }, format: 'csv' },
        3000,
      );
      const mine = await exports.list({ requestedBy: userId });
      expect(mine.map((e) => e.source.table)).toEqual(['b', 'a']);
      expect((await exports.list()).length).toBe(3);
    });

    it('imports: lifecycle validating → ready → running → succeeded with stats', async () => {
      const imports = importsRepo(t.meta);
      const files = filesRepo(t.meta);
      const upload = await files.create({
        filename: 'customers.csv',
        mime: 'text/csv',
        sizeBytes: 100,
        sha256: SHA,
        kind: 'import',
        uploadedBy: userId,
      });
      const row = await imports.create({
        connectionId,
        tableName: 'public.customers',
        requestedBy: userId,
        fileId: upload.id,
        mapping: { columns: [{ from: 'Name', to: 'company_name' }, { from: 'Internal', to: null }] },
        options: { mode: 'insert', skipInvalid: true },
      });
      expect(row.status).toBe('validating');
      expect(row.mapping.columns).toHaveLength(2);

      // running requires ready first — refuse the shortcut.
      expect(await imports.markRunning(row.id)).toBe(false);
      expect(await imports.markReady(row.id, { total: 10 })).toBe(true);
      expect(await imports.markRunning(row.id)).toBe(true);
      expect(await imports.markRunning(row.id)).toBe(false); // double-claim refused

      expect(
        await imports.markFinished(row.id, {
          status: 'succeeded',
          stats: { total: 10, inserted: 8, updated: 1, skipped: 1 },
        }),
      ).toBe(true);
      const done = await imports.findById(row.id);
      expect(done?.status).toBe('succeeded');
      // The 09 §11.1 invariant: total = inserted + updated + skipped.
      expect(done?.stats?.total).toBe(
        (done?.stats?.inserted ?? 0) + (done?.stats?.updated ?? 0) + (done?.stats?.skipped ?? 0),
      );
      expect(done?.finishedAt).not.toBeNull();
    });

    it('imports: invalid mapping payloads never reach the database', async () => {
      const imports = importsRepo(t.meta);
      await expect(
        imports.create({
          connectionId,
          tableName: 'public.customers',
          requestedBy: userId,
          fileId: 'file_00000000000000000000000000',
          mapping: { columns: [{ from: 'x' }] } as never, // missing `to`
          options: {},
        }),
      ).rejects.toThrow();
    });
  });
}
