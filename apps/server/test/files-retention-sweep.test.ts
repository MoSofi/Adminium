// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The daily files-retention sweep (`compose.ts` FILES_RETENTION_SCHEDULE_NAME,
 * 37-files-and-storage.md D12, 37-T14) — §6 criterion 8's second clause:
 * "delete → 31 days → the object is gone from the driver and the row purged".
 *
 * WHAT WAS UNTESTED. `files-reconcile.test.ts` covers this window by calling
 * `filesRepo.listDeletedBefore` and asserting what it RETURNS. That is the
 * sweep's worklist, not the sweep: nothing in it removes a byte or purges a
 * row, so the two things the criterion actually promises had no test at all —
 * and a sweep that built a perfect worklist and then did nothing with it would
 * have passed. These assertions go through `scheduler.trigger()`, which is the
 * only caller the sweep body has.
 *
 * The bytes are real and so is the driver: the files land under
 * `<ADMINIUM_DATA_DIR>/files` and are gone from there afterwards. The one thing
 * wrapped is `createLocalDriver`, so `remove` can be COUNTED as well as
 * observed — "the object is gone" and "the sweep asked for exactly this key,
 * once" are different claims, and the second is what says the sweep did not
 * reach for the survivor's bytes and get away with it because `rm --force`
 * treats a missing object as success.
 */
import BetterSqlite3 from 'better-sqlite3';
import {
  createSqliteMetaDb,
  filesRepo,
  firstRun,
  settingsRepo,
  type MetaDb,
  type StoredFile,
} from '@adminium/meta';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Hoisted: the mock factory runs during the hoisted import of `compose.js`. */
const removed = vi.hoisted(() => ({ keys: [] as string[] }));

vi.mock('../src/files/drivers/local.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/files/drivers/local.js')>();
  return {
    ...actual,
    createLocalDriver(opts: Parameters<typeof actual.createLocalDriver>[0]) {
      const driver = actual.createLocalDriver(opts);
      // Delegating, not replacing: every other method is the real one, and
      // `remove` still deletes the real file. The wrapper only records.
      return {
        ...driver,
        async remove(key: string): Promise<void> {
          removed.keys.push(key);
          await driver.remove(key);
        },
      };
    },
  };
});

import { composeServer, FILES_RETENTION_SCHEDULE_NAME, type ComposedServer } from '../src/compose.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { FILES_DIR } from '../src/files/drivers/local.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import type { MetaStoreHandle } from '../src/meta/store.js';
import { makeEnv, TEST_SECRET } from './helpers.js';

const DAY_MS = 86_400_000;

let composed: ComposedServer | undefined;
let dataDir: string;

beforeEach(() => {
  removed.keys.length = 0;
  dataDir = mkdtempSync(join(tmpdir(), 'adminium-files-retention-'));
});

afterEach(async () => {
  await composed?.app.close();
  composed = undefined;
  rmSync(dataDir, { recursive: true, force: true });
});

async function compose(): Promise<{ meta: MetaDb; server: ComposedServer }> {
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);

  const storeHandle: MetaStoreHandle = {
    meta,
    url: 'sqlite::memory:',
    engine: 'sqlite',
    source: 'embedded',
    close: async () => Promise.resolve(),
  };
  const manager = new ConnectionManager({
    meta,
    crypto: dsnCryptoFromSecret(TEST_SECRET),
    metaDsn: null,
  });
  const runService = createRunService({ meta });

  composed = await composeServer({
    env: makeEnv({ ADMINIUM_DATA_DIR: dataDir }),
    metaStore: storeHandle,
    manager,
    runService,
    applyService: createApplyService({ meta, runService }),
    allowed: null,
    logger: false,
    // The telemetry schedule would otherwise hold the process open past the
    // test; the sweep under test is registered unconditionally.
    telemetry: false,
  });
  return { meta, server: composed };
}

/**
 * A stored upload with REAL bytes at the implicit destination, already in the
 * trash as of `deletedAt`.
 *
 * `filesRepo.create` defaults `storage_key` to the row id, which is the
 * `file_<ULID>` grammar the local driver's guard accepts — so the byte path is
 * `<dataDir>/files/<id>`, exactly where the driver will look for it.
 */
async function trashedUpload(meta: MetaDb, filename: string, deletedAt: number): Promise<StoredFile> {
  const files = filesRepo(meta);
  const row = await files.create({
    filename,
    mime: 'application/pdf',
    sizeBytes: 9,
    sha256: 'a'.repeat(64),
    kind: 'upload',
  });
  await mkdir(join(dataDir, FILES_DIR), { recursive: true });
  await writeFile(join(dataDir, FILES_DIR, row.storageKey), '%PDF-1.7\n');
  await files.markDeleted(row.id, deletedAt);
  return row;
}

function bytesPath(file: StoredFile): string {
  return join(dataDir, FILES_DIR, file.storageKey);
}

describe('the trash purge (§6 criterion 8, 37 D12)', () => {
  it('removes the bytes and purges the row past retention.filesTrashDays, and only then', async () => {
    const { meta, server } = await compose();
    const files = filesRepo(meta);
    // 30 days is the shipped default, which is what makes 31 the criterion's
    // number and 2 comfortably inside the window.
    expect(await settingsRepo(meta).get('retention.filesTrashDays')).toBe(30);
    const now = Date.now();

    const due = await trashedUpload(meta, 'long-gone.pdf', now - 31 * DAY_MS);
    const recent = await trashedUpload(meta, 'deleted-yesterday.pdf', now - 2 * DAY_MS);

    await server.jobs.scheduler.trigger(FILES_RETENTION_SCHEDULE_NAME);

    // The object is gone FROM THE DRIVER — asked for once, by its own key, and
    // no key belonging to anything else.
    //
    // KNOWN LIMIT OF THIS ASSERTION, stated rather than papered over: on the
    // LOCAL driver `storageKey` IS the row id — `drivers/local.ts` `keyFor`
    // returns `file.id` and its header explains why (the grammar is the
    // traversal guard). So `[due.storageKey]` and `[due.id]` are the same
    // array here, and this cannot catch a sweep that passed the id where the
    // key belongs. That bug is only reachable on `s3`/`webdav`, whose keys
    // are dated paths — catching it needs a sweep test against one of those
    // drivers, which is 27-T49's MinIO leg, not this file.
    expect(removed.keys).toEqual([due.storageKey]);
    expect(existsSync(bytesPath(due))).toBe(false);
    // …and the row with it. A row left behind would be retried forever; bytes
    // left behind with no row are unreachable garbage.
    expect(await files.findById(due.id)).toBeNull();

    // The one inside the window is untouched in both halves — still trashed,
    // still restorable, still holding its bytes.
    const survivor = await files.findById(recent.id);
    expect(survivor).not.toBeNull();
    expect(survivor?.deletedAt).toBe(now - 2 * DAY_MS);
    expect(await readFile(bytesPath(recent), 'utf8')).toBe('%PDF-1.7\n');
  });

  it('reads retention.filesTrashDays rather than a hardcoded window', async () => {
    const { meta, server } = await compose();
    const files = filesRepo(meta);
    const now = Date.now();
    // 5 days is inside the 30-day default and outside a 1-day override: one
    // row, two policies, and only the setting decides which way it goes.
    const file = await trashedUpload(meta, 'policy.pdf', now - 5 * DAY_MS);

    await server.jobs.scheduler.trigger(FILES_RETENTION_SCHEDULE_NAME);
    expect(removed.keys).toEqual([]);
    expect(await files.findById(file.id)).not.toBeNull();

    await settingsRepo(meta).set('retention.filesTrashDays', 1, { updatedBy: null });
    await server.jobs.scheduler.trigger(FILES_RETENTION_SCHEDULE_NAME);
    expect(removed.keys).toEqual([file.storageKey]);
    expect(existsSync(bytesPath(file))).toBe(false);
    expect(await files.findById(file.id)).toBeNull();
  });
});

/**
 * The UNATTACHED half of the same sweep, and the one 38 D4 had to be designed
 * around (`compose.ts`, `filesRepo.listUnattachedBefore`).
 *
 * The sweep asks `attached_at IS NULL`, which reads naturally as "no record
 * points at this" — and for a file uploaded from the Files page that is true
 * and permanent. So a library file that recorded only its connection would be
 * collected on the first nightly tick after `files.unattachedHours`, and the
 * operator would find their library empty in the morning with nothing in any
 * log to explain it. `attached_at` therefore means CLAIMED, and a library
 * upload stamps it; the create form's upload does not, because a write really
 * is coming to claim that one.
 *
 * Both halves are asserted in ONE sweep run, because the interesting claim is
 * that the same tick treats them differently.
 */
describe('a library file is not an abandoned upload (38 D4)', () => {
  /** A live upload with real bytes: `claimed` decides whether it is stamped. */
  async function upload(
    meta: MetaDb,
    filename: string,
    opts: { createdAt: number; connectionId: string; claimed: boolean },
  ): Promise<StoredFile> {
    const files = filesRepo(meta);
    const row = await files.create(
      {
        filename,
        mime: 'application/pdf',
        sizeBytes: 9,
        sha256: 'b'.repeat(64),
        kind: 'upload',
        entityConnectionId: opts.connectionId,
        ...(opts.claimed ? { attachedAt: opts.createdAt } : {}),
      },
      opts.createdAt,
    );
    await mkdir(join(dataDir, FILES_DIR), { recursive: true });
    await writeFile(join(dataDir, FILES_DIR, row.storageKey), '%PDF-1.7\n');
    return row;
  }

  it('survives the sweep that collects an abandoned create-form upload of the same age', async () => {
    const { meta, server } = await compose();
    const files = filesRepo(meta);
    // Two days old: well past the 24-hour `files.unattachedHours` default, so
    // age is not what separates them.
    const createdAt = Date.now() - 2 * DAY_MS;

    const library = await upload(meta, 'price-list.pdf', { createdAt, connectionId: 'conn_1', claimed: true });
    const abandoned = await upload(meta, 'draft.pdf', { createdAt, connectionId: 'conn_1', claimed: false });

    await server.jobs.scheduler.trigger(FILES_RETENTION_SCHEDULE_NAME);

    // The abandoned one is TRASHED, not purged — the trash half of the same
    // sweep only touches rows already past `retention.filesTrashDays`.
    expect((await files.findById(abandoned.id))?.deletedAt).not.toBeNull();
    expect((await files.findById(library.id))?.deletedAt).toBeNull();
    // And no bytes were removed on this tick either way.
    expect(removed.keys).toEqual([]);
  });

  it('is not returned by the sweep’s own worklist', async () => {
    const { meta } = await compose();
    const files = filesRepo(meta);
    const createdAt = Date.now() - 2 * DAY_MS;
    await upload(meta, 'price-list.pdf', { createdAt, connectionId: 'conn_1', claimed: true });

    // The query the sweep runs, asserted directly: a stamp is the only thing
    // keeping the row out of it.
    expect(await files.listUnattachedBefore(Date.now())).toEqual([]);
  });
});
