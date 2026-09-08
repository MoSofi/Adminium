// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The store over a CONFIGURED destination (37-files-and-storage.md D18/D38,
 * 37-T07).
 *
 * The byte-identity half of 37-T07 is proved by every pre-wave suite passing
 * unchanged. This is the other half, and it is the one that closes the live
 * defect in §0.3: on a host with no persistent local disk — DigitalOcean App
 * Platform says so in `deploy/do-app.yaml`'s own header — every export, the
 * uploaded branding logo and every imported schema file is lost on each
 * redeploy today, with the meta row left pointing at nothing.
 *
 * D18's rule is what fixes it, and it is deliberately not "uploads go to the
 * bucket": once a default exists, EVERY new row of EVERY kind follows it. A
 * system artifact is not safer on a disk that does not persist. So the test
 * that matters is a BRANDING logo — a kind nobody would think of as a "file
 * feature" — going to a bucket and coming back through its own route.
 */
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';

import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createSqliteMetaDb, destinationsRepo, filesRepo, firstRun, newId, type MetaDb } from '@adminium/meta';

import { createDestinationResolver } from '../src/files/destinations.js';
import { FILES_DIR } from '../src/files/drivers/local.js';
import { createSpool } from '../src/files/spool.js';
import { createFileStore, UnsupportedFileTypeError, type FileStore } from '../src/files/store.js';
import { createTestFileStore, TEST_STORAGE_CRYPTO } from './helpers/file-store.js';
import { startS3Stub, type S3Stub } from './helpers/s3-stub.js';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(256, 0x20)]);

describe('FileStore over a configured destination', () => {
  let meta: MetaDb;
  let dataDir: string;
  let stub: S3Stub;
  let store: FileStore;

  async function makeS3Destination(makeDefault = true): Promise<string> {
    const dest = await destinationsRepo(meta, TEST_STORAGE_CRYPTO).create({
      name: 'Spaces',
      driver: 's3',
      config: { endpoint: stub.endpoint, region: 'us-east-1', bucket: stub.bucket, prefix: 'adminium', forcePathStyle: true },
      secret: { accessKeyId: 'minioadmin', secretAccessKey: 'minioadmin' },
      makeDefault,
    });
    return dest.id;
  }

  beforeEach(async () => {
    meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    dataDir = await mkdtemp(join(tmpdir(), 'adminium-store-dest-'));
    stub = await startS3Stub();
    store = createFileStore({
      spool: createSpool({ dataDir }),
      destinations: createDestinationResolver({
        repo: destinationsRepo(meta, TEST_STORAGE_CRYPTO),
        localRoot: resolve(dataDir, FILES_DIR),
      }),
      files: filesRepo(meta),
    });
  });

  afterEach(async () => {
    await stub.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  it('sends a BRANDING logo to the default destination and reads it back', async () => {
    await makeS3Destination();

    const id = newId('file');
    const written = await store.write({ id, kind: 'branding', filename: 'logo.png', mime: 'image/png', bytes: PNG });

    // The row now names the bucket, and the key is the dated layout (D19) —
    // not the flat id, which is the local grammar.
    expect(written.destinationId).not.toBeNull();
    expect(written.storage).toBe('s3');
    expect(written.storageKey).toMatch(/^adminium\/branding\/\d{4}\/\d{2}\/file_[0-9A-Z]{26}-logo\.png$/);
    expect([...stub.objects.keys()]).toEqual([written.storageKey]);

    // …and it comes back byte-for-byte through the same seam the route uses.
    const chunks: Buffer[] = [];
    for await (const chunk of await store.read(written)) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks)).toEqual(PNG);

    // Nothing was left on the local disk — the point of the whole exercise on a
    // host that has none.
    expect(await readdir(resolve(dataDir, FILES_DIR)).catch(() => [])).toEqual([]);
    expect(await readdir(join(dataDir, 'tmp'))).toEqual([]);
  });

  it('applies the default to every kind, not just uploads (D38)', async () => {
    await makeS3Destination();
    for (const kind of ['upload', 'export', 'import', 'branding', 'schema', 'archive'] as const) {
      const written = await store.write({ id: newId('file'), kind, filename: `${kind}.pdf`, mime: 'application/pdf', bytes: PDF });
      expect(written.destinationId, kind).not.toBeNull();
      expect(written.storageKey, kind).toContain(`/${kind}/`);
    }
  });

  it('streams an incremental artifact to the bucket unchunked', async () => {
    await makeS3Destination();
    const writer = await store.openWriter({ id: newId('file'), kind: 'export', filename: 'orders.csv', mime: 'text/csv' });
    for (let i = 0; i < 500; i += 1) await writer.write(`${String(i)},row\n`);
    const written = await writer.close();

    const put = stub.log.find((entry) => entry.method === 'PUT');
    // The spool is what makes an exact Content-Length and a real payload hash
    // possible for a body nobody knew the size of when it started (D4).
    expect(put?.unchunked).toBe(true);
    expect(put?.payloadHashMatched).toBe(true);
    expect(stub.objects.get(written.storageKey)?.body.toString()).toContain('499,row');
  });

  it('leaves EXISTING rows where they are when a default appears', async () => {
    // Written before any destination exists: this server's disk.
    const localId = newId('file');
    const before = await store.write({ id: localId, kind: 'export', filename: 'old.csv', mime: 'text/csv', bytes: 'old' });
    expect(before.destinationId).toBeNull();

    await makeS3Destination();

    // The new default governs the NEXT file and nothing else…
    const after = await store.write({ id: newId('file'), kind: 'export', filename: 'new.csv', mime: 'text/csv', bytes: 'new' });
    expect(after.destinationId).not.toBeNull();

    // …and the old one still reads, from where it actually is.
    const chunks: Buffer[] = [];
    for await (const chunk of await store.read(before)) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString()).toBe('old');
  });

  it('falls back to this server’s disk when the default is disabled', async () => {
    const repo = destinationsRepo(meta, TEST_STORAGE_CRYPTO);
    const id = await makeS3Destination();
    expect(await store.defaultDestinationId()).toBe(id);

    await repo.update(id, { disabled: true });
    // Disabled means "take no NEW files", never "the files there are gone".
    expect(await store.defaultDestinationId()).toBeNull();

    const written = await store.write({ id: newId('file'), kind: 'export', filename: 'x.csv', mime: 'text/csv', bytes: 'x' });
    expect(written.destinationId).toBeNull();
  });

  it('still serves bytes from a disabled destination', async () => {
    const repo = destinationsRepo(meta, TEST_STORAGE_CRYPTO);
    const id = await makeS3Destination();
    const written = await store.write({ id: newId('file'), kind: 'upload', filename: 'a.pdf', mime: 'application/pdf', bytes: PDF });

    await repo.update(id, { disabled: true });
    const chunks: Buffer[] = [];
    for await (const chunk of await store.read(written)) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks)).toEqual(PDF);
  });

  it('rebuilds the driver when the credential is edited, with no TTL to wait out', async () => {
    const repo = destinationsRepo(meta, TEST_STORAGE_CRYPTO);
    const id = await makeS3Destination();
    await store.write({ id: newId('file'), kind: 'upload', filename: 'a.pdf', mime: 'application/pdf', bytes: PDF });

    // A wrong key is still a signed request as far as the stub is concerned, so
    // what is asserted is that the CACHE noticed — the driver instance the next
    // write uses is built from the row as it now stands.
    await repo.update(id, { secret: { accessKeyId: 'rotated', secretAccessKey: 'rotated-secret' } });
    await store.write({ id: newId('file'), kind: 'upload', filename: 'b.pdf', mime: 'application/pdf', bytes: PDF });
    expect(stub.objects.size).toBe(2);
  });
});

describe('putUpload — the gate before the bytes are committed', () => {
  let meta: MetaDb;
  let dataDir: string;
  let store: FileStore;

  beforeEach(async () => {
    meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    dataDir = await mkdtemp(join(tmpdir(), 'adminium-put-upload-'));
    store = createTestFileStore({ dataDir, meta });
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it('stores the SNIFFED type, not the claimed one, and writes the row', async () => {
    const { file, sniffed } = await store.putUpload({
      kind: 'upload',
      filename: 'totally-an-image.png',
      claimedMime: 'image/png',
      source: Readable.from([PDF]),
      maxBytes: 1_000_000,
      allowedTypes: ['pdf', 'png'],
    });

    expect(sniffed.mime).toBe('application/pdf');
    expect(file.mime).toBe('application/pdf');
    expect(file.filename).toBe('totally-an-image.png');
    expect(file.attachedAt).toBeNull();
    expect(await filesRepo(meta).findById(file.id)).not.toBeNull();
  });

  it('refuses a type outside the allowlist and leaves nothing behind', async () => {
    await expect(
      store.putUpload({
        kind: 'upload',
        filename: 'logo.png',
        source: Readable.from([PNG]),
        maxBytes: 1_000_000,
        allowedTypes: ['pdf'],
      }),
    ).rejects.toBeInstanceOf(UnsupportedFileTypeError);

    // Refused BEFORE the driver saw it: no object, no row, no spool file.
    expect(await readdir(resolve(dataDir, FILES_DIR)).catch(() => [])).toEqual([]);
    expect(await readdir(join(dataDir, 'tmp'))).toEqual([]);
  });

  it('names the sniffed type in the refusal, so the message is actionable', async () => {
    await expect(
      store.putUpload({ kind: 'upload', filename: 'a.pdf', source: Readable.from([PDF]), maxBytes: 1_000_000, allowedTypes: ['png'] }),
    ).rejects.toThrow('application/pdf');
  });

  it('attaches at creation when the record already exists', async () => {
    const entity = { connectionId: 'conn_1', table: 'public.invoices', pk: { id: 1042 }, label: '1042' };
    const { file } = await store.putUpload({
      kind: 'upload',
      filename: 'inv.pdf',
      source: Readable.from([PDF]),
      maxBytes: 1_000_000,
      allowedTypes: ['pdf'],
      entity,
      at: 1_750_000_000_000,
    });
    expect(file.attachedAt).toBe(1_750_000_000_000);
    expect(file.entityTable).toBe('public.invoices');
    expect(await filesRepo(meta).listByEntity({ connectionId: 'conn_1', table: 'public.invoices', recordId: '1042' })).toHaveLength(1);
  });
});
