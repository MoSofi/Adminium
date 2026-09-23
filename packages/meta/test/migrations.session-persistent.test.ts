// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0041 (`persistent`): sessions that predate the wave read back as
 * persistent — they were all given a `Max-Age` cookie — and the repo
 * round-trips both answers. Runs the real migration list split at 0040/0041
 * on every available dialect, because the column is a boolean and the three
 * engines hand one back three different ways.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ALL_MIGRATIONS, applyMigrations, readBool, sessionsRepo, usersRepo } from '../src/index.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

const T0 = 1_750_000_000_000;

const PRE_0041 = ALL_MIGRATIONS.filter((m) => m.name < '0041_session_persistent');

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`0041_session_persistent [${dialect.name}]`, () => {
    let t: TestDb;

    beforeEach(async () => {
      t = await dialect.make();
    });
    afterEach(async () => {
      await t.destroy();
    });

    it('adds persistent; pre-wave sessions read as persistent', async () => {
      expect(PRE_0041.at(-1)?.name).toBe('0040_app_staff_grant');
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: PRE_0041 });

      const user = await usersRepo(t.meta).create({ email: 'a@b.co', name: 'A' }, T0);
      // Raw insert: today's `sessionsRepo.create` writes `persistent`, a
      // column this pre-0041 schema does not have yet.
      await t.meta.db
        .insertInto('adminium_sessions')
        .values({
          id: 'sess_pre0041',
          tokenHash: 'hash-pre',
          userId: user.id,
          createdAt: T0,
          expiresAt: T0 + 3_600_000,
          lastSeenAt: T0,
          ip: null,
          userAgent: null,
          revokedAt: null,
        } as never)
        .execute();

      await applyMigrations(t.meta.db, { dialect: t.meta.dialect });

      const legacy = await sessionsRepo(t.meta).findById('sess_pre0041');
      expect(readBool(legacy?.persistent)).toBe(true);
    });

    it('round-trips both answers, defaulting to persistent', async () => {
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect });
      const user = await usersRepo(t.meta).create({ email: 'a@b.co', name: 'A' }, T0);
      const sessions = sessionsRepo(t.meta);
      const base = { userId: user.id, expiresAt: T0 + 3_600_000 };

      const unsaid = await sessions.create({ ...base, tokenHash: 'hash-default' }, T0);
      const kept = await sessions.create({ ...base, tokenHash: 'hash-kept', persistent: true }, T0);
      const closing = await sessions.create({ ...base, tokenHash: 'hash-closing', persistent: false }, T0);

      for (const [row, expected] of [
        [unsaid, true],
        [kept, true],
        [closing, false],
      ] as const) {
        expect(readBool(row.persistent)).toBe(expected);
        expect(readBool((await sessions.findById(row.id))?.persistent)).toBe(expected);
        expect(readBool((await sessions.findValidByTokenHash(row.tokenHash, T0 + 1))?.persistent)).toBe(
          expected,
        );
      }
    });
  });
}
