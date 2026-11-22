// SPDX-License-Identifier: AGPL-3.0-only
/**
 * COLUMNS ANSWERED ONLY AS THERE OR NOT. A list asked with `presentOnly` gets
 * `true` or `false` for those columns, so a screen that must say only that a
 * date exists (a record tab's `presence`) is never handed the date. A column
 * the reader's row does not carry stays out: this never adds one.
 */
import type { Row } from './mask.js';

export function presentOnly<T extends Row>(rows: readonly T[], asked: string | readonly string[] | undefined): T[] {
  const names = asked === undefined ? [] : typeof asked === 'string' ? [asked] : asked;
  if (names.length === 0) return [...rows];
  return rows.map((row) => {
    const out: Row = { ...row };
    for (const name of names) if (Object.hasOwn(row, name)) out[name] = row[name] !== null && row[name] !== undefined;
    return out as T;
  });
}
