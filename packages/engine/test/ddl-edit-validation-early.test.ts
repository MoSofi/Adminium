// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `validateSchemaEdit` — the rules that fire BEFORE a table's own shape is
 * examined, plus the one literal form `literalMatchesType` waves through.
 *
 * Four rules live here, and each one could be deleted today without reddening
 * `ddl-edit.test.ts`:
 *
 *   1. a literal default on a DISPLAY-ONLY column is accepted verbatim — it is
 *      the database's own literal, and Adminium has no grammar for it (D30);
 *   2. an identifier that is not `^[a-z][a-z0-9_]*$` is reported ONCE and the
 *      value is not measured, reserved-checked or namespace-checked after that;
 *   3. a snapshot table whose own name is in the `adminium_` namespace is
 *      refused when the meta store shares this database — the gate that catches
 *      `adminium_pages` when introspection did not mark it `system`;
 *   4. `enumValues` may only name a column of THIS table (D32) — a key that
 *      names nothing is `UNKNOWN_COLUMN`, not a silent no-op.
 */
import { describe, expect, it } from 'vitest';

import {
  columnModelSchema,
  isReservedWord,
  validateSchemaEdit,
  type DesiredColumn,
  type DesiredTable,
  type EditValidationContext,
  type LogicalType,
  type SchemaEdit,
} from '../src/index.js';

// ---------------------------------------------------------------------------
// Fixtures — the same shapes `ddl-edit.test.ts` builds, kept small on purpose.
// ---------------------------------------------------------------------------

const column = (over: Partial<DesiredColumn> = {}): DesiredColumn => ({
  name: 'title',
  logicalType: 'text',
  nullable: true,
  default: null,
  maxLength: null,
  numericPrecision: null,
  numericScale: null,
  comment: null,
  ...over,
});

const table = (over: Partial<DesiredTable> = {}): DesiredTable => ({
  id: null,
  schema: null,
  name: 'articles',
  comment: null,
  columns: [column({ name: 'id', logicalType: 'integer', nullable: false, default: { kind: 'autoincrement' } }), column()],
  primaryKey: ['id'],
  uniques: [],
  indexes: [],
  foreignKeys: [],
  enumValues: {},
  ...over,
});

const edit = (over: Partial<SchemaEdit> = {}): SchemaEdit => ({
  baseSnapshotId: 'snap_1',
  renames: { tables: [], columns: [] },
  upsertTables: [],
  dropTables: [],
  ...over,
});

/**
 * A real `ColumnModel`, parsed rather than cast: the type-authorability rule
 * reads `logicalType` off the SNAPSHOT column, so a fixture that lies about it
 * would decide the outcome of every test in this file.
 */
const actualColumn = (name: string, logicalType: LogicalType, isPrimaryKey = false) =>
  columnModelSchema.parse({ name, logicalType, isPrimaryKey });

const actualTable = (over: Partial<EditValidationContext['actual'][number]> = {}) => ({
  id: 'public.customers',
  schema: 'public',
  name: 'customers',
  kind: 'table' as const,
  system: false,
  columns: [actualColumn('id', 'integer', true), actualColumn('email', 'text')],
  primaryKey: ['id'],
  ...over,
});

const ctx = (over: Partial<EditValidationContext> = {}): EditValidationContext => ({
  dialect: 'postgres',
  maxIdentifierLength: 63,
  actual: [actualTable()],
  metaSharesDatabase: false,
  isReserved: isReservedWord,
  ...over,
});

const codes = (issues: { code: string }[]) => issues.map((i) => i.code).sort();

// ---------------------------------------------------------------------------

describe('a literal default on a display-only column (D30)', () => {
  /*
   * `literalMatchesType` has a grammar for each of the fourteen authorable
   * types and none for the other five, because there is none to have: an
   * `interval`'s literal is `1 day` on postgres and `INTERVAL 1 DAY` on mysql,
   * a `geometry`'s is WKT, an `inet`'s is CIDR. Reaching that arm means an
   * EXISTING column of such a type is being re-defaulted — the one edit D30
   * allows on it — so the text is the database's own and is passed through.
   */
  const displayOnly = ['binary', 'interval', 'geometry', 'inet', 'unknown'] as const;

  /** A string no authorable grammar accepts, so only the type can explain a pass. */
  const OPAQUE = '{{ the database’s own spelling }}';

  const restate = (logicalType: LogicalType) =>
    edit({
      upsertTables: [
        table({
          id: 'public.shifts',
          schema: 'public',
          name: 'shifts',
          columns: [
            column({ name: 'id', logicalType: 'integer', nullable: false, default: { kind: 'autoincrement' } }),
            column({ name: 'span', logicalType, default: { kind: 'literal', text: OPAQUE } }),
          ],
          primaryKey: ['id'],
        }),
      ],
    });

  const withSpan = (logicalType: LogicalType) =>
    ctx({
      actual: [
        actualTable({
          id: 'public.shifts',
          name: 'shifts',
          columns: [actualColumn('id', 'integer', true), actualColumn('span', logicalType)],
        }),
      ],
    });

  it('accepts it for all five display-only types, unparsed', () => {
    for (const logicalType of displayOnly) {
      // Type unchanged from the snapshot, so D30's create/retype gate is silent
      // too — the table round-trips through the designer untouched.
      expect(validateSchemaEdit(restate(logicalType), withSpan(logicalType)), logicalType).toEqual([]);
    }
  });

  it('refuses the same text the moment the column has a grammar', () => {
    // Retyped to `json`, which IS authorable — so nothing refuses the TYPE, and
    // the only thing that can speak is the literal check. Same text, same
    // column, opposite answer: the pass above came from the type, not the text.
    const issues = validateSchemaEdit(restate('json'), withSpan('interval'));
    expect(codes(issues)).toEqual(['INVALID_DEFAULT_LITERAL']);
    expect(issues[0]).toMatchObject({ table: 'public.shifts', column: 'span' });
    expect(issues[0]?.message).toContain('is not a valid json literal');
  });
});

describe('an identifier that is not an identifier', () => {
  /*
   * Zod refuses these at the wire (`identifierSchema`), so this is the
   * in-process defence: `validateSchemaEdit` is exported and any caller may
   * build a `SchemaEdit` by hand. Its contract is to REPORT, never to assume a
   * parse ran.
   */
  it('names the value and the pattern it had to match', () => {
    const issues = validateSchemaEdit(edit({ upsertTables: [table({ name: 'Order Items' })] }), ctx());
    expect(codes(issues)).toEqual(['INVALID_IDENTIFIER']);
    expect(issues[0]?.message).toBe('"Order Items" must match ^[a-z][a-z0-9_]*$');
    expect(issues[0]).toMatchObject({ table: 'Order Items' });
  });

  it('reports it once and stops measuring the value', () => {
    /*
     * The early return is the point. Without it a bad name would collect every
     * downstream verdict as well, and the designer would show four errors for
     * one typo — three of them about a name that is not a name.
     */
    // `isReservedWord` is case-insensitive, so RESERVED_IDENTIFIER is exactly
    // what the next check would have added.
    expect(isReservedWord('SELECT', 'postgres')).toBe(true);
    expect(codes(validateSchemaEdit(edit({ upsertTables: [table({ name: 'SELECT' })] }), ctx()))).toEqual([
      'INVALID_IDENTIFIER',
    ]);

    // …and this one is over the limit AND in the meta namespace: two more
    // verdicts the return swallows.
    const both = validateSchemaEdit(
      edit({ upsertTables: [table({ name: 'adminium_Pages' })] }),
      ctx({ maxIdentifierLength: 8, metaSharesDatabase: true }),
    );
    expect(codes(both)).toEqual(['INVALID_IDENTIFIER']);
  });

  it('points at the column it was authored on', () => {
    const issues = validateSchemaEdit(
      edit({ upsertTables: [table({ columns: [column({ name: 'Order Date' })], primaryKey: [] })] }),
      ctx(),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'INVALID_IDENTIFIER', table: 'articles', column: 'Order Date' });
  });

  it('points a rename at the column being renamed, not at the illegal new name', () => {
    // `where` carries `column: r.from` — the operator selected `email`, and
    // that is the row the designer has to put the error on.
    const issues = validateSchemaEdit(
      edit({ renames: { tables: [], columns: [{ table: 'public.customers', from: 'email', to: 'e-mail' }] } }),
      ctx(),
    );
    expect(codes(issues)).toEqual(['INVALID_IDENTIFIER']);
    expect(issues[0]).toMatchObject({ table: 'public.customers', column: 'email' });
    expect(issues[0]?.message).toContain('"e-mail"');
  });
});

describe('a snapshot table inside Adminium’s own namespace', () => {
  /*
   * `checkIdentifier` guards the name a client AUTHORS. This one guards the
   * name a table ALREADY HAS: connect a source that happens to be the meta
   * database and `adminium_pages` is in the snapshot like any other table —
   * introspection only marks the DATABASE's system catalogs `system`, so the
   * `SYSTEM_TABLE` gate above it does not fire. Dropping it would take the
   * instance's own pages with it.
   */
  const metaCtx = (over: Partial<EditValidationContext> = {}) =>
    ctx({
      actual: [actualTable({ id: 'public.adminium_pages', name: 'adminium_pages' })],
      metaSharesDatabase: true,
      ...over,
    });

  it('refuses a drop of it, by table id', () => {
    const issues = validateSchemaEdit(edit({ dropTables: ['public.adminium_pages'] }), metaCtx());
    expect(codes(issues)).toEqual(['META_NAMESPACE']);
    expect(issues[0]).toMatchObject({ table: 'public.adminium_pages' });
    expect(issues[0]?.message).toBe('"public.adminium_pages" belongs to Adminium\'s own meta store');
  });

  it('allows the same drop when the meta store lives in another database', () => {
    // The name alone proves nothing: an application is free to own a table
    // called `adminium_pages` in a database Adminium does not share.
    expect(
      validateSchemaEdit(edit({ dropTables: ['public.adminium_pages'] }), metaCtx({ metaSharesDatabase: false })),
    ).toEqual([]);
  });

  it('stops the operation there — no further verdict on that table', () => {
    /*
     * `refuseProtected` returns true, so the rename's own checks never run.
     * `customers` is already taken, which is the DUPLICATE_TABLE this edit
     * would otherwise have earned as well.
     */
    const issues = validateSchemaEdit(
      edit({ renames: { tables: [{ from: 'public.adminium_pages', to: 'customers' }], columns: [] } }),
      metaCtx({ actual: [actualTable(), actualTable({ id: 'public.adminium_pages', name: 'adminium_pages' })] }),
    );
    expect(codes(issues)).toEqual(['META_NAMESPACE']);
  });
});

describe('enumValues names a column of this table (D32)', () => {
  it('refuses a key that names no column here', () => {
    // The typo case: `status` carries the list, `statuz` carries nothing, and
    // silently dropping it would ship a table with no CHECK and no complaint.
    const issues = validateSchemaEdit(
      edit({
        upsertTables: [
          table({
            columns: [column({ name: 'id', logicalType: 'integer' }), column({ name: 'status', logicalType: 'enum' })],
            primaryKey: ['id'],
            enumValues: { status: ['draft', 'sent'], statuz: ['draft'] },
          }),
        ],
      }),
      ctx(),
    );
    expect(codes(issues)).toEqual(['UNKNOWN_COLUMN']);
    expect(issues[0]).toMatchObject({ table: 'articles', column: 'statuz' });
    expect(issues[0]?.message).toBe('enumValues names "statuz", which is not a column here');
  });

  it('scopes the lookup to THIS table, not to the whole edit', () => {
    // `state` is a real enum column — on the other table in the same document.
    // A value list is a CHECK, and a CHECK belongs to one table.
    const issues = validateSchemaEdit(
      edit({
        upsertTables: [
          table({
            name: 'authors',
            columns: [column({ name: 'id', logicalType: 'integer' }), column({ name: 'state', logicalType: 'enum' })],
            primaryKey: ['id'],
            enumValues: { state: ['active', 'retired'] },
          }),
          table({ enumValues: { state: ['active', 'retired'] } }),
        ],
      }),
      ctx(),
    );
    expect(codes(issues)).toEqual(['UNKNOWN_COLUMN']);
    expect(issues[0]).toMatchObject({ table: 'articles', column: 'state' });
  });
});
