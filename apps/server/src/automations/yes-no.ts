// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A yes/no as a rule reads one, whatever spelled it: a database's own `true`
 * or `1`, a rule's `'true'`, `'yes'` or `1`. Null for anything that is
 * neither a yes nor a no — which a condition then reads as "does not hold",
 * never as a no.
 *
 * Why it exists: a yes/no column reads `true` on Postgres and `1` on SQLite
 * and MySQL, so "is true" and "is 1" each used to hold on some engines and
 * not on the others. Both sides go through this, on every engine.
 */
export function yesNo(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return Number(value) === 1 ? true : Number(value) === 0 ? false : null;
  if (typeof value !== 'string') return null;
  const text = value.trim().toLowerCase();
  if (text === 'true' || text === '1' || text === 'yes') return true;
  if (text === 'false' || text === '0' || text === 'no') return false;
  return null;
}
