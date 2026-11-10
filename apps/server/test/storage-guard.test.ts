// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A storage endpoint cannot redirect the drivers to another address.
 *
 * The attack: an S3 or WebDAV endpoint on a server the admin controls answers
 * every request with `302` to the cloud metadata address, and the download
 * streams the instance's credentials back as the "file". The fake below is a
 * real HTTP server, and the "metadata" it points at is a second one that
 * counts its visitors, so the test proves nothing was followed rather than
 * trusting a mocked `fetch` (which never follows anything).
 */
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FileDriverError, type FileDriver } from '../src/files/drivers/driver.js';
import { createS3Driver } from '../src/files/drivers/s3.js';
import { createWebdavDriver } from '../src/files/drivers/webdav.js';

const CREDENTIALS = '{"AccessKeyId":"ASIA-STOLEN","SecretAccessKey":"stolen-secret"}';

async function listen(server: Server): Promise<string> {
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
}

const close = (server: Server) => new Promise<void>((done) => server.close(() => done()));

let metadata: Server;
let metadataUrl: string;
let metadataHits: number;
let hostile: Server;
let hostileUrl: string;
let redirectTo: () => string;
let dir: string;

beforeEach(async () => {
  metadataHits = 0;
  metadata = createServer((_request, response) => {
    metadataHits += 1;
    response.writeHead(200, { 'content-type': 'application/json' }).end(CREDENTIALS);
  });
  metadataUrl = await listen(metadata);
  redirectTo = () => `${metadataUrl}/latest/meta-data/iam/security-credentials/instance-role`;
  hostile = createServer((request, response) => {
    request.resume();
    response.writeHead(302, { location: redirectTo() }).end();
  });
  hostileUrl = await listen(hostile);
  dir = await mkdtemp(join(tmpdir(), 'adminium-storage-guard-'));
});

afterEach(async () => {
  hostile.closeAllConnections();
  metadata.closeAllConnections();
  await close(hostile);
  await close(metadata);
  await rm(dir, { recursive: true, force: true });
});

const drivers: Record<string, () => FileDriver> = {
  s3: () =>
    createS3Driver({
      config: { endpoint: hostileUrl, region: 'us-east-1', bucket: 'b', prefix: 'adminium', forcePathStyle: true },
      credentials: { accessKeyId: 'AK', secretAccessKey: 'SK' },
    }),
  webdav: () => createWebdavDriver({ config: { url: hostileUrl, prefix: 'adminium' } }),
};

describe.each(Object.keys(drivers))('%s driver behind an endpoint that redirects', (name) => {
  const driver = () => (drivers[name] as () => FileDriver)();

  it('reads a redirect as an error, not as the bytes it points at', async () => {
    const opened = driver().open('upload/2026/11/a.pdf');
    await expect(opened).rejects.toBeInstanceOf(FileDriverError);
    await expect(opened).rejects.toThrow(`redirect (HTTP 302 to ${metadataUrl})`);
    expect(metadataHits).toBe(0);
  });

  it('refuses the redirect on every verb', async () => {
    const path = join(dir, 'payload');
    await writeFile(path, 'hello');
    const d = driver();
    await expect(d.head('upload/2026/11/a.pdf')).rejects.toThrow('redirect');
    await expect(d.remove('upload/2026/11/a.pdf')).rejects.toThrow('redirect');
    await expect(
      d.put('upload/2026/11/a.pdf', { path, sizeBytes: 5, mime: 'application/pdf', sha256: 'x'.repeat(64) }),
    ).rejects.toThrow('redirect');
    expect(metadataHits).toBe(0);
  });

  it('fails the probe that the storage test routes run, naming the redirect', async () => {
    const result = await driver().probe();
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error).toContain('redirect');
    expect(metadataHits).toBe(0);
  });

  it('never dials the metadata address itself', async () => {
    // Without the fix this dials 169.254.169.254 and hangs until the test's
    // own timeout; with it, the 302 is the answer.
    redirectTo = () => 'http://169.254.169.254/latest/meta-data/iam/security-credentials/';
    await expect(driver().open('upload/2026/11/a.pdf')).rejects.toThrow(
      'redirect (HTTP 302 to http://169.254.169.254)',
    );
  });
});

describe('a 3xx with nowhere to go', () => {
  it('is handed to the driver, so S3 says which endpoint the bucket needs', async () => {
    const body = '<?xml version="1.0" encoding="UTF-8"?><Error><Code>PermanentRedirect</Code><Message>The bucket you are attempting to access must be addressed using the specified endpoint.</Message><Endpoint>b.s3.eu-west-1.amazonaws.com</Endpoint></Error>';
    const fetchImpl: typeof fetch = async () => new Response(body, { status: 301, headers: { 'content-type': 'application/xml' } });
    const driver = createS3Driver({
      config: { region: 'us-east-1', bucket: 'b', prefix: 'adminium', forcePathStyle: false },
      credentials: { accessKeyId: 'AK', secretAccessKey: 'SK' },
      fetchImpl,
    });
    await expect(driver.open('upload/2026/11/a.pdf')).rejects.toThrow('PermanentRedirect: The bucket you are attempting to access must be addressed');
    const probed = await driver.probe();
    expect(probed.ok ? '' : probed.error).toContain('PermanentRedirect');
  });
});

describe('webdav MKCOL', () => {
  it('still reads a 301 as "the collection exists", without following it', async () => {
    const seen: { method: string; redirect: RequestRedirect | undefined }[] = [];
    let puts = 0;
    const fetchImpl: typeof fetch = async (_input, init) => {
      const method = init?.method ?? 'GET';
      seen.push({ method, redirect: init?.redirect });
      if (method === 'PUT') return new Response(null, { status: (puts += 1) === 1 ? 409 : 201 });
      return new Response(null, { status: 301, headers: { location: 'http://169.254.169.254/' } });
    };
    const path = join(dir, 'payload');
    await writeFile(path, 'hello');
    const driver = createWebdavDriver({ config: { url: 'https://dav.example.com', prefix: 'files' }, fetchImpl });
    await driver.put('upload/2026/11/a.pdf', { path, sizeBytes: 5, mime: 'application/pdf', sha256: 'x'.repeat(64) });
    expect(seen.filter((s) => s.method === 'MKCOL')).toHaveLength(3); // upload, upload/2026, upload/2026/11
    expect(seen.every((s) => s.redirect === 'manual')).toBe(true);
  });
});
