// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `dropColumns` — the narrow door for one column going from a table that
 * stays, run against a real database on every engine this machine has.
 *
 * The desired model is the snapshot's own table without the column, so the
 * plan can only hold what was asked for: the column, and the rules that
 * cannot outlive it. SQLite, Postgres and MySQL each drop a column their own
 * way (SQLite rebuilds the table when a rule names it), and the rows and
 * every other column must come through all three.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { snapshotsRepo } from '@adminium/meta';
import type { DatabaseModel } from '@adminium/engine';

import { createAppSchemaTarget } from '../src/apps/schema-target.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { AppError } from '../src/errors.js';
import { ENGINES, installHarness, type Harness } from './app-install-harness.js';
import { TEST_SECRET } from './helpers.js';

let h: Harness;
afterEach(async () => {
  await h.close();
});

const target = () => createAppSchemaTarget({ meta: h.meta, manager: h.manager, crypto: dsnCryptoFromSecret(TEST_SECRET) });

async function columnsOf(table: string): Promise<string[]> {
  const snapshot = await snapshotsRepo(h.meta).latest(h.connectionId);
  return ((snapshot?.schema as DatabaseModel).tables.find((t) => t.name === table)?.columns ?? []).map((c) => c.name);
}

const issuesOf = async (run: () => Promise<unknown>): Promise<{ code: string; message: string }[]> => {
  try {
    await run();
  } catch (error) {
    if (error instanceof AppError) return ((error.details as { issues?: { code: string; message: string }[] } | undefined)?.issues ?? []);
    throw error;
  }
  return [];
};

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`dropping columns from a table that stays [${dialect}]`, { timeout: 120_000 }, () => {
    it('drops the column and what cannot outlive it, and keeps every other column and row', async () => {
      h = await installHarness(dialect);
      await h.run('CREATE TABLE parents (id INTEGER PRIMARY KEY, name VARCHAR(40))');
      await h.run(
        'CREATE TABLE things (id INTEGER PRIMARY KEY, title VARCHAR(40) NOT NULL, code VARCHAR(20), colour VARCHAR(20), parent_id INTEGER, ' +
          'CONSTRAINT uq_things_code UNIQUE (code), CONSTRAINT fk_things_parent FOREIGN KEY (parent_id) REFERENCES parents (id))',
      );
      await h.run('CREATE INDEX ix_things_colour ON things (colour)');
      await h.run(`INSERT INTO parents (id, name) VALUES (1, 'p')`);
      await h.run(`INSERT INTO things (id, title, code, colour, parent_id) VALUES (1, 'one', 'A', 'red', 1), (2, 'two', 'B', 'blue', 1)`);

      // A plain column, one under a unique rule, one under an index, and a link: all in one change.
      const result = await target().edit(
        h.connectionId,
        () => ({
          dropColumns: [
            { table: 'things', column: 'code' },
            { table: 'things', column: 'colour' },
            { table: 'things', column: 'parent_id' },
          ],
        }),
        { superAdmin: true, createdBy: null },
      );
      expect(result.changeId).toEqual(expect.any(String));

      expect(await columnsOf('things')).toEqual(['id', 'title']);
      const rows = await h.rows('SELECT * FROM things ORDER BY id');
      expect(rows.map((row) => ({ id: Number(row['id']), title: row['title'] }))).toEqual([
        { id: 1, title: 'one' },
        { id: 2, title: 'two' },
      ]);
      expect(Object.keys(rows[0] ?? {}).sort()).toEqual(['id', 'title']);
      // The table it linked to is untouched.
      expect(await h.rows('SELECT name FROM parents')).toEqual([{ name: 'p' }]);
      // What is left still holds: a title is still required.
      await expect(h.run('INSERT INTO things (id) VALUES (3)')).rejects.toBeTruthy();
    });

    it('refuses a key column, a column another table links to, an unknown one, and the last one', async () => {
      h = await installHarness(dialect);
      await h.run('CREATE TABLE parents (id INTEGER PRIMARY KEY, name VARCHAR(40))');
      await h.run('CREATE TABLE things (id INTEGER PRIMARY KEY, parent_id INTEGER, CONSTRAINT fk_things_parent FOREIGN KEY (parent_id) REFERENCES parents (id))');
      const drop = (table: string, ...columns: string[]) =>
        issuesOf(() =>
          target().edit(h.connectionId, () => ({ dropColumns: columns.map((column) => ({ table, column })) }), { superAdmin: true, createdBy: null }),
        );

      expect(await drop('things', 'id')).toEqual([expect.objectContaining({ code: 'COLUMN_IN_USE' })]);
      expect((await drop('parents', 'id')).map((issue) => issue.code)).toEqual(['COLUMN_IN_USE', 'COLUMN_IN_USE']);
      expect(await drop('things', 'nope')).toEqual([expect.objectContaining({ code: 'UNKNOWN_COLUMN' })]);
      expect((await drop('parents', 'id', 'name')).some((issue) => issue.message.includes('no column left'))).toBe(true);
      expect(await columnsOf('things')).toEqual(['id', 'parent_id']);
      expect(await columnsOf('parents')).toEqual(['id', 'name']);
    });
  });
}
