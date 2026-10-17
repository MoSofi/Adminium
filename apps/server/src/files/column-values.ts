// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a column that holds files (`column.file`) holds, read the same on every
 * database: one file's id in a text column, or a list of ids in a json
 * column, which SQLite keeps as text and Postgres and MySQL hand back parsed.
 *
 * Nothing here judges a value: the write service does that
 * (`files/column-judge.ts`). These read what is there.
 */
import { isId } from '@adminium/meta';

/**
 * The strings a value names, in order: none for an empty value, one for a
 * plain string, each string of a list (an array, or a JSON array written as
 * text). `null` when the value is not one of those shapes at all: a number,
 * an object, a list holding something that is not a string, text that opens
 * a list and does not close one.
 */
export function namedIn(value: unknown): string[] | null {
  if (value === null || value === undefined || value === '') return [];
  let list: unknown = value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed.startsWith('[')) return [trimmed];
    try {
      list = JSON.parse(trimmed) as unknown;
    } catch {
      return null;
    }
  }
  if (!Array.isArray(list)) return null;
  return list.every((entry): entry is string => typeof entry === 'string') ? list : null;
}

/** The file ids a stored value holds: what `namedIn` reads, kept to Adminium's own ids. */
export function fileIdsIn(value: unknown): string[] {
  return (namedIn(value) ?? []).filter((id) => isId(id, 'file'));
}

/** A list column's value as a reader gets it: an array on every database (SQLite hands JSON back as text). */
export function readFileList(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const named = namedIn(value);
  return named === null ? value : named;
}
