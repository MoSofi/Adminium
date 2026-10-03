// SPDX-License-Identifier: AGPL-3.0-only
/**
 * D8's load-bearing proof: with the online catalog off, NO add-on code path
 * makes an outbound call (#2) — and with it on, exactly two first-party hosts
 * are reached, at addresses the server builds itself.
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
  DOWNLOAD_HOST,
  USER_AGENT,
  createCatalogClient,
  downloadUrlFor,
  type CatalogEntry,
} from '../src/add-ons/catalog.js';
import { APP_VERSION } from '../src/version.js';
import { APP_CATALOG_ENABLED_SETTING, createAppCatalogClient } from '../src/apps/catalog.js';
import { registerAddOnAcquireHandlers } from '../src/jobs/add-on-acquire.js';
import { MARKETPLACE_ENDPOINT, fetchBothLists } from '../src/marketplace/both-lists.js';

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
  minAdminiumVersion: '0.1.0',
};

/** ENTRY as the marketplace API sends it: an item around a release. */
function wireItem(item: Record<string, unknown> = {}, release: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'add-on',
    key: ENTRY.key,
    availability: 'installable',
    name: { en: 'Design Studio' },
    tagline: { en: 'A small in-browser artwork editor.' },
    author: { name: 'Adminium' },
    capabilities: [],
    art: { monogram: 'Ds' },
    links: { page: 'https://adminium.dev/marketplace/design-studio/' },
    lastUpdatedAt: '2026-09-15T00:00:00.000Z',
    file: { url: downloadUrlFor(ENTRY.key, ENTRY.version), size: 3, publishedAt: null },
    release: {
      version: ENTRY.version,
      integrity: ENTRY.integrity,
      categories: ENTRY.categories,
      capabilities: ENTRY.capabilities,
      connect: ENTRY.connect,
      provides: ENTRY.provides,
      attaches: ENTRY.attaches,
      network: ENTRY.network,
      minAdminiumVersion: ENTRY.minAdminiumVersion,
      ...release,
    },
    ...item,
  };
}

const shelf = (items: unknown[]) =>
  JSON.stringify({ format: 'adminium-marketplace/1', generatedAt: '2026-09-15T00:00:00Z', items });

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
  it('is on for a new install: the list is this server’s to ask for until someone switches it off (0.3.16)', async () => {
    const client = createCatalogClient({ meta, networkFeatures: true, fetchImpl: recordingFetch([]) });
    expect(await client.isEnabled()).toBe(true);
  });

  it('makes no call when the toggle is off (an install from before 0.3.16, or switched off)', async () => {
    await settingsRepo(meta).set(CATALOG_ENABLED_SETTING, false);
    const calls: string[] = [];
    const client = createCatalogClient({
      meta,
      networkFeatures: true,
      fetchImpl: recordingFetch(calls),
    });

    expect(await client.isEnabled()).toBe(false);
    await expect(client.fetchCatalog()).rejects.toMatchObject({ reason: 'CATALOG_DISABLED' });
    await expect(client.fetchTarball(ENTRY)).rejects.toMatchObject({ reason: 'CATALOG_DISABLED' });

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
    await expect(client.fetchTarball(ENTRY)).rejects.toMatchObject({
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
    await expect(client.fetchTarball(ENTRY)).rejects.toBeInstanceOf(AddOnCatalogError);
  });
});

describe('add-on catalog: on, it talks to exactly two hostnames', () => {
  beforeEach(async () => {
    await settingsRepo(meta).set(CATALOG_ENABLED_SETTING, true);
  });

  /** A client whose fetch records every URL and init, answering with `respond`. */
  function recording(respond: (url: string) => Response) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = createCatalogClient({
      meta,
      networkFeatures: true,
      fetchImpl: ((input: unknown, init: RequestInit) => {
        calls.push({ url: String(input), init });
        return Promise.resolve(respond(String(input)));
      }) as unknown as typeof globalThis.fetch,
    });
    return { client, calls };
  }

  it('fetches the shelf from the first-party constant only, naming its own version', async () => {
    const { client, calls } = recording(
      () => new Response(shelf([wireItem()]), { status: 200, headers: { 'content-type': 'application/json' } }),
    );

    const catalog = await client.fetchCatalog();
    expect(catalog.addOns[0]).toMatchObject({ key: 'design-studio', integrity: ENTRY.integrity, author: 'Adminium', monogram: 'Ds' });
    expect(calls.map((c) => c.url)).toEqual([`${CATALOG_ENDPOINT}?adminium=${APP_VERSION}`]);
    expect(CATALOG_ENDPOINT).toBe('https://adminium.dev/api/v1/marketplace/add-ons');
  });

  it('downloads from the one address it builds from the row: downloads host, key, exact version', async () => {
    const { client, calls } = recording(() => new Response(new Uint8Array([1, 2, 3]), { status: 200 }));

    const bytes = await client.fetchTarball(ENTRY);
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
    expect(calls.map((c) => c.url)).toEqual([
      'https://downloads.adminium.dev/add-ons/design-studio/design-studio-1.0.0.tgz',
    ]);
    expect(new URL(calls[0]!.url).hostname).toBe(DOWNLOAD_HOST);
    // Says what it is, rather than looking like an anonymous bot to the host's
    // bot protection.
    expect((calls[0]!.init.headers as Record<string, string>)['user-agent']).toBe(USER_AGENT);
    expect(USER_AGENT).toMatch(/^Adminium\/\d+\.\d+\.\d+/);
  });

  it('never resolves `latest`: the address names the exact version, and no index is consulted', async () => {
    const { client, calls } = recording(() => new Response(new Uint8Array([1]), { status: 200 }));
    await client.fetchTarball({ key: 'design-studio', version: '1.0.0-rc.1+build.5' });
    expect(calls.map((c) => c.url)).toEqual([
      'https://downloads.adminium.dev/add-ons/design-studio/design-studio-1.0.0-rc.1+build.5.tgz',
    ]);
    expect(calls.map((c) => c.url).join(' ')).not.toContain('latest');
  });

  it('refuses, before any request, an address a row could steer off its path', async () => {
    // A feed row cannot carry these (the schema refuses them, below). This
    // proves the client does not depend on that: the grammar check and the
    // built-path assertion in `downloadUrlFor` stand on their own.
    const { client, calls } = recording(() => new Response(new Uint8Array([1]), { status: 200 }));
    for (const row of [
      { key: '../etc', version: '1.0.0' },
      { key: 'design-studio', version: '1.0.0/../../evil' },
      { key: 'design-studio', version: '1.0.0?x=1' },
      { key: 'design-studio', version: '1.0.0#frag' },
      { key: 'design-studio', version: 'latest' },
      { key: 'Design-Studio', version: '1.0.0' },
      { key: 'design-studio@evil.example', version: '1.0.0' },
    ]) {
      await expect(client.fetchTarball(row), JSON.stringify(row)).rejects.toMatchObject({
        reason: 'DOWNLOAD_ADDRESS_MISMATCH',
      });
    }
    expect(calls).toEqual([]);
  });

  it('builds the download address as a pure function of key and version', () => {
    expect(downloadUrlFor('shipping-dhl', '1.0.0')).toBe(
      'https://downloads.adminium.dev/add-ons/shipping-dhl/shipping-dhl-1.0.0.tgz',
    );
    expect(() => downloadUrlFor('shipping-dhl', '1.0.0/..')).toThrow(AddOnCatalogError);
  });

  it('names a missing file on the download host as its own refusal', async () => {
    // The catalog offering a version the download host does not serve is a
    // publishing fault, and it must not read as a network blip.
    const { client } = recording(() => new Response('not found', { status: 404 }));
    await expect(client.fetchTarball(ENTRY)).rejects.toMatchObject({ reason: 'TARBALL_NOT_FOUND' });
  });

  it('reports any other failure status as unreachable', async () => {
    const { client } = recording(() => new Response('<html>challenge</html>', { status: 403 }));
    await expect(client.fetchTarball(ENTRY)).rejects.toMatchObject({ reason: 'TARBALL_UNREACHABLE' });
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

  it('applies the same transport rules to the download', async () => {
    const inits: RequestInit[] = [];
    const client = clientRecording(
      inits,
      () =>
        new Response(null, {
          status: 301,
          headers: { location: 'https://cdn.evil.example/x.tgz' },
        }),
    );
    await expect(client.fetchTarball(ENTRY)).rejects.toMatchObject({ reason: 'REDIRECTED' });
    expect(inits[0]?.redirect).toBe('manual');
    expect(inits[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('caps the download body while streaming it', async () => {
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
        return Promise.resolve(new Response(body, { status: 200 }));
      }) as unknown as typeof globalThis.fetch,
    });
    await expect(client.fetchTarball(ENTRY)).rejects.toMatchObject({ reason: 'RESPONSE_TOO_LARGE' });
  });
});

describe('add-on catalog: the shelf defers monetization by construction', () => {
  beforeEach(async () => {
    await settingsRepo(meta).set(CATALOG_ENABLED_SETTING, true);
  });

  /** The catalog a client makes of one shelf document. */
  async function read(body: string) {
    const client = createCatalogClient({
      meta,
      networkFeatures: true,
      fetchImpl: (() => Promise.resolve(new Response(body, { status: 200 }))) as unknown as typeof globalThis.fetch,
    });
    return client.fetchCatalog();
  }

  it('refuses a release carrying a price, tier, or licence-key field — that item only', async () => {
    for (const extra of [{ price: 0 }, { priceMonthly: '9.99' }, { tier: 'pro' }, { licenseKey: 'x' }, { availableFrom: '2027-01-01' }]) {
      const catalog = await read(shelf([wireItem({}, extra), wireItem({ key: 'other-add-on' })]));
      expect(catalog.addOns.map((row) => row.key), `expected ${JSON.stringify(extra)} to be refused`).toEqual(['other-add-on']);
      expect(catalog.skipped.map((item) => item.key)).toEqual(['design-studio']);
    }
  });

  it('drops a price on the item: no row carries one', async () => {
    const catalog = await read(shelf([wireItem({ pricing: { kind: 'one-time', amount: 49, currency: 'EUR' } })]));
    expect(catalog.addOns).toHaveLength(1);
    expect(JSON.stringify(catalog)).not.toContain('pricing');
  });

  it('refuses a document in any earlier format', async () => {
    // Released servers keep reading the feed they were built against, at its
    // own address; reading one here would mean inventing what it lacks.
    for (const schemaVersion of [1, 2, 3]) {
      await expect(read(JSON.stringify({ schemaVersion, generatedAt: '2026-09-15T00:00:00Z', addOns: [ENTRY] }))).rejects.toMatchObject({
        reason: 'CATALOG_MALFORMED',
      });
    }
  });

  it('never takes a download address from the shelf', async () => {
    // Inside the release, a place to download from refuses the item.
    for (const extra of [{ npmPackage: '@adminiumjs/add-on-design-studio' }, { url: 'https://evil.example/design-studio.tgz' }, { tarball: 'https://evil.example/x.tgz' }]) {
      const catalog = await read(shelf([wireItem({}, extra)]));
      expect(catalog.addOns, `expected ${JSON.stringify(extra)} to be refused`).toEqual([]);
    }
    // The item's `file.url` is display only, and is not kept.
    const catalog = await read(shelf([wireItem({ file: { url: 'https://evil.example/x.tgz', size: 3, publishedAt: null } })]));
    expect(JSON.stringify(catalog)).not.toContain('evil.example');
  });

  it('refuses a floating version in a release (D9)', async () => {
    for (const version of ['latest', '^1.0.0', '1.x', '*']) {
      const catalog = await read(shelf([wireItem({}, { version })]));
      expect(catalog.addOns, `expected ${version} to be refused`).toEqual([]);
    }
  });

  it('refuses a key or version that could move the download address', async () => {
    for (const [item, release] of [
      [{ key: '../etc' }, {}],
      [{ key: 'design-studio/../x' }, {}],
      [{}, { version: '1.0.0/../../evil' }],
      [{}, { version: '1.0.0?x=1' }],
    ] as const) {
      const catalog = await read(shelf([wireItem(item, release)]));
      expect(catalog.addOns, `expected ${JSON.stringify({ ...item, ...release })} to be refused`).toEqual([]);
    }
  });
});


// ─── Both lists in one request (plan 65, D103) ───────────────────────────────

describe('both lists in one request: only when both are on', () => {
  const answering = (calls: string[], body: unknown): typeof globalThis.fetch =>
    ((input: unknown) => {
      calls.push(String(input));
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
    }) as unknown as typeof globalThis.fetch;
  const clients = (networkFeatures: boolean, fetchImpl: typeof globalThis.fetch) => ({
    addOns: createCatalogClient({ meta, networkFeatures, fetchImpl }),
    apps: createAppCatalogClient({ meta, networkFeatures, fetchImpl }),
    fetchImpl,
  });
  const BOTH = { format: 'adminium-marketplace/1', generatedAt: '2026-10-03T00:00:00Z', apps: [], addOns: [wireItem()] };

  it('makes one request, to the combined address with this server’s version, and reads each list as its own address is read', async () => {
    const calls: string[] = [];
    const lists = await fetchBothLists(clients(true, answering(calls, BOTH)));
    expect(calls).toEqual([`${MARKETPLACE_ENDPOINT}?adminium=${APP_VERSION}`]);
    expect(lists.addOns.addOns.map((entry) => entry.key)).toEqual([ENTRY.key]);
    expect(lists.apps.apps).toEqual([]);
    expect(lists.addOns.generatedAt).toBe(BOTH.generatedAt);
    // An item this server cannot read is left out of its list; the rest is still offered.
    const odd = await fetchBothLists(clients(true, answering([], { ...BOTH, addOns: [wireItem(), wireItem({ key: 'priced' }, { price: 9 })] })));
    expect(odd.addOns.addOns.map((entry) => entry.key)).toEqual([ENTRY.key]);
    expect(odd.addOns.skipped.map((entry) => entry.key)).toEqual(['priced']);
  });

  it('asks for nothing when either list is off, or network features are', async () => {
    for (const off of [CATALOG_ENABLED_SETTING, APP_CATALOG_ENABLED_SETTING] as const) {
      await settingsRepo(meta).set(CATALOG_ENABLED_SETTING, true);
      await settingsRepo(meta).set(APP_CATALOG_ENABLED_SETTING, true);
      await settingsRepo(meta).set(off, false);
      const calls: string[] = [];
      await expect(fetchBothLists(clients(true, recordingFetch(calls)))).rejects.toMatchObject({ reason: 'CATALOG_DISABLED' });
      expect(calls, off).toEqual([]);
    }
    await settingsRepo(meta).set(APP_CATALOG_ENABLED_SETTING, true);
    await settingsRepo(meta).set(CATALOG_ENABLED_SETTING, true);
    const calls: string[] = [];
    await expect(fetchBothLists(clients(false, recordingFetch(calls)))).rejects.toMatchObject({ reason: 'CATALOG_DISABLED' });
    expect(calls).toEqual([]);
    expect(guard.attempts).toEqual([]);
  });

  it('refuses an answer that is not the two lists', async () => {
    for (const body of [{ format: 'adminium-marketplace/1', generatedAt: 'x', items: [] }, { format: 'other/9', generatedAt: 'x', apps: [], addOns: [] }, 'nonsense']) {
      await expect(fetchBothLists(clients(true, answering([], body)))).rejects.toMatchObject({ reason: 'CATALOG_MALFORMED' });
    }
  });

  it('the refresh nobody asked for by hand fills both caches from one request; a person’s refresh, or a list off, asks for the add-ons alone', async () => {
    type Handler = (payload: { userId?: string }, ctx: { signal: AbortSignal; jobId: string; progress: () => void }) => Promise<unknown>;
    const handlers = new Map<string, Handler>();
    const registry = { registerJobHandler: (kind: string, _schema: unknown, handler: Handler) => void handlers.set(kind, handler) };
    const written: Record<'addOns' | 'apps', unknown[]> = { addOns: [], apps: [] };
    const calls: string[] = [];
    const fetchImpl = ((input: unknown) => {
      calls.push(String(input));
      const combined = String(input).startsWith(`${MARKETPLACE_ENDPOINT}?`);
      const body = combined ? BOTH : { format: 'adminium-marketplace/1', generatedAt: BOTH.generatedAt, items: [wireItem()] };
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    }) as unknown as typeof globalThis.fetch;
    const { addOns, apps } = clients(true, fetchImpl);
    registerAddOnAcquireHandlers(registry as never, {
      meta,
      store: { writeCatalogCache: async (document: unknown) => void written.addOns.push(document) } as never,
      catalog: addOns,
      both: { apps, appStore: { writeCatalogCache: async (document: unknown) => void written.apps.push(document) }, fetchImpl },
    });
    const run = (payload: { userId?: string }) => (handlers.get('catalog-refresh') as Handler)(payload, { signal: new AbortController().signal, jobId: 'job_x', progress: () => undefined });

    // The server starting, the daily tick: both lists, one request.
    await run({});
    expect(calls).toEqual([`${MARKETPLACE_ENDPOINT}?adminium=${APP_VERSION}`]);
    expect([written.addOns.length, written.apps.length]).toEqual([1, 1]);

    // "Check for newer" on the Add-ons page: its own list.
    calls.length = 0;
    await run({ userId: 'usr_1' });
    expect(calls).toEqual([`${CATALOG_ENDPOINT}?adminium=${APP_VERSION}`]);
    expect([written.addOns.length, written.apps.length]).toEqual([2, 1]);

    // The app list switched off: it is never asked for, and never written.
    await settingsRepo(meta).set(APP_CATALOG_ENABLED_SETTING, false);
    calls.length = 0;
    await run({});
    expect(calls).toEqual([`${CATALOG_ENDPOINT}?adminium=${APP_VERSION}`]);
    expect([written.addOns.length, written.apps.length]).toEqual([3, 1]);
  });
});
