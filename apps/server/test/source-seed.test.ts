// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The first-boot source-connection seed (28-public-surface.md 28-T31).
 *
 * These are the four answers `config/env.ts` demanded before this feature was
 * allowed to exist, one describe block each: probe before storing, a bad DSN
 * does not stop the boot, idempotent across restarts, and a row deleted later
 * stays deleted. The fifth block covers the retry that the second claim key
 * exists for.
 *
 * Offline: sqlite meta store, a stub adapter whose `test()` result the case
 * chooses, and `runIntrospection`/`runGeneration` mocked — the same seam
 * `cli-init.test.ts` uses on the same four-call chain. `source-seed-e2e.test.ts`
 * runs that chain unmocked against a real database; here the subject is the
 * state machine around it.
 */
import BetterSqlite3 from 'better-sqlite3';
import { createSqliteMetaDb, firstRun, settingsRepo, type MetaDb } from '@adminium/meta';
import { AdapterRegistry, type AdapterProvider } from '@adminium/engine/adapter';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/connections/introspect.js', () => ({ runIntrospection: vi.fn() }));
vi.mock('../src/generate/run.js', () => ({ runGeneration: vi.fn() }));

import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { seedSourceConnection } from '../src/connections/seed.js';

const { runIntrospection } = await import('../src/connections/introspect.js');
const { runGeneration } = await import('../src/generate/run.js');

const DSN = 'postgres://app:secret@db.internal:5432/shop';
const OTHER_DSN = 'postgres://app:secret@db.internal:5432/shop_corrected';

/** Minimal adapter: `testDsn` only calls create/test/probeCapabilities/close. */
function stubProvider(outcome: { ok: boolean; message?: string; hint?: string | null }) {
  return {
    dialect: 'postgres',
    create: () => ({
      test: async () =>
        outcome.ok
          ? { ok: true, latencyMs: 3, serverVersion: 'PostgreSQL 16', canWrite: true }
          : {
              ok: false,
              latencyMs: 0,
              serverVersion: null,
              canWrite: false,
              error: {
                code: 'CONNECTION_REFUSED',
                message: outcome.message ?? 'could not connect',
                hint: outcome.hint ?? null,
              },
            },
      probeCapabilities: async () => ({
        capabilities: {},
        privileges: { canReadSchema: true, canRead: true, canWrite: true, canDDL: true },
        serverVersion: 'PostgreSQL 16',
        currentRole: { name: 'app', readOnly: false },
      }),
      close: async () => undefined,
    }),
    createQueryEngine: () => ({}),
  } as unknown as AdapterProvider;
}

interface Harness {
  meta: MetaDb;
  manager: ConnectionManager;
  lines: { out: string[]; err: string[] };
  seed: (dsn?: string) => ReturnType<typeof seedSourceConnection>;
}

function harness(outcome: { ok: boolean; message?: string; hint?: string | null }): Harness {
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  const registry = new AdapterRegistry<AdapterProvider>();
  registry.register(stubProvider(outcome));
  const manager = new ConnectionManager({
    meta,
    crypto: dsnCryptoFromSecret('seed-test-secret'),
    registry,
    metaDsn: null,
    blockLoopback: false,
  });
  const lines = { out: [] as string[], err: [] as string[] };
  return {
    meta,
    manager,
    lines,
    seed: (dsn = DSN) =>
      seedSourceConnection({
        manager,
        meta,
        sourceUrl: dsn,
        log: (message) => lines.out.push(message),
        warn: (message) => lines.err.push(message),
      }),
  };
}

beforeEach(() => {
  vi.mocked(runIntrospection).mockReset();
  vi.mocked(runGeneration).mockReset();
  vi.mocked(runIntrospection).mockResolvedValue({
    snapshot: { schema: { tables: [{ name: 'orders' }, { name: 'customers' }] } },
    noop: false,
    proposedMasks: 0,
  } as never);
  vi.mocked(runGeneration).mockResolvedValue({
    pages: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }],
    navGroups: ['Shop'],
    warnings: [],
  } as never);
});

describe('answer 1 — validate and probe before storing', () => {
  it('connects, introspects, generates, and reports what it found', async () => {
    const h = harness({ ok: true });
    await firstRun(h.meta);

    const result = await h.seed();

    expect(result).toMatchObject({ kind: 'seeded', tables: 2, pages: 3 });
    expect(vi.mocked(runIntrospection)).toHaveBeenCalledOnce();
    expect(vi.mocked(runGeneration)).toHaveBeenCalledOnce();
    const [connection] = await h.manager.connections.list();
    expect(connection).toMatchObject({ status: 'connected', engine: 'postgres' });
    // Named for the database, which is what the operator recognises in Studio.
    expect(connection?.name).toBe('shop');
  });

  it('stores the DSN encrypted, and never prints the password', async () => {
    const h = harness({ ok: true });
    await firstRun(h.meta);

    await h.seed();

    const [connection] = await h.manager.connections.list();
    const row = await h.meta.db
      .selectFrom('adminium_connections')
      .select('introspectDsnEncrypted')
      .where('id', '=', connection!.id)
      .executeTakeFirstOrThrow();
    expect(row.introspectDsnEncrypted).not.toContain('secret');
    expect(await h.manager.connections.getDsns(connection!.id)).toMatchObject({
      introspectDsn: DSN,
    });
    // The boot log is a container log. It carries the mask, never the secret.
    expect([...h.lines.out, ...h.lines.err].join('\n')).not.toContain('secret');
    expect(h.lines.out.join('\n')).toContain('postgres://app@db.internal:5432/shop');
  });

  it('refuses a scheme no adapter can serve, and stores nothing', async () => {
    // Nothing to put an error ON: the engine is what the row is keyed by, and
    // parsing is what decides it. This is the one failure with no row.
    const h = harness({ ok: true });
    await firstRun(h.meta);

    const result = await h.seed('mongodb://host/db');

    expect(result.kind).toBe('refused');
    expect(await h.manager.connections.list()).toHaveLength(0);
    expect(await settingsRepo(h.meta).get('system.sourceConnectionId')).toBeNull();
    expect(h.lines.err.join('\n')).toContain('Unsupported DSN scheme');
  });

  it('records what the probe found rather than what the environment claimed', async () => {
    const h = harness({ ok: true });
    await firstRun(h.meta);

    await h.seed();

    const [connection] = await h.manager.connections.list();
    expect(connection?.readOnly).toBe(false);
    expect(connection?.lastLatencyMs).toBe(3);
    expect(connection?.lastTestedAt).not.toBeNull();
  });
});

describe('answer 2 — a bad DSN does not stop the boot', () => {
  it('resolves, leaves the connection in error, and says how to fix it', async () => {
    const h = harness({ ok: false, message: 'could not connect', hint: 'check the port' });
    await firstRun(h.meta);

    const result = await h.seed();

    expect(result.kind).toBe('failed');
    const [connection] = await h.manager.connections.list();
    expect(connection?.status).toBe('error');
    expect(connection?.lastError).toBe('could not connect');
    expect(connection?.lastErrorHint).toBe('check the port');
    expect(h.lines.err.join('\n')).toContain('Adminium started anyway');
    // Never generated against a database it could not reach.
    expect(vi.mocked(runGeneration)).not.toHaveBeenCalled();
  });

  it('never throws, even with an unmigrated store under --skip-migrate', async () => {
    // `adminium start` is a container's PID 1. There is no failure here worth
    // not booting the dashboard over.
    const h = harness({ ok: true });
    // No firstRun: adminium_settings does not exist.

    await expect(h.seed()).resolves.toMatchObject({ kind: 'refused' });
    expect(h.lines.err.join('\n')).toContain('Could not seed the source connection');
  });

  it('does not claim a healthy seed when the probe failed', async () => {
    const h = harness({ ok: false });
    await firstRun(h.meta);

    await h.seed();

    const settings = settingsRepo(h.meta);
    expect(await settings.get('system.sourceSeededAt')).toBeNull();
    // But it does remember WHICH row it made, or the retry would add another.
    expect(await settings.get('system.sourceConnectionId')).not.toBeNull();
  });
});

describe('answer 3 — idempotent across restarts', () => {
  it('does nothing on the second boot', async () => {
    const h = harness({ ok: true });
    await firstRun(h.meta);
    await h.seed();

    const again = await h.seed();

    expect(again).toEqual({ kind: 'skipped', reason: 'already-seeded' });
    expect(await h.manager.connections.list()).toHaveLength(1);
    expect(vi.mocked(runGeneration)).toHaveBeenCalledOnce();
  });

  it('ignores an instance that already has a connection of its own', async () => {
    // Someone who ran the wizard and later added the variable gets a note, not
    // a surprise second connection.
    const h = harness({ ok: true });
    await firstRun(h.meta);
    await h.manager.connections.create({
      name: 'mine',
      engine: 'postgres',
      introspectDsn: OTHER_DSN,
    });

    const result = await h.seed();

    expect(result).toEqual({ kind: 'skipped', reason: 'other-connections' });
    expect(await h.manager.connections.list()).toHaveLength(1);
    expect(h.lines.out.join('\n')).toContain('already has a connection');
  });
});

describe('answer 4 — a row deleted later stays deleted', () => {
  it('does not rebuild a seeded connection the operator removed', async () => {
    const h = harness({ ok: true });
    await firstRun(h.meta);
    const first = await h.seed();
    expect(first.kind).toBe('seeded');
    await h.manager.connections.delete((first as { connectionId: string }).connectionId);

    const again = await h.seed();

    expect(again).toEqual({ kind: 'skipped', reason: 'already-seeded' });
    expect(await h.manager.connections.list()).toHaveLength(0);
  });

  it('does not rebuild a FAILED attempt the operator removed either', async () => {
    // No healthy claim here, so this is the case that the claim alone cannot
    // answer — the id key is what says "there was one, and it is gone".
    const h = harness({ ok: false });
    await firstRun(h.meta);
    const failed = await h.seed();
    await h.manager.connections.delete((failed as { connectionId: string }).connectionId);

    const again = await h.seed();

    expect(again).toEqual({ kind: 'skipped', reason: 'row-deleted' });
    expect(await h.manager.connections.list()).toHaveLength(0);
  });
});

describe('the retry the second key exists for', () => {
  it('updates the row it made instead of adding one per restart', async () => {
    // THE TRAP THIS AVOIDS. `PATCH /connections/:id` takes `name` and
    // `settings` and NOT a DSN, so a stored bad DSN cannot be corrected
    // anywhere in the product. A claim written on failure would leave the
    // commonest mistake — a typo in the variable — with no fix at all.
    const h = harness({ ok: false });
    await firstRun(h.meta);
    await h.seed();
    await h.seed();
    await h.seed();

    expect(await h.manager.connections.list()).toHaveLength(1);
  });

  it('picks up a corrected DSN on the next boot and then claims', async () => {
    const failing = harness({ ok: false });
    await firstRun(failing.meta);
    await failing.seed();

    // Same store, same rows — a restart against an adapter that now answers.
    const registry = new AdapterRegistry<AdapterProvider>();
    registry.register(stubProvider({ ok: true }));
    const manager = new ConnectionManager({
      meta: failing.meta,
      crypto: dsnCryptoFromSecret('seed-test-secret'),
      registry,
      metaDsn: null,
      blockLoopback: false,
    });
    const result = await seedSourceConnection({
      manager,
      meta: failing.meta,
      sourceUrl: OTHER_DSN,
      log: () => undefined,
      warn: () => undefined,
    });

    expect(result.kind).toBe('seeded');
    const connections = await manager.connections.list();
    expect(connections).toHaveLength(1);
    expect(connections[0]?.status).toBe('connected');
    // The corrected variable reached the stored row.
    expect(await manager.connections.getDsns(connections[0]!.id)).toMatchObject({
      introspectDsn: OTHER_DSN,
    });
    expect(await settingsRepo(failing.meta).get('system.sourceSeededAt')).not.toBeNull();
  });
});

describe('generation that fails after a healthy connection', () => {
  it('still claims, and points at the fix that exists', async () => {
    // Unlike a bad DSN, this one IS fixable in the product: Studio generates
    // from a connected connection. Re-running generation on every boot forever
    // would be the worse failure.
    const h = harness({ ok: true });
    await firstRun(h.meta);
    vi.mocked(runGeneration).mockRejectedValue(new Error('no tables to generate from'));

    const result = await h.seed();

    expect(result.kind).toBe('seeded');
    expect(await settingsRepo(h.meta).get('system.sourceSeededAt')).not.toBeNull();
    expect(h.lines.err.join('\n')).toContain('Studio → Connections');
  });
});
