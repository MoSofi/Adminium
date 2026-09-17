// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Reserved-word lists per dialect.
 *
 * ─── Why this exists at all ────────────────────────────────────────────────
 *
 * Every identifier that reaches SQL on the READ paths comes out of a snapshot
 * (`apps/server/src/crud/identifiers.ts`), so a reserved word can only ever
 * arrive there by already existing in the customer's database — where it is,
 * by construction, quotable and working. Authoring inverts that: the client
 * supplies a name that is in no snapshot, and the question "is `order` a legal
 * table name?" gets asked for the first time.
 *
 * ─── Why refuse rather than quote ──────────────────────────────────────────
 *
 * Quoting would make it work. `CREATE TABLE "order" (…)` is valid on every
 * dialect here, and Kysely quotes every identifier it compiles, so Adminium
 * would never notice. What breaks is everything else the operator points at
 * their own database: a hand-written `SELECT * FROM order` fails, an ORM that
 * does not quote fails, a BI tool's generated SQL fails. Adminium's whole
 * premise is that the operator's tables stay THEIRS — legible and usable by
 * every other tool — so creating a name that only Adminium can address is a
 * trap Adminium set. Refuse at authoring time, when it is free to pick another
 * word (`RESERVED_IDENTIFIER`).
 *
 * An identifier that ALREADY exists is never checked against these lists: it
 * is in the snapshot, it works today, and refusing to rename a column on a
 * table whose name we dislike would be an editor that cannot edit.
 *
 * ─── What is in each list ──────────────────────────────────────────────────
 *
 * The dialect's own documented reserved words, lower-cased. Not "keywords" —
 * every dialect's keyword list is far longer than its reserved list and
 * includes words that are perfectly legal as identifiers (`name`, `value`,
 * `type`, `status`, `key`). Refusing those would make the designer unusable
 * for ordinary schemas, which is why the test asserts `status` is ACCEPTED
 * on all three.
 *
 * Sources: PostgreSQL "SQL Key Words" appendix (reserved + reserved-can-be-
 * function-or-type), MySQL 8.0 "Keywords and Reserved Words" (the (R) rows),
 * SQLite "SQL Keywords" (SQLite has no reserved/non-reserved split — every
 * keyword is contextually reserved, so the list is the keyword list).
 */
import type { Dialect } from '../../schema-model.js';

/**
 * PostgreSQL reserved words — the `reserved` and
 * `reserved (can be function or type)` rows of the SQL Key Words appendix.
 * Words marked `non-reserved` there are legal identifiers and are absent.
 */
const POSTGRES = [
  'all', 'analyse', 'analyze', 'and', 'any', 'array', 'as', 'asc', 'asymmetric',
  'authorization', 'binary', 'both', 'case', 'cast', 'check', 'collate', 'collation',
  'column', 'concurrently', 'constraint', 'create', 'cross', 'current_catalog',
  'current_date', 'current_role', 'current_schema', 'current_time', 'current_timestamp',
  'current_user', 'default', 'deferrable', 'desc', 'distinct', 'do', 'else', 'end',
  'except', 'false', 'fetch', 'for', 'foreign', 'freeze', 'from', 'full', 'grant',
  'group', 'having', 'ilike', 'in', 'initially', 'inner', 'intersect', 'into', 'is',
  'isnull', 'join', 'lateral', 'leading', 'left', 'like', 'limit', 'localtime',
  'localtimestamp', 'natural', 'not', 'notnull', 'null', 'offset', 'on', 'only', 'or',
  'order', 'outer', 'overlaps', 'placing', 'primary', 'references', 'returning', 'right',
  'select', 'session_user', 'similar', 'some', 'symmetric', 'system_user', 'table',
  'tablesample', 'then', 'to', 'trailing', 'true', 'union', 'unique', 'user', 'using',
  'variadic', 'verbose', 'when', 'where', 'window', 'with',
] as const;

/**
 * MySQL 8.0 reserved words — the (R)-marked rows of "Keywords and Reserved
 * Words". Includes 8.0 additions (`rank`, `row_number`, `cume_dist`, …) that
 * were legal identifiers in 5.7, which is why test names `rank`.
 */
const MYSQL = [
  'accessible', 'add', 'all', 'alter', 'analyze', 'and', 'as', 'asc', 'asensitive',
  'before', 'between', 'bigint', 'binary', 'blob', 'both', 'by', 'call', 'cascade',
  'case', 'change', 'char', 'character', 'check', 'collate', 'column', 'condition',
  'constraint', 'continue', 'convert', 'create', 'cross', 'cube', 'cume_dist',
  'current_date', 'current_time', 'current_timestamp', 'current_user', 'cursor',
  'database', 'databases', 'day_hour', 'day_microsecond', 'day_minute', 'day_second',
  'dec', 'decimal', 'declare', 'default', 'delayed', 'delete', 'dense_rank', 'desc',
  'describe', 'deterministic', 'distinct', 'distinctrow', 'div', 'double', 'drop',
  'dual', 'each', 'else', 'elseif', 'empty', 'enclosed', 'escaped', 'except', 'exists',
  'exit', 'explain', 'false', 'fetch', 'first_value', 'float', 'float4', 'float8',
  'for', 'force', 'foreign', 'from', 'fulltext', 'function', 'generated', 'get',
  'grant', 'group', 'grouping', 'groups', 'having', 'high_priority',
  'hour_microsecond', 'hour_minute', 'hour_second', 'if', 'ignore', 'in', 'index',
  'infile', 'inner', 'inout', 'insensitive', 'insert', 'int', 'int1', 'int2', 'int3',
  'int4', 'int8', 'integer', 'intersect', 'interval', 'into', 'io_after_gtids',
  'io_before_gtids', 'is', 'iterate', 'join', 'json_table', 'key', 'keys', 'kill',
  'lag', 'last_value', 'lateral', 'lead', 'leading', 'leave', 'left', 'like', 'limit',
  'linear', 'lines', 'load', 'localtime', 'localtimestamp', 'lock', 'long', 'longblob',
  'longtext', 'loop', 'low_priority', 'master_bind', 'master_ssl_verify_server_cert',
  'match', 'maxvalue', 'mediumblob', 'mediumint', 'mediumtext', 'middleint',
  'minute_microsecond', 'minute_second', 'mod', 'modifies', 'natural', 'not',
  'no_write_to_binlog', 'nth_value', 'ntile', 'null', 'numeric', 'of', 'on', 'optimize',
  'optimizer_costs', 'option', 'optionally', 'or', 'order', 'out', 'outer', 'outfile',
  'over', 'partition', 'percent_rank', 'precision', 'primary', 'procedure', 'purge',
  'range', 'rank', 'read', 'reads', 'read_write', 'real', 'recursive', 'references',
  'regexp', 'release', 'rename', 'repeat', 'replace', 'require', 'resignal',
  'restrict', 'return', 'revoke', 'right', 'rlike', 'row', 'rows', 'row_number',
  'schema', 'schemas', 'second_microsecond', 'select', 'sensitive', 'separator', 'set',
  'show', 'signal', 'smallint', 'spatial', 'specific', 'sql', 'sqlexception',
  'sqlstate', 'sqlwarning', 'sql_big_result', 'sql_calc_found_rows',
  'sql_small_result', 'ssl', 'starting', 'stored', 'straight_join', 'system', 'table',
  'terminated', 'then', 'tinyblob', 'tinyint', 'tinytext', 'to', 'trailing', 'trigger',
  'true', 'undo', 'union', 'unique', 'unlock', 'unsigned', 'update', 'usage', 'use',
  'using', 'utc_date', 'utc_time', 'utc_timestamp', 'values', 'varbinary', 'varchar',
  'varcharacter', 'varying', 'virtual', 'when', 'where', 'while', 'window', 'with',
  'write', 'xor', 'year_month', 'zerofill',
] as const;

/**
 * SQLite keywords. SQLite has no reserved/non-reserved split — the parser
 * accepts many of these as identifiers in context — but a name that needs
 * quoting to be selectable is exactly what this module refuses, so the
 * keyword list IS the list.
 */
const SQLITE = [
  'abort', 'action', 'add', 'after', 'all', 'alter', 'always', 'analyze', 'and', 'as',
  'asc', 'attach', 'autoincrement', 'before', 'begin', 'between', 'by', 'cascade',
  'case', 'cast', 'check', 'collate', 'column', 'commit', 'conflict', 'constraint',
  'create', 'cross', 'current', 'current_date', 'current_time', 'current_timestamp',
  'database', 'default', 'deferrable', 'deferred', 'delete', 'desc', 'detach',
  'distinct', 'do', 'drop', 'each', 'else', 'end', 'escape', 'except', 'exclude',
  'exclusive', 'exists', 'explain', 'fail', 'filter', 'first', 'following', 'for',
  'foreign', 'from', 'full', 'generated', 'glob', 'group', 'groups', 'having', 'if',
  'ignore', 'immediate', 'in', 'index', 'indexed', 'initially', 'inner', 'insert',
  'instead', 'intersect', 'into', 'is', 'isnull', 'join', 'key', 'last', 'left',
  'like', 'limit', 'match', 'materialized', 'natural', 'no', 'not', 'nothing',
  'notnull', 'null', 'nulls', 'of', 'offset', 'on', 'or', 'order', 'others', 'outer',
  'over', 'partition', 'plan', 'pragma', 'preceding', 'primary', 'query', 'raise',
  'range', 'recursive', 'references', 'regexp', 'reindex', 'release', 'rename',
  'replace', 'restrict', 'returning', 'right', 'rollback', 'row', 'rows', 'savepoint',
  'select', 'set', 'table', 'temp', 'temporary', 'then', 'ties', 'to', 'transaction',
  'trigger', 'unbounded', 'union', 'unique', 'update', 'using', 'vacuum', 'values',
  'view', 'virtual', 'when', 'where', 'window', 'with', 'without',
] as const;

const SETS: Readonly<Record<Dialect, ReadonlySet<string>>> = {
  postgres: new Set(POSTGRES),
  mysql: new Set(MYSQL),
  sqlite: new Set(SQLITE),
  // A `generic` model came from a schema-import parser and has no live database
  // to author against; the union is the safe answer if one is ever asked for.
  generic: new Set([...POSTGRES, ...MYSQL, ...SQLITE]),
};

/** Is `identifier` reserved by `dialect`? Case-insensitive. */
export function isReservedWord(identifier: string, dialect: Dialect): boolean {
  return SETS[dialect].has(identifier.toLowerCase());
}

/** The full set for a dialect — exported for tests and for the Studio hint. */
export function reservedWordsFor(dialect: Dialect): ReadonlySet<string> {
  return SETS[dialect];
}
