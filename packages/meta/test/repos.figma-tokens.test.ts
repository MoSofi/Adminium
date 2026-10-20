// SPDX-License-Identifier: AGPL-3.0-only
/**
 * figmaTokensRepo: a person's own Figma token on their row (wave 0061), on every engine.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { figmaTokensRepo, usersRepo } from '../src/index.js';
import { TEST_DIALECTS, migrateOnly, useMetaDb } from './helpers/db.js';

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`figmaTokensRepo [${dialect.name}]`, () => {
    const meta = useMetaDb(dialect, migrateOnly);
    let ava: string;
    let ben: string;

    beforeEach(async () => {
      ava = (await usersRepo(meta()).create({ email: 'ava@example.com', name: 'Ava' })).id;
      ben = (await usersRepo(meta()).create({ email: 'ben@example.com', name: 'Ben' })).id;
    });

    it('keeps a token on its person’s row only, of any length, and never on a User', async () => {
      const repo = figmaTokensRepo(meta());
      expect(await repo.read(ava)).toEqual({ encrypted: null, handle: null, figmaUserId: null });
      // An envelope longer than any varchar, a handle and an account id at their full widths.
      const envelope = `v1.${'x'.repeat(5000)}`;
      expect(await repo.save(ava, { encrypted: envelope, handle: 'h'.repeat(120), figmaUserId: '9'.repeat(200) })).toBe(true);
      expect(await repo.read(ava)).toEqual({ encrypted: envelope, handle: 'h'.repeat(120), figmaUserId: '9'.repeat(200) });
      expect((await repo.read(ben))?.encrypted).toBeNull();
      expect(await repo.read('usr_nobody')).toBeNull();
      expect(await repo.save('usr_nobody', { encrypted: 'x', handle: 'x', figmaUserId: 'x' })).toBe(false);
      // A User, as every request carries it, has no Figma field at all.
      const user = (await usersRepo(meta()).findById(ava)) as unknown as Record<string, unknown>;
      expect(Object.keys(user).filter((key) => /figma/i.test(key))).toEqual([]);
    });

    it('takes the token off, and says when there was none', async () => {
      const repo = figmaTokensRepo(meta());
      await repo.save(ava, { encrypted: 'v1.abc', handle: 'ava.reyes', figmaUserId: '1111' });
      expect(await repo.clear(ava)).toBe(true);
      expect(await repo.read(ava)).toEqual({ encrypted: null, handle: null, figmaUserId: '1111' });
      expect(await repo.clear(ava)).toBe(false);
    });

    it('pauses a Figma account for every row holding its token, and lifts it', async () => {
      const repo = figmaTokensRepo(meta());
      await repo.save(ava, { encrypted: 'v1.a', handle: 'shared', figmaUserId: '1111' });
      await repo.save(ben, { encrypted: 'v1.b', handle: 'shared', figmaUserId: '1111' });
      expect(await repo.pausedFor('1111')).toBeNull();
      await repo.pause('1111', { until: 1_800_000_000_000, dated: true }, ava);
      expect(await repo.pausedFor('1111')).toEqual({ until: 1_800_000_000_000, dated: true });
      expect(await repo.pausedFor('2222')).toBeNull();
      await repo.unpause('1111');
      expect(await repo.pausedFor('1111')).toBeNull();
      // An undated pause.
      await repo.pause('1111', { until: 1_800_000_000_000, dated: false }, null);
      expect(await repo.pausedFor('1111')).toEqual({ until: 1_800_000_000_000, dated: false });
    });

    it('keeps the pause of a token on no row (the project’s own) on the row of the person who used it', async () => {
      const repo = figmaTokensRepo(meta());
      await repo.pause('3333', { until: 1_800_000_000_000, dated: true }, ava);
      expect(await repo.pausedFor('3333')).toEqual({ until: 1_800_000_000_000, dated: true });
      // A row that already names another Figma account keeps it.
      await repo.save(ben, { encrypted: 'v1.b', handle: 'ben', figmaUserId: '4444' });
      await repo.pause('5555', { until: 1_800_000_000_000, dated: true }, ben);
      expect((await repo.read(ben))?.figmaUserId).toBe('4444');
      expect(await repo.pausedFor('4444')).toBeNull();
    });
  });
}
