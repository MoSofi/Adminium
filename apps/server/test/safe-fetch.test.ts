// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The fetch that calls an address this server did not choose.
 *
 * A name is resolved once and the connection is made to the address that was
 * checked, so a name that answers differently the second time (rebinding)
 * cannot move the call. Each test below is a way in that must stay shut.
 */
import { describe, expect, it } from 'vitest';

import { isPublicAddress, pictureTypeOf, pin, safeFetch, SafeFetchError, type PinnedTarget, type RawResponse } from '../src/net/safe-fetch.js';

const one = (address: string) => async () => [{ address, family: address.includes(':') ? (6 as const) : (4 as const) }];
async function* chunks(...parts: Buffer[]): AsyncIterable<Buffer> {
  for (const part of parts) yield part;
}
const reply = (status: number, headers: Record<string, string>, ...parts: Buffer[]): RawResponse => ({ status, headers, body: chunks(...parts), destroy: () => undefined });
const reason = async (work: Promise<unknown>): Promise<string> => {
  try {
    await work;
    return 'no error';
  } catch (error) {
    return error instanceof SafeFetchError ? error.reason : `other: ${String(error)}`;
  }
};

describe('an address on the open internet', () => {
  it('is none of this machine, its network, or a range set aside', () => {
    for (const address of ['8.8.8.8', '151.101.1.69', '2606:4700::1111', '2a00:1450:4001:81b::200e']) expect(isPublicAddress(address), address).toBe(true);
    for (const address of [
      '127.0.0.1', '0.0.0.0', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '100.64.0.1', '169.254.169.254',
      '198.18.0.1', '198.19.255.255', '192.0.0.8', '192.0.2.1', '198.51.100.7', '203.0.113.9', '224.0.0.1', '240.0.0.1', '255.255.255.255',
      '::1', '::', 'fe80::1', 'fd00::1', 'fc00::1', 'fd00:ec2::254', 'ff02::1',
      '::ffff:10.0.0.1', '::ffff:7f00:1', '64:ff9b::10.0.0.1', '64:ff9b::a00:1', '::10.0.0.1', '::a00:1', '2002:a00:1::', '2001:db8::1', '2001:0:4136:e378::1',
      'not-an-address',
    ]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
  });
});

describe('pinning', () => {
  it('takes https on the standard port only, with no name or password in the address', async () => {
    expect(await reason(pin('http://example.com/a', one('8.8.8.8')))).toBe('address');
    expect(await reason(pin('https://example.com:8443/a', one('8.8.8.8')))).toBe('address');
    expect(await reason(pin('https://user:pass@example.com/a', one('8.8.8.8')))).toBe('address');
    expect(await reason(pin('ftp://example.com/a', one('8.8.8.8')))).toBe('address');
    expect(await reason(pin('not a url', one('8.8.8.8')))).toBe('address');
    expect((await pin('https://example.com:443/a?b=1', one('8.8.8.8'))).address).toBe('8.8.8.8');
  });

  it('refuses a name when ANY address it gives is not public, and an address written as one', async () => {
    const mixed = async () => [{ address: '8.8.8.8', family: 4 as const }, { address: '10.0.0.5', family: 4 as const }];
    expect(await reason(pin('https://example.com/', mixed))).toBe('blocked');
    expect(await reason(pin('https://169.254.169.254/latest/meta-data', one('8.8.8.8')))).toBe('blocked');
    expect(await reason(pin('https://[::1]/', one('8.8.8.8')))).toBe('blocked');
    expect(await reason(pin('https://example.com/', async () => []))).toBe('unresolved');
    expect(await reason(pin('https://example.com/', async () => Promise.reject(new Error('nx'))))).toBe('unresolved');
  });
});

describe('fetching', () => {
  it('connects to the address that was checked, however the name resolves the second time', async () => {
    let asked = 0;
    // The first answer is public; a second lookup would give this machine. There is no second lookup.
    const resolve = async () => {
      asked += 1;
      return [{ address: asked === 1 ? '8.8.8.8' : '127.0.0.1', family: 4 as const }];
    };
    const connected: PinnedTarget[] = [];
    const done = await safeFetch('https://example.com/pic.jpg', {
      maxBytes: 100,
      resolve,
      connect: async (target, opts) => {
        connected.push(target);
        // Nothing compressed is asked for: the limit is on what is read.
        expect(opts.headers['accept-encoding']).toBe('identity');
        return reply(200, { 'content-type': 'image/jpeg' }, Buffer.from('abc'));
      },
    });
    expect(asked).toBe(1);
    expect(connected.map((target) => target.address)).toEqual(['8.8.8.8']);
    expect(done).toMatchObject({ status: 200, contentType: 'image/jpeg', url: 'https://example.com/pic.jpg' });
    expect(done.body.toString()).toBe('abc');
  });

  it('sends the caller’s own headers (a key) to the origin the caller named, and to no host a redirect names', async () => {
    const resolve = async () => [{ address: '8.8.8.8', family: 4 as const }];
    const sent: { url: string; authorization: unknown }[] = [];
    const body = await safeFetch('https://api.example/search', {
      maxBytes: 10,
      resolve,
      headers: { authorization: 'Client-ID KEY-9', accept: 'application/json' },
      connect: async (target, opts) => {
        sent.push({ url: target.url.href, authorization: (opts.headers as Record<string, unknown>)['authorization'] });
        if (target.url.href === 'https://api.example/search') return reply(302, { location: '/moved' });
        if (target.url.href === 'https://api.example/moved') return reply(302, { location: 'https://elsewhere.example/collect' });
        return reply(200, {}, Buffer.from('ok'));
      },
    });
    expect(body.body.toString()).toBe('ok');
    expect(sent).toEqual([
      { url: 'https://api.example/search', authorization: 'Client-ID KEY-9' },
      // The same origin again: the key goes with it.
      { url: 'https://api.example/moved', authorization: 'Client-ID KEY-9' },
      // Another host: nothing of the caller's.
      { url: 'https://elsewhere.example/collect', authorization: undefined },
    ]);
  });

  it('follows a redirect by hand, a few times, and checks each step again', async () => {
    const hosts: Record<string, string> = { 'a.example': '8.8.8.8', 'b.example': '8.8.4.4', 'inside.example': '10.0.0.9' };
    const resolve = async (host: string) => [{ address: hosts[host] ?? '8.8.8.8', family: 4 as const }];
    const to = (location: string) => async (): Promise<RawResponse> => reply(302, { location });
    const seen: string[] = [];
    const ok = await safeFetch('https://a.example/x', {
      maxBytes: 10,
      resolve,
      connect: async (target) => {
        seen.push(target.url.host);
        return target.url.host === 'a.example' ? reply(302, { location: 'https://b.example/y' }) : reply(200, {}, Buffer.from('ok'));
      },
    });
    expect(seen).toEqual(['a.example', 'b.example']);
    expect(ok.url).toBe('https://b.example/y');
    // To this server's own network, to plain http, in a loop: each refused.
    expect(await reason(safeFetch('https://a.example/x', { maxBytes: 10, resolve, connect: to('https://inside.example/') }))).toBe('blocked');
    expect(await reason(safeFetch('https://a.example/x', { maxBytes: 10, resolve, connect: to('http://b.example/') }))).toBe('address');
    expect(await reason(safeFetch('https://a.example/x', { maxBytes: 10, resolve, connect: to('https://a.example/x') }))).toBe('redirects');
    expect(await reason(safeFetch('https://a.example/x', { maxBytes: 10, resolve, connect: async () => reply(302, {}) }))).toBe('redirects');
  });

  it('reads no more than it was told to, whatever the answer says of its own size, and takes nothing compressed', async () => {
    const resolve = one('8.8.8.8');
    const big = Buffer.alloc(60, 1);
    expect(await reason(safeFetch('https://a.example/', { maxBytes: 100, resolve, connect: async () => reply(200, { 'content-length': '5000' }) }))).toBe('too-large');
    // It says 10 and sends 120: stopped while reading.
    expect(await reason(safeFetch('https://a.example/', { maxBytes: 100, resolve, connect: async () => reply(200, { 'content-length': '10' }, big, big) }))).toBe('too-large');
    expect(await reason(safeFetch('https://a.example/', { maxBytes: 100, resolve, connect: async () => reply(200, { 'content-encoding': 'gzip' }, Buffer.from('x')) }))).toBe('too-large');
    expect(await reason(safeFetch('https://a.example/', { maxBytes: 100, resolve, connect: async () => reply(404, {}) }))).toBe('status');
    expect(await reason(safeFetch('https://a.example/', { maxBytes: 100, resolve, connect: async () => Promise.reject(new Error('socket hang up')) }))).toBe('network');
  });

  it('gives up after its time', async () => {
    const never = (): Promise<RawResponse> => new Promise(() => undefined);
    const hanging = async (_target: PinnedTarget, opts: { signal: AbortSignal }): Promise<RawResponse> =>
      new Promise((_, reject) => {
        opts.signal.addEventListener('abort', () => reject(new Error('aborted')));
        void never;
      });
    expect(await reason(safeFetch('https://a.example/', { maxBytes: 10, timeoutMs: 30, resolve: one('8.8.8.8'), connect: hanging }))).toBe('timeout');
  });
});

describe('a picture’s first bytes', () => {
  it('say what it is, whatever its name or its declared type said', () => {
    expect(pictureTypeOf(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toEqual({ ext: 'jpg', mime: 'image/jpeg' });
    expect(pictureTypeOf(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toEqual({ ext: 'png', mime: 'image/png' });
    expect(pictureTypeOf(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]))).toEqual({ ext: 'webp', mime: 'image/webp' });
    for (const not of ['<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>', 'GIF89a', '<!doctype html>', '%PDF-1.7', '']) expect(pictureTypeOf(Buffer.from(not)), not).toBeNull();
  });
});
