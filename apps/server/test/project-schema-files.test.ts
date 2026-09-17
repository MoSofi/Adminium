// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Schema files: a database's schema customizations as
 * `schema/<database>.json`, and back.
 */
import BetterSqlite3 from 'better-sqlite3';
import { connectionsRepo, createSqliteMetaDb, firstRun, overridesRepo, type SchemaOverride } from '@adminium/meta';
import { describe, expect, it } from 'vitest';

import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { applySchemaFile } from '../src/project/apply-files.js';
import { fileHash, normalizeForHash } from '../src/project/project-files.js';
import { readSchemaFile, SCHEMA_FILE_SCHEMA_REF, toSchemaFile } from '../src/project/schema-files.js';

let sequence = 0;
/** An override row; `op` is a plain string because `llm.*` ops sit outside the remap vocabulary type. */
function row(fields: Partial<Omit<SchemaOverride, 'op'>> & { op: string; tableName: string }): SchemaOverride {
  sequence += 1;
  return {
    id: `ovr_${String(sequence)}`,
    connectionId: 'conn_x',
    columnName: null,
    value: {},
    origin: 'user',
    llmRunId: null,
    status: 'active',
    confidence: null,
    createdBy: null,
    createdAt: sequence,
    updatedAt: sequence,
    ...fields,
  } as SchemaOverride;
}

describe('writing a database\'s overrides as a file', () => {
  it('sorts rows, leaves out the defaults and what every install derives', () => {
    const file = toSchemaFile([
      row({ op: 'column.pii', tableName: 'main.customers', columnName: 'email', value: { masked: true }, origin: 'auto' }),
      row({ op: 'table.label', tableName: 'main.orders', value: { label: 'Sales' } }),
      row({ op: 'column.hidden', tableName: 'main.customers', columnName: 'notes', value: { hidden: true }, status: 'disabled' }),
      row({ op: 'llm.label', tableName: 'main.customers', value: { en_US: 'Clients' }, origin: 'llm', confidence: 0.8, llmRunId: 'run_1' }),
    ]);
    expect(file).toEqual({
      $schema: SCHEMA_FILE_SCHEMA_REF,
      overrides: [
        { table: 'main.customers', op: 'llm.label', value: { en_US: 'Clients' }, origin: 'llm', confidence: 0.8 },
        { table: 'main.customers', column: 'notes', op: 'column.hidden', value: { hidden: true }, status: 'disabled' },
        { table: 'main.orders', op: 'table.label', value: { label: 'Sales' } },
      ],
    });
  });

  it('keeps only the row that applies when several set the same thing', () => {
    const file = toSchemaFile([
      row({ op: 'table.label', tableName: 'main.orders', value: { label: 'First' } }),
      row({ op: 'table.label', tableName: 'main.orders', value: { label: 'Second' } }),
      row({ op: 'table.label', tableName: 'main.orders', value: { label: 'Off' }, status: 'disabled' }),
    ]);
    expect(file['overrides']).toEqual([{ table: 'main.orders', op: 'table.label', value: { label: 'Second' } }]);
  });
});

describe('reading a schema file', () => {
  it('turns rows into what the database stores', () => {
    const read = readSchemaFile({
      overrides: [
        { table: 'main.orders', op: 'table.label', value: { label: 'Sales' } },
        { table: 'main.customers', column: 'email', op: 'column.pii', value: { masked: false }, status: 'disabled' },
        { table: 'main.customers', op: 'llm.label', value: { en_US: 'Clients' }, origin: 'llm', confidence: 0.5 },
      ],
    });
    expect(read).toEqual({
      ok: true,
      rows: [
        { op: 'table.label', tableName: 'main.orders', columnName: null, value: { label: 'Sales' }, origin: 'user', status: 'active', confidence: null },
        { op: 'column.pii', tableName: 'main.customers', columnName: 'email', value: { masked: false }, origin: 'user', status: 'disabled', confidence: null },
        { op: 'llm.label', tableName: 'main.customers', columnName: null, value: { en_US: 'Clients' }, origin: 'llm', status: 'active', confidence: 0.5 },
      ],
    });
  });

  it('names the row and field for each mistake', () => {
    const problems = (overrides: unknown[], extra: Record<string, unknown> = {}): string[] => {
      const read = readSchemaFile({ overrides, ...extra });
      return read.ok ? [] : read.problems;
    };
    expect(problems([], { tables: {} })).toEqual(['tables: is not a known key']);
    expect(readSchemaFile({})).toEqual({ ok: false, problems: ['overrides: must be a list'] });
    expect(problems([{ op: 'table.label', value: { label: 'X' } }])).toEqual([
      'overrides[0].table: must name a table, like "public.customers"',
    ]);
    expect(problems([{ table: 't', op: 'table.label', value: { label: 'X' }, note: 1 }])).toEqual([
      'overrides[0].note: is not a known key',
    ]);
    expect(problems([{ table: 't', op: 'column.label', value: { label: 'X' } }])).toEqual([
      'overrides[0]: op column.label requires columnName',
    ]);
    expect(problems([{ table: 't', op: 'table.label', value: { label: 'X', colour: 'red' } }])).toEqual([
      'overrides[0]: value.colour: is not part of table.label',
    ]);
    expect(problems([{ table: 't', op: 'llm.label', value: { en_US: 'X' } }])).toEqual([
      'overrides[0]: op llm.label is written by AI assist; set "origin": "llm"',
    ]);
    expect(problems([{ table: 't', op: 'table.rename', value: {} }])[0]).toMatch(/^overrides\[0\]: /);
    expect(problems([{ table: 't', op: 'table.label', value: { label: 'X' }, status: 'paused' }])).toEqual([
      'overrides[0].status: must be active or disabled',
    ]);
    expect(problems([{ table: 't', op: 'llm.label', value: {}, origin: 'llm', confidence: 2 }])).toEqual([
      'overrides[0].confidence: must be a number from 0 to 1',
    ]);
    expect(
      problems([
        { table: 't', op: 'table.label', value: { label: 'X' } },
        { table: 't', op: 'table.label', value: { label: 'Y' } },
      ]),
    ).toEqual(['overrides[1]: another row already sets table.label on t']);
    expect(problems([{ table: 't', op: 'table.label', value: { label: 'usr_01J8ME7Q2RZX4V9T6W3YB0KD5N' } }])).toEqual([
      'overrides[0].value.label: "usr_01J8ME7Q2RZX4V9T6W3YB0KD5N" is an id from one install; files name things by key or name instead',
    ]);
    expect(readSchemaFile([])).toEqual({ ok: false, problems: ['(the file): must be a JSON object'] });
    expect(problems([], { $schema: 3 })).toEqual(['$schema: must be a string']);
    expect(problems(['orders', null])).toEqual(['overrides[0]: must be an object', 'overrides[1]: must be an object']);
    expect(problems([{ table: 't', column: '', op: 'column.hidden', value: { hidden: true } }])).toEqual([
      'overrides[0].column: must name a column',
    ]);
    expect(problems([{ table: 't', op: 7, value: {} }])).toEqual(['overrides[0].op: must be a string']);
    expect(problems([{ table: 't', op: 'table.label', value: { label: 'X' }, origin: 'auto' }])).toEqual([
      'overrides[0].origin: must be user or llm',
    ]);
  });
});

describe('a schema file through the database', () => {
  it('comes back as the same file, and leaves the auto rows alone', async () => {
    const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    const at = Date.now();
    const connection = await connectionsRepo(meta, dsnCryptoFromSecret('schema-files-test-secret')).create({
      name: 'main',
      engine: 'sqlite',
      introspectDsn: 'sqlite:./shop.db',
      projectKey: 'main',
    });
    const connectionId = connection.id;
    const overrides = overridesRepo(meta);
    await overrides.create({ connectionId, op: 'column.pii', origin: 'auto', tableName: 'main.customers', columnName: 'email', value: { masked: true } });

    const file = {
      $schema: SCHEMA_FILE_SCHEMA_REF,
      overrides: [
        { table: 'main.customers', op: 'llm.label', value: { en_US: 'Clients' }, origin: 'llm', confidence: 0.8 },
        { table: 'main.orders', op: 'relation.add', value: { fromColumn: 'customer_id', toTable: 'main.customers', toColumn: 'id', cardinality: 'many-to-one' } },
      ],
    };
    const read = readSchemaFile(file);
    if (!read.ok) throw new Error(read.problems.join('; '));
    await applySchemaFile(meta, connectionId, read.rows, at);

    const stored = await overrides.listForConnection(connectionId);
    expect(stored.filter((item) => item.origin === 'auto')).toHaveLength(1);
    expect(toSchemaFile(stored)).toEqual(file);
    expect(fileHash('schema/main.json', toSchemaFile(stored))).toBe(fileHash('schema/main.json', file));
  });
});

describe('comparing schema files', () => {
  it('ignores row order, $schema and restated defaults', () => {
    const written = { $schema: SCHEMA_FILE_SCHEMA_REF, overrides: [{ table: 'a', op: 'table.label', value: { label: 'A' } }, { table: 'b', op: 'table.exclude', value: { excluded: true } }] };
    const byHand = { overrides: [{ table: 'b', op: 'table.exclude', value: { excluded: true }, status: 'active' }, { table: 'a', op: 'table.label', value: { label: 'A' }, origin: 'user' }] };
    expect(normalizeForHash('schema/main.json', byHand)).toEqual(normalizeForHash('schema/main.json', written));
    expect(fileHash('schema/main.json', byHand)).toBe(fileHash('schema/main.json', written));
    expect(fileHash('schema/main.json', { overrides: [] })).not.toBe(fileHash('schema/main.json', written));
  });
});
