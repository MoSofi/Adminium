// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The step-3 transition (45-onboarding.md §4, R1).
 *
 * What is pinned here is the ORDER and what survives a failure: the account is
 * created first because it is the only call that works without a session, and
 * a connection that will not take leaves that account standing — the person is
 * signed in and can go back and fix the string, which is the whole reason the
 * outcome distinguishes the two failures instead of throwing one error.
 */
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_HELD_ANSWERS } from './heldAnswers.js';
import { connectionNameFromDsn, submitHeldAnswers, type SubmitDeps } from './submitHeldAnswers.js';

const ACCOUNT = { name: 'Ada', email: ' ada@example.com ', password: 'correct-horse', confirm: 'correct-horse' };
const CONSENT = { telemetry: false, updateCheck: false };

function deps(overrides: Partial<SubmitDeps> = {}): { calls: string[]; deps: SubmitDeps } {
  const calls: string[] = [];
  const base: SubmitDeps = {
    createSuperAdmin: vi.fn(async () => {
      calls.push('createSuperAdmin');
      return { user: { id: 'usr_1' }, csrfToken: 'csrf' } as never;
    }),
    testDsn: vi.fn(async () => {
      calls.push('testDsn');
      return { ok: true, latencyMs: 12, serverVersion: 'PostgreSQL 16.2', readOnly: false, privileges: null, error: null };
    }),
    createConnection: vi.fn(async () => {
      calls.push('createConnection');
      return { id: 'con_1', readOnly: false } as never;
    }),
    introspect: vi.fn(async () => {
      calls.push('introspect');
      return { kind: 'done', snapshotId: 'snap_1', noop: false, proposedMasks: 0, checksum: 'c' } as never;
    }),
    getSchema: vi.fn(async () => {
      calls.push('getSchema');
      return { model: { tables: [{}, {}, {}] } } as never;
    }),
  };
  return { calls, deps: { ...base, ...overrides } };
}

describe('with nothing held', () => {
  it('creates the account and stops — no connection call is made', async () => {
    const { calls, deps: d } = deps();
    const outcome = await submitHeldAnswers(
      { account: ACCOUNT, consent: CONSENT, held: DEFAULT_HELD_ANSWERS },
      d,
    );
    expect(outcome).toEqual({ kind: 'ok', connection: null });
    expect(calls).toEqual(['createSuperAdmin']);
  });

  it('trims what it sends — a pasted email carries whitespace', async () => {
    const { deps: d } = deps();
    await submitHeldAnswers({ account: ACCOUNT, consent: CONSENT, held: DEFAULT_HELD_ANSWERS }, d);
    expect(d.createSuperAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'ada@example.com', name: 'Ada' }),
    );
  });
});

describe('with a connection held', () => {
  const held = { ...DEFAULT_HELD_ANSWERS, dsn: 'postgres://user@host:5432/northwind', start: 'crud' as const };

  it('creates the account BEFORE it touches an authenticated endpoint', async () => {
    const { calls, deps: d } = deps();
    await submitHeldAnswers({ account: ACCOUNT, consent: CONSENT, held }, d);
    expect(calls[0]).toBe('createSuperAdmin');
    expect(calls).toEqual([
      'createSuperAdmin',
      'testDsn',
      'createConnection',
      'introspect',
      'getSchema',
    ]);
  });

  it('records the starting point as the connection intent', async () => {
    const { deps: d } = deps();
    await submitHeldAnswers({ account: ACCOUNT, consent: CONSENT, held }, d);
    expect(d.createConnection).toHaveBeenCalledWith(
      expect.objectContaining({ settings: { intent: 'crud' }, name: 'northwind' }),
    );
  });

  it('records NO intent for a blank canvas — generating nothing is not an intent', async () => {
    const { deps: d } = deps();
    await submitHeldAnswers(
      { account: ACCOUNT, consent: CONSENT, held: { ...held, start: 'blank' } },
      d,
    );
    const call = vi.mocked(d.createConnection).mock.calls[0]?.[0];
    expect(call).not.toHaveProperty('settings');
  });

  it('reports what it learned, table count included', async () => {
    const { deps: d } = deps();
    const outcome = await submitHeldAnswers({ account: ACCOUNT, consent: CONSENT, held }, d);
    expect(outcome).toEqual({
      kind: 'ok',
      connection: {
        connectionId: 'con_1',
        engine: 'postgres',
        tableCount: 3,
        serverVersion: 'PostgreSQL 16.2',
        latencyMs: 12,
        readOnly: false,
        privileges: null,
      },
    });
  });

  it('does not wait on an introspection job — the Studio wizard owns that', async () => {
    const { calls, deps: d } = deps({
      introspect: vi.fn(async () => ({ kind: 'job', jobId: 'job_1' }) as never),
    });
    const outcome = await submitHeldAnswers({ account: ACCOUNT, consent: CONSENT, held }, d);
    expect(calls).not.toContain('getSchema');
    expect(outcome).toMatchObject({ kind: 'ok', connection: { tableCount: null } });
  });
});

describe('which engine it creates the connection as', () => {
  it('reads the DSN, not the card that was left behind', async () => {
    const { deps: d } = deps();
    await submitHeldAnswers(
      {
        account: ACCOUNT,
        consent: CONSENT,
        // The shape the e2e hit: a SQLite path typed while `engine` still says
        // postgres. Creating THAT connection as postgres is the bug.
        held: { ...DEFAULT_HELD_ANSWERS, engine: 'postgres', dsn: 'sqlite:/tmp/northwind.db' },
      },
      d,
    );
    expect(d.testDsn).toHaveBeenCalledWith('sqlite', 'sqlite:/tmp/northwind.db');
    expect(d.createConnection).toHaveBeenCalledWith(expect.objectContaining({ engine: 'sqlite' }));
  });

  it('falls back to the picked card when the string parses as nothing', async () => {
    const { deps: d } = deps();
    await submitHeldAnswers(
      { account: ACCOUNT, consent: CONSENT, held: { ...DEFAULT_HELD_ANSWERS, engine: 'mysql', dsn: 'host/db' } },
      d,
    );
    expect(d.testDsn).toHaveBeenCalledWith('mysql', 'host/db');
  });
});

describe('when something fails', () => {
  const held = { ...DEFAULT_HELD_ANSWERS, dsn: 'postgres://user@host:5432/db' };

  it('runs nothing else when the account cannot be created', async () => {
    const { calls, deps: d } = deps({
      createSuperAdmin: vi.fn(async () => {
        throw new Error('409');
      }),
    });
    const outcome = await submitHeldAnswers({ account: ACCOUNT, consent: CONSENT, held }, d);
    expect(outcome.kind).toBe('account-failed');
    expect(calls).toEqual([]);
  });

  it('keeps the account when the database refuses — that is what lets you retry', async () => {
    const { calls, deps: d } = deps({
      testDsn: vi.fn(async () => ({
        ok: false,
        latencyMs: 4,
        serverVersion: null,
        readOnly: false,
        privileges: null,
        error: { code: 'AUTH_FAILED', message: 'password authentication failed', hint: null },
      })),
    });
    const outcome = await submitHeldAnswers({ account: ACCOUNT, consent: CONSENT, held }, d);
    expect(outcome.kind).toBe('connection-failed');
    expect(calls).toContain('createSuperAdmin');
    expect(calls).not.toContain('createConnection');
  });
});

describe('naming a connection nobody was asked to name', () => {
  it('uses the database name', () => {
    expect(connectionNameFromDsn('postgres://user:pw@host:5432/northwind', 'postgres')).toBe('northwind');
    expect(connectionNameFromDsn('mysql://user@host:3306/shop?ssl=true', 'mysql')).toBe('shop');
  });

  it('uses the file name for SQLite, without its extension', () => {
    expect(connectionNameFromDsn('sqlite:/var/lib/adminium/shop.db', 'sqlite')).toBe('shop');
    expect(connectionNameFromDsn('sqlite:./data/app.sqlite3', 'sqlite')).toBe('app');
  });

  it('falls back rather than failing a setup over a name', () => {
    expect(connectionNameFromDsn('postgres://user@host:5432/', 'postgres')).toBe('PostgreSQL');
    expect(connectionNameFromDsn('sqlite:', 'sqlite')).toBe('SQLite');
  });

  it('survives a password that would break `new URL()`', () => {
    expect(connectionNameFromDsn('postgres://user:p@ss w/ord@host:5432/db', 'postgres')).toBe('db');
  });
});
