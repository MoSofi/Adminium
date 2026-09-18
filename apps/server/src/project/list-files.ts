// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `lists/<key>.json`: one option list as a file (plan 50 D20).
 *
 * A `column.options` rule either carries its values inline or NAMES a list, and
 * the rule travels in `schema/<database>.json`. A named list that lived only in
 * the workspace's database would make that rule mean nothing in the next
 * install, so the list travels beside the rule — as a file whose NAME is the
 * key, for the same reason a page file's name is its address: the key is what
 * everything else says, and plan 49's gate refuses an instance id in a file.
 *
 * What the file leaves out: the id, and the timestamps. Both are this install's.
 * `origin` is kept, because "this started as a copy of the built-in countries"
 * is something the editor says out loud and the next install should still know.
 *
 * The BUILT-IN lists have no file. They are the same in every install and they
 * are code, so a project that uses `builtin:countries` carries nothing; a
 * project that edited it carries the copy, under the copy's own key.
 */

import type { OptionListItem } from '@adminium/meta';

/** Where the published JSON Schema sits, seen from `lists/`. */
export const LIST_FILE_SCHEMA_REF = '../node_modules/@adminiumjs/adminium/schemas/list.json';

/** The same slug the store and the routes enforce. */
export const LIST_KEY_PATTERN = /^[a-z][a-z0-9-]*$/;

const ITEM_KEYS = ['value', 'label', 'tone', 'description'] as const;
const FILE_KEYS = ['$schema', 'name', 'origin', 'items'] as const;

/** What one list file says, ready to store. */
export interface ListFileDocument {
  key: string;
  name: string;
  items: OptionListItem[];
  origin: string;
}

/** The file for one stored list. The key is the file name, so it is not inside. */
export function toListFile(row: { name: string; items: readonly OptionListItem[]; origin: string }): Record<string, unknown> {
  const out: Record<string, unknown> = { $schema: LIST_FILE_SCHEMA_REF, name: row.name };
  // `custom` is what a list with no history is, so saying it adds nothing.
  if (row.origin !== 'custom') out['origin'] = row.origin;
  out['items'] = row.items.map((item) => {
    const copy: Record<string, unknown> = { value: item.value };
    if (item.label !== undefined) copy['label'] = item.label;
    if (item.tone !== undefined) copy['tone'] = item.tone;
    if (item.description !== undefined) copy['description'] = item.description;
    return copy;
  });
  return out;
}

export type ReadListFileResult = { ok: true; doc: ListFileDocument } | { ok: false; problems: string[] };

/** Check a parsed list file and turn it into a list to store. */
export function readListFile(value: unknown, key: string): ReadListFileResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, problems: ['(the file): must be a JSON object'] };
  }
  const file = value as Record<string, unknown>;
  const problems: string[] = [];
  for (const name of Object.keys(file)) {
    if (!(FILE_KEYS as readonly string[]).includes(name)) problems.push(`${name}: is not a known key`);
  }
  const name = file['name'];
  if (typeof name !== 'string' || name.trim().length === 0 || name.length > 200) {
    problems.push('name: must be what this list is called');
  }
  const origin = file['origin'] ?? 'custom';
  if (typeof origin !== 'string' || origin.length > 140) problems.push('origin: must be a string');

  const raw = file['items'];
  if (!Array.isArray(raw)) return { ok: false, problems: [...problems, 'items: must be a list of values'] };
  if (raw.length === 0) problems.push('items: a list with no values is not a list');
  if (raw.length > 500) problems.push('items: a list holds at most 500 values');

  const items: OptionListItem[] = [];
  const seen = new Set<string>();
  raw.forEach((entry: unknown, index) => {
    const where = `items[${String(index)}]`;
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      problems.push(`${where}: must be an object`);
      return;
    }
    const item = entry as Record<string, unknown>;
    for (const field of Object.keys(item)) {
      if (!(ITEM_KEYS as readonly string[]).includes(field)) problems.push(`${where}.${field}: is not a known key`);
    }
    const text = (field: string, max: number): string | undefined => {
      const held = item[field];
      if (held === undefined) return undefined;
      if (typeof held !== 'string' || held.length > max) {
        problems.push(`${where}.${field}: must be text of at most ${String(max)} characters`);
        return undefined;
      }
      return held;
    };
    const value = item['value'];
    if (typeof value !== 'string' || value.length === 0 || value.length > 256) {
      problems.push(`${where}.value: must be the value that is stored, e.g. "DE"`);
      return;
    }
    if (seen.has(value)) {
      // Two rows with the same value would make the second unreachable, and a
      // form would draw one option twice.
      problems.push(`${where}: "${value}" is listed twice`);
      return;
    }
    seen.add(value);
    items.push({
      value,
      ...(text('label', 256) === undefined ? {} : { label: text('label', 256) }),
      ...(text('tone', 40) === undefined ? {} : { tone: text('tone', 40) }),
      ...(text('description', 512) === undefined ? {} : { description: text('description', 512) }),
    });
  });

  return problems.length > 0
    ? { ok: false, problems }
    : { ok: true, doc: { key, name: name as string, items, origin: origin as string } };
}
