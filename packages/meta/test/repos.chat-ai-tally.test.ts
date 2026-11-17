// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a website chat's automatic answerer spent on a day (wave 0094), on
 * every available dialect: a store from before the wave upgrades with nothing
 * counted; reservations held at once never pass the day's limit together; a
 * settled call counts what it spent and lets its hold go, past 32 bits; one
 * chat's day is not another's; an address's conversations are noted once and
 * counted; the sweep takes the days before the one it is given; and every
 * bounded column takes its full width, and refuses one character more.
 */
import { describe, expect, it } from 'vitest';

import {
  ALL_MIGRATIONS,
  CHAT_AI_ADDRESS_WIDTH,
  CHAT_AI_ADD_ON_WIDTH,
  CHAT_AI_INSTALL_WIDTH,
  applyMigrations,
  chatAiDayOf,
  chatAiTallyRepo,
} from '../src/index.js';
import { TEST_DIALECTS, migrateOnly, useMetaDb } from './helpers/db.js';

const T0 = 1_750_000_000_000;
const DAY = { installId: 'inst-1', addOn: 'live-chat', day: '2026-11-18' };

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`what a chat's answerer spent [${dialect.name}]`, () => {
    const meta = useMetaDb(dialect, migrateOnly);

    it('reserves only what fits under the day\'s limit, at once from many callers, and settles what was spent', async () => {
      const tally = chatAiTallyRepo(meta());
      expect(await tally.day(DAY)).toBeNull();
      // Ten calls of 30 at once against a limit of 100: three are held, never four.
      const held = await Promise.all(Array.from({ length: 10 }, (_, n) => tally.reserve(DAY, 30, 100, T0 + n)));
      expect(held.filter(Boolean)).toHaveLength(3);
      expect(await tally.day(DAY)).toMatchObject({ spent: 0, reserved: 90 });
      // The last 10 fit exactly; one more does not.
      expect(await tally.reserve(DAY, 10, 100, T0 + 20)).toBe(true);
      expect(await tally.reserve(DAY, 1, 100, T0 + 21)).toBe(false);
      // A call that spent less than it held gives the rest back.
      await tally.settle(DAY, 30, 12, T0 + 30);
      expect(await tally.day(DAY)).toEqual({ spent: 12, reserved: 70, changedAt: T0 + 30 });
      expect(await tally.reserve(DAY, 18, 100, T0 + 31)).toBe(true);
      expect(await tally.reserve(DAY, 1, 100, T0 + 32)).toBe(false);
      // A reservation larger than the limit is never held, on a day with no row either.
      expect(await tally.reserve({ ...DAY, day: '2026-11-19' }, 101, 100, T0)).toBe(false);
      expect(await tally.day({ ...DAY, day: '2026-11-19' })).toBeNull();
      // A limit of 0 holds nothing.
      expect(await tally.reserve({ ...DAY, day: '2026-11-20' }, 1, 0, T0)).toBe(false);
    });

    it('counts past 32 bits, and keeps each chat\'s day apart', async () => {
      const tally = chatAiTallyRepo(meta());
      const big = 5_000_000_000;
      expect(await tally.reserve(DAY, big, big * 2, T0)).toBe(true);
      await tally.settle(DAY, big, big, T0 + 1);
      expect(await tally.day(DAY)).toEqual({ spent: big, reserved: 0, changedAt: T0 + 1 });
      expect(await tally.day({ ...DAY, addOn: 'other-chat' })).toBeNull();
      expect(await tally.day({ ...DAY, installId: 'inst-2' })).toBeNull();
      expect(await tally.day({ ...DAY, day: '2026-11-19' })).toBeNull();
      // A spend with no reservation behind it is still counted.
      await tally.settle({ ...DAY, day: '2026-11-21' }, 0, 7, T0 + 2);
      expect(await tally.day({ ...DAY, day: '2026-11-21' })).toMatchObject({ spent: 7, reserved: 0 });
      await expect(tally.reserve(DAY, -1, 10, T0)).rejects.toThrow(/whole number/);
    });

    it('notes each address\'s conversation once, counts them, and sweeps the older days', async () => {
      const tally = chatAiTallyRepo(meta());
      expect(await tally.markAddress(DAY, 'h:a', 1, T0)).toBe(true);
      expect(await tally.markAddress(DAY, 'h:a', 1, T0 + 1)).toBe(false);
      expect(await tally.markAddress(DAY, 'h:a', 2, T0 + 2)).toBe(true);
      expect(await tally.markAddress(DAY, 'h:b', 1, T0 + 3)).toBe(true);
      expect(await tally.markAddress({ ...DAY, day: '2026-11-17' }, 'h:a', 9, T0)).toBe(true);
      expect(await tally.addressConversations(DAY, 'h:a')).toBe(2);
      expect(await tally.addressConversations(DAY, 'h:b')).toBe(1);
      expect(await tally.addressConversations({ ...DAY, addOn: 'other' }, 'h:a')).toBe(0);
      await tally.unmarkAddress(DAY, 'h:a', 2);
      expect(await tally.addressConversations(DAY, 'h:a')).toBe(1);
      expect(await tally.pruneAddresses('2026-11-18')).toBe(1);
      expect(await tally.addressConversations({ ...DAY, day: '2026-11-17' }, 'h:a')).toBe(0);
      expect(await tally.addressConversations(DAY, 'h:a')).toBe(1);
    });

    it('takes the full width of every bounded column, and refuses one more', async () => {
      const tally = chatAiTallyRepo(meta());
      const wide = { installId: 'i'.repeat(CHAT_AI_INSTALL_WIDTH), addOn: 'a'.repeat(CHAT_AI_ADD_ON_WIDTH), day: '2026-12-31' };
      const hash = 'h'.repeat(CHAT_AI_ADDRESS_WIDTH);
      expect(await tally.reserve(wide, 5, 10, T0)).toBe(true);
      expect(await tally.markAddress(wide, hash, Number.MAX_SAFE_INTEGER, T0)).toBe(true);
      const day = await meta().db.selectFrom('adminium_chat_ai_days').selectAll().where('installId', '=', wide.installId).executeTakeFirstOrThrow();
      expect([day.installId, day.addOn, day.day]).toEqual([wide.installId, wide.addOn, wide.day]);
      const note = await meta().db.selectFrom('adminium_chat_ai_addresses').selectAll().where('addressHash', '=', hash).executeTakeFirstOrThrow();
      expect([note.installId, note.addOn, note.addressHash, Number(note.conversationId)]).toEqual([wide.installId, wide.addOn, hash, Number.MAX_SAFE_INTEGER]);
      await expect(tally.reserve({ ...wide, installId: `${wide.installId}i` }, 1, 10, T0)).rejects.toThrow(/install id/);
      await expect(tally.reserve({ ...wide, addOn: `${wide.addOn}a` }, 1, 10, T0)).rejects.toThrow(/add-on/);
      await expect(tally.reserve({ ...wide, day: '2026-12-310' }, 1, 10, T0)).rejects.toThrow(/YYYY-MM-DD/);
      await expect(tally.markAddress(wide, `${hash}h`, 1, T0)).rejects.toThrow(/address hash/);
      // The column itself refuses one more where the engine bounds it (SQLite's text does not).
      if (dialect.name !== 'sqlite') {
        await expect(
          meta()
            .db.insertInto('adminium_chat_ai_addresses')
            .values({ installId: 'x', addOn: 'y', day: '2026-12-31', addressHash: `${hash}h`, conversationId: 1, createdAt: T0 })
            .execute(),
        ).rejects.toThrow();
      }
    });

    it('names the UTC day a moment falls on', () => {
      expect(chatAiDayOf(Date.UTC(2026, 10, 18, 23, 59, 59))).toBe('2026-11-18');
      expect(chatAiDayOf(Date.UTC(2026, 10, 19, 0, 0, 0))).toBe('2026-11-19');
    });
  });
}

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`0094_chat_ai_tally upgrade [${dialect.name}]`, () => {
    it('a store from before the wave upgrades with nothing counted', async () => {
      const t = await dialect.make();
      try {
        const before = ALL_MIGRATIONS.filter((m) => m.name < '0094_chat_ai_tally');
        await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: before });
        expect((await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS })).applied).toEqual(['0094_chat_ai_tally']);
        expect(await chatAiTallyRepo(t.meta).day(DAY)).toBeNull();
      } finally {
        await t.destroy();
      }
    });
  });
}
