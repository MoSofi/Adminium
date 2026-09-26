// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `SchemaEdit` — the desired-state document a client authors, and the closed
 * vocabulary it may author in.
 *
 * ─── Why this is not `TableModel` ──────────────────────────────────────────
 *
 * `TableModel` is what the INTROSPECTOR produces. It carries `dbType` (the
 * verbatim native type), `system`, `rowCountEstimate`, `activity`, `rls`,
 * `sizeBytes`, `semantics` and `label` — facts about a table that already
 * exists, several of which are security-relevant (`system` is the refusal
 * predicate) and none of which a client may assert. Accepting `TableModel` on
 * the wire would let a caller declare `system: false` on `adminium_users`.
 *
 * So the wire shape is `DesiredTable`: what a person can decide. The server
 * converts it to a `TableModel` through {@link desiredTableToModel} — which is
 * the ONLY place a native type string is produced from an authored one — and
 * the rest of the pipeline speaks the IR as it always has.
 *
 * ─── Why the vocabulary is closed (D30) ────────────────────────────────────
 *
 * D14 says this is not a SQL console. That is a promise about what a caller
 * can cause to be executed, and it is kept HERE or nowhere: two fields in the
 * IR are free text that reaches SQL — `ColumnDefault.expression.text` and
 * `checks[].expression`. Both are absent from this vocabulary. A default is
 * one of five closed kinds, and a check is authorable only as enum membership
 * (the planner emits `CHECK (col IN (…))` from a value list). An existing
 * expression in the snapshot passes through untouched, because refusing to
 * rename a column on a table that has one would be an editor that cannot edit
 * — but nothing a client sends ever becomes one.
 *
 * Fourteen of the IR's nineteen logical types are authorable. The other five
 * (`binary`, `interval`, `geometry`, `inet`, `unknown`) are display-only: an
 * existing column of one can be renamed, made nullable, defaulted or dropped,
 * never created or retyped to. `unknown` is not a type anybody means; the
 * other four have no single sensible DDL spelling across three dialects, and
 * inventing one is how a designer silently creates a column the introspector
 * reads back as something else.
 */
import { z } from 'zod';

import {
  fkActionSchema,
  logicalTypeSchema,
  LOGICAL_TYPES,
  type ColumnModel,
  type Dialect,
  type LogicalType,
  type TableModel,
} from '../schema-model.js';

// ---------------------------------------------------------------------------
// The authorable subset of the IR (D30)
// ---------------------------------------------------------------------------

/**
 * The fourteen logical types a column may be CREATED as or RETYPED to.
 * Derived by subtraction so a new member of `LOGICAL_TYPES` is a compile error
 * here rather than a silently un-authorable type.
 */
export const DISPLAY_ONLY_LOGICAL_TYPES = [
  'binary',
  'interval',
  'geometry',
  'inet',
  'unknown',
] as const satisfies readonly LogicalType[];
export type DisplayOnlyLogicalType = (typeof DISPLAY_ONLY_LOGICAL_TYPES)[number];

export type AuthorableLogicalType = Exclude<LogicalType, DisplayOnlyLogicalType>;

export const AUTHORABLE_LOGICAL_TYPES: readonly AuthorableLogicalType[] = LOGICAL_TYPES.filter(
  (t): t is AuthorableLogicalType =>
    !(DISPLAY_ONLY_LOGICAL_TYPES as readonly string[]).includes(t),
);

export const authorableLogicalTypeSchema = z.enum(
  AUTHORABLE_LOGICAL_TYPES as [AuthorableLogicalType, ...AuthorableLogicalType[]],
);

/** Is this type creatable/retypable-to? */
export function isAuthorableLogicalType(type: LogicalType): type is AuthorableLogicalType {
  return !(DISPLAY_ONLY_LOGICAL_TYPES as readonly string[]).includes(type);
}

/**
 * The five default kinds a client may author (D30). `expression` is absent by
 * design — see the header. `null` (the absence of a default) is expressed by
 * the field being `null`, not by a kind.
 */
export const desiredDefaultSchema = z
  .union([
    z.strictObject({ kind: z.literal('literal'), text: z.string() }),
    z.strictObject({ kind: z.enum(['now', 'uuid', 'autoincrement']) }),
  ])
  .nullable();
export type DesiredDefault = z.infer<typeof desiredDefaultSchema>;

/** `^[a-z][a-z0-9_]*$` — the same shape `install-ddl.ts:330-338` already relies on. */
export const IDENTIFIER_RE = /^[a-z][a-z0-9_]*$/;

const identifierSchema = z.string().min(1).max(128).regex(IDENTIFIER_RE, {
  message: 'must match ^[a-z][a-z0-9_]*$',
});

export const desiredColumnSchema = z.strictObject({
  name: identifierSchema,
  /**
   * All NINETEEN types on the wire, not the fourteen authorable ones.
   *
   * D30's rule is about what may be CREATED or RETYPED TO — "an existing column
   * of those types can be renamed, made nullable, defaulted or dropped". So an
   * existing `interval` column has to round-trip through the designer, and a
   * 14-type enum here made that impossible: loading a real table for editing
   * would fail at the gate on a column nobody was touching.
   *
   * The authorability rule moves to {@link validateSchemaEdit}, which can see
   * whether the column is new or its type changed. That is where it belongs —
   * it was never a fact about the field, only about the edit.
   */
  logicalType: logicalTypeSchema,
  nullable: z.boolean().default(true),
  default: desiredDefaultSchema.default(null),
  /** varchar only. */
  maxLength: z.number().int().positive().max(65_535).nullable().default(null),
  /** decimal only. */
  numericPrecision: z.number().int().min(1).max(65).nullable().default(null),
  numericScale: z.number().int().min(0).max(30).nullable().default(null),
  comment: z.string().max(1024).nullable().default(null),
});
export type DesiredColumn = z.infer<typeof desiredColumnSchema>;

const constraintSchema = z.strictObject({
  name: identifierSchema.nullable().default(null),
  columns: z.array(identifierSchema).min(1),
});

export const desiredForeignKeySchema = z.strictObject({
  name: identifierSchema.nullable().default(null),
  columns: z.array(identifierSchema).min(1),
  /** Qualified table id (`public.customers`) or bare name on mysql/sqlite. */
  toTable: z.string().min(1),
  toColumns: z.array(identifierSchema).min(1),
  onDelete: fkActionSchema.nullable().default(null),
  onUpdate: fkActionSchema.nullable().default(null),
});
export type DesiredForeignKey = z.infer<typeof desiredForeignKeySchema>;

export const desiredTableSchema = z.strictObject({
  /** Qualified id of the table this describes, when it already exists. */
  id: z.string().min(1).nullable().default(null),
  schema: z.string().min(1).nullable().default(null),
  name: identifierSchema,
  comment: z.string().max(1024).nullable().default(null),
  columns: z.array(desiredColumnSchema).min(1),
  /** `[]` is allowed; the consequence is stated, never silent (D31). */
  primaryKey: z.array(identifierSchema).default([]),
  uniques: z.array(constraintSchema).default([]),
  indexes: z
    .array(constraintSchema.extend({ unique: z.boolean().default(false) }))
    .default([]),
  foreignKeys: z.array(desiredForeignKeySchema).default([]),
  /** The ONLY authorable CHECK (D30/D32): column → its permitted values. */
  enumValues: z.record(z.string(), z.array(z.string().min(1)).min(1).max(256)).default({}),
});
export type DesiredTable = z.infer<typeof desiredTableSchema>;

/**
 * Add ONE column to a table that already exists — the narrow
 * door.
 *
 * WHY THIS EXISTS BESIDE `upsertTables`, WHICH CAN ALREADY DO IT. `upsertTables`
 * asks the caller to restate the WHOLE table, and only a caller holding the
 * designer's own buffer can do that faithfully. Everyone else has to rebuild a
 * `DesiredTable` from a snapshot, and that round trip is lossy in two ways
 * that both fail quietly:
 *
 *   - `logicalType` is a closed 14-value enum here, so a table carrying one
 *     column of a display-only type (`interval`, `bytea`, a `set`) cannot be
 *     restated at all — the request is rejected for a column nobody is
 *     touching.
 *   - a default the vocabulary cannot author (`nextval`, a function call) has
 *     no representation, so it comes back `null`, and the planner reads the
 *     absence as an intentional `drop-default` on a column nobody named.
 *
 * So this form says only what is being added. The planner builds the desired
 * table as THE SNAPSHOT'S OWN MODEL plus the new column
 * ({@link tableWithAddedColumns}), which means every untouched column keeps its
 * real native type, default and generation — and the diff can only ever see
 * the addition.
 */
export const addColumnSchema = z.strictObject({
  /** Table id in the active snapshot (`public.invoices`), or its bare name. */
  table: z.string().min(1),
  column: desiredColumnSchema,
  /**
   * The new column links to another table's key — an app update adding
   * `tickets.customer_id` beside a `customers` table it has just made. The
   * column must be nullable with no default: every existing row starts
   * unlinked, which is the one state no row can violate. Its native type is
   * the target key's (the planner resolves it), so it links on every engine.
   */
  foreignKey: z
    .strictObject({
      /** Table id (`public.customers`) or bare name of the table it points at. */
      toTable: z.string().min(1),
      toColumns: z.array(identifierSchema).min(1),
      onDelete: fkActionSchema.nullable().default(null),
    })
    .optional(),
  /**
   * No two rows may hold the same value (an invoice line's `time_entry_id`:
   * one line per entry). The planner adds the unique constraint a table made
   * with the column would carry, named as the installer names it. Every
   * existing row starts empty, which no unique rule refuses, so the column
   * takes no default.
   */
  unique: z.boolean().optional(),
  /**
   * With `unique`: the columns it is unique TOGETHER with — a number counted
   * per parent row (`proposal_id`, `v`) repeats across parents but never
   * within one. The constraint covers these columns, then this one.
   */
  uniqueWith: z.array(identifierSchema).min(1).max(4).optional(),
});
export type AddColumn = z.infer<typeof addColumnSchema>;

/**
 * Change ONE existing column in a way that cannot lose data — the narrow
 * door an app install adapts a reused table through.
 *
 * WHY NOT `upsertTables`. The same reason as {@link addColumnSchema}: restating
 * a table from a snapshot refuses any column of a display-only type and reads
 * an unauthorable default as a `drop-default` nobody asked for. So this form
 * names only what changes, and the planner builds the desired table as the
 * SNAPSHOT'S OWN MODEL with just those columns touched
 * ({@link tableWithAlteredColumns}).
 *
 * Each change is checked, not trusted: `widen` must be a widening, `identity`
 * belongs to an integer primary key, and `enumValues` may only ADD values.
 */
export const alterColumnSchema = z.strictObject({
  /** Table id in the active snapshot (`public.payments`), or its bare name. */
  table: z.string().min(1),
  column: z.string().min(1),
  widen: z
    .strictObject({
      logicalType: logicalTypeSchema,
      maxLength: z.number().int().positive().nullable().optional(),
    })
    .optional(),
  identity: z.literal(true).optional(),
  enumValues: z.array(z.string().min(1)).min(1).max(256).optional(),
  /**
   * The column must hold no value twice (with `uniqueWith`: no two rows the
   * same in those columns and this one), as a table made with it would: the
   * unique rule a column is declared with but the table lacks. The rows there
   * must not already break it — the caller checks first; the database refuses
   * otherwise, and nothing else changes.
   */
  unique: z.literal(true).optional(),
  uniqueWith: z.array(identifierSchema).min(1).max(4).optional(),
});
export type AlterColumn = z.infer<typeof alterColumnSchema>;

export const schemaEditSchema = z.strictObject({
  /** What the client was looking at; the apply re-checks it (D2). */
  baseSnapshotId: z.string().min(1),
  renames: z
    .strictObject({
      tables: z
        .array(z.strictObject({ from: z.string().min(1), to: identifierSchema }))
        .default([]),
      columns: z
        .array(
          z.strictObject({
            table: z.string().min(1),
            from: identifierSchema,
            to: identifierSchema,
          }),
        )
        .default([]),
    })
    .default({ tables: [], columns: [] }),
  upsertTables: z.array(desiredTableSchema).default([]),
  /** Additive column edits on existing tables — see {@link addColumnSchema}. */
  addColumns: z.array(addColumnSchema).max(50).default([]),
  /** Safe changes to existing columns — see {@link alterColumnSchema}. */
  alterColumns: z.array(alterColumnSchema).max(50).default([]),
  /** Table ids. */
  dropTables: z.array(z.string().min(1)).default([]),
});
export type SchemaEdit = z.infer<typeof schemaEditSchema>;

// ---------------------------------------------------------------------------
// Validation issues
// ---------------------------------------------------------------------------

/**
 * Every way an edit can be refused before a plan is even attempted. These are
 * the refusal codes that are decidable from the document plus the snapshot,
 * without a database round trip; the privilege and row-count refusals live in
 * preflight because they need one.
 */
export const EDIT_ISSUE_CODES = [
  'INVALID_IDENTIFIER',
  'IDENTIFIER_TOO_LONG',
  'RESERVED_IDENTIFIER',
  'SYSTEM_TABLE',
  'META_NAMESPACE',
  'NOT_A_TABLE',
  'UNSUPPORTED_TYPE',
  'UNSUPPORTED_DEFAULT',
  'INVALID_DEFAULT_LITERAL',
  'UNKNOWN_COLUMN',
  'UNKNOWN_TABLE',
  'DUPLICATE_COLUMN',
  'DUPLICATE_TABLE',
  'NO_PRIMARY_KEY_TARGET',
  'COMPOSITE_KEY_TARGET',
  'UNADDRESSABLE_KEY',
  'ENUM_ON_NON_ENUM_COLUMN',
  'INVALID_RENAME',
  /**
   * Auto-increment was asked for on a column that is not the table's whole
   * primary key (D23). Every engine ties generated integers to the key —
   * MySQL requires an AUTO_INCREMENT column to be indexed first, and the CRUD
   * insert path reads a new row back by its single generated key — so this is
   * refused here rather than discovered as an engine error after Apply.
   */
  'IDENTITY_NOT_A_KEY',
  /** An `alterColumns` change that could lose data: not a widening, or a value removed. */
  'NOT_WIDENING',
  /**
   * An `addColumns` link column that is not nullable with no default: every
   * existing row must start unlinked, the one state no row can violate.
   */
  'FK_COLUMN_NOT_NULLABLE',
] as const;
export type EditIssueCode = (typeof EDIT_ISSUE_CODES)[number];

export interface EditIssue {
  code: EditIssueCode;
  message: string;
  /** Table id or name the issue concerns. */
  table?: string;
  column?: string;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** What {@link validateSchemaEdit} needs to know that the document does not say. */
export interface EditValidationContext {
  dialect: Dialect;
  maxIdentifierLength: number;
  /** The active snapshot, already override-applied. */
  actual: (Pick<TableModel, 'id' | 'schema' | 'name' | 'kind' | 'system' | 'columns' | 'primaryKey'> &
    Partial<Pick<TableModel, 'checks'>>)[];
  /**
   * True when Adminium's own meta tables live in THIS database — the condition
   * that makes the `adminium_` namespace reachable through a source connection
   * (`META_NAMESPACE`). The server passes `sameDatabase(metaDsn, dataDsn)`.
   */
  metaSharesDatabase: boolean;
  /** Reserved-word predicate; injected so the check is testable in isolation. */
  isReserved: (identifier: string, dialect: Dialect) => boolean;
  /**
   * Whether a type change cannot lose data — `isWideningChange` from the type
   * map, injected because that module already imports this one. Absent, every
   * `alterColumns` widening is refused.
   */
  isWidening?: (
    from: { logicalType: LogicalType; maxLength: number | null; numericPrecision: number | null; numericScale: number | null },
    to: { logicalType: LogicalType; maxLength: number | null },
  ) => boolean;
}

const META_PREFIX = 'adminium_';

/**
 * MySQL indexes at most 3072 bytes of one key, and counts four bytes for each
 * character of a `varchar` (utf8mb4), so a unique rule over more than 768
 * characters of text is refused by the database halfway through a change.
 */
export const MYSQL_KEY_BYTES = 3072;

/** Why these columns cannot be kept unique together on this engine, or null. */
function uniqueKeyIssue(columns: readonly Pick<ColumnModel, 'logicalType' | 'maxLength'>[], dialect: Dialect): string | null {
  if (dialect !== 'mysql') return null;
  if (columns.some((c) => c.logicalType === 'text')) return 'MySQL cannot keep a text column of unlimited length unique: give it a maximum length';
  // Four bytes a character of text; eight is the widest anything else here takes.
  const bytes = columns.reduce((sum, c) => sum + (c.logicalType === 'varchar' ? (c.maxLength ?? 0) * 4 : 8), 0);
  if (bytes <= MYSQL_KEY_BYTES) return null;
  return `MySQL keeps a unique value of at most ${String(MYSQL_KEY_BYTES)} bytes, which is ${String(MYSQL_KEY_BYTES / 4)} characters of text: this one takes up to ${String(bytes)}`;
}

/**
 * Types a value list can constrain. `enum` is the authoring word; `varchar` and
 * `text` are what the database calls the same column once it exists (D32).
 */
const CAN_HOLD_VALUE_LIST: ReadonlySet<LogicalType> = new Set(['enum', 'varchar', 'text']);

/** Literal defaults are validated against the column's logical type (D30). */
function literalMatchesType(text: string, type: LogicalType): boolean {
  switch (type) {
    case 'integer':
    case 'bigint':
      return /^-?\d+$/.test(text);
    case 'decimal':
    case 'float':
      return /^-?\d+(\.\d+)?$/.test(text);
    case 'boolean':
      // MySQL keeps a boolean as `tinyint(1)` and reads its default back as `1` or `0`.
      return text === 'true' || text === 'false' || text === '1' || text === '0';
    case 'date':
      return /^\d{4}-\d{2}-\d{2}$/.test(text);
    case 'time':
      return /^\d{2}:\d{2}(:\d{2})?$/.test(text);
    case 'timestamp':
    case 'timestamptz':
      return /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?/.test(text);
    case 'uuid':
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text);
    case 'json':
      try {
        JSON.parse(text);
        return true;
      } catch {
        return false;
      }
    case 'text':
    case 'varchar':
    case 'enum':
      return true;
    default:
      // A display-only type (D30) reaching here means an existing column is
      // being re-defaulted, not created. Its literal is the database's own.
      return true;
  }
}

/** The four kinds a client may author, in the order a control should offer them. */
export const DEFAULT_KINDS = ['literal', 'now', 'uuid', 'autoincrement'] as const;
export type DefaultKind = (typeof DEFAULT_KINDS)[number];

/**
 * Which default kinds make sense for a type. `autoincrement` is a key
 * generator, not a value — it belongs only on an integer key (D31).
 *
 * ─── Why the DIALECT matters for `now` ─────────────────────────────────────
 *
 * SQLite has no date type at all: a `timestamp` column is TEXT affinity, and
 * the introspector reports what the engine reports — `text`. So a table
 * created here with a current-time default came BACK as a text column carrying
 * a `now` default, and restating it (opening it in the designer and changing
 * anything else) was refused as "a now default does not apply to a text
 * column" — about a column the operator had just made, through this product,
 * two tests earlier. Found by the sqlite e2e leg.
 *
 * `datetime('now')` is exactly what SQLite puts in such a column, so on that
 * engine text and varchar are date-capable and the rule says so.
 */
export function defaultKindAllowed(
  kind: NonNullable<DesiredDefault>['kind'],
  type: LogicalType,
  dialect?: Dialect,
): boolean {
  switch (kind) {
    case 'autoincrement':
      return type === 'integer' || type === 'bigint';
    case 'uuid':
      return type === 'uuid' || type === 'text' || type === 'varchar';
    case 'now':
      if (dialect === 'sqlite' && (type === 'text' || type === 'varchar')) return true;
      return type === 'date' || type === 'time' || type === 'timestamp' || type === 'timestamptz';
    case 'literal':
      return true;
  }
}

/**
 * The kinds a control may OFFER for one column, which is narrower than what the
 * type admits: the dialect and the column's role in the table rule two of them
 * out entirely.
 *
 * Exported so the Schema Designer's Default control and this file's validator
 * cannot drift. A UI that offers what the gate refuses is a 422 the person
 * cannot act on, and that is exactly what "choose enum" did before the
 * allowed-values editor existed —
 * offered, staged, refused at Review, with nowhere to type the values.
 */
export function offerableDefaultKinds(opts: {
  logicalType: LogicalType;
  dialect: Dialect;
  /** True when this column IS the table's whole primary key. */
  isSoleKey: boolean;
}): DefaultKind[] {
  return DEFAULT_KINDS.filter((kind) => {
    if (!defaultKindAllowed(kind, opts.logicalType, opts.dialect)) return false;
    // D31: only postgres can generate one, and only postgres can hand it back.
    if (kind === 'uuid' && opts.dialect !== 'postgres') return false;
    // D23: every engine ties generated integers to the key.
    if (kind === 'autoincrement' && !opts.isSoleKey) return false;
    return true;
  });
}

/**
 * Validate an edit against the snapshot and the dialect. Returns every issue
 * found rather than throwing on the first: a designer that reports one problem
 * per round trip is a designer nobody finishes a table in.
 */
export function validateSchemaEdit(edit: SchemaEdit, ctx: EditValidationContext): EditIssue[] {
  const issues: EditIssue[] = [];
  const byId = new Map(ctx.actual.map((t) => [t.id, t]));
  const byName = new Map(ctx.actual.map((t) => [t.name, t]));
  const push = (i: EditIssue) => issues.push(i);

  const checkIdentifier = (value: string, where: { table?: string; column?: string }): void => {
    if (!IDENTIFIER_RE.test(value)) {
      push({ code: 'INVALID_IDENTIFIER', message: `${JSON.stringify(value)} must match ^[a-z][a-z0-9_]*$`, ...where });
      return;
    }
    if (value.length > ctx.maxIdentifierLength) {
      push({
        code: 'IDENTIFIER_TOO_LONG',
        message: `${JSON.stringify(value)} exceeds ${ctx.dialect}'s ${ctx.maxIdentifierLength}-character limit`,
        ...where,
      });
    }
    if (ctx.isReserved(value, ctx.dialect)) {
      push({
        code: 'RESERVED_IDENTIFIER',
        message: `${JSON.stringify(value)} is a reserved word in ${ctx.dialect}`,
        ...where,
      });
    }
    if (value.startsWith(META_PREFIX) && ctx.metaSharesDatabase) {
      push({
        code: 'META_NAMESPACE',
        message:
          `${JSON.stringify(value)} is in Adminium's own "${META_PREFIX}" namespace, and Adminium's ` +
          'tables live in this database',
        ...where,
      });
    }
  };

  /** A table Adminium may not touch at all, whatever the operation. */
  const refuseProtected = (id: string): boolean => {
    const table = byId.get(id) ?? byName.get(id);
    if (table === undefined) {
      push({ code: 'UNKNOWN_TABLE', message: `${JSON.stringify(id)} is not in the active snapshot`, table: id });
      return true;
    }
    if (table.system) {
      push({
        code: 'SYSTEM_TABLE',
        message: `${JSON.stringify(table.id)} is a system or migration table and is not editable`,
        table: id,
      });
      return true;
    }
    if (table.kind !== 'table') {
      push({
        code: 'NOT_A_TABLE',
        message: `${JSON.stringify(table.id)} is a ${table.kind}; Adminium cannot author one`,
        table: id,
      });
      return true;
    }
    if (table.name.startsWith(META_PREFIX) && ctx.metaSharesDatabase) {
      push({
        code: 'META_NAMESPACE',
        message: `${JSON.stringify(table.id)} belongs to Adminium's own meta store`,
        table: id,
      });
      return true;
    }
    return false;
  };

  // --- renames -------------------------------------------------------------
  for (const r of edit.renames.tables) {
    if (refuseProtected(r.from)) continue;
    checkIdentifier(r.to, { table: r.from });
    if (byName.has(r.to) || byId.has(r.to)) {
      push({ code: 'DUPLICATE_TABLE', message: `a table named ${JSON.stringify(r.to)} already exists`, table: r.from });
    }
  }
  for (const r of edit.renames.columns) {
    if (refuseProtected(r.table)) continue;
    const table = byId.get(r.table) ?? byName.get(r.table);
    checkIdentifier(r.to, { table: r.table, column: r.from });
    if (table !== undefined) {
      if (!table.columns.some((c) => c.name === r.from)) {
        push({
          code: 'UNKNOWN_COLUMN',
          message: `${JSON.stringify(r.from)} is not a column of ${JSON.stringify(table.id)}`,
          table: r.table,
          column: r.from,
        });
      }
      if (table.columns.some((c) => c.name === r.to)) {
        push({
          code: 'DUPLICATE_COLUMN',
          message: `${JSON.stringify(table.id)} already has a column named ${JSON.stringify(r.to)}`,
          table: r.table,
          column: r.to,
        });
      }
      if (r.from === r.to) {
        push({ code: 'INVALID_RENAME', message: 'a rename must change the name', table: r.table, column: r.from });
      }
    }
  }

  // --- drops ---------------------------------------------------------------
  for (const id of edit.dropTables) refuseProtected(id);

  // --- upserts -------------------------------------------------------------
  const seenNames = new Set<string>();
  for (const table of edit.upsertTables) {
    // An upsert of an EXISTING table must clear the same gate as a drop.
    if (table.id !== null && refuseProtected(table.id)) continue;
    checkIdentifier(table.name, { table: table.id ?? table.name });
    if (seenNames.has(table.name)) {
      push({ code: 'DUPLICATE_TABLE', message: `${JSON.stringify(table.name)} appears twice in this edit`, table: table.name });
    }
    seenNames.add(table.name);

    const columnNames = new Set<string>();
    for (const column of table.columns) {
      const where = { table: table.id ?? table.name, column: column.name };
      checkIdentifier(column.name, where);
      if (columnNames.has(column.name)) {
        push({ code: 'DUPLICATE_COLUMN', message: `${JSON.stringify(column.name)} appears twice`, ...where });
      }
      columnNames.add(column.name);

      /*
       * D30 refuses a display-only type as a CREATE or RETYPE target — not as
       * a fact about the column. An existing `interval` column loaded into the
       * designer, untouched, must pass: refusing it would make a real table
       * un-editable because of a column nobody was changing.
       */
      const existingTable = table.id === null ? undefined : byId.get(table.id);
      const existingColumn = existingTable?.columns.find((c) => c.name === column.name);
      const isNewColumn = existingColumn === undefined;
      const typeChanged =
        existingColumn !== undefined && existingColumn.logicalType !== column.logicalType;
      if ((isNewColumn || typeChanged) && !isAuthorableLogicalType(column.logicalType)) {
        push({
          code: 'UNSUPPORTED_TYPE',
          message: `${column.logicalType} columns cannot be created or retyped to`,
          ...where,
        });
      }
      const def = column.default;
      if (def !== null) {
        if (def.kind === 'uuid' && ctx.dialect !== 'postgres') {
          // The compiler throws for this one (`gen_random_uuid()` is postgres's
          // alone), and a throw there is a 500 the operator cannot read.
          push({
            code: 'UNSUPPORTED_DEFAULT',
            message: `a database-generated uuid default is Postgres-only; ${ctx.dialect} has no equivalent`,
            ...where,
          });
        }
        if (!defaultKindAllowed(def.kind, column.logicalType, ctx.dialect)) {
          push({
            code: 'UNSUPPORTED_DEFAULT',
            message: `a ${def.kind} default does not apply to a ${column.logicalType} column`,
            ...where,
          });
        } else if (def.kind === 'literal' && !literalMatchesType(def.text, column.logicalType)) {
          push({
            code: 'INVALID_DEFAULT_LITERAL',
            message: `${JSON.stringify(def.text)} is not a valid ${column.logicalType} literal`,
            ...where,
          });
        }
      }
    }

    /*
     * Auto-increment belongs to the KEY. `defaultKindAllowed` has already
     * limited it to an integer column; this is the other half, and it needs the
     * table, not the column.
     */
    for (const column of table.columns) {
      if (column.default?.kind !== 'autoincrement') continue;
      if (table.primaryKey.length !== 1 || table.primaryKey[0] !== column.name) {
        push({
          code: 'IDENTITY_NOT_A_KEY',
          message:
            `${JSON.stringify(column.name)} cannot be generated automatically: every engine ties ` +
            "generated integers to the table's primary key, and this table's key is " +
            (table.primaryKey.length === 0
              ? 'not set'
              : `(${table.primaryKey.join(', ')})`),
          table: table.id ?? table.name,
          column: column.name,
        });
      }
    }

    // enumValues may only name enum columns of THIS table (D32).
    for (const columnName of Object.keys(table.enumValues)) {
      const column = table.columns.find((c) => c.name === columnName);
      if (column === undefined) {
        push({
          code: 'UNKNOWN_COLUMN',
          message: `enumValues names ${JSON.stringify(columnName)}, which is not a column here`,
          table: table.id ?? table.name,
          column: columnName,
        });
      } else if (!CAN_HOLD_VALUE_LIST.has(column.logicalType)) {
        /*
         * `enum` is a string plus a CHECK on all three engines (D32), so a
         * column AUTHORED as `enum` reads back from the database as
         * `varchar(64)` with a parsed CHECK — never as logicalType `enum`.
         * Insisting on `enum` here meant the round trip could not close: open a
         * table whose choice column you created yesterday, change anything, and
         * the gate refused the value list it had just been sent.
         */
        push({
          code: 'ENUM_ON_NON_ENUM_COLUMN',
          message: `${JSON.stringify(columnName)} is ${column.logicalType}, so it carries no value list`,
          table: table.id ?? table.name,
          column: columnName,
        });
      }
    }
    for (const column of table.columns) {
      if (column.logicalType === 'enum' && (table.enumValues[column.name] ?? []).length === 0) {
        push({
          code: 'ENUM_ON_NON_ENUM_COLUMN',
          message: `${JSON.stringify(column.name)} is an enum column with no values`,
          table: table.id ?? table.name,
          column: column.name,
        });
      }
    }

    const namesColumn = (n: string) => columnNames.has(n);
    for (const pk of table.primaryKey) {
      if (!namesColumn(pk)) {
        push({ code: 'UNKNOWN_COLUMN', message: `primary key names unknown column ${JSON.stringify(pk)}`, table: table.id ?? table.name, column: pk });
      }
    }
    for (const u of [...table.uniques, ...table.indexes]) {
      for (const c of u.columns) {
        if (!namesColumn(c)) {
          push({ code: 'UNKNOWN_COLUMN', message: `constraint names unknown column ${JSON.stringify(c)}`, table: table.id ?? table.name, column: c });
        }
      }
    }

    // --- foreign keys: coherence, in install-ddl.ts:180-196's words --------
    for (const fk of table.foreignKeys) {
      const where = { table: table.id ?? table.name };
      for (const c of fk.columns) {
        if (!namesColumn(c)) {
          push({ code: 'UNKNOWN_COLUMN', message: `foreign key names unknown column ${JSON.stringify(c)}`, ...where, column: c });
        }
      }
      if (fk.columns.length !== fk.toColumns.length) {
        push({
          code: 'NO_PRIMARY_KEY_TARGET',
          message: 'a foreign key must name the same number of columns on both sides',
          ...where,
        });
        continue;
      }
      // The target may be a table this same edit creates.
      const target =
        byId.get(fk.toTable) ??
        byName.get(fk.toTable) ??
        edit.upsertTables.find((t) => t.name === fk.toTable || t.id === fk.toTable);
      if (target === undefined) {
        push({
          code: 'UNKNOWN_TABLE',
          message: `foreign key target ${JSON.stringify(fk.toTable)} exists neither in this edit nor in the database`,
          ...where,
        });
        continue;
      }
      const targetPk = target.primaryKey;
      if (targetPk.length === 0) {
        push({
          code: 'NO_PRIMARY_KEY_TARGET',
          message: `${JSON.stringify(fk.toTable)} has no primary key, so a foreign key cannot point at it`,
          ...where,
        });
      } else if (targetPk.length > 1 && !targetPk.every((c) => fk.toColumns.includes(c))) {
        // A foreign key must reference a set of columns covered by a unique
        // constraint; naming SOME of a composite primary key is not that, even
        // though each named column exists. `install-ddl.ts:186-192` refuses the
        // same shape in the same words, and for the same reason: the alternative
        // is a constraint the database rejects with a message about indexes that
        // tells the operator nothing about what they clicked.
        push({
          code: 'COMPOSITE_KEY_TARGET',
          message:
            `${JSON.stringify(fk.toTable)} has a composite primary key (${targetPk.join(', ')}), ` +
            'so a foreign key must reference all of its columns',
          ...where,
        });
      }
    }

    // --- D31: a new table's key must be readable back after insert ---------
    if (table.id === null && table.primaryKey.length === 1) {
      const key = table.columns.find((c) => c.name === table.primaryKey[0]);
      if (key !== undefined && key.default?.kind === 'uuid' && ctx.dialect !== 'postgres') {
        push({
          code: 'UNADDRESSABLE_KEY',
          message:
            `a database-generated uuid key cannot be read back after insert on ${ctx.dialect}; ` +
            'use an integer identity key, or set the id from the application',
          table: table.name,
          column: key.name,
        });
      }
    }
  }

  // --- alterColumns --------------------------------------------------------
  const restated = new Set(edit.upsertTables.flatMap((t) => (t.id === null ? [t.name] : [t.id, t.name])));
  for (const entry of edit.alterColumns ?? []) {
    if (refuseProtected(entry.table)) continue;
    const table = byId.get(entry.table) ?? byName.get(entry.table);
    if (table === undefined) continue; // `refuseProtected` already reported it
    const where = { table: entry.table, column: entry.column };
    if (restated.has(table.id) || restated.has(table.name)) {
      push({
        code: 'DUPLICATE_TABLE',
        message: `${JSON.stringify(table.id)} is both restated in upsertTables and altered by alterColumns`,
        table: entry.table,
      });
      continue;
    }
    const column = table.columns.find((c) => c.name === entry.column);
    if (column === undefined) {
      push({ code: 'UNKNOWN_COLUMN', message: `${JSON.stringify(table.id)} has no column ${JSON.stringify(entry.column)}`, ...where });
      continue;
    }
    if (entry.widen !== undefined) {
      const from = {
        logicalType: column.logicalType,
        maxLength: column.maxLength,
        numericPrecision: column.numericPrecision,
        numericScale: column.numericScale,
      };
      const to = { logicalType: entry.widen.logicalType, maxLength: entry.widen.maxLength ?? null };
      const widening = ctx.isWidening?.(from, to) ?? false;
      if (!isAuthorableLogicalType(entry.widen.logicalType) || !widening) {
        push({ code: 'NOT_WIDENING', message: `${column.logicalType} → ${entry.widen.logicalType} could lose data`, ...where });
      }
    }
    if (entry.identity === true) {
      const soleKey = table.primaryKey.length === 1 && table.primaryKey[0] === column.name;
      if (!soleKey || (column.logicalType !== 'integer' && column.logicalType !== 'bigint')) {
        push({
          code: 'IDENTITY_NOT_A_KEY',
          message: 'only a table\'s single integer primary key can number itself',
          ...where,
        });
      }
    }
    if (entry.uniqueWith !== undefined && entry.unique !== true) {
      push({ code: 'UNKNOWN_COLUMN', message: 'uniqueWith names the columns a unique rule covers, and no unique rule is asked for', ...where });
    }
    if (entry.unique === true) {
      const together = [...(entry.uniqueWith ?? []).map((name) => table.columns.find((c) => c.name === name)), column];
      const missing = (entry.uniqueWith ?? []).filter((name) => !table.columns.some((c) => c.name === name));
      if (missing.length > 0) {
        push({ code: 'UNKNOWN_COLUMN', message: `${JSON.stringify(table.id)} has no column ${JSON.stringify(missing.join(', '))} to be unique with`, ...where });
      }
      const tooLong = uniqueKeyIssue(together.filter((c) => c !== undefined), ctx.dialect);
      if (tooLong !== null) push({ code: 'UNSUPPORTED_TYPE', message: tooLong, ...where });
    }
    if (entry.enumValues !== undefined) {
      const names = table.columns.map((c) => c.name);
      const holder = (table.checks ?? []).find((check) => enumCheckColumn(check.expression, names) === column.name);
      if (holder === undefined || parseEnumCheck(holder.expression, names) === null) {
        push({
          code: 'ENUM_ON_NON_ENUM_COLUMN',
          message: `${JSON.stringify(column.name)} has no value list to add to`,
          ...where,
        });
      }
    }
  }

  // --- addColumns ----------------------------------------------------------
  //
  // The same gates the upsert path applies to a NEW column, and two more that
  // only this form can hit: the table must already exist (there is nothing to
  // add to otherwise), and it must not also be restated by `upsertTables` in
  // the same edit — two descriptions of one table is a plan whose outcome
  // depends on which one the planner reached first.
  const upsertedIds = new Set(edit.upsertTables.flatMap((t) => (t.id === null ? [t.name] : [t.id, t.name])));
  const addedKeys = new Set<string>();
  // `?? []` because this function's contract is to REPORT issues, never to
  // throw: a caller that hands it an edit predating this field means "no
  // columns added", which is exactly `[]`. The server always passes a parsed
  // edit, where Zod has already applied the default.
  for (const entry of edit.addColumns ?? []) {
    if (refuseProtected(entry.table)) continue;
    const table = byId.get(entry.table) ?? byName.get(entry.table);
    if (table === undefined) continue; // `refuseProtected` already reported it
    const where = { table: entry.table, column: entry.column.name };

    if (upsertedIds.has(table.id) || upsertedIds.has(table.name)) {
      push({
        code: 'DUPLICATE_TABLE',
        message: `${JSON.stringify(table.id)} is both restated in upsertTables and extended by addColumns`,
        table: entry.table,
      });
      continue;
    }

    checkIdentifier(entry.column.name, where);

    const key = `${table.id}\u0000${entry.column.name}`;
    if (addedKeys.has(key)) {
      push({ code: 'DUPLICATE_COLUMN', message: `${JSON.stringify(entry.column.name)} is added twice`, ...where });
    }
    addedKeys.add(key);

    if (table.columns.some((c) => c.name === entry.column.name)) {
      push({
        code: 'DUPLICATE_COLUMN',
        message: `${JSON.stringify(table.id)} already has a column named ${JSON.stringify(entry.column.name)}`,
        ...where,
      });
    }

    if (!isAuthorableLogicalType(entry.column.logicalType)) {
      push({ code: 'UNSUPPORTED_TYPE', message: `${entry.column.logicalType} columns cannot be created`, ...where });
    }
    /*
     * An enum column carries a CHECK, and a CHECK is a fact about the TABLE —
     * `enumValues` lives on `DesiredTable` for that reason. Adding one through
     * this door would mean either inventing a table-level edit from a
     * column-level document or emitting a value-less enum, so it is refused by
     * name and pointed at the door that can express it.
     */
    if (entry.column.default?.kind === 'autoincrement') {
      push({
        code: 'IDENTITY_NOT_A_KEY',
        message:
          'a column added to an existing table cannot be generated automatically: that belongs to the ' +
          "table's primary key, which this door cannot change",
        ...where,
      });
    }

    if (entry.column.logicalType === 'enum') {
      push({
        code: 'ENUM_ON_NON_ENUM_COLUMN',
        message: 'an enum column carries a value list, which belongs to the table — add it in the table designer',
        ...where,
      });
    }

    if (entry.foreignKey !== undefined) {
      const fk = entry.foreignKey;
      /*
       * Nullable and no default, or refused: an existing row gets NULL, which
       * links nowhere and so cannot break the constraint. A default would be a
       * key every existing row points at — one nobody chose.
       */
      if (!entry.column.nullable || entry.column.default !== null) {
        push({
          code: 'FK_COLUMN_NOT_NULLABLE',
          message: 'a column that links to another table must be nullable with no default when it is added to a table that exists',
          ...where,
        });
      }
      const target = byId.get(fk.toTable) ?? byName.get(fk.toTable);
      if (target === undefined) {
        push({ code: 'UNKNOWN_TABLE', message: `${JSON.stringify(fk.toTable)} is not a table here`, ...where });
      } else if (fk.toColumns.length !== 1 || !target.columns.some((c) => c.name === fk.toColumns[0])) {
        push({
          code: 'UNKNOWN_COLUMN',
          message: `${JSON.stringify(fk.toTable)} has no column ${JSON.stringify(fk.toColumns.join(', '))} to link to`,
          ...where,
        });
      }
    }

    if (entry.unique === true) {
      /*
       * A default would be one value in every row already there: the unique
       * rule refuses it the moment a second row exists, halfway through the
       * change. Empty, they are all allowed.
       */
      if (entry.column.default !== null) {
        push({
          code: 'UNSUPPORTED_DEFAULT',
          message: 'a column whose values must all differ cannot start every existing row on the same default: add it with no default',
          ...where,
        });
      }
      const withColumns = (entry.uniqueWith ?? []).map(
        (name) =>
          table.columns.find((c) => c.name === name) ??
          (edit.addColumns ?? []).find((other) => (other.table === entry.table) && other.column.name === name)?.column,
      );
      const missing = (entry.uniqueWith ?? []).filter((_, index) => withColumns[index] === undefined);
      if (missing.length > 0) {
        push({ code: 'UNKNOWN_COLUMN', message: `${JSON.stringify(table.id)} has no column ${JSON.stringify(missing.join(', '))} to be unique with`, ...where });
      }
      const tooLong = uniqueKeyIssue([...withColumns.filter((c) => c !== undefined), entry.column], ctx.dialect);
      if (tooLong !== null) push({ code: 'UNSUPPORTED_TYPE', message: tooLong, ...where });
    } else if (entry.uniqueWith !== undefined) {
      push({ code: 'UNKNOWN_COLUMN', message: 'uniqueWith names the columns a unique rule covers, and no unique rule is asked for', ...where });
    }

    const def = entry.column.default;
    if (def !== null) {
      if (!defaultKindAllowed(def.kind, entry.column.logicalType, ctx.dialect)) {
        push({
          code: 'UNSUPPORTED_DEFAULT',
          message: `a ${def.kind} default does not apply to a ${entry.column.logicalType} column`,
          ...where,
        });
      } else if (def.kind === 'literal' && !literalMatchesType(def.text, entry.column.logicalType)) {
        push({
          code: 'INVALID_DEFAULT_LITERAL',
          message: `${JSON.stringify(def.text)} is not a valid ${entry.column.logicalType} literal`,
          ...where,
        });
      }
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// DesiredTable → TableModel
// ---------------------------------------------------------------------------

/**
 * Convert an authored table into the IR the rest of the pipeline speaks.
 *
 * `dbType` is filled by the caller's forward map (the planner owns it — D30
 * says it is the only place a native type string is produced), so this
 * function takes it as an injected function rather than importing it: the
 * conversion is pure and dialect-agnostic, and stays unit-testable without a
 * type map.
 */
/**
 * The desired model for an `addColumns` edit: the snapshot's OWN table, with
 * the new columns appended.
 *
 * THE POINT IS WHAT IS *NOT* REBUILT. Every existing column is passed through
 * byte-for-byte — its native `dbType`, its unauthorable default, its generation
 * flag, its FK mirror — so `diffModels` compares each one against itself and
 * finds nothing. Reconstructing them from a `DesiredTable` is what makes the
 * planner hallucinate a `retype` or a `drop-default` on a column the operator
 * never named (see {@link addColumnSchema}).
 *
 * Appended, never inserted: position is not authorable here, and on MySQL a
 * column added last is the case that can be instant (8.0.12+) rather than a
 * table rebuild.
 */
export function tableWithAddedColumns(
  actual: TableModel,
  columns: readonly DesiredColumn[],
  opts: {
    dbTypeFor: (column: DesiredColumn) => string;
    /**
     * The added columns whose values must all differ. Each is kept unique
     * under the installer's own name, `uq_<table>_<column>`: as the unique
     * constraint a table made with it carries (an `add-unique`), or — where
     * `uniqueAs` is `index` — as a unique index (an `add-index`).
     */
    unique?: ReadonlySet<string>;
    /**
     * SQLite cannot add a constraint to a table that exists without copying
     * the whole table, but it can add a unique index in place. The column is
     * new, so every row holds NULL, which a unique index never refuses; and
     * SQLite reads a one-column unique index back as the column's
     * uniqueness, as it reads the constraint.
     */
    uniqueAs?: 'constraint' | 'index';
    /** An added unique column's partners, by its name: the rule covers them, then it. */
    uniqueWith?: ReadonlyMap<string, readonly string[]>;
  },
): TableModel {
  const added: ColumnModel[] = columns.map((column, index) => ({
    name: column.name,
    ordinal: actual.columns.length + index + 1,
    dbType: opts.dbTypeFor(column),
    logicalType: column.logicalType,
    // A new column is never part of the existing primary key, so `nullable`
    // needs none of `desiredTableToModel`'s pk correction.
    nullable: column.nullable,
    default: column.default,
    isPrimaryKey: false,
    isUnique: false,
    isGenerated: false,
    enumRef: null,
    maxLength: column.maxLength,
    numericPrecision: column.numericPrecision,
    numericScale: column.numericScale,
    isArray: false,
    comment: column.comment,
    references: null,
    semantics: null,
  }));
  const uniques = columns
    .filter((column) => opts.unique?.has(column.name) === true)
    .map((column) => ({ name: `uq_${actual.name}_${column.name}`, columns: [...(opts.uniqueWith?.get(column.name) ?? []), column.name] }));
  return withUniques({ ...actual, columns: [...actual.columns, ...added] }, uniques, opts.uniqueAs);
}

/** A table with more unique rules: constraints, or where `as` is `index`, unique indexes made in place. */
function withUniques(table: TableModel, uniques: readonly { name: string; columns: string[] }[], as: 'constraint' | 'index' | undefined): TableModel {
  if (uniques.length === 0) return table;
  if (as === 'index') {
    const indexes = uniques.map((u) => ({ ...u, expression: null, unique: true, primary: false, method: null, partial: false }));
    return { ...table, indexes: [...table.indexes, ...indexes] };
  }
  return { ...table, uniques: [...table.uniques, ...uniques] };
}

/**
 * The desired model for an `alterColumns` edit: the snapshot's OWN table, with
 * only the named columns changed. Every other column keeps its native type,
 * default and generation, so the diff can only see the changes asked for.
 *
 * An enum's value list lives in the table's CHECK, so `enumValues` rewrites
 * that CHECK in the one canonical shape the vocabulary admits, keeping its
 * name so the drop and the add refer to the same constraint.
 */
export function tableWithAlteredColumns(
  actual: TableModel,
  alters: readonly AlterColumn[],
  opts: {
    dbTypeFor: (column: DesiredColumn) => string;
    /** How a unique rule asked for is kept: as {@link tableWithAddedColumns} keeps an added column's. */
    uniqueAs?: 'constraint' | 'index';
  },
): TableModel {
  const byColumn = new Map(alters.map((a) => [a.column, a]));
  const columns: ColumnModel[] = actual.columns.map((column) => {
    const alter = byColumn.get(column.name);
    if (alter === undefined) return column;
    let next: ColumnModel = column;
    if (alter.widen !== undefined) {
      const maxLength = alter.widen.maxLength ?? null;
      next = {
        ...next,
        logicalType: alter.widen.logicalType,
        maxLength,
        dbType: opts.dbTypeFor({
          name: column.name,
          logicalType: alter.widen.logicalType as DesiredColumn['logicalType'],
          nullable: column.nullable,
          default: null,
          maxLength,
          numericPrecision: column.numericPrecision,
          numericScale: column.numericScale,
          comment: null,
        } as DesiredColumn),
      };
    }
    if (alter.identity === true) next = { ...next, default: { kind: 'autoincrement' } };
    return next;
  });
  const names = actual.columns.map((c) => c.name);
  const checks = actual.checks.map((check) => {
    const column = enumCheckColumn(check.expression, names);
    const alter = column === null ? undefined : byColumn.get(column);
    if (alter?.enumValues === undefined || column === null) return check;
    const current = parseEnumCheck(check.expression, names)?.values ?? [];
    const values = [...current, ...alter.enumValues.filter((v) => !current.includes(v))];
    return { ...check, expression: `${column} in (${values.map((v) => JSON.stringify(v)).join(', ')})` };
  });
  // The installer's own name for the rule, so the table reads as one made with it.
  const uniques = alters
    .filter((alter) => alter.unique === true)
    .map((alter) => ({ name: `uq_${actual.name}_${alter.column}`, columns: [...(alter.uniqueWith ?? []), alter.column] }));
  return withUniques({ ...actual, columns, checks }, uniques, opts.uniqueAs);
}

/**
 * Which column a CHECK constraint is about, or `null`.
 *
 * A step has to name its column for two different reasons: the compiler looks
 * the allowed values up by column when it emits an `add-check`, and the review
 * screen shows the operator which field a constraint belongs to. Neither worked,
 * because the planner passed no column at all.
 *
 * The expression comes from one of two places and they do not look alike. One is
 * {@link desiredTableToModel}'s own canonical `status in ("a", "b")` — the only
 * shape D30 admits — which the first pattern reads exactly. The other is the
 * database's own text, and every engine renders it differently:
 *
 *   postgres  ((status)::text = ANY ((ARRAY['a'::character varying, …])::text[]))
 *   mysql     (`status` in (_utf8mb4'a',_utf8mb4'b'))
 *   sqlite    status in ('a','b')
 *
 * So the fallback looks for one of the table's OWN column names in the text,
 * preferring the longest match: `status` appears inside `status_id`, and
 * answering the shorter name would attach the constraint to the wrong field.
 * `null` when nothing matches — a caller that needs a column refuses rather
 * than guessing one.
 */
/**
 * Every quoted literal in an expression, read in ONE left-to-right pass.
 *
 * ─── Why this is not a regular expression ──────────────────────────────────
 *
 * The obvious `/"((?:[^"\\]|\\.)*)"/g` backtracks polynomially, and so does
 * its unrolled cousin — not because either is ambiguous, but because
 * `matchAll` RESTARTS at every position, and on an expression with no closing
 * quote each restart rescans to the end. That is quadratic over input this
 * module does not control: a CHECK expression comes back from whatever the
 * database has stored, and `parseEnumCheck` runs on every table a diff opens.
 *
 * A scanner has no restart. `at` only ever moves forward, so the whole
 * function is linear in the length of the expression however the quotes fall.
 *
 * `quote` decides the escaping, because the two spellings escape differently:
 * SQL doubles the quote (`'it''s'`) and JSON backslashes it (`"it\"s"`). An
 * unterminated literal is not one, and is dropped rather than guessed at.
 */
function quotedLiterals(expression: string, quote: "'" | '"'): string[] {
  const out: string[] = [];
  let at = 0;
  while (at < expression.length) {
    if (expression[at] !== quote) {
      at += 1;
      continue;
    }
    at += 1;
    let body = '';
    let closed = false;
    while (at < expression.length) {
      const char = expression[at] as string;
      if (quote === '"' && char === '\\') {
        body += char + (expression[at + 1] ?? '');
        at += 2;
        continue;
      }
      if (char === quote) {
        // `''` inside a single-quoted literal is one quote, not the end of it.
        if (quote === "'" && expression[at + 1] === "'") {
          body += "''";
          at += 2;
          continue;
        }
        closed = true;
        at += 1;
        break;
      }
      body += char;
      at += 1;
    }
    if (closed) out.push(body);
  }
  return out;
}

/**
 * A CHECK read as enum membership: which column, and which values — or `null`
 * when the expression is some other rule.
 *
 * Two callers need this and they need it to agree. {@link diffTableDefinitions}
 * compares an engine's own CHECK text against the canonical one this file
 * writes, and they never match as strings: sqlite hands back
 * `status IN ('draft','sent')`, postgres
 * `((status)::text = ANY ((ARRAY['draft'::character varying])::text[]))`, and
 * the desired document says `status in ("draft", "sent")`. Comparing the text
 * planned a DROP and an ADD of the same constraint every time a table with a
 * choice column was merely opened.
 */
export function parseEnumCheck(
  expression: string,
  columns: readonly string[],
): { column: string; values: string[] } | null {
  if (!/\bin\s*\(|=\s*any/i.test(expression)) return null;
  const column = enumCheckColumn(expression, columns);
  if (column === null) return null;
  const values: string[] = [];
  // Both quotings: the engines' own single quotes (with '' escaping) and the
  // double quotes `desiredTableToModel` writes through JSON.stringify.
  for (const body of quotedLiterals(expression, "'")) values.push(body.replaceAll("''", "'"));
  if (values.length === 0) {
    for (const body of quotedLiterals(expression, '"')) {
      try {
        values.push(JSON.parse(`"${body}"`) as string);
      } catch {
        values.push(body);
      }
    }
  }
  /*
   * Postgres spells the cast inside the list (`'draft'::character varying`),
   * so the type names arrive as literals only when they are quoted — they are
   * not. What DOES arrive is the column's own type cast when it is quoted
   * nowhere, which is why nothing is filtered here: every literal in a
   * membership test is a member.
   */
  return values.length === 0 ? null : { column, values };
}

export function enumCheckColumn(
  expression: string,
  columns: readonly string[],
): string | null {
  const authored = /^\s*"?([a-z][a-z0-9_]*)"?\s+in\s*\(/i.exec(expression);
  if (authored !== null) {
    const name = authored[1]!;
    if (columns.includes(name)) return name;
  }
  const candidates = columns
    .filter((name) => new RegExp(`(^|[^a-z0-9_])${name}([^a-z0-9_]|$)`, 'i').test(expression))
    .sort((a, b) => b.length - a.length);
  return candidates[0] ?? null;
}

export function desiredTableToModel(
  desired: DesiredTable,
  opts: {
    /**
     * `(column) => native type string`, e.g. `varchar(120)`. A display-only
     * type (D30) never reaches a CREATE — the validator refuses that — but it
     * can reach a restatement of an existing column, where the caller returns
     * the snapshot's own `dbType` rather than inventing one.
     */
    dbTypeFor: (column: DesiredColumn) => string;
    /** Default schema for dialects that have one; `public` on postgres. */
    defaultSchema: string;
  },
): TableModel {
  const schema = desired.schema ?? opts.defaultSchema;
  const id = desired.id ?? `${schema}.${desired.name}`;
  const uniqueSingles = new Set(
    [...desired.uniques, ...desired.indexes.filter((i) => i.unique)]
      .filter((u) => u.columns.length === 1)
      .map((u) => u.columns[0]!),
  );

  const columns: ColumnModel[] = desired.columns.map((column, index) => ({
    name: column.name,
    ordinal: index + 1,
    dbType: opts.dbTypeFor(column),
    logicalType: column.logicalType,
    nullable: column.nullable && !desired.primaryKey.includes(column.name),
    default: column.default,
    isPrimaryKey: desired.primaryKey.includes(column.name),
    isUnique: uniqueSingles.has(column.name),
    isGenerated: false,
    enumRef:
      column.logicalType === 'enum' || (desired.enumValues[column.name] ?? []).length > 0
        ? `${id}.${column.name}`
        : null,
    maxLength: column.maxLength,
    numericPrecision: column.numericPrecision,
    numericScale: column.numericScale,
    isArray: false,
    comment: column.comment,
    references: null,
    semantics: null,
  }));

  return {
    id,
    schema,
    name: desired.name,
    kind: 'table',
    comment: desired.comment,
    columns,
    primaryKey: desired.primaryKey,
    uniques: desired.uniques.map((u) => ({ name: u.name, columns: u.columns })),
    checks: Object.entries(desired.enumValues).map(([column, values]) => ({
      name: null,
      // The one CHECK shape the vocabulary admits (D30/D32). Values are
      // rendered by the executor's per-dialect literal escaper, never here.
      expression: `${column} in (${values.map((v) => JSON.stringify(v)).join(', ')})`,
    })),
    indexes: desired.indexes.map((i) => ({
      name: i.name ?? `${desired.name}_${i.columns.join('_')}_idx`,
      columns: i.columns,
      expression: null,
      unique: i.unique,
      primary: false,
      method: null,
      partial: false,
    })),
    rowCountEstimate: null,
    rowCountExact: false,
    sizeBytes: null,
    activity: null,
    rls: null,
    system: false,
    semantics: null,
  };
}
