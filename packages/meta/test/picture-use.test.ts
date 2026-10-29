// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Pictures made with AI, held to a day's allowance per person and for
 * everybody, on every available dialect.
 *
 * - A take fits both limits or takes nothing.
 * - Many takes at once never pass a limit together.
 * - What is given back never goes below nothing.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ALL_MIGRATIONS, applyMigrations, assistantUseRepo, pictureUseRepo, usersRepo } from '../src/index.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

const DAY = '2026-10-29';

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`picture use [${dialect.name}]`, () => {
    let t: TestDb;
    beforeEach(async () => {
      t = await dialect.make();
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });
    });
    afterEach(async () => {
      await t.destroy();
    });
    const person = async (email: string) => (await usersRepo(t.meta).create({ email, name: email, passwordHash: 'x' })).id;

    it('takes within both limits, and takes nothing when either is passed', async () => {
      const repo = pictureUseRepo(t.meta);
      const ada = await person('ada@example.test');
      const bo = await person('bo@example.test');
      expect(await repo.use(ada, DAY)).toEqual({ mine: 0, all: 0 });
      expect(await repo.take(ada, DAY, 3, { mine: 4, all: 5 })).toEqual({ ok: true, use: { mine: 3, all: 3 } });
      // Over the person's own: nothing is taken.
      expect(await repo.take(ada, DAY, 2, { mine: 4, all: 5 })).toEqual({ ok: false, over: 'mine', use: { mine: 3, all: 3 } });
      // Over everybody's: the person's share is not taken either.
      expect(await repo.take(bo, DAY, 3, { mine: 4, all: 5 })).toEqual({ ok: false, over: 'all', use: { mine: 0, all: 3 } });
      expect(await repo.take(bo, DAY, 2, { mine: 4, all: 5 })).toEqual({ ok: true, use: { mine: 2, all: 5 } });
      // The assistant's own counts are untouched, and a number on every engine.
      const row = await assistantUseRepo(t.meta).get(ada, DAY);
      expect(row).toMatchObject({ tokens: 0, turns: 0, voiceSeconds: 0 });
    });

    it('never lets takes made at once pass a limit together', async () => {
      const repo = pictureUseRepo(t.meta);
      const ada = await person('ada@example.test');
      const answers = await Promise.all(Array.from({ length: 12 }, () => repo.take(ada, DAY, 1, { mine: 5, all: 100 })));
      expect(answers.filter((answer) => answer.ok)).toHaveLength(5);
      expect(await repo.use(ada, DAY)).toEqual({ mine: 5, all: 5 });
    });

    it('gives back, never below nothing, and forgets old days', async () => {
      const repo = pictureUseRepo(t.meta);
      const ada = await person('ada@example.test');
      await repo.take(ada, DAY, 2, { mine: 10, all: 10 });
      await repo.giveBack(ada, DAY, 5);
      expect(await repo.use(ada, DAY)).toEqual({ mine: 0, all: 0 });
      await repo.take(ada, '2026-10-01', 1, { mine: 10, all: 10 });
      expect(await repo.purgeBefore('2026-10-10')).toBe(1);
    });
  });
}
