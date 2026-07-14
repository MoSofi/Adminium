/**
 * Generic SQL-ish native type → LogicalType mapping (05 §2.2, "extend, never
 * fork"). Covers Postgres, MySQL/MariaDB and SQLite spellings in one table
 * because imported DDL is dialect-tolerant by design. TypeORM column `type`
 * strings are the same vocabulary, so that parser reuses this too.
 */
import type { ColumnDefault, LogicalType } from '@adminium/engine';

const BASE_TYPE_MAP: Readonly<Record<string, LogicalType>> = {
  // text
  text: 'text',
  tinytext: 'text',
  mediumtext: 'text',
  longtext: 'text',
  citext: 'text',
  clob: 'text',
  string: 'text',
  // varchar family
  'character varying': 'varchar',
  varchar: 'varchar',
  varchar2: 'varchar',
  nvarchar: 'varchar',
  character: 'varchar',
  char: 'varchar',
  nchar: 'varchar',
  bpchar: 'varchar',
  // integers
  tinyint: 'integer',
  smallint: 'integer',
  mediumint: 'integer',
  int: 'integer',
  integer: 'integer',
  int2: 'integer',
  int4: 'integer',
  serial: 'integer',
  smallserial: 'integer',
  year: 'integer',
  bigint: 'bigint',
  int8: 'bigint',
  bigserial: 'bigint',
  // numerics
  numeric: 'decimal',
  decimal: 'decimal',
  dec: 'decimal',
  money: 'decimal',
  real: 'float',
  float: 'float',
  float4: 'float',
  float8: 'float',
  double: 'float',
  'double precision': 'float',
  // booleans
  boolean: 'boolean',
  bool: 'boolean',
  // date/time
  date: 'date',
  time: 'time',
  timetz: 'time',
  'time with time zone': 'time',
  'time without time zone': 'time',
  timestamp: 'timestamp',
  'timestamp without time zone': 'timestamp',
  datetime: 'timestamp',
  datetime2: 'timestamp',
  'timestamp with time zone': 'timestamptz',
  timestamptz: 'timestamptz',
  interval: 'interval',
  // structured / misc
  uuid: 'uuid',
  json: 'json',
  jsonb: 'json',
  xml: 'text',
  bytea: 'binary',
  blob: 'binary',
  tinyblob: 'binary',
  mediumblob: 'binary',
  longblob: 'binary',
  binary: 'binary',
  varbinary: 'binary',
  bit: 'binary',
  enum: 'enum',
  inet: 'inet',
  cidr: 'inet',
  macaddr: 'inet',
  geometry: 'geometry',
  geography: 'geometry',
  point: 'geometry',
};

export interface MappedSqlType {
  logicalType: LogicalType;
  maxLength: number | null;
  numericPrecision: number | null;
  numericScale: number | null;
  isArray: boolean;
}

/**
 * Map a raw native type string (`varchar(120)`, `numeric(10,2)`,
 * `timestamp(6) with time zone`, `text[]`, `tinyint(1)`) to its LogicalType
 * plus extracted length/precision/scale.
 */
export function mapSqlType(rawType: string): MappedSqlType {
  let raw = rawType.trim();
  let isArray = false;
  while (raw.endsWith('[]')) {
    isArray = true;
    raw = raw.slice(0, -2).trim();
  }
  if (/\barray\b\s*$/i.test(raw)) {
    isArray = true;
    raw = raw.replace(/\barray\b\s*$/i, '').trim();
  }

  const argsMatch = /^([^(]+)\(([^)]*)\)(.*)$/.exec(raw);
  const base = (argsMatch ? `${argsMatch[1]} ${argsMatch[3] ?? ''}` : raw)
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    // 'unsigned'/'zerofill' are mysql noise for mapping purposes
    .replace(/\b(unsigned|zerofill)\b/g, '')
    .trim();
  const args = (argsMatch?.[2] ?? '')
    .split(',')
    .map((a) => Number.parseInt(a.trim(), 10))
    .filter((n) => Number.isFinite(n));

  // mysql2 convention: tinyint(1) is a boolean.
  if (base === 'tinyint' && args[0] === 1) {
    return { logicalType: 'boolean', maxLength: null, numericPrecision: null, numericScale: null, isArray };
  }

  const logicalType = BASE_TYPE_MAP[base] ?? 'unknown';
  const out: MappedSqlType = {
    logicalType,
    maxLength: null,
    numericPrecision: null,
    numericScale: null,
    isArray,
  };
  if (logicalType === 'varchar' || logicalType === 'text' || logicalType === 'binary') {
    out.maxLength = args[0] ?? null;
  } else if (logicalType === 'decimal' || logicalType === 'float') {
    out.numericPrecision = args[0] ?? null;
    out.numericScale = args[1] ?? null;
  }
  return out;
}

/** True for pg serial pseudo-types and their implied autoincrement default. */
export function isSerialType(rawType: string): boolean {
  return /^(small|big)?serial\b/i.test(rawType.trim());
}

/**
 * Classify a raw SQL DEFAULT expression into the IR's ColumnDefault shape.
 * Never returns `undefined` — anything unrecognized is an `expression`.
 */
export function classifySqlDefault(rawExpr: string): ColumnDefault {
  let expr = rawExpr.trim();
  if (expr.length === 0) return null;
  // pg_dump loves casts: 'draft'::character varying
  const castStripped = expr.replace(/::[a-zA-Z_][a-zA-Z0-9_ ]*(\[\])?/g, '').trim();
  expr = castStripped.length > 0 ? castStripped : expr;
  // strip one layer of wrapping parens
  while (expr.startsWith('(') && expr.endsWith(')')) {
    const inner = expr.slice(1, -1).trim();
    if (inner.length === 0) break;
    expr = inner;
  }

  if (/^nextval\s*\(/i.test(expr)) return { kind: 'autoincrement' };
  if (/^(now\s*\(\s*\)|current_timestamp(\s*\(\d*\))?|current_date|current_time|getdate\s*\(\s*\)|transaction_timestamp\s*\(\s*\)|statement_timestamp\s*\(\s*\))$/i.test(expr)) {
    return { kind: 'now' };
  }
  if (/^(gen_random_uuid|uuid_generate_v[14]|uuid)\s*\(\s*\)$/i.test(expr)) return { kind: 'uuid' };
  if (/^null$/i.test(expr)) return null;
  if (/^(true|false)$/i.test(expr)) return { kind: 'literal', text: expr.toLowerCase() };
  if (/^-?\d+(\.\d+)?$/.test(expr)) return { kind: 'literal', text: expr };
  const first = expr[0];
  if ((first === "'" || first === '"') && expr.endsWith(first) && expr.length >= 2) {
    return { kind: 'literal', text: expr.slice(1, -1).replaceAll(first + first, first) };
  }
  return { kind: 'expression', text: expr };
}
