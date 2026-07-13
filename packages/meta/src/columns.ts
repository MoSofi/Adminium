/**
 * Portable column-type helpers (07-meta-store.md §2.1).
 *
 * Every migration receives a {@link ColumnHelpers} instance built for the
 * target dialect; this module is one of the few places allowed to branch on
 * dialect (07-meta-store.md acceptance #1).
 *
 * | helper   | PostgreSQL   | MySQL/MariaDB | SQLite    |
 * |----------|--------------|---------------|-----------|
 * | id       | char(36)     | char(36)      | char(36)  |
 * | str(n)   | varchar(n)   | varchar(n)    | text      |
 * | text     | text         | text          | text      |
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
  /** Unbounded text — never indexed. */
  readonly text: PortableColumnType;
  /** Opaque JSON payload — serialized/parsed + Zod-validated in repos, never queried with JSON operators. */
  readonly json: PortableColumnType;
  /** Boolean — repos coerce reads to JS boolean. */
  readonly bool: PortableColumnType;
  readonly int: PortableColumnType;
  /** Values always < 2^53; returned as JS number. */
  readonly bigint: PortableColumnType;
  /** Epoch milliseconds UTC — never native datetime (07-meta-store.md §2.1). */
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
    id: sql`char(36)`,
    str,
    text: 'text',
    json: dialect === 'postgres' ? 'jsonb' : dialect === 'mysql' ? 'json' : 'text',
    bool: dialect === 'postgres' ? 'boolean' : dialect === 'mysql' ? sql`tinyint(1)` : 'integer',
    int: 'integer',
    bigint: dialect === 'sqlite' ? 'integer' : 'bigint',
    ts: dialect === 'sqlite' ? 'integer' : 'bigint',
    boolDefault: (value: boolean) =>
      dialect === 'postgres' ? (value ? sql`true` : sql`false`) : value ? sql`1` : sql`0`,
  };
}
