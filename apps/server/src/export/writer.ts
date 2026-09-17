// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The row writer an export is written through — ONE implementation shared by
 * the `export-run` job and `POST /exports/preview`, so the preview's "Raw
 * file" tab is literally the file's first lines.
 *
 * Two modes, and the split is the whole point:
 *
 * - **definition** (a builder-made export): headers are the definition's
 *   labels; a cell the mask pass listed in the row's `_masked` marker is
 *   written as `•••••` (D6) — the comp's promise, and the one thing that keeps
 *   a masked cell distinguishable from a null; JSON Lines is keyed by header
 *   text, a numeric column's value is spliced UNQUOTED when it reads as a
 *   number, empty is `null`, everything else is a JSON string (D7).
 * - **legacy** (an export with no `columns`, and every scheduled report):
 *   byte-identical to what shipped before this file existed — column names as
 *   headers, masked cells empty, JSON Lines keyed by column name with the
 *   driver's own values. Pinned by `data-io-routes.test.ts` and
 *   `export-derived.test.ts`.
 */

import { CRLF, EXPORT_BOM, serializeCsvRow } from '../data-io/csv.js';
import type { Row } from '../crud/mask.js';

/** What a masked cell reads as in a builder-made file (D6). */
export const MASKED_CELL = '•••••';

/** A value a numeric column may splice into JSON Lines unquoted (D7). */
const JSON_NUMBER = /^-?\d+(?:\.\d+)?$/;

/** The row key `maskRow` writes its refusal list under. */
const MASK_MARKER = '_masked';

export type ExportWriterFormat = 'csv' | 'json';

export interface WriterColumn {
  /** The row key the value is read from — a base column or a projection alias. */
  key: string;
  /** The header the value is written under. */
  header: string;
  /** Whether a plain decimal string may be written as a JSON number. */
  numeric: boolean;
}

export interface RowWriterOptions {
  /** CSV only: write the header line. Default true. */
  headerRow?: boolean | undefined;
  /** The pre-definition shape (see the header comment). */
  legacy?: boolean | undefined;
}

export interface RowWriter {
  readonly extension: 'csv' | 'jsonl';
  readonly mime: string;
  /** Bytes before the first line (the CSV BOM). */
  preamble(): string;
  /** The header line, or null when the format or the options carry none. */
  headerLine(): string | null;
  /** One record, with its line terminator. */
  line(record: Row): string;
}

/**
 * One cell as the CSV writes it BEFORE quoting — the preview's table tab and
 * the CSV branch share this, so a cell on screen is the cell in the file.
 */
export function cellText(value: unknown, masked: boolean): string {
  if (masked) return MASKED_CELL;
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Masked keys of one row, from the marker `maskRow` writes. */
export function maskedKeysOf(record: Row): ReadonlySet<string> {
  const marker = record[MASK_MARKER];
  return new Set(Array.isArray(marker) ? (marker as string[]) : []);
}

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === '';
}

function jsonCell(value: unknown, column: WriterColumn, masked: boolean): string {
  if (masked) return JSON.stringify(MASKED_CELL);
  if (isEmpty(value)) return 'null';
  const text =
    value instanceof Date ? value.toISOString() : typeof value === 'object' ? JSON.stringify(value) : String(value);
  // A text splice, not a parse: `4820.00` keeps its zeros and a wide decimal
  // keeps every digit — the consumer's parser decides what a number is.
  if (column.numeric && JSON_NUMBER.test(text)) return text;
  return JSON.stringify(text);
}

export function createRowWriter(
  format: ExportWriterFormat,
  columns: readonly WriterColumn[],
  options: RowWriterOptions = {},
): RowWriter {
  const legacy = options.legacy === true;
  const headerRow = options.headerRow !== false;

  if (format === 'csv') {
    return {
      extension: 'csv',
      mime: 'text/csv; charset=utf-8',
      preamble: () => EXPORT_BOM,
      headerLine: () => (headerRow ? serializeCsvRow(columns.map((column) => column.header)) : null),
      line: (record) => {
        if (legacy) return serializeCsvRow(columns.map((column) => record[column.key]));
        const masked = maskedKeysOf(record);
        return serializeCsvRow(
          columns.map((column) => (masked.has(column.key) ? MASKED_CELL : record[column.key])),
        );
      },
    };
  }

  return {
    extension: 'jsonl',
    mime: 'application/x-ndjson',
    preamble: () => '',
    headerLine: () => null,
    line: (record) => {
      if (legacy) {
        const slim: Record<string, unknown> = {};
        for (const column of columns) slim[column.key] = record[column.key] ?? null;
        return `${JSON.stringify(slim)}\n`;
      }
      const masked = maskedKeysOf(record);
      const parts = columns.map(
        (column) =>
          `${JSON.stringify(column.header)}:${jsonCell(record[column.key], column, masked.has(column.key))}`,
      );
      return `{${parts.join(',')}}\n`;
    },
  };
}

export { CRLF };
