// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  AUDIT_CHANGES_MAX_BYTES,
  apiKeysRepo,
  applyMigrations,
  auditRepo,
  passwordResetsRepo,
  rolesRepo,
  usersRepo,
} from '../src/index.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

const T0 = 1_750_000_000_000;

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`auditRepo + apiKeysRepo + passwordResetsRepo [${dialect.name}]`, () => {
    let t: TestDb;

    beforeEach(async () => {
      t = await dialect.make();
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect });
    });
    afterEach(async () => {
      await t.destroy();
    });

    it('appends audit entries with the §3.11 shape', async () => {
      const audit = auditRepo(t.meta);
      const entry = await audit.append(
        {
          actorKind: 'user',
          actorId: 'usr_x',
          actorLabel: 'Ava Reyes',
          category: 'data',
          action: 'record.update',
          connectionId: 'conn_x',
          entity: { connectionId: 'conn_x', table: 'public.orders', pk: { id: 4213 }, label: 'Order #4213' },
          changes: { before: { status: 'draft' }, after: { status: 'paid' } },
          requestId: 'req_123',
        },
        T0,
      );
      expect(entry.id.startsWith('aud_')).toBe(true);

      const listed = await audit.list({ actorId: 'usr_x' });
      expect(listed).toHaveLength(1);
      expect(listed[0]?.entity).toEqual({ connectionId: 'conn_x', table: 'public.orders', pk: { id: 4213 }, label: 'Order #4213' });
      expect(listed[0]?.changes).toEqual({ before: { status: 'draft' }, after: { status: 'paid' } });
    });

    it('denormalizes entity keys at append (30 WS-A): single, composite, and none', async () => {
      const audit = auditRepo(t.meta);
      const single = await audit.append(
        {
          actorKind: 'user',
          actorLabel: 'Ava Reyes',
          category: 'data',
          action: 'record.update',
          entity: { connectionId: 'conn_x', table: 'public.orders', pk: { id: 4213 }, label: 'Order #4213' },
        },
        T0,
      );
      const composite = await audit.append(
        {
          actorKind: 'user',
          actorLabel: 'Ava Reyes',
          category: 'data',
          action: 'record.update',
          entity: {
            connectionId: 'conn_x',
            table: 'public.order_items',
            pk: { order_id: 4213, product_id: 7 },
            label: '[4213,7]',
          },
        },
        T0 + 1,
      );
      const none = await audit.append(
        { actorKind: 'user', actorLabel: 'Ava Reyes', category: 'auth', action: 'session.create' },
        T0 + 2,
      );

      const rows = await t.meta.db
        .selectFrom('adminium_audit_log')
        .select(['id', 'entityTable', 'entityId'])
        .execute();
      const byId = new Map(rows.map((row) => [row.id, row]));
      // The canonical `:recordId` forms: stringified single PK, JSON value
      // tuple for a composite — the same strings pkLabel/rowIdOf produce.
      expect(byId.get(single.id)).toMatchObject({ entityTable: 'public.orders', entityId: '4213' });
      expect(byId.get(composite.id)).toMatchObject({
        entityTable: 'public.order_items',
        entityId: '[4213,7]',
      });
      expect(byId.get(none.id)).toMatchObject({ entityTable: null, entityId: null });
    });

    it('rejects invalid categories/actor kinds and malformed RecordRefs', async () => {
      const audit = auditRepo(t.meta);
      await expect(
        audit.append({ actorKind: 'user', actorLabel: 'A', category: 'nope' as never, action: 'x' }),
      ).rejects.toThrow();
      await expect(
        audit.append({
          actorKind: 'user',
          actorLabel: 'A',
          category: 'data',
          action: 'x',
          entity: { table: 'public.orders' } as never,
        }),
      ).rejects.toThrow();
    });

    it('caps changes at 16 KB with the _truncated marker', async () => {
      const audit = auditRepo(t.meta);
      const huge = { before: { blob: 'x'.repeat(AUDIT_CHANGES_MAX_BYTES) }, after: {} };
      const entry = await audit.append(
        { actorKind: 'system', actorLabel: 'Adminium', category: 'system', action: 'x', changes: huge },
        T0,
      );
      expect(entry.changes).toEqual({ _truncated: true });
    });

    it('filters by category and orders newest first', async () => {
      const audit = auditRepo(t.meta);
      await audit.append({ actorKind: 'system', actorLabel: 'A', category: 'auth', action: 'session.create' }, T0);
      await audit.append({ actorKind: 'system', actorLabel: 'A', category: 'rbac', action: 'role.create' }, T0 + 1);
      await audit.append({ actorKind: 'system', actorLabel: 'A', category: 'auth', action: 'session.revoke' }, T0 + 2);

      const auth = await audit.list({ category: 'auth' });
      expect(auth.map((e) => e.action)).toEqual(['session.revoke', 'session.create']);
    });

    it('gc deletes entries older than the retention window', async () => {
      const audit = auditRepo(t.meta);
      await audit.append({ actorKind: 'system', actorLabel: 'A', category: 'system', action: 'old' }, T0);
      await audit.append({ actorKind: 'system', actorLabel: 'A', category: 'system', action: 'new' }, T0 + 400 * 86_400_000);
      expect(await audit.gc(T0 + 400 * 86_400_000, 365)).toBe(1);
      expect((await audit.list()).map((e) => e.action)).toEqual(['new']);
    });

    it('api keys: create with hash, find by prefix, validity window, revoke', async () => {
      const roles = rolesRepo(t.meta);
      const keys = apiKeysRepo(t.meta);
      const role = await roles.create({ slug: 'admin', name: 'Admin' }, T0);

      const key = await keys.create(
        { name: 'CI key', prefix: 'adm_live_4f2', tokenHash: 'sha256-of-secret', roleId: role.id, expiresAt: T0 + 1_000 },
        T0,
      );
      expect((await keys.findByPrefix('adm_live_4f2'))[0]?.id).toBe(key.id);
      expect(await keys.findValidByTokenHash('sha256-of-secret', T0 + 1)).toMatchObject({ id: key.id });
      expect(await keys.findValidByTokenHash('sha256-of-secret', T0 + 1_001)).toBeNull();

      expect(await keys.revoke(key.id, T0 + 1)).toBe(true);
      expect(await keys.revoke(key.id, T0 + 2)).toBe(false);
      expect(await keys.findValidByTokenHash('sha256-of-secret', T0 + 2)).toBeNull();
    });

    it('password resets: single-use consume and gc', async () => {
      const users = usersRepo(t.meta);
      const resets = passwordResetsRepo(t.meta);
      const u = await users.create({ email: 'a@b.co', name: 'A' }, T0);

      const r = await resets.create({ userId: u.id, kind: 'reset', tokenHash: 'th', expiresAt: T0 + 7_200_000 }, T0);
      expect(await resets.findValidByTokenHash('th', T0 + 1)).toMatchObject({ id: r.id, kind: 'reset' });
      expect(await resets.findValidByTokenHash('th', T0 + 7_200_001)).toBeNull();

      expect(await resets.consume(r.id, T0 + 10)).toBe(true);
      expect(await resets.consume(r.id, T0 + 11)).toBe(false); // single-use
      expect(await resets.findValidByTokenHash('th', T0 + 12)).toBeNull();

      // gc: used tokens go immediately; unexpired-unused stay.
      const keep = await resets.create({ userId: u.id, kind: 'invite', tokenHash: 'th2', expiresAt: T0 + 7 * 86_400_000 }, T0);
      expect(await resets.gc(T0 + 20)).toBe(1);
      expect(await resets.findValidByTokenHash('th2', T0 + 21)).toMatchObject({ id: keep.id });
    });
  });
}
