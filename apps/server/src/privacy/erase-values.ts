// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT AN ERASED FIELD BECOMES. One rule for a person's own row, a copy of
 * them on another row, their outbox mail, and the images the audit log and
 * the removed-row history keep of those rows:
 *
 *  - NULL wherever the column takes it;
 *  - a yes/no that may not be empty reads "no" (false, or 0 where the
 *    database keeps it as a number), as "delete my details" writes it
 *    (`publicAccess[].forget`, `routes/public` `DELETE /public/account`);
 *  - text that may not be empty:
 *      - on a unique column, a value of its own, never `''` (a second
 *        erased person's `''` would collide): `erased-<12 hex>`, and on an
 *        address column `erased-<12 hex>@erased.invalid`, a reserved domain
 *        no mail is ever sent to (`outbox/sender.ts` `reservedAddress`);
 *      - on the column that names the person, "Erased person" in the
 *        install's language (D21; see `erasedNameOf`);
 *      - otherwise `''`;
 *  - anything else that may not be empty (a number, a date, a choice) is
 *    left as it is, and said so: the erasure counts it under `left`.
 *
 * A column the database works out itself (generated) is never written.
 */
import { randomBytes } from 'node:crypto';

import type { Dialect } from '@adminium/engine';

import type { ResolvedTable } from '../crud/identifiers.js';

/** The reserved domain an erased unique address is written on. */
export const ERASED_DOMAIN = 'erased.invalid';

/** What a column is to the person: their address, their name, or another field of theirs. */
export type ErasedRole = 'email' | 'name' | 'other';

/** What the rule reads of a column. */
export interface ColumnFacts {
  nullable: boolean;
  logicalType: string;
  unique: boolean;
  maxLength: number | null;
  generated: boolean;
}

const TEXT = new Set(['text', 'varchar']);

/** A column's facts, from the table's model (unique: on its own, in a unique constraint, or a unique index). */
export function columnFacts(table: ResolvedTable, name: string): ColumnFacts | null {
  const column = table.table.columns.find((one) => one.name === name);
  const resolved = table.columns.get(name);
  if (column === undefined || resolved === undefined) return null;
  const unique =
    column.isUnique === true ||
    (table.table.uniques ?? []).some((one) => one.columns.includes(name)) ||
    (table.table.indexes ?? []).some((one) => one.unique && !one.primary && one.columns.includes(name));
  return { nullable: resolved.nullable, logicalType: resolved.logicalType, unique, maxLength: column.maxLength ?? null, generated: column.isGenerated === true };
}

/** A value of its own for a unique column: never the same twice. */
function uniqueToken(role: ErasedRole, maxLength: number | null): string {
  const id = randomBytes(6).toString('hex');
  const value = role === 'email' ? `erased-${id}@${ERASED_DOMAIN}` : `erased-${id}`;
  return maxLength !== null && value.length > maxLength ? value.slice(0, maxLength) : value;
}

/** What one field becomes (see the header), or `{left: true}` when the column cannot be emptied. */
export function blankValue(facts: ColumnFacts, role: ErasedRole, dialect: Dialect, erasedName: string): { value: unknown } | { left: true } {
  if (facts.generated) return { left: true };
  if (facts.nullable) return { value: null };
  if (facts.logicalType === 'boolean') return { value: dialect === 'postgres' ? false : 0 };
  if (!TEXT.has(facts.logicalType)) return { left: true };
  if (facts.unique) return { value: uniqueToken(role, facts.maxLength) };
  if (role === 'name') return { value: facts.maxLength !== null && erasedName.length > facts.maxLength ? erasedName.slice(0, facts.maxLength) : erasedName };
  return { value: '' };
}

/** Whether a stored value is already what the rule would write (nothing to do, nothing to count). */
export function alreadyBlank(value: unknown, facts: ColumnFacts, role: ErasedRole, erasedName: string): boolean {
  if (value === null || value === undefined) return true;
  if (facts.nullable) return false;
  if (facts.logicalType === 'boolean') return value === false || value === 0 || value === '0';
  if (typeof value !== 'string') return false;
  if (facts.unique) return value.startsWith('erased-');
  return role === 'name' ? value === erasedName || value === '' : value === '';
}
