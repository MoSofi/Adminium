// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0049 — `adminium_project_apps`, one row per app a project folder
 * carries: the manifest last applied, why the newest was not, and a removal
 * waiting for an answer.
 *
 * Runs on every available engine: `str(n)` is only a real width on PostgreSQL
 * and MySQL, and both hand a json column back parsed where SQLite hands back
 * the text, so the full-width key and the two json columns are read there too.
 */

import { describe, expect, it } from 'vitest';

import { projectAppsRepo } from '../src/index.js';
import { TEST_DIALECTS, migrateOnly, useMetaDb } from './helpers/db.js';

const HASH = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
/** The longest key an app may have. */
const LONG_KEY = `k${'x'.repeat(79)}`;

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`project apps [${dialect.name}]`, () => {
    const meta = useMetaDb(dialect, migrateOnly);
    const repo = () => projectAppsRepo(meta());

    it('has nothing for an app it never saw', async () => {
      expect(await repo().find('repairs')).toBeNull();
      expect(await repo().list()).toEqual([]);
    });

    it('records what was applied, at the full width of a key and a hash', async () => {
      await repo().setApplied(LONG_KEY, HASH, 1000);
      expect(await repo().find(LONG_KEY)).toEqual({
        appKey: LONG_KEY,
        appliedHash: HASH,
        appliedAt: 1000,
        failure: null,
        removals: null,
        declinedHash: null,
        updatedAt: 1000,
      });
    });

    it('keeps what was applied when a newer manifest fails, and forgets the failure once one applies', async () => {
      await repo().setApplied('repairs', HASH, 1000);
      await repo().setFailure('repairs', { stage: 'tables', message: 'the table "jobs" is taken', hash: OTHER }, 2000);
      const failed = await repo().find('repairs');
      expect(failed).toMatchObject({ appliedHash: HASH, appliedAt: 1000, updatedAt: 2000 });
      // Read back as an object on every engine, not as the text SQLite stores.
      expect(failed?.failure).toEqual({ stage: 'tables', message: 'the table "jobs" is taken', hash: OTHER });

      await repo().setApplied('repairs', OTHER, 3000);
      expect(await repo().find('repairs')).toMatchObject({ appliedHash: OTHER, appliedAt: 3000, failure: null });
    });

    it('records a failure for an app that was never applied', async () => {
      await repo().setFailure('bakery', { stage: 'install', message: 'no database', hash: HASH }, 1000);
      expect(await repo().find('bakery')).toMatchObject({ appliedHash: null, appliedAt: null, failure: { stage: 'install', hash: HASH } });
    });

    it('holds a removal until it is answered, and remembers a "keep the data"', async () => {
      const removals = {
        hash: OTHER,
        changes: [
          { kind: 'table' as const, table: 'notes', tableName: 'repairs_notes', rows: 12 },
          { kind: 'column' as const, table: 'jobs', tableName: 'repairs_jobs', column: 'colour', rows: 3 },
          { kind: 'narrow' as const, table: 'jobs', tableName: 'repairs_jobs', column: 'title', rows: 2, detail: 'at most 20 characters' },
        ],
      };
      await repo().setApplied('repairs', HASH, 1000);
      await repo().setRemovals('repairs', removals, 2000);
      expect((await repo().find('repairs'))?.removals).toEqual(removals);

      await repo().decline('repairs', OTHER, 3000);
      expect(await repo().find('repairs')).toMatchObject({ removals: null, declinedHash: OTHER, appliedHash: HASH });

      await repo().setRemovals('repairs', removals, 4000);
      await repo().setRemovals('repairs', null, 5000);
      expect(await repo().find('repairs')).toMatchObject({ removals: null, declinedHash: OTHER });
    });

    it('lists by key and forgets an uninstalled app', async () => {
      await repo().setApplied('repairs', HASH, 1000);
      await repo().setApplied('bakery', OTHER, 1000);
      expect((await repo().list()).map((row) => row.appKey)).toEqual(['bakery', 'repairs']);
      await repo().remove('bakery');
      expect((await repo().list()).map((row) => row.appKey)).toEqual(['repairs']);
      await repo().remove('bakery');
    });
  });
}
