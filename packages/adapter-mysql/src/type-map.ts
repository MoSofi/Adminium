// SPDX-License-Identifier: AGPL-3.0-only
/**
 * MySQL/MariaDB COLUMN_TYPE → portable LogicalType mapping —
 * 05-introspection-engine.md §2.2 ("canonical table — extend, never fork"),
 * MySQL/MariaDB column, plus the §4.2 type notes.
 *
 * Input is the verbatim `information_schema.COLUMNS.COLUMN_TYPE` string
 * (e.g. `varchar(120)`, `int unsigned`, `tinyint(1)`, `enum('a','b')`) so the
 * mapping is pure and unit-testable offline — no driver, no server.
 *
 * DOCUMENTED POLICY (05 §4.2): `tinyint(1)` maps to `boolean` (the mysql2 /
 * classic connector convention — MySQL has no native boolean and `BOOLEAN`
 * DDL compiles to `tinyint(1)`). Any other tinyint width is an integer.
 * `set(...)` degrades to `text` (the assembler emits a warning). `year` maps
 * to `integer` with a warning. `datetime` (no zone) → `timestamp`;
 * `timestamp` (UTC-normalized by the server) → `timestamptz`.
 */
import type { ColumnDefault, LogicalType } from '@adminium/engine/adapter';

export interface MappedMysqlType {
  logicalType: LogicalType;
  maxLength: number | null;
  numericPrecision: number | null;
  numericScale: number | null;
  /** `unsigned` modifier present on a numeric type. */
  unsigned: boolean;
  /** Non-fatal mapping caveat the assembler turns into a ModelWarning. */
  warning: 'unsigned-overflow' | 'year-as-integer' | 'set-as-text' | null;
}

/** Base type name (modifiers and attributes stripped) → LogicalType. */
const BASE_TYPE_MAP: Readonly<Record<string, LogicalType>> = {
  // integers (tinyint(1) special-cased in mapMysqlType)
  tinyint: 'integer',
  smallint: 'integer',
  mediumint: 'integer',
  int: 'integer',
  integer: 'integer',
  bigint: 'bigint',
  // exact + approximate numerics
  decimal: 'decimal',
  numeric: 'decimal',
  dec: 'decimal',
  fixed: 'decimal',
  float: 'float',
  double: 'float',
  'double precision': 'float',
  real: 'float',
  // text family
  char: 'varchar',
  varchar: 'varchar',
  tinytext: 'text',
  text: 'text',
  mediumtext: 'text',
  longtext: 'text',
  // binary family
  binary: 'binary',
  varbinary: 'binary',
  tinyblob: 'binary',
  blob: 'binary',
  mediumblob: 'binary',
  longblob: 'binary',
  // date/time
  date: 'date',
  time: 'time',
  datetime: 'timestamp',
  timestamp: 'timestamptz',
  year: 'integer',
  // structured / misc
  json: 'json',
  // MariaDB ≥ 10.7 native types
  uuid: 'uuid',
  inet4: 'inet',
  inet6: 'inet',
  // spatial (flag; rendered read-only as text in v1 — 05 §2.2)
  geometry: 'geometry',
  point: 'geometry',
  linestring: 'geometry',
  polygon: 'geometry',
  multipoint: 'geometry',
  multilinestring: 'geometry',
  multipolygon: 'geometry',
  geometrycollection: 'geometry',
  geomcollection: 'geometry',
};

/** Binary-float precision constants (same convention as the pg adapter). */
const FLOAT_PRECISION = 24;
const DOUBLE_PRECISION = 53;

/** Strip `(…)` modifiers and trailing attributes (`unsigned`, `zerofill`). */
function baseTypeName(columnType: string): string {
  return columnType
    .trim()
    .toLowerCase()
    .replace(/\([^)]*\)/, '')
    .replace(/\b(unsigned|zerofill|signed)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extract `(n)` / `(p,s)` modifier numbers, when present. */
function modifiers(columnType: string): number[] {
  const match = /\(([\d\s,]+)\)/.exec(columnType);
  if (match?.[1] === undefined) return [];
  return match[1]
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((n) => Number.isFinite(n));
}

/**
 * Parse the quoted value list of `enum('a','b')` / `set('a','b')`. MySQL
 * escapes embedded quotes by doubling (`''`) and the odd dump uses `\'` —
 * both are unescaped. Returns null when `columnType` is not an enum/set.
 */
export function parseEnumValues(columnType: string): string[] | null {
  const match = /^\s*(enum|set)\s*\((.*)\)\s*$/is.exec(columnType);
  if (match?.[2] === undefined) return null;
  const values: string[] = [];
  for (const literal of match[2].matchAll(/'((?:[^'\\]|\\.|'')*)'/g)) {
    values.push((literal[1] ?? '').replaceAll("''", "'").replaceAll("\\'", "'"));
  }
  return values;
}

/**
 * Map a verbatim MySQL/MariaDB COLUMN_TYPE to its portable shape.
 * Unmappable types become `'unknown'` with the verbatim `dbType` preserved
 * by the caller (rendered read-only as text — 05 §2.2).
 */
export function mapMysqlType(columnType: string): MappedMysqlType {
  const lowered = columnType.trim().toLowerCase();
  const unsigned = /\bunsigned\b/.test(lowered);

  // enum(...) / set(...) carry their value list inside the parens — handle
  // before modifier stripping. set(...) degrades to text (05 §4.2).
  if (lowered.startsWith('enum(') || lowered.startsWith('enum (')) {
    return {
      logicalType: 'enum',
      maxLength: null,
      numericPrecision: null,
      numericScale: null,
      unsigned: false,
      warning: null,
    };
  }
  if (lowered.startsWith('set(') || lowered.startsWith('set (')) {
    return {
      logicalType: 'text',
      maxLength: null,
      numericPrecision: null,
      numericScale: null,
      unsigned: false,
      warning: 'set-as-text',
    };
  }

  const base = baseTypeName(lowered);
  const mods = modifiers(lowered);

  // tinyint(1) → boolean (documented policy above); bit(1) reads as boolean too.
  if ((base === 'tinyint' && mods[0] === 1) || (base === 'bit' && (mods[0] ?? 1) === 1)) {
    return {
      logicalType: 'boolean',
      maxLength: null,
      numericPrecision: null,
      numericScale: null,
      unsigned,
      warning: null,
    };
  }

  const logicalType = BASE_TYPE_MAP[base] ?? 'unknown';

  let maxLength: number | null = null;
  let numericPrecision: number | null = null;
  let numericScale: number | null = null;
  let warning: MappedMysqlType['warning'] = null;

  if (logicalType === 'varchar' || logicalType === 'text' || logicalType === 'binary') {
    maxLength = mods[0] ?? null;
  } else if (logicalType === 'decimal') {
    numericPrecision = mods[0] ?? null;
    numericScale = mods[1] ?? null;
  } else if (logicalType === 'float') {
    numericPrecision = base === 'float' ? FLOAT_PRECISION : DOUBLE_PRECISION;
  }

  if (base === 'year') warning = 'year-as-integer';
  // `int unsigned` (and up) exceeds int4 range — flagged per 05 §4.2.
  else if (unsigned && (base === 'int' || base === 'integer' || base === 'bigint')) {
    warning = 'unsigned-overflow';
  }

  return { logicalType, maxLength, numericPrecision, numericScale, unsigned, warning };
}

const NOW_DEFAULT = /^(current_timestamp(\(\d*\))?|now\(\d*\))$/i;
const UUID_DEFAULT = /^uuid\(\)$/i;
const LITERAL_DEFAULT = /^('(?:[^']|'')*'|-?\d+(\.\d+)?|true|false|b'[01]+')$/i;

/**
 * Classify a column default — 05 §4.2: `EXTRA` carries `auto_increment`,
 * generated-column markers, and MySQL 8 `DEFAULT_GENERATED` expression
 * defaults; `COLUMN_DEFAULT` carries the value text (MariaDB quotes string
 * literals, MySQL 8 does not — both spellings are accepted).
 *
 * @param defaultValue `information_schema.COLUMNS.COLUMN_DEFAULT` (nullable).
 * @param extra `information_schema.COLUMNS.EXTRA` (may be '').
 */
export function classifyMysqlDefault(defaultValue: string | null, extra: string): ColumnDefault {
  const extraLowered = extra.toLowerCase();
  if (extraLowered.includes('auto_increment')) return { kind: 'autoincrement' };
  if (defaultValue === null || /^null$/i.test(defaultValue)) return null;
  const text = defaultValue.trim();
  if (NOW_DEFAULT.test(text)) return { kind: 'now' };
  if (UUID_DEFAULT.test(text)) return { kind: 'uuid' };
  // MySQL 8 marks expression defaults with DEFAULT_GENERATED in EXTRA.
  if (extraLowered.includes('default_generated')) return { kind: 'expression', text };
  if (LITERAL_DEFAULT.test(text)) return { kind: 'literal', text };
  // MySQL 8 strips quotes from string literals — a bare word is a literal.
  if (/^[^()]*$/.test(text)) return { kind: 'literal', text };
  return { kind: 'expression', text };
}
