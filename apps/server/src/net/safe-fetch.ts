// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A GET to an address this server did not choose.
 *
 * The Designer's picture search answers with addresses on other people's
 * hosts, and the npm registry is named by a project's own settings. A name
 * can resolve anywhere, and can resolve differently the second time it is
 * asked. So the name is resolved ONCE here, every address it gave is checked,
 * and the connection is made to the address that was checked (the name is
 * kept for the certificate and the Host header). A redirect is followed by
 * hand, a few times, and each step is resolved and checked again.
 *
 * https only, port 443 only, no credentials in the address, the body read
 * uncompressed up to a limit and no further.
 */
import { lookup as dnsLookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';

import { addressKind } from '../llm/outbound.js';

export class SafeFetchError extends Error {
  override readonly name = 'SafeFetchError';
  constructor(
    readonly reason: 'address' | 'blocked' | 'unresolved' | 'redirects' | 'too-large' | 'timeout' | 'status' | 'network',
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export interface SafeFetchOptions {
  /** The most bytes of body read; one more ends the request. */
  maxBytes: number;
  /** For the whole exchange, redirects included. */
  timeoutMs?: number;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  maxRedirects?: number;
  /** Test seams. */
  resolve?: (host: string) => Promise<{ address: string; family: 4 | 6 }[]>;
  connect?: (target: PinnedTarget, opts: { headers: Record<string, string>; signal: AbortSignal }) => Promise<RawResponse>;
}

export interface PinnedTarget {
  url: URL;
  /** The checked address the connection is made to. */
  address: string;
  family: 4 | 6;
}

export interface RawResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  /** The body, in pieces. */
  body: AsyncIterable<Buffer>;
  /** Drop the connection. */
  destroy(): void;
}

export interface SafeResponse {
  status: number;
  /** The address the answer came from, after redirects. */
  url: string;
  contentType: string;
  body: Buffer;
}

/** Whether an address is one on the open internet: not this machine, not its network, not a range set aside. */
export function isPublicAddress(raw: string): boolean {
  const address = raw.toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  if (addressKind(address) !== 'public') return false;
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number) as [number, number, number];
    if (a >= 224) return false; // multicast, reserved, broadcast
    if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return false; // protocol assignments, documentation
    if ((a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113)) return false; // documentation
    return true;
  }
  if (isIP(address) !== 6) return false;
  // An IPv4 address carried inside an IPv6 one is judged as the IPv4 address it is.
  const dotted = /^(?:::|64:ff9b::)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address);
  if (dotted !== null) return isPublicAddress(dotted[1] as string);
  if (/^64:ff9b:/.test(address) || /^2002:/.test(address) || /^2001:db8:/.test(address) || /^2001:0?:/.test(address)) return false; // NAT64, 6to4, documentation, Teredo
  if (/^ff/.test(address)) return false; // multicast
  if (/^::[0-9a-f]/.test(address)) return false; // IPv4-compatible, written in hex
  return true;
}

const defaultResolve = async (host: string): Promise<{ address: string; family: 4 | 6 }[]> =>
  (await dnsLookup(host, { all: true })).map((entry) => ({ address: entry.address, family: entry.family === 6 ? 6 : 4 }));

/** The address a URL is to be reached at, checked; throws when it may not be reached at all. */
export async function pin(rawUrl: string | URL, resolve: SafeFetchOptions['resolve'] = defaultResolve): Promise<PinnedTarget> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SafeFetchError('address', 'That is not an address.');
  }
  if (url.protocol !== 'https:') throw new SafeFetchError('address', 'Only https addresses are fetched.');
  if (url.port !== '' && url.port !== '443') throw new SafeFetchError('address', 'Only the standard https port is fetched.');
  if (url.username !== '' || url.password !== '') throw new SafeFetchError('address', 'An address with a name or password in it is not fetched.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  let found: { address: string; family: 4 | 6 }[];
  if (isIP(host) !== 0) {
    found = [{ address: host, family: isIP(host) === 6 ? 6 : 4 }];
  } else {
    try {
      found = await resolve(host);
    } catch {
      throw new SafeFetchError('unresolved', `${host} does not resolve.`);
    }
  }
  if (found.length === 0) throw new SafeFetchError('unresolved', `${host} does not resolve.`);
  // Every answer must be public: a name that gives one private address among public ones is not trusted for any.
  if (!found.every((entry) => isPublicAddress(entry.address))) throw new SafeFetchError('blocked', `${host} resolves to an address this server does not call.`);
  const first = found[0] as { address: string; family: 4 | 6 };
  return { url, address: first.address, family: first.family };
}

const defaultConnect: NonNullable<SafeFetchOptions['connect']> = (target, opts) =>
  new Promise<RawResponse>((resolve, reject) => {
    const host = target.url.hostname.replace(/^\[|\]$/g, '');
    const req = request(
      {
        protocol: 'https:',
        host,
        servername: isIP(host) === 0 ? host : undefined,
        port: 443,
        path: `${target.url.pathname}${target.url.search}`,
        method: 'GET',
        headers: opts.headers,
        signal: opts.signal,
        agent: false,
        // The connection goes to the address that was checked, whatever the name says now.
        lookup: (_name, options, callback) => {
          const done = callback as (error: Error | null, address: string | { address: string; family: number }[], family?: number) => void;
          if (typeof options === 'object' && options !== null && (options as { all?: boolean }).all === true) done(null, [{ address: target.address, family: target.family }]);
          else done(null, target.address, target.family);
        },
      },
      (res) => {
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: res as AsyncIterable<Buffer>, destroy: () => res.destroy() });
      },
    );
    req.on('error', reject);
    req.end();
  });

/**
 * GET `rawUrl`, to a checked and pinned address, following at most a few
 * redirects by hand. Throws `SafeFetchError`; a status of 400 or more is
 * thrown too, with the status.
 */
export async function safeFetch(rawUrl: string, opts: SafeFetchOptions): Promise<SafeResponse> {
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? 20_000);
  const signal = opts.signal === undefined ? timeout : AbortSignal.any([opts.signal, timeout]);
  const connect = opts.connect ?? defaultConnect;
  const maxRedirects = opts.maxRedirects ?? 3;
  let next = rawUrl;
  const firstOrigin = new URL(rawUrl).origin;
  try {
    for (let hop = 0; ; hop += 1) {
      const target = await pin(next, opts.resolve);
      // The caller's own headers (a key) go only to the origin the caller named: a redirect to another host carries none of them.
      const own = new URL(next).origin === firstOrigin ? (opts.headers ?? {}) : {};
      const response = await connect(target, {
        // Uncompressed: the limit is on what is read, and a small body that unpacks to a large one is not read at all.
        headers: { accept: '*/*', 'user-agent': 'Adminium (https://adminium.dev)', ...own, 'accept-encoding': 'identity' },
        signal,
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        response.destroy();
        const location = response.headers['location'];
        if (typeof location !== 'string' || hop >= maxRedirects) throw new SafeFetchError('redirects', 'The address redirects too many times, or nowhere.');
        next = new URL(location, target.url).toString();
        continue;
      }
      if (response.status < 200 || response.status >= 300) {
        response.destroy();
        throw new SafeFetchError('status', `The address answered ${String(response.status)}.`, response.status);
      }
      const declared = Number(response.headers['content-length']);
      if (Number.isFinite(declared) && declared > opts.maxBytes) {
        response.destroy();
        throw new SafeFetchError('too-large', 'The answer is larger than is taken.');
      }
      if (typeof response.headers['content-encoding'] === 'string' && response.headers['content-encoding'] !== 'identity') {
        response.destroy();
        throw new SafeFetchError('too-large', 'The answer came compressed, which was not asked for.');
      }
      const parts: Buffer[] = [];
      let size = 0;
      for await (const part of response.body) {
        size += part.length;
        if (size > opts.maxBytes) {
          response.destroy();
          throw new SafeFetchError('too-large', 'The answer is larger than is taken.');
        }
        parts.push(part);
      }
      const type = response.headers['content-type'];
      return { status: response.status, url: target.url.toString(), contentType: (Array.isArray(type) ? type[0] : type) ?? '', body: Buffer.concat(parts) };
    }
  } catch (error) {
    if (error instanceof SafeFetchError) throw error;
    if (opts.signal?.aborted === true) throw error;
    if (timeout.aborted) throw new SafeFetchError('timeout', 'The address took too long to answer.');
    throw new SafeFetchError('network', error instanceof Error ? error.message : String(error));
  }
}

/** What a picture's first bytes say it is; null when it is none this server takes. */
export function pictureTypeOf(bytes: Buffer): { ext: 'jpg' | 'png' | 'webp'; mime: string } | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: 'png', mime: 'image/png' };
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
  return null;
}
