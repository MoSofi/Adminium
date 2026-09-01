// SPDX-License-Identifier: AGPL-3.0-only
/**
 * D8's load-bearing proof: with the online catalog off, NO add-on code path
 * makes an outbound call (32-add-on-distribution.md D8, §7 acceptance #2).
 *
 * Mirrors `telemetry-network-isolation.test.ts` deliberately, down to the
 * recording thrower: ALL outbound network (fetch + node net/http/https) is
 * replaced with functions that RECORD the attempt and then throw. A recorder
 * rather than a mere "it didn't throw" check is required for the same reason it
 * is there — a client that catches its own fetch failures would otherwise turn
 * "off means off" into "off means we tried and swallowed the error", and the
 * assertion would not notice.
 *
 * The two off-switches are tested SEPARATELY because they are independent
 * vetoes with different owners: `ADMINIUM_NETWORK_FEATURES` belongs to whoever
 * controls the process environment, `addOns.catalogEnabled` to whoever
 * administers the instance. Either alone must be sufficient.
 *
 * The meta store is better-sqlite3 (`:memory:` — a native handle, no sockets),
 * so disabling the network cannot disturb the harness itself.
 */

import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

import BetterSqlite3 from 'better-sqlite3';
import { createSqliteMetaDb, firstRun, settingsRepo, type MetaDb } from '@adminium/meta';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  AddOnCatalogError,
  CATALOG_ENABLED_SETTING,
  CATALOG_ENDPOINT,
  REGISTRY_HOST,
  catalogSchema,
  createCatalogClient,
  type CatalogEntry,
} from '../src/add-ons/catalog.js';

// ─── Network kill-switch (mirrors telemetry-network-isolation.test.ts) ──────────

interface NetGuard {
  attempts: string[];
  restore: () => void;
}

function describeTarget(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  if (arg instanceof URL) return arg.href;
  if (arg !== null && typeof arg === 'object') {
    const req = arg as { url?: unknown; host?: unknown; hostname?: unknown };
    if (typeof req.url === 'string') return req.url;
    const host = req.hostname ?? req.host;
    if (typeof host === 'string') return host;
  }
  return '<unknown>';
}

function disableNetwork(): NetGuard {
  const attempts: string[] = [];
  const thrower =
    (label: string) =>
    (...args: unknown[]): never => {
      const target = describeTarget(args[0]);
      attempts.push(`${label} → ${target}`);
      throw new Error(`network disabled (add-on catalog opt-in): blocked ${label} to ${target}`);
    };

  const g = globalThis as { fetch: typeof globalThis.fetch };
  const originalFetch = g.fetch;
  const netMod = net as unknown as Record<string, unknown>;
  const httpMod = http as unknown as Record<string, unknown>;
  const httpsMod = https as unknown as Record<string, unknown>;
  const originals = {
    connect: netMod['connect'],
    createConnection: netMod['createConnection'],
    socketConnect: net.Socket.prototype.connect,
    httpRequest: httpMod['request'],
    httpsRequest: httpsMod['request'],
  };

  g.fetch = thrower('fetch') as unknown as typeof globalThis.fetch;
  netMod['connect'] = thrower('net.connect');
  netMod['createConnection'] = thrower('net.createConnection');
  (net.Socket.prototype as unknown as { connect: unknown }).connect = thrower('socket.connect');
  httpMod['request'] = thrower('http.request');
  httpsMod['request'] = thrower('https.request');

  return {
    attempts,
    restore: () => {
      g.fetch = originalFetch;
      netMod['connect'] = originals.connect;
      netMod['createConnection'] = originals.createConnection;
      (net.Socket.prototype as unknown as { connect: unknown }).connect = originals.socketConnect;
      httpMod['request'] = originals.httpRequest;
      httpsMod['request'] = originals.httpsRequest;
    },
  };
}

// ─── Harness ───────────────────────────────────────────────────────────────────

const ENTRY: CatalogEntry = {
  key: 'design-studio',
  npmPackage: '@adminiumjs/add-on-design-studio',
  version: '1.0.0',
  integrity: 'sha512-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ+/==',
  provides: [],
  attaches: [{ app: 'printing', range: '^1.0.0' }],
  categories: ['design'],
  capabilities: [],
  connect: { kind: 'none' },
  network: { allow: [] },
  name: { en_US: 'Design Studio' },
  tagline: { en_US: 'A small in-browser artwork editor.' },
};

let meta: MetaDb;
let guard: NetGuard;

beforeEach(async () => {
  meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
  guard = disableNetwork();
});

afterEach(() => {
  guard.restore();
});

/** A fetch that records every call it is handed. Never reached when off. */
function recordingFetch(calls: string[]): typeof globalThis.fetch {
  return ((input: unknown) => {
    calls.push(String(input));
    return Promise.reject(new Error('should not be called'));
  }) as unknown as typeof globalThis.fetch;
}

describe('add-on catalog: off means zero outbound attempts', () => {
  it('makes no call when the toggle is off (its default)', async () => {
    const calls: string[] = [];
    const client = createCatalogClient({
      meta,
      networkFeatures: true,
      fetchImpl: recordingFetch(calls),
    });

    expect(await client.isEnabled()).toBe(false);
    await expect(client.fetchCatalog()).rejects.toMatchObject({ reason: 'CATALOG_DISABLED' });
    await expect(client.pinRelease(ENTRY)).rejects.toMatchObject({ reason: 'CATALOG_DISABLED' });
    await expect(
      client.fetchTarball({
        key: ENTRY.key,
        npmPackage: ENTRY.npmPackage,
        version: ENTRY.version,
        integrity: ENTRY.integrity,
        tarballUrl: `https://${REGISTRY_HOST}/x/-/x-1.0.0.tgz`,
      }),
    ).rejects.toMatchObject({ reason: 'CATALOG_DISABLED' });

    expect(calls).toEqual([]);
    expect(guard.attempts).toEqual([]);
  });

  it('makes no call when ADMINIUM_NETWORK_FEATURES is off, even with the toggle ON', async () => {
    // The environment outranks the stored answer, the way it already does for
    // telemetry: an operator who set the flag to off gets a real veto.
    await settingsRepo(meta).set(CATALOG_ENABLED_SETTING, true);

    const calls: string[] = [];
    const client = createCatalogClient({
      meta,
      networkFeatures: false,
      fetchImpl: recordingFetch(calls),
    });

    expect(await client.isEnabled()).toBe(false);
    await expect(client.fetchCatalog()).rejects.toMatchObject({ reason: 'NETWORK_FEATURES_OFF' });
    await expect(client.pinRelease(ENTRY)).rejects.toMatchObject({
      reason: 'NETWORK_FEATURES_OFF',
    });

    expect(calls).toEqual([]);
    expect(guard.attempts).toEqual([]);
  });

  it('refuses before a URL is even constructed', async () => {
    // Not a style point: if the gate ran after the request was built, a future
    // refactor that moved the check one line down would open a hole that the
    // "no calls" assertion above could still pass by accident (a built-but-
    // unsent URL records nothing). This asserts the ORDER directly.
    const client = createCatalogClient({
      meta,
      networkFeatures: true,
      endpoint: 'https://never.example/catalog.json',
      fetchImpl: (() => {
        throw new Error('fetch must not be constructed');
      }) as unknown as typeof globalThis.fetch,
    });
    await expect(client.fetchCatalog()).rejects.toBeInstanceOf(AddOnCatalogError);
  });
});

describe('add-on catalog: on, it talks to exactly two hostnames', () => {
  beforeEach(async () => {
    await settingsRepo(meta).set(CATALOG_ENABLED_SETTING, true);
  });

  it('fetches the feed from the first-party constant only', async () => {
    const calls: string[] = [];
    const client = createCatalogClient({
      meta,
      networkFeatures: true,
      fetchImpl: ((input: unknown) => {
        calls.push(String(input));
        return Promise.resolve(
          new Response(
            JSON.stringify({ schemaVersion: 1, generatedAt: '2026-08-29T00:00:00Z', addOns: [ENTRY] }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );
      }) as unknown as typeof globalThis.fetch,
    });

    const catalog = await client.fetchCatalog();
    expect(catalog.addOns[0]?.key).toBe('design-studio');
    expect(calls).toEqual([CATALOG_ENDPOINT]);
    expect(new URL(calls[0]!).hostname).toBe('adminium.dev');
  });

  it('refuses a tarball URL that points anywhere but the registry host', async () => {
    const client = createCatalogClient({
      meta,
      networkFeatures: true,
      fetchImpl: (() =>
        Promise.resolve(new Response('', { status: 200 }))) as unknown as typeof globalThis.fetch,
    });

    for (const url of [
      'https://evil.example/x-1.0.0.tgz',
      'http://registry.npmjs.org/x-1.0.0.tgz', // plain http
      'https://registry.npmjs.org.evil.example/x.tgz', // suffix trick
      'https://objects.githubusercontent.com/x.tgz',
    ]) {
      await expect(
        client.fetchTarball({
          key: 'x',
          npmPackage: '@adminiumjs/add-on-x',
          version: '1.0.0',
          integrity: 'sha512-x',
          tarballUrl: url,
        }),
      ).rejects.toMatchObject({ reason: 'FOREIGN_TARBALL_HOST' });
    }
  });

  it('refuses when the registry and the release ledger disagree (D7)', async () => {
    const client = createCatalogClient({
      meta,
      networkFeatures: true,
      fetchImpl: (() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              versions: {
                '1.0.0': {
                  dist: {
                    tarball: `https://${REGISTRY_HOST}/@adminiumjs/add-on-design-studio/-/x-1.0.0.tgz`,
                    integrity: 'sha512-SOMETHINGELSEENTIRELY==',
                  },
                },
              },
            }),
            { status: 200 },
          ),
        )) as unknown as typeof globalThis.fetch,
    });

    await expect(client.pinRelease(ENTRY)).rejects.toMatchObject({ reason: 'LEDGER_MISMATCH' });
  });

  it('refuses a version the registry does not actually serve (18 D4)', async () => {
    const client = createCatalogClient({
      meta,
      networkFeatures: true,
      fetchImpl: (() =>
        Promise.resolve(
          new Response(JSON.stringify({ versions: { '0.9.0': { dist: { tarball: 'https://x/y' } } } }), {
            status: 200,
          }),
        )) as unknown as typeof globalThis.fetch,
    });

    await expect(client.pinRelease(ENTRY)).rejects.toMatchObject({
      reason: 'VERSION_NOT_PUBLISHED',
    });
  });

  it('pins the exact version and never resolves a dist-tag (D9)', async () => {
    const calls: string[] = [];
    const tarball = `https://${REGISTRY_HOST}/@adminiumjs/add-on-design-studio/-/add-on-design-studio-1.0.0.tgz`;
    const client = createCatalogClient({
      meta,
      networkFeatures: true,
      fetchImpl: ((input: unknown) => {
        calls.push(String(input));
        return Promise.resolve(
          new Response(
            JSON.stringify({
              versions: {
                '1.0.0': { dist: { tarball, integrity: ENTRY.integrity } },
                '2.0.0': { dist: { tarball: 'https://x/newer', integrity: 'sha512-newer' } },
              },
              'dist-tags': { latest: '2.0.0' },
            }),
            { status: 200 },
          ),
        );
      }) as unknown as typeof globalThis.fetch,
    });

    const pinned = await client.pinRelease(ENTRY);
    expect(pinned.version).toBe('1.0.0');
    expect(pinned.integrity).toBe(ENTRY.integrity);
    expect(pinned.tarballUrl).toBe(tarball);
    // The word `latest` never appears in a URL this client builds.
    expect(calls.join(' ')).not.toContain('latest');
  });
});

describe('add-on catalog: the transport itself is bounded', () => {
  beforeEach(async () => {
    await settingsRepo(meta).set(CATALOG_ENABLED_SETTING, true);
  });

  /** A client whose fetch records the init it was called with. */
  function clientRecording(inits: RequestInit[], respond: () => Response) {
    return createCatalogClient({
      meta,
      networkFeatures: true,
      fetchImpl: ((_input: unknown, init: RequestInit) => {
        inits.push(init);
        return Promise.resolve(respond());
      }) as unknown as typeof globalThis.fetch,
    });
  }

  it('never follows a redirect, so the two-hostname guarantee is not on paper', async () => {
    // Without `redirect: 'manual'` this is THE hole in exact-hostname egress:
    // the host check necessarily runs before the request, so a 302 out of
    // registry.npmjs.org would be followed silently to anywhere.
    const inits: RequestInit[] = [];
    const client = clientRecording(
      inits,
      () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://evil.example/catalog.json' },
        }),
    );

    await expect(client.fetchCatalog()).rejects.toMatchObject({ reason: 'REDIRECTED' });
    expect(inits[0]?.redirect).toBe('manual');
  });

  it('treats an opaque redirect (status 0) as a redirect too', async () => {
    // Hand-rolled rather than `new Response(null, { status: 0 })`, which the
    // spec forbids the constructor from producing — but which `fetch` itself
    // yields for an opaque-redirect filtered response under `redirect:
    // 'manual'` in some runtimes. That is exactly the case worth pinning: a
    // status of 0 reads as falsy-not-ok and must not fall through to a generic
    // "unreachable", or the redirect would look like a network blip.
    const opaque = {
      status: 0,
      ok: false,
      headers: { get: () => null },
      body: null,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    } as unknown as Response;

    const client = createCatalogClient({
      meta,
      networkFeatures: true,
      fetchImpl: (() => Promise.resolve(opaque)) as unknown as typeof globalThis.fetch,
    });
    await expect(client.fetchCatalog()).rejects.toMatchObject({ reason: 'REDIRECTED' });
  });

  it('refuses an over-cap body before reading it, on the declared length', async () => {
    const client = clientRecording(
      [],
      () =>
        new Response('{}', {
          status: 200,
          headers: { 'content-length': String(64 * 1024 * 1024) },
        }),
    );
    await expect(client.fetchCatalog()).rejects.toMatchObject({ reason: 'RESPONSE_TOO_LARGE' });
  });

  it('refuses a body that LIES about its length, while streaming it', async () => {
    // content-length says 2; the stream keeps going. The cap has to be enforced
    // on the bytes actually received, not on what the server claimed.
    const client = createCatalogClient({
      meta,
      networkFeatures: true,
      fetchImpl: (() => {
        const chunk = new Uint8Array(1024 * 1024);
        let sent = 0;
        const body = new ReadableStream<Uint8Array>({
          pull(controller) {
            sent += 1;
            if (sent > 64) controller.close();
            else controller.enqueue(chunk);
          },
        });
        return Promise.resolve(
          new Response(body, { status: 200, headers: { 'content-length': '2' } }),
        );
      }) as unknown as typeof globalThis.fetch,
    });

    await expect(client.fetchCatalog()).rejects.toMatchObject({ reason: 'RESPONSE_TOO_LARGE' });
  });

  it('carries a wall-clock budget on every request', async () => {
    const inits: RequestInit[] = [];
    const client = clientRecording(inits, () => new Response('{}', { status: 200 }));
    await client.fetchCatalog().catch(() => undefined);
    expect(inits[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('applies the same transport rules to the tarball', async () => {
    const inits: RequestInit[] = [];
    const client = clientRecording(
      inits,
      () =>
        new Response(null, {
          status: 301,
          headers: { location: 'https://cdn.evil.example/x.tgz' },
        }),
    );
    await expect(
      client.fetchTarball({
        key: 'design-studio',
        npmPackage: '@adminiumjs/add-on-design-studio',
        version: '1.0.0',
        integrity: ENTRY.integrity,
        tarballUrl: `https://${REGISTRY_HOST}/x/-/x-1.0.0.tgz`,
      }),
    ).rejects.toMatchObject({ reason: 'REDIRECTED' });
    expect(inits[0]?.redirect).toBe('manual');
  });
});

describe('add-on catalog: the feed schema defers monetization by construction', () => {
  it('refuses a feed carrying a price, tier, or licence-key field (17 §2)', () => {
    const base = { schemaVersion: 1, generatedAt: '2026-08-29T00:00:00Z' };
    for (const extra of [
      { price: 0 },
      { priceMonthly: '9.99' },
      { tier: 'pro' },
      { licenseKey: 'x' },
      { availableFrom: '2027-01-01' },
    ]) {
      const feed = { ...base, addOns: [{ ...ENTRY, ...extra }] };
      const parsed = catalogSchema.safeParse(feed);
      expect(parsed.success, `expected ${JSON.stringify(extra)} to be refused`).toBe(false);
    }
  });

  it('accepts the exact documented entry shape', () => {
    const parsed = catalogSchema.safeParse({
      schemaVersion: 1,
      generatedAt: '2026-08-29T00:00:00Z',
      addOns: [ENTRY],
    });
    expect(parsed.success).toBe(true);
  });

  it('refuses a feed entry whose npmPackage does not match its key', () => {
    // The attack this closes: whoever serves the feed chooses which npm package
    // a download fetches, and the D7 ledger cross-check does NOT cover it —
    // the same attacker supplies both the package name and the `integrity` it
    // is compared against, so naming a hostile package with that package's real
    // hash passes the cross-check intact. Binding the name to the key is what
    // stops it.
    for (const npmPackage of [
      'evil-package',
      '@evil/add-on-design-studio',
      '@adminiumjs/add-on-something-else',
      '@adminiumjs/manifest',
      'add-on-design-studio',
    ]) {
      const parsed = catalogSchema.safeParse({
        schemaVersion: 1,
        generatedAt: '2026-08-29T00:00:00Z',
        addOns: [{ ...ENTRY, npmPackage }],
      });
      expect(parsed.success, `expected ${npmPackage} to be refused`).toBe(false);
    }
  });

  it('refuses a floating version in the feed (D9)', () => {
    for (const version of ['latest', '^1.0.0', '1.x', '*']) {
      const parsed = catalogSchema.safeParse({
        schemaVersion: 1,
        generatedAt: '2026-08-29T00:00:00Z',
        addOns: [{ ...ENTRY, version }],
      });
      expect(parsed.success, `expected ${version} to be refused`).toBe(false);
    }
  });
});
