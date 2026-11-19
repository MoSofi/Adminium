// SPDX-License-Identifier: AGPL-3.0-only
/**
 * E1 (build box): the one host of the user's own a trial may reach.
 *
 * `ADMINIUM_DATABASE_USER_HOST` is allowed besides `ADMINIUM_DATABASE_HOSTS`
 * only while `ADMINIUM_YOUR_DATABASE` is set; it is never listed, so every
 * lookup and every 5 s re-check hold it to public addresses (no loopback,
 * private, reserved or metadata address, nothing on the fleet's deny list);
 * its port is a database's; its TLS defaults to verifying; a refusal never
 * repeats an address in trial or hosted mode; and five refused logins in an
 * hour lock the target.
 *
 * Every name is answered by an injected lookup and every adapter is a fake that
 * records what it was handed: nothing here dials a network.
 */
import { AdapterError, AdapterRegistry, type AdapterProvider, type DatabaseEndpoint } from '@adminium/engine/adapter';
import { describe, expect, it } from 'vitest';

import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { addressRechecker, checkDsn, parseDatabaseHost, parseDsn, userHostPolicy, userHostTlsParams, type DatabaseHost } from '../src/connections/dsn.js';
import { ConnectionManager, LOGIN_LOCKOUT_MS, SourceLoginLockedError } from '../src/connections/manager.js';
import { DENIED_USER_PORTS, parseDenyAddresses, parseUserHost, userPortRefusal, type DenyRange, type UserHost } from '../src/connections/user-host.js';
import { checkHost, isReservedAddress, type HostLookup } from '../src/net/address-guard.js';
import { ORDINARY_POLICY, trialPolicy, type TrialPolicy } from '../src/trial/policy.js';
import { assertTrialSourceAllowed, assertUserHostNotOperator, operatorLoginOf, type TrialSourceRules } from '../src/trial/sources.js';

const crypto = dsnCryptoFromSecret('user-host-guard-test-secret');
const fakeMeta = { db: null, dialect: 'sqlite' } as never;

function table(answers: Record<string, readonly string[]>): HostLookup {
  return async (host) => {
    const answer = answers[host];
    if (answer === undefined) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: 'ENOTFOUND' });
    return answer;
  };
}

const ANSWERS = {
  'db.user.example': ['93.184.215.40'],
  'v6.user.example': ['2606:2800:220:1:248:1893:25c8:1946'],
  'pg-trials': ['10.20.0.5'],
  'alias-of-pg.example': ['10.20.0.5'],
  'fleet.user.example': ['203.0.113.250'],
  'floating.user.example': ['198.51.100.77'],
  'lan.user.example': ['192.168.1.4'],
  'home.user.example': ['127.0.0.1'],
  'meta.user.example': ['169.254.169.254'],
  'testnet.user.example': ['192.0.2.9'],
  'mapped.user.example': ['::ffff:93.184.215.40'],
  'multi.user.example': ['93.184.215.41', '10.1.2.3'],
};

const lookup = table(ANSWERS);

function policyOf(profile: 'trial' | 'hosted' | 'off'): TrialPolicy {
  if (profile === 'off') return ORDINARY_POLICY;
  return trialPolicy({
    ADMINIUM_TRIAL_MODE: profile === 'trial',
    ADMINIUM_HOSTED_MODE: profile === 'hosted',
    ADMINIUM_TRIAL_ENDS_AT: profile === 'trial' ? '2999-01-01T00:00:00Z' : undefined,
    ADMINIUM_TRIAL_UPGRADE_URL: undefined,
    ADMINIUM_PUBLIC_ORIGIN: 'https://shop.example.com',
    ADMINIUM_TRIAL_DATA_MAX_MB: 500,
    ADMINIUM_TRIAL_UPLOAD_MAX_MB: 10,
    ADMINIUM_TRIAL_STORAGE_MAX_MB: 1000,
    ADMINIUM_TRIAL_EMAIL_MAX_PER_DAY: 50,
    ADMINIUM_AI_OPERATOR_ONLY: false,
    ADMINIUM_AI_OPERATOR_SCOPE: undefined,
  });
}

function listed(...entries: string[]): DatabaseHost[] {
  return entries.map((entry) => {
    const parsed = parseDatabaseHost(entry);
    if (!parsed.ok) throw new Error(entry);
    return parsed.entry;
  });
}

function userHost(raw: string): UserHost {
  const parsed = parseUserHost(raw);
  if (!parsed.ok) throw new Error(parsed.problem);
  return parsed.entry;
}

function deny(raw: string): DenyRange[] {
  const parsed = parseDenyAddresses(raw);
  if (!parsed.ok) throw new Error(parsed.refused.join());
  return parsed.ranges;
}

const FLEET = deny('203.0.113.250,198.51.100.0/24,2001:db8:aa::/48');
const OPERATOR_URL = 'postgres://trial_7f3a:pw@pg-trials:5432/trial_7f3a';

interface Dialled {
  dsn?: string;
  endpoint?: DatabaseEndpoint;
}

/** Fakes for every engine: `test()` answers `outcome()` at the time of the call. */
function registry(dialled: Dialled[], outcome: () => AdapterError | null = () => null): AdapterRegistry<AdapterProvider> {
  const reg = new AdapterRegistry<AdapterProvider>();
  for (const dialect of ['postgres', 'mysql', 'sqlite'] as const) {
    reg.register({
      dialect,
      create(config: Dialled) {
        dialled.push(config);
        return {
          test: async () => {
            const error = outcome();
            return error === null
              ? { ok: true, latencyMs: 1, serverVersion: '16', canWrite: true }
              : { ok: false, latencyMs: 1, serverVersion: null, canWrite: false, error };
          },
          probeCapabilities: async () => ({
            capabilities: {},
            privileges: { canReadSchema: true, canRead: true, canWrite: true, canDDL: true },
            serverVersion: '16',
            currentRole: { name: 'app', readOnly: false },
          }),
          close: async () => undefined,
        };
      },
      createQueryEngine() {
        throw new Error('not used');
      },
    } as unknown as AdapterProvider);
  }
  return reg;
}

function manager(opts: {
  profile?: 'trial' | 'hosted' | 'off';
  user?: UserHost | null;
  dialled?: Dialled[];
  outcome?: () => AdapterError | null;
  now?: () => number;
}): ConnectionManager {
  return new ConnectionManager({
    meta: fakeMeta,
    crypto,
    registry: registry(opts.dialled ?? [], opts.outcome),
    blockLoopback: false,
    databaseHosts: listed('pg-trials:5432'),
    networkPolicy: 'strict',
    lookup,
    policy: policyOf(opts.profile ?? 'trial'),
    operatorSourceUrl: OPERATOR_URL,
    userHost: opts.user === undefined ? userHost('db.user.example:5432') : opts.user,
    denyAddresses: FLEET,
    ...(opts.now === undefined ? {} : { now: opts.now }),
  });
}

describe('reserved and special-purpose ranges', () => {
  it.each([
    '0.1.2.3',
    '192.0.0.9',
    '192.88.99.1',
    '198.18.0.1',
    '198.19.255.255',
    '192.0.2.1',
    '198.51.100.1',
    '203.0.113.1',
    '224.0.0.1',
    '239.255.255.250',
    '240.0.0.1',
    '255.255.255.255',
    '::ffff:93.184.215.40',
    '::ffff:0:0',
    '100::1',
    '2001::1',
    '2001:0:4136:e378::1',
    '2001:db8::1',
    '2001:10::1',
    '2001:1f::1',
    '2001:20::1',
    '2001:2f:ffff::1',
    'fec0::1',
    'feff::1',
    'ff02::1',
  ])('%s is reserved', (address) => {
    expect(isReservedAddress(address)).toBe(true);
  });

  it.each(['93.184.215.40', '8.8.8.8', '198.20.0.1', '192.0.1.1', '223.255.255.255', '2606:4700::1111', '2001:4860::8888', '2001:30::1'])('%s is not', (address) => {
    expect(isReservedAddress(address)).toBe(false);
  });

  it('refused only where asked: strict sources and the user host, never a listed host', async () => {
    expect((await checkHost('192.0.2.9', {})).ok).toBe(true);
    expect(await checkHost('192.0.2.9', { blockReserved: true })).toMatchObject({ ok: false, reason: 'reserved' });
    expect((await checkHost('192.0.2.9', { blockReserved: true, listed: true })).ok).toBe(true);
    // Metadata is read first: 192.0.0.192 stays metadata, refused even when listed.
    expect(await checkHost('192.0.0.192', { blockReserved: true, listed: true })).toMatchObject({ ok: false, reason: 'metadata' });
  });

  it('a strict source on a reserved range is refused, unless listed', async () => {
    await expect(checkDsn('postgres://u@testnet.user.example:5432/app', { blockPrivate: true, lookup })).rejects.toThrow('reserved address range');
    const ok = await checkDsn('postgres://u@testnet.user.example:5432/app', { blockPrivate: true, lookup, databaseHosts: listed('testnet.user.example:5432') });
    expect(ok.endpoint?.addresses).toEqual(['192.0.2.9']);
    // Open: as before.
    expect((await checkDsn('postgres://u@testnet.user.example:5432/app', { lookup })).endpoint?.addresses).toEqual(['192.0.2.9']);
  });
});

describe('the user host: ports and the deny list', () => {
  it('refuses 22, 2376 and 8443, and every port below 1024 or on the fleet list', () => {
    for (const port of [22, 2376, 8443]) expect(userPortRefusal(port)).not.toBeNull();
    for (const port of [0, 80, 443, 1023, 65536, ...DENIED_USER_PORTS]) expect(userPortRefusal(port)).not.toBeNull();
    for (const port of [1024, 3306, 5432, 6432, 6543, 25060, 65535]) expect(userPortRefusal(port)).toBeNull();
    expect(parseUserHost('db.example.com:22')).toMatchObject({ ok: false });
    expect(parseUserHost('db.example.com:8443')).toMatchObject({ ok: false });
    expect(parseUserHost('db.example.com')).toMatchObject({ ok: false });
    expect(parseUserHost('[2001:db8::1]:5432')).toMatchObject({ ok: true, entry: { host: '2001:db8::1', port: 5432 } });
  });

  it('reads addresses and CIDR ranges, IPv4-mapped IPv6 included', () => {
    const ranges = deny('203.0.113.250, 10.0.0.0/8, 2001:db8:aa::/48');
    const policy = userHostPolicy(ranges);
    expect(policy.denied?.('203.0.113.250')).toBe(true);
    expect(policy.denied?.('10.9.8.7')).toBe(true);
    expect(policy.denied?.('::ffff:10.9.8.7')).toBe(true);
    expect(policy.denied?.('2001:db8:aa:1::5')).toBe(true);
    expect(policy.denied?.('93.184.215.40')).toBe(false);
    expect(parseDenyAddresses('10.0.0.0/33,not-an-ip')).toEqual({ ok: false, refused: ['10.0.0.0/33', 'not-an-ip'] });
  });
});

describe('the user host in trial mode', () => {
  const rules = (user: UserHost | null): TrialSourceRules => ({
    policy: policyOf('trial'),
    hosts: listed('pg-trials:5432'),
    operatorLogin: operatorLoginOf(OPERATOR_URL),
    userHost: user,
  });

  it('is allowed besides the list only while ADMINIUM_YOUR_DATABASE is set (the user host passed)', () => {
    const dsn = parseDsn('postgres://me:pw@db.user.example:5432/shop');
    expect(() => assertTrialSourceAllowed(dsn, rules(userHost('db.user.example:5432')))).not.toThrow();
    expect(() => assertTrialSourceAllowed(dsn, rules(null))).toThrow(/only to the database hosts its operator allows/);
    // Another port on the same name is another host.
    expect(() => assertTrialSourceAllowed(parseDsn('postgres://me:pw@db.user.example:6432/shop'), rules(userHost('db.user.example:5432')))).toThrow(/only to the database hosts/);
    // Any other host stays refused.
    expect(() => assertTrialSourceAllowed(parseDsn('postgres://me:pw@other.example:5432/shop'), rules(userHost('db.user.example:5432')))).toThrow(/only to the database hosts/);
  });

  it('is held to public addresses on the lookup, whatever the list or the switches say', async () => {
    const dialled: Dialled[] = [];
    await manager({ dialled }).testDsn('postgres', 'postgres://me:pw@db.user.example:5432/shop');
    expect(dialled[0]?.endpoint?.addresses).toEqual(['93.184.215.40']);
    for (const name of ['lan.user.example', 'home.user.example', 'meta.user.example', 'testnet.user.example', 'fleet.user.example', 'floating.user.example', 'mapped.user.example', 'multi.user.example']) {
      const m = manager({ user: userHost(`${name}:5432`) });
      await expect(m.testDsn('postgres', `postgres://me:pw@${name}:5432/shop`), name).rejects.toMatchObject({ statusCode: 422 });
    }
  });

  it('never repeats the resolved address in trial or hosted mode', async () => {
    for (const profile of ['trial', 'hosted'] as const) {
      const m = manager({ profile, user: userHost('fleet.user.example:5432') });
      const error = await m.testDsn('postgres', 'postgres://me:pw@fleet.user.example:5432/shop').catch((caught: unknown) => caught as Error & { details?: unknown });
      expect(error).toBeInstanceOf(Error);
      const said = `${(error as Error).message} ${JSON.stringify((error as { details?: unknown }).details)}`;
      expect(said).not.toContain('203.0.113.250');
      expect(said).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
    }
  });

  it('gets no listed skip even when the list names it', async () => {
    const check = checkDsn('postgres://me:pw@lan.user.example:5432/shop', {
      lookup,
      databaseHosts: listed('lan.user.example:5432'),
      userHost: userHost('lan.user.example:5432'),
      denyAddresses: FLEET,
    });
    await expect(check).rejects.toThrow(/does not connect to/);
  });

  it('is checked again on every re-check: a name moved onto the fleet is refused on the next connection', async () => {
    let answer: readonly string[] = ['93.184.215.40'];
    let at = 0;
    const moving: HostLookup = async () => answer;
    const recheck = addressRechecker('db.user.example', userHostPolicy(FLEET, moving), ['93.184.215.40'], () => at, true);
    await expect(recheck()).resolves.toEqual(['93.184.215.40']);
    answer = ['203.0.113.250'];
    at += 6_000;
    const refused = await recheck().catch((error: unknown) => error as Error);
    expect(refused).toBeInstanceOf(Error);
    expect((refused as Error).message).not.toContain('203.0.113.250');
  });

  it('found at an operator host’s address is held to the operator’s login', async () => {
    const r = rules(userHost('alias-of-pg.example:5432'));
    const other = parseDsn('postgres://someone:pw@alias-of-pg.example:5432/other');
    await expect(assertUserHostNotOperator(other, ['10.20.0.5'], r, lookup)).rejects.toThrow(/only the login and database its operator gave it/);
    const own = parseDsn('postgres://trial_7f3a:pw@alias-of-pg.example:5432/trial_7f3a');
    await expect(assertUserHostNotOperator(own, ['10.20.0.5'], r, lookup)).resolves.toBeUndefined();
    await expect(assertUserHostNotOperator(other, ['93.184.215.40'], r, lookup)).resolves.toBeUndefined();
  });

  it('loopback is refused by the profile, not by NODE_ENV', () => {
    expect(new ConnectionManager({ meta: fakeMeta, crypto, blockLoopback: false, policy: policyOf('trial') }).blockLoopback).toBe(true);
    expect(new ConnectionManager({ meta: fakeMeta, crypto, blockLoopback: false, policy: policyOf('hosted') }).blockLoopback).toBe(true);
    expect(new ConnectionManager({ meta: fakeMeta, crypto, blockLoopback: false, policy: policyOf('off') }).blockLoopback).toBe(false);
  });
});

describe('the user host’s TLS defaults', () => {
  it('Postgres: verify-full for a name, require for an IP, plain only with sslmode=disable', async () => {
    expect(userHostTlsParams('postgres', 'db.user.example', {})).toEqual({ sslmode: 'verify-full' });
    expect(userHostTlsParams('postgres', '93.184.215.40', {})).toEqual({ sslmode: 'require', uselibpqcompat: 'true' });
    expect(userHostTlsParams('postgres', 'db.user.example', { sslmode: 'disable' })).toEqual({ sslmode: 'disable' });
    expect(userHostTlsParams('postgres', 'db.user.example', { ssl: 'false' })).toEqual({ ssl: 'false', sslmode: 'verify-full' });
    expect(userHostTlsParams('postgres', 'db.user.example', { sslmode: 'require' })).toEqual({ sslmode: 'require' });

    const dialled: Dialled[] = [];
    await manager({ dialled }).testDsn('postgres', 'postgres://me:pw@db.user.example:5432/shop');
    expect(dialled[0]?.endpoint?.params).toMatchObject({ sslmode: 'verify-full' });
  });

  it('MySQL: certificates checked for a name, not for an IP; plain only with sslmode=disable', () => {
    expect(userHostTlsParams('mysql', 'db.user.example', {})).toEqual({ ssl: '{"rejectUnauthorized":true}' });
    expect(userHostTlsParams('mysql', '93.184.215.40', {})).toEqual({ ssl: '{"rejectUnauthorized":false}' });
    expect(userHostTlsParams('mysql', 'db.user.example', { ssl: 'false' })).toEqual({ ssl: '{"rejectUnauthorized":true}' });
    expect(userHostTlsParams('mysql', 'db.user.example', { sslmode: 'disable', ssl: 'true' })).toEqual({ sslmode: 'disable' });
    expect(userHostTlsParams('mysql', 'db.user.example', { ssl: 'Amazon RDS' })).toEqual({ ssl: 'Amazon RDS' });
  });

  it('an operator host keeps its URL as written', async () => {
    const dialled: Dialled[] = [];
    await manager({ dialled }).testDsn('postgres', OPERATOR_URL);
    expect(dialled[0]?.endpoint?.params).toEqual({});
  });
});

describe('the login lockout', () => {
  const refused = (): AdapterError => new AdapterError('AUTH', 'password authentication failed', { detail: '28P01: password authentication failed' });

  it('locks a target after 5 refused logins in an hour, in trial mode, and opens again after the hour', async () => {
    let clock = 1_000_000;
    let outcome: AdapterError | null = refused();
    const m = manager({ outcome: () => outcome, now: () => clock });
    const dsn = 'postgres://me:wrong@db.user.example:5432/shop';
    for (let i = 0; i < 5; i += 1) {
      const result = await m.testDsn('postgres', dsn);
      expect(result.ok).toBe(false);
      clock += 1000;
    }
    await expect(m.testDsn('postgres', dsn)).rejects.toBeInstanceOf(SourceLoginLockedError);
    await expect(m.testDsn('postgres', dsn)).rejects.toMatchObject({ statusCode: 429, code: 'SOURCE_LOGIN_LOCKED' });
    // Another target is not locked.
    outcome = null;
    await expect(m.testDsn('postgres', OPERATOR_URL)).resolves.toMatchObject({ ok: true });
    clock += LOGIN_LOCKOUT_MS;
    await expect(m.testDsn('postgres', 'postgres://me:right@db.user.example:5432/shop')).resolves.toMatchObject({ ok: true });
  });

  it('a missing database is not a refused login', async () => {
    const missing = new AdapterError('AUTH', 'database "shop" does not exist', { detail: '3D000: database "shop" does not exist' });
    const m = manager({ outcome: () => missing });
    for (let i = 0; i < 7; i += 1) expect((await m.testDsn('postgres', 'postgres://me:pw@db.user.example:5432/shop')).ok).toBe(false);
  });

  it('an ordinary server never locks', async () => {
    const m = new ConnectionManager({ meta: fakeMeta, crypto, registry: registry([], refused), lookup, policy: ORDINARY_POLICY });
    for (let i = 0; i < 7; i += 1) expect((await m.testDsn('postgres', 'postgres://me:wrong@db.user.example:5432/shop')).ok).toBe(false);
  });
});
