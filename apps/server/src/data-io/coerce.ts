// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Import-time type coercion (M7-T07): CSV cells are strings; the effective
 * schema's `logicalType` says what the column wants. Coercion is strict —
 * a cell that does not parse is a per-row validation issue, never a silent
 * NULL or NaN — with the two §11.1 auto-resolutions the wizard advertises:
 * surrounding whitespace is trimmed, and empty cells map to NULL for
 * nullable columns.
 */

import type { ResolvedColumn } from '../crud/identifiers.js';

export interface CoercionIssue {
  /** 1-based data-row number (header excluded). */
  row: number;
  column: string;
  code: 'REQUIRED' | 'BAD_NUMBER' | 'BAD_BOOLEAN' | 'BAD_DATE' | 'BAD_JSON';
  message: string;
  value: string;
}

export type CoercionResult =
  | { ok: true; value: unknown }
  | { ok: false; code: CoercionIssue['code']; message: string };

const TRUE_WORDS = new Set(['true', 't', '1', 'yes', 'y', 'on']);
const FALSE_WORDS = new Set(['false', 'f', '0', 'no', 'n', 'off']);

/** Plain decimal notation only — `Number()` alone would accept 0x/0b/0o literals. */
const DECIMAL_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_NAIVE_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;
const ISO_ZONED_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i;

/**
 * ISO-only date/timestamp parsing. Bare `Date.parse` reads naive forms
 * (`2024-03-15 10:00`) and locale forms (`03/15/2024`) as SERVER-LOCAL time,
 * silently shifting the calendar day/wall clock on any non-UTC server — so:
 * naive ISO forms are pinned to UTC (wall time preserved), zoned forms keep
 * their explicit offset, and everything else (locale-ambiguous) is rejected
 * as a per-row issue per the module's strict-never-silent contract.
 */
function isoDateTimeOf(text: string): string | null {
  let candidate: string | null = null;
  let expectDay: string | null = null;
  if (ISO_DATE_RE.test(text)) {
    candidate = `${text}T00:00:00Z`;
    expectDay = text;
  } else if (ISO_NAIVE_RE.test(text)) {
    candidate = `${text.replace(' ', 'T')}Z`;
    expectDay = text.slice(0, 10);
  } else if (ISO_ZONED_RE.test(text)) {
    candidate = text.replace(' ', 'T');
  }
  if (candidate === null) return null;
  const ms = Date.parse(candidate);
  if (Number.isNaN(ms)) return null;
  const iso = new Date(ms).toISOString();
  // V8 leniently ROLLS out-of-range days (Feb 30 → Mar 1) instead of failing —
  // a silent rewrite, so a naive date that does not round-trip is an issue.
  // (Zoned inputs legitimately shift days when normalized to UTC — exempt.)
  if (expectDay !== null && iso.slice(0, 10) !== expectDay) return null;
  return iso;
}

/** Coerce one trimmed CSV cell for `column`. Empty cell ⇒ NULL when nullable. */
export function coerceCell(raw: string, column: ResolvedColumn): CoercionResult {
  const text = raw.trim();
  if (text === '') {
    if (column.nullable) return { ok: true, value: null };
    return { ok: false, code: 'REQUIRED', message: `${column.name} is required` };
  }

  switch (column.logicalType) {
    case 'integer':
    case 'bigint': {
      if (!/^[+-]?\d+$/.test(text)) {
        return { ok: false, code: 'BAD_NUMBER', message: `${JSON.stringify(text)} is not an integer` };
      }
      const value = Number(text);
      if (!Number.isSafeInteger(value)) {
        // Out of double range — hand the digits through as-is (PG bigint).
        return { ok: true, value: text };
      }
      return { ok: true, value };
    }
    case 'decimal':
    case 'float': {
      // Regex-gated like the integer branch: `Number('0x1f')` is 31, and a
      // stray hex/binary/octal cell must surface as an issue, not a value.
      if (!DECIMAL_RE.test(text)) {
        return { ok: false, code: 'BAD_NUMBER', message: `${JSON.stringify(text)} is not a number` };
      }
      const value = Number(text);
      if (!Number.isFinite(value)) {
        return { ok: false, code: 'BAD_NUMBER', message: `${JSON.stringify(text)} is not a number` };
      }
      return { ok: true, value };
    }
    case 'boolean': {
      const word = text.toLowerCase();
      if (TRUE_WORDS.has(word)) return { ok: true, value: true };
      if (FALSE_WORDS.has(word)) return { ok: true, value: false };
      return { ok: false, code: 'BAD_BOOLEAN', message: `${JSON.stringify(text)} is not a boolean` };
    }
    case 'date':
    case 'timestamp':
    case 'timestamptz': {
      const iso = isoDateTimeOf(text);
      if (iso === null) {
        return {
          ok: false,
          code: 'BAD_DATE',
          message: `${JSON.stringify(text)} is not an ISO date (use YYYY-MM-DD[ HH:mm[:ss]][Z])`,
        };
      }
      // §11.1 auto-resolution: normalize to ISO; `date` keeps the date part.
      return { ok: true, value: column.logicalType === 'date' ? iso.slice(0, 10) : iso };
    }
    case 'json': {
      try {
        JSON.parse(text);
        return { ok: true, value: text };
      } catch {
        return { ok: false, code: 'BAD_JSON', message: `${column.name} is not valid JSON` };
      }
    }
    // text / varchar / uuid / enum / interval / time / inet / geometry /
    // binary / unknown: pass the string through — the database is the
    // authority on the exotic types, and its error becomes the row issue.
    default:
      return { ok: true, value: text };
  }
}
