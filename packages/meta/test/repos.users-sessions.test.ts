// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  MetaValidationError,
  SESSION_TOUCH_INTERVAL_MS,
  applyMigrations,
  sessionsRepo,
  usersRepo,
} from '../src/index.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

const T0 = 1_750_000_000_000;

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`usersRepo + sessionsRepo [${dialect.name}]`, () => {
    let t: TestDb;

    beforeEach(async () => {
      t = await dialect.make();
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect });
    });
    afterEach(async () => {
      await t.destroy();
    });

    it('creates and finds users by (lowercased) email', async () => {
      const users = usersRepo(t.meta);
      const created = await users.create({ email: 'Ava.Reyes@Example.COM', name: 'Ava Reyes' }, T0);
      expect(created.email).toBe('ava.reyes@example.com');
      expect(created.status).toBe('active');
      expect(created.totpEnabled).toBe(false);
      expect(created.passwordHash).toBeNull();

      const found = await users.findByEmail('AVA.REYES@example.com');
      expect(found?.id).toBe(created.id);
      expect(await users.findByEmail('nobody@example.com')).toBeNull();
      expect(await users.findById(created.id)).toMatchObject({ name: 'Ava Reyes' });
      expect(await users.count()).toBe(1);
    });

    it('rejects invalid emails and statuses', async () => {
      const users = usersRepo(t.meta);
      await expect(users.create({ email: 'not-an-email', name: 'X' })).rejects.toThrow(MetaValidationError);
      await expect(
        users.create({ email: 'a@b.co', name: 'X', status: 'weird' as never }),
      ).rejects.toThrow();
    });

    it('updates passwords and recovery codes', async () => {
      const users = usersRepo(t.meta);
      const u = await users.create({ email: 'a@b.co', name: 'A' }, T0);
      expect(await users.updatePassword(u.id, 'argon2id$hash', T0 + 10)).toBe(true);
      expect(await users.updatePassword('usr_missing', 'x')).toBe(false);

      await users.setRecoveryCodes(u.id, ['h1', 'h2'], T0 + 20);
      const reloaded = await users.findById(u.id);
      expect(reloaded?.passwordHash).toBe('argon2id$hash');
      expect(reloaded?.recoveryCodes).toEqual(['h1', 'h2']);
      expect(reloaded?.updatedAt).toBe(T0 + 20);
    });

    it('session lifecycle: create → find valid → revoke', async () => {
      const users = usersRepo(t.meta);
      const sessions = sessionsRepo(t.meta);
      const u = await users.create({ email: 'a@b.co', name: 'A' }, T0);

      const s = await sessions.create(
        { userId: u.id, tokenHash: 'hash-1', expiresAt: T0 + 3_600_000, ip: '10.0.0.1' },
        T0,
      );
      expect(await sessions.findValidByTokenHash('hash-1', T0 + 1)).toMatchObject({ id: s.id, ip: '10.0.0.1' });
      // Expired.
      expect(await sessions.findValidByTokenHash('hash-1', T0 + 3_600_001)).toBeNull();
      // Revoked.
      expect(await sessions.revoke(s.id, T0 + 10)).toBe(true);
      expect(await sessions.revoke(s.id, T0 + 11)).toBe(false);
      expect(await sessions.findValidByTokenHash('hash-1', T0 + 20)).toBeNull();
    });

    it('throttles last-seen touches to one per interval', async () => {
      const users = usersRepo(t.meta);
      const sessions = sessionsRepo(t.meta);
      const u = await users.create({ email: 'a@b.co', name: 'A' }, T0);
      const s = await sessions.create({ userId: u.id, tokenHash: 'h', expiresAt: T0 + 86_400_000 }, T0);

      expect(await sessions.touch(s.id, T0 + 1_000)).toBe(false);
      expect(await sessions.touch(s.id, T0 + SESSION_TOUCH_INTERVAL_MS)).toBe(true);
      expect(await sessions.touch(s.id, T0 + SESSION_TOUCH_INTERVAL_MS + 1_000)).toBe(false);
    });

    it('gc removes expired and long-revoked sessions only', async () => {
      const users = usersRepo(t.meta);
      const sessions = sessionsRepo(t.meta);
      const u = await users.create({ email: 'a@b.co', name: 'A' }, T0);

      await sessions.create({ userId: u.id, tokenHash: 'expired', expiresAt: T0 + 1 }, T0);
      const revoked = await sessions.create({ userId: u.id, tokenHash: 'revoked', expiresAt: T0 + 10 * 86_400_000 }, T0);
      await sessions.revoke(revoked.id, T0);
      await sessions.create({ userId: u.id, tokenHash: 'alive', expiresAt: T0 + 10 * 86_400_000 }, T0);

      // One hour later: only the expired one goes (revocation is < 24 h old).
      expect(await sessions.gc(T0 + 3_600_000)).toBe(1);
      // Two days later: the revoked one goes too.
      expect(await sessions.gc(T0 + 2 * 86_400_000)).toBe(1);
      expect(await sessions.findValidByTokenHash('alive', T0 + 3_600_000)).not.toBeNull();
    });

    it('cascades sessions when the user row is deleted (real meta-internal FK)', async () => {
      const users = usersRepo(t.meta);
      const sessions = sessionsRepo(t.meta);
      const u = await users.create({ email: 'a@b.co', name: 'A' }, T0);
      await sessions.create({ userId: u.id, tokenHash: 'h', expiresAt: T0 + 1_000 }, T0);

      await t.meta.db.deleteFrom('adminium_users').where('id', '=', u.id).execute();
      const rows = await t.meta.db.selectFrom('adminium_sessions').selectAll().execute();
      expect(rows).toHaveLength(0);
    });
  });
}
