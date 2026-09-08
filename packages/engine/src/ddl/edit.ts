// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `SchemaEdit` — the desired-state document a client authors, and the closed
 * vocabulary it may author in. 35-schema-authoring.md §3.1, D30, 35-T02.
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
 * Add ONE column to a table that already exists — the narrow door
 * (38-files-library-and-attachments.md D6).
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
});
export type AddColumn = z.infer<typeof addColumnSchema>;

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
  /** Table ids. */
  dropTables: z.array(z.string().min(1)).default([]),
});
export type SchemaEdit = z.infer<typeof schemaEditSchema>;

// ---------------------------------------------------------------------------
// Validation issues
// ---------------------------------------------------------------------------

/**
 * Every way an edit can be refused before a plan is even attempted. These are
 * the §4 refusal codes that are decidable from the document plus the snapshot,
 * without a database round trip; the privilege and row-count refusals live in
 * preflight (35-T34, 35-T07) because they need one.
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
  actual: Pick<TableModel, 'id' | 'schema' | 'name' | 'kind' | 'system' | 'columns' | 'primaryKey'>[];
  /**
   * True when Adminium's own meta tables live in THIS database — the condition
   * that makes the `adminium_` namespace reachable through a source connection
   * (35 §4 `META_NAMESPACE`). The server passes `sameDatabase(metaDsn, dataDsn)`.
   */
  metaSharesDatabase: boolean;
  /** Reserved-word predicate; injected so the check is testable in isolation. */
  isReserved: (identifier: string, dialect: Dialect) => boolean;
}

const META_PREFIX = 'adminium_';

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
      return text === 'true' || text === 'false';
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

/**
 * Which default kinds make sense for a type. `autoincrement` is a key
 * generator, not a value — it belongs only on an integer key (D31).
 */
function defaultKindAllowed(kind: NonNullable<DesiredDefault>['kind'], type: LogicalType): boolean {
  switch (kind) {
    case 'autoincrement':
      return type === 'integer' || type === 'bigint';
    case 'uuid':
      return type === 'uuid' || type === 'text' || type === 'varchar';
    case 'now':
      return type === 'date' || type === 'time' || type === 'timestamp' || type === 'timestamptz';
    case 'literal':
      return true;
  }
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
        if (!defaultKindAllowed(def.kind, column.logicalType)) {
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
      } else if (column.logicalType !== 'enum') {
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
    if (entry.column.logicalType === 'enum') {
      push({
        code: 'ENUM_ON_NON_ENUM_COLUMN',
        message: 'an enum column carries a value list, which belongs to the table — add it in the table designer',
        ...where,
      });
    }

    const def = entry.column.default;
    if (def !== null) {
      if (!defaultKindAllowed(def.kind, entry.column.logicalType)) {
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
 * the new columns appended (38-files-library-and-attachments.md D6).
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
  opts: { dbTypeFor: (column: DesiredColumn) => string },
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
  return { ...actual, columns: [...actual.columns, ...added] };
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
    enumRef: column.logicalType === 'enum' ? `${id}.${column.name}` : null,
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
