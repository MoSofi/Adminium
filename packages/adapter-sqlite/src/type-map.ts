// SPDX-License-Identifier: AGPL-3.0-only
/**
 * SQLite declared type → affinity → portable LogicalType mapping —
 * 05-introspection-engine.md §2.2 ("SQLite (declared → affinity)") and §4.3.
 *
 * SQLite declared types are free text: apply SQLite's five-rule affinity
 * algorithm first, then override with declared-name hints (`BOOLEAN`,
 * `DATETIME`, `UUID`, `JSON`, …). `STRICT` tables skip the hint layer (their
 * type vocabulary is closed: INT/INTEGER/REAL/TEXT/BLOB/ANY). Columns with
 * NO declared type get BLOB affinity → `logicalType: 'unknown'` with a
 * Studio hint to add a type (the assembler emits the warning).
 *
 * Timestamps may be stored as TEXT or INTEGER epoch — storage format is NOT
 * probed at setup (schema-only); the runtime data layer detects it on first
 * read (05 §2.2).
 */
import type { ColumnDefault, LogicalType } from '@adminium/engine/adapter';

export type SqliteAffinity = 'INTEGER' | 'TEXT' | 'BLOB' | 'REAL' | 'NUMERIC';

/**
 * SQLite's five-rule column affinity algorithm (sqlite.org/datatype3.html
 * §3.1), verbatim: INT → INTEGER; CHAR/CLOB/TEXT → TEXT; BLOB or empty →
 * BLOB; REAL/FLOA/DOUB → REAL; everything else → NUMERIC.
 */
export function sqliteAffinity(declaredType: string): SqliteAffinity {
  const t = declaredType.toUpperCase();
  if (t.trim() === '') return 'BLOB';
  if (t.includes('INT')) return 'INTEGER';
  if (t.includes('CHAR') || t.includes('CLOB') || t.includes('TEXT')) return 'TEXT';
  if (t.includes('BLOB')) return 'BLOB';
  if (t.includes('REAL') || t.includes('FLOA') || t.includes('DOUB')) return 'REAL';
  return 'NUMERIC';
}

export interface MappedType {
  logicalType: LogicalType;
  maxLength: number | null;
  numericPrecision: number | null;
  numericScale: number | null;
  affinity: SqliteAffinity;
}

/**
 * Remove the first `(…)` group — the linear equivalent of
 * `.replace(/\([^)]*\)/, '')`.
 *
 * Written as an index scan because that regex is quadratic (CodeQL
 * js/polynomial-redos), and SQLite declared types are free text straight out
 * of `sqlite_master.sql`: on a declared type that opens parens and never
 * closes one (`((((…`) the unanchored scan restarts at every `(` and `[^)]*`
 * rescans the whole remainder before failing on `\)`.
 *
 * Equivalent by construction: `[^)]*` cannot cross a `)`, so the leftmost
 * match always runs from the first `(` to the first `)` after it; and when no
 * `)` follows the first `(`, none follows any later `(` either, so the regex
 * matches nothing.
 */
function stripFirstParenGroup(value: string): string {
  const open = value.indexOf('(');
  if (open === -1) return value;
  const close = value.indexOf(')', open + 1);
  if (close === -1) return value;
  return value.slice(0, open) + value.slice(close + 1);
}

/** Strip `(…)` modifiers and collapse whitespace. */
function baseTypeName(declaredType: string): string {
  return stripFirstParenGroup(declaredType.trim().toUpperCase())
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extract `(n)` / `(p,s)` modifier numbers, when present. */
function modifiers(declaredType: string): number[] {
  const match = /\(([\d\s,]+)\)/.exec(declaredType);
  if (match?.[1] === undefined) return [];
  return match[1]
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((n) => Number.isFinite(n));
}

/** Declared-name hints layered over affinity — 05 §2.2 (skipped on STRICT). */
function hintFor(base: string): LogicalType | null {
  if (base.includes('BOOL')) return 'boolean';
  if (base.includes('DATETIME') || base.includes('TIMESTAMP')) return 'timestamp';
  if (base === 'DATE') return 'date';
  if (base === 'TIME') return 'time';
  if (base.includes('UUID') || base.includes('GUID')) return 'uuid';
  if (base.includes('JSON')) return 'json';
  if (base.includes('DECIMAL') || base.includes('NUMERIC') || base === 'NUM') return 'decimal';
  return null;
}

/**
 * Map a verbatim SQLite declared type to its portable shape. `strict: true`
 * (from `pragma_table_list.strict`) skips the hint layer; `ANY` and
 * unrecognized non-strict names become `'unknown'` with the verbatim
 * `dbType` preserved by the caller (rendered read-only as text — 05 §2.2).
 */
export function mapSqliteType(
  declaredType: string,
  opts: { strict?: boolean } = {},
): MappedType {
  const affinity = sqliteAffinity(declaredType);
  const base = baseTypeName(declaredType);
  const mods = modifiers(declaredType);
  const strict = opts.strict ?? false;

  let maxLength: number | null = null;
  let numericPrecision: number | null = null;
  let numericScale: number | null = null;

  let logicalType: LogicalType;
  if (base === '') {
    // No declared type: BLOB affinity, but unmappable → unknown (05 §4.3).
    logicalType = 'unknown';
  } else if (base === 'ANY') {
    logicalType = 'unknown'; // STRICT tables' escape-hatch column type
  } else {
    switch (affinity) {
      case 'INTEGER':
        logicalType = base.includes('BIGINT') ? 'bigint' : 'integer';
        break;
      case 'TEXT':
        logicalType = mods[0] !== undefined && /(VAR)?CHAR/.test(base) ? 'varchar' : 'text';
        maxLength = /(VAR)?CHAR|TEXT|CLOB/.test(base) ? (mods[0] ?? null) : null;
        break;
      case 'REAL':
        logicalType = 'float';
        break;
      case 'BLOB':
        logicalType = 'binary';
        break;
      case 'NUMERIC': {
        const hint = hintFor(base);
        if (hint === 'decimal') {
          logicalType = 'decimal';
          numericPrecision = mods[0] ?? null;
          numericScale = mods[1] ?? null;
        } else if (!strict && hint !== null) {
          logicalType = hint;
        } else {
          // NUMERIC catch-all with an unrecognized name — unknown (05 §2.2).
          logicalType = 'unknown';
        }
        break;
      }
    }
    // Hints can also override TEXT/INTEGER affinities (e.g. declared DATETIME
    // stored as TEXT, declared UUID, declared JSON) — never on STRICT tables.
    if (!strict && affinity !== 'NUMERIC') {
      const hint = hintFor(base);
      if (hint !== null && hint !== 'decimal') logicalType = hint;
    }
  }

  return { logicalType, maxLength, numericPrecision, numericScale, affinity };
}

const NOW_DEFAULT = /^(current_timestamp|current_date|current_time|datetime\(\s*'now'[^)]*\)|strftime\(\s*'%s'[^)]*\)|unixepoch\(\s*\))$/i;
const LITERAL_DEFAULT = /^('(?:[^']|'')*'|-?\d+(\.\d+)?|true|false|null|x'[0-9a-f]*')$/i;

/**
 * Classify a column default — `pragma_table_xinfo.dflt_value` is the raw
 * default expression text. Autoincrement is decided by the assembler
 * (INTEGER PRIMARY KEY rowid alias / AUTOINCREMENT keyword — 05 §4.3),
 * not here.
 */
export function classifyDefault(defaultText: string | null): ColumnDefault {
  if (defaultText === null || defaultText === '') return null;
  const text = defaultText.trim();
  if (/^null$/i.test(text)) return null;
  if (NOW_DEFAULT.test(text)) return { kind: 'now' };
  if (LITERAL_DEFAULT.test(text)) return { kind: 'literal', text };
  return { kind: 'expression', text };
}
