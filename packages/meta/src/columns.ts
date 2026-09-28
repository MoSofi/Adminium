// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Portable column-type helpers.
 *
 * Every migration receives a {@link ColumnHelpers} instance built for the
 * target dialect; this module is one of the few places allowed to branch on
 * dialect (#1).
 *
 * | helper   | PostgreSQL   | MySQL/MariaDB | SQLite    |
 * |----------|--------------|---------------|-----------|
 * | id       | varchar(36)  | char(36)      | char(36)  |
 * | str(n)   | varchar(n)   | varchar(n)    | text      |
 * | text     | text         | longtext      | text      |
 * | json     | jsonb        | json          | text      |
 * | bool     | boolean      | tinyint(1)    | integer   |
 * | int      | integer      | integer       | integer   |
 * | bigint   | bigint       | bigint        | integer   |
 * | ts       | bigint       | bigint        | integer   | epoch ms UTC
 */

import { sql, type ColumnDataType, type RawBuilder } from 'kysely';

export type MetaDialect = 'postgres' | 'mysql' | 'sqlite';

/** What Kysely's `addColumn` accepts: a known data-type string or raw SQL. */
export type PortableColumnType = ColumnDataType | RawBuilder<unknown>;

export interface ColumnHelpers {
  readonly dialect: MetaDialect;
  /** Type-prefixed ULID primary/foreign key column. */
  readonly id: PortableColumnType;
  /** Indexable/unique string, n ≤ 320. */
  str(n: number): PortableColumnType;
  /**
   * Unbounded text — never indexed. MySQL's own `text` stops at 65,535 bytes,
   * so there it is `longtext`; migration 0047 widened every column made before.
   */
  readonly text: PortableColumnType;
  /** Opaque JSON payload — serialized/parsed + Zod-validated in repos, never queried with JSON operators. */
  readonly json: PortableColumnType;
  /** Boolean — repos coerce reads to JS boolean. */
  readonly bool: PortableColumnType;
  readonly int: PortableColumnType;
  /** Values always < 2^53; returned as JS number. */
  readonly bigint: PortableColumnType;
  /** Epoch milliseconds UTC — never native datetime. */
  readonly ts: PortableColumnType;
  /** Dialect-correct boolean literal for DDL `DEFAULT` clauses. */
  boolDefault(value: boolean): RawBuilder<unknown>;
}

// 2048 covers the longest legitimate short-string columns (URLs in notifications/webhooks);
// anything longer belongs in a `text` column. MySQL utf8mb4 varchar(2048) is fine un-indexed.
const MAX_STR = 2048;

export function columnHelpers(dialect: MetaDialect): ColumnHelpers {
  const str = (n: number): PortableColumnType => {
    if (!Number.isInteger(n) || n < 1 || n > MAX_STR) {
      throw new RangeError(`str(n): n must be an integer in [1, ${MAX_STR}], got ${n}`);
    }
    return dialect === 'sqlite' ? 'text' : (`varchar(${n})` as ColumnDataType);
  };
  return {
    dialect,
    // Ids are type-prefixed ULIDs of VARIABLE length (3-4 char prefix + '_' +
    // 26 ULID chars, e.g. usr_… = 30, view_… = 31). Postgres `char(36)`
    // (bpchar) blank-pads to 36 on write and hands the padding back on every
    // read — 'view_…' comes back as 'view_…     ', breaking id round-trips.
    // MySQL strips CHAR pad spaces at retrieval and SQLite ignores the length
    // entirely, so only Postgres deviates from the table.
    //
    // DECISION (2026-07-20, pre-release): this change alters the DDL that the
    // already-written migrations 0001–0009 emit on postgres, with no
    // compensating ALTER, and the checksum ledger cannot see it (it hashes
    // migration sources, not this helper). That is acceptable exactly once:
    // no Adminium release exists and no deployed pg meta store predates it.
    // After v1.0 ships, a column-type change like this MUST ship as a new
    // migration instead — never edit this helper's emitted types again.
    id: dialect === 'postgres' ? ('varchar(36)' as ColumnDataType) : sql`char(36)`,
    str,
    // MySQL `text` holds 65,535 bytes and refuses one more in strict mode (or
    // cuts it off silently in non-strict mode): an enrichment prompt or a public
    // endpoint's definition outgrew it. `longtext` is the MySQL type that
    // matches the other two engines' unbounded `text`. Unlike the `id` decision
    // above, this one ships with a compensating migration: 0047 converts the
    // columns every earlier migration made, so an upgraded store and a fresh
    // one end the same.
    text: dialect === 'mysql' ? sql`longtext` : 'text',
    json: dialect === 'postgres' ? 'jsonb' : dialect === 'mysql' ? 'json' : 'text',
    bool: dialect === 'postgres' ? 'boolean' : dialect === 'mysql' ? sql`tinyint(1)` : 'integer',
    int: 'integer',
    bigint: dialect === 'sqlite' ? 'integer' : 'bigint',
    ts: dialect === 'sqlite' ? 'integer' : 'bigint',
    boolDefault: (value: boolean) =>
      dialect === 'postgres' ? (value ? sql`true` : sql`false`) : value ? sql`1` : sql`0`,
  };
}
