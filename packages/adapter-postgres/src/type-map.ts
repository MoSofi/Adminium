/**
 * Postgres dbType → portable LogicalType mapping — 05-introspection-engine.md
 * §2.2 ("canonical table — extend, never fork"), Postgres column.
 *
 * Input is the verbatim `pg_catalog.format_type(atttypid, atttypmod)` string
 * (e.g. `character varying(120)`, `timestamp with time zone`, `numeric(10,2)`)
 * so the mapping is pure and unit-testable offline. Enum/domain/array
 * resolution happens in the introspection assembler (it needs `pg_type`
 * rows); this module only handles the base-name mapping plus the
 * length/precision/scale extraction rules.
 */
import type { ColumnDefault, LogicalType } from '@adminium/engine/adapter';

/** `format_type` base name (parenthesized modifiers stripped) → LogicalType. */
const BASE_TYPE_MAP: Readonly<Record<string, LogicalType>> = {
  // text family
  text: 'text',
  citext: 'text',
  name: 'text',
  'character varying': 'varchar',
  varchar: 'varchar',
  character: 'varchar',
  char: 'varchar',
  bpchar: 'varchar',
  // integers (serial pseudo-types never appear in format_type output but are
  // kept for defensive parsing of imported DDL strings)
  smallint: 'integer',
  integer: 'integer',
  int2: 'integer',
  int4: 'integer',
  serial: 'integer',
  smallserial: 'integer',
  bigint: 'bigint',
  int8: 'bigint',
  bigserial: 'bigint',
  oid: 'integer',
  // exact + approximate numerics
  numeric: 'decimal',
  decimal: 'decimal',
  money: 'decimal',
  real: 'float',
  float4: 'float',
  'double precision': 'float',
  float8: 'float',
  // booleans
  boolean: 'boolean',
  bool: 'boolean',
  // date/time
  date: 'date',
  'time without time zone': 'time',
  'time with time zone': 'time',
  time: 'time',
  timetz: 'time',
  'timestamp without time zone': 'timestamp',
  timestamp: 'timestamp',
  'timestamp with time zone': 'timestamptz',
  timestamptz: 'timestamptz',
  interval: 'interval',
  // structured / misc
  uuid: 'uuid',
  json: 'json',
  jsonb: 'json',
  bytea: 'binary',
  inet: 'inet',
  cidr: 'inet',
  // PostGIS (flag; rendered read-only as text in v1 — 05 §2.2)
  geometry: 'geometry',
  geography: 'geometry',
};

/** Binary-float precision constants surfaced by the catalogs. */
const FLOAT4_PRECISION = 24;
const FLOAT8_PRECISION = 53;

export interface MappedType {
  logicalType: LogicalType;
  maxLength: number | null;
  numericPrecision: number | null;
  numericScale: number | null;
}

/** Strip `(…)` modifiers, `[]` suffixes, and interval field qualifiers. */
function baseTypeName(dbType: string): string {
  let base = dbType.trim().toLowerCase();
  base = base.replace(/\[\s*\]\s*$/g, ''); // array suffix (possibly multi-dim already collapsed)
  while (/\[\s*\]$/.test(base)) base = base.replace(/\[\s*\]$/, '');
  base = base.replace(/\(([^)]*)\)/, '').replace(/\s+/g, ' ').trim();
  if (base.startsWith('interval')) return 'interval';
  return base;
}

/** Extract `(n)` / `(p,s)` modifier numbers, when present. */
function modifiers(dbType: string): number[] {
  const match = /\(([\d\s,]+)\)/.exec(dbType);
  if (match?.[1] === undefined) return [];
  return match[1]
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((n) => Number.isFinite(n));
}

/**
 * Map a verbatim Postgres type string to its portable shape. Unmappable
 * types become `'unknown'` with the verbatim `dbType` preserved by the
 * caller (rendered read-only as text — 05 §2.2).
 */
export function mapPostgresType(dbType: string): MappedType {
  const base = baseTypeName(dbType);
  const logicalType = BASE_TYPE_MAP[base] ?? 'unknown';
  const mods = modifiers(dbType);

  let maxLength: number | null = null;
  let numericPrecision: number | null = null;
  let numericScale: number | null = null;

  if (logicalType === 'varchar' || logicalType === 'text') {
    maxLength = mods[0] ?? null;
  } else if (logicalType === 'decimal') {
    numericPrecision = mods[0] ?? null;
    numericScale = mods[1] ?? null;
  } else if (logicalType === 'float') {
    numericPrecision =
      base === 'real' || base === 'float4' ? FLOAT4_PRECISION : FLOAT8_PRECISION;
  }

  return { logicalType, maxLength, numericPrecision, numericScale };
}

const NOW_DEFAULT =
  /^(now\(\)|current_timestamp(\(\d*\))?|transaction_timestamp\(\)|statement_timestamp\(\)|current_date|current_time(\(\d*\))?)/i;
const UUID_DEFAULT = /^(gen_random_uuid\(\)|uuid_generate_v4\(\))/i;
const AUTOINCREMENT_DEFAULT = /^nextval\(/i;
/** `'…'::type`, bare numbers, booleans, or a typed NULL are literals. */
const LITERAL_DEFAULT =
  /^('(?:[^']|'')*'(?:::[a-z_"][\w ."[\]]*(?:\(\d+(?:,\s*\d+)?\))?)?|-?\d+(\.\d+)?|true|false|NULL(?:::[a-z_"][\w ."[\]]*)?)$/i;

/**
 * Classify a column default — 05 §4.1: `serial`/`nextval` and identity
 * columns → `autoincrement`; `now()`/`CURRENT_TIMESTAMP` → `now`;
 * `gen_random_uuid()`/`uuid_generate_v4()` → `uuid`.
 *
 * @param defaultExpr `pg_get_expr(adbin, adrelid)` output, or null.
 * @param identity `pg_attribute.attidentity` ('' | 'a' | 'd').
 */
export function classifyDefault(defaultExpr: string | null, identity: string): ColumnDefault {
  if (identity === 'a' || identity === 'd') return { kind: 'autoincrement' };
  if (defaultExpr === null || defaultExpr === '') return null;
  const text = defaultExpr.trim();
  if (AUTOINCREMENT_DEFAULT.test(text)) return { kind: 'autoincrement' };
  if (NOW_DEFAULT.test(text)) return { kind: 'now' };
  if (UUID_DEFAULT.test(text)) return { kind: 'uuid' };
  if (LITERAL_DEFAULT.test(text)) return { kind: 'literal', text };
  return { kind: 'expression', text };
}
