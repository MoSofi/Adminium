// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The daily files sweep (`compose.ts` FILES_RETENTION_SCHEDULE_NAME), pass by
 * pass, on every meta engine this run can reach: a pass that cannot finish a
 * file moves past it and ends, a kind the purge leaves alone never stands in
 * front of the uploads it purges, and an upload a save named after the sweep
 * listed it stays out of the bin.
 */
import { filesRepo, type MetaDb, type StoredFile } from '@adminium/meta';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Hoisted: the mock factories run during the hoisted import of `compose.js`. */
const driver = vi.hoisted(() => ({ removes: 0, failing: new Set<string>() }));
const race = vi.hoisted(() => ({ save: null as ((file: { id: string }) => Promise<void>) | null }));

vi.mock('../src/files/drivers/local.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/files/drivers/local.js')>();
  return {
    ...actual,
    createLocalDriver(opts: Parameters<typeof actual.createLocalDriver>[0]) {
      const real = actual.createLocalDriver(opts);
      return {
        ...real,
        async remove(key: string): Promise<void> {
          driver.removes += 1;
          // A bucket whose credentials were revoked: these never go. Past a
          // bound they give way, so a pass that keeps listing them still ends.
          if (driver.failing.has(key) && driver.removes <= 1000) throw new Error('AccessDenied');
          await real.remove(key);
        },
      };
    },
  };
});

vi.mock('@adminium/meta', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@adminium/meta')>();
  return {
    ...actual,
    filesRepo(meta: Parameters<typeof actual.filesRepo>[0]) {
      const repo = actual.filesRepo(meta);
      return {
        ...repo,
        // A save that names a listed upload lands between the sweep's list and its bin.
        async listUnattachedBefore(...args: Parameters<typeof repo.listUnattachedBefore>) {
          const listed = await repo.listUnattachedBefore(...args);
          const save = race.save;
          race.save = null;
          if (save !== null && listed[0] !== undefined) await save(listed[0]);
          return listed;
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
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

for (const engine of META_ENGINES) {
  describe.skipIf(!engine.available)(`the files sweep, pass by pass [${engine.name}]`, () => {
    let handle: MetaHandle;
    let composed: ComposedServer;
    let meta: MetaDb;
    let dataDir: string;

    beforeEach(async () => {
      driver.removes = 0;
      driver.failing.clear();
      race.save = null;
      dataDir = mkdtempSync(join(tmpdir(), 'adminium-sweep-passes-'));
      handle = await engine.make();
      meta = handle.meta;
      const store: MetaStoreHandle = { meta, url: `${engine.name}:test`, engine: engine.name, source: 'embedded', close: async () => Promise.resolve() };
      const manager = new ConnectionManager({ meta, crypto: dsnCryptoFromSecret(TEST_SECRET), metaDsn: null });
      const runService = createRunService({ meta });
      composed = await composeServer({
        env: makeEnv({ ADMINIUM_DATA_DIR: dataDir }),
        metaStore: store,
        manager,
        runService,
        applyService: createApplyService({ meta, runService }),
        allowed: null,
        logger: false,
        telemetry: false,
      });
    });

    afterEach(async () => {
      await composed?.app.close();
      await handle?.destroy();
      rmSync(dataDir, { recursive: true, force: true });
    });

    /** A stored file with real bytes at the implicit destination, made `createdAt`. */
    async function stored(kind: 'upload' | 'export', createdAt: number): Promise<StoredFile> {
      const row = await filesRepo(meta).create({ filename: `${kind}.pdf`, mime: 'application/pdf', sizeBytes: 9, sha256: 'a'.repeat(64), kind }, createdAt);
      await mkdir(join(dataDir, FILES_DIR), { recursive: true });
      await writeFile(join(dataDir, FILES_DIR, row.storageKey), '%PDF-1.7\n');
      return row;
    }

    it('moves past trashed uploads whose bytes will not go, and ends', async () => {
      const files = filesRepo(meta);
      const old = Date.now() - 40 * DAY_MS;
      for (let i = 0; i < 150; i += 1) {
        const file = await stored('upload', old);
        await files.markDeleted(file.id, old);
        driver.failing.add(file.storageKey);
      }
      await composed.jobs.scheduler.trigger(FILES_RETENTION_SCHEDULE_NAME);
      // Each asked once: a pass that listed them again would ask a thousand times.
      expect(driver.removes).toBe(150);
    }, 60_000);

    it('purges trashed uploads behind more trashed exports than a page holds', async () => {
      const files = filesRepo(meta);
      const old = Date.now() - 40 * DAY_MS;
      for (let i = 0; i < 120; i += 1) await files.markDeleted((await stored('export', old)).id, old - DAY_MS);
      const upload = await stored('upload', old);
      await files.markDeleted(upload.id, old);
      await composed.jobs.scheduler.trigger(FILES_RETENTION_SCHEDULE_NAME);
      expect(await files.findById(upload.id)).toBeNull();
    }, 60_000);

    it('leaves out of the bin an upload a save named after the sweep listed it', async () => {
      const files = filesRepo(meta);
      const upload = await stored('upload', Date.now() - 30 * HOUR_MS);
      race.save = async (file) => {
        await files.attach(file.id, { connectionId: 'con_kitchen', table: 'main.dishes', pk: { id: 7 }, label: '7' });
      };
      await composed.jobs.scheduler.trigger(FILES_RETENTION_SCHEDULE_NAME);
      expect(race.save).toBeNull();
      expect(await files.findById(upload.id)).toMatchObject({ entityId: '7', deletedAt: null });
    }, 60_000);
  });
}
