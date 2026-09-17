// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `webdav` driver — "my own remote server".
 *
 * WHY WEBDAV AND NOT SFTP. The owner asked to be able to "configure a remote
 * server for hosting". SFTP would mean adding `ssh2` — a native-ish dependency
 * with its own key handling — for a protocol this server would use as a
 * filesystem. WebDAV is PUT/GET/HEAD/DELETE/MKCOL over HTTP with Basic auth:
 * nine lines of nginx, on by default on every NAS, on every Hetzner Storage
 * Box and inside Nextcloud. It needs no dependency at all, because it is the
 * same `fetch` the S3 driver uses. A bare VPS with only SSH gets the
 * MinIO/Garage recipe and the `s3` driver (D33).
 *
 * THE ONE PLACE IT IS NOT JUST HTTP: collections must exist before a PUT into
 * them. A dated key has three levels (`kind/yyyy/mm`), and a server answers a
 * PUT into a missing collection with 409 Conflict. So a 409 triggers MKCOL of
 * each missing parent, one level at a time from the top, then one retry. That
 * is the entire protocol difference, and it is why `put` is the only verb here
 * with any logic in it.
 *
 * BASIC AUTH OVER HTTPS. The credential is stored encrypted (D2/D16) and sent
 * as `Authorization: Basic`. Over plain HTTP that is a credential in cleartext
 * on the wire; the destination editor and the docs say so, and the operator
 * pointing at their own LAN NAS is making an informed choice this driver does
 * not second-guess (D17).
 */

import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';

import type { WebdavDestinationConfig } from '@adminium/meta';
import { newId } from '@adminium/meta';

import {
  FileDriverError,
  FileNotFoundError,
  type ByteRange,
  type FileDriver,
  type KeyRequest,
  type OpenedBytes,
  type ProbeResult,
  type PutSource,
} from './driver.js';
import { datedKey, isSafeRemoteKey } from './keys.js';

export interface WebdavCredentials {
  username: string;
  password: string;
}

export interface WebdavDriverOptions {
  config: WebdavDestinationConfig;
  credentials?: WebdavCredentials | undefined;
  fetchImpl?: typeof fetch;
}

export function createWebdavDriver(opts: WebdavDriverOptions): FileDriver {
  const { config } = opts;
  const doFetch = opts.fetchImpl ?? fetch;
  const base = config.url.replace(/\/+$/, '');

  const authorization =
    opts.credentials === undefined
      ? undefined
      : `Basic ${Buffer.from(`${opts.credentials.username}:${opts.credentials.password}`).toString('base64')}`;

  function headers(extra: Record<string, string> = {}): Record<string, string> {
    return authorization === undefined ? extra : { ...extra, authorization };
  }

  function urlFor(key: string): string {
    if (!isSafeRemoteKey(key)) {
      throw new FileDriverError(`unsafe storage key: ${JSON.stringify(key)}`);
    }
    // Segment-wise encoding: a filename with a space or an accent is legal in
    // a collection and illegal in a URL path unescaped.
    return `${base}/${key.split('/').map(encodeURIComponent).join('/')}`;
  }

  async function describe(response: Response, what: string): Promise<string> {
    const body = await response.text().catch(() => '');
    // WebDAV errors are usually an HTML page or a DAV:error document; neither
    // is worth parsing, but the first line of either is often the whole story.
    const firstLine = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
    return `${what}: HTTP ${String(response.status)}${firstLine === '' ? '' : ` — ${firstLine}`}`;
  }

  /** MKCOL every missing parent of `key`, from the top down. Existing ones answer 405. */
  async function ensureCollections(key: string): Promise<void> {
    const segments = key.split('/').slice(0, -1);
    let path = '';
    for (const segment of segments) {
      path = path === '' ? segment : `${path}/${segment}`;
      const response = await doFetch(urlFor(`${path}/placeholder`).replace(/\/placeholder$/, ''), {
        method: 'MKCOL',
        headers: headers(),
      });
      // 405 (already a collection) and 301 (server redirected to the canonical
      // trailing-slash form of a collection that exists) are both success.
      if (response.ok || response.status === 405 || response.status === 301) {
        await response.arrayBuffer().catch(() => undefined);
        continue;
      }
      throw new FileDriverError(await describe(response, `MKCOL ${path}`));
    }
  }

  async function putOnce(key: string, source: PutSource): Promise<Response> {
    return doFetch(urlFor(key), {
      method: 'PUT',
      headers: headers({ 'content-type': source.mime, 'content-length': String(source.sizeBytes) }),
      body: Readable.toWeb(createReadStream(source.path)) as unknown as BodyInit,
      duplex: 'half',
    } as RequestInit);
  }

  return {
    kind: 'webdav',

    keyFor(file: KeyRequest): string {
      return datedKey({ prefix: config.prefix, id: file.id, kind: file.kind, filename: file.filename, createdAt: file.createdAt });
    },

    async put(key: string, source: PutSource): Promise<void> {
      let response = await putOnce(key, source);
      if (response.status === 409) {
        // The one WebDAV-shaped failure: a PUT into a collection that is not
        // there yet. Create the path and try exactly once more — a second 409
        // is a real conflict and must surface, not loop.
        await response.arrayBuffer().catch(() => undefined);
        await ensureCollections(key);
        response = await putOnce(key, source);
      }
      if (!response.ok) throw new FileDriverError(await describe(response, `PUT ${key}`));
      await response.arrayBuffer().catch(() => undefined);
    },

    async open(key: string, range?: ByteRange): Promise<OpenedBytes> {
      const extra: Record<string, string> =
        range === undefined
          ? {}
          : { range: `bytes=${String(range.start)}-${range.end === undefined ? '' : String(range.end)}` };
      const response = await doFetch(urlFor(key), { method: 'GET', headers: headers(extra) });
      if (response.status === 404) throw new FileNotFoundError(`no object stored under ${JSON.stringify(key)}`);
      if (!response.ok) throw new FileDriverError(await describe(response, `GET ${key}`));
      if (response.body === null) throw new FileDriverError(`GET ${key}: the response carried no body`);
      const contentRange = response.headers.get('content-range');
      return {
        stream: Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
        sizeBytes: Number(response.headers.get('content-length') ?? '0'),
        ...(contentRange === null ? {} : { contentRange }),
      };
    },

    async head(key: string): Promise<{ sizeBytes: number } | null> {
      const response = await doFetch(urlFor(key), { method: 'HEAD', headers: headers() });
      if (response.status === 404) return null;
      if (!response.ok) throw new FileDriverError(await describe(response, `HEAD ${key}`));
      return { sizeBytes: Number(response.headers.get('content-length') ?? '0') };
    },

    async remove(key: string): Promise<void> {
      const response = await doFetch(urlFor(key), { method: 'DELETE', headers: headers() });
      if (!response.ok && response.status !== 404) {
        throw new FileDriverError(await describe(response, `DELETE ${key}`));
      }
      await response.arrayBuffer().catch(() => undefined);
    },

    async probe(): Promise<ProbeResult> {
      const started = Date.now();
      const key = datedKey({
        prefix: config.prefix,
        id: newId('file'),
        kind: 'probe',
        filename: '.adminium-probe',
        createdAt: Date.now(),
      });
      const payload = Buffer.alloc(1024, 0x2e);
      try {
        let put = await doFetch(urlFor(key), {
          method: 'PUT',
          headers: headers({ 'content-type': 'application/octet-stream', 'content-length': String(payload.byteLength) }),
          body: payload,
        });
        if (put.status === 409) {
          await put.arrayBuffer().catch(() => undefined);
          await ensureCollections(key);
          put = await doFetch(urlFor(key), {
            method: 'PUT',
            headers: headers({ 'content-type': 'application/octet-stream', 'content-length': String(payload.byteLength) }),
            body: payload,
          });
        }
        if (!put.ok) return { ok: false, error: await describe(put, 'PUT') };
        await put.arrayBuffer().catch(() => undefined);

        const get = await doFetch(urlFor(key), { method: 'GET', headers: headers() });
        if (!get.ok) return { ok: false, error: await describe(get, 'GET') };
        const read = Buffer.from(await get.arrayBuffer());
        if (read.byteLength !== payload.byteLength) {
          return { ok: false, error: `probe wrote ${String(payload.byteLength)} bytes and read back ${String(read.byteLength)}` };
        }
        return { ok: true, latencyMs: Date.now() - started };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      } finally {
        await doFetch(urlFor(key), { method: 'DELETE', headers: headers() })
          .then((r) => r.arrayBuffer().catch(() => undefined))
          .catch(() => undefined);
      }
    },
  };
}
