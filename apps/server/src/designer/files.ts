// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The files of an app a person may read and change by hand.
 *
 * The list is made here, by the server, each time it is asked for, and it is
 * the only door: a path is read or saved only if it is on the list made at
 * that moment, compared as a string. So a hand save can neither make a file
 * nor name one the list does not hold, however the path is spelt.
 *
 * What is on it: each side's own source under `src/`, the staff side's
 * `nav.json`, the dashboard pages, and three files of settings. What is not:
 * tables, roles, access, seeds, tests, assets, server code, the stylesheets
 * the engine rewrites, and the starter's own entry files. A copy of a
 * published app is built by its authors' build, so its sides are left out.
 *
 * A file's name can end up in what the Designer's model is told (the next
 * turn is told which files a person changed), so a file is listed only when
 * every part of its path is made of plain marks: no space, no quote, no line
 * end, nothing a sentence could hide in.
 */
import { webcrypto } from 'node:crypto';
import { lstatSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { hasOwnBuild } from '../project/apps/own-build.js';
import { APPS_DIR, MANIFEST_PARTS_DIR } from '../project/apps/read-app.js';
import { createJail, MAX_WRITE_BYTES, type Jail } from './jail.js';
import { noCardRefusal } from './write-guard.js';

/** Every part of a listed path: letters, digits and a few marks a file name is written with. */
export const FILE_PART = /^[A-Za-z0-9._@()[\]-]+$/;
/** The most files a list holds, and the most one save carries. */
export const FILES_LISTED_MAX = 400;
export const FILES_SAVED_MAX = 40;
/** A save's whole body: forty files of a few dozen kilobytes each, and room to spare. */
export const FILES_SAVE_BODY_BYTES = 3 * 1024 * 1024;

export type FileGroupKey = 'customer' | 'staff' | 'dashboard' | 'settings';
const GROUP_ORDER: readonly FileGroupKey[] = ['customer', 'staff', 'dashboard', 'settings'];

export interface EditableFile {
  /** Project-relative, as the jail spells it. */
  path: string;
  /** What the list shows: the path a person thinks of, shorter than the real one. */
  label: string;
  group: FileGroupKey;
  /** The sha256 of the file's bytes, hex. */
  hash: string;
  size: number;
  /** Whether the bytes are text: valid UTF-8 with no NUL. A file that is not is on no list a page sees. */
  text: boolean;
  /** What the file is, where its name does not say: the design brief. */
  note?: 'brief';
}

/** A side's source files a person edits. */
const SOURCE_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.css', '.json', '.md'] as const;
/** In a side's `src/`: the stylesheets the engine rewrites, and the starter's own entry files. */
const NOT_A_PERSONS = new Set(['theme.css', 'fonts.css', 'style.css', 'main.tsx', 'app.css']);

const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot).toLowerCase();
};

/** The sha256 of some bytes, hex. Worked out off the event loop. */
export async function hashOf(bytes: Uint8Array): Promise<string> {
  return Buffer.from(await webcrypto.subtle.digest('SHA-256', bytes)).toString('hex');
}

/** Whether bytes are text: valid UTF-8, and no NUL. */
export function isText(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/** The source files under a side's `src/`, as paths inside it; folders in name order, never a link, a dot-name or node_modules. */
function sourcesUnder(dir: string, rel = ''): string[] {
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    const { name } = entry;
    if (name.startsWith('.') || name.toLowerCase() === 'node_modules' || entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) out.push(...sourcesUnder(join(dir, name), `${rel}${name}/`));
    else if (entry.isFile() && (SOURCE_EXTENSIONS as readonly string[]).includes(extensionOf(name))) {
      // The engine's and the starter's own sit at the top of src/ and nowhere else.
      if (rel === '' && NOT_A_PERSONS.has(name.toLowerCase())) continue;
      out.push(`${rel}${name}`);
    }
  }
  return out;
}

interface Candidate {
  path: string;
  label: string;
  group: FileGroupKey;
  note?: 'brief';
}

/** Every file the list could hold, before any is opened: the fixed ones first, then the sides' sources. */
function candidates(root: string, appKey: string, opts: { look: boolean }): Candidate[] {
  const app = `${APPS_DIR}/${appKey}`;
  const dir = join(root, APPS_DIR, appKey);
  const fixed: Candidate[] = [
    { path: `${app}/design.md`, label: 'design.md', group: 'settings', note: 'brief' },
    ...(opts.look ? [{ path: `${app}/look.json`, label: 'look.json', group: 'settings' as const }] : []),
    { path: `${app}/${MANIFEST_PARTS_DIR}/app.json`, label: 'app.json', group: 'settings' },
  ];
  let pages: string[] = [];
  try {
    pages = readdirSync(join(dir, MANIFEST_PARTS_DIR, 'pages'), { withFileTypes: true })
      .filter((entry) => entry.isFile() && !entry.name.startsWith('.') && extensionOf(entry.name) === '.json')
      .map((entry) => entry.name)
      .sort();
  } catch {
    // An app with no dashboard page of its own.
  }
  // A page is named for its app (`shop-items.json`): the list shows it without the app's key, unless two would then read alike.
  const short = (name: string): string => (name.toLowerCase().startsWith(`${appKey}-`) && name.slice(appKey.length + 1).toLowerCase() !== '.json' ? name.slice(appKey.length + 1) : name);
  const shorts = pages.map(short);
  for (const [index, name] of pages.entries()) {
    const label = shorts.filter((other) => other.toLowerCase() === (shorts[index] as string).toLowerCase()).length > 1 ? name : (shorts[index] as string);
    fixed.push({ path: `${app}/${MANIFEST_PARTS_DIR}/pages/${name}`, label: `dashboard/pages/${label}`, group: 'dashboard' });
  }
  // A copy of a published app is built by its authors' own build: its screens' sources are not offered here.
  if (hasOwnBuild(root, appKey)) return fixed;
  const sides: Candidate[] = [];
  for (const side of ['customer', 'staff'] as const) {
    if (side === 'staff') fixed.push({ path: `${app}/staff/nav.json`, label: 'staff/nav.json', group: 'staff' });
    for (const inside of sourcesUnder(join(dir, side, 'src'))) sides.push({ path: `${app}/${side}/src/${inside}`, label: `${side}/${inside}`, group: side });
  }
  sides.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return [...fixed, ...sides];
}

/**
 * The files of an app a person may read and save by hand, now. `look` says
 * whether the app has a look that can be changed here (then `look.json` is
 * offered). Every file is one the jail would read, of plain name, of a size a
 * save may write, and there.
 */
export async function listEditable(root: string, appKey: string, opts: { look: boolean }): Promise<EditableFile[]> {
  let jail: Jail;
  try {
    jail = createJail(root, appKey);
  } catch {
    return [];
  }
  const out: EditableFile[] = [];
  for (const candidate of candidates(root, appKey, opts)) {
    if (out.length >= FILES_LISTED_MAX) break;
    if (!candidate.path.split('/').every((part) => FILE_PART.test(part))) continue;
    let file: string;
    try {
      // Listed under the jail's own spelling, and only when the jail would read it: no link, nothing outside the app.
      if (jail.normalise(candidate.path) !== candidate.path) continue;
      file = jail.resolve(candidate.path, 'read');
    } catch {
      continue;
    }
    // What a hand save could not write (it would need a yes on a card), a list does not offer.
    if (noCardRefusal(root, appKey, candidate.path, null) !== null) continue;
    let bytes: Buffer;
    try {
      if (lstatSync(file).size > MAX_WRITE_BYTES) continue;
      bytes = await readFile(file);
    } catch {
      continue;
    }
    if (bytes.length > MAX_WRITE_BYTES) continue;
    out.push({
      path: candidate.path,
      label: candidate.label,
      group: candidate.group,
      hash: await hashOf(bytes),
      size: bytes.length,
      text: isText(bytes),
      ...(candidate.note === undefined ? {} : { note: candidate.note }),
    });
  }
  return out;
}

export interface FileGroup {
  key: FileGroupKey;
  files: { path: string; label: string; hash: string; size: number; note?: 'brief' }[];
}

/** The list as a page is given it: in groups, in the order a page draws them, a group with no file left out. */
export function groupFiles(files: readonly EditableFile[]): FileGroup[] {
  return GROUP_ORDER.flatMap((key) => {
    const mine = files.filter((file) => file.group === key && file.text);
    return mine.length === 0 ? [] : [{ key, files: mine.map((file) => ({ path: file.path, label: file.label, hash: file.hash, size: file.size, ...(file.note === undefined ? {} : { note: file.note }) })) }];
  });
}

/** What of `app.json` a person changes by hand: what the app is called and how its pages are grouped. */
export const APP_JSON_OPEN_FIELDS: readonly string[] = ['name', 'description', 'navGroups', 'widgets'];

/**
 * Why a hand-saved `app.json` is refused, or null. It holds the app's key,
 * its kind, its version, what it may do and where its screens are, beside its
 * name: a save may change the name, the description, the nav groups and the
 * widgets, and must leave every other field as the file on disk has it.
 */
export function appJsonProblem(before: string, after: string): { field: string | null; message: string } | null {
  let next: unknown;
  try {
    next = JSON.parse(after);
  } catch (error) {
    return { field: null, message: `This is not valid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (next === null || typeof next !== 'object' || Array.isArray(next)) return { field: null, message: 'app.json holds one object.' };
  let was: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(before);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) was = parsed as Record<string, unknown>;
  } catch {
    // A file that does not read has no field to keep: only the open ones may then be set.
  }
  const now = next as Record<string, unknown>;
  for (const field of [...new Set([...Object.keys(was), ...Object.keys(now)])].sort()) {
    if (APP_JSON_OPEN_FIELDS.includes(field)) continue;
    if (!isDeepStrictEqual(was[field], now[field]) || field in was !== field in now) {
      return { field, message: `"${field}" in app.json is not changed here: only ${APP_JSON_OPEN_FIELDS.map((open) => `"${open}"`).join(', ')} are. Ask the Designer for the rest.` };
    }
  }
  return null;
}

/** A file's text with the line ends the file on disk has: one saved from an editor that works in "\n" keeps its "\r\n". */
export function withLineEnds(before: string, after: string): string {
  const crlf = before.includes('\r\n') && !/(^|[^\r])\n/.test(before);
  if (!crlf || after.includes('\r\n')) return after;
  return after.replace(/\n/g, '\r\n');
}

/** What a version made by a hand save is called: for the one file, or for how many. */
export function saveLabel(paths: readonly string[]): string {
  const [only] = paths;
  if (paths.length === 1 && only !== undefined) return `Your edit to ${only.slice(only.lastIndexOf('/') + 1)}`;
  return `Your edit to ${String(paths.length)} files`;
}

/** Whether a path is the app's own `look.json` or `app.json`. */
export const isLookFile = (appKey: string, path: string): boolean => path === `${APPS_DIR}/${appKey}/look.json`;
export const isAppJson = (appKey: string, path: string): boolean => path === `${APPS_DIR}/${appKey}/${MANIFEST_PARTS_DIR}/app.json`;
