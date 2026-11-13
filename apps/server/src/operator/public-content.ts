// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What this instance serves to anybody: the files of every app's customer
 * side, and the fields of every live form, read from the source rather than
 * from a crawl a page could cloak.
 *
 * The operator endpoint answers it (`GET /api/v1/operator/public-content`);
 * an event that says a public page changed carries the same document, so it
 * is built here, by one function. Whoever reads it treats its text as data:
 * it is the instance owner's words, never instructions.
 */
import { createHash } from 'node:crypto';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { extname, join, relative, sep } from 'node:path';

import type { HostedSurface } from '../cli/surfaces-root.js';

/** File types whose text is sent along; every other file is listed with its size and hash. */
const TEXT_EXTENSIONS: ReadonlySet<string> = new Set(['.html', '.htm', '.js', '.mjs', '.cjs', '.css', '.json', '.txt', '.svg', '.md', '.xml', '.webmanifest', '.map']);

/** The text of one file sent along, at most. */
export const PUBLIC_CONTENT_FILE_TEXT_MAX = 512 * 1024;
/** The text of every file together, at most. */
export const PUBLIC_CONTENT_TEXT_MAX = 16 * 1024 * 1024;
/** Files listed per side, at most. */
export const PUBLIC_CONTENT_FILES_MAX = 5_000;

export interface PublicFile {
  /** Relative to the side's root, with `/`. */
  path: string;
  bytes: number;
  sha256: string;
  /** The file's text, for a text file within the limits. */
  text?: string;
  /** A text file whose text stops short of the file, or is left out because the budget was spent. */
  truncated?: boolean;
}

export interface PublicSide {
  appKey: string;
  /** Where it is served: `/apps/<key>/customer/`. */
  path: string;
  files: PublicFile[];
  /** True when the side holds more than is sent: more files than are listed, or a file's text cut short or left out. */
  truncated: boolean;
}

export interface PublicForm {
  slug: string;
  /** The add-on that holds the form. */
  addOn: string;
  /** Its published definition: the fields and words a stranger sees. */
  form: unknown;
}

export interface PublicContent {
  at: number;
  sides: PublicSide[];
  forms: PublicForm[];
}

export interface PublicContentDeps {
  /** Every app side this server serves now. */
  surfaces: () => readonly HostedSurface[];
  /** The forms strangers can open now. */
  forms: {
    liveSlugs(): Promise<{ addOn: string; slug: string }[]>;
    find(slug: string): Promise<{ state: string; live?: { addOn: string; form: unknown } }>;
  } | null;
  now?: () => number;
}

/** An HTML page: its text is read before any other file's. */
function isPage(path: string): boolean {
  const ext = extname(path).toLowerCase();
  return ext === '.html' || ext === '.htm';
}

async function filesOf(root: string): Promise<{ paths: string[]; truncated: boolean }> {
  const paths: string[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const dir = pending.pop()!;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile()) {
        if (paths.length >= PUBLIC_CONTENT_FILES_MAX) return { paths, truncated: true };
        paths.push(path);
      }
    }
  }
  return { paths: paths.sort(), truncated: false };
}

/** What this instance serves to anybody, now. */
export async function buildPublicContent(deps: PublicContentDeps): Promise<PublicContent> {
  const at = (deps.now ?? Date.now)();
  let textLeft = PUBLIC_CONTENT_TEXT_MAX;
  const sides: PublicSide[] = [];
  const customer = deps.surfaces().filter((surface) => surface.side === 'customer');
  for (const surface of [...customer].sort((a, b) => a.appKey.localeCompare(b.appKey))) {
    const listed = await filesOf(surface.root);
    let truncated = listed.truncated;
    const files: PublicFile[] = [];
    // The pages first: the budget is spent on what a stranger is shown before the files it loads.
    for (const path of [...listed.paths].sort((a, b) => Number(!isPage(a)) - Number(!isPage(b)))) {
      let bytes: Buffer;
      try {
        if (!(await lstat(path)).isFile()) continue;
        bytes = await readFile(path);
      } catch {
        continue;
      }
      const file: PublicFile = { path: relative(surface.root, path).split(sep).join('/'), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
      if (TEXT_EXTENSIONS.has(extname(path).toLowerCase())) {
        const take = Math.min(bytes.length, PUBLIC_CONTENT_FILE_TEXT_MAX, textLeft);
        if (take > 0 || bytes.length === 0) file.text = bytes.subarray(0, take).toString('utf8');
        textLeft -= take;
        // Cut short, or left out once the budget is spent: said, never silent.
        if (take < bytes.length) {
          file.truncated = true;
          truncated = true;
        }
      }
      files.push(file);
    }
    files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    sides.push({ appKey: surface.appKey, path: `${surface.prefix}/`, files, truncated });
  }
  const forms: PublicForm[] = [];
  for (const { slug } of deps.forms === null ? [] : await deps.forms.liveSlugs()) {
    const found = await deps.forms!.find(slug);
    if (found.state === 'live' && found.live !== undefined) forms.push({ slug, addOn: found.live.addOn, form: found.live.form });
  }
  return { at, sides, forms };
}
