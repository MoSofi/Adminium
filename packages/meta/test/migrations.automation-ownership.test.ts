// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0051: a rule records what shipped it, on every available dialect.
 *
 * - A store upgraded from before keeps every rule it had, each an owner's:
 *   nothing shipped it.
 * - A manifest ships a rule once a database: the same key twice is refused by
 *   the store, on every engine — and an owner's rules, which name no manifest,
 *   never meet that rule however many there are.
 * - The repo lists what one manifest shipped, and a re-hash is not an edit.
 */
import { sql } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ALL_MIGRATIONS, applyMigrations, automationsRepo, connectionsRepo } from '../src/index.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

const PRE_0051 = ALL_MIGRATIONS.filter((m) => m.name < '0051_automation_ownership');
const UP_TO_0051 = ALL_MIGRATIONS.filter((m) => m.name <= '0051_automation_ownership');
const TRIGGER = { kind: 'record', event: 'created', connectionId: 'cnx_1', table: 'public.users', watch: true } as const;
const GRAPH = { version: 1, nodes: [{ id: 'n1', kind: 'trigger', title: 'When a user signs up' }] } as const;
const crypto = { encrypt: (v: string) => v, decrypt: (v: string) => v };

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`0051_automation_ownership [${dialect.name}]`, () => {
    let t: TestDb;
    beforeEach(async () => {
      t = await dialect.make();
    });
    afterEach(async () => {
      await t.destroy();
    });
    const connection = async (name: string) =>
      (await connectionsRepo(t.meta, crypto).create({ name, engine: 'postgres', introspectDsn: `postgres://ro@db.internal:5432/${name}` })).id;
    const make = (connectionId: string | null, over: Record<string, unknown> = {}) =>
      automationsRepo(t.meta).create({ connectionId, name: 'Rule', trigger: TRIGGER as never, graph: GRAPH as never, ...over });

    it('a store from before it keeps its rules as an owner\'s', async () => {
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: PRE_0051 });
      const now = Date.now();
      await sql`INSERT INTO adminium_automations (id, connection_id, name, description, enabled, ${sql.ref('trigger')}, graph, created_at, updated_at) VALUES (${'auto_old'}, ${null}, ${'Old rule'}, ${null}, ${t.meta.dialect === 'postgres' ? sql`true` : sql`1`}, ${JSON.stringify(TRIGGER)}, ${JSON.stringify(GRAPH)}, ${now}, ${now})`.execute(t.meta.db);

      const applied = await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: UP_TO_0051 });
      expect(applied.applied).toEqual(['0051_automation_ownership']);
      const old = await automationsRepo(t.meta).findById('auto_old');
      expect(old).toMatchObject({ name: 'Old rule', enabled: true, managedBy: null, templateKey: null, contentHash: null });
      // Again: nothing to apply.
      expect((await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: UP_TO_0051 })).applied).toEqual([]);
    });

    it('a manifest ships a rule once a database; an owner\'s rules never meet that rule', async () => {
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });
      const [a, b] = [await connection('A'), await connection('B')];
      const shipped = { managedBy: 'inventory', templateKey: 'low-stock', contentHash: 'h1' };
      const first = await make(a, shipped);
      expect(first).toMatchObject(shipped);
      // The same rule on another database, and another rule of the same manifest here: both fine.
      await make(b, shipped);
      await make(a, { ...shipped, templateKey: 'expiring-soon' });
      // The same rule again on the same database: the store refuses it.
      await expect(make(a, shipped)).rejects.toThrow();
      // Any number of an owner's own rules, on one database and on none.
      for (let n = 0; n < 3; n += 1) {
        await make(a);
        await make(null);
      }
      expect(await automationsRepo(t.meta).list({ connectionId: a })).toHaveLength(5);
    });

    it('lists what one manifest shipped onto one database, oldest first, and re-hashes without touching the rule', async () => {
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });
      const [a, b] = [await connection('A'), await connection('B')];
      const repo = automationsRepo(t.meta);
      const one = await make(a, { managedBy: 'inventory', templateKey: 'one' }, );
      await new Promise((resolve) => setTimeout(resolve, 5));
      const two = await make(a, { managedBy: 'inventory', templateKey: 'two' });
      await make(b, { managedBy: 'inventory', templateKey: 'one' });
      await make(a, { managedBy: 'offers', templateKey: 'one' });
      await make(a);
      expect((await repo.listManagedBy('inventory', a)).map((rule) => rule.templateKey)).toEqual(['one', 'two']);
      expect((await repo.listManagedBy('inventory', b)).map((rule) => rule.id)).toHaveLength(1);
      expect(await repo.listManagedBy('nothing', a)).toEqual([]);

      await repo.setHash(one.id, 'abc');
      const again = await repo.findById(one.id);
      expect(again!.contentHash).toBe('abc');
      expect(again!.updatedAt).toBe(one.updatedAt);
      expect((await repo.findById(two.id))!.contentHash).toBeNull();
    });
  });
}
