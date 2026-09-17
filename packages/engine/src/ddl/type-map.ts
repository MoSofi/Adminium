// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The forward type map — `LogicalType` → a native DDL type, per dialect.
 *
 * ─── Why this is not `install-ddl.ts`'s map ────────────────────────────────
 *
 * `apps/server/src/add-ons/install-ddl.ts:87-138` looks like exactly this
 * function and is keyed by a different vocabulary: the MANIFEST's fifteen
 * abstract types (`id`, `text`, `int`, `fk`, `blob`, …), not the IR's nineteen
 * `LogicalType`s. `id` and `fk` are not types at all — they are roles that
 * happen to imply `varchar(36)`. So the installer's map is a template for the
 * shape of this one, not a thing to import, and the two answer different
 * questions: "what column does this manifest field want?" versus "what does
 * this IR type spell as on this engine?".
 *
 * ─── The direction that has never existed ──────────────────────────────────
 *
 * Every adapter ships a `type-map.ts` and every one of them runs the other way
 * — native → logical, for introspection. Reading `character varying(120)` and
 * answering `varchar` is lossy on purpose. Going forward needs the length back,
 * which is why this takes the whole column and not just the type.
 *
 * ─── Rulings worth reading, not just the table ─────────────────────────────
 *
 * - **`timestamptz` is a real timestamp on every dialect.** The meta store
 *   uses epoch milliseconds in an integer column and is entitled to: it owns
 *   its rows. These tables sit in the OPERATOR's database beside their own
 *   data, and a `created_at` holding `1750000000000` is unreadable to every
 *   other tool they point at it. `install-ddl.ts:78-82` made the same call for
 *   the same reason.
 * - **`decimal` defaults to `(19,4)`** when no precision is authored — what
 *   accounting settled on, and binary floating point cannot represent a tenth
 *   of a cent.
 * - **`enum` is a string plus a CHECK on all three dialects (D32).** No
 *   `CREATE TYPE` on postgres: a native enum is a second object to own, drop
 *   and migrate, and the introspector already lifts `CHECK (col IN (…))` back
 *   into an `EnumDef` — which is how the generated app gets a select instead
 *   of a free-text box.
 * - **SQLite gets declared types with lengths anyway.** SQLite has affinity,
 *   not types, so `TEXT` would behave identically — and `sqlite-ddl.ts:16-36`
 *   already recorded why that is the worst thing to emit: the introspector
 *   reads `maxLength` off the declared type text, and a `status TEXT` column
 *   fails the kanban archetype's `maxLength <= 32` gate, so the schema
 *   generates a plain grid instead of the board it is describing. The DDL is
 *   not the product; the pages generated from it are.
 */
import type { Dialect, LogicalType } from '../schema-model.js';
import { isAuthorableLogicalType, type AuthorableLogicalType, type DesiredColumn } from './edit.js';

/** Default precision/scale for a `decimal` with none authored. */
export const DEFAULT_DECIMAL_PRECISION = 19;
export const DEFAULT_DECIMAL_SCALE = 4;
/** Default length for a `varchar` with none authored. */
export const DEFAULT_VARCHAR_LENGTH = 255;
/** The string width an `enum` column gets — wide enough for any sane label. */
export const ENUM_COLUMN_LENGTH = 64;

/** What {@link ddlTypeFor} needs: an AUTHORABLE type, because it emits DDL. */
export interface TypeMapColumn {
  logicalType: AuthorableLogicalType;
  maxLength?: number | null;
  numericPrecision?: number | null;
  numericScale?: number | null;
}

/**
 * What {@link isWideningChange} compares. The `from` side is the full
 * `LogicalType`, deliberately: an EXISTING column may be `interval` or
 * `geometry` (D30 makes those display-only, not unreachable), and "is
 * `interval → text` lossless?" is a question the planner really asks. Only the
 * `to` side has to be authorable, and the validator has already enforced that.
 */
export interface TypeShape {
  logicalType: LogicalType;
  maxLength?: number | null;
  numericPrecision?: number | null;
  numericScale?: number | null;
}

/**
 * The native type string for an authored column. Pure and total: every
 * authorable type has an answer on every dialect, and the compiler proves it
 * (the `switch` is exhaustive over `AuthorableLogicalType`).
 */
export function ddlTypeFor(column: TypeMapColumn, dialect: Dialect): string {
  const pg = dialect === 'postgres';
  const my = dialect === 'mysql';
  const lite = dialect === 'sqlite';

  switch (column.logicalType) {
    case 'text':
      // MySQL's TEXT cannot carry a default and cannot be fully indexed, but a
      // column authored as `text` is one the operator said is unbounded — a
      // silent downgrade to varchar would be a different column than they asked
      // for. The default-on-text case is refused in the planner, not hidden here.
      return 'text';
    case 'varchar':
      return `varchar(${column.maxLength ?? DEFAULT_VARCHAR_LENGTH})`;
    case 'integer':
      return 'integer';
    case 'bigint':
      // SQLite's INTEGER is already 64-bit; spelling it `bigint` would still get
      // INTEGER affinity but reads as a different type to every other tool.
      return lite ? 'integer' : 'bigint';
    case 'decimal':
      return `decimal(${column.numericPrecision ?? DEFAULT_DECIMAL_PRECISION},${
        column.numericScale ?? DEFAULT_DECIMAL_SCALE
      })`;
    case 'float':
      return lite ? 'real' : 'double precision';
    case 'boolean':
      // MySQL has no boolean; `tinyint(1)` is what its own docs call one and
      // what the introspector reads back as `boolean`.
      return pg ? 'boolean' : my ? 'tinyint(1)' : 'integer';
    case 'date':
      return 'date';
    case 'time':
      return 'time';
    case 'timestamp':
      return pg ? 'timestamp' : my ? 'datetime' : 'text';
    case 'timestamptz':
      // SQLite has no date/time type at all; text is what every SQLite tool
      // reads back as a timestamp and what the introspector recognises.
      return pg ? 'timestamptz' : my ? 'datetime' : 'text';
    case 'uuid':
      // Only postgres has a native uuid. `char(36)` on MySQL is the canonical
      // hyphenated form; SQLite stores it as text.
      return pg ? 'uuid' : my ? 'char(36)' : 'text';
    case 'json':
      // `jsonb` on postgres: the operational default, and the one the CRUD
      // layer's filters already assume. MySQL's `json` is its only spelling.
      return pg ? 'jsonb' : my ? 'json' : 'text';
    case 'enum':
      // D32: a string plus a CHECK, never a native type. The CHECK is emitted
      // by the planner from `enumValues`, not here.
      return `varchar(${ENUM_COLUMN_LENGTH})`;
  }
}

/**
 * Convenience wrapper matching `desiredTableToModel`'s injected signature.
 *
 * A display-only type (D30) can appear on an EXISTING column the edit is not
 * retyping — the validator allows that and the wire carries all nineteen types
 * — so the fallback returns the type's own name rather than throwing. The
 * emitted DDL for such a column is only ever a restatement of what the database
 * already has.
 */
export function ddlTypeForDesired(dialect: Dialect): (column: DesiredColumn) => string {
  return (column) =>
    isAuthorableLogicalType(column.logicalType)
      ? ddlTypeFor({ ...column, logicalType: column.logicalType }, dialect)
      : column.logicalType;
}

/**
 * Is a change from one type shape to another LOSSLESS on this dialect?
 *
 * Used by the planner to decide `lossy`. Conservative by construction: an
 * unknown pairing is lossy, because the cost of wrongly promising "no data
 * will be lost" is unbounded and the cost of an unnecessary confirmation is a
 * click.
 */
export function isWideningChange(from: TypeShape, to: TypeShape, dialect: Dialect): boolean {
  if (from.logicalType === to.logicalType) {
    switch (from.logicalType) {
      case 'varchar': {
        const a = from.maxLength ?? DEFAULT_VARCHAR_LENGTH;
        const b = to.maxLength ?? DEFAULT_VARCHAR_LENGTH;
        return b >= a;
      }
      case 'decimal': {
        const ap = from.numericPrecision ?? DEFAULT_DECIMAL_PRECISION;
        const bp = to.numericPrecision ?? DEFAULT_DECIMAL_PRECISION;
        const as = from.numericScale ?? DEFAULT_DECIMAL_SCALE;
        const bs = to.numericScale ?? DEFAULT_DECIMAL_SCALE;
        // Both the integer part and the fractional part must grow or hold.
        return bp - bs >= ap - as && bs >= as;
      }
      default:
        return true;
    }
  }
  // Cross-family widenings that every dialect performs without loss.
  const widening: readonly [LogicalType, LogicalType][] = [
    ['varchar', 'text'],
    ['integer', 'bigint'],
    ['integer', 'decimal'],
    ['integer', 'float'],
    ['bigint', 'decimal'],
    ['float', 'decimal'],
    ['date', 'timestamp'],
    ['date', 'timestamptz'],
    ['timestamp', 'timestamptz'],
    ['enum', 'varchar'],
    ['enum', 'text'],
  ];
  const isWide = widening.some(([a, b]) => a === from.logicalType && b === to.logicalType);
  if (!isWide) return false;
  // `float → decimal` is lossless in range but not in representation on
  // SQLite, whose REAL is the only numeric it has.
  if (dialect === 'sqlite' && from.logicalType === 'float' && to.logicalType === 'decimal') {
    return false;
  }
  return true;
}
