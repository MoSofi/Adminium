// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `SnapshotView` refuses system and excluded tables.
 *
 * ─── What this is actually guarding ────────────────────────────────────────
 *
 * Adminium's meta store may live in the SAME database as the operator's data
 * (`enforceMetaPlacement` permits it whenever the role has write + DDL), and
 * `/api/v1/data/:conn/:table` resolves its `:table` segment through this index.
 * The index was built from EVERY table in the model with no filter, and
 * super-admin bypass is total — so a super admin could read, patch and delete
 * `adminium_users`, `adminium_sessions` and `adminium_audit_log` through the
 * source connection's ordinary CRUD routes.
 *
 * The refusal is a 422 `UNKNOWN_IDENTIFIER` rather than a 403 on purpose: the
 * name never enters the allowlist, so every path that resolves an identifier
 * refuses it, for every principal, without each one needing its own check.
 * That is the same reasoning `identifiers.ts:1-8` already gives for resolving
 * identifiers through the snapshot at all.
 */
import { describe, expect, it } from 'vitest';
import { parseDatabaseModel, type DatabaseModel } from '@adminium/engine';

import { applyOverrides } from '../src/connections/effective-schema.js';
import { SnapshotView, UnknownIdentifierError } from '../src/crud/identifiers.js';

const table = (name: string, extra: Record<string, unknown> = {}) => ({
  id: `public.${name}`,
  schema: 'public',
  name,
  columns: [
    { name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false },
    { name: 'label', logicalType: 'text' },
  ],
  primaryKey: ['id'],
  ...extra,
});

/**
 * A model shaped like a same-database meta placement: the operator's own
 * tables beside Adminium's, exactly as the introspector returns them —
 * `system: true` is set by `SYSTEM_TABLE_PATTERN` in all three adapters.
 */
const sameDatabaseModel = (): DatabaseModel =>
  parseDatabaseModel(
    JSON.stringify({
      irVersion: 1,
      dialect: 'postgres',
      name: 'shared',
      defaultSchema: 'public',
      tables: [
        table('customers'),
        table('adminium_users', { system: true }),
        table('adminium_sessions', { system: true }),
        table('_prisma_migrations', { system: true }),
        table('legacy_import'),
      ],
      relations: [],
      enums: [],
    }),
  );

const viewFor = (overrides: Parameters<typeof applyOverrides>[1] = []) =>
  new SnapshotView('conn_1', applyOverrides(sameDatabaseModel(), overrides));

describe('system tables are not addressable through /data', () => {
  it('refuses adminium_users with UNKNOWN_IDENTIFIER, not a 403', () => {
    const view = viewFor();
    expect(() => view.table('adminium_users')).toThrow(UnknownIdentifierError);
    try {
      view.table('adminium_users');
    } catch (error) {
      // 422 is the shape: the name is not a thing that exists, rather than a
      // thing this caller may not have. Super-admin bypass cannot reach it.
      expect((error as UnknownIdentifierError).statusCode).toBe(422);
      expect((error as UnknownIdentifierError).code).toBe('UNKNOWN_IDENTIFIER');
    }
  });

  it('refuses it by qualified id as well as by bare name', () => {
    const view = viewFor();
    expect(() => view.table('public.adminium_users')).toThrow(UnknownIdentifierError);
  });

  it('refuses every table SYSTEM_TABLE_PATTERN marks, not only adminium_ ones', () => {
    const view = viewFor();
    for (const name of ['adminium_users', 'adminium_sessions', '_prisma_migrations']) {
      expect(() => view.table(name), name).toThrow(UnknownIdentifierError);
    }
  });

  it('still resolves the operator’s own tables — the guard is not a blanket', () => {
    const view = viewFor();
    expect(view.table('customers').name).toBe('customers');
    expect(view.table('public.customers').id).toBe('public.customers');
  });
});

describe('excluded tables are not addressable either', () => {
  it('refuses a table the operator excluded in Studio', () => {
    const view = viewFor([
      {
        id: 'ovr_1',
        connectionId: 'conn_1',
        op: 'table.exclude',
        tableName: 'public.legacy_import',
        columnName: null,
        value: { excluded: true },
        origin: 'user',
        status: 'active',
        createdAt: 0,
        updatedAt: 0,
      } as never,
    ]);
    expect(() => view.table('legacy_import')).toThrow(UnknownIdentifierError);
    // …and the rest of the schema is untouched.
    expect(view.table('customers').name).toBe('customers');
  });

  it('resolves it again once the exclusion is lifted', () => {
    expect(viewFor().table('legacy_import').name).toBe('legacy_import');
  });
});
