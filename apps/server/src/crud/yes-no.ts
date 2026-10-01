// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A yes/no column, read as a yes or a no on every engine.
 *
 * Postgres answers `true` and `false`. MySQL keeps a yes/no as `tinyint(1)`
 * and SQLite as `integer`, and both drivers hand back `1` and `0`. A caller
 * that wrote `{"open": false}` read `{"open": 0}`, and two apps tested
 * `=== true` / `!== false` on what came back: a switched-off order page
 * stayed open, a voided charge was never drawn as voided. The type the
 * column HAS is known here — MySQL's is introspected, SQLite's is said by
 * the `column.yesNo` rule — so the reply spells it the one way, at each door
 * a row leaves by.
 *
 * Only `0` and `1` are turned: anything else in such a column is not an
 * answer, and is left for whoever reads it to see as it is.
 */
import type { LogicalType } from '@adminium/engine';

export function yesNoAsBoolean(value: unknown): unknown {
  if (value === 1 || value === 0) return value === 1;
  if (value === 1n || value === 0n) return value === 1n;
  return value;
}

/** A row with each yes/no column's `0`/`1` as `false`/`true`; the same object when nothing changes. */
export function yesNoAsBooleans<T extends Record<string, unknown>>(
  row: T,
  columns: ReadonlyMap<string, { readonly logicalType: LogicalType }>,
): T {
  let out: Record<string, unknown> | null = null;
  for (const [name, value] of Object.entries(row)) {
    if (typeof value === 'boolean' || value === null || value === undefined) continue;
    if (columns.get(name)?.logicalType !== 'boolean') continue;
    const read = yesNoAsBoolean(value);
    if (read === value) continue;
    out ??= { ...row };
    out[name] = read;
  }
  return (out ?? row) as T;
}
