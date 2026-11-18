// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A TABLE ONLY ADMINIUM REMOVES ROWS FROM (`sealedRecords`, a chat add-on's
 * conversations, messages and choices): a person's delete is refused on
 * every delete path of the write service (a single delete, a bulk check, a
 * many-row delete's before step), whatever door sent it (a save, a bulk
 * change, a rule's step, an API key). Adminium's own writes still pass, and
 * a table that is not sealed (a forms add-on's answers) keeps its delete.
 */
import BetterSqlite3 from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { SourceDatabase } from '../src/connections/manager.js';
import type { ResolvedColumn, ResolvedTable, SnapshotView } from '../src/crud/identifiers.js';
import { createWriteService, type WriteContext, type WriteTarget } from '../src/crud/write-service.js';
import type { WriteOrigin } from '../src/crud/write-context.js';

function column(name: string, logicalType: ResolvedColumn['logicalType'], extra: Partial<ResolvedColumn> = {}): ResolvedColumn {
  return { name, logicalType, nullable: true, isPrimaryKey: false, masked: false, secret: false, textish: false, ...extra };
}

const table: ResolvedTable = {
  id: 'main.conversations',
  schema: 'main',
  name: 'conversations',
  primaryKey: ['id'],
  columns: new Map([column('id', 'integer', { isPrimaryKey: true, nullable: false }), column('state', 'text')].map((c) => [c.name, c])),
  readOnly: false,
  table: {} as ResolvedTable['table'],
};
const view = { table: () => table } as unknown as SnapshotView;

const as = (origin: WriteOrigin): WriteContext => ({ origin, hops: 0, actor: { kind: 'user', id: 'usr_1', label: 'Ada' }, request: null });

let raw: BetterSqlite3.Database;
let db: Kysely<SourceDatabase>;
let target: WriteTarget;

beforeEach(() => {
  raw = new BetterSqlite3(':memory:');
  raw.exec('CREATE TABLE conversations (id INTEGER PRIMARY KEY, state TEXT)');
  raw.exec("INSERT INTO conversations (id, state) VALUES (1, 'open'), (2, 'open')");
  db = new Kysely<SourceDatabase>({ dialect: new SqliteDialect({ database: raw }) });
  target = { connectionId: 'conn_1', view, table, db, dialect: 'sqlite' };
});

afterEach(async () => {
  await db.destroy();
});

const left = (): number => (raw.prepare('SELECT COUNT(*) AS n FROM conversations').get() as { n: number }).n;

describe('a sealed table refuses a person’s delete on every path', () => {
  const sealed = createWriteService({ sealedRecords: async (connectionId, tableId) => connectionId === 'conn_1' && tableId === 'main.conversations' });

  for (const origin of ['dashboard', 'bulk', 'automation', 'hook', 'action'] as const) {
    it(`a single delete from ${origin}`, async () => {
      await expect(sealed.delete({ target, pk: { id: 1 }, context: as(origin), announce: async () => {} })).rejects.toMatchObject({ code: 'TABLE_FORBIDDEN', details: { reason: 'adminium-keeps' } });
      expect(left()).toBe(2);
    });
  }

  it('a bulk delete: its check and its before step', async () => {
    await expect(sealed.check('delete', target, as('bulk'), [{ id: 1 }, { id: 2 }])).rejects.toMatchObject({ details: { reason: 'adminium-keeps' } });
    await expect(sealed.beforeEach('delete', target, as('bulk'), [{ match: { id: 1 }, values: {} }])).rejects.toMatchObject({ details: { reason: 'adminium-keeps' } });
    expect(left()).toBe(2);
  });

  it('a person’s create and change say the rows are only read, never deleted', async () => {
    const own = createWriteService({ ownRecords: async () => true, sealedRecords: async () => true });
    await expect(own.check('update', target, as('dashboard'), [{ id: 1, state: 'closed' }])).rejects.toMatchObject({ message: 'Only Adminium writes these rows. You can read them.', details: { reason: 'adminium-writes' } });
  });

  it('Adminium’s own write still removes a row', async () => {
    await sealed.delete({ target, pk: { id: 1 }, context: as('public'), announce: async () => {} });
    expect(left()).toBe(1);
  });

  it('a table that is not sealed (a forms answer) keeps its delete', async () => {
    const open = createWriteService({ ownRecords: async () => true, sealedRecords: async () => false });
    await open.delete({ target, pk: { id: 2 }, context: as('dashboard'), announce: async () => {} });
    expect(left()).toBe(1);
  });
});
