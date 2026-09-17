// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `pages/<slug>.json`: a stored page as a file any install can apply.
 *
 * A page file is the stored page document with what only one install knows
 * taken out:
 *
 * - no `id`: the file name is the page's name;
 * - databases by key: every `connectionId` becomes `database`, holding the
 *   key from `adminium.config.ts` (`source.database`, and a widget binding's
 *   `database`);
 * - storage destinations by name: `destinationId` becomes `destination`;
 * - `config.generatedHash` moves to `generated.hash`, re-expressed so it
 *   still says whether the page was edited by hand (below).
 *
 * Three more keys describe the row rather than the document: `origin`
 * (absent means `user`), `enabled` (absent means true) and `generated.key`.
 *
 * ── THE GENERATED HASH ──────────────────────────────────────────────────────
 * Regeneration overwrites a generated page only while its stored hash still
 * equals the hash of its document, and that hash covers the page id and
 * connection id, so it differs on every install. A file therefore carries the
 * hash of its portable document when the page was untouched, and any other
 * value (the stale stored one) when it was edited. Applying a file reverses
 * that: an untouched page gets the local document's hash, an edited one keeps
 * a value that cannot match.
 *
 * ── GENERATED IDS ───────────────────────────────────────────────────────────
 * A generated page's id is `page_<connection hash>_<slug>`, fixed when it was
 * first generated. A page renamed since then keeps its old id, and
 * `generated.key` records the part after the connection hash so another
 * install gives it the same one and regeneration still recognizes it.
 */

import { hashEnvelope, pageIdFor } from '@adminium/engine';
import {
  ConfigMigrationError,
  configMigrations,
  pageEnvelopeSchema,
  runConfigMigrations,
  type ConfigMigration,
} from '@adminium/engine/config';
import type { Page } from '@adminium/meta';

import { findInstanceIds } from './instance-ids.js';

/** Where the published JSON Schema sits, seen from `pages/`. */
export const PAGE_FILE_SCHEMA_REF = '../node_modules/@adminiumjs/adminium/schemas/page.json';

/** The origins a page file may have. Add-on and system pages belong to their installers. */
export const FILE_PAGE_ORIGINS = ['generated', 'user', 'llm'] as const;
export type FilePageOrigin = (typeof FILE_PAGE_ORIGINS)[number];

/** Keys that describe the file or the row, not the page document. */
const FILE_KEYS = ['$schema', 'origin', 'enabled', 'generated'] as const;

/** What an install knows that a file refers to by name. */
export interface ProjectRefs {
  /** Connection id → its key in `adminium.config.ts`; null for any other connection. */
  keyOf(connectionId: string): string | null;
  /** Key → connection id; null when the key is unknown or has no connection yet. */
  connectionOf(key: string): string | null;
  /** Storage destination id → name. */
  destinationName(id: string): string | null;
  /** Storage destination name → id. */
  destinationId(name: string): string | null;
}

export type ToPageFileResult = { ok: true; file: Record<string, unknown> } | { ok: false; reason: string };

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function joinPath(parts: readonly (string | number)[]): string {
  let out = '';
  for (const part of parts) {
    if (typeof part === 'number') out += `[${String(part)}]`;
    else out += out === '' ? part : `.${part}`;
  }
  return out;
}

class MappingProblem extends Error {}

/** The `page_<hash>_` part every generated page of this connection starts with. */
function generatedScope(connectionId: string): string {
  return pageIdFor(connectionId, 'x').slice(0, -1);
}

/** What `generated.key` must say for this page, or null when its id follows from its slug. */
function generatedKeyOf(page: Page): string | null {
  if (page.connectionId === null || page.id === pageIdFor(page.connectionId, page.slug)) return null;
  const scope = generatedScope(page.connectionId);
  return page.id.startsWith(scope) ? page.id.slice(scope.length) : null;
}

/** The stored document with install-specific values replaced by names. */
function toPortable(envelope: Record<string, unknown>, refs: ProjectRefs): Record<string, unknown> {
  const map = (node: unknown, parts: (string | number)[]): unknown => {
    if (Array.isArray(node)) return node.map((item, index) => map(item, [...parts, index]));
    const record = asObject(node);
    if (record === null) return node;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      if (parts.length === 0 && key === 'id') continue;
      if (parts.length === 1 && parts[0] === 'config' && key === 'generatedHash') continue;
      if (key === 'connectionId' && (value === null || typeof value === 'string')) {
        if ('database' in record) {
          throw new MappingProblem(`${joinPath([...parts, key])} sits next to a "database" key`);
        }
        if (value === null) {
          out['database'] = null;
          continue;
        }
        const database = refs.keyOf(value);
        if (database === null) {
          throw new MappingProblem(`${joinPath([...parts, key])} reads a database that is not in adminium.config.ts`);
        }
        out['database'] = database;
        continue;
      }
      if (key === 'destinationId' && typeof value === 'string') {
        // A destination that is gone falls back to the default one, which is
        // also what leaving the key out means.
        const name = refs.destinationName(value);
        if (name !== null) out['destination'] = name;
        continue;
      }
      out[key] = map(value, [...parts, key]);
    }
    return out;
  };
  return map(envelope, []) as Record<string, unknown>;
}

/** The file for a stored page, or why the page stays out of the project. */
export function toPageFile(page: Page, refs: ProjectRefs): ToPageFileResult {
  if (page.manifestId !== null || !(FILE_PAGE_ORIGINS as readonly string[]).includes(page.origin)) {
    return { ok: false, reason: 'it belongs to an installed add-on or app' };
  }
  const envelope = asObject(page.config);
  if (envelope === null || !pageEnvelopeSchema.safeParse(envelope).success) {
    return { ok: false, reason: 'its stored document is not a complete page' };
  }
  if (page.connectionId !== null && refs.keyOf(page.connectionId) === null) {
    return { ok: false, reason: 'its database is not in adminium.config.ts' };
  }

  let portable: Record<string, unknown>;
  try {
    portable = toPortable(envelope, refs);
  } catch (error) {
    if (error instanceof MappingProblem) return { ok: false, reason: error.message };
    throw error;
  }
  const clash = FILE_KEYS.find((key) => key in portable);
  if (clash !== undefined) {
    return { ok: false, reason: `its document has a "${clash}" key, which page files use for something else` };
  }

  const file: Record<string, unknown> = { $schema: PAGE_FILE_SCHEMA_REF, ...portable };
  const generated: Record<string, unknown> = {};
  const storedHash = asObject(envelope['config'])?.['generatedHash'];
  if (typeof storedHash === 'string') {
    generated['hash'] = hashEnvelope(envelope) === storedHash ? hashEnvelope(portable) : storedHash;
  }
  if (page.origin === 'generated') {
    const key = generatedKeyOf(page);
    if (key !== null) generated['key'] = key;
  }
  if (Object.keys(generated).length > 0) file['generated'] = generated;
  if (page.origin !== 'user') file['origin'] = page.origin;
  if (!page.isEnabled) file['enabled'] = false;
  return { ok: true, file };
}

/** A page file that passed every check, ready to apply. */
export interface PageFileDocument {
  slug: string;
  origin: FilePageOrigin;
  enabled: boolean;
  /** The database key the page belongs to, or null for a page with no data source. */
  database: string | null;
  generatedHash: string | null;
  generatedKey: string | null;
  /** The file without its file-only keys, exactly as written. */
  portable: Record<string, unknown>;
}

export type ReadPageFileResult =
  | { ok: true; doc: PageFileDocument }
  | { ok: false; problems: string[] };

/** Rename local keys in a validation path back to the ones the file uses. */
function filePath(parts: readonly PropertyKey[]): string {
  const renamed = parts.map((part) => {
    if (part === 'connectionId') return 'database';
    if (part === 'destinationId') return 'destination';
    return typeof part === 'symbol' ? String(part) : part;
  });
  return joinPath(renamed) || '(the file)';
}

/** The local document for a portable one: names resolved, `id` set. */
function toLocal(
  portable: Record<string, unknown>,
  id: string,
  refs: ProjectRefs,
): { envelope: Record<string, unknown>; warnings: string[] } {
  const warnings: string[] = [];
  const map = (node: unknown, parts: (string | number)[]): unknown => {
    if (Array.isArray(node)) return node.map((item, index) => map(item, [...parts, index]));
    const record = asObject(node);
    if (record === null) return node;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      if (key === 'database' && (value === null || typeof value === 'string')) {
        if (value === null) {
          out['connectionId'] = null;
          continue;
        }
        const connectionId = refs.connectionOf(value);
        if (connectionId === null) {
          throw new MappingProblem(
            `${joinPath([...parts, key])}: "${value}" is not a database in adminium.config.ts, or it has no connection yet`,
          );
        }
        out['connectionId'] = connectionId;
        continue;
      }
      if (key === 'destination' && typeof value === 'string') {
        const destinationId = refs.destinationId(value);
        if (destinationId === null) {
          warnings.push(`${joinPath([...parts, key])}: there is no storage destination "${value}"; the default one is used`);
        } else {
          out['destinationId'] = destinationId;
        }
        continue;
      }
      out[key] = map(value, [...parts, key]);
    }
    return out;
  };
  const envelope = { ...(map(portable, []) as Record<string, unknown>), id };
  return { envelope, warnings };
}

function upgrade(
  envelope: Record<string, unknown>,
  migrations: readonly ConfigMigration[],
): Record<string, unknown> {
  return typeof envelope['v'] === 'number' ? runConfigMigrations(envelope, migrations) : envelope;
}

/**
 * Check a parsed page file: its own keys, instance ids, the database keys it
 * names, and the page document itself (upgraded to this version first, and
 * validated by the same schema the server writes with).
 */
export function readPageFile(
  value: unknown,
  slug: string,
  refs: ProjectRefs,
  opts: { migrations?: readonly ConfigMigration[] } = {},
): ReadPageFileResult {
  const file = asObject(value);
  if (file === null) return { ok: false, problems: ['(the file): must be a JSON object'] };
  const problems: string[] = [];

  const schemaRef = file['$schema'];
  if (schemaRef !== undefined && typeof schemaRef !== 'string') problems.push('$schema: must be a string');
  const origin = file['origin'] ?? 'user';
  if (typeof origin !== 'string' || !(FILE_PAGE_ORIGINS as readonly string[]).includes(origin)) {
    problems.push(`origin: must be one of ${FILE_PAGE_ORIGINS.join(', ')}`);
  }
  const enabled = file['enabled'] ?? true;
  if (typeof enabled !== 'boolean') problems.push('enabled: must be true or false');

  let generatedHash: string | null = null;
  let generatedKey: string | null = null;
  if (file['generated'] !== undefined) {
    const generated = asObject(file['generated']);
    if (generated === null) {
      problems.push('generated: must be an object');
    } else {
      for (const key of Object.keys(generated)) {
        if (key !== 'hash' && key !== 'key') problems.push(`generated.${key}: is not a known key`);
      }
      const hash = generated['hash'];
      if (hash !== undefined) {
        if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) {
          problems.push('generated.hash: must be a 64-character hex hash');
        } else {
          generatedHash = hash;
        }
      }
      const key = generated['key'];
      if (key !== undefined) {
        if (typeof key !== 'string' || !/^[a-z0-9-]{1,22}$/.test(key)) {
          problems.push('generated.key: must be up to 22 lowercase letters, digits or "-"');
        } else if (origin !== 'generated') {
          problems.push('generated.key: only a generated page has one');
        } else {
          generatedKey = key;
        }
      }
    }
  }

  const portable: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(file)) {
    if (!(FILE_KEYS as readonly string[]).includes(key)) portable[key] = child;
  }
  if ('id' in portable) problems.push('id: remove it; a page file is known by its file name');
  for (const finding of findInstanceIds(portable)) problems.push(`${finding.path}: ${finding.message}`);

  const nav = asObject(portable['nav']);
  if (nav !== null && nav['slug'] !== undefined && nav['slug'] !== slug) {
    problems.push(`nav.slug: must be "${slug}", the file name`);
  }
  const source = asObject(portable['source']);
  const database = source?.['database'];
  if (source !== null && database !== null && typeof database !== 'string') {
    problems.push('source.database: must be a database key from adminium.config.ts, or null');
  }
  if (problems.length > 0) return { ok: false, problems };

  let local: Record<string, unknown>;
  try {
    local = upgrade(toLocal(portable, `page_${slug.replaceAll('-', '_')}`, refs).envelope, opts.migrations ?? configMigrations);
  } catch (error) {
    if (error instanceof MappingProblem || error instanceof ConfigMigrationError) {
      return { ok: false, problems: [error.message] };
    }
    throw error;
  }
  const parsed = pageEnvelopeSchema.safeParse(local);
  if (!parsed.success) {
    return {
      ok: false,
      problems: parsed.error.issues.slice(0, 10).map((issue) => `${filePath(issue.path)}: ${issue.message}`),
    };
  }

  return {
    ok: true,
    doc: {
      slug,
      origin: origin as FilePageOrigin,
      enabled: enabled as boolean,
      database: typeof database === 'string' ? database : null,
      generatedHash,
      generatedKey,
      portable,
    },
  };
}

/** A page file ready to store under a given id. */
export interface LocalPage {
  envelope: Record<string, unknown>;
  type: string;
  title: string;
  icon: string | null;
  navGroup: string | null;
  navOrder: number;
  warnings: string[];
}

/** The id a page from this file gets when no page of that name exists yet. */
export function newPageIdFor(doc: PageFileDocument, connectionId: string | null, mint: () => string): string {
  if (doc.origin !== 'generated') return mint();
  if (connectionId === null) return pageIdFor(null, doc.slug);
  return doc.generatedKey === null
    ? pageIdFor(connectionId, doc.slug)
    : `${generatedScope(connectionId)}${doc.generatedKey}`;
}

/** The document and row columns to store for a checked page file. */
export function toLocalPage(
  doc: PageFileDocument,
  id: string,
  refs: ProjectRefs,
  opts: { migrations?: readonly ConfigMigration[] } = {},
): LocalPage {
  const { envelope: mapped, warnings } = toLocal(doc.portable, id, refs);
  const envelope = upgrade(mapped, opts.migrations ?? configMigrations);
  if (doc.generatedHash !== null) {
    const untouched = hashEnvelope(doc.portable) === doc.generatedHash;
    const body = asObject(envelope['config']) ?? {};
    envelope['config'] = { ...body, generatedHash: untouched ? hashEnvelope(envelope) : doc.generatedHash };
  }
  const nav = asObject(envelope['nav']) ?? {};
  const title = asObject(envelope['title']) ?? {};
  return {
    envelope,
    type: String(envelope['template']),
    title: String(title['fallback']),
    icon: typeof nav['icon'] === 'string' ? nav['icon'] : null,
    navGroup: nav['hidden'] === true ? null : typeof nav['group'] === 'string' ? nav['group'] : null,
    navOrder: typeof nav['order'] === 'number' ? nav['order'] : 0,
    warnings,
  };
}
