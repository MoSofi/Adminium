/**
 * Meta-store relocation (01-architecture.md §3.1, §7.2) — the service, the
 * retire step, and the host that restarts onto the moved store.
 *
 * The copy itself is `@adminium/meta`'s (`relocate.test.ts` exercises it across
 * every pair of dialects). What is under test here is the part that can lose
 * data: the ORDER. Every refusal below is asserted twice — that it throws, and
 * that the bootstrap file was not written — because the bootstrap write is the
 * commit point, and an instance that recorded a move it did not make would boot
 * into an empty database with its real store sitting untouched beside it.
 */
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyMigrations, createFirstSuperAdmin, firstRun } from '@adminium/meta';

import { bootstrapPath, readBootstrap, writeBootstrap } from '../src/config/bootstrap.js';
import {
  MetaAlreadyThereError,
  MetaRelocateError,
  MetaStoreNotEmptyError,
  MetaUrlPinnedError,
  relocateMetaStore,
  retireSqliteStore,
} from '../src/meta/relocate.js';
import { connectMetaStore, metaUrlCryptoFromSecret, type MetaStoreHandle } from '../src/meta/store.js';

const SECRET = 'a-sufficiently-long-test-secret';

let dir: string;
let from: MetaStoreHandle;

/** A store with a user in it, so "did the accounts come across" is answerable. */
async function openSeeded(path: string): Promise<MetaStoreHandle> {
  const handle = await connectMetaStore({ url: `sqlite:${path}`, engine: 'sqlite', source: 'embedded' });
  await firstRun(handle.meta);
  await createFirstSuperAdmin(handle.meta, {
    email: 'owner@example.com',
    name: 'Owner',
    passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$fake',
  });
  return handle;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'adminium-relocate-'));
  from = await openSeeded(join(dir, 'meta.db'));
});
afterEach(async () => {
  await from.close();
  await rm(dir, { recursive: true, force: true });
});

describe('relocateMetaStore', () => {
  it('copies the store and records the new DSN, leaving the source intact', async () => {
    const target = join(dir, 'moved.db');
    const result = await relocateMetaStore({
      from,
      toUrl: `sqlite:${target}`,
      secret: SECRET,
      dataDir: dir,
    });

    expect(result.engine).toBe('sqlite');
    expect(result.totalRows).toBeGreaterThan(0);
    expect(result.retiredSqlitePath).toBe(join(dir, 'meta.db'));

    // §7.2 rung 2 now answers with the new store, and the DSN is encrypted —
    // a meta DSN in plaintext on disk would be a credential leak.
    const bootstrap = await readBootstrap(dir);
    expect(bootstrap?.metaUrl).toBeDefined();
    expect(bootstrap?.metaUrl).not.toContain(target);
    expect(metaUrlCryptoFromSecret(SECRET).decrypt(bootstrap?.metaUrl as string)).toBe(
      `sqlite:${target}`,
    );

    // The user came across, and the SOURCE still has them — a move that
    // emptied the origin would make every failure unrecoverable.
    const moved = await connectMetaStore({ url: `sqlite:${target}`, engine: 'sqlite', source: 'bootstrap' });
    try {
      const users = await moved.meta.db.selectFrom('adminium_users').selectAll().execute();
      expect(users.map((user) => user.email)).toEqual(['owner@example.com']);
    } finally {
      await moved.close();
    }
    const original = await from.meta.db.selectFrom('adminium_users').selectAll().execute();
    expect(original).toHaveLength(1);
  });

  it('preserves an existing instanceId rather than minting a new one', async () => {
    await writeBootstrap(dir, {
      v: 1,
      createdAt: '2020-01-01T00:00:00.000Z',
      instanceId: 'instance-that-must-survive',
    });

    await relocateMetaStore({
      from,
      toUrl: `sqlite:${join(dir, 'moved.db')}`,
      secret: SECRET,
      dataDir: dir,
    });

    const bootstrap = await readBootstrap(dir);
    expect(bootstrap?.instanceId).toBe('instance-that-must-survive');
    expect(bootstrap?.createdAt).toBe('2020-01-01T00:00:00.000Z');
  });

  describe('refusals leave the instance exactly as it was', () => {
    /** No bootstrap file ⇒ nothing was committed. */
    const assertUncommitted = async (): Promise<void> => {
      expect(await readBootstrap(dir)).toBeNull();
    };

    it('refuses when ADMINIUM_META_URL pins the store', async () => {
      await expect(
        relocateMetaStore({
          from,
          toUrl: `sqlite:${join(dir, 'moved.db')}`,
          secret: SECRET,
          dataDir: dir,
          envMetaUrl: 'sqlite:/somewhere/pinned.db',
        }),
      ).rejects.toThrow(MetaUrlPinnedError);
      await assertUncommitted();
    });

    it('refuses to move a store onto itself', async () => {
      await expect(
        relocateMetaStore({ from, toUrl: from.url, secret: SECRET, dataDir: dir }),
      ).rejects.toThrow(MetaAlreadyThereError);
      await assertUncommitted();
    });

    it('sees through a relative path to the same file', async () => {
      // `storeIdentity` resolves before comparing, so `./meta.db` and the
      // absolute form are one store — otherwise this would "succeed" by
      // copying a store onto itself.
      await expect(
        relocateMetaStore({
          from,
          toUrl: `sqlite:${join(dir, '.', 'meta.db')}`,
          secret: SECRET,
          dataDir: dir,
        }),
      ).rejects.toThrow(MetaAlreadyThereError);
      await assertUncommitted();
    });

    it('refuses a target that already holds Adminium data', async () => {
      const occupied = join(dir, 'occupied.db');
      const other = await openSeeded(occupied);
      await other.close();

      await expect(
        relocateMetaStore({ from, toUrl: `sqlite:${occupied}`, secret: SECRET, dataDir: dir }),
      ).rejects.toThrow(MetaStoreNotEmptyError);
      await assertUncommitted();
    });

    it('refuses an in-memory target, which a restart would discard', async () => {
      await expect(
        relocateMetaStore({ from, toUrl: 'sqlite::memory:', secret: SECRET, dataDir: dir }),
      ).rejects.toThrow(MetaRelocateError);
      await assertUncommitted();
    });

    it('refuses a DSN it does not recognise', async () => {
      await expect(
        relocateMetaStore({ from, toUrl: 'mongodb://localhost/adminium', secret: SECRET, dataDir: dir }),
      ).rejects.toThrow(/Unsupported meta-store DSN/);
      await assertUncommitted();
    });
  });

  it('leaves a migrated-but-empty target behind when the copy is refused later', async () => {
    // The target of a failed relocation may legitimately end up with empty
    // adminium_ tables — migrations run before the emptiness check on the NEXT
    // attempt would then trip. Assert the second attempt still succeeds, since
    // "empty tables" is not "in use".
    const target = join(dir, 'moved.db');
    const handle = await connectMetaStore({ url: `sqlite:${target}`, engine: 'sqlite', source: 'bootstrap' });
    await applyMigrations(handle.meta.db, { dialect: handle.meta.dialect });
    await handle.close();

    const result = await relocateMetaStore({ from, toUrl: `sqlite:${target}`, secret: SECRET, dataDir: dir });
    expect(result.totalRows).toBeGreaterThan(0);
  });
});

describe('retireSqliteStore', () => {
  it('renames the store and reports where it went', async () => {
    const path = join(dir, 'meta.db');
    const result = await retireSqliteStore(path, new Date('2026-08-14T10:00:00.000Z'));

    expect('renamedTo' in result).toBe(true);
    if (!('renamedTo' in result)) return;
    expect(result.renamedTo).toBe(`${path}.relocated-2026-08-14T10-00-00-000Z`);
    await expect(stat(result.renamedTo)).resolves.toBeDefined();
    await expect(stat(path)).rejects.toThrow();
  });

  it('takes the WAL sidecars with it', async () => {
    const path = join(dir, 'meta.db');
    await writeFile(`${path}-wal`, 'wal');
    await writeFile(`${path}-shm`, 'shm');

    const result = await retireSqliteStore(path, new Date('2026-08-14T10:00:00.000Z'));
    expect('renamedTo' in result).toBe(true);
    if (!('renamedTo' in result)) return;

    // Leaving a `-wal` behind is the corruption `backup-archive.ts` documents:
    // SQLite validates a WAL by its own header, not against the database it
    // sits beside, so a future meta.db here would recover stale frames.
    await expect(stat(`${path}-wal`)).rejects.toThrow();
    await expect(stat(`${path}-shm`)).rejects.toThrow();
    await expect(stat(`${result.renamedTo}-wal`)).resolves.toBeDefined();
  });

  it('is fine when there are no sidecars', async () => {
    const result = await retireSqliteStore(join(dir, 'meta.db'));
    expect('renamedTo' in result).toBe(true);
  });

  it('reports rather than throws when the file is not there', async () => {
    const result = await retireSqliteStore(join(dir, 'no-such-store.db'));
    expect('error' in result).toBe(true);
  });
});

describe('createRelocationHost', () => {
  it('closes the old server and runtime, retires the file, then boots again', async () => {
    const { createRelocationHost } = await import('../src/cli/relocation-host.js');
    const order: string[] = [];

    const closeServer = vi.fn(async () => {
      order.push('server.close');
    });
    const closeRuntime = vi.fn(async () => {
      order.push('runtime.close');
    });
    const runtime = { close: closeRuntime, metaStore: {} } as never;
    const openRuntime = vi.fn(async () => {
      order.push('openRuntime');
      return runtime;
    });
    const startServer = vi.fn(async () => {
      order.push('startServer');
      return {
        url: 'http://localhost:4600',
        bridgePairingCode: null,
        app: { log: { info: vi.fn(), error: vi.fn() } },
        close: closeServer,
      } as never;
    });

    const retiredPath = join(dir, 'meta.db');
    const host = createRelocationHost({
      env: { ADMINIUM_DATA_DIR: dir, ADMINIUM_SECRET: SECRET } as never,
      deps: { openRuntime, startServer } as never,
      log: () => undefined,
      schedule: (task) => {
        task();
      },
    });

    await host.start(runtime);
    expect(order).toEqual(['startServer']);

    host.onMetaRelocated({ url: 'sqlite:moved.db', engine: 'sqlite', retiredSqlitePath: retiredPath });

    // `onMetaRelocated` returns void by design — its caller is an HTTP handler
    // whose reply is already on the wire — so there is no promise to await, and
    // the rebuild does real filesystem work between the teardown and the boot.
    // Wait on the observable end state rather than on a fixed number of ticks.
    await vi.waitFor(() => {
      expect(order).toHaveLength(5);
    });

    // The runtime closes BEFORE the rename: it owns the better-sqlite3 handle,
    // and Windows refuses to rename an open file.
    expect(order).toEqual([
      'startServer',
      'server.close',
      'runtime.close',
      'openRuntime',
      'startServer',
    ]);
    await expect(stat(retiredPath)).rejects.toThrow();

    // The second boot passes NO runtime, so it re-resolves through the
    // bootstrap file the relocation wrote — that is how it lands on the new
    // store without anyone threading the DSN through.
    expect(openRuntime).toHaveBeenCalledOnce();
  });
});

describe('bootstrap file placement', () => {
  it('writes next to the data dir the CLI was given', async () => {
    await relocateMetaStore({
      from,
      toUrl: `sqlite:${join(dir, 'moved.db')}`,
      secret: SECRET,
      dataDir: dir,
    });
    const raw = JSON.parse(await readFile(bootstrapPath(dir), 'utf8')) as { metaUrl?: string };
    expect(raw.metaUrl?.startsWith('enc:')).toBe(true);
  });
});
