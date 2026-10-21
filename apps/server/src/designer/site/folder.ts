// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A site template that is a folder: one in a project's `site-templates/<name>/`, or a folder a
 * person makes a project in (`adminium design` there, or the Desktop's "Make a new project here").
 *
 * The folder is untrusted like an upload: anything that writes to it could have put a link in it,
 * or swap one in while it is read. So the walk never follows a link (`lstat`), never descends into
 * a dot folder or `node_modules` (and does not count them), stops at 1,000 entries or 5 seconds, and
 * never blocks: every call is a promise. A file is opened without following a link at its last part
 * (`O_NOFOLLOW`), its handle checked to be the file the walk saw (`dev` and `ino`) and inside the
 * folder (its real path), and read through the handle, no more than `fstat` says. Then the same judge
 * as a zip decides (`judge.ts`).
 *
 * The listing of a project's templates reads names and one fact only: whether a folder holds a page
 * at its top or one wrapping folder down.
 */
import { constants, type Stats } from 'node:fs';
import { lstat, mkdir, open, readdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

import { DESIGNER_DIR } from '../session-store.js';
import { judgeSite, SITE_MAX_ENTRIES, SiteRefusal, type SiteEntry } from './judge.js';

/** Where a project keeps its site templates. */
export const SITE_TEMPLATES_DIR = 'site-templates';
/** How long a walk may take before it stops: a folder that big is not a template. */
export const FOLDER_WALK_MS = 5000;
/** The most names the listing gives; it says how many more there are. */
export const SITE_TEMPLATES_LISTED = 100;
/** A template's folder name the Designer takes: letters, digits, space, `.`, `_` and `-`. */
export const TEMPLATE_NAME = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,99}$/u;

/** Why a walk stopped before it read the whole folder. */
export type WalkStop = 'too-many' | 'too-slow';

const skipped = (name: string): boolean => name.startsWith('.') || name === 'node_modules';

/**
 * Opens a file without following a link, checks it is the file the walk saw and lies inside the
 * folder, and reads it through its handle, no more than `max` bytes.
 */
export async function readNoFollow(root: string, path: string, seen: Stats, max: number): Promise<Buffer> {
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.dev !== seen.dev || stat.ino !== seen.ino) throw new Error(`${path} changed while it was read`);
    const real = await realpath(path);
    const top = await realpath(root);
    if (real !== top && !real.startsWith(`${top}${sep}`)) throw new Error(`${path} lies outside its folder`);
    if (stat.size > max) return Buffer.alloc(max + 1);
    const bytes = Buffer.alloc(stat.size);
    let at = 0;
    while (at < stat.size) {
      const { bytesRead } = await handle.read(bytes, at, stat.size - at, at);
      if (bytesRead === 0) break;
      at += bytesRead;
    }
    return bytes.subarray(0, at);
  } finally {
    await handle.close();
  }
}

/**
 * The entries of a folder, as the judge takes them: files with their size and a way to read them,
 * folders, and links and other things (never followed, never read). `leaveOut` names entries at the
 * top that are not walked (the project being made inside the folder).
 */
export async function walkFolder(root: string, opts: { leaveOut?: readonly string[]; maxEntries?: number; maxMs?: number; now?: () => number } = {}): Promise<{ entries: SiteEntry[]; stopped: WalkStop | null }> {
  const now = opts.now ?? (() => Date.now());
  const started = now();
  const maxEntries = opts.maxEntries ?? SITE_MAX_ENTRIES;
  const maxMs = opts.maxMs ?? FOLDER_WALK_MS;
  const top = await lstat(root);
  if (!top.isDirectory()) throw new Error(`${root} is not a folder`);
  const entries: SiteEntry[] = [];
  const queue: string[] = [''];
  while (queue.length > 0) {
    const folder = queue.shift() as string;
    const names = (await readdir(join(root, folder))).sort();
    for (const name of names) {
      if (skipped(name) || (folder === '' && opts.leaveOut?.includes(name) === true)) continue;
      if (entries.length >= maxEntries) return { entries, stopped: 'too-many' };
      if (now() - started > maxMs) return { entries, stopped: 'too-slow' };
      const path = folder === '' ? name : `${folder}/${name}`;
      const absolute = join(root, path);
      const stat = await lstat(absolute);
      if (stat.isDirectory()) {
        entries.push({ path: `${path}/`, size: 0, type: 'dir', read: async () => Buffer.alloc(0) });
        queue.push(path);
      } else if (stat.isSymbolicLink()) {
        entries.push({ path, size: 0, type: 'link', read: async () => Buffer.alloc(0) });
      } else if (stat.isFile()) {
        entries.push({ path, size: stat.size, type: 'file', read: () => readNoFollow(root, absolute, stat, stat.size) });
      } else {
        entries.push({ path, size: 0, type: 'other', read: async () => Buffer.alloc(0) });
      }
    }
  }
  return { entries, stopped: null };
}

/** Whether a folder holds a page at its very top (a folder a project is made in): names only. */
export async function pageAtTop(folder: string): Promise<boolean> {
  try {
    for (const name of await readdir(folder)) {
      if (!/\.html?$/i.test(name) || name.startsWith('.')) continue;
      if ((await lstat(join(folder, name))).isFile()) return true;
    }
  } catch {
    // Not a folder that can be read: no template.
  }
  return false;
}

/** Whether a folder holds a page at its top, or under one wrapping folder: names only, nothing opened. */
export async function holdsPage(folder: string): Promise<boolean> {
  const page = /\.html?$/i;
  const look = async (dir: string): Promise<{ page: boolean; dirs: string[] }> => {
    const found = { page: false, dirs: [] as string[] };
    for (const name of await readdir(dir)) {
      if (skipped(name) || name === '__MACOSX') continue;
      const stat = await lstat(join(dir, name));
      if (stat.isFile() && page.test(name)) found.page = true;
      else if (stat.isDirectory()) found.dirs.push(name);
    }
    return found;
  };
  try {
    const at = await look(folder);
    if (at.page) return true;
    return at.dirs.length === 1 && (await look(join(folder, at.dirs[0] as string))).page;
  } catch {
    return false;
  }
}

export interface SiteTemplateListing {
  /** Each folder of `site-templates/` that holds a page: usable, or to be renamed first. */
  templates: { name: string; usable: boolean }[];
  /** How many more there are past the first `SITE_TEMPLATES_LISTED`. */
  more: number;
}

/** The project's site templates: real folders of `site-templates/` holding a page, by name, in order. */
export async function listSiteTemplates(projectRoot: string): Promise<SiteTemplateListing> {
  const dir = join(projectRoot, SITE_TEMPLATES_DIR);
  try {
    if (!(await lstat(dir)).isDirectory()) return { templates: [], more: 0 };
  } catch {
    return { templates: [], more: 0 };
  }
  const found: { name: string; usable: boolean }[] = [];
  for (const name of (await readdir(dir)).sort((a, b) => a.localeCompare(b))) {
    if (name.startsWith('.')) continue;
    try {
      if (!(await lstat(join(dir, name))).isDirectory()) continue;
    } catch {
      continue;
    }
    if (await holdsPage(join(dir, name))) found.push({ name, usable: TEMPLATE_NAME.test(name) && name.normalize('NFC') === name });
  }
  return { templates: found.slice(0, SITE_TEMPLATES_LISTED), more: Math.max(0, found.length - SITE_TEMPLATES_LISTED) };
}

/** A name a template's copy may take: the folder's own, made a usable one. */
export function templateNameOf(folderName: string): string {
  const clean = folderName
    .normalize('NFC')
    .replace(/[^\p{L}\p{N} ._-]+/gu, '-')
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .slice(0, 100)
    .trim();
  return clean === '' ? 'site' : clean;
}

/**
 * The judged files of a template, written into a project's `site-templates/<name>/`: first into
 * `.<name>.partial/` (which the listing skips), renamed at the end, so a crash leaves no half
 * template offered as a whole one. A copy already there is left as it is.
 */
export async function writeTemplateCopy(projectRoot: string, name: string, files: readonly { path: string; bytes: Buffer }[]): Promise<'copied' | 'exists'> {
  const dir = join(projectRoot, SITE_TEMPLATES_DIR);
  const target = join(dir, name);
  const partial = join(dir, `.${name}.partial`);
  try {
    await lstat(target);
    return 'exists';
  } catch {
    // Not there yet.
  }
  await rm(partial, { recursive: true, force: true });
  await mkdir(partial, { recursive: true });
  try {
    for (const file of files) {
      const to = join(partial, ...file.path.split('/'));
      // The judge's paths are clean; a join that leaves the folder is refused all the same.
      if (relative(partial, to).startsWith('..')) throw new Error(`${file.path} would leave the template's folder`);
      await mkdir(join(to, '..'), { recursive: true });
      await writeFile(to, file.bytes, { flag: 'wx' });
    }
    await rename(partial, target);
  } catch (error) {
    await rm(partial, { recursive: true, force: true });
    throw error;
  }
  return 'copied';
}

/**
 * A folder a project is made in that holds a site template: its entries read BEFORE the project's
 * own folder exists (that folder is left out of the walk by name), so the copy never meets the
 * project it is copied into.
 */
export async function snapshotTemplate(from: string, projectFolder: string): Promise<{ entries: SiteEntry[]; stopped: WalkStop | null }> {
  return walkFolder(from, { leaveOut: [projectFolder] });
}

/** Copies a template folder's snapshot into a project through the judge; or says why it was not copied. */
export async function copyTemplateInto(
  label: string,
  snapshot: { entries: SiteEntry[]; stopped: WalkStop | null },
  projectRoot: string,
  name: string,
): Promise<{ copied: true; pages: number; files: number } | { copied: false; why: string }> {
  if (snapshot.stopped === 'too-many') return { copied: false, why: `${label} holds more than ${SITE_MAX_ENTRIES.toLocaleString('en-US')} files and folders.` };
  if (snapshot.stopped === 'too-slow') return { copied: false, why: `${label} took too long to read.` };
  let judged;
  try {
    judged = await judgeSite(label, snapshot.entries);
  } catch (error) {
    if (error instanceof SiteRefusal) return { copied: false, why: error.message };
    throw error;
  }
  const done = await writeTemplateCopy(projectRoot, name, judged.files);
  if (done === 'exists') return { copied: false, why: `The project already has a site template named ${name}.` };
  return { copied: true, pages: judged.pages, files: judged.files.length };
}

/** Why a template folder was not copied in when its project was made: said once on the Designer's home. */
const NOTE_FILE = join(DESIGNER_DIR, 'site-template-note.json');

export async function writeTemplateNote(projectRoot: string, note: { name: string; why: string }): Promise<void> {
  await mkdir(join(projectRoot, DESIGNER_DIR), { recursive: true });
  await writeFile(join(projectRoot, NOTE_FILE), JSON.stringify(note), { mode: 0o600 });
}

export async function readTemplateNote(projectRoot: string): Promise<{ name: string; why: string } | null> {
  try {
    const parsed = JSON.parse(await readFile(join(projectRoot, NOTE_FILE), 'utf8')) as unknown;
    if (parsed !== null && typeof parsed === 'object' && typeof (parsed as { name?: unknown }).name === 'string' && typeof (parsed as { why?: unknown }).why === 'string') {
      const { name, why } = parsed as { name: string; why: string };
      return { name: name.slice(0, 120), why: why.slice(0, 400) };
    }
  } catch {
    // None, or not one this server wrote.
  }
  return null;
}

export async function clearTemplateNote(projectRoot: string): Promise<void> {
  await rm(join(projectRoot, NOTE_FILE), { force: true });
}
