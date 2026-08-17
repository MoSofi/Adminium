// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Telemetry + update-check opt-in guarantees (M10-T04; v0.5 exit criterion
 * "Telemetry is opt-in (off by default)").
 *
 * The load-bearing suite. Mirrors `llm-byo-network-isolation.test.ts`: ALL
 * outbound network (fetch + node net/http/https) is replaced with recording
 * throwers, and an opted-out instance must complete every telemetry/update code
 * path with the recorder still empty. A single stray call would both throw and
 * be recorded, so "off means off" cannot rot into "off means we tried and
 * swallowed the error" — note `report()` deliberately catches fetch failures,
 * which is exactly why a recorder (not just a non-throwing result) is required
 * to prove the claim.
 *
 * Also pins the payload's exact key set and asserts that no schema content, row
 * data, connection string, user identity, or LLM run content can appear in it.
 *
 * The meta store is better-sqlite3 (`:memory:` — a native handle, no sockets),
 * so disabling the network cannot disturb the harness itself.
 */

import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

import BetterSqlite3 from 'better-sqlite3';
import {
  connectionsRepo,
  createSqliteMetaDb,
  firstRun,
  llmRunsRepo,
  settingsRepo,
  snapshotsRepo,
  type DsnCrypto,
  type MetaDb,
} from '@adminium/meta';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TELEMETRY_PAYLOAD_KEYS, buildTelemetryPayload } from '../src/telemetry/payload.js';
import { createTelemetryService } from '../src/telemetry/service.js';
import { compareVersions, createUpdateCheckService } from '../src/telemetry/update-check.js';

// ─── Network kill-switch (mirrors llm-byo-network-isolation.test.ts) ────────────

interface NetGuard {
  attempts: string[];
  restore: () => void;
}

function describeTarget(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  if (arg instanceof URL) return arg.href;
  if (arg !== null && typeof arg === 'object') {
    const req = arg as { url?: unknown; host?: unknown; hostname?: unknown; port?: unknown };
    if (typeof req.url === 'string') return req.url;
    const host = req.hostname ?? req.host;
    if (typeof host === 'string') return `${host}${req.port === undefined ? '' : `:${String(req.port)}`}`;
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
      throw new Error(`network disabled (telemetry opt-in): blocked ${label} to ${target}`);
    };

  const g = globalThis as { fetch: typeof globalThis.fetch };
  const originalFetch = g.fetch;
  const netMod = net as unknown as Record<string, unknown>;
  const httpMod = http as unknown as Record<string, unknown>;
  const httpsMod = https as unknown as Record<string, unknown>;
  const originals = {
    connect: netMod.connect,
    createConnection: netMod.createConnection,
    socketConnect: net.Socket.prototype.connect,
    httpRequest: httpMod.request,
    httpsRequest: httpsMod.request,
  };

  g.fetch = thrower('fetch') as unknown as typeof globalThis.fetch;
  netMod.connect = thrower('net.connect');
  netMod.createConnection = thrower('net.createConnection');
  (net.Socket.prototype as unknown as { connect: unknown }).connect = thrower('socket.connect');
  httpMod.request = thrower('http.request');
  httpsMod.request = thrower('https.request');

  return {
    attempts,
    restore: () => {
      g.fetch = originalFetch;
      netMod.connect = originals.connect;
      netMod.createConnection = originals.createConnection;
      (net.Socket.prototype as unknown as { connect: unknown }).connect = originals.socketConnect;
      httpMod.request = originals.httpRequest;
      httpsMod.request = originals.httpsRequest;
    },
  };
}

// ─── Harness ───────────────────────────────────────────────────────────────────

const testDsnCrypto: DsnCrypto = {
  encrypt: (plaintext) => `enc:test:${Buffer.from(plaintext, 'utf8').toString('base64')}`,
  decrypt: (token) => Buffer.from(token.slice('enc:test:'.length), 'base64').toString('utf8'),
};

/** Secrets seeded into the store that must never surface in a payload. */
const SECRET_DSN = 'postgres://admin:hunter2@db.internal.acme.io:5432/production';
const SECRET_TABLE = 'salaries_confidential';

async function buildMeta(): Promise<MetaDb> {
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);

  // A realistic store: two engines, a credential-bearing DSN, real schema
  // content, and an LLM run whose prompt 06 §9 promises is never reported.
  const pg = await connectionsRepo(meta, testDsnCrypto).create({
    name: 'Acme Production',
    engine: 'postgres',
    introspectDsn: SECRET_DSN,
  });
  await connectionsRepo(meta, testDsnCrypto).create({
    name: 'Local cache',
    engine: 'sqlite',
    introspectDsn: 'sqlite:/var/data/cache.db',
  });
  const { snapshot } = await snapshotsRepo(meta).create({
    connectionId: pg.id,
    source: 'introspection',
    schema: { tables: [{ name: SECRET_TABLE, columns: [{ name: 'base_pay_usd' }] }] },
    checksum: 'sha-acme-1',
  });
  await llmRunsRepo(meta).create({
    connectionId: pg.id,
    snapshotId: snapshot.id,
    mode: 'byo',
    status: 'awaiting_response',
    promptVersion: '1',
    promptHash: 'sha-prompt-1',
    promptText: `describe ${SECRET_TABLE} for the Acme dataset`,
    locales: ['en_US'],
  });
  return meta;
}

const VERSION = '0.5.0';

describe('telemetry is opt-in and silent when off (M10-T04)', () => {
  let meta: MetaDb;
  beforeEach(async () => {
    meta = await buildMeta();
  });
  afterEach(async () => {
    await meta.db.destroy();
  });

  it('defaults to OFF on a fresh install — no consent, no reporting', async () => {
    expect(await settingsRepo(meta).get('telemetry.enabled')).toBe(false);
    expect(await settingsRepo(meta).get('updates.checkEnabled')).toBe(false);
    expect(await createTelemetryService({ meta, version: VERSION }).isEnabled()).toBe(false);
  });

  it('makes ZERO network calls when off — telemetry AND the update check', async () => {
    const telemetry = createTelemetryService({ meta, version: VERSION });
    const updates = createUpdateCheckService({ meta, version: VERSION });

    const guard = disableNetwork();
    try {
      const report = await telemetry.report();
      expect(report).toEqual({ sent: false, reason: 'disabled' });
      expect(await telemetry.preview()).toBeNull();

      const check = await updates.check();
      expect(check).toEqual({ status: 'disabled' });

      // Repeat calls must not "warm up" into a beacon.
      await telemetry.report();
      await updates.check();
    } finally {
      guard.restore();
    }

    // The decisive assertion: not one outbound attempt was even made.
    expect(guard.attempts).toEqual([]);
  });

  it('reports only after explicit consent, and sends exactly the documented payload', async () => {
    await settingsRepo(meta).set('telemetry.enabled', true);

    const calls: { url: string; body: unknown }[] = [];
    const fetchImpl = (async (url: unknown, init?: { body?: unknown }) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    const telemetry = createTelemetryService({ meta, version: VERSION, fetchImpl, now: () => 1_700_000_000_000 });
    const result = await telemetry.report();

    expect(result.sent).toBe(true);
    expect(calls).toHaveLength(1);

    const instanceId = await settingsRepo(meta).get('system.instanceId');
    expect(calls[0]?.body).toEqual({
      schemaVersion: 1,
      instanceId,
      version: VERSION,
      metaEngine: 'sqlite',
      sourceEngines: ['postgres', 'sqlite'], // deduped + sorted engine TYPES only
      sentAt: 1_700_000_000_000,
    });
  });

  it('the payload carries no schema content, row data, DSN, or LLM run content', async () => {
    await settingsRepo(meta).set('telemetry.enabled', true);
    const payload = await createTelemetryService({ meta, version: VERSION }).preview();
    expect(payload).not.toBeNull();

    const wire = JSON.stringify(payload);
    // Everything the store holds that must not travel.
    for (const secret of [
      SECRET_DSN,
      'hunter2',
      'db.internal.acme.io',
      SECRET_TABLE,
      'base_pay_usd',
      'Acme Production', // connection display name
      'describe', // LLM prompt text (06 §9: BYO runs are never reported)
    ]) {
      expect(wire, `payload must not disclose ${secret}`).not.toContain(secret);
    }

    // Allow-list, both directions: the wire keys are EXACTLY the documented set,
    // so a future field cannot be added without a deliberate decision here.
    expect(Object.keys(payload ?? {}).sort()).toEqual([...TELEMETRY_PAYLOAD_KEYS].sort());
  });

  it('the instance id is the bootstrap UUID — anonymous, not derived from anything', async () => {
    await settingsRepo(meta).set('telemetry.enabled', true);
    const payload = await createTelemetryService({ meta, version: VERSION }).preview();
    expect(payload?.instanceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('drops engine ids outside the closed vocabulary rather than passing them through', () => {
    const payload = buildTelemetryPayload({
      instanceId: 'i',
      version: VERSION,
      metaEngine: 'sqlite',
      sourceEngines: ['postgres', 'postgres', 'mongodb-secret-name', 'sqlite'],
      sentAt: 1,
    });
    expect(payload.sourceEngines).toEqual(['postgres', 'sqlite']);
  });

  it('ADMINIUM_TELEMETRY=off vetoes a CONSENTING instance, and makes zero calls', async () => {
    // THE BUG THIS PINS. `ADMINIUM_TELEMETRY` was defined and validated in
    // env.ts and then read by NOTHING — while `self-hosting/telemetry.md` and
    // `env-vars.md` both presented it as the kill-switch. An org that set
    // `ADMINIUM_TELEMETRY=off` in its compose file to enforce a no-phone-home
    // policy had exactly zero protection the moment any user clicked "yes" on
    // the first-run consent screen. The operator who controls the environment
    // outranks the wizard, so `off` is now a real veto.
    await settingsRepo(meta).set('telemetry.enabled', true);
    const telemetry = createTelemetryService({ meta, version: VERSION, envOverride: false });

    const guard = disableNetwork();
    try {
      expect(await telemetry.isEnabled()).toBe(false);
      expect(await telemetry.report()).toEqual({ sent: false, reason: 'disabled' });
      expect(await telemetry.preview()).toBeNull();
    } finally {
      guard.restore();
    }
    expect(guard.attempts).toEqual([]);
  });

  it('ADMINIUM_TELEMETRY unset lets the consent answer stand (both ways)', async () => {
    // "Unset" must not collapse to "off" — that would make the override veto
    // every consenting instance, i.e. break the feature it is meant to govern.
    await settingsRepo(meta).set('telemetry.enabled', true);
    expect(
      await createTelemetryService({ meta, version: VERSION, envOverride: undefined }).isEnabled(),
    ).toBe(true);

    await settingsRepo(meta).set('telemetry.enabled', false);
    expect(
      await createTelemetryService({ meta, version: VERSION, envOverride: undefined }).isEnabled(),
    ).toBe(false);
  });

  it('ADMINIUM_TELEMETRY=on opts in without waiting for the wizard', async () => {
    expect(await settingsRepo(meta).get('telemetry.enabled')).toBe(false);
    expect(
      await createTelemetryService({ meta, version: VERSION, envOverride: true }).isEnabled(),
    ).toBe(true);
  });

  it('a failing endpoint never throws — telemetry is never load-bearing', async () => {
    await settingsRepo(meta).set('telemetry.enabled', true);
    const fetchImpl = (async () => {
      throw new Error('DNS go boom');
    }) as unknown as typeof globalThis.fetch;
    const result = await createTelemetryService({ meta, version: VERSION, fetchImpl }).report();
    expect(result).toEqual({ sent: false, reason: 'failed' });
  });
});

describe('update-available notice is gated on its own preference (M10-T04)', () => {
  let meta: MetaDb;
  beforeEach(async () => {
    meta = await buildMeta();
  });
  afterEach(async () => {
    await meta.db.destroy();
  });

  const feed = (tag: string) => {
    const calls: string[] = [];
    const fetchImpl = (async (url: unknown) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ tag_name: tag }), { status: 200 });
    }) as unknown as typeof globalThis.fetch;
    return { calls, fetchImpl };
  };

  it('enabling TELEMETRY alone does not enable the update check (separate consents)', async () => {
    await settingsRepo(meta).set('telemetry.enabled', true);
    const { calls, fetchImpl } = feed('v9.9.9');
    const result = await createUpdateCheckService({ meta, version: VERSION, fetchImpl }).check();

    expect(result).toEqual({ status: 'disabled' });
    expect(calls, 'a telemetry yes is not an update-check yes').toEqual([]);
  });

  it('reports an available update once opted in', async () => {
    await settingsRepo(meta).set('updates.checkEnabled', true);
    const { calls, fetchImpl } = feed('v0.6.1');
    const result = await createUpdateCheckService({ meta, version: VERSION, fetchImpl }).check();

    expect(result).toEqual({
      status: 'update-available',
      current: '0.5.0',
      latest: '0.6.1',
      url: 'https://github.com/MoSofi/Adminium/releases',
    });
    expect(calls).toHaveLength(1);
  });

  /**
   * Regression for a bug that shipped: this repo publishes TWO tag series —
   * `v<semver>` (server/CLI) and `desktop-v<semver>` (Electron) — and the
   * check used to read `/releases/latest`, which is whichever release was
   * published most recently across BOTH. Publishing desktop-v0.1.0 after
   * v0.1.0 made the feed answer `desktop-v0.1.0`; `compareVersions` parses
   * that to 0.0.0 (parseInt("desktop") is NaN), so every instance silently
   * reported "up to date" forever.
   */
  const listFeed = (releases: Array<Record<string, unknown>>) => {
    const calls: string[] = [];
    const fetchImpl = (async (url: unknown) => {
      calls.push(String(url));
      return new Response(JSON.stringify(releases), { status: 200 });
    }) as unknown as typeof globalThis.fetch;
    return { calls, fetchImpl };
  };

  it('ignores desktop-v* tags even when they are newer than every server release', async () => {
    await settingsRepo(meta).set('updates.checkEnabled', true);
    const { calls, fetchImpl } = listFeed([
      { tag_name: 'desktop-v9.9.9' }, // newest overall — must not be read as ours
      { tag_name: 'v0.5.0' },
    ]);
    const result = await createUpdateCheckService({ meta, version: VERSION, fetchImpl }).check();

    expect(result, 'a desktop release must never masquerade as a server update').toEqual({
      status: 'current',
      current: '0.5.0',
    });
    expect(calls[0], 'must query the release LIST, not /releases/latest').not.toContain(
      '/releases/latest',
    );
  });

  it('picks the highest server version, not the most recently published entry', async () => {
    await settingsRepo(meta).set('updates.checkEnabled', true);
    const { fetchImpl } = listFeed([
      { tag_name: 'desktop-v3.0.0' },
      { tag_name: 'v0.5.1' }, // published later, but a patch on an older line
      { tag_name: 'v0.6.1' },
      { tag_name: 'v0.7.0', prerelease: true }, // not a stable release
      { tag_name: 'v0.8.0', draft: true }, // never announced
    ]);
    const result = await createUpdateCheckService({ meta, version: VERSION, fetchImpl }).check();

    expect(result).toEqual({
      status: 'update-available',
      current: '0.5.0',
      latest: '0.6.1',
      url: 'https://github.com/MoSofi/Adminium/releases',
    });
  });

  it('reports current when the feed matches, and carries no instance id outbound', async () => {
    await settingsRepo(meta).set('updates.checkEnabled', true);
    const bodies: unknown[] = [];
    const fetchImpl = (async (_url: unknown, init?: { body?: unknown; method?: string }) => {
      bodies.push(init?.body);
      expect(init?.method).toBe('GET');
      return new Response(JSON.stringify({ tag_name: 'v0.5.0' }), { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    const result = await createUpdateCheckService({ meta, version: VERSION, fetchImpl }).check();
    expect(result).toEqual({ status: 'current', current: '0.5.0' });
    // A plain GET with no payload — the check is not telemetry in disguise.
    expect(bodies).toEqual([undefined]);
  });

  it('an unreachable feed degrades to unknown and is retried, not cached', async () => {
    await settingsRepo(meta).set('updates.checkEnabled', true);
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      throw new Error('offline');
    }) as unknown as typeof globalThis.fetch;

    const service = createUpdateCheckService({ meta, version: VERSION, fetchImpl });
    expect(await service.check()).toEqual({ status: 'unknown', current: '0.5.0' });
    expect(await service.check()).toEqual({ status: 'unknown', current: '0.5.0' });
    expect(calls, 'a transient failure must not be cached').toBe(2);
  });

  it('caches a successful result within the TTL', async () => {
    await settingsRepo(meta).set('updates.checkEnabled', true);
    const { calls, fetchImpl } = feed('v0.6.0');
    const service = createUpdateCheckService({ meta, version: VERSION, fetchImpl, now: () => 1000 });

    await service.check();
    await service.check();
    expect(calls, 'About being opened twice must not hit the feed twice').toHaveLength(1);
  });

  it('opting back out silences a previously-enabled checker', async () => {
    await settingsRepo(meta).set('updates.checkEnabled', true);
    const { calls, fetchImpl } = feed('v0.6.0');
    const service = createUpdateCheckService({ meta, version: VERSION, fetchImpl });
    expect((await service.check()).status).toBe('update-available');

    await settingsRepo(meta).set('updates.checkEnabled', false);
    const guard = disableNetwork();
    try {
      expect(await service.check()).toEqual({ status: 'disabled' });
    } finally {
      guard.restore();
    }
    expect(guard.attempts).toEqual([]);
    expect(calls).toHaveLength(1);
  });
});

describe('compareVersions', () => {
  it('orders by major, then minor, then patch', () => {
    expect(compareVersions('1.0.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareVersions('0.6.0', '0.5.9')).toBeGreaterThan(0);
    expect(compareVersions('0.5.2', '0.5.10')).toBeLessThan(0);
    expect(compareVersions('0.5.0', '0.5.0')).toBe(0);
  });

  it('ignores a leading v and prerelease/build suffixes', () => {
    expect(compareVersions('v0.5.0', '0.5.0')).toBe(0);
    // A prerelease of X is treated AS X — never a false "update available".
    expect(compareVersions('0.5.0', '0.5.0-rc.1')).toBe(0);
    expect(compareVersions('0.5.0+build.7', '0.5.0')).toBe(0);
  });

  it('treats missing/garbage segments as zero rather than NaN', () => {
    expect(compareVersions('1', '1.0.0')).toBe(0);
    expect(compareVersions('1.x.y', '1.0.0')).toBe(0);
  });
});
