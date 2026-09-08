// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0024 (files & storage): `adminium_storage_destinations` lands with its
 * one-default invariant, and `adminium_files` gains the destination pointer
 * plus the record linkage the `entity` column was declared for in 0003 and
 * nothing ever wrote (37-files-and-storage.md §3.2, 37-T02).
 *
 * Runs the real migration list split at 0023/0024 on every available dialect,
 * because the FK on the ALTER is spelled differently per engine — inline
 * REFERENCES on SQLite, a named table-level constraint elsewhere — and SQLite
 * alone would prove neither half.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ALL_MIGRATIONS,
  applyMigrations,
  DestinationInUseError,
  destinationsRepo,
  filesRepo,
  newId,
  type RecordRef,
} from '../src/index.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

const T0 = 1_750_000_000_000;
const SHA = 'a'.repeat(64);
const PRE_0024 = ALL_MIGRATIONS.filter((m) => m.name < '0024_file_destinations');

/** Round-trips through the same closures the server injects, minus the crypto. */
const crypto = { encrypt: (v: string) => `enc:${v}`, decrypt: (v: string) => v.slice(4) };

const s3Config = {
  endpoint: 'http://127.0.0.1:9000',
  region: 'auto',
  bucket: 'adminium-test',
  forcePathStyle: true,
};

const ref = (over: Partial<RecordRef> = {}): RecordRef => ({
  connectionId: 'conn_1',
  table: 'public.invoices',
  pk: { id: 1042 },
  label: '1042',
  ...over,
});

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`0024_file_destinations [${dialect.name}]`, () => {
    let t: TestDb;

    beforeEach(async () => {
      t = await dialect.make();
    });
    afterEach(async () => {
      await t.destroy();
    });

    it('leaves every pre-wave file row on this server’s disk (D3: no backfill)', async () => {
      // Ends exactly where 0024 begins — not "0024 is last", which every later
      // wave would invalidate.
      expect(PRE_0024.at(-1)?.name).toBe('0023_schema_authoring');
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: PRE_0024 });

      await t.meta.db
        .insertInto('adminium_files')
        .values({
          id: 'file_PRE0024',
          storage: 'local',
          storageKey: 'file_PRE0024',
          filename: 'orders.csv',
          mime: 'text/csv',
          sizeBytes: 12,
          sha256: SHA,
          kind: 'export',
          entity: null,
          uploadedBy: null,
          createdAt: T0,
          deletedAt: null,
        } as never)
        .execute();

      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });

      const row = await filesRepo(t.meta).findById('file_PRE0024');
      // NULL destination IS this server's disk; the migration backfills nothing
      // and the key grammar is untouched.
      expect(row?.destinationId).toBeNull();
      expect(row?.storageKey).toBe('file_PRE0024');
      expect(row?.attachedAt).toBeNull();
      expect(row?.entityConnectionId).toBeNull();
    });

    describe('after the wave', () => {
      beforeEach(async () => {
        await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });
      });

      it('stores a destination without ever handing the secret back', async () => {
        const repo = destinationsRepo(t.meta, crypto);
        const dest = await repo.create(
          { name: 'Spaces', driver: 's3', config: s3Config, secret: { accessKeyId: 'AKIAEXAMPLE', secretAccessKey: 'super-secret-key' } },
          T0,
        );

        expect(dest.hasSecret).toBe(true);
        // Not a substring check on the ciphertext — a ULID is Crockford base32
        // and a short uppercase probe collides with ids by chance.
        expect(JSON.stringify(dest)).not.toContain('super-secret-key');
        expect(dest.status).toBe('untested');
        expect(dest.isDefault).toBe(false);
        expect(dest.config).toEqual(s3Config);

        // The one door — and it hands back the PLAINTEXT, which is why it is
        // separate from every read path that renders a destination.
        expect(await repo.getSecret(dest.id)).toBe('{"accessKeyId":"AKIAEXAMPLE","secretAccessKey":"super-secret-key"}');
      });

      it('refuses a config the driver does not define', async () => {
        const repo = destinationsRepo(t.meta, crypto);
        // A webdav row needs a url; an s3 config is not one.
        await expect(repo.create({ name: 'NAS', driver: 'webdav', config: s3Config })).rejects.toThrow();
      });

      it('keeps exactly one default across concurrent setDefault calls', async () => {
        const repo = destinationsRepo(t.meta, crypto);
        const a = await repo.create({ name: 'A', driver: 's3', config: s3Config }, T0);
        const b = await repo.create({ name: 'B', driver: 's3', config: { ...s3Config, bucket: 'b' } }, T0 + 1);
        const c = await repo.create({ name: 'C', driver: 'local', config: { root: '/srv/files' } }, T0 + 2);

        expect(await repo.findDefault()).toBeNull();

        // Racing writers: the transaction serializes them, so whichever lands
        // last wins and NO combination leaves two rows flagged.
        await Promise.all([repo.setDefault(a.id), repo.setDefault(b.id), repo.setDefault(c.id)]);

        const flagged = (await repo.list()).filter((d) => d.isDefault);
        expect(flagged).toHaveLength(1);
        expect((await repo.findDefault())?.id).toBe(flagged[0]?.id);
      });

      it('creates a default in one call — the seed’s path', async () => {
        const repo = destinationsRepo(t.meta, crypto);
        expect(await repo.isEmpty()).toBe(true);
        const dest = await repo.create({ name: 'Tigris', driver: 's3', config: s3Config, makeDefault: true }, T0);
        expect(dest.isDefault).toBe(true);
        expect(await repo.isEmpty()).toBe(false);
        expect((await repo.findDefault())?.id).toBe(dest.id);
      });

      it('keeps the stored secret when an update does not send one, and clears it on null', async () => {
        const repo = destinationsRepo(t.meta, crypto);
        const dest = await repo.create({ name: 'NAS', driver: 'webdav', config: { url: 'https://nas.example.com/dav' }, secret: 'user:pw' }, T0);

        const renamed = await repo.update(dest.id, { name: 'Home NAS' }, T0 + 1);
        expect(renamed?.name).toBe('Home NAS');
        expect(renamed?.hasSecret).toBe(true);
        expect(await repo.getSecret(dest.id)).toBe('user:pw');

        const cleared = await repo.update(dest.id, { secret: null }, T0 + 2);
        expect(cleared?.hasSecret).toBe(false);
        expect(await repo.getSecret(dest.id)).toBeNull();
      });

      it('records a probe verdict and derives status from it', async () => {
        const repo = destinationsRepo(t.meta, crypto);
        const dest = await repo.create({ name: 'Spaces', driver: 's3', config: s3Config }, T0);

        const bad = await repo.recordProbe(dest.id, { ok: false, error: 'SignatureDoesNotMatch' }, T0 + 1);
        expect(bad?.status).toBe('error');
        expect(bad?.lastError).toBe('SignatureDoesNotMatch');
        expect(bad?.lastTestedAt).toBe(T0 + 1);

        const good = await repo.recordProbe(dest.id, { ok: true }, T0 + 2);
        expect(good?.status).toBe('ok');
        expect(good?.lastError).toBeNull();
      });

      it('refuses to delete a destination that still holds files, naming the count', async () => {
        const destinations = destinationsRepo(t.meta, crypto);
        const files = filesRepo(t.meta);
        const dest = await destinations.create({ name: 'Spaces', driver: 's3', config: s3Config }, T0);

        for (const name of ['a.pdf', 'b.pdf']) {
          await files.create(
            { filename: name, mime: 'application/pdf', sizeBytes: 9, sha256: SHA, kind: 'upload', destinationId: dest.id, storage: 's3', storageKey: `upload/2026/09/${name}` },
            T0,
          );
        }

        expect(await destinations.countFiles(dest.id)).toBe(2);
        await expect(destinations.remove(dest.id)).rejects.toBeInstanceOf(DestinationInUseError);
        await expect(destinations.remove(dest.id)).rejects.toThrow('2 file(s)');

        const empty = await destinations.create({ name: 'Empty', driver: 'local', config: { root: '/srv/x' } }, T0);
        expect(await destinations.remove(empty.id)).toBe(true);
      });

      it('attaches a file to a record, finds it by the denormalized keys, and detaches', async () => {
        const files = filesRepo(t.meta);
        const file = await files.create({ filename: 'inv-1042.pdf', mime: 'application/pdf', sizeBytes: 900, sha256: SHA, kind: 'upload' }, T0);
        expect(file.attachedAt).toBeNull();

        const attached = await files.attach(file.id, ref(), T0 + 5);
        expect(attached?.attachedAt).toBe(T0 + 5);
        expect(attached?.entityTable).toBe('public.invoices');
        expect(attached?.entityId).toBe('1042');
        // The json ref survives alongside the lookup columns — the PK map is
        // what a UI renders, the columns are how the row is found.
        expect(attached?.entity?.pk).toEqual({ id: 1042 });

        const listed = await files.listByEntity({ connectionId: 'conn_1', table: 'public.invoices', recordId: '1042' });
        expect(listed.map((f) => f.id)).toEqual([file.id]);

        // Another record's panel must not see it.
        expect(await files.listByEntity({ connectionId: 'conn_1', table: 'public.invoices', recordId: '9' })).toEqual([]);
        // Nor the same table on another connection.
        expect(await files.listByEntity({ connectionId: 'conn_2', table: 'public.invoices', recordId: '1042' })).toEqual([]);

        const detached = await files.detach(file.id);
        expect(detached?.attachedAt).toBeNull();
        expect(detached?.entity).toBeNull();
        expect(await files.listByEntity({ connectionId: 'conn_1', table: 'public.invoices', recordId: '1042' })).toEqual([]);
      });

      it('keeps the original attached_at when the same record re-attaches', async () => {
        const files = filesRepo(t.meta);
        const file = await files.create({ filename: 'x.pdf', mime: 'application/pdf', sizeBytes: 1, sha256: SHA, kind: 'upload' }, T0);
        await files.attach(file.id, ref(), T0 + 1);
        const again = await files.attach(file.id, ref({ label: '1042' }), T0 + 99);
        expect(again?.attachedAt).toBe(T0 + 1);

        // A DIFFERENT record is a new attachment, and re-stamps.
        const moved = await files.attach(file.id, ref({ pk: { id: 7 }, label: '7' }), T0 + 200);
        expect(moved?.attachedAt).toBe(T0 + 200);
        expect(moved?.entityId).toBe('7');
      });

      it('lists only unattached uploads for the sweep’s first half', async () => {
        const files = filesRepo(t.meta);
        const stale = await files.create({ filename: 'stale.pdf', mime: 'application/pdf', sizeBytes: 1, sha256: SHA, kind: 'upload' }, T0);
        const claimed = await files.create({ filename: 'used.pdf', mime: 'application/pdf', sizeBytes: 1, sha256: SHA, kind: 'upload' }, T0);
        await files.attach(claimed.id, ref(), T0 + 1);
        // An export is attached to nothing by design and belongs to the exports sweep.
        await files.create({ filename: 'orders.csv', mime: 'text/csv', sizeBytes: 1, sha256: SHA, kind: 'export' }, T0);
        const fresh = await files.create({ filename: 'fresh.pdf', mime: 'application/pdf', sizeBytes: 1, sha256: SHA, kind: 'upload' }, T0 + 10_000);

        const worklist = await files.listUnattachedBefore(T0 + 1);
        expect(worklist.map((f) => f.id)).toEqual([stale.id]);
        expect(worklist.map((f) => f.id)).not.toContain(fresh.id);
      });

      it('pages a destination’s files by id keyset and flips them in one update', async () => {
        const destinations = destinationsRepo(t.meta, crypto);
        const files = filesRepo(t.meta);
        const dest = await destinations.create({ name: 'Spaces', driver: 's3', config: s3Config }, T0);

        const ids: string[] = [];
        for (let i = 0; i < 5; i += 1) {
          const id = newId('file');
          ids.push(id);
          await files.create({ id, filename: `f${String(i)}.pdf`, mime: 'application/pdf', sizeBytes: 1, sha256: SHA, kind: 'upload' }, T0 + i);
        }
        ids.sort();

        // The implicit local destination reads as `null`, which is how "move
        // everything off this server's disk" is expressed.
        const firstPage = await files.listByDestination(null, { limit: 2 });
        expect(firstPage.map((f) => f.id)).toEqual(ids.slice(0, 2));
        const secondPage = await files.listByDestination(null, { limit: 2, after: firstPage.at(-1)?.id });
        expect(secondPage.map((f) => f.id)).toEqual(ids.slice(2, 4));

        const moved = ids[0] as string;
        expect(await files.flipDestination(moved, { destinationId: dest.id, storageKey: 'upload/2026/09/f0.pdf', storage: 's3' })).toBe(true);
        const after = await files.findById(moved);
        expect(after?.destinationId).toBe(dest.id);
        expect(after?.storageKey).toBe('upload/2026/09/f0.pdf');
        expect((await files.listByDestination(dest.id)).map((f) => f.id)).toEqual([moved]);
      });

      it('trashes and restores without token machinery, and reports usage per destination', async () => {
        const destinations = destinationsRepo(t.meta, crypto);
        const files = filesRepo(t.meta);
        const dest = await destinations.create({ name: 'Spaces', driver: 's3', config: s3Config }, T0);

        const local = await files.create({ filename: 'a.pdf', mime: 'application/pdf', sizeBytes: 100, sha256: SHA, kind: 'upload' }, T0);
        await files.create({ filename: 'b.pdf', mime: 'application/pdf', sizeBytes: 250, sha256: SHA, kind: 'upload', destinationId: dest.id, storage: 's3', storageKey: 'upload/b.pdf' }, T0);

        expect(await files.markDeleted(local.id, T0 + 1)).toBe(true);
        const restored = await files.restore(local.id);
        expect(restored?.deletedAt).toBeNull();

        await files.markDeleted(local.id, T0 + 2);
        // Trashed bytes are still on the disk, but they are not what the
        // operator is being asked to reason about (D23).
        const usage = await files.usageByDestination();
        expect(usage).toEqual([{ destinationId: dest.id, files: 1, bytes: 250 }]);
      });
    });
  });
}
