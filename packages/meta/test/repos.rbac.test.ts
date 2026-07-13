import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  applyMigrations,
  permissionsRepo,
  rolesRepo,
  usersRepo,
} from '../src/index.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

const T0 = 1_750_000_000_000;

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`rolesRepo + permissionsRepo [${dialect.name}]`, () => {
    let t: TestDb;

    beforeEach(async () => {
      t = await dialect.make();
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect });
    });
    afterEach(async () => {
      await t.destroy();
    });

    it('creates roles and finds them by slug', async () => {
      const roles = rolesRepo(t.meta);
      const role = await roles.create({ slug: 'support', name: 'Support', isBuiltin: false }, T0);
      expect(role.isBuiltin).toBe(false);
      expect(await roles.findBySlug('support')).toMatchObject({ id: role.id, name: 'Support' });
      expect(await roles.findBySlug('missing')).toBeNull();
      expect((await roles.list()).map((r) => r.slug)).toEqual(['support']);
    });

    it('assigns roles to users idempotently and lists them', async () => {
      const roles = rolesRepo(t.meta);
      const users = usersRepo(t.meta);
      const u = await users.create({ email: 'a@b.co', name: 'A' }, T0);
      const editor = await roles.create({ slug: 'editor', name: 'Editor' }, T0);
      const viewer = await roles.create({ slug: 'viewer', name: 'Viewer' }, T0);

      await roles.assignToUser(u.id, editor.id, null, T0);
      await roles.assignToUser(u.id, editor.id, null, T0); // no-op, no PK violation
      await roles.assignToUser(u.id, viewer.id, null, T0);

      expect((await roles.rolesForUser(u.id)).map((r) => r.slug)).toEqual(['editor', 'viewer']);
      expect(await roles.removeFromUser(u.id, viewer.id)).toBe(true);
      expect((await roles.rolesForUser(u.id)).map((r) => r.slug)).toEqual(['editor']);
    });

    it('grants matrix rows per kind with validated payloads', async () => {
      const roles = rolesRepo(t.meta);
      const permissions = permissionsRepo(t.meta);
      const role = await roles.create({ slug: 'editor', name: 'Editor' }, T0);

      await permissions.grant(role.id, 'table', 'conn_1/public.orders', {
        read: true,
        create: true,
        update: true,
        delete: false,
        export: true,
        import: false,
      });
      await permissions.grant(role.id, 'page', 'page_orders', { view: true, edit: false });
      await permissions.grant(role.id, 'system', 'sql.run', { allowed: true });

      expect(await permissions.isAllowed(role.id, 'table', 'conn_1/public.orders', 'read')).toBe(true);
      expect(await permissions.isAllowed(role.id, 'table', 'conn_1/public.orders', 'delete')).toBe(false);
      expect(await permissions.isAllowed(role.id, 'page', 'page_orders', 'view')).toBe(true);
      expect(await permissions.isAllowed(role.id, 'system', 'sql.run')).toBe(true);
      expect(await permissions.isAllowed(role.id, 'system', 'users.manage')).toBe(false);
      expect(await permissions.listForRole(role.id)).toHaveLength(3);
    });

    it('upserts on repeated grant (unique (role, kind, ref))', async () => {
      const roles = rolesRepo(t.meta);
      const permissions = permissionsRepo(t.meta);
      const role = await roles.create({ slug: 'viewer', name: 'Viewer' }, T0);

      await permissions.grant(role.id, 'page', 'page_home', { view: true, edit: false });
      await permissions.grant(role.id, 'page', 'page_home', { view: true, edit: true });

      const rows = await permissions.listForRole(role.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.actions).toEqual({ view: true, edit: true });
    });

    it('rejects malformed actions payloads before they reach the database', async () => {
      const roles = rolesRepo(t.meta);
      const permissions = permissionsRepo(t.meta);
      const role = await roles.create({ slug: 'x', name: 'X' }, T0);
      await expect(
        permissions.grant(role.id, 'table', 'conn_1/public.orders', { view: true, edit: false } as never),
      ).rejects.toThrow();
      expect(await permissions.listForRole(role.id)).toHaveLength(0);
    });

    it('revokes a matrix row', async () => {
      const roles = rolesRepo(t.meta);
      const permissions = permissionsRepo(t.meta);
      const role = await roles.create({ slug: 'x', name: 'X' }, T0);
      await permissions.grant(role.id, 'system', 'audit.read', { allowed: true });
      expect(await permissions.revoke(role.id, 'system', 'audit.read')).toBe(true);
      expect(await permissions.isAllowed(role.id, 'system', 'audit.read')).toBe(false);
    });
  });
}
