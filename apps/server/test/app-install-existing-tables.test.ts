// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "USE THE EXISTING TABLES" CHANGES NONE OF THEM, on every engine this run can
 * reach (plan 76 §8.4, S9).
 *
 * A file installed onto a database that already holds its tables — a copy of
 * the one the dashboard was saved from — uses every one of them as it is, in
 * one answer: no table made, renamed, altered or indexed. Proved by a dump of
 * the database's tables, columns, constraints and indexes, the same before
 * and after. A table that could only be used with a change, or that the answers
 * would rename out of the way, stops the install, by name.
 */
import { appTablesRepo, manifestsRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { ENGINES, installHarness, type Dialect, type Harness } from './app-install-harness.js';

type Doc = Record<string, unknown>;
const CRYPTO = { encrypt: (v: string) => v, decrypt: (v: string) => v };

function studio(version = '1.0.0', extraColumn = false): Doc {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'studio',
    name: 'Studio',
    version,
    publisher: { id: 'local', name: 'Made here' },
    license: 'AGPL-3.0-only',
    description: { key: 'd', fallback: 'A studio.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: '0.3.49' },
    requiredSchema: {
      tables: [
        { ref: 'classes', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'title', type: 'text', maxLength: 80 }, { ref: 'code', type: 'text', maxLength: 20, unique: true, nullable: true }] },
        {
          ref: 'bookings',
          columns: [
            { ref: 'id', type: 'int', role: 'pk' },
            { ref: 'class_id', type: 'fk', references: 'classes' },
            { ref: 'name', type: 'text', maxLength: 80 },
            ...(extraColumn ? [{ ref: 'paid', type: 'bool', nullable: true }] : []),
          ],
        },
      ],
    },
    pages: [{ ref: 'studio-classes', template: 'page-crud', title: { key: 't', fallback: 'Classes' }, nav: { group: 'records', icon: 'list', order: 1 }, bindings: { rows: 'classes' } }],
    frontends: [{ side: 'staff', kind: 'spa' }],
  };
}

/** Every table, column, constraint and index of the database, as text: equal dumps, no DDL. */
async function dump(h: Harness, dialect: Dialect): Promise<string[]> {
  const rows = async (statement: string) => (await h.rows(statement)).map((row) => JSON.stringify(Object.values(row)));
  if (dialect === 'sqlite') return rows(`SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`);
  if (dialect === 'postgres') {
    return [
      ...(await rows(`SELECT table_name, column_name, data_type, character_maximum_length, is_nullable, column_default FROM information_schema.columns WHERE table_schema = current_schema() ORDER BY 1, 2`)),
      ...(await rows(`SELECT conrelid::regclass::text, conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE connamespace = current_schema()::regnamespace ORDER BY 1, 2`)),
      ...(await rows(`SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = current_schema() ORDER BY 1, 2`)),
    ];
  }
  return [
    ...(await rows(`SELECT table_name, column_name, column_type, is_nullable, column_default, extra FROM information_schema.columns WHERE table_schema = database() ORDER BY 1, 2`)),
    ...(await rows(`SELECT table_name, index_name, non_unique, column_name, seq_in_index FROM information_schema.statistics WHERE table_schema = database() ORDER BY 1, 2, 5`)),
    ...(await rows(`SELECT table_name, constraint_name, constraint_type FROM information_schema.table_constraints WHERE table_schema = database() ORDER BY 1, 2`)),
  ];
}

/**
 * A database that holds the app's tables and knows nothing of the app: the
 * app installed and taken away with its tables kept, and what Adminium
 * recorded of them forgotten — as a copy of the database brought to another
 * server is.
 */
async function copiedDatabase(h: Harness): Promise<void> {
  const made = await h.install(studio());
  expect(made.statusCode, made.body).toBe(200);
  const installed = (await manifestsRepo(h.meta, CRYPTO).listByKey('studio'))[0]!;
  const removed = await h.inject({ method: 'DELETE', url: `/apps/studio?connectionId=${h.connectionId}`, payload: { dropTables: false } });
  expect(removed.statusCode, removed.body).toBe(200);
  await h.meta.db.deleteFrom('adminium_app_tables').where('connectionId', '=', h.connectionId).execute();
  expect((await manifestsRepo(h.meta, CRYPTO).listByKey('studio')).map((one) => one.row.id)).not.toContain(installed.row.id);
  await h.rows(`INSERT INTO classes (title, code) VALUES ('Wheel throwing', 'WT1')`);
  // The file, brought to this server: the last copy's uninstall took its package with it.
  await h.stage(studio());
}

let open: Harness | null = null;
afterEach(async () => {
  await open?.close();
  open = null;
});

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`using the existing tables — ${dialect}`, () => {
    it('installs onto a copied database with no DDL at all, its rows kept', async () => {
      const h = (open = await installHarness(dialect));
      await copiedDatabase(h);
      const before = await dump(h, dialect);

      const plan = await h.inject({ method: 'POST', url: '/apps/plan', payload: { key: 'studio', version: '1.0.0', connectionId: h.connectionId, existing: 'use' } });
      expect(plan.statusCode, plan.body).toBe(200);
      const planned = (JSON.parse(plan.body) as { plan: { installable: boolean; problems: unknown[]; tables: { ref: string; action: string; edits: unknown[] }[] } }).plan;
      expect(planned.problems).toEqual([]);
      expect(planned.installable).toBe(true);
      expect(planned.tables.map((table) => [table.ref, table.action, table.edits.length]).sort()).toEqual([['bookings', 'reuse', 0], ['classes', 'reuse', 0]]);

      const installed = await h.inject({ method: 'POST', url: '/apps/install', payload: { key: 'studio', version: '1.0.0', connectionId: h.connectionId, existing: 'use' } });
      expect(installed.statusCode, installed.body).toBe(200);
      expect(await dump(h, dialect)).toEqual(before);
      // Used, not made: the app keeps them as found, and the row that was there is there.
      const records = await appTablesRepo(h.meta).forConnection(h.connectionId);
      expect(records.map((record) => [record.ref, record.owned, record.state]).sort()).toEqual([['bookings', false, 'adopted'], ['classes', false, 'adopted']]);
      expect((await h.rows('SELECT title FROM classes')).map((row) => row['title'])).toEqual(['Wheel throwing']);
    });

    it('stops at a table it could only use with a change, and never renames one out of the way', async () => {
      const h = (open = await installHarness(dialect));
      await copiedDatabase(h);
      const before = await dump(h, dialect);
      await h.stage(studio('1.1.0', true));

      // The newer file's bookings has a column the copy does not: using it would add one.
      const plan = await h.inject({ method: 'POST', url: '/apps/plan', payload: { key: 'studio', version: '1.1.0', connectionId: h.connectionId, existing: 'use' } });
      const planned = (JSON.parse(plan.body) as { plan: { installable: boolean; problems: { code: string; table: string; message: string }[] } }).plan;
      expect(planned.installable).toBe(false);
      expect(planned.problems).toEqual([
        { code: 'EXISTING_TABLE_UNUSABLE', table: 'bookings', message: '"bookings" is here already, and using it would add the column "paid". Using the existing tables changes none of them.' },
      ]);
      const refused = await h.inject({ method: 'POST', url: '/apps/install', payload: { key: 'studio', version: '1.1.0', connectionId: h.connectionId, existing: 'use' } });
      expect(refused.statusCode, refused.body).toBe(422);
      expect(refused.body).toContain('EXISTING_TABLE_UNUSABLE');

      // An answer that would rename one out of the way is not "using" it.
      const renaming = await h.inject({
        method: 'POST',
        url: '/apps/plan',
        payload: { key: 'studio', version: '1.0.0', connectionId: h.connectionId, existing: 'use', choices: { classes: { action: 'rename-existing', to: 'classes_old' } } },
      });
      const renamed = (JSON.parse(renaming.body) as { plan: { installable: boolean; problems: { code: string; table: string }[] } }).plan;
      expect(renamed.installable).toBe(false);
      expect(renamed.problems).toContainEqual(expect.objectContaining({ code: 'EXISTING_TABLE_UNUSABLE', table: 'classes' }));
      expect(await dump(h, dialect)).toEqual(before);
    });
  });
}
