// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE KEYS OF PEOPLE SUSPENDED BEFORE THE RULE EXISTED. From this release,
 * stopping a person revokes every API key they made. An upgrade does the same
 * once for those already suspended: each key is revoked, and the audit log
 * says which, whose, and why. Nobody else's key is touched, and a key that
 * names no maker stays, because nothing says it was that person's.
 */
import { describe, expect, it } from 'vitest';

import { apiKeysRepo, applyMigrations, ALL_MIGRATIONS, rolesRepo, usersRepo, type MetaDb } from '../src/index.js';
import { up as revokeOnce } from '../src/migrations/0105_revoke_stopped_keys.js';
import { TEST_DIALECTS } from './helpers/db.js';

const WAVE = '0105_revoke_stopped_keys';
/** The last wave 0.3.70 shipped: a store this upgrade really meets. */
const LAST_IN_0370 = '0099_source_days';

async function keyOf(meta: MetaDb, roleId: string, name: string, createdBy: string | null, expiresAt: number | null = null): Promise<string> {
  const row = await apiKeysRepo(meta).create({ name, prefix: `adm_sk_${name.slice(0, 4)}`, tokenHash: `${name}`.padEnd(64, '0'), roleId, createdBy, expiresAt });
  return row.id;
}

async function auditOf(meta: MetaDb, apiKeyId: string): Promise<{ actorKind: string; category: string; before: Record<string, unknown>; after: Record<string, unknown>; raw: string }[]> {
  const rows = await meta.db.selectFrom('adminium_audit_log').select(['actorKind', 'category', 'changes']).where('action', '=', 'api-key.revoke').execute();
  return rows
    .map((row) => {
      const raw = typeof row.changes === 'string' ? row.changes : JSON.stringify(row.changes);
      const changes = JSON.parse(raw) as { before: Record<string, unknown>; after: Record<string, unknown> };
      return { actorKind: row.actorKind, category: row.category, before: changes.before, after: changes.after, raw };
    })
    .filter((row) => row.before['apiKeyId'] === apiKeyId);
}

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`${WAVE} [${dialect.name}]`, () => {
    it('upgrading a 0.3.70 store revokes the keys of people already suspended, says so in the audit log, and touches nothing else', async () => {
      const t = await dialect.make();
      try {
        const { meta } = t;
        await applyMigrations(meta.db, { dialect: meta.dialect, migrations: ALL_MIGRATIONS.filter((m) => m.name <= LAST_IN_0370) });
        const role = await rolesRepo(meta).create({ slug: 'bots', name: 'Bots' });
        const users = usersRepo(meta);
        const gone = await users.create({ email: 'gone@example.com', name: 'Sam Gone', passwordHash: 'x' });
        const here = await users.create({ email: 'here@example.com', name: 'Ann Here', passwordHash: 'x' });
        const invited = await users.create({ email: 'invited@example.com', name: 'Ivy New', passwordHash: null, status: 'invited' });
        await users.updateStatus(gone.id, 'suspended');

        const live = await keyOf(meta, role.id, 'gone-live', gone.id);
        const lapsed = await keyOf(meta, role.id, 'gone-lapsed', gone.id, 1_000);
        const earlier = await keyOf(meta, role.id, 'gone-earlier', gone.id);
        await apiKeysRepo(meta).revoke(earlier, 5_000);
        const active = await keyOf(meta, role.id, 'here-live', here.id);
        const waiting = await keyOf(meta, role.id, 'invited-live', invited.id);
        const nobody = await keyOf(meta, role.id, 'no-maker', null);

        expect((await applyMigrations(meta.db, { dialect: meta.dialect })).applied).toContain(WAVE);

        const revokedAt = async (id: string) => (await apiKeysRepo(meta).findById(id))?.revokedAt ?? null;
        expect(await revokedAt(live)).not.toBeNull();
        expect(await revokedAt(lapsed)).not.toBeNull();
        expect(await revokedAt(earlier)).toBe(5_000);
        for (const id of [active, waiting, nobody]) expect(await revokedAt(id)).toBeNull();

        const [entry, ...more] = await auditOf(meta, live);
        expect(more).toEqual([]);
        expect(entry).toMatchObject({
          actorKind: 'system',
          category: 'system',
          before: { apiKeyId: live, name: 'gone-live', roleId: role.id, createdBy: gone.id, createdByEmail: 'gone@example.com', createdByName: 'Sam Gone' },
          after: { reason: 'creator-already-suspended' },
        });
        expect(entry!.raw).not.toContain('gone-live'.padEnd(64, '0'));
        expect(await auditOf(meta, lapsed)).toHaveLength(1);
        for (const id of [earlier, active, waiting, nobody]) expect(await auditOf(meta, id)).toEqual([]);

        // A second run has nothing to do, and the person's account is as it was.
        expect((await applyMigrations(meta.db, { dialect: meta.dialect })).applied).toEqual([]);
        expect(await auditOf(meta, live)).toHaveLength(1);
        expect((await users.findById(gone.id))?.status).toBe('suspended');

        // Run again by hand, as a crash before the ledger row would: no key revoked twice, no second entry.
        const firstRevoked = await revokedAt(live);
        await revokeOnce(meta.db as never);
        expect(await revokedAt(live)).toBe(firstRevoked);
        expect(await auditOf(meta, live)).toHaveLength(1);

        // Reinstating the person brings no key back.
        await users.updateStatus(gone.id, 'active');
        await revokeOnce(meta.db as never);
        expect(await revokedAt(live)).toBe(firstRevoked);
      } finally {
        await t.destroy();
      }
    });
  });
}
