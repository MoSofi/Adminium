// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A manifest written as small files, composed into the one document the
 * validator reads.
 *
 * An app's manifest grows to hundreds of kilobytes, which is a poor thing to
 * edit by hand and a worse one to review. In an app folder it may be written
 * as parts instead — one file per table, one per page, and one per block —
 * and this module puts them together. It adds no format: the result is the
 * same `manifestVersion: 1` document, and every field has exactly one part it
 * may be written in.
 *
 * Pure: it is handed the files' text and never reads a disk, so the server,
 * the CLI and a browser all compose the same way.
 */

/** One part file: its path under the `manifest/` folder, with `/`, and its text. */
export interface ManifestPartFile {
  path: string;
  text: string;
}

export interface ComposeProblem {
  /** The part file, as given. */
  file: string;
  message: string;
}

/** Which part each piece of the composed document came from. */
export interface PartOrigin {
  /** The file of `requiredSchema.tables[i]`. */
  tables: string[];
  /** The file of `pages[i]`. */
  pages: string[];
}

export type ComposeResult =
  | { ok: true; document: Record<string, unknown>; origin: PartOrigin }
  | { ok: false; problems: ComposeProblem[] };

const APP_FILE = 'app.json';
const TABLES_DIR = 'tables';
const PAGES_DIR = 'pages';

/**
 * The single-block parts: the file, the manifest fields it holds, and whether
 * the file IS the one field (`roles.json` is the `roles` array) or an object
 * holding several.
 */
const BLOCK_PARTS: ReadonlyArray<{ file: string; fields: readonly string[]; whole: boolean }> = [
  { file: 'roles.json', fields: ['roles'], whole: true },
  { file: 'access.json', fields: ['publicAccess', 'publicKeys'], whole: false },
  { file: 'emails.json', fields: ['outbox', 'emailTemplates'], whole: false },
  { file: 'add-ons.json', fields: ['addOns'], whole: true },
  { file: 'sample.json', fields: ['sampleData', 'seeds'], whole: false },
  { file: 'settings.json', fields: ['settings'], whole: true },
  { file: 'option-lists.json', fields: ['optionLists'], whole: true },
  { file: 'documents.json', fields: ['documents'], whole: true },
];

/** What `app.json` holds. `prefixed` is `requiredSchema.prefixed`. */
const APP_FIELDS = [
  'kind',
  'manifestVersion',
  'key',
  'name',
  'version',
  'publisher',
  'license',
  'description',
  'categories',
  'compatibility',
  'capabilities',
  'frontends',
  'navGroups',
  'widgets',
  'prefixed',
] as const;

/** Every part, for a message that has to say what the parts are. */
export const MANIFEST_PARTS: readonly string[] = [
  APP_FILE,
  `${TABLES_DIR}/<ref>.json`,
  `${PAGES_DIR}/<ref>.json`,
  ...BLOCK_PARTS.map((part) => part.file),
];

/** The manifest field each part file holds, for a reader that has to say where a field is written. */
export const MANIFEST_PART_FIELDS: Readonly<Record<string, readonly string[]>> = {
  [APP_FILE]: APP_FIELDS,
  [`${TABLES_DIR}/<ref>.json`]: ['requiredSchema'],
  [`${PAGES_DIR}/<ref>.json`]: ['pages'],
  ...Object.fromEntries(BLOCK_PARTS.map((part) => [part.file, part.fields])),
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** `tables/jobs.json` → `jobs`; null when the path is not `<dir>/<name>.json`. */
function entryName(path: string, dir: string): string | null {
  if (!path.startsWith(`${dir}/`) || !path.endsWith('.json')) return null;
  const name = path.slice(dir.length + 1, -'.json'.length);
  return name === '' || name.includes('/') ? null : name;
}

/** An editor's `$schema` pointer is allowed at the top of any part and is not part of the manifest. */
function withoutSchemaPointer(value: Record<string, unknown>): Record<string, unknown> {
  if (!('$schema' in value)) return value;
  const { $schema: _dropped, ...rest } = value;
  return rest;
}

/**
 * Compose part files into one manifest document.
 *
 * It checks only what composing needs: that every file is a part, parses, has
 * the outer shape its part takes, and that a table or page file is named after
 * its `ref`. Everything else is the validator's, run on the result.
 */
export function composeManifest(files: readonly ManifestPartFile[]): ComposeResult {
  const problems: ComposeProblem[] = [];
  const parsed = new Map<string, unknown>();

  for (const file of [...files].sort((a, b) => byName(a.path, b.path))) {
    const known =
      file.path === APP_FILE ||
      BLOCK_PARTS.some((part) => part.file === file.path) ||
      entryName(file.path, TABLES_DIR) !== null ||
      entryName(file.path, PAGES_DIR) !== null;
    if (!known) {
      problems.push({ file: file.path, message: `not a manifest part. Parts are: ${MANIFEST_PARTS.join(', ')}` });
      continue;
    }
    try {
      parsed.set(file.path, JSON.parse(file.text) as unknown);
    } catch (error) {
      problems.push({ file: file.path, message: `not valid JSON: ${error instanceof Error ? error.message : String(error)}` });
    }
  }

  const document: Record<string, unknown> = {};
  const origin: PartOrigin = { tables: [], pages: [] };

  const app = parsed.get(APP_FILE);
  let prefixed: unknown;
  if (app === undefined) {
    if (!files.some((file) => file.path === APP_FILE)) problems.push({ file: APP_FILE, message: 'is missing: every app has one' });
  } else if (!isObject(app)) {
    problems.push({ file: APP_FILE, message: 'must be an object' });
  } else {
    for (const [field, value] of Object.entries(withoutSchemaPointer(app))) {
      if (field === 'prefixed') {
        prefixed = value;
        continue;
      }
      if (!(APP_FIELDS as readonly string[]).includes(field)) {
        const home = BLOCK_PARTS.find((part) => part.fields.includes(field))?.file;
        problems.push({
          file: APP_FILE,
          message:
            field === 'requiredSchema'
              ? `"requiredSchema" is written as one file per table in ${TABLES_DIR}/ (and "prefixed" here)`
              : field === 'pages'
                ? `"pages" is written as one file per page in ${PAGES_DIR}/`
                : home === undefined
                  ? `"${field}" is not a field of ${APP_FILE}`
                  : `"${field}" is written in ${home}`,
        });
        continue;
      }
      document[field] = value;
    }
  }

  // One entry per file, in file-name order, each named after its ref.
  const entries = (dir: string): { values: unknown[]; files: string[] } => {
    const values: unknown[] = [];
    const sources: string[] = [];
    for (const path of [...parsed.keys()].sort(byName)) {
      const name = entryName(path, dir);
      if (name === null) continue;
      const value = parsed.get(path);
      if (!isObject(value)) {
        problems.push({ file: path, message: 'must be an object' });
        continue;
      }
      const entry = withoutSchemaPointer(value);
      if (entry['ref'] !== name) {
        problems.push({
          file: path,
          message:
            typeof entry['ref'] === 'string'
              ? `the file is named "${name}" and its ref is "${entry['ref']}". Name the file ${entry['ref']}.json`
              : `has no "ref". It must be "${name}", the file's name`,
        });
        continue;
      }
      values.push(entry);
      sources.push(path);
    }
    return { values, files: sources };
  };

  const tables = entries(TABLES_DIR);
  origin.tables = tables.files;
  document['requiredSchema'] = { tables: tables.values, ...(prefixed === undefined ? {} : { prefixed }) };

  const pages = entries(PAGES_DIR);
  origin.pages = pages.files;
  document['pages'] = pages.values;

  for (const part of BLOCK_PARTS) {
    const value = parsed.get(part.file);
    if (value === undefined) continue;
    if (part.whole) {
      // An object block may carry an editor's pointer; an array cannot.
      document[part.fields[0]!] = isObject(value) ? withoutSchemaPointer(value) : value;
      continue;
    }
    if (!isObject(value)) {
      problems.push({ file: part.file, message: `must be an object holding ${part.fields.map((f) => `"${f}"`).join(' and ')}` });
      continue;
    }
    for (const [field, inner] of Object.entries(withoutSchemaPointer(value))) {
      if (!part.fields.includes(field)) {
        problems.push({ file: part.file, message: `"${field}" is not written here. This part holds ${part.fields.map((f) => `"${f}"`).join(' and ')}` });
        continue;
      }
      document[field] = inner;
    }
  }

  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, document, origin };
}

/**
 * The part a validator issue points into, and the path inside that part.
 *
 * The validator's paths are dotted with numeric indexes
 * (`requiredSchema.tables.3.columns.2`); a person wants the file.
 */
export function locateIssue(origin: PartOrigin, issuePath: string): { file: string; path: string } {
  const segments = issuePath === '' ? [] : issuePath.split('.');
  const [head, second, third] = segments;
  if (head === 'requiredSchema') {
    if (second === 'tables' && third !== undefined && /^\d+$/.test(third)) {
      const file = origin.tables[Number(third)];
      if (file !== undefined) return { file, path: segments.slice(3).join('.') };
    }
    if (second === 'prefixed') return { file: APP_FILE, path: 'prefixed' };
    // The table list as a whole: none at all, or two with one ref.
    return { file: `${TABLES_DIR}/`, path: segments.slice(1).join('.') };
  }
  if (head === 'pages') {
    if (second !== undefined && /^\d+$/.test(second)) {
      const file = origin.pages[Number(second)];
      if (file !== undefined) return { file, path: segments.slice(2).join('.') };
    }
    return { file: `${PAGES_DIR}/`, path: segments.slice(1).join('.') };
  }
  const block = BLOCK_PARTS.find((part) => head !== undefined && part.fields.includes(head));
  if (block !== undefined) return { file: block.file, path: block.whole ? segments.slice(1).join('.') : issuePath };
  return { file: APP_FILE, path: issuePath };
}

/**
 * The reverse: one manifest document as part files. `composeManifest` of the
 * result is the document again, with its tables and pages in ref order.
 */
export function splitManifest(document: Record<string, unknown>): ManifestPartFile[] {
  const out: ManifestPartFile[] = [];
  const write = (path: string, value: unknown): void => {
    out.push({ path, text: `${JSON.stringify(value, null, 2)}\n` });
  };

  const app: Record<string, unknown> = {};
  for (const field of APP_FIELDS) {
    if (field !== 'prefixed' && field in document) app[field] = document[field];
  }
  const schema = isObject(document['requiredSchema']) ? document['requiredSchema'] : {};
  if ('prefixed' in schema) app['prefixed'] = schema['prefixed'];
  write(APP_FILE, app);

  const each = (dir: string, list: unknown): void => {
    for (const entry of Array.isArray(list) ? list : []) {
      const ref = isObject(entry) ? entry['ref'] : undefined;
      if (typeof ref === 'string') write(`${dir}/${ref}.json`, entry);
    }
  };
  each(TABLES_DIR, schema['tables']);
  each(PAGES_DIR, document['pages']);

  for (const part of BLOCK_PARTS) {
    if (part.whole) {
      const field = part.fields[0]!;
      if (field in document) write(part.file, document[field]);
      continue;
    }
    const held = Object.fromEntries(part.fields.filter((field) => field in document).map((field) => [field, document[field]]));
    if (Object.keys(held).length > 0) write(part.file, held);
  }
  return out;
}
