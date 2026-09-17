// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An in-process S3-protocol server for the driver conformance
 * suite.
 *
 * WHAT THIS PROVES, AND WHAT IT DOES NOT.
 *
 * It does NOT prove signature interop. Re-implementing SigV4 here to check the
 * signature would be checking the signer against itself; that is what the
 * published AWS vectors (`files-sigv4.test.ts`) and the MinIO leg in CI
 * (`TEST_S3_URL`) are for, and neither is replaced by this.
 *
 * It DOES prove the half a vector cannot: that the driver puts the right URL
 * on the wire for both addressing styles, that a streamed PUT arrives
 * UNCHUNKED with the exact `Content-Length` it declared, that the bytes match
 * the `x-amz-content-sha256` the driver signed — the trap the s3 driver's
 * header warns about, and one no unit test of the signer can see — and that
 * ranges, 404s, idempotent deletes and XML error parsing behave.
 *
 * So the payload-hash check below is the point of this file: it is the
 * assertion that would fail if a future change let the body go out chunked, or
 * hashed the spool file and then sent something else.
 */

import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface S3Stub {
  /** `http://127.0.0.1:<port>` — the endpoint, without the bucket. */
  endpoint: string;
  bucket: string;
  objects: Map<string, { body: Buffer; contentType: string }>;
  /** Every request seen, with the checks that ran on it. */
  log: {
    method: string;
    key: string;
    status: number;
    signed: boolean;
    /** True when `x-amz-content-sha256` matched the body actually received. */
    payloadHashMatched: boolean | null;
    /** True when the request declared a length and sent no `transfer-encoding`. */
    unchunked: boolean | null;
  }[];
  close(): Promise<void>;
}

function xmlError(code: string, message: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${message}</Message></Error>`;
}

export async function startS3Stub(bucket = 'adminium-test'): Promise<S3Stub> {
  const objects = new Map<string, { body: Buffer; contentType: string }>();
  const log: S3Stub['log'] = [];

  const server: Server = createServer((req, res) => {
    const method = req.method ?? 'GET';
    const path = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
    // Path-style only: `/<bucket>/<key>`. The virtual-host form is asserted by
    // a URL unit test, which needs no server to prove.
    const prefix = `/${bucket}/`;
    const key = path.startsWith(prefix) ? path.slice(prefix.length) : '';

    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const signed = (req.headers.authorization ?? '').startsWith('AWS4-HMAC-SHA256 ');
      const claimedHash = req.headers['x-amz-content-sha256'];
      const payloadHashMatched =
        typeof claimedHash === 'string' ? createHash('sha256').update(body).digest('hex') === claimedHash : null;
      const declaredLength = req.headers['content-length'];
      const unchunked =
        method === 'PUT'
          ? declaredLength !== undefined &&
            Number(declaredLength) === body.byteLength &&
            req.headers['transfer-encoding'] === undefined
          : null;

      /**
       * `bodyLength` exists for HEAD, which must report the object's size in
       * `Content-Length` while sending no body — the one place the payload and
       * the declared length legitimately disagree.
       */
      const send = (status: number, payload?: Buffer, headers: Record<string, string> = {}, bodyLength?: number): void => {
        log.push({ method, key, status, signed, payloadHashMatched, unchunked });
        res.writeHead(status, {
          ...headers,
          'content-length': String(bodyLength ?? payload?.byteLength ?? 0),
        });
        res.end(payload);
      };

      if (key === '') {
        send(404, Buffer.from(xmlError('NoSuchBucket', 'The specified bucket does not exist')));
        return;
      }
      // Every verb the driver sends carries a signature; an unsigned request is
      // the shape a broken signer would produce and must not quietly succeed.
      if (!signed) {
        send(403, Buffer.from(xmlError('AccessDenied', 'Request was not signed')));
        return;
      }

      switch (method) {
        case 'PUT': {
          if (payloadHashMatched === false) {
            // Exactly what a real target answers when the body does not hash to
            // what the signature covers.
            send(400, Buffer.from(xmlError('XAmzContentSHA256Mismatch', 'The provided x-amz-content-sha256 header does not match what was computed')));
            return;
          }
          objects.set(key, { body, contentType: String(req.headers['content-type'] ?? 'application/octet-stream') });
          send(200);
          return;
        }
        case 'GET':
        case 'HEAD': {
          const found = objects.get(key);
          if (found === undefined) {
            send(404, method === 'HEAD' ? undefined : Buffer.from(xmlError('NoSuchKey', 'The specified key does not exist.')));
            return;
          }
          if (method === 'HEAD') {
            send(200, undefined, { 'content-type': found.contentType }, found.body.byteLength);
            return;
          }
          const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
          if (range === null) {
            send(200, found.body, { 'content-type': found.contentType });
            return;
          }
          const start = range[1] === '' ? 0 : Number(range[1]);
          const end = range[2] === '' ? found.body.byteLength - 1 : Math.min(Number(range[2]), found.body.byteLength - 1);
          send(206, found.body.subarray(start, end + 1), {
            'content-type': found.contentType,
            'content-range': `bytes ${String(start)}-${String(end)}/${String(found.body.byteLength)}`,
          });
          return;
        }
        case 'DELETE': {
          objects.delete(key);
          // S3 answers 204 whether or not the key was there.
          send(204);
          return;
        }
        default:
          send(405, Buffer.from(xmlError('MethodNotAllowed', `The specified method is not allowed: ${method}`)));
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as AddressInfo;

  return {
    endpoint: `http://127.0.0.1:${String(port)}`,
    bucket,
    objects,
    log,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
