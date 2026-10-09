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
 * It does what the model requests need and no more: a method, headers, a
 * text body, a signal; the answer as a `Response` whose body streams. A
 * redirect is handed back as it is, never followed. The body is asked for
 * uncompressed.
 */
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';

export interface PinnedAddress {
  address: string;
  family: 4 | 6;
}

/** Statuses that carry no body: a `Response` refuses one for them. */
const NO_BODY = new Set([204, 205, 304]);

/**
 * `pins`: every address the name gave when it was checked, in the order it gave them. The connection tries them as
 * the platform would have (a name that is both `::1` and `127.0.0.1` reaches a server listening on either), and
 * never anything else.
 */
export function pinnedFetch(pins: readonly PinnedAddress[]): typeof fetch {
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
      const body = typeof init?.body === 'string' ? init.body : null;
      if (init?.body !== undefined && init.body !== null && body === null) {
        reject(new TypeError('Only a text body is sent.'));
        return;
      }
      if (body !== null) headers['content-length'] = String(Buffer.byteLength(body));
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
          agent: false,
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
      req.end(body ?? undefined);
    });
}
