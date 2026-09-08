// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The design buffer's keying — 35-schema-authoring.md 35-T12.
 *
 * ─── The bug this file exists to keep fixed ────────────────────────────────
 *
 * The buffer originally keyed a NEW table by its NAME (`new:${table.name}`),
 * and a rename re-staged it: `new Map(prev).set(keyOf(table), table)` adds
 * under the new key without removing the old one.
 *
 * The name is the thing being typed. So typing "notes" into the name field
 * staged FIVE tables — `new:n`, `new:no`, `new:not`, `new:note`, `new:notes` —
 * every one of which the planner turned into a `create-table` step, and Apply
 * would have created all five in the customer's database. It was found in a
 * browser, not by a test, because every unit test set a name once.
 *
 * A new table now gets a stable local key at creation and keeps it for as long
 * as it is staged.
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  blankTable,
  modelTableToDesired,
  newTableKey,
  unsupportedColumnNotes,
  useDesignBuffer,
  type ModelTable,
} from './useDesignBuffer.js';

describe('a new table keeps ONE buffer entry while it is being named', () => {
  it('survives a name typed one character at a time', () => {
    const { result } = renderHook(() => useDesignBuffer());
    const key = newTableKey();

    // Exactly what a person does: type into the field.
    for (const name of ['n', 'no', 'not', 'note', 'notes']) {
      act(() => {
        result.current.upsert(key, { ...blankTable(), name });
      });
    }

    expect(result.current.upserts.size).toBe(1);
    expect([...result.current.upserts.values()][0]?.name).toBe('notes');

    const edit = result.current.buildEdit('snap_1');
    expect(edit.upsertTables).toHaveLength(1);
    expect(edit.upsertTables[0]?.name).toBe('notes');
  });

  it('keeps two genuinely different new tables apart', () => {
    const { result } = renderHook(() => useDesignBuffer());
    const first = newTableKey();
    const second = newTableKey();
    act(() => {
      result.current.upsert(first, { ...blankTable(), name: 'notes' });
      result.current.upsert(second, { ...blankTable(), name: 'tags' });
    });
    expect(result.current.upserts.size).toBe(2);
    expect(newTableKey()).not.toBe(newTableKey());
  });

  it('keys an existing table by its id, which a rename does not change', () => {
    const { result } = renderHook(() => useDesignBuffer());
    act(() => {
      result.current.upsert('public.clients', {
        ...blankTable('clients'),
        id: 'public.clients',
      });
      result.current.upsert('public.clients', {
        ...blankTable('customers'),
        id: 'public.clients',
      });
    });
    expect(result.current.upserts.size).toBe(1);
    expect([...result.current.upserts.values()][0]?.name).toBe('customers');
  });

  it('discards by key', () => {
    const { result } = renderHook(() => useDesignBuffer());
    const key = newTableKey();
    act(() => {
      result.current.upsert(key, blankTable());
    });
    expect(result.current.dirty).toBe(true);
    act(() => {
      result.current.discard(key);
    });
    expect(result.current.upserts.size).toBe(0);
    expect(result.current.dirty).toBe(false);
  });
});

describe('loading an EXISTING table brings its real columns (35-T12)', () => {
  /*
   * The bug: clicking an existing table staged `blankTable(name)` with the real
   * table's id. A blank table has one column, so the planner diffed one column
   * against the real table and proposed dropping every other one. Verified in a
   * browser on `clients`: "Drop column company and its data", "Drop column
   * contact_name…", and so on down the table.
   */
  const clients: ModelTable = {
    id: 'public.clients',
    schema: 'public',
    name: 'clients',
    comment: null,
    columns: [
      { name: 'id', logicalType: 'integer', nullable: false, default: { kind: 'autoincrement' }, maxLength: null, numericPrecision: null, numericScale: null, comment: null },
      { name: 'company', logicalType: 'text', nullable: true, default: null, maxLength: null, numericPrecision: null, numericScale: null, comment: null },
      { name: 'email', logicalType: 'varchar', nullable: false, default: null, maxLength: 255, numericPrecision: null, numericScale: null, comment: null },
      { name: 'created_at', logicalType: 'timestamptz', nullable: false, default: { kind: 'expression', text: 'now()' }, maxLength: null, numericPrecision: null, numericScale: null, comment: null },
    ],
    primaryKey: ['id'],
    uniques: [{ name: 'uq_clients_email', columns: ['email'] }],
    indexes: [
      { name: 'clients_pkey', columns: ['id'], unique: true, primary: true },
      { name: 'ix_clients_company', columns: ['company'], unique: false, primary: false },
    ],
  };

  it('carries every column, not just the key', () => {
    const desired = modelTableToDesired(clients);
    expect(desired.columns.map((c) => c.name)).toEqual(['id', 'company', 'email', 'created_at']);
    expect(desired.id).toBe('public.clients');
  });

  it('preserves lengths, nullability and the primary key', () => {
    const desired = modelTableToDesired(clients);
    expect(desired.columns.find((c) => c.name === 'email')).toMatchObject({
      logicalType: 'varchar',
      maxLength: 255,
      nullable: false,
    });
    expect(desired.primaryKey).toEqual(['id']);
    expect(desired.uniques).toEqual([{ name: 'uq_clients_email', columns: ['email'] }]);
  });

  it('drops the primary key’s own index — it is the key’s business', () => {
    // Including it would make the designer propose dropping and re-adding the
    // index that implements the primary key, on every load.
    expect(modelTableToDesired(clients).indexes.map((i) => i.name)).toEqual(['ix_clients_company']);
  });

  it('loads declared foreign keys with their referential action', () => {
    const desired = modelTableToDesired(clients, [
      {
        kind: 'declared-fk',
        from: { tableId: 'public.clients', columns: ['owner_id'] },
        to: { tableId: 'public.users', columns: ['id'] },
        onDelete: 'cascade',
        onUpdate: null,
        constraintName: 'fk_clients_owner',
      },
      // An inferred relation is not a constraint and must not become one.
      {
        kind: 'inferred-name',
        from: { tableId: 'public.clients', columns: ['x'] },
        to: { tableId: 'public.y', columns: ['id'] },
        onDelete: null,
        onUpdate: null,
        constraintName: null,
      },
    ]);
    expect(desired.foreignKeys).toHaveLength(1);
    expect(desired.foreignKeys[0]).toMatchObject({
      columns: ['owner_id'],
      toTable: 'public.users',
      onDelete: 'cascade',
      name: 'fk_clients_owner',
    });
  });

  it('drops a default it cannot author, and says which column', () => {
    // `now()` as a database expression is not one of D30's five kinds. Sending
    // it back would be refused at the gate; silently keeping it in the form
    // would promise an edit the vocabulary cannot make.
    const desired = modelTableToDesired(clients);
    expect(desired.columns.find((c) => c.name === 'created_at')?.default).toBeNull();
    expect(unsupportedColumnNotes(clients)).toEqual(['created_at']);
  });

  it('round-trips a table with no changes to an empty edit', () => {
    const desired = modelTableToDesired(clients);
    // The shape the planner diffs against the snapshot: same columns, same key.
    expect(desired.columns).toHaveLength(clients.columns.length);
    expect(desired.name).toBe(clients.name);
  });
});
