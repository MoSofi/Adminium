// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What each source of a lead source add-on was asked on a day (wave 0099), on
 * every available dialect: a store from before the wave upgrades with nothing
 * counted; reservations held at once never pass the day's cap together; a
 * settled call counts and lets its hold go; a call that was never made counts
 * nothing; one install's, source's, day's and spender's count is not
 * another's; an uncapped day still counts; an install's days go with it; and
 * every bounded column takes its full width, and refuses one character more.
 */
import { describe, expect, it } from 'vitest';

import {
  ALL_MIGRATIONS,
  SOURCE_DAY_INSTALL_WIDTH,
  SOURCE_DAY_SOURCE_WIDTH,
  SOURCE_DAY_SPENDER_WIDTH,
  SOURCE_DAY_TOTAL,
  applyMigrations,
  sourceDayOf,
  sourceDaysRepo,
} from '../src/index.js';
import { TEST_DIALECTS, migrateOnly, useMetaDb } from './helpers/db.js';

const T0 = 1_750_000_000_000;
const TOTAL = { installId: 'mft_one', source: 'hunter', day: '2026-11-18', spender: SOURCE_DAY_TOTAL };

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`what a source was asked today [${dialect.name}]`, () => {
    const meta = useMetaDb(dialect, migrateOnly);

    it('holds only what fits under the day\'s cap, at once from many callers, and settles what was made', async () => {
      const days = sourceDaysRepo(meta());
      expect(await days.day(TOTAL)).toBeNull();
      // Ten calls at once against a cap of 3: three are held, never four.
      const held = await Promise.all(Array.from({ length: 10 }, (_, n) => days.reserve(TOTAL, 3, T0 + n)));
      expect(held.filter(Boolean)).toHaveLength(3);
      expect(await days.day(TOTAL)).toMatchObject({ calls: 0, held: 3 });
      // A call made counts; a call never made lets its hold go and counts nothing.
      await days.settle(TOTAL, 1, T0 + 20);
      await days.settle(TOTAL, 0, T0 + 21);
      expect(await days.day(TOTAL)).toEqual({ calls: 1, held: 1, changedAt: T0 + 21 });
      expect(await days.reserve(TOTAL, 3, T0 + 22)).toBe(true);
      expect(await days.reserve(TOTAL, 3, T0 + 23)).toBe(false);
      // The first calls of a day, at once, all held while there is room: one makes the row, the rest meet it and ask again.
      const first = await Promise.all(Array.from({ length: 5 }, (_, n) => days.reserve({ ...TOTAL, spender: 'usr_new' }, 10, T0 + n)));
      expect(first).toEqual([true, true, true, true, true]);
      // A cap of 0 holds nothing, on a day with no row too.
      expect(await days.reserve({ ...TOTAL, day: '2026-11-19' }, 0, T0)).toBe(false);
      expect(await days.day({ ...TOTAL, day: '2026-11-19' })).toBeNull();
    });

    it('counts a day with no cap, and keeps each install, source, day and spender apart', async () => {
      const days = sourceDaysRepo(meta());
      for (let n = 0; n < 5; n += 1) expect(await days.reserve(TOTAL, null, T0 + n)).toBe(true);
      for (let n = 0; n < 5; n += 1) await days.settle(TOTAL, 1, T0 + 10 + n);
      expect(await days.day(TOTAL)).toMatchObject({ calls: 5, held: 0 });
      // A settle with nothing held counts, and never holds less than nothing.
      await days.settle(TOTAL, 1, T0 + 16);
      expect(await days.day(TOTAL)).toMatchObject({ calls: 6, held: 0 });
      expect(await days.day({ ...TOTAL, spender: 'usr_someone' })).toBeNull();
      expect(await days.day({ ...TOTAL, source: 'companies-house' })).toBeNull();
      expect(await days.day({ ...TOTAL, installId: 'mft_two' })).toBeNull();
      expect(await days.day({ ...TOTAL, day: '2026-11-19' })).toBeNull();
      // A count with no hold behind it is still counted.
      await days.settle({ ...TOTAL, spender: 'step' }, 2, T0 + 20);
      expect(await days.day({ ...TOTAL, spender: 'step' })).toMatchObject({ calls: 2, held: 0 });
      await expect(days.reserve(TOTAL, -1, T0)).rejects.toThrow(/whole number/);
    });

    it("lets an install's days go with it, and sweeps the days before one", async () => {
      const days = sourceDaysRepo(meta());
      await days.settle(TOTAL, 1, T0);
      await days.settle({ ...TOTAL, day: '2026-11-10' }, 1, T0);
      await days.settle({ ...TOTAL, installId: 'mft_two' }, 1, T0);
      expect(await days.pruneBefore('2026-11-11')).toBe(1);
      expect(await days.forgetInstall('mft_one')).toBe(1);
      expect(await days.day(TOTAL)).toBeNull();
      expect(await days.day({ ...TOTAL, installId: 'mft_two' })).toMatchObject({ calls: 1 });
    });

    it('takes the full width of every bounded column, and refuses one more', async () => {
      const days = sourceDaysRepo(meta());
      const wide = { installId: 'i'.repeat(SOURCE_DAY_INSTALL_WIDTH), source: 's'.repeat(SOURCE_DAY_SOURCE_WIDTH), day: '2026-12-31', spender: 'p'.repeat(SOURCE_DAY_SPENDER_WIDTH) };
      expect(await days.reserve(wide, 5, T0)).toBe(true);
      await days.settle(wide, Number.MAX_SAFE_INTEGER - 1, T0);
      const row = await meta().db.selectFrom('adminium_source_days').selectAll().where('installId', '=', wide.installId).executeTakeFirstOrThrow();
      expect([row.installId, row.source, row.day, row.spender, Number(row.calls), Number(row.held)]).toEqual([wide.installId, wide.source, wide.day, wide.spender, Number.MAX_SAFE_INTEGER - 1, 0]);
      await expect(days.reserve({ ...wide, installId: `${wide.installId}i` }, 1, T0)).rejects.toThrow(/install id/);
      await expect(days.reserve({ ...wide, source: `${wide.source}s` }, 1, T0)).rejects.toThrow(/source id/);
      await expect(days.reserve({ ...wide, spender: `${wide.spender}p` }, 1, T0)).rejects.toThrow(/spender/);
      await expect(days.reserve({ ...wide, day: '2026-12-310' }, 1, T0)).rejects.toThrow(/YYYY-MM-DD/);
      // The column itself refuses one more where the engine bounds it (SQLite's text does not).
      if (dialect.name !== 'sqlite') {
        for (const over of [{ installId: `${wide.installId}i` }, { source: `${wide.source}s` }, { spender: `${wide.spender}p` }, { day: '2026-12-310' }]) {
          await expect(meta().db.insertInto('adminium_source_days').values({ ...wide, ...over, calls: 0, held: 0, changedAt: T0 }).execute()).rejects.toThrow();
        }
      }
    });

    it('names the UTC day a moment falls on', () => {
      expect(sourceDayOf(Date.UTC(2026, 10, 18, 23, 59, 59))).toBe('2026-11-18');
      expect(sourceDayOf(Date.UTC(2026, 10, 19, 0, 0, 0))).toBe('2026-11-19');
    });
  });
}

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`0099_source_days upgrade [${dialect.name}]`, () => {
    it('a store from before the wave upgrades with nothing counted', async () => {
      const t = await dialect.make();
      try {
        await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS.filter((m) => m.name < '0099_source_days') });
        expect((await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS })).applied[0]).toBe('0099_source_days');
        expect(await sourceDaysRepo(t.meta).day(TOTAL)).toBeNull();
      } finally {
        await t.destroy();
      }
    });
  });
}
