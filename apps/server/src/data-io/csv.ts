// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Hand-rolled RFC 4180 CSV (M7-T07) — no dependency exists in this repo and
 * none is added (the spec's "hand-roll" instruction).
 *
 * SERIALIZER decisions (unit-tested in data-io-csv.test.ts):
 * - Fields are quoted only when they contain a comma, a double quote, CR or
 *   LF; embedded quotes double (`"" `), per RFC 4180 §2.5–2.7.
 * - Records join with CRLF (RFC 4180 §2.1); the final record also ends with
 *   CRLF so concatenating exports remains valid CSV.
 * - BOM: exports are prefixed with U+FEFF (`EXPORT_BOM`). Excel — the primary
 *   consumer of a "Download CSV" button — mis-decodes unmarked UTF-8 as
 *   Windows-1252; every other consumer tolerates the BOM. The parser strips
 *   it, so Adminium round-trips its own artifacts byte-exactly.
 * - null/undefined serialize as the empty field; the importer's coercion maps
 *   the empty field back to NULL for nullable columns. This is lossy for
 *   empty-string-vs-null on purpose: CSV has no NULL literal.
 *
 * PARSER: a streaming state machine — `write(chunk)` may be called with
 * arbitrary splits (even mid-quote); rows are emitted as soon as complete.
 * Handles quoted fields, doubled quotes, multiline cells, CRLF/LF/CR line
 * ends, and a leading BOM.
 */

export const EXPORT_BOM = '﻿';
export const CRLF = '\r\n';

const NEEDS_QUOTING = /[",\r\n]/;

/** One value → one RFC 4180 field. */
export function serializeCsvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text: string;
  if (value instanceof Date) text = value.toISOString();
  else if (typeof value === 'object') text = JSON.stringify(value);
  else text = String(value);
  if (NEEDS_QUOTING.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

/** One row → one CRLF-terminated record. */
export function serializeCsvRow(values: readonly unknown[]): string {
  return values.map(serializeCsvField).join(',') + CRLF;
}

// --- streaming parser --------------------------------------------------------

export interface CsvParser {
  /** Feed a chunk (any split point); returns the rows completed by it. */
  write(chunk: string): string[][];
  /** Flush the trailing row (no final newline case). */
  end(): string[][];
}

export function createCsvParser(): CsvParser {
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  /** Just saw a closing quote — next char decides doubled-quote vs end. */
  let quoteEnded = false;
  /** Just saw a CR — swallow one following LF. */
  let afterCr = false;
  let first = true;
  let sawAny = false;

  function endField(): void {
    row.push(field);
    field = '';
    quoteEnded = false;
  }

  function endRow(out: string[][]): void {
    endField();
    out.push(row);
    row = [];
  }

  function write(chunk: string): string[][] {
    const out: string[][] = [];
    let text = chunk;
    if (first) {
      if (text.startsWith(EXPORT_BOM)) text = text.slice(EXPORT_BOM.length);
      if (text.length > 0) first = false;
    }
    for (const ch of text) {
      sawAny = true;
      if (afterCr) {
        afterCr = false;
        if (ch === '\n') continue; // CRLF — LF already handled by the CR
      }
      if (inQuotes) {
        if (quoteEnded) {
          if (ch === '"') {
            field += '"'; // doubled quote
            quoteEnded = false;
            continue;
          }
          inQuotes = false;
          quoteEnded = false;
          // fall through: ch closes/continues the field unquoted
        } else if (ch === '"') {
          quoteEnded = true;
          continue;
        } else {
          field += ch;
          continue;
        }
      }
      if (ch === '"' && field.length === 0) {
        inQuotes = true;
        continue;
      }
      if (ch === ',') {
        endField();
        continue;
      }
      if (ch === '\n') {
        endRow(out);
        continue;
      }
      if (ch === '\r') {
        endRow(out);
        afterCr = true;
        continue;
      }
      field += ch;
    }
    return out;
  }

  function end(): string[][] {
    const out: string[][] = [];
    // A trailing unterminated quote is treated as a terminated field (lenient).
    if (field.length > 0 || row.length > 0 || (sawAny && inQuotes)) {
      endRow(out);
      inQuotes = false;
    }
    return out;
  }

  return { write, end };
}

/** Whole-string convenience over the streaming parser. */
export function parseCsv(text: string): string[][] {
  const parser = createCsvParser();
  return [...parser.write(text), ...parser.end()];
}
