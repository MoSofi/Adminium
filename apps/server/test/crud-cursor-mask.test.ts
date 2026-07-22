/**
 * Regression: a masked primary key must never leak through the keyset
 * pagination cursor (security review 2026-07-23, PII-masking dimension).
 *
 * parseOrder() always appends the primary key as a sort tiebreaker, and the
 * keyset cursor encodes the sort tuple read from the RAW, pre-mask row. When a
 * PK is itself a masked PII column (a natural key like an email), a caller who
 * cannot read PII could decode the cursor and recover the masked value — the
 * PK tiebreaker bypasses the masked-column 403 the explicit order/select/filter
 * paths enforce. runList() now refuses keyset mode whenever a sort-key column
 * is masked for the caller; offset pagination (no cursor) stays available.
 *
 * Uses a DummyDriver Kysely: the guard throws before any query executes, and
 * the canReadPii=true path compiles-and-executes into the dummy driver's empty
 * result, so no live database is needed.
 */

import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely';
import { describe, expect, it } from 'vitest';

import type { EffectiveModel } from '../src/connections/effective-schema.js';
import type { SourceDatabase } from '../src/connections/manager.js';
import { SnapshotView } from '../src/crud/identifiers.js';
import { runList } from '../src/crud/list.js';
import { ValidationFailedError } from '../src/errors.js';

function semantics(overrides: Record<string, unknown> = {}) {
  return {
    primary: 'plain',
    flags: { secret: false, pii: null, maskedByDefault: false },
    format: null,
    pair: null,
    confidence: 1,
    source: 'heuristic',
    ...overrides,
  };
}

/** A table whose PRIMARY KEY is a masked PII natural key (email). */
const model = {
  dialect: 'postgres',
  name: 'unit',
  defaultSchema: 'public',
  schemas: ['public'],
  enums: [],
  relations: [],
  tables: [
    {
      id: 'public.members',
      schema: 'public',
      name: 'members',
      kind: 'table',
      primaryKey: ['email'],
      columns: [
        {
          name: 'email',
          logicalType: 'varchar',
          nullable: false,
          isPrimaryKey: true,
          semantics: semantics({
            primary: 'email',
            flags: { secret: false, pii: 'email', maskedByDefault: true },
          }),
        },
        { name: 'display_name', logicalType: 'varchar', nullable: false, isPrimaryKey: false, semantics: null },
      ],
    },
  ],
} as unknown as EffectiveModel;

const view = new SnapshotView('conn_1', model);
const table = view.table('public.members');

const db = new Kysely<SourceDatabase>({
  dialect: {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (kysely) => new PostgresIntrospector(kysely),
    createQueryCompiler: () => new PostgresQueryCompiler(),
  },
});

describe('keyset cursor + masked primary key', () => {
  it('marks the PII primary key as masked in the snapshot view', () => {
    expect(table.columns.get('email')?.masked).toBe(true);
    expect(table.primaryKey).toEqual(['email']);
  });

  it('refuses keyset mode for a caller who cannot read PII (no cursor to decode)', async () => {
    await expect(
      runList({ db, view, table, params: { cursor: '' }, canReadPii: false, dialect: 'postgres' }),
    ).rejects.toBeInstanceOf(ValidationFailedError);
  });

  it('still refuses when a real cursor value is supplied', async () => {
    const forged = Buffer.from(JSON.stringify({ k: ['victim@example.com'] }), 'utf8').toString('base64url');
    await expect(
      runList({ db, view, table, params: { cursor: forged }, canReadPii: false, dialect: 'postgres' }),
    ).rejects.toBeInstanceOf(ValidationFailedError);
  });

  it('allows keyset mode for a caller who can read PII', async () => {
    const res = await runList({
      db,
      view,
      table,
      params: { cursor: '' },
      canReadPii: true,
      dialect: 'postgres',
    });
    expect(res.cursor).toBeDefined();
  });

  it('leaves offset pagination available to the masked caller', async () => {
    const res = await runList({
      db,
      view,
      table,
      params: {},
      canReadPii: false,
      dialect: 'postgres',
    });
    expect(res.page).toBeDefined();
    expect(res.cursor).toBeUndefined();
  });
});
