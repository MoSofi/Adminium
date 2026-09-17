// SPDX-License-Identifier: AGPL-3.0-only
/**
 * How project files are written: JSON with a fixed key order, two-space
 * indent and a trailing newline. The same object always produces the same
 * text, so an edit in Studio changes only the lines it touched, and a file's
 * hash depends on what it says, not on how it was formatted.
 */

import { createHash } from 'node:crypto';

/** Keys that open a file, in this order; every other key follows alphabetically. */
const LEADING_KEYS = [
  '$schema',
  'v',
  'kind',
  'template',
  'origin',
  'enabled',
  'title',
  'source',
  'nav',
  'access',
  'padding',
  'width',
  'config',
  'generated',
  'overrides',
];

function orderKeys(keys: string[], depth: number): string[] {
  const sorted = [...keys].sort();
  if (depth > 0) return sorted;
  const leading = LEADING_KEYS.filter((key) => keys.includes(key));
  return [...leading, ...sorted.filter((key) => !LEADING_KEYS.includes(key))];
}

function normalize(value: unknown, depth: number): unknown {
  if (Array.isArray(value)) return value.map((item) => normalize(item, depth + 1));
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of orderKeys(Object.keys(record), depth)) {
      // `undefined` is not JSON; dropping it here keeps the hash of an object
      // with an unset optional key equal to the hash of the same object without it.
      if (record[key] !== undefined) out[key] = normalize(record[key], depth + 1);
    }
    return out;
  }
  return value;
}

/** The text a project file holds for `value`. */
export function stableStringify(value: unknown): string {
  return `${JSON.stringify(normalize(value, 0), null, 2)}\n`;
}

/** The hash a project file is known by: sha256 of its stable text. */
export function contentHash(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

export type JsonParseResult = { ok: true; value: unknown } | { ok: false; message: string };

/** Parse a file's text, naming the line and column JSON.parse complains about. */
export function parseJsonText(text: string): JsonParseResult {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const position = /position (\d+)/.exec(message);
    if (position === null) return { ok: false, message };
    const offset = Number(position[1]);
    const before = text.slice(0, offset);
    const line = before.split('\n').length;
    const column = offset - before.lastIndexOf('\n');
    return { ok: false, message: `${message.replace(/ in JSON at position \d+.*$/, '')} (line ${String(line)}, column ${String(column)})` };
  }
}
