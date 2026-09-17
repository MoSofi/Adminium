// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The app catalog's version of D8's proof (b G8-D3/D4): with its switch off,
 * NO app catalog code path makes an outbound call, and with it on, exactly
 * two first-party addresses are reached — the app feed and the downloads
 * host's `/apps/` folder.
 *
 * Mirrors `add-on-network-isolation.test.ts`, recording thrower included: ALL
 * outbound network (fetch + node net/http/https) records the attempt and then
 * throws, so a client that swallowed its own fetch failure could not pass
 * "off means off" by accident.
 *
 * Three independent vetoes are tested separately: `ADMINIUM_NETWORK_FEATURES`
 * (the process environment's), `apps.catalogEnabled` (the instance admin's),
 * and — because R2 made the two catalogs separate switches — the ADD-ON switch,
 * which must not turn the app catalog on.
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
  DOWNLOAD_HOST,
  USER_AGENT,
} from '../src/add-ons/catalog.js';
import {
  APP_CATALOG_ENABLED_SETTING,
  APP_CATALOG_ENDPOINT,
  appCatalogSchema,
  appDownloadUrlFor,
  createAppCatalogClient,
  meetsMinimum,
  type AppCatalogEntry,
} from '../src/apps/catalog.js';

// ─── Network kill-switch (mirrors add-on-network-isolation.test.ts) ─────────────

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
      throw new Error(`network disabled (app catalog opt-in): blocked ${label} to ${target}`);
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

/** A row in the exact shape the website's `v2/apps.json` emits (G8.1). */
const ENTRY: AppCatalogEntry = {
  key: 'clinic',
  version: '0.1.2',
  integrity: 'sha512-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ+/==',
  name: { en: 'Clinic Desk', fr: 'Clinic Desk' },
  tagline: { en: 'Appointments for small practices.', fr: 'Rendez-vous pour petits cabinets.' },
  categories: ['health'],
  capabilities: ['email-delivery'],
  publisher: 'Adminium',
  sides: ['staff', 'customer'],
  minAdminiumVersion: '0.2.8',
};

const FEED = { schemaVersion: 2, generatedAt: '2026-09-16T00:00:00Z', apps: [ENTRY] };

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

describe('app catalog: off means zero outbound attempts', () => {
  it('makes no call when its switch is off (the default)', async () => {
    const calls: string[] = [];
    const client = createAppCatalogClient({ meta, networkFeatures: true, fetchImpl: recordingFetch(calls) });

    expect(await client.isEnabled()).toBe(false);
    await expect(client.fetchCatalog()).rejects.toMatchObject({ reason: 'CATALOG_DISABLED' });
    await expect(client.fetchTarball(ENTRY)).rejects.toMatchObject({ reason: 'CATALOG_DISABLED' });

    expect(calls).toEqual([]);
    expect(guard.attempts).toEqual([]);
  });

  it('makes no call when ADMINIUM_NETWORK_FEATURES is off, even with the switch ON', async () => {
    await settingsRepo(meta).set(APP_CATALOG_ENABLED_SETTING, true);
    const calls: string[] = [];
    const client = createAppCatalogClient({ meta, networkFeatures: false, fetchImpl: recordingFetch(calls) });

    expect(await client.isEnabled()).toBe(false);
    expect(client.networkFeaturesAllowed()).toBe(false);
    await expect(client.fetchCatalog()).rejects.toMatchObject({ reason: 'NETWORK_FEATURES_OFF' });
    await expect(client.fetchTarball(ENTRY)).rejects.toMatchObject({ reason: 'NETWORK_FEATURES_OFF' });

    expect(calls).toEqual([]);
    expect(guard.attempts).toEqual([]);
  });

  it('is not switched on by the ADD-ON catalog switch (R2: two switches)', async () => {
    await settingsRepo(meta).set(CATALOG_ENABLED_SETTING, true);
    const calls: string[] = [];
    const client = createAppCatalogClient({ meta, networkFeatures: true, fetchImpl: recordingFetch(calls) });

    expect(await client.isEnabled()).toBe(false);
    await expect(client.fetchCatalog()).rejects.toMatchObject({ reason: 'CATALOG_DISABLED' });
    expect(calls).toEqual([]);
    expect(guard.attempts).toEqual([]);
  });

  it('refuses before a URL is even constructed', async () => {
    const client = createAppCatalogClient({
      meta,
      networkFeatures: true,
      endpoint: 'https://never.example/apps.json',
      fetchImpl: (() => {
        throw new Error('fetch must not be constructed');
      }) as unknown as typeof globalThis.fetch,
    });
    await expect(client.fetchCatalog()).rejects.toBeInstanceOf(AddOnCatalogError);
    await expect(client.fetchTarball(ENTRY)).rejects.toBeInstanceOf(AddOnCatalogError);
  });
});

describe('app catalog: on, it reaches exactly two first-party addresses', () => {
  beforeEach(async () => {
    await settingsRepo(meta).set(APP_CATALOG_ENABLED_SETTING, true);
  });

  function recording(respond: (url: string) => Response) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = createAppCatalogClient({
      meta,
      networkFeatures: true,
      fetchImpl: ((input: unknown, init: RequestInit) => {
        calls.push({ url: String(input), init });
        return Promise.resolve(respond(String(input)));
      }) as unknown as typeof globalThis.fetch,
    });
    return { client, calls };
  }

  it('reads the app feed from its own constant, never the add-on feed', async () => {
    const { client, calls } = recording(
      () => new Response(JSON.stringify(FEED), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    const catalog = await client.fetchCatalog();
    expect(catalog.apps.map((a) => a.key)).toEqual(['clinic']);
    expect(calls.map((c) => c.url)).toEqual([APP_CATALOG_ENDPOINT]);
    expect(APP_CATALOG_ENDPOINT).toBe('https://adminium.dev/marketplace/v2/apps.json');
    expect((calls[0]!.init.headers as Record<string, string>)['user-agent']).toBe(USER_AGENT);
  });

  it('downloads from the /apps/ folder at the address it builds from key and exact version', async () => {
    const { client, calls } = recording(() => new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    const bytes = await client.fetchTarball(ENTRY);
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
    expect(calls.map((c) => c.url)).toEqual(['https://downloads.adminium.dev/apps/clinic/clinic-0.1.2.tgz']);
    expect(new URL(calls[0]!.url).hostname).toBe(DOWNLOAD_HOST);
    expect(calls[0]!.init.redirect).toBe('manual');
    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
  });

  it('refuses, before any request, an address a row could steer off its path', async () => {
    const { client, calls } = recording(() => new Response(new Uint8Array([1]), { status: 200 }));
    for (const row of [
      { key: '../etc', version: '0.1.2' },
      { key: 'clinic', version: '0.1.2/../../add-ons/x' },
      { key: 'clinic', version: '0.1.2?x=1' },
      { key: 'clinic', version: 'latest' },
      { key: 'Clinic', version: '0.1.2' },
    ]) {
      await expect(client.fetchTarball(row), JSON.stringify(row)).rejects.toMatchObject({
        reason: 'DOWNLOAD_ADDRESS_MISMATCH',
      });
    }
    expect(calls).toEqual([]);
    expect(appDownloadUrlFor('hotel', '0.1.1')).toBe('https://downloads.adminium.dev/apps/hotel/hotel-0.1.1.tgz');
  });

  it('refuses a redirect on either leg, without following it', async () => {
    const { client } = recording(
      () => new Response(null, { status: 302, headers: { location: 'https://evil.example/x' } }),
    );
    await expect(client.fetchCatalog()).rejects.toMatchObject({ reason: 'REDIRECTED' });
    await expect(client.fetchTarball(ENTRY)).rejects.toMatchObject({ reason: 'REDIRECTED' });
  });

  it('names a missing release file as its own refusal', async () => {
    const { client } = recording(() => new Response('not found', { status: 404 }));
    await expect(client.fetchTarball(ENTRY)).rejects.toMatchObject({ reason: 'TARBALL_NOT_FOUND' });
  });

  it('caps the download while streaming it', async () => {
    const client = createAppCatalogClient({
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

  it('refuses a feed that does not parse as the app feed', async () => {
    for (const body of [
      { ...FEED, schemaVersion: 1 },
      { schemaVersion: 2, generatedAt: FEED.generatedAt, addOns: [] },
      { ...FEED, apps: [{ ...ENTRY, url: 'https://evil.example/clinic.tgz' }] },
    ]) {
      const { client } = recording(() => new Response(JSON.stringify(body), { status: 200 }));
      await expect(client.fetchCatalog(), JSON.stringify(body).slice(0, 60)).rejects.toMatchObject({
        reason: 'CATALOG_MALFORMED',
      });
    }
  });
});

describe('app catalog: the feed schema', () => {
  it('accepts the exact row shape the website emits', () => {
    expect(appCatalogSchema.safeParse(FEED).success).toBe(true);
  });

  it('refuses a price, tier, licence, URL or package field', () => {
    for (const extra of [
      { price: 0 },
      { tier: 'pro' },
      { licenseKey: 'x' },
      { url: 'https://evil.example/clinic.tgz' },
      { npmPackage: '@adminiumjs/app-clinic' },
    ]) {
      const parsed = appCatalogSchema.safeParse({ ...FEED, apps: [{ ...ENTRY, ...extra }] });
      expect(parsed.success, `expected ${JSON.stringify(extra)} to be refused`).toBe(false);
    }
  });

  it('refuses a floating version, a floating minimum, no sides, or an unknown side', () => {
    for (const row of [
      { version: 'latest' },
      { version: '^0.1.0' },
      { minAdminiumVersion: '>=0.2.8' },
      { sides: [] },
      { sides: ['kiosk'] },
    ]) {
      const parsed = appCatalogSchema.safeParse({ ...FEED, apps: [{ ...ENTRY, ...row }] });
      expect(parsed.success, `expected ${JSON.stringify(row)} to be refused`).toBe(false);
    }
  });

  it('compares a minimum as a version, not as a string', () => {
    expect(meetsMinimum('0.2.8', '0.2.8')).toBe(true);
    expect(meetsMinimum('0.2.8', '0.2.10')).toBe(true);
    expect(meetsMinimum('0.2.10', '0.2.9')).toBe(false);
    expect(meetsMinimum('0.3.0', '0.2.99')).toBe(false);
  });
});
