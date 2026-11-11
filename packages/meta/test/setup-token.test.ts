// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The one-time setup token, at the layer that makes it hold: checked and
 * consumed inside `createFirstSuperAdmin`'s transaction. The server mints and
 * prints it (`apps/server/src/setup/token.ts`); this proves what a stranger who
 * reaches the store's front door without it can and cannot do, on every dialect.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  FirstUserExistsError,
  SETUP_TOKEN_KEY,
  SetupTokenError,
  createFirstSuperAdmin,
  createLocalOwner,
  firstRun,
  hashSetupToken,
  isBootstrapRequired,
  newSetupTokenSalt,
  normalizeSetupToken,
  readSetupToken,
  settingsRepo,
  setupTokenMatches,
  usersRepo,
  writeSetupToken,
} from '../src/index.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

const TOKEN = 'K7QD-9MXR-2FTB-WH4N';

describe('setup token hashing', () => {
  it('forgives case, spaces, dashes and the letters the alphabet leaves out', () => {
    const salt = newSetupTokenSalt();
    const stored = { salt, hash: hashSetupToken(salt, 'K7QD-9MXR-2FTB-WH40') };
    expect(setupTokenMatches(stored, 'k7qd 9mxr 2ftb wh40')).toBe(true);
    expect(setupTokenMatches(stored, 'K7QD9MXR2FTBWH4O')).toBe(true);
    expect(normalizeSetupToken('il-o')).toBe('110');
  });

  it('refuses a wrong, empty or missing candidate', () => {
    const salt = newSetupTokenSalt();
    const stored = { salt, hash: hashSetupToken(salt, TOKEN) };
    expect(setupTokenMatches(stored, 'K7QD-9MXR-2FTB-WH4M')).toBe(false);
    expect(setupTokenMatches(stored, ' - ')).toBe(false);
    expect(setupTokenMatches(stored, undefined)).toBe(false);
  });

  it('stores no trace of the token: a salt and a digest only', () => {
    const salt = newSetupTokenSalt();
    const hash = hashSetupToken(salt, TOKEN);
    expect(salt).toMatch(/^[0-9a-f]{32}$/);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(normalizeSetupToken(TOKEN).toLowerCase());
    // A different salt, a different digest: two instances' hashes say nothing about each other.
    expect(hashSetupToken(newSetupTokenSalt(), TOKEN)).not.toBe(hash);
  });
});

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`setup token in the claim [${dialect.name}]`, () => {
    let t: TestDb;

    beforeEach(async () => {
      t = await dialect.make();
      await firstRun(t.meta);
      const salt = newSetupTokenSalt();
      await writeSetupToken(t.meta, { salt, hash: hashSetupToken(salt, TOKEN) });
    });
    afterEach(async () => {
      await t.destroy();
    });

    it('refuses without the token, and claims nothing', async () => {
      await expect(createFirstSuperAdmin(t.meta, { email: 'mallory@evil.test', passwordHash: 'h' })).rejects.toThrow(
        SetupTokenError,
      );
      await expect(
        createFirstSuperAdmin(t.meta, { email: 'mallory@evil.test', passwordHash: 'h' }, undefined, { setupToken: 'WRONG-WRONG-WRONG-WRON' }),
      ).rejects.toThrow(SetupTokenError);

      expect(await usersRepo(t.meta).count()).toBe(0);
      expect(await isBootstrapRequired(t.meta)).toBe(true);
      expect(await settingsRepo(t.meta).get('system.superAdminCreatedAt')).toBeNull();
      // The token is still good for the right person.
      expect(await readSetupToken(t.meta)).not.toBeNull();
    });

    it('accepts the token, and the same transaction deletes it', async () => {
      const user = await createFirstSuperAdmin(t.meta, { email: 'owner@example.com', passwordHash: 'h' }, undefined, {
        setupToken: TOKEN.toLowerCase(),
      });
      expect(user.email).toBe('owner@example.com');
      expect(await readSetupToken(t.meta)).toBeNull();
      const row = await t.meta.db.selectFrom('adminium_settings').select('key').where('key', '=', SETUP_TOKEN_KEY).executeTakeFirst();
      expect(row).toBeUndefined();
    });

    it('a set-up instance answers "already set up", whatever token is sent', async () => {
      await createFirstSuperAdmin(t.meta, { email: 'owner@example.com', passwordHash: 'h' }, undefined, { setupToken: TOKEN });
      await expect(
        createFirstSuperAdmin(t.meta, { email: 'mallory@evil.test', passwordHash: 'h' }, undefined, { setupToken: 'nope' }),
      ).rejects.toThrow(FirstUserExistsError);
      await expect(
        createFirstSuperAdmin(t.meta, { email: 'mallory@evil.test', passwordHash: 'h' }, undefined, { setupToken: TOKEN }),
      ).rejects.toThrow(FirstUserExistsError);
    });

    /**
     * The race the token adds. Eight holders of the right token storm the
     * claim, and eight strangers with wrong ones storm it beside them: exactly
     * one account, every stranger refused for the token and not for the claim,
     * and no row left behind.
     */
    it('admits exactly one winner when right and wrong tokens race', async () => {
      const right = Array.from({ length: 8 }, (_, i) => ({ email: `owner${String(i)}@example.com`, token: TOKEN }));
      const wrong = Array.from({ length: 8 }, (_, i) => ({ email: `mallory${String(i)}@evil.test`, token: `WRONG-${String(i)}` }));
      const attempts = await Promise.allSettled(
        [...right, ...wrong].map((a) =>
          createFirstSuperAdmin(t.meta, { email: a.email, passwordHash: 'h' }, undefined, { setupToken: a.token }),
        ),
      );

      const winners = attempts.flatMap((a) => (a.status === 'fulfilled' ? [a.value] : []));
      expect(winners).toHaveLength(1);
      expect(winners[0]?.email).toMatch(/^owner\d@example\.com$/);
      for (const [i, attempt] of attempts.entries()) {
        if (attempt.status === 'fulfilled') continue;
        const reason = attempt.reason as unknown;
        // A stranger is refused for the token, or, once the winner has
        // committed, for the claim, which is checked first. Never anything else.
        if (i >= right.length) expect(reason instanceof SetupTokenError || reason instanceof FirstUserExistsError).toBe(true);
        else expect(reason).toBeInstanceOf(FirstUserExistsError);
      }
      // No stranger won, and no stranger left an account behind.
      expect(attempts.slice(right.length).every((a) => a.status === 'rejected')).toBe(true);
      expect(await usersRepo(t.meta).count()).toBe(1);
      expect(await readSetupToken(t.meta)).toBeNull();
      expect(await isBootstrapRequired(t.meta)).toBe(false);
    });

    it('a caller on this computer (`local`) needs no token, and still spends it', async () => {
      const owner = await createLocalOwner(t.meta);
      expect(owner.passwordHash).toBeNull();
      expect(await readSetupToken(t.meta)).toBeNull();
    });
  });
}
