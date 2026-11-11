// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A `fetch` that connects to one address, whatever the name in the URL says
 * when it is asked again.
 *
 * A model's address is a name somebody typed. It is resolved and checked
 * before it is used (`llm/outbound.ts`); this makes the request that follows
 * go to the address that was checked. The name is kept for the Host header
 * and for the certificate, so the far end sees nothing different.
 *
 * It does what the model, webhook and storage requests need and no more: a
 * method (WebDAV's own included), headers, a body (text, bytes or a stream:
 * a storage upload streams a file with its exact length declared), a signal;
 * the answer as a `Response` whose body streams. A redirect is handed back as
 * it is, never followed. The body is asked for uncompressed.
 */
import { request as httpRequest, type Agent as HttpAgent } from 'node:http';
import { request as httpsRequest, type Agent as HttpsAgent } from 'node:https';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';

export interface PinnedAddress {
  address: string;
  family: 4 | 6;
}

/** Statuses that carry no body: a `Response` refuses one for them. */
const NO_BODY = new Set([204, 205, 304]);

export interface PinnedFetchOptions {
  /**
   * Keep connections open between requests: an agent made for THESE pins only (the agent pools sockets by host and
   * port, not by address, so an agent shared between two pin sets could hand one set's socket to the other). Without
   * one, every request opens its own connection and closes it.
   */
  agent?: HttpAgent | HttpsAgent | undefined;
}

/**
 * `pins`: every address the name gave when it was checked, in the order it gave them. The connection tries them as
 * the platform would have (a name that is both `::1` and `127.0.0.1` reaches a server listening on either), and
 * never anything else.
 */
export function pinnedFetch(pins: readonly PinnedAddress[], opts: PinnedFetchOptions = {}): typeof fetch {
  const [pin] = pins;
  if (pin === undefined) throw new TypeError('A pinned fetch needs an address.');
  return (input, init) =>
    new Promise<Response>((resolve, reject) => {
      let url: URL;
      try {
        url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      } catch (error) {
        reject(error instanceof Error ? error : new TypeError('That is not an address.'));
        return;
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        reject(new TypeError('Only http and https addresses are called.'));
        return;
      }
      const headers: Record<string, string> = {};
      new Headers(init?.headers).forEach((value, name) => {
        headers[name] = value;
      });
      headers['accept-encoding'] = 'identity';
      const body = requestBody(init?.body);
      if (body === undefined) {
        reject(new TypeError('Only a text, bytes or stream body is sent.'));
        return;
      }
      // A stream's length is the caller's to declare (a storage PUT always does); bytes are counted here.
      if ((typeof body === 'string' || Buffer.isBuffer(body)) && headers['content-length'] === undefined) headers['content-length'] = String(Buffer.byteLength(body));
      const host = url.hostname.replace(/^\[|\]$/g, '');
      const secure = url.protocol === 'https:';
      const method = (init?.method ?? 'GET').toUpperCase();
      const req = (secure ? httpsRequest : httpRequest)(
        {
          protocol: url.protocol,
          host,
          ...(secure && isIP(host) === 0 ? { servername: host } : {}),
          port: url.port === '' ? (secure ? 443 : 80) : Number(url.port),
          path: `${url.pathname}${url.search}`,
          method,
          headers,
          ...(init?.signal === undefined || init.signal === null ? {} : { signal: init.signal }),
          agent: opts.agent ?? false,
          // The connection goes to the address that was checked, whatever the name says now.
          lookup: (_name, options, callback) => {
            const done = callback as (error: Error | null, address: string | { address: string; family: number }[], family?: number) => void;
            if (typeof options === 'object' && options !== null && (options as { all?: boolean }).all === true) done(null, pins.map((entry) => ({ address: entry.address, family: entry.family })));
            else done(null, pin.address, pin.family);
          },
        },
        (res) => {
          const status = res.statusCode ?? 0;
          const answered = new Headers();
          for (const [name, value] of Object.entries(res.headers)) {
            for (const one of Array.isArray(value) ? value : value === undefined ? [] : [value]) answered.append(name, one);
          }
          if (status < 200 || status > 599) {
            res.destroy();
            reject(new TypeError(`The address answered a status that is no answer (${String(status)}).`));
            return;
          }
          if (NO_BODY.has(status) || method === 'HEAD') {
            res.resume();
            resolve(new Response(null, { status, statusText: res.statusMessage ?? '', headers: answered }));
            return;
          }
          resolve(new Response(Readable.toWeb(res) as ReadableStream<Uint8Array>, { status, statusText: res.statusMessage ?? '', headers: answered }));
        },
      );
      req.on('error', reject);
      if (body instanceof Readable) {
        body.on('error', (error) => req.destroy(error));
        body.pipe(req);
      } else {
        req.end(body ?? undefined);
      }
    });
}

/** The body as `http.request` sends it; null for none, undefined for one this does not send. */
function requestBody(body: RequestInit['body'] | undefined): string | Buffer | Readable | null | undefined {
  if (body === undefined || body === null) return null;
  if (typeof body === 'string') return body;
  if (body instanceof Uint8Array) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (body instanceof ReadableStream) return Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]);
  if ((body as unknown) instanceof Readable) return body as unknown as Readable;
  return undefined;
}
