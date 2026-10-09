// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a person has used of the assistant on a day (wave 0053), on every
 * available dialect.
 *
 * - The first use of a day makes the row; every later one ADDS to it, in the
 *   database: many additions made at once all count.
 * - A day is the UTC day, and its allowance turns over at the next UTC midnight.
 * - "Today, by person" is one day's rows, most first.
 * - A person's rows go with the person.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ALL_MIGRATIONS, applyMigrations, assistantUseDay, assistantUseRepo, assistantUseResetsAt, usersRepo } from '../src/index.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`assistant use [${dialect.name}]`, () => {
    let t: TestDb;
    beforeEach(async () => {
      t = await dialect.make();
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });
    });
    afterEach(async () => {
      await t.destroy();
    });
    const person = async (email: string) => (await usersRepo(t.meta).create({ email, name: email, passwordHash: 'x' })).id;

    it('starts at nothing, makes the row on the first use, and adds after', async () => {
      const repo = assistantUseRepo(t.meta);
      const ada = await person('ada@example.test');
      expect(await repo.get(ada, '2026-10-09')).toEqual({ userId: ada, day: '2026-10-09', tokens: 0, turns: 0, voiceSeconds: 0 });
      expect(await repo.add(ada, '2026-10-09', { tokens: 1200, turns: 1 })).toMatchObject({ tokens: 1200, turns: 1 });
      expect(await repo.add(ada, '2026-10-09', { tokens: 800 })).toMatchObject({ tokens: 2000, turns: 1 });
      // Another day is another row.
      expect(await repo.add(ada, '2026-10-10', { tokens: 5 })).toMatchObject({ tokens: 5, turns: 0 });
      expect(await repo.get(ada, '2026-10-09')).toMatchObject({ tokens: 2000 });
      // Numbers on every engine, not the text a driver may hand a count back as.
      expect(typeof (await repo.get(ada, '2026-10-09')).tokens).toBe('number');
    });

    it('counts every one of many additions made at once, the first of the day included', async () => {
      const repo = assistantUseRepo(t.meta);
      const ada = await person('ada@example.test');
      await Promise.all(Array.from({ length: 20 }, () => repo.add(ada, '2026-10-09', { tokens: 100, turns: 1 })));
      expect(await repo.get(ada, '2026-10-09')).toMatchObject({ tokens: 2000, turns: 20 });
    });

    it('never takes use away, and rounds a fraction', async () => {
      const repo = assistantUseRepo(t.meta);
      const ada = await person('ada@example.test');
      await repo.add(ada, '2026-10-09', { tokens: 10.6 });
      await repo.add(ada, '2026-10-09', { tokens: -500, turns: Number.NaN });
      expect(await repo.get(ada, '2026-10-09')).toMatchObject({ tokens: 11, turns: 0 });
    });

    it('lists a day by person, most first, and forgets the days before one', async () => {
      const repo = assistantUseRepo(t.meta);
      const [ada, ben] = [await person('ada@example.test'), await person('ben@example.test')];
      await repo.add(ada, '2026-10-09', { tokens: 100 });
      await repo.add(ben, '2026-10-09', { tokens: 900 });
      await repo.add(ben, '2026-10-01', { tokens: 7 });
      expect((await repo.listDay('2026-10-09')).map((row) => [row.userId, row.tokens])).toEqual([
        [ben, 900],
        [ada, 100],
      ]);
      expect(await repo.purgeBefore('2026-10-09')).toBe(1);
      expect(await repo.listDay('2026-10-01')).toEqual([]);
    });

    it('goes with the person', async () => {
      const repo = assistantUseRepo(t.meta);
      const ada = await person('ada@example.test');
      await repo.add(ada, '2026-10-09', { tokens: 100 });
      await t.meta.db.deleteFrom('adminium_users').where('id', '=', ada).execute();
      expect(await repo.listDay('2026-10-09')).toEqual([]);
    });
  });
}

describe('the day an allowance is counted on', () => {
  it('is the UTC day, whatever the server`s own clock says, and turns over at the next UTC midnight', () => {
    const lateEvening = Date.UTC(2026, 9, 9, 23, 59, 59);
    expect(assistantUseDay(lateEvening)).toBe('2026-10-09');
    expect(assistantUseDay(lateEvening + 1000)).toBe('2026-10-10');
    expect(assistantUseResetsAt(lateEvening)).toBe(Date.UTC(2026, 9, 10));
    expect(assistantUseResetsAt(Date.UTC(2026, 11, 31, 12))).toBe(Date.UTC(2027, 0, 1));
  });
});
