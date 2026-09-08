// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `s3` driver (37-files-and-storage.md §3.10, D32).
 *
 * ONE driver for every S3-compatible target: AWS, DigitalOcean Spaces,
 * Cloudflare R2, Backblaze B2, Wasabi, Tigris, MinIO, Garage, SeaweedFS,
 * Supabase Storage, and Google Cloud Storage through its HMAC interop layer.
 * What differs between them is three config fields — endpoint, region and
 * path-style — not code.
 *
 * FOUR VERBS, `fetch`, AND NOTHING ELSE. Node ≥ 22 has global `fetch`
 * (undici), `ReadableStream` and `crypto.subtle`, so there is no HTTP client
 * to add and no SDK to carry (§0.1 item 22).
 *
 * THE PUT BODY IS A FILE STREAM WITH AN EXACT `Content-Length`. undici accepts
 * a `Readable` as a body, but only sends it unchunked when the length is
 * declared — and a chunked PUT against a signature computed over the real
 * payload hash is a 403 on some targets and a 501 on others. The spool (D4)
 * knows the length, which is the whole reason it exists. `duplex: 'half'` is
 * required by the fetch spec for any streaming request body.
 *
 * ERRORS SURFACE THE PROVIDER'S OWN WORDS. S3 answers failures as an XML
 * document with a `<Code>` and a `<Message>`; those are what an operator
 * searches for, so they are extracted and passed through rather than replaced
 * with a status number.
 */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';

import type { S3DestinationConfig } from '@adminium/meta';
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
import { EMPTY_SHA256, signRequest, uriEncode, type SigV4Credentials } from './sigv4.js';

export interface S3DriverOptions {
  config: S3DestinationConfig;
  credentials: SigV4Credentials;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/** `<Code>NoSuchKey</Code><Message>…</Message>` → `NoSuchKey: …`. */
function describeS3Error(status: number, body: string): string {
  const code = /<Code>([^<]+)<\/Code>/.exec(body)?.[1];
  const message = /<Message>([^<]+)<\/Message>/.exec(body)?.[1];
  if (code === undefined) return `HTTP ${String(status)}${body === '' ? '' : `: ${body.slice(0, 300)}`}`;
  return message === undefined ? `${code} (HTTP ${String(status)})` : `${code}: ${message}`;
}

export function createS3Driver(opts: S3DriverOptions): FileDriver {
  const { config, credentials } = opts;
  const doFetch = opts.fetchImpl ?? fetch;

  /**
   * AWS's own endpoints are derived from the region; everything else is
   * configured. `endpoint` is stored WITHOUT the bucket in it, so switching
   * between path-style and virtual-host style is a boolean, not a re-typed URL.
   */
  const origin = (config.endpoint ?? `https://s3.${config.region}.amazonaws.com`).replace(/\/+$/, '');

  function urlFor(key: string): string {
    if (!isSafeRemoteKey(key)) {
      throw new FileDriverError(`unsafe storage key: ${JSON.stringify(key)}`);
    }
    // Each segment encoded once, separators preserved — the signer canonicalises
    // the same way, and a mismatch here is a 403 with no explanation.
    const encodedKey = uriEncode(key, false);
    if (config.forcePathStyle) return `${origin}/${config.bucket}/${encodedKey}`;
    const url = new URL(origin);
    url.host = `${config.bucket}.${url.host}`;
    return `${url.origin}/${encodedKey}`;
  }

  async function send(
    method: string,
    key: string,
    init: { headers?: Record<string, string>; body?: BodyInit; payloadSha256: string; length?: number },
  ): Promise<Response> {
    const url = urlFor(key);
    const headers = signRequest(
      {
        method,
        url,
        headers: init.headers ?? {},
        payloadSha256: init.payloadSha256,
        region: config.region,
      },
      credentials,
    );
    // `host` is signed but may not be set on a fetch Request — undici derives
    // it from the URL and forbids overriding it. Removing it after signing is
    // correct: the value sent is byte-identical to the value signed.
    const { host: _host, ...sendable } = headers;
    return doFetch(url, {
      method,
      headers: sendable,
      ...(init.body === undefined ? {} : { body: init.body, duplex: 'half' }),
    } as RequestInit);
  }

  async function fail(response: Response, what: string): Promise<never> {
    const body = await response.text().catch(() => '');
    throw new FileDriverError(`${what}: ${describeS3Error(response.status, body)}`);
  }

  return {
    kind: 's3',

    keyFor(file: KeyRequest): string {
      return datedKey({ prefix: config.prefix, id: file.id, kind: file.kind, filename: file.filename, createdAt: file.createdAt });
    },

    async put(key: string, source: PutSource): Promise<void> {
      const response = await send('PUT', key, {
        headers: {
          'content-type': source.mime,
          'content-length': String(source.sizeBytes),
        },
        // An exact length + the real payload hash: see the header on why
        // neither may be omitted.
        body: Readable.toWeb(createReadStream(source.path)) as unknown as BodyInit,
        payloadSha256: source.sha256,
      });
      if (!response.ok) await fail(response, `PUT ${key}`);
      // Drain: undici keeps the connection out of the pool until the body is
      // consumed, and a PUT's response body is a few bytes of nothing.
      await response.arrayBuffer().catch(() => undefined);
    },

    async open(key: string, range?: ByteRange): Promise<OpenedBytes> {
      const headers: Record<string, string> =
        range === undefined
          ? {}
          : { range: `bytes=${String(range.start)}-${range.end === undefined ? '' : String(range.end)}` };
      const response = await send('GET', key, { headers, payloadSha256: EMPTY_SHA256 });
      if (response.status === 404) throw new FileNotFoundError(`no object stored under ${JSON.stringify(key)}`);
      if (!response.ok) await fail(response, `GET ${key}`);
      if (response.body === null) throw new FileDriverError(`GET ${key}: the response carried no body`);

      const contentRange = response.headers.get('content-range');
      const length = Number(response.headers.get('content-length') ?? '0');
      return {
        stream: Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
        sizeBytes: length,
        ...(contentRange === null ? {} : { contentRange }),
      };
    },

    async head(key: string): Promise<{ sizeBytes: number } | null> {
      const response = await send('HEAD', key, { payloadSha256: EMPTY_SHA256 });
      if (response.status === 404 || response.status === 403) {
        // 403 on HEAD is what a bucket without `s3:ListBucket` answers for a
        // missing key — indistinguishable from absent, and treating it as
        // "gone" is the only reading that lets a probe or a GC finish.
        return null;
      }
      if (!response.ok) await fail(response, `HEAD ${key}`);
      return { sizeBytes: Number(response.headers.get('content-length') ?? '0') };
    },

    async remove(key: string): Promise<void> {
      const response = await send('DELETE', key, { payloadSha256: EMPTY_SHA256 });
      // S3 answers 204 for a delete of a key that was never there. Idempotent
      // by the protocol, which is what the GC discipline already assumes.
      if (!response.ok && response.status !== 404) await fail(response, `DELETE ${key}`);
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
        const put = await send('PUT', key, {
          headers: { 'content-type': 'application/octet-stream', 'content-length': String(payload.byteLength) },
          body: payload,
          payloadSha256: createHash('sha256').update(payload).digest('hex'),
        });
        if (!put.ok) return { ok: false, error: describeS3Error(put.status, await put.text().catch(() => '')) };
        await put.arrayBuffer().catch(() => undefined);

        const get = await send('GET', key, { payloadSha256: EMPTY_SHA256 });
        if (!get.ok) return { ok: false, error: describeS3Error(get.status, await get.text().catch(() => '')) };
        const read = Buffer.from(await get.arrayBuffer());
        if (read.byteLength !== payload.byteLength) {
          return { ok: false, error: `probe wrote ${String(payload.byteLength)} bytes and read back ${String(read.byteLength)}` };
        }
        return { ok: true, latencyMs: Date.now() - started };
      } catch (error) {
        // A DNS failure, a refused connection or an expired TLS certificate all
        // arrive here; the operator needs the message, not a boolean.
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      } finally {
        await send('DELETE', key, { payloadSha256: EMPTY_SHA256 })
          .then((r) => r.arrayBuffer().catch(() => undefined))
          .catch(() => undefined);
      }
    },
  };
}
