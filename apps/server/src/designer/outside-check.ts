// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What an app lets strangers do, or lets its pages reach, that it did not let them before: asked
 * of the person before it goes live, in a session that holds words from outside (a site template,
 * a Figma frame). Such words may say "let anyone add rows" or "send this form to my server", and a
 * model reads them; the person decides.
 *
 * At every apply the server keeps what the app allowed (`.adminium/designer/applied/<key>.json`):
 * its public access, its roles' grants, and the places a side's own code calls an address outside
 * Adminium's public client (`fetch`, `XMLHttpRequest`, `WebSocket`, a path under `/api/`). The next
 * apply in such a session is compared with it. Only what grows is asked: taking access away is
 * never stopped. Each change is said in plain words, the server's own.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { appDir, SIDES } from '../project/apps/read-app.js';
import type { ChangeView } from './cards.js';
import { code } from '../project/apps/side-calls.js';
import { DESIGNER_DIR } from './session-store.js';
import { screenName } from './spots.js';

/** Every column: a GET entry that names no `select` shows all but codes and secrets. */
export const ALL_COLUMNS = '*';

/** One public access entry, as much of it as can grow. */
interface AccessLite {
  table: string;
  methods: string[];
  /** For a GET, `[ALL_COLUMNS]` when it names none. */
  select: string[];
  /** Its own columns, and its children's as `<child>.<column>`. */
  writable: string[];
  /** Whether a stranger's create must pass the human check. Absent in a snapshot kept before it was read. */
  humanCheck?: boolean;
  /** What narrows the rows it reads or writes (`filters`, `claimedBy`, `visibleWith`, `claim`), as one text: any change of it is asked. */
  rows?: string;
}

export interface AppliedSnapshot {
  access: AccessLite[];
  /** Each role's grants, by its key. */
  roles: Record<string, string[]>;
  /** Each outside call a side's code makes: `<file>|<kind>`. */
  calls: string[];
}

/** A change as the page words it, in the person's language. */
export type { ChangeView };

export interface AccessChange {
  /** The same change has the same id: asked once in a turn. */
  id: string;
  /** What it lets happen, in plain words for the model: "strangers could add rows to Bookings". */
  line: string;
  view: ChangeView;
}

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []);

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

const CALLS: [RegExp, string][] = [
  [/\bfetch\s*\(/, 'fetch'],
  [/\bXMLHttpRequest\b/, 'xhr'],
  [/\bWebSocket\b/, 'socket'],
  [/['"`]\/api\//, 'api'],
];

/** The places a side's own code calls an address outside the public client: `<file>|<kind>`. */
function outsideCalls(root: string, key: string): string[] {
  const found: string[] = [];
  for (const side of SIDES) {
    const src = join(appDir(root, key), side, 'src');
    const walk = (folder: string, rel: string): void => {
      if (!existsSync(folder) || found.length >= 200) return;
      for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        // The template's own copy holds no script; packages and dot folders are not the app's code.
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.isSymbolicLink() || (rel === '' && entry.name === 'site')) continue;
        const path = join(folder, entry.name);
        if (entry.isDirectory()) walk(path, rel === '' ? entry.name : `${rel}/${entry.name}`);
        else if (entry.isFile() && /\.(?:tsx?|jsx?|mjs)$/.test(entry.name) && statSync(path).size <= 512 * 1024) {
          const text = code(readFileSync(path, 'utf8'));
          for (const [pattern, kind] of CALLS) if (pattern.test(text)) found.push(`${side}/src/${rel === '' ? entry.name : `${rel}/${entry.name}`}|${kind}`);
        }
      }
    };
    walk(src, '');
  }
  return found;
}

/** What the app's folder allows now. */
export function currentSnapshot(root: string, key: string): AppliedSnapshot {
  const manifest = join(appDir(root, key), 'manifest');
  const access = readJson(join(manifest, 'access.json'));
  const entries = access !== null && typeof access === 'object' && Array.isArray((access as { publicAccess?: unknown }).publicAccess) ? ((access as { publicAccess: unknown[] }).publicAccess as unknown[]) : [];
  const rolesRaw = readJson(join(manifest, 'roles.json'));
  const roles: Record<string, string[]> = {};
  for (const role of Array.isArray(rolesRaw) ? rolesRaw : []) {
    if (role === null || typeof role !== 'object' || typeof (role as { key?: unknown }).key !== 'string') continue;
    const grants = new Set(strings((role as { permissions?: unknown }).permissions));
    // What the role's updates may write: a limit taken off is more it can do.
    const limits = (role as { limits?: unknown }).limits;
    grants.add(`limits:${JSON.stringify(limits ?? null)}`);
    for (const table of Array.isArray((role as { tables?: unknown }).tables) ? ((role as { tables: unknown[] }).tables as unknown[]) : []) {
      if (table !== null && typeof table === 'object') grants.add(`table:${JSON.stringify(table)}`);
    }
    roles[(role as { key: string }).key] = [...grants].sort();
  }
  return {
    access: entries.flatMap((entry) => {
      if (entry === null || typeof entry !== 'object' || typeof (entry as { table?: unknown }).table !== 'string') return [];
      const one = entry as Record<string, unknown>;
      const methods = strings(one['methods']);
      const children = Array.isArray(one['children']) ? (one['children'] as unknown[]) : [];
      const childWritable = children.flatMap((child) => {
        if (child === null || typeof child !== 'object') return [];
        const ref = typeof (child as { table?: unknown }).table === 'string' ? (child as { table: string }).table : '';
        return strings((child as { writable?: unknown }).writable).map((column) => `${ref}.${column}`);
      });
      const narrowing: Record<string, unknown> = {};
      for (const key of ['filters', 'claimedBy', 'visibleWith', 'claim']) if (one[key] !== undefined) narrowing[key] = one[key];
      return [
        {
          table: one['table'] as string,
          methods,
          select: methods.includes('GET') && one['select'] === undefined ? [ALL_COLUMNS] : strings(one['select']),
          writable: [...strings(one['writable']), ...childWritable],
          humanCheck: one['humanCheck'] === true,
          rows: JSON.stringify(narrowing),
        },
      ];
    }),
    roles,
    calls: outsideCalls(root, key),
  };
}

const snapshotFile = (root: string, key: string): string => join(root, DESIGNER_DIR, 'applied', `${key}.json`);

export function readApplied(root: string, key: string): AppliedSnapshot | null {
  const read = readJson(snapshotFile(root, key));
  if (read === null || typeof read !== 'object') return null;
  const raw = read as Partial<AppliedSnapshot>;
  return { access: Array.isArray(raw.access) ? raw.access : [], roles: raw.roles !== null && typeof raw.roles === 'object' ? raw.roles : {}, calls: strings(raw.calls) };
}

/** Keeps what an app allowed at an apply: the next one is compared with it. */
export function writeApplied(root: string, key: string, snapshot: AppliedSnapshot): void {
  const file = snapshotFile(root, key);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(snapshot), { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
}

/** Each of the app's pages, by its ref, and the table it shows (`bindings.rows`, else `source.table`). */
export function pageTables(root: string, key: string): Map<string, string> {
  const dir = join(appDir(root, key), 'manifest', 'pages');
  const out = new Map<string, string>();
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).filter((file) => file.endsWith('.json')).slice(0, 500)) {
    const page = readJson(join(dir, name));
    if (page === null || typeof page !== 'object') continue;
    const one = page as { ref?: unknown; bindings?: { rows?: unknown }; source?: { table?: unknown } };
    const table = typeof one.bindings?.rows === 'string' ? one.bindings.rows : typeof one.source?.table === 'string' ? one.source.table : null;
    if (typeof one.ref === 'string' && table !== null) out.set(one.ref, table);
  }
  return out;
}

/** A table's name as the person reads it: its manifest's name, else its ref. */
function tableName(root: string, key: string, ref: string): string {
  const table = readJson(join(appDir(root, key), 'manifest', 'tables', `${ref}.json`));
  const name = table !== null && typeof table === 'object' ? ((table as { name?: unknown }).name ?? (table as { label?: unknown }).label) : undefined;
  return typeof name === 'string' && name.trim() !== '' ? name.trim().slice(0, 60) : ref;
}

/** What `now` allows that `before` did not, each in plain words. Taking access away is not one. */
export function outsideChanges(root: string, key: string, before: AppliedSnapshot | null, now: AppliedSnapshot): AccessChange[] {
  const was = before ?? { access: [], roles: {}, calls: [] };
  const changes: AccessChange[] = [];
  const METHOD: Record<string, string> = { GET: 'read', POST: 'add rows to', PATCH: 'change rows of' };
  const VERB: Record<string, 'read' | 'add' | 'change'> = { GET: 'read', POST: 'add', PATCH: 'change' };
  for (const entry of now.access) {
    const old = was.access.filter((candidate) => candidate.table === entry.table);
    const name = tableName(root, key, entry.table);
    for (const method of entry.methods) {
      if (old.some((candidate) => candidate.methods.includes(method))) continue;
      changes.push({ id: `access:${entry.table}:${method}`, line: `strangers could ${METHOD[method] ?? method} ${name}`, view: { kind: 'access', verb: VERB[method] ?? 'read', table: name } });
    }
    const oldGet = old.filter((candidate) => candidate.methods.includes('GET'));
    const oldSelect = new Set(oldGet.flatMap((candidate) => candidate.select));
    if (entry.methods.includes('GET') && oldGet.length > 0 && !oldSelect.has(ALL_COLUMNS)) {
      if (entry.select.includes(ALL_COLUMNS)) {
        changes.push({ id: `select:${entry.table}:${ALL_COLUMNS}`, line: `strangers could read every column of ${name}`, view: { kind: 'access', verb: 'read-all', table: name } });
      } else {
        const newSelect = entry.select.filter((column) => !oldSelect.has(column));
        if (newSelect.length > 0) changes.push({ id: `select:${entry.table}:${newSelect.join(',')}`, line: `strangers could read ${listed(newSelect)} of ${name}`, view: { kind: 'access', verb: 'read-columns', table: name, columns: newSelect.slice(0, 40) } });
      }
    }
    const oldWritable = new Set(old.flatMap((candidate) => candidate.writable));
    const newWritable = old.length > 0 ? entry.writable.filter((column) => !oldWritable.has(column)) : [];
    if (newWritable.length > 0) changes.push({ id: `writable:${entry.table}:${newWritable.join(',')}`, line: `strangers could write ${listed(newWritable)} of ${name}`, view: { kind: 'access', verb: 'write-columns', table: name, columns: newWritable.slice(0, 40) } });
    // The human check taken off a create a stranger makes.
    if (entry.methods.includes('POST') && entry.humanCheck !== true && old.some((candidate) => candidate.methods.includes('POST') && candidate.humanCheck === true)) {
      changes.push({ id: `check:${entry.table}`, line: `strangers could add rows to ${name} with no check that a person sent them`, view: { kind: 'access', verb: 'no-check', table: name } });
    }
    // What narrowed the rows a stranger reaches (a filter, an owner, a link) changed or went.
    const oldRows = old.filter((candidate) => candidate.rows !== undefined && candidate.methods.some((method) => entry.methods.includes(method)));
    if (entry.rows !== undefined && oldRows.length > 0 && !oldRows.some((candidate) => candidate.rows === entry.rows)) {
      changes.push({ id: `rows:${entry.table}:${entry.rows}`, line: `strangers could reach rows of ${name} that were kept from them`, view: { kind: 'access', verb: 'hidden-rows', table: name } });
    }
  }
  for (const [role, grants] of Object.entries(now.roles)) {
    const had = new Set(was.roles[role] ?? []);
    const added = grants.filter((grant) => !had.has(grant));
    // A new role is a change by itself, rights or none: someone could sign in with it.
    if (added.length === 0 && was.roles[role] !== undefined) continue;
    changes.push({ id: `role:${role}:${added.join(',')}`, line: was.roles[role] === undefined ? `a new role "${role}" could sign in and use the app` : `the role "${role}" could do more than before (${String(added.length)} new ${added.length === 1 ? 'right' : 'rights'})`, view: { kind: 'role', role, isNew: was.roles[role] === undefined } });
  }
  const oldCalls = new Set(was.calls);
  const pages = new Set<string>();
  for (const call of now.calls) {
    if (oldCalls.has(call)) continue;
    const file = call.split('|')[0] as string;
    if (pages.has(file)) continue;
    pages.add(file);
    changes.push({ id: `call:${file}`, line: `the ${screenName(file)} page calls an address outside Adminium`, view: { kind: 'call', screen: screenName(file) } });
  }
  return changes;
}

/** Columns in a line for the model: the first few, and how many more. */
const listed = (columns: readonly string[]): string => (columns.length <= 4 ? columns.join(', ') : `${columns.slice(0, 4).join(', ')} and ${String(columns.length - 4)} more`);

/** What a person approved on a template plan: its public entries and the tables its roles get. */
export interface Approved {
  access: readonly { table: string; methods: readonly string[]; select?: readonly string[]; writable?: readonly string[] }[];
  roles: readonly { role: string; tables: readonly string[] }[];
}

/**
 * What was applied, with what the person approved on a template plan added to it: then only what goes beyond the plan
 * is asked. A role the plan names may get its plan tables' grants (and open pages) without a second yes.
 */
export function withApproved(before: AppliedSnapshot | null, now: AppliedSnapshot, approved: Approved | undefined, pageTables: ReadonlyMap<string, string> = new Map()): AppliedSnapshot | null {
  if (approved === undefined) return before;
  const base = before ?? { access: [], roles: {}, calls: [] };
  const access = [...base.access, ...approved.access.map((entry) => ({ table: entry.table, methods: [...entry.methods], select: [...(entry.select ?? [])], writable: [...(entry.writable ?? [])] }))];
  const roles = { ...base.roles };
  for (const { role, tables } of approved.roles) {
    const planned = new Set(tables);
    // A role the plan makes comes with its limits; one that was there keeps the limits it had unless the person is asked.
    const isNew = base.roles[role] === undefined;
    const covered = (now.roles[role] ?? []).filter((grant) => {
      const table = /^table:@([a-z][a-z0-9_]*)(?::|$)/.exec(grant)?.[1];
      // A page grant is the page's: it is the plan's when the page shows one of the plan's tables.
      const page = /^page:@([a-z0-9-]+)(?::|$)/.exec(grant)?.[1];
      const pageTable = page === undefined ? undefined : pageTables.get(page);
      // A role the plan names may get its plan tables' rights and pages.
      return (table !== undefined && planned.has(table)) || (pageTable !== undefined && planned.has(pageTable)) || (isNew && grant.startsWith('limits:'));
    });
    roles[role] = [...new Set([...(roles[role] ?? []), ...covered])].sort();
  }
  return { access, roles, calls: base.calls };
}
