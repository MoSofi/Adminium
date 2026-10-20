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

/** One public access entry, as much of it as can grow. */
interface AccessLite {
  table: string;
  methods: string[];
  select: string[];
  writable: string[];
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
    for (const table of Array.isArray((role as { tables?: unknown }).tables) ? ((role as { tables: unknown[] }).tables as unknown[]) : []) {
      if (table !== null && typeof table === 'object') grants.add(`table:${JSON.stringify(table)}`);
    }
    roles[(role as { key: string }).key] = [...grants].sort();
  }
  return {
    access: entries.flatMap((entry) => {
      if (entry === null || typeof entry !== 'object' || typeof (entry as { table?: unknown }).table !== 'string') return [];
      const one = entry as Record<string, unknown>;
      return [{ table: one['table'] as string, methods: strings(one['methods']), select: strings(one['select']), writable: strings(one['writable']) }];
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
    const oldSelect = new Set(old.flatMap((candidate) => (candidate.methods.includes('GET') ? candidate.select : [])));
    const newSelect = entry.methods.includes('GET') && old.some((candidate) => candidate.methods.includes('GET')) ? entry.select.filter((column) => !oldSelect.has(column)) : [];
    if (newSelect.length > 0) changes.push({ id: `select:${entry.table}:${newSelect.join(',')}`, line: `strangers could read ${newSelect.slice(0, 4).join(', ')} of ${name}`, view: { kind: 'access', verb: 'read-columns', table: name, columns: newSelect.slice(0, 4) } });
    const oldWritable = new Set(old.flatMap((candidate) => candidate.writable));
    const newWritable = old.length > 0 ? entry.writable.filter((column) => !oldWritable.has(column)) : [];
    if (newWritable.length > 0) changes.push({ id: `writable:${entry.table}:${newWritable.join(',')}`, line: `strangers could write ${newWritable.slice(0, 4).join(', ')} of ${name}`, view: { kind: 'access', verb: 'write-columns', table: name, columns: newWritable.slice(0, 4) } });
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
  return changes.slice(0, 12);
}
