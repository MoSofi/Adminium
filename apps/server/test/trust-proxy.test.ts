// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `ADMINIUM_TRUST_PROXY`, as the Fastify an npm install resolves applies it
 * (08-server-api.md §7 item 5; `security/trust-proxy.ts`).
 *
 * THE BUG THIS PINS. `app.ts` passed `trustProxy: 1`, a hop count. Fastify
 * 5.12.1 (GHSA-3m5p-2c4r-xxw2) made a numeric `trustProxy` trust NOBODY, and
 * every fresh `npm install` got that Fastify while this repo's lockfile still
 * held 5.12.0. The suite passed; installs behind Caddy recorded the proxy as
 * every client, set the session cookie without `Secure`, and put everyone
 * behind the proxy in one login bucket. On 5.12.0 the same `1` failed the other
 * way: a client that reached the port directly could set every forwarded
 * header. These cases fail on both. The trusted-proxy ones fail on >= 5.12.1
 * with a hop count, and the direct-client ones fail on 5.12.0.
 *
 * The existing "rotating X-Forwarded-For" cases in `rate-limit.test.ts` could
 * not catch this: a server that trusts nobody keys every request on the proxy's
 * address, and that bucket fills just the same.
 *
 * `inject()` connects from 127.0.0.1 unless `remoteAddress` says otherwise.
 * That is where a Caddy or nginx on the same host connects from.
 */
import { auditRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { buildServer, type AdminiumServer } from '../src/app.js';
import { ADMIN_EMAIL, ADMIN_PASSWORD, buildAuthApp, type AuthTestApp } from './auth-helpers.js';
import { makeEnv, REQUEST_ID_PATTERN } from './helpers.js';

interface Seen {
  ip: string;
  protocol: string;
  host: string;
}

let app: AdminiumServer | undefined;
let fixture: AuthTestApp | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
  await fixture?.destroy();
  fixture = undefined;
});

/** A server with one extra route that reports what Fastify made of the request. */
async function probeServer(overrides: Record<string, string>): Promise<AdminiumServer> {
  app = await buildServer({ env: makeEnv(overrides), logger: false });
  app.get('/trust-probe', async (request) => ({
    ip: request.ip,
    protocol: request.protocol,
    host: request.host,
  }));
  await app.ready();
  return app;
}

async function probe(
  server: AdminiumServer,
  opts: { remoteAddress?: string; headers?: Record<string, string> } = {},
): Promise<Seen> {
  const res = await server.inject({
    method: 'GET',
    url: '/trust-probe',
    headers: { host: 'admin.example.com', ...opts.headers },
    ...(opts.remoteAddress === undefined ? {} : { remoteAddress: opts.remoteAddress }),
  });
  expect(res.statusCode).toBe(200);
  return res.json<Seen>();
}

/** What a reverse proxy adds for a client at 192.168.5.15 over HTTPS. */
const FORWARDED = {
  'x-forwarded-for': '192.168.5.15',
  'x-forwarded-proto': 'https',
  'x-forwarded-host': 'admin.example.com',
} as const;

const ON = { ADMINIUM_TRUST_PROXY: 'on' } as const;

describe('behind a trusted proxy', () => {
  it('reads the client address and the scheme a same-host proxy forwards', async () => {
    const server = await probeServer(ON);

    expect(await probe(server, { headers: FORWARDED })).toEqual({
      ip: '192.168.5.15',
      protocol: 'https',
      host: 'admin.example.com',
    });
  });

  it.each([
    ['IPv6 loopback', '::1'],
    ['IPv4 loopback on a dual-stack socket', '::ffff:127.0.0.1'],
    ['another loopback address', '127.0.0.53'],
    ['a Docker network (the documented caddy service)', '172.18.0.3'],
    ['a 10/8 private network', '10.0.0.5'],
    ['an IPv6 unique-local network', 'fd00::5'],
  ])('trusts a proxy on %s by default (%s)', async (_label, remoteAddress) => {
    const server = await probeServer(ON);

    const seen = await probe(server, { remoteAddress, headers: FORWARDED });

    expect(seen.ip).toBe('192.168.5.15');
    expect(seen.protocol).toBe('https');
  });

  it('takes the entry the proxy appended, never one the client wrote', async () => {
    // nginx's `$proxy_add_x_forwarded_for` APPENDS the peer it saw to whatever
    // the client sent. Here the client (192.168.5.15, a private address) wrote
    // 10.0.0.9 itself. Fastify's string form trusts every listed address along
    // the chain, so it would skip 192.168.5.15 as one more proxy and report
    // 10.0.0.9. Only the proxy's own entry counts.
    const server = await probeServer(ON);

    const seen = await probe(server, {
      headers: { ...FORWARDED, 'x-forwarded-for': '10.0.0.9, 192.168.5.15' },
    });

    expect(seen.ip).toBe('192.168.5.15');
  });

  it('keeps the socket address when the proxy forwards none', async () => {
    const server = await probeServer(ON);

    expect(await probe(server, { remoteAddress: '172.18.0.3' })).toEqual({
      ip: '172.18.0.3',
      protocol: 'http',
      host: 'admin.example.com',
    });
  });

  it('honors the proxy’s x-request-id', async () => {
    const server = await probeServer(ON);

    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/healthz',
      remoteAddress: '172.18.0.3',
      headers: { 'x-request-id': 'req_deadbeef' },
    });

    expect(res.headers['x-request-id']).toBe('req_deadbeef');
  });
});

describe('a connection that is not a trusted proxy', () => {
  it('cannot set any forwarded header by connecting directly', async () => {
    // GHSA-3m5p-2c4r-xxw2 itself. With a hop count, whoever opened the socket
    // was the "first hop", so this request picked its own address, scheme and
    // host.
    const server = await probeServer(ON);

    const seen = await probe(server, {
      remoteAddress: '203.0.113.7',
      headers: {
        'x-forwarded-for': '127.0.0.1',
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'evil.example',
      },
    });

    expect(seen).toEqual({ ip: '203.0.113.7', protocol: 'http', host: 'admin.example.com' });
  });

  it('cannot choose its own request id', async () => {
    const server = await probeServer(ON);

    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/healthz',
      remoteAddress: '203.0.113.7',
      headers: { 'x-request-id': 'req_deadbeef' },
    });

    expect(res.headers['x-request-id']).toMatch(REQUEST_ID_PATTERN);
    expect(res.headers['x-request-id']).not.toBe('req_deadbeef');
  });

  it('is every connection while the flag is off, loopback included', async () => {
    const server = await probeServer({});

    expect(await probe(server, { headers: FORWARDED })).toEqual({
      ip: '127.0.0.1',
      protocol: 'http',
      host: 'admin.example.com',
    });
  });
});

describe('ADMINIUM_TRUSTED_PROXIES', () => {
  it('replaces the default: narrowed to loopback, a Docker peer is a client', async () => {
    const server = await probeServer({ ...ON, ADMINIUM_TRUSTED_PROXIES: 'loopback' });

    expect((await probe(server, { headers: FORWARDED })).ip).toBe('192.168.5.15');
    const docker = await probe(server, { remoteAddress: '172.18.0.3', headers: FORWARDED });
    expect(docker).toEqual({ ip: '172.18.0.3', protocol: 'http', host: 'admin.example.com' });
  });

  it('replaces the default: a named subnet is trusted, and loopback no longer is', async () => {
    const server = await probeServer({ ...ON, ADMINIUM_TRUSTED_PROXIES: '203.0.113.0/24' });

    const proxied = await probe(server, { remoteAddress: '203.0.113.7', headers: FORWARDED });
    expect(proxied.ip).toBe('192.168.5.15');
    expect(proxied.protocol).toBe('https');

    expect((await probe(server, { headers: FORWARDED })).ip).toBe('127.0.0.1');
  });

  it('does not let a short IPv4-mapped prefix trust every IPv4 client', async () => {
    // GHSA-jqcg-44mw-7w3h: @fastify/proxy-addr before 5.1.1 compiled
    // `::ffff:10.0.0.0/8` with all-zero leading bits, so it matched EVERY IPv4
    // address. This is the lockfile floor's test as much as the code's.
    const server = await probeServer({ ...ON, ADMINIUM_TRUSTED_PROXIES: '::ffff:10.0.0.0/8' });

    const seen = await probe(server, { remoteAddress: '203.0.113.7', headers: FORWARDED });

    expect(seen.ip).toBe('203.0.113.7');
  });
});

describe('what the operator sees', () => {
  function signIn(headers: Record<string, string>, remoteAddress?: string) {
    return fixture!.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
      headers,
      ...(remoteAddress === undefined ? {} : { remoteAddress }),
    });
  }

  /** The session cookie's attributes, e.g. `['HttpOnly', 'Secure', 'SameSite=Lax', …]`. */
  function sessionCookieAttributes(setCookie: string | string[] | undefined): string[] {
    const all = setCookie === undefined ? [] : Array.isArray(setCookie) ? setCookie : [setCookie];
    const session = all.find((cookie) => cookie.startsWith('adminium_session='));
    expect(session, 'expected an adminium_session set-cookie').toBeDefined();
    return (session ?? '').split(';').slice(1).map((part) => part.trim());
  }

  async function lastLoginIp(): Promise<string | null | undefined> {
    const rows = await auditRepo(fixture!.meta).list({ category: 'auth', limit: 10 });
    return rows.find((row) => row.action === 'login')?.ip;
  }

  it('a sign-in through the proxy gets a Secure cookie and is audited with the client address', async () => {
    fixture = await buildAuthApp({ env: makeEnv(ON) });

    const res = await signIn(FORWARDED);

    expect(res.statusCode).toBe(200);
    expect(sessionCookieAttributes(res.headers['set-cookie'])).toContain('Secure');
    expect(await lastLoginIp()).toBe('192.168.5.15');
  });

  it('a direct sign-in with forged headers gets neither', async () => {
    fixture = await buildAuthApp({ env: makeEnv(ON) });

    const res = await signIn(
      { 'x-forwarded-for': '10.9.8.7', 'x-forwarded-proto': 'https' },
      '203.0.113.7',
    );

    expect(res.statusCode).toBe(200);
    const attributes = sessionCookieAttributes(res.headers['set-cookie']);
    expect(attributes).toContain('HttpOnly');
    expect(attributes).not.toContain('Secure');
    expect(await lastLoginIp()).toBe('203.0.113.7');
  });

  it('two users behind the same proxy do not share a login bucket', async () => {
    fixture = await buildAuthApp({ env: makeEnv(ON) });
    const wrong = (client: string) =>
      fixture!.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: ADMIN_EMAIL, password: 'not-the-password' },
        headers: { 'x-forwarded-for': client, 'x-forwarded-proto': 'https' },
      });

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      expect((await wrong('192.168.5.15')).statusCode, `attempt ${String(attempt)}`).toBe(401);
    }
    expect((await wrong('192.168.5.15')).statusCode).toBe(429);

    // Same proxy, different person. Keyed on the proxy, this is a 429 too.
    expect((await wrong('192.168.5.16')).statusCode).toBe(401);
  });
});
