// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `readLiveTables` — the install check reads the database as it is NOW, not
 * the last snapshot.
 *
 * The adapter is a stand-in with the real `introspect` contract: these cases
 * are about what the reader asks for and what it does with the answer, and the
 * adapters' own `tableFilter` handling is covered where they live.
 */
import { describe, expect, it } from 'vitest';

import { readLiveTables, type SchemaTargetCoreDeps } from '../src/add-ons/schema-target.js';

interface FakeTable {
  schema: string;
  name: string;
  columns: { name: string; isPrimaryKey: boolean; dbType: string; nullable: boolean; default: unknown; isGenerated: boolean; logicalType?: string; maxLength?: number | null; isUnique?: boolean }[];
  uniques?: { name: string; columns: string[] }[];
  indexes?: { name: string; columns: string[]; unique: boolean; primary: boolean; partial: boolean; expression: string | null }[];
}

function depsWith(tables: FakeTable[], opts: { fail?: boolean } = {}) {
  const asked: { schema: string; name: string }[] = [];
  let closed = 0;
  const deps = {
    meta: {} as never,
    manager: {
      introspectAdapter: async () => ({
        dialect: 'postgres',
        introspect: async (o: { tableFilter?: (t: { schema: string; name: string }) => boolean }) => {
          if (opts.fail === true) throw new Error('connection refused');
          const kept = tables
            .filter((t) => {
              asked.push({ schema: t.schema, name: t.name });
              return o.tableFilter?.({ schema: t.schema, name: t.name }) ?? true;
            })
            .map((t) => ({ uniques: [], indexes: [], ...t }));
          return { dialect: 'postgres', defaultSchema: 'public', tables: kept };
        },
        close: async () => {
          closed += 1;
        },
      }),
    },
  } as unknown as SchemaTargetCoreDeps;
  return { deps, asked, closed: () => closed };
}

const col = (name: string, extra: Partial<FakeTable['columns'][number]> = {}) => ({
  name,
  logicalType: extra.dbType ?? 'text',
  maxLength: null,
  isPrimaryKey: false,
  dbType: 'text',
  nullable: true,
  default: null,
  isGenerated: false,
  ...extra,
});

describe('readLiveTables', () => {
  it('returns only the named tables, shaped for the planner', async () => {
    const { deps } = depsWith([
      { schema: 'public', name: 'payments', columns: [col('id', { isPrimaryKey: true, dbType: 'integer', nullable: false }), col('invoice_id', { nullable: false })] },
      { schema: 'public', name: 'unrelated', columns: [col('id')] },
    ]);
    const { tables, dialect } = await readLiveTables(deps, 'conn', new Set(['payments', 'tickets']));
    expect(dialect).toBe('postgres');
    expect(tables).toEqual([
      {
        ref: 'payments',
        columns: [
          { ref: 'id', isPrimaryKey: true, dbType: 'integer', nullable: false, hasDefault: false, isGenerated: false, logicalType: 'integer', maxLength: null, isIdentity: false },
          { ref: 'invoice_id', isPrimaryKey: false, dbType: 'text', nullable: false, hasDefault: false, isGenerated: false, logicalType: 'text', maxLength: null, isIdentity: false },
        ],
        uniques: [],
      },
    ]);
  });

  it('says which columns the table keeps unique: alone, or together, by a constraint or a unique index', async () => {
    const { deps } = depsWith([
      {
        schema: 'public',
        name: 'versions',
        columns: [col('id', { isPrimaryKey: true }), col('code', { isUnique: true }), col('proposal_id'), col('v'), col('note')],
        uniques: [{ name: 'uq_versions_code', columns: ['code'] }],
        indexes: [
          { name: 'uq_versions_v', columns: ['proposal_id', 'v'], unique: true, primary: false, partial: false, expression: null },
          // A partial or plain index keeps nothing unique across the table.
          { name: 'ix_note', columns: ['note'], unique: true, primary: false, partial: true, expression: null },
          { name: 'ix_v', columns: ['v'], unique: false, primary: false, partial: false, expression: null },
        ],
      },
    ]);
    const [versions] = (await readLiveTables(deps, 'conn', new Set(['versions']))).tables;
    expect(versions?.uniques).toEqual([['code'], ['proposal_id', 'v']]);
    expect(versions?.columns.find((c) => c.ref === 'code')?.isUnique).toBe(true);
  });

  it('prefers the default schema when a name exists in two', async () => {
    const { deps } = depsWith([
      { schema: 'archive', name: 'tickets', columns: [col('old')] },
      { schema: 'public', name: 'tickets', columns: [col('number')] },
    ]);
    const [tickets] = (await readLiveTables(deps, 'conn', new Set(['tickets']))).tables;
    expect(tickets?.columns.map((c) => c.ref)).toEqual(['number']);
  });

  it('asks nothing when the manifest names nothing', async () => {
    const { deps, asked } = depsWith([{ schema: 'public', name: 'x', columns: [] }]);
    expect((await readLiveTables(deps, 'conn', new Set())).tables).toEqual([]);
    expect(asked).toEqual([]);
  });

  it('closes the adapter even when the read fails', async () => {
    const probe = depsWith([], { fail: true });
    await expect(readLiveTables(probe.deps, 'conn', new Set(['a']))).rejects.toThrow('connection refused');
    expect(probe.closed()).toBe(1);
  });
});
