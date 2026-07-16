import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  BUILTIN_ROLES,
  FirstUserExistsError,
  SYSTEM_ACTION_KEYS,
  createFirstSuperAdmin,
  firstRun,
  isBootstrapRequired,
  permissionsRepo,
  rolesRepo,
  settingsRepo,
  usersRepo,
} from '../src/index.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`bootstrap [${dialect.name}]`, () => {
    let t: TestDb;

    beforeEach(async () => {
      t = await dialect.make();
    });
    afterEach(async () => {
      await t.destroy();
    });

    it('firstRun migrates, seeds exactly the four built-in roles, and seeds system settings', async () => {
      const result = await firstRun(t.meta);
      expect(result.appliedMigrations.length).toBeGreaterThan(0);
      expect(result.createdRoles).toEqual(['super-admin', 'admin', 'editor', 'viewer']);

      const roles = rolesRepo(t.meta);
      const all = await roles.list();
      expect(all.map((r) => r.slug).sort()).toEqual(['admin', 'editor', 'super-admin', 'viewer']);
      expect(all.every((r) => r.isBuiltin)).toBe(true);

      const settings = settingsRepo(t.meta);
      expect(await settings.get('system.instanceId')).toBeTypeOf('string');
      expect(await settings.get('system.bootstrappedAt')).toBeTypeOf('number');
      expect(await settings.get('system.configVersion')).toBe(1);
      // Behavioral settings stay unset — registry defaults only (§6 step 4).
      const overrides = await settings.overrides();
      expect(Object.keys(overrides).sort()).toEqual([
        'system.bootstrappedAt',
        'system.configVersion',
        'system.instanceId',
      ]);
    });

    it('seeds the §6 permission baselines per role', async () => {
      await firstRun(t.meta);
      const roles = rolesRepo(t.meta);
      const permissions = permissionsRepo(t.meta);

      const superAdmin = await roles.findBySlug('super-admin');
      const admin = await roles.findBySlug('admin');
      const editor = await roles.findBySlug('editor');

      const superGrants = await permissions.listForRole(superAdmin!.id);
      expect(superGrants.map((g) => g.resourceRef).sort()).toEqual([...SYSTEM_ACTION_KEYS].sort());
      expect(superGrants.every((g) => g.resourceKind === 'system')).toBe(true);

      const adminGrants = await permissions.listForRole(admin!.id);
      expect(adminGrants.map((g) => g.resourceRef).sort()).toEqual(
        ['connections.manage', 'schema.remap', 'llm.run', 'automations.manage', 'webhooks.manage'].sort(),
      );
      // Role/user management defaults off for non-super-admins.
      expect(await permissions.isAllowed(admin!.id, 'system', 'roles.manage')).toBe(false);
      expect(await permissions.listForRole(editor!.id)).toHaveLength(0);
    });

    it('re-running firstRun is a no-op that preserves user edits', async () => {
      await firstRun(t.meta);
      const roles = rolesRepo(t.meta);
      const settings = settingsRepo(t.meta);
      const admin = await roles.findBySlug('admin');
      await roles.rename(admin!.id, 'Renamed Admin');
      const instanceId = await settings.get('system.instanceId');

      const again = await firstRun(t.meta);
      expect(again.appliedMigrations).toEqual([]);
      expect(again.createdRoles).toEqual([]);
      expect((await roles.list()).map((r) => r.slug).sort()).toEqual(['admin', 'editor', 'super-admin', 'viewer']);
      expect((await roles.findBySlug('admin'))?.name).toBe('Renamed Admin');
      expect(await settings.get('system.instanceId')).toBe(instanceId); // stable identity
    });

    it('seed definitions match the frozen built-in set', () => {
      expect(BUILTIN_ROLES.map((r) => r.slug)).toEqual(['super-admin', 'admin', 'editor', 'viewer']);
    });

    it('createFirstSuperAdmin works once, then is guarded', async () => {
      await firstRun(t.meta);
      expect(await isBootstrapRequired(t.meta)).toBe(true);

      const user = await createFirstSuperAdmin(t.meta, { email: 'Owner@Example.com', passwordHash: 'argon2id$x' });
      expect(user.email).toBe('owner@example.com');
      expect(user.name).toBe('Owner');

      const roles = rolesRepo(t.meta);
      expect((await roles.rolesForUser(user.id)).map((r) => r.slug)).toEqual(['super-admin']);
      expect(await isBootstrapRequired(t.meta)).toBe(false);

      await expect(
        createFirstSuperAdmin(t.meta, { email: 'second@example.com', passwordHash: 'h' }),
      ).rejects.toThrow(FirstUserExistsError);

      // Guard also holds when any non-admin user exists.
      const users = usersRepo(t.meta);
      await t.meta.db.deleteFrom('adminium_users').where('id', '=', user.id).execute();
      await users.create({ email: 'plain@example.com', name: 'Plain' });
      await expect(
        createFirstSuperAdmin(t.meta, { email: 'owner2@example.com', passwordHash: 'h' }),
      ).rejects.toThrow(FirstUserExistsError);
    });

    /**
     * The once-only property under real concurrency (M10-T04). This lives here,
     * in the dialect-parameterized suite, on purpose: on SQLite the driver holds
     * a single mutex-guarded connection, so `Promise.all` cannot actually
     * interleave two bootstraps and the SQLite leg of this test would pass even
     * against a naive check-then-act implementation. The PostgreSQL and MySQL
     * legs DO race, and they are where this test earns its keep — they fail
     * without the `system.superAdminCreatedAt` PRIMARY KEY claim.
     */
    it('createFirstSuperAdmin admits exactly one winner under a concurrent storm', async () => {
      await firstRun(t.meta);

      const attempts = await Promise.allSettled(
        Array.from({ length: 8 }, (_, i) =>
          createFirstSuperAdmin(t.meta, { email: `racer${String(i)}@example.com`, passwordHash: 'h' }),
        ),
      );

      const winners = attempts.filter((a) => a.status === 'fulfilled');
      const losers = attempts.filter((a) => a.status === 'rejected');
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(7);
      // Every loser fails for the RIGHT reason — not a 500-shaped surprise.
      for (const loser of losers) {
        expect((loser as PromiseRejectedResult).reason).toBeInstanceOf(FirstUserExistsError);
      }

      // Exactly one user exists, they are the super admin, and the losers' whole
      // transactions rolled back (no orphan user rows).
      expect(await usersRepo(t.meta).count()).toBe(1);
      const winner = (winners[0] as PromiseFulfilledResult<{ id: string }>).value;
      expect((await rolesRepo(t.meta).rolesForUser(winner.id)).map((r) => r.slug)).toEqual(['super-admin']);
      expect(await isBootstrapRequired(t.meta)).toBe(false);
    });

    it('the bootstrap claim is permanent — deleting every user does not re-open setup', async () => {
      await firstRun(t.meta);
      await createFirstSuperAdmin(t.meta, { email: 'owner@example.com', passwordHash: 'h' });

      // A data-only foothold (or an operator cleaning up) empties the table. A
      // user-count-only gate would hand the next caller a fresh super admin.
      await t.meta.db.deleteFrom('adminium_users').execute();
      expect(await usersRepo(t.meta).count()).toBe(0);

      expect(await isBootstrapRequired(t.meta)).toBe(false);
      await expect(
        createFirstSuperAdmin(t.meta, { email: 'mallory@evil.test', passwordHash: 'h' }),
      ).rejects.toThrow(FirstUserExistsError);
      expect(await usersRepo(t.meta).count()).toBe(0);
    });

    it('createFirstSuperAdmin requires roles to be seeded first', async () => {
      const { applyMigrations } = await import('../src/index.js');
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect });
      await expect(
        createFirstSuperAdmin(t.meta, { email: 'a@b.co', passwordHash: 'h' }),
      ).rejects.toThrow(/run firstRun/);
    });
  });
}
