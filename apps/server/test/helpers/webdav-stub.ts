// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An in-process WebDAV server, just complete enough to be a conformance target
 * (37-files-and-storage.md D30, 37-T06).
 *
 * WHY A STUB RATHER THAN A MOCKED `fetch`. The one thing the WebDAV driver
 * does that is not plain HTTP is recover from a 409 by creating collections,
 * and a mocked fetch would only ever return the 409 the test told it to. A
 * stub that actually refuses a PUT into a collection it does not have — and
 * accepts it once MKCOL has run — is what makes that path real. `TEST_WEBDAV_URL`
 * points the same suite at a real server when there is one.
 *
 * It stores objects in a Map and models exactly two rules: a PUT needs its
 * parent collection to exist, and MKCOL of an existing collection is 405.
 * Everything else (locking, PROPFIND, depth headers, ETags) is out of scope
 * because the driver never sends it.
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface WebdavStub {
  url: string;
  /** Objects currently stored, keyed by path relative to the root. */
  objects: Map<string, Buffer>;
  /** Collections that exist. The root always does. */
  collections: Set<string>;
  /** Requests seen, in order — lets a test assert MKCOL actually ran. */
  log: { method: string; path: string; status: number }[];
  close(): Promise<void>;
}

export interface WebdavStubOptions {
  /** When set, every request must carry this Basic credential. */
  auth?: { username: string; password: string };
  /** Collections that exist from the start (a server where the tree is pre-made). */
  seedCollections?: readonly string[];
}

export async function startWebdavStub(opts: WebdavStubOptions = {}): Promise<WebdavStub> {
  const objects = new Map<string, Buffer>();
  const collections = new Set<string>(['', ...(opts.seedCollections ?? [])]);
  const log: { method: string; path: string; status: number }[] = [];

  const expected =
    opts.auth === undefined
      ? undefined
      : `Basic ${Buffer.from(`${opts.auth.username}:${opts.auth.password}`).toString('base64')}`;

  const server: Server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? '/').replace(/^\/+/, '').replace(/\/+$/, ''));
    const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    const method = req.method ?? 'GET';

    const send = (status: number, body?: Buffer, headers: Record<string, string> = {}): void => {
      log.push({ method, path, status });
      res.writeHead(status, { ...headers, ...(body === undefined ? {} : { 'content-length': String(body.byteLength) }) });
      res.end(body);
    };

    if (expected !== undefined && req.headers.authorization !== expected) {
      send(401);
      return;
    }

    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      switch (method) {
        case 'PUT': {
          // The one WebDAV rule the driver has to cope with.
          if (!collections.has(parent)) {
            send(409);
            return;
          }
          objects.set(path, Buffer.concat(chunks));
          send(201);
          return;
        }
        case 'MKCOL': {
          if (collections.has(path)) {
            send(405);
            return;
          }
          if (!collections.has(parent)) {
            send(409);
            return;
          }
          collections.add(path);
          send(201);
          return;
        }
        case 'GET': {
          const found = objects.get(path);
          if (found === undefined) {
            send(404);
            return;
          }
          const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
          if (range === null) {
            send(200, found, { 'content-type': 'application/octet-stream' });
            return;
          }
          const start = range[1] === '' ? 0 : Number(range[1]);
          const end = range[2] === '' ? found.byteLength - 1 : Math.min(Number(range[2]), found.byteLength - 1);
          const slice = found.subarray(start, end + 1);
          send(206, slice, { 'content-range': `bytes ${String(start)}-${String(end)}/${String(found.byteLength)}` });
          return;
        }
        case 'HEAD': {
          const found = objects.get(path);
          if (found === undefined) {
            send(404);
            return;
          }
          log.push({ method, path, status: 200 });
          res.writeHead(200, { 'content-length': String(found.byteLength) });
          res.end();
          return;
        }
        case 'DELETE': {
          const existed = objects.delete(path);
          send(existed ? 204 : 404);
          return;
        }
        default:
          send(405);
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${String(port)}`,
    objects,
    collections,
    log,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
