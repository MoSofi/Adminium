// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT THE GATES READ, AND HOW A PLACE IN THE FILE IS NAMED.
 *
 * Every gate reads the same things: each string of the manifest, and each
 * package file decoded (a JSON file string by string, keys included; any
 * other file as text). A place is named twice:
 *  - `path`, for a person or a log: `manifest.json pages[2].envelope.title`
 *    or `seeds/orders.json [3].notes`;
 *  - a target, `<kind>:<item>:<field>`, which the save's answers are kept
 *    under (`choices.clear`, `choices.keep`; `choices.leaveOut` keeps
 *    `<kind>:<item>`).
 *
 * THE TARGET FORMAT. The converter, re-run with the answers, finds the place
 * by the same rule:
 *  - in the manifest, `kind` comes from the top-level block (`pages` → `page`,
 *    `emailTemplates` → `email`, `requiredSchema.tables` → `table`; see
 *    `BLOCK_KINDS`). `item` is the entry's `ref`, else its `key`, else its
 *    `table`, else its `kind`, else its index; a block that is an object keeps
 *    its block name, a record (`optionLists`) the record's key. A later entry
 *    whose item an earlier one already took adds `#<index>`. `field` is the
 *    path inside the entry (`envelope.config.layout.items[0].config.text`);
 *  - a top-level value of the manifest (`description.fallback`) is kind
 *    `app`, item the app's key, field its path;
 *  - in a package file under `seeds/`, kind is `rows` and item the table: the
 *    seed that names the file, else the nearest object on the way down with a
 *    `table` string (a sample file's `tables[n]`). `field` is the file's path,
 *    `#`, and the path inside it (`seeds/orders.json#[3].notes`);
 *  - any other package file is kind `file`, item its path, field the path
 *    inside it (empty for a text file: the whole file).
 *
 * Items are refs and keys, which hold no colon, so a target splits at its
 * first two colons.
 */
import type { AppManifest } from '@adminium/manifest';

export type PathPart = string | number;

/** One string the gates read: a value, or an object's key. */
export interface Leaf {
  /** `null` for the manifest, else the package file's path. */
  file: string | null;
  parts: readonly PathPart[];
  value: string;
  /** The string is an object's key, not a value. */
  isKey: boolean;
}

/** A decoded package file: JSON when it parses, text otherwise. */
export type Decoded = { kind: 'json'; value: unknown } | { kind: 'text'; value: string };

export function describePath(parts: readonly PathPart[]): string {
  let out = '';
  for (const part of parts) {
    if (typeof part === 'number') out += `[${String(part)}]`;
    else out += out === '' ? part : `.${part}`;
  }
  return out;
}

/** Bytes as text: UTF-8 when they are, else one character per byte, so a string inside a binary file is still seen. */
export function bytesAsText(bytes: Uint8Array): string {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  return text.includes('�') || text.includes('\u0000') ? Buffer.from(bytes).toString('latin1') : text;
}

export function decodeFile(path: string, bytes: Uint8Array): Decoded {
  const text = bytesAsText(bytes);
  if (/\.json$/i.test(path)) {
    try {
      return { kind: 'json', value: JSON.parse(text) as unknown };
    } catch {
      // Not JSON after all: read as text.
    }
  }
  return { kind: 'text', value: text };
}

/** Each string of `value`, keys included, depth first. */
export function walkStrings(value: unknown, parts: PathPart[], visit: (value: string, parts: readonly PathPart[], isKey: boolean) => void): void {
  if (typeof value === 'string') {
    visit(value, parts, false);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((child, index) => {
      walkStrings(child, [...parts, index], visit);
    });
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      visit(key, [...parts, key], true);
      walkStrings(child, [...parts, key], visit);
    }
  }
}

/** What the gates read: every string of the manifest and of each file, and where each is. */
export interface GateContent {
  leaves: readonly Leaf[];
  /** Each package file, decoded. */
  decoded: ReadonlyMap<string, Decoded>;
  placeOf(leaf: Pick<Leaf, 'file' | 'parts'>): Place;
}

/** Every string the gates read: the manifest's, then each file's. A text file is one leaf. */
export function readContent(manifest: AppManifest, files: ReadonlyMap<string, Uint8Array>): GateContent {
  const leaves: Leaf[] = [];
  const decoded = new Map<string, Decoded>();
  walkStrings(manifest, [], (value, parts, isKey) => leaves.push({ file: null, parts, value, isKey }));
  for (const [path, bytes] of files) {
    const one = decodeFile(path, bytes);
    decoded.set(path, one);
    if (one.kind === 'json') walkStrings(one.value, [], (value, parts, isKey) => leaves.push({ file: path, parts, value, isKey }));
    else leaves.push({ file: path, parts: [], value: one.value, isKey: false });
  }
  return {
    leaves,
    decoded,
    placeOf: (leaf) => placeOf(manifest, leaf, leaf.file === null ? undefined : decodedValue(decoded.get(leaf.file))),
  };
}

function decodedValue(one: Decoded | undefined): unknown {
  return one?.kind === 'json' ? one.value : undefined;
}

/** The check kind of each top-level block of the manifest. */
export const BLOCK_KINDS: Readonly<Record<string, string>> = {
  pages: 'page',
  roles: 'role',
  automations: 'automation',
  emailTemplates: 'email',
  outbox: 'email',
  documents: 'document',
  reports: 'report',
  invoiceLayouts: 'invoice',
  scheduledReports: 'schedule',
  publicAccess: 'public',
  publicKeys: 'public',
  payments: 'payments',
  seeds: 'rows',
  sampleData: 'rows',
  optionLists: 'option-list',
  settings: 'setting',
  navGroups: 'nav',
  navLinks: 'nav',
  addOns: 'add-on',
  instance: 'instance',
};

export interface Place {
  kind: string;
  item: string;
  field: string;
  /** For a person: the file and the path inside it. */
  path: string;
}

export function targetOf(place: Pick<Place, 'kind' | 'item' | 'field'>): string {
  return `${place.kind}:${place.item}:${place.field}`;
}

export function itemTargetOf(place: Pick<Place, 'kind' | 'item'>): string {
  return `${place.kind}:${place.item}`;
}

function entryName(entry: unknown, index: number): string {
  if (entry !== null && typeof entry === 'object') {
    const record = entry as Record<string, unknown>;
    for (const key of ['ref', 'key', 'table', 'kind']) {
      if (typeof record[key] === 'string' && record[key] !== '') return record[key];
    }
  }
  return String(index);
}

/** The item of each entry of an array block: its name, `#<index>` added where an earlier entry has that name. */
export function entryItems(entries: readonly unknown[]): string[] {
  const seen = new Set<string>();
  return entries.map((entry, index) => {
    const name = entryName(entry, index);
    const item = seen.has(name) ? `${name}#${String(index)}` : name;
    seen.add(name);
    return item;
  });
}

/** Where a leaf is, named as the target format says. */
export function placeOf(manifest: AppManifest, leaf: Pick<Leaf, 'file' | 'parts'>, fileValue?: unknown): Place {
  const parts = leaf.parts;
  if (leaf.file === null) {
    const path = `manifest.json ${describePath(parts)}`.trim();
    const doc = manifest as unknown as Record<string, unknown>;
    // requiredSchema.tables[i]: a table.
    if (parts[0] === 'requiredSchema' && parts[1] === 'tables' && typeof parts[2] === 'number') {
      const tables = manifest.requiredSchema.tables as readonly unknown[];
      return { kind: 'table', item: entryItems(tables)[parts[2]] ?? String(parts[2]), field: describePath(parts.slice(3)), path };
    }
    const top = parts[0];
    if (typeof top !== 'string') return { kind: 'app', item: manifest.key, field: '', path };
    const kind = BLOCK_KINDS[top];
    const block = doc[top];
    if (kind === undefined) return { kind: 'app', item: manifest.key, field: describePath(parts), path };
    if (Array.isArray(block) && typeof parts[1] === 'number') {
      return { kind, item: entryItems(block)[parts[1]] ?? String(parts[1]), field: describePath(parts.slice(2)), path };
    }
    if (top === 'optionLists' && typeof parts[1] === 'string') return { kind, item: parts[1], field: describePath(parts.slice(2)), path };
    return { kind, item: top, field: describePath(parts.slice(1)), path };
  }

  const inner = describePath(parts);
  const path = inner === '' ? leaf.file : `${leaf.file} ${inner}`;
  if (leaf.file.startsWith('seeds/')) {
    const seed = (manifest.seeds ?? []).find((one) => one.file === leaf.file);
    const table = seed?.table ?? nearestTable(fileValue, parts);
    if (table !== null) return { kind: 'rows', item: table, field: `${leaf.file}#${inner}`, path };
  }
  return { kind: 'file', item: leaf.file, field: inner, path };
}

/** The `table` of the deepest object on the way down to `parts` that names one. */
function nearestTable(value: unknown, parts: readonly PathPart[]): string | null {
  let node = value;
  let found: string | null = null;
  for (const part of parts) {
    if (node === null || typeof node !== 'object') break;
    const table = (node as Record<string, unknown>)['table'];
    if (typeof table === 'string' && table !== '') found = table;
    node = (node as Record<string | number, unknown>)[part];
  }
  return found;
}
