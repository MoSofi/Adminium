// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Opening a project's meta store outside `start` (`cli/project-store.ts`):
 * `pull` refuses a store with updates still to apply, and `new` over an
 * existing instance snapshots and updates it, but never opens one written by
 * a newer Adminium.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import {
  ALL_MIGRATIONS,
  applyMigrations,
  createSqliteMetaDb,
  destroyMetaDb,
  initMetaDb,
  migrationStatus,
} from '@adminium/meta';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CliError, EXIT_CONFIG } from '../src/cli/exit.js';
import { readyMetaStore } from '../src/cli/project-store.js';
import type { CliRuntime } from '../src/cli/runtime.js';
import type { Env } from '../src/config/env.js';
import { openMetaStore, type MetaStoreHandle } from '../src/meta/store.js';
import { fakeIo, TEST_SECRET } from './cli-helpers.js';

let dir: string;
let metaPath: string;
let handle: MetaStoreHandle | null = null;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'adminium-project-store-'));
  metaPath = join(dir, 'meta.db');
});
afterEach(async () => {
  await handle?.close();
  handle = null;
  await rm(dir, { recursive: true, force: true });
});

/** A store as the previous release left it: every migration but the last. */
async function installedAtPreviousVersion(): Promise<void> {
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(metaPath) });
  await initMetaDb(meta);
  await applyMigrations(meta.db, { dialect: 'sqlite', migrations: ALL_MIGRATIONS.slice(0, -1) });
  await destroyMetaDb(meta);
}

async function open(): Promise<{ runtime: CliRuntime; env: Env; pending: () => Promise<number> }> {
  const store = await openMetaStore({ metaUrl: `sqlite:${metaPath}`, dataDir: dir, secret: TEST_SECRET });
  handle = store;
  return {
    runtime: { metaStore: store } as unknown as CliRuntime,
    env: { ADMINIUM_DATA_DIR: dir, ADMINIUM_SECRET: TEST_SECRET } as Env,
    pending: async () =>
      (await migrationStatus(store.meta.db, { dialect: store.meta.dialect })).filter((entry) => !entry.applied).length,
  };
}

describe('reading a project store', () => {
  it('refuses one with updates to apply, and leaves it as it was', async () => {
    await installedAtPreviousVersion();
    const { runtime, env, pending } = await open();
    const io = fakeIo({ interactive: false });
    const refusal = readyMetaStore({ runtime, env, io, migrate: false });
    await expect(refusal).rejects.toBeInstanceOf(CliError);
    await expect(refusal).rejects.toMatchObject({
      message: "This project's database needs 1 update(s) before it can be read.",
      hint: 'Start the project once, which applies them:  npm run dev',
    });
    expect(await pending()).toBe(1);
  });

  it('reads one that is up to date', async () => {
    await installedAtPreviousVersion();
    const { runtime, env, pending } = await open();
    await readyMetaStore({ runtime, env, io: fakeIo(), migrate: true });
    expect(await pending()).toBe(0);
    await expect(readyMetaStore({ runtime, env, io: fakeIo(), migrate: false })).resolves.toBeUndefined();
  });
});

describe('adopting a project store', () => {
  it('snapshots it, then applies the updates', async () => {
    await installedAtPreviousVersion();
    const { runtime, env, pending } = await open();
    const io = fakeIo({ interactive: false });
    await readyMetaStore({ runtime, env, io, migrate: true });
    expect(io.stdout()).toMatch(/Snapshotted the meta store to .+ before applying 1 pending migration\(s\)\./);
    expect(await pending()).toBe(0);
  });

  it('refuses a store a newer Adminium wrote', async () => {
    await installedAtPreviousVersion();
    const { runtime, env } = await open();
    await readyMetaStore({ runtime, env, io: fakeIo(), migrate: true });
    await runtime.metaStore.meta.db
      .insertInto('adminium_migrations')
      .values({ name: '9999_from_the_future', checksum: 'f'.repeat(64), appliedAt: Date.now(), durationMs: 1, adminiumVersion: '9.0.0' })
      .execute();
    const refusal = readyMetaStore({ runtime, env, io: fakeIo(), migrate: true });
    await expect(refusal).rejects.toMatchObject({
      code: EXIT_CONFIG,
      message: 'This database was migrated by a NEWER Adminium than the one running — refusing to touch it.',
      hint: expect.stringContaining('9.0.0'),
    });
  });
});
