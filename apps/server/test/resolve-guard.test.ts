// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A source host is looked up and checked before every new pool, and the
 * driver dials what was checked.
 *
 * The string guard (`guardDsn`) reads how a host is WRITTEN. A name says
 * nothing about where it points: `db.example.com` can resolve to 127.0.0.1
 * or to the cloud metadata address, and a name that fails to resolve now can
 * answer anything the next time the driver asks. So in production the host is
 * looked up the way the drivers look it up, every address is checked, a name
 * that does not resolve is refused, and the addresses that passed travel to
 * the adapter in the DSN's fields: the driver never looks the name up itself,
 * so a second answer cannot redirect it (DNS rebinding). Each new connection
 * of a pool runs the same check again, so a name that moves (a failover) is
 * followed and a name moved somewhere refused is refused.
 *
 * The lookup is injected throughout; nothing here asks a real resolver.
 */
import BetterSqlite3 from 'better-sqlite3';
import { AdapterRegistry, type AdapterProvider, type DatabaseEndpoint } from '@adminium/engine/adapter';
import { createSqliteMetaDb, firstRun } from '@adminium/meta';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ADDRESS_RECHECK_MS, checkDsn, parseDatabaseHost, type DatabaseHost } from '../src/connections/dsn.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { resolveAndCheck } from '../src/llm/outbound.js';
import { addressKind, checkHost, embeddedIpv4, type HostLookup } from '../src/net/address-guard.js';

const crypto = dsnCryptoFromSecret('resolve-guard-test-secret');
const fakeMeta = { db: null, dialect: 'sqlite' } as never;

/** A lookup that answers from a table, and counts what it was asked. */
function table(answers: Record<string, readonly string[]>): HostLookup & { asked: string[] } {
  const asked: string[] = [];
  const lookup = async (host: string): Promise<readonly string[]> => {
    asked.push(host);
    const answer = answers[host];
    if (answer === undefined) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: 'ENOTFOUND' });
    return answer;
  };
  return Object.assign(lookup, { asked });
}

interface Dialled {
  dsn?: string;
  endpoint?: DatabaseEndpoint;
}

function recordingRegistry(dialled: Dialled[]): AdapterRegistry<AdapterProvider> {
  const registry = new AdapterRegistry<AdapterProvider>();
  for (const dialect of ['postgres', 'mysql', 'sqlite'] as const) {
    registry.register({
      dialect,
      create(config: Dialled) {
        dialled.push(config);
        return {
          test: async () => ({ ok: true, latencyMs: 1, serverVersion: '18', canWrite: true }),
          probeCapabilities: async () => ({
            capabilities: {},
            privileges: { canReadSchema: true, canRead: true, canWrite: true, canDDL: true },
            serverVersion: '18',
            currentRole: { name: 'app', readOnly: false },
          }),
          close: async () => undefined,
        };
      },
      createQueryEngine: () => ({}),
    } as unknown as AdapterProvider);
  }
  return registry;
}

function listed(entries: string): DatabaseHost[] {
  return entries.split(',').map((raw) => {
    const parsed = parseDatabaseHost(raw);
    if (!parsed.ok) throw new Error(`bad entry ${raw}`);
    return parsed.entry;
  });
}

function production(lookup: HostLookup, dialled: Dialled[] = [], databaseHosts: DatabaseHost[] = []): ConnectionManager {
  return new ConnectionManager({ meta: fakeMeta, crypto, registry: recordingRegistry(dialled), blockLoopback: true, lookup, databaseHosts });
}

describe('every spelling of this machine is refused in production', () => {
  // Each resolves, through the system resolver, to this machine; the guard reads the spelling before any lookup.
  const spellings = ['localhost.', 'LOCALHOST', 'db.localhost', '[::ffff:127.0.0.1]', '[::ffff:7f00:1]', '0.0.0.0', '0', '[::]', '[::1]', '127.1', '0x7f.1', '0x7f000001', '2130706433', '0177.0.0.1', '[::127.0.0.1]', '[64:ff9b::7f00:1]', '[2002:7f00:1::]'];

  it.each(spellings)('%s', async (host) => {
    const lookup = table({});
    const dialled: Dialled[] = [];
    await expect(production(lookup, dialled).testDsn('postgres', `postgres://u@${host}:5432/app`)).rejects.toThrow(/Loopback hosts are not allowed/);
    expect(dialled).toEqual([]);
  });

  it('a name that resolves to 127.0.0.1, among other addresses', async () => {
    const lookup = table({ 'db.example.com': ['203.0.113.10', '127.0.0.1'] });
    const dialled: Dialled[] = [];
    await expect(production(lookup, dialled).testDsn('postgres', 'postgres://u@db.example.com:5432/app')).rejects.toThrow(
      'The host db.example.com is on this server (127.0.0.1). Loopback hosts are not allowed in production. If this database runs on this server, add db.example.com:5432 to ADMINIUM_DATABASE_HOSTS.',
    );
    expect(dialled).toEqual([]);
  });

  it('a name that resolves to 0.0.0.0 or ::', async () => {
    await expect(production(table({ 'a.example.com': ['0.0.0.0'] })).testDsn('mysql', 'mysql://u@a.example.com/app')).rejects.toThrow('Loopback');
    await expect(production(table({ 'a.example.com': ['::'] })).testDsn('mysql', 'mysql://u@a.example.com/app')).rejects.toThrow('Loopback');
  });

  it('a name that does not resolve, or resolves to nothing: a lookup failure of its own, not a policy refusal', async () => {
    const dialled: Dialled[] = [];
    await expect(production(table({}), dialled).testDsn('postgres', 'postgres://u@nowhere.example.com/app')).rejects.toMatchObject({
      statusCode: 502,
      code: 'HOST_LOOKUP_FAILED',
      message: 'Could not look up nowhere.example.com. Check the name, or try again if it was just created.',
    });
    await expect(production(table({ 'empty.example.com': [] }), dialled).testDsn('postgres', 'postgres://u@empty.example.com/app')).rejects.toMatchObject({
      statusCode: 502,
      code: 'HOST_LOOKUP_FAILED',
    });
    expect(dialled).toEqual([]);
  });
});

describe('cloud metadata is refused in every form, listed or not', () => {
  it.each([
    ['AWS / GCP / Azure', '169.254.169.254'],
    ['Alibaba Cloud', '100.100.100.200'],
    ['Oracle Cloud', '192.0.0.192'],
    ['AWS IPv6', 'fd00:ec2::254'],
    ['NAT64', '64:ff9b::a9fe:a9fe'],
    ['6to4', '2002:a9fe:a9fe::1'],
    ['IPv4-compatible', '::a9fe:a9fe'],
    ['IPv4-mapped', '::ffff:169.254.169.254'],
  ])('%s at %s, as the address a name resolves to and as the host itself', async (_cloud, address) => {
    const lookup = table({ 'db.example.com': [address] });
    const hosts = listed('db.example.com:5432,localhost:5432');
    await expect(production(lookup, [], hosts).testDsn('postgres', 'postgres://u@db.example.com:5432/app')).rejects.toThrow('blocked address range');
    const literal = address.includes(':') ? `[${address}]` : address;
    await expect(production(lookup, [], hosts).testDsn('postgres', `postgres://u@${literal}:5432/app`)).rejects.toThrow('blocked address range');
  });

  it('classes the addresses, embedded IPv4 decoded', () => {
    expect(addressKind('100.100.100.200')).toBe('metadata');
    expect(addressKind('192.0.0.192')).toBe('metadata');
    expect(addressKind('100.64.0.1')).toBe('private');
    expect(addressKind('192.0.0.193')).toBe('public');
    expect(addressKind('64:ff9b::a00:1')).toBe('private');
    expect(addressKind('64:ff9b::808:808')).toBe('public');
    expect(addressKind('2002:7f00:1::')).toBe('loopback');
    expect(addressKind('2002:808:808::1')).toBe('public');
    expect(addressKind('::127.0.0.1')).toBe('loopback');
    expect(addressKind('::')).toBe('loopback');
    expect(addressKind('::1')).toBe('loopback');
    expect(addressKind('2001:db8::1')).toBe('public');
    expect(addressKind('not an address')).toBe('public');
    expect(embeddedIpv4('64:ff9b::192.0.0.192')).toBe('192.0.0.192');
    expect(embeddedIpv4('::ffff:a9fe:a9fe')).toBe('169.254.169.254');
    expect(embeddedIpv4('2001:db8::1')).toBeNull();
    expect(embeddedIpv4('10.0.0.1')).toBeNull();
  });
});

describe('the driver dials what was checked', () => {
  it('a resolver that answers differently the second time cannot redirect the dial', async () => {
    const answers = [['203.0.113.10'], ['127.0.0.1']];
    const asked: string[] = [];
    const lookup: HostLookup = async (host) => {
      asked.push(host);
      return answers.shift() ?? [];
    };
    const dialled: Dialled[] = [];
    const manager = production(lookup, dialled);
    expect((await manager.testDsn('postgres', 'postgres://app:pw@db.example.com:5432/shop?sslmode=require')).ok).toBe(true);
    // One lookup, and the adapter got the fields with the address it gave: nothing left for the driver to look up.
    expect(asked).toEqual(['db.example.com']);
    expect(dialled).toEqual([
      {
        role: 'introspect',
        endpoint: {
          host: 'db.example.com',
          port: 5432,
          database: 'shop',
          user: 'app',
          password: 'pw',
          params: { sslmode: 'require' },
          addresses: ['203.0.113.10'],
          resolveAddresses: expect.any(Function),
        },
      },
    ]);
    expect(dialled[0]).not.toHaveProperty('dsn');
    // The next pool looks the name up again, and its new answer is refused.
    await expect(manager.testDsn('postgres', 'postgres://app:pw@db.example.com:5432/shop?sslmode=require')).rejects.toThrow('Loopback');
    expect(dialled).toHaveLength(1);
  });

  it('checks again on every new pool of a stored connection', async () => {
    let answer: readonly string[] = ['203.0.113.10'];
    const dialled: Dialled[] = [];
    const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    const manager = new ConnectionManager({ meta, crypto, registry: recordingRegistry(dialled), blockLoopback: true, lookup: async () => answer });
    try {
      const stored = await manager.connections.create({
        name: 'shop',
        engine: 'postgres',
        sourceKind: 'dsn',
        introspectDsn: 'postgres://app@db.example.com:5432/shop',
        dataDsn: null,
        readOnly: false,
        settings: {},
        status: 'connected',
        createdBy: null,
      });
      await (await manager.introspectAdapter(stored.id)).close();
      expect(dialled.at(-1)?.endpoint?.addresses).toEqual(['203.0.113.10']);
      // Saved and dialled once already; the name now answers the metadata address.
      answer = ['169.254.169.254'];
      await expect(manager.introspectAdapter(stored.id)).rejects.toThrow('blocked address range');
      await expect(manager.dataAdapter(stored.id)).rejects.toThrow('blocked address range');
      expect(dialled).toHaveLength(1);
    } finally {
      await meta.db.destroy();
    }
  });

  it('a listed host connects, at the loopback address it resolved to', async () => {
    const dialled: Dialled[] = [];
    const manager = production(table({ localhost: ['127.0.0.1', '::1'] }), dialled, listed('localhost:5432'));
    expect((await manager.testDsn('postgres', 'postgres://app@localhost:5432/shop')).ok).toBe(true);
    expect(dialled[0]?.endpoint?.addresses).toEqual(['127.0.0.1', '::1']);
    // Listed by host AND port: Redis on the same name stays refused.
    await expect(manager.testDsn('postgres', 'postgres://app@localhost:6379/shop')).rejects.toThrow('add localhost:6379');
    // A listed name that resolves to the metadata address is never let through.
    const rebound = production(table({ 'pg.internal': ['169.254.169.254'] }), [], listed('pg.internal'));
    await expect(rebound.testDsn('postgres', 'postgres://app@pg.internal/shop')).rejects.toThrow('blocked address range');
  });

  it('a private address passes as before (the network policy comes later)', async () => {
    const dialled: Dialled[] = [];
    expect((await production(table({ postgres: ['172.18.0.2'] }), dialled).testDsn('postgres', 'postgres://app@postgres/shop')).ok).toBe(true);
    expect(dialled[0]?.endpoint?.addresses).toEqual(['172.18.0.2']);
    // The seam: a caller that blocks private ranges refuses it, unless listed.
    await expect(checkDsn('postgres://app@postgres/shop', { blockLoopback: true, blockPrivate: true, lookup: table({ postgres: ['172.18.0.2'] }) })).rejects.toThrow(
      "own network (172.18.0.2)",
    );
    await expect(
      checkDsn('postgres://app@postgres/shop', { blockLoopback: true, blockPrivate: true, databaseHosts: listed('postgres:5432'), lookup: table({ postgres: ['172.18.0.2'] }) }),
    ).resolves.toMatchObject({ endpoint: { addresses: ['172.18.0.2'] } });
  });

  it('an address written as numbers is pinned as itself, with no lookup', async () => {
    const lookup = table({});
    const dialled: Dialled[] = [];
    await production(lookup, dialled).testDsn('mysql', 'mysql://app@203.0.113.10:3306/shop');
    expect(lookup.asked).toEqual([]);
    expect(dialled[0]?.endpoint).toMatchObject({ host: '203.0.113.10', addresses: ['203.0.113.10'] });
  });
});

describe('each new connection of a pool checks its host again', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A lookup whose answer the test moves, counting the lookups. */
  function moving(first: readonly string[]): { lookup: HostLookup; answer: readonly string[]; asked: number } {
    const state = {
      answer: first,
      asked: 0,
      lookup: async (): Promise<readonly string[]> => {
        state.asked += 1;
        return state.answer;
      },
    };
    return state;
  }

  async function pooled(lookup: HostLookup, opts: { blockLoopback?: boolean } = {}): Promise<() => Promise<readonly string[]>> {
    const checked = await checkDsn('postgres://app@db.example.com:5432/shop', { blockLoopback: opts.blockLoopback ?? true, lookup });
    const resolve = checked.endpoint?.resolveAddresses;
    if (resolve === undefined) throw new Error('no re-check on the endpoint');
    return resolve;
  }

  it('dials the new address after the name moves (a failover), without a restart', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const lookup = moving(['203.0.113.10']);
    const resolve = await pooled(lookup.lookup);
    // The first sockets reuse the pool's own check.
    expect(await resolve()).toEqual(['203.0.113.10']);
    expect(lookup.asked).toBe(1);
    lookup.answer = ['203.0.113.20'];
    vi.advanceTimersByTime(ADDRESS_RECHECK_MS + 1);
    expect(await resolve()).toEqual(['203.0.113.20']);
    expect(lookup.asked).toBe(2);
  });

  it('refuses the next socket when the name moves to metadata or this machine', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const lookup = moving(['203.0.113.10']);
    const resolve = await pooled(lookup.lookup);
    lookup.answer = ['169.254.169.254'];
    vi.advanceTimersByTime(ADDRESS_RECHECK_MS + 1);
    await expect(resolve()).rejects.toMatchObject({ code: 'ENOTFOUND', reason: 'metadata' });
    lookup.answer = ['203.0.113.10', '127.0.0.1'];
    await expect(resolve()).rejects.toMatchObject({ reason: 'loopback', message: expect.stringContaining('(127.0.0.1)') });
  });

  it('a burst of sockets shares one lookup', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const lookup = moving(['203.0.113.10']);
    const resolve = await pooled(lookup.lookup);
    vi.advanceTimersByTime(ADDRESS_RECHECK_MS + 1);
    lookup.answer = ['203.0.113.20'];
    const burst = await Promise.all(Array.from({ length: 10 }, async () => resolve()));
    expect(burst.every((addresses) => addresses[0] === '203.0.113.20')).toBe(true);
    expect(await resolve()).toEqual(['203.0.113.20']);
    expect(lookup.asked).toBe(2);
  });
});

describe('where loopback is allowed (the desktop app, dev)', () => {
  it('looks the name up and refuses metadata only; a name that does not resolve is left to the driver', async () => {
    const lookup = table({ localhost: ['127.0.0.1'], 'db.example.com': ['192.168.1.20'], 'evil.example.com': ['169.254.169.254'] });
    const dialled: Dialled[] = [];
    const desktop = new ConnectionManager({ meta: fakeMeta, crypto, registry: recordingRegistry(dialled), blockLoopback: false, lookup });
    expect((await desktop.testDsn('postgres', 'postgres://app@localhost:5432/shop')).ok).toBe(true);
    expect((await desktop.testDsn('postgres', 'postgres://app@db.example.com:5432/shop')).ok).toBe(true);
    // Offline, or a name not created yet: no lookup failure of ours; the driver reports its own.
    expect((await desktop.testDsn('postgres', 'postgres://app@nowhere.example.com/shop')).ok).toBe(true);
    expect(lookup.asked).toEqual(['localhost', 'db.example.com', 'nowhere.example.com']);
    expect(dialled.map((config) => config.endpoint?.addresses)).toEqual([['127.0.0.1'], ['192.168.1.20'], []]);
    expect(dialled.every((config) => config.dsn === undefined)).toBe(true);
    // The unresolved name's connection asks again, and fails as the driver would.
    await expect(dialled[2]?.endpoint?.resolveAddresses?.()).rejects.toMatchObject({ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND nowhere.example.com' });
    // A name that resolves to the metadata address is refused here too, as is the address itself.
    await expect(desktop.testDsn('postgres', 'postgres://app@evil.example.com/shop')).rejects.toThrow('blocked address range');
    await expect(desktop.testDsn('postgres', 'postgres://app@169.254.169.254/shop')).rejects.toThrow('blocked address range');
    expect(dialled).toHaveLength(3);
  });

  it('a name moved to metadata later is refused on the next connection', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      let answer: readonly string[] = ['192.168.1.20'];
      const checked = await checkDsn('postgres://app@db.example.com/shop', { blockLoopback: false, lookup: async () => answer });
      answer = ['169.254.169.254'];
      vi.advanceTimersByTime(ADDRESS_RECHECK_MS + 1);
      await expect(checked.endpoint?.resolveAddresses?.()).rejects.toMatchObject({ reason: 'metadata' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('a SQLite source keeps its path', async () => {
    const dialled: Dialled[] = [];
    const desktop = new ConnectionManager({ meta: fakeMeta, crypto, registry: recordingRegistry(dialled), blockLoopback: false });
    await desktop.testDsn('sqlite', 'sqlite:./data/shop.db');
    expect(dialled).toEqual([{ role: 'introspect', dsn: 'sqlite:./data/shop.db' }]);
  });
});

describe('the same check for an http(s) address (webhooks and storage endpoints reuse it)', () => {
  it('refuses this machine, a name that does not resolve, and metadata; returns what passed', async () => {
    const lookup = table({ 'hooks.example.com': ['127.0.0.1'], 'store.example.com': ['198.51.100.7', '2001:db8::7'], 'meta.example.com': ['100.100.100.200'] });
    const strict = { blockLoopback: true, failClosed: true, resolve: lookup };
    await expect(resolveAndCheck('https://hooks.example.com/in', strict)).rejects.toThrow('on this server itself');
    await expect(resolveAndCheck('https://localhost./in', strict)).rejects.toThrow('on this server itself');
    await expect(resolveAndCheck('https://nowhere.example.com/in', strict)).rejects.toThrow('does not resolve');
    await expect(resolveAndCheck('https://meta.example.com/in', { resolve: lookup })).rejects.toThrow('blocked range');
    await expect(resolveAndCheck('https://store.example.com/bucket', strict)).resolves.toEqual(['198.51.100.7', '2001:db8::7']);
    await expect(resolveAndCheck('https://hooks.example.com/in', { ...strict, listed: true })).resolves.toEqual(['127.0.0.1']);
  });

  it('checkHost names its reason without throwing', async () => {
    await expect(checkHost('metadata.google.internal.')).resolves.toMatchObject({ ok: false, reason: 'metadata' });
    await expect(checkHost('10.0.0.5', { blockPrivate: true })).resolves.toMatchObject({ ok: false, reason: 'private', address: '10.0.0.5' });
    await expect(checkHost('nowhere.example.com', { lookup: table({}) })).resolves.toEqual({ ok: true, host: 'nowhere.example.com', addresses: [], looked: true });
  });
});
