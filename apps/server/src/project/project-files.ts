// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The two sides a project sync compares, both as project files:
 *
 * - what the database says (`exportProjectFiles`): every page of a project
 *   database (or with no database) and every project database's schema
 *   customizations, written the way `toPageFile` / `toSchemaFile` write them;
 * - what the folder says (`readProjectFiles`): each file parsed and checked.
 *
 * Both are compared by `fileHash`, which ignores what does not change a
 * file's meaning: key order, formatting, `$schema`, and values that only
 * restate a default (`"origin": "user"`, `"enabled": true`, `"status":
 * "active"`, a `generated.key` the slug already implies). A file written by
 * hand therefore matches the same content written by Adminium.
 */

import { pageIdFor } from '@adminium/engine';
import {
  overridesRepo,
  pagesRepo,
  PROJECT_FILE_DELETED,
  type MetaDb,
  type ProjectOverrideInput,
} from '@adminium/meta';

import { contentHash, parseJsonText, stableStringify } from './json.js';
import { readPageFile, toPageFile, type PageFileDocument, type ProjectRefs } from './page-files.js';
import { pagePath, parseProjectPath, schemaPath } from './paths.js';
import type { ProjectFileStore } from './file-store.js';
import { readSchemaFile, toSchemaFile } from './schema-files.js';

/** The hash of a side that has no file (or no page) for a path; stored as is. */
export const ABSENT = PROJECT_FILE_DELETED;

export interface InstallRefs extends ProjectRefs {
  /** Project key → connection id, for keys that have a connection. */
  readonly connections: ReadonlyMap<string, string>;
}

/** What this install knows about project keys and storage destinations. */
export async function loadInstallRefs(meta: MetaDb): Promise<InstallRefs> {
  const [connections, destinations] = await Promise.all([
    meta.db
      .selectFrom('adminium_connections')
      .select(['id', 'projectKey'])
      .where('projectKey', 'is not', null)
      .execute(),
    meta.db.selectFrom('adminium_storage_destinations').select(['id', 'name']).execute(),
  ]);
  const byKey = new Map<string, string>();
  const byId = new Map<string, string>();
  for (const row of connections) {
    if (row.projectKey === null) continue;
    byKey.set(row.projectKey, row.id);
    byId.set(row.id, row.projectKey);
  }
  const nameById = new Map(destinations.map((row) => [row.id, row.name]));
  const idByName = new Map(destinations.map((row) => [row.name, row.id]));
  return {
    connections: byKey,
    keyOf: (connectionId) => byId.get(connectionId) ?? null,
    connectionOf: (key) => byKey.get(key) ?? null,
    destinationName: (id) => nameById.get(id) ?? null,
    destinationId: (name) => idByName.get(name) ?? null,
  };
}

/** References for checking files with no database: every configured key resolves. */
export function offlineRefs(keys: readonly string[]): ProjectRefs {
  const known = new Set(keys);
  return {
    keyOf: (connectionId) => (connectionId.startsWith('conn_') && known.has(connectionId.slice(5)) ? connectionId.slice(5) : null),
    connectionOf: (key) => (known.has(key) ? `conn_${key}` : null),
    destinationName: () => null,
    // Destinations live in the database, so an offline check cannot know them.
    destinationId: (name) => `dest_${name}`,
  };
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** The `generated.key` a slug implies: the part of its page id after the connection hash. */
function impliedGeneratedKey(slug: string): string {
  const id = pageIdFor('x', slug);
  return id.slice(id.indexOf('_', 'page_'.length) + 1);
}

/** A file's content with default-restating values removed, for hashing. */
export function normalizeForHash(projectPath: string, value: unknown): unknown {
  const kind = parseProjectPath(projectPath);
  const file = asObject(value);
  if (kind === null || file === null) return value;
  const out: Record<string, unknown> = { ...file };
  delete out['$schema'];
  if (kind.kind === 'schema') {
    if (Array.isArray(out['overrides'])) {
      const rows = (out['overrides'] as unknown[]).map((item) => {
        const row = asObject(item);
        if (row === null) return item;
        const copy = { ...row };
        if (copy['origin'] === 'user') delete copy['origin'];
        if (copy['status'] === 'active') delete copy['status'];
        return copy;
      });
      const key = (item: unknown): string => {
        const row = asObject(item) ?? {};
        return JSON.stringify([row['table'], row['column'] ?? '', row['op'], row['origin'] ?? 'user']);
      };
      out['overrides'] = rows.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
    }
    return out;
  }
  if (out['origin'] === 'user') delete out['origin'];
  if (out['enabled'] === true) delete out['enabled'];
  const generated = asObject(out['generated']);
  if (generated !== null) {
    const copy = { ...generated };
    // The key a slug already implies is the same as no key at all.
    if (typeof copy['key'] === 'string' && impliedGeneratedKey(kind.slug) === copy['key']) {
      delete copy['key'];
    }
    if (Object.keys(copy).length === 0) delete out['generated'];
    else out['generated'] = copy;
  }
  return out;
}

/** The hash two copies of a file are compared by. */
export function fileHash(projectPath: string, value: unknown): string {
  return contentHash(normalizeForHash(projectPath, value));
}

export interface DatabaseFile {
  value: Record<string, unknown>;
  hash: string;
  /** The page this file describes, for page files. */
  pageId: string | null;
}

/** A page the database has that no project file can hold, and why. */
export interface OutsidePage {
  pageId: string;
  slug: string;
  connectionId: string | null;
  reason: string;
}

export interface DatabaseSide {
  files: Map<string, DatabaseFile>;
  outside: OutsidePage[];
}

/** Every project file the database implies, and the pages left out. */
export async function exportProjectFiles(meta: MetaDb, refs: InstallRefs): Promise<DatabaseSide> {
  const files = new Map<string, DatabaseFile>();
  const outside: OutsidePage[] = [];

  // Pages of project databases come first, in the order of their keys, so
  // when two databases generate the same slug the same one always wins.
  const keys = [...refs.connections.keys()].sort();
  const rank = (connectionId: string | null): number => {
    if (connectionId === null) return keys.length;
    const key = refs.keyOf(connectionId);
    return key === null ? keys.length + 1 : keys.indexOf(key);
  };
  const pages = (await pagesRepo(meta).listDocuments()).sort(
    (a, b) => rank(a.connectionId) - rank(b.connectionId),
  );
  for (const page of pages) {
    const result = toPageFile(page, refs);
    if (!result.ok) {
      if (page.manifestId === null && (page.origin === 'generated' || page.origin === 'user' || page.origin === 'llm')) {
        outside.push({ pageId: page.id, slug: page.slug, connectionId: page.connectionId, reason: result.reason });
      }
      continue;
    }
    const path = pagePath(page.slug);
    if (files.has(path)) {
      outside.push({
        pageId: page.id,
        slug: page.slug,
        connectionId: page.connectionId,
        reason: `another page already uses the address "${page.slug}"`,
      });
      continue;
    }
    files.set(path, { value: result.file, hash: fileHash(path, result.file), pageId: page.id });
  }

  const overrides = overridesRepo(meta);
  for (const key of keys) {
    const connectionId = refs.connectionOf(key);
    if (connectionId === null) continue;
    const path = schemaPath(key);
    const value = toSchemaFile(await overrides.listForConnection(connectionId));
    files.set(path, { value, hash: fileHash(path, value), pageId: null });
  }
  return { files, outside };
}

export type FolderFile =
  | { path: string; hash: string; valid: true; kind: 'page'; doc: PageFileDocument }
  | { path: string; hash: string; valid: true; kind: 'schema'; key: string; rows: ProjectOverrideInput[] }
  | { path: string; hash: string; valid: false; problems: string[] };

/** Parse and check one file's text. Invalid files hash their raw text, so an edit still shows. */
export function checkProjectFile(projectPath: string, text: string, refs: ProjectRefs): FolderFile {
  const kind = parseProjectPath(projectPath);
  const rawHash = (): string => contentHash(text);
  if (kind === null) return { path: projectPath, hash: rawHash(), valid: false, problems: ['not a page or schema file'] };
  if (!kind.valid) {
    const problem =
      kind.kind === 'page'
        ? 'the file name must be a page address: lowercase letters, digits and "-", at most 31 characters'
        : 'the file name must be a database key from adminium.config.ts';
    return { path: projectPath, hash: rawHash(), valid: false, problems: [problem] };
  }
  const parsed = parseJsonText(text);
  if (!parsed.ok) return { path: projectPath, hash: rawHash(), valid: false, problems: [`not valid JSON: ${parsed.message}`] };
  if (kind.kind === 'page') {
    const result = readPageFile(parsed.value, kind.slug, refs);
    return result.ok
      ? { path: projectPath, hash: fileHash(projectPath, parsed.value), valid: true, kind: 'page', doc: result.doc }
      : { path: projectPath, hash: rawHash(), valid: false, problems: result.problems };
  }
  if (refs.connectionOf(kind.key) === null) {
    return {
      path: projectPath,
      hash: rawHash(),
      valid: false,
      problems: [`"${kind.key}" is not a database in adminium.config.ts, or it has no connection yet`],
    };
  }
  const result = readSchemaFile(parsed.value);
  return result.ok
    ? { path: projectPath, hash: fileHash(projectPath, parsed.value), valid: true, kind: 'schema', key: kind.key, rows: result.rows }
    : { path: projectPath, hash: rawHash(), valid: false, problems: result.problems };
}

/** Every file in the folder, parsed and checked. */
export async function readProjectFiles(store: ProjectFileStore, refs: ProjectRefs): Promise<Map<string, FolderFile>> {
  const out = new Map<string, FolderFile>();
  for (const path of await store.list()) {
    const text = await store.read(path);
    if (text !== null) out.set(path, checkProjectFile(path, text, refs));
  }
  return out;
}

/** The text a database file is written with. */
export function fileText(file: DatabaseFile): string {
  return stableStringify(file.value);
}

/** The database keys the folder's page files name, read leniently. */
export async function databasesWithPageFiles(store: ProjectFileStore): Promise<Set<string>> {
  const keys = new Set<string>();
  for (const path of await store.list()) {
    if (parseProjectPath(path)?.kind !== 'page') continue;
    const text = await store.read(path);
    const parsed = text === null ? null : parseJsonText(text);
    if (parsed === null || !parsed.ok) continue;
    const database = asObject(asObject(parsed.value)?.['source'])?.['database'];
    if (typeof database === 'string') keys.add(database);
  }
  return keys;
}
