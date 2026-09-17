// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The three byte drivers against ONE contract.
 *
 * `local` always runs. `webdav` always runs too, against the in-process stub,
 * and additionally against `TEST_WEBDAV_URL` when one is set. `s3` runs against
 * `TEST_S3_URL` — MinIO in CI, skipped locally with the reason printed in the
 * test name, never silently.
 *
 * TEST_S3_URL grammar: `http://<accessKey>:<secretKey>@<host>:<port>/<bucket>`.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createLocalDriver } from '../src/files/drivers/local.js';
import { createS3Driver } from '../src/files/drivers/s3.js';
import { createWebdavDriver } from '../src/files/drivers/webdav.js';
import { datedKey, isSafeRemoteKey, safeNamePart } from '../src/files/drivers/keys.js';
import { describeFileDriver } from './helpers/file-driver-contract.js';
import { startS3Stub } from './helpers/s3-stub.js';
import { startWebdavStub } from './helpers/webdav-stub.js';

// ── local ──────────────────────────────────────────────────────────────────

describeFileDriver(
  'local',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'adminium-local-driver-'));
    return {
      driver: createLocalDriver({ root }),
      teardown: () => rm(root, { recursive: true, force: true }),
    };
  },
  { keyStyle: 'id' },
);

// ── webdav (in-process stub) ───────────────────────────────────────────────

describeFileDriver(
  'webdav (stub)',
  async () => {
    const stub = await startWebdavStub({ auth: { username: 'ava', password: 'hunter2' } });
    return {
      driver: createWebdavDriver({
        config: { url: stub.url, prefix: 'adminium' },
        credentials: { username: 'ava', password: 'hunter2' },
      }),
      teardown: () => stub.close(),
    };
  },
  { keyStyle: 'dated' },
);

// ── webdav (a real server, when one is configured) ─────────────────────────

const realWebdav = process.env['TEST_WEBDAV_URL'];
describeFileDriver(
  'webdav (TEST_WEBDAV_URL)',
  async () => {
    const url = new URL(realWebdav ?? 'http://unused');
    const credentials =
      url.username === '' ? undefined : { username: decodeURIComponent(url.username), password: decodeURIComponent(url.password) };
    url.username = '';
    url.password = '';
    return {
      driver: createWebdavDriver({
        config: { url: url.toString().replace(/\/+$/, ''), prefix: 'adminium-test' },
        credentials,
      }),
    };
  },
  { keyStyle: 'dated', skip: realWebdav === undefined ? 'TEST_WEBDAV_URL is not set' : undefined },
);

// ── s3 (in-process protocol stub) ──────────────────────────────────────────
//
// Not a substitute for the MinIO leg — it cannot prove signature interop (see
// `helpers/s3-stub.ts`). It proves the wire behaviour a signer vector cannot:
// unchunked streamed PUTs whose bytes hash to what was signed, ranges, 404s,
// idempotent deletes, and XML error surfacing. Without it, every `s3` assertion
// on a developer machine is a skip.

describeFileDriver(
  's3 (protocol stub)',
  async () => {
    const stub = await startS3Stub();
    return {
      driver: createS3Driver({
        config: { endpoint: stub.endpoint, region: 'us-east-1', bucket: stub.bucket, prefix: 'adminium-test', forcePathStyle: true },
        credentials: { accessKeyId: 'minioadmin', secretAccessKey: 'minioadmin' },
      }),
      teardown: async () => {
        // Asserted after the whole contract has run, so it covers every PUT the
        // suite made — including the 2 MiB one, which is the only body large
        // enough to be chunked by accident.
        const puts = stub.log.filter((entry) => entry.method === 'PUT');
        expect(puts.length).toBeGreaterThan(0);
        expect(puts.every((entry) => entry.signed)).toBe(true);
        expect(puts.every((entry) => entry.payloadHashMatched === true)).toBe(true);
        expect(puts.every((entry) => entry.unchunked === true)).toBe(true);
        await stub.close();
      },
    };
  },
  { keyStyle: 'dated' },
);

// ── s3 (MinIO in CI) ───────────────────────────────────────────────────────

const s3Url = process.env['TEST_S3_URL'];
describeFileDriver(
  's3 (TEST_S3_URL)',
  async () => {
    const url = new URL(s3Url ?? 'http://unused/bucket');
    const bucket = url.pathname.replace(/^\/+|\/+$/g, '');
    const credentials = { accessKeyId: decodeURIComponent(url.username), secretAccessKey: decodeURIComponent(url.password) };
    url.username = '';
    url.password = '';
    url.pathname = '';
    return {
      driver: createS3Driver({
        config: {
          endpoint: url.toString().replace(/\/+$/, ''),
          region: process.env['TEST_S3_REGION'] ?? 'us-east-1',
          bucket,
          prefix: 'adminium-test',
          // MinIO, Garage and every self-hosted target issue no per-bucket
          // hostname; the virtual-host leg is exercised by the URL unit test
          // below, which needs no server.
          forcePathStyle: true,
        },
        credentials,
      }),
    };
  },
  { keyStyle: 'dated', skip: s3Url === undefined ? 'TEST_S3_URL is not set (CI runs this against MinIO)' : undefined },
);

// ── key layout, which needs no server at all ───────────────────────────────

describe('remote key layout (D19)', () => {
  it('reduces a filename to a safe, readable part', () => {
    expect(safeNamePart('Rechnung Müller (final).pdf')).toBe('Rechnung-Mu-ller-final.pdf');
    expect(safeNamePart('../../etc/passwd')).toBe('passwd');
    expect(safeNamePart('.hidden')).toBe('hidden');
    expect(safeNamePart('---')).toBe('file');
    expect(safeNamePart('')).toBe('file');
    expect(safeNamePart(`${'a'.repeat(200)}.pdf`)).toHaveLength(80);
  });

  it('dates the key and keeps the id in it', () => {
    const key = datedKey({ prefix: 'invoices', id: 'file_01M1Q000000000000000000000', kind: 'upload', filename: 'inv-1042.pdf', createdAt: Date.UTC(2026, 8, 4) });
    expect(key).toBe('invoices/upload/2026/09/file_01M1Q000000000000000000000-inv-1042.pdf');
    // No prefix ⇒ no leading separator.
    expect(datedKey({ id: 'file_01M1Q000000000000000000000', kind: 'export', filename: 'x.csv', createdAt: Date.UTC(2026, 0, 9) })).toBe(
      'export/2026/01/file_01M1Q000000000000000000000-x.csv',
    );
  });

  it('refuses every escape shape on the way out as well as in', () => {
    for (const key of ['../x', 'a/../b', '/leading', 'trailing/', 'a//b', '', 'a/./b', 'x'.repeat(301)]) {
      expect(isSafeRemoteKey(key)).toBe(false);
    }
    expect(isSafeRemoteKey('upload/2026/09/file_01M1Q000000000000000000000-inv.pdf')).toBe(true);
  });
});

describe('s3 URL construction', () => {
  const base = { region: 'auto', bucket: 'photos', forcePathStyle: false } as const;

  it('uses a per-bucket hostname for virtual-host style and a path for the rest', async () => {
    // No request is made: `head` on an unsafe key throws before fetch, and a
    // safe key is proved through a fetch stub that records the URL.
    const seen: string[] = [];
    const stub: typeof fetch = async (input) => {
      seen.push(String(input));
      return new Response(null, { status: 404 });
    };

    const virtualHost = createS3Driver({
      config: { ...base, endpoint: 'https://nyc3.digitaloceanspaces.com' },
      credentials: { accessKeyId: 'AK', secretAccessKey: 'SK' },
      fetchImpl: stub,
    });
    await virtualHost.head('upload/2026/09/a.pdf');
    expect(seen.at(-1)).toBe('https://photos.nyc3.digitaloceanspaces.com/upload/2026/09/a.pdf');

    const pathStyle = createS3Driver({
      config: { ...base, forcePathStyle: true, endpoint: 'http://127.0.0.1:9000' },
      credentials: { accessKeyId: 'AK', secretAccessKey: 'SK' },
      fetchImpl: stub,
    });
    await pathStyle.head('upload/2026/09/a.pdf');
    expect(seen.at(-1)).toBe('http://127.0.0.1:9000/photos/upload/2026/09/a.pdf');

    // AWS with no endpoint derives one from the region.
    const aws = createS3Driver({
      config: { region: 'eu-west-1', bucket: 'photos', forcePathStyle: false },
      credentials: { accessKeyId: 'AK', secretAccessKey: 'SK' },
      fetchImpl: stub,
    });
    await aws.head('a/b.pdf');
    expect(seen.at(-1)).toBe('https://photos.s3.eu-west-1.amazonaws.com/a/b.pdf');
  });

  it('surfaces the provider’s own error code and message', async () => {
    const stub: typeof fetch = async () =>
      new Response('<?xml version="1.0"?><Error><Code>SignatureDoesNotMatch</Code><Message>The request signature we calculated does not match</Message></Error>', {
        status: 403,
      });
    const driver = createS3Driver({
      config: { ...base, forcePathStyle: true, endpoint: 'http://127.0.0.1:9000' },
      credentials: { accessKeyId: 'AK', secretAccessKey: 'SK' },
      fetchImpl: stub,
    });
    // 403 on HEAD reads as absent (a bucket without ListBucket answers that
    // way for a missing key), so the message path is proved through `open`.
    await expect(driver.open('a/b.pdf')).rejects.toThrow('SignatureDoesNotMatch: The request signature we calculated does not match');
  });
});

describe('webdav collection creation', () => {
  it('creates missing parents after a 409 and retries exactly once', async () => {
    const stub = await startWebdavStub();
    try {
      const driver = createWebdavDriver({ config: { url: stub.url, prefix: 'files' }, fetchImpl: fetch });
      const { writeFile } = await import('node:fs/promises');
      const dir = await mkdtemp(join(tmpdir(), 'adminium-dav-'));
      const path = join(dir, 'payload');
      await writeFile(path, 'hello');

      const key = driver.keyFor({ id: 'file_01M1Q000000000000000000000', kind: 'upload', filename: 'a.pdf', createdAt: Date.UTC(2026, 8, 4) });
      await driver.put(key, { path, sizeBytes: 5, mime: 'application/pdf', sha256: 'x'.repeat(64) });

      // The first PUT was refused, four collections were made top-down, and the
      // retry landed — proving the recovery rather than asserting on a mock.
      expect(stub.log.filter((entry) => entry.method === 'PUT').map((entry) => entry.status)).toEqual([409, 201]);
      expect(stub.log.filter((entry) => entry.method === 'MKCOL').map((entry) => entry.path)).toEqual([
        'files',
        'files/upload',
        'files/upload/2026',
        'files/upload/2026/09',
      ]);
      expect(stub.collections.has('files/upload/2026/09')).toBe(true);

      // A second file in the same month needs no MKCOL at all.
      const before = stub.log.filter((entry) => entry.method === 'MKCOL').length;
      const second = driver.keyFor({ id: 'file_01M1Q000000000000000000001', kind: 'upload', filename: 'b.pdf', createdAt: Date.UTC(2026, 8, 4) });
      await driver.put(second, { path, sizeBytes: 5, mime: 'application/pdf', sha256: 'x'.repeat(64) });
      expect(stub.log.filter((entry) => entry.method === 'MKCOL')).toHaveLength(before);

      await rm(dir, { recursive: true, force: true });
    } finally {
      await stub.close();
    }
  });

  it('reports a wrong credential rather than treating it as absent', async () => {
    const stub = await startWebdavStub({ auth: { username: 'ava', password: 'hunter2' } });
    try {
      const driver = createWebdavDriver({
        config: { url: stub.url },
        credentials: { username: 'ava', password: 'wrong' },
      });
      await expect(driver.head('upload/2026/09/a.pdf')).rejects.toThrow('HTTP 401');
    } finally {
      await stub.close();
    }
  });
});
