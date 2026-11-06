// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN APP'S SOURCE, AS ITS PACKAGE CARRIES IT: everything a person edits,
 * nothing that runs.
 *
 * A package made from a project app carries the app's folder under
 * `source/`, so another server can copy it into its own project and keep
 * changing the screens. What a package may never carry is something that runs
 * on the machine that opens it: a build step, a bundler's config, a package
 * script. So the same rules decide what goes into `source/` when a package is
 * made, and again what comes out of it when a server copies it into a folder
 * (a package from elsewhere is not trusted to have been made here):
 *
 *  - left out: dotfiles and dot-folders, `node_modules/`, links and anything
 *    that is not a plain file or folder, `build.json`, every tool's
 *    `<name>.config.<js|ts|…>` (Vite, Rollup, webpack, tsup, Babel, PostCSS,
 *    Tailwind, Metro…), `esbuild.<js|ts|…>`, and shell scripts;
 *  - rewritten: every `package.json`, without the fields a package manager
 *    runs (`scripts`, `bin`, `gypfile`) or a git hook runner reads (`husky`,
 *    `lint-staged`, `simple-git-hooks`). One that does not read as JSON is
 *    left out rather than carried as it is.
 *
 * `seeds/` is not repeated under `source/`: the package carries it at its
 * root already, byte for byte, and a copy takes it from there.
 */
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The folder of a package that holds the app's source. */
export const SOURCE_DIR = 'source';

/** The app folder's sample data, carried once, at the package's root. */
export const SEEDS_DIR = 'seeds';

/** The fields of a `package.json` something runs. */
export const RUNNING_PACKAGE_FIELDS = ['scripts', 'bin', 'gypfile', 'husky', 'lint-staged', 'simple-git-hooks'] as const;

const SCRIPT_EXTENSION = /\.(?:[cm]?[jt]sx?)$/;

/** Why a file of the folder stays out of `source/`, or null when it goes in. Folders: see {@link folderLeftOut}. */
export function fileLeftOut(name: string): string | null {
  if (name.startsWith('.')) return 'a hidden file';
  if (name === 'build.json') return 'a build step';
  // `vite.config.ts`, `postcss.config.cjs`, `metro.config.js`: a tool runs these.
  if (/^[^.]+(?:\.[^.]+)*\.config\.[cm]?[jt]sx?$/.test(name)) return 'a tool’s config';
  if (/^esbuild\./.test(name) && SCRIPT_EXTENSION.test(name)) return 'a tool’s config';
  if (/\.(?:sh|bash|zsh|bat|cmd|ps1)$/i.test(name)) return 'a shell script';
  return null;
}

/** Why a folder stays out of `source/`, or null. */
export function folderLeftOut(name: string): string | null {
  if (name.startsWith('.')) return 'a hidden folder';
  if (name === 'node_modules') return 'installed packages';
  return null;
}

/**
 * A `package.json` without what runs, as it is written into `source/`. Null
 * when it does not read as an object: it is left out then.
 */
export function strippedPackageJson(text: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const kept: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(parsed as Record<string, unknown>)) {
    if ((RUNNING_PACKAGE_FIELDS as readonly string[]).includes(field)) continue;
    kept[field] = value;
  }
  return `${JSON.stringify(kept, null, 2)}\n`;
}

/** One file of the source, by its path inside the app's folder (`/`-separated). */
export interface SourceFile {
  path: string;
  bytes: Uint8Array;
}

/**
 * One file as the source carries it: as it is, rewritten (a `package.json`),
 * or null when it stays out. `path` is relative to the app folder. `seeds/`
 * stays out of `source/` (the package has it at its root), unless `seeds` is
 * set: a copy into a folder takes it from there, under the same rules.
 */
export function sourceFileOf(path: string, bytes: Uint8Array, opts: { seeds?: boolean } = {}): Uint8Array | null {
  const segments = path.split('/');
  const name = segments[segments.length - 1] ?? '';
  if (segments.slice(0, -1).some((segment) => folderLeftOut(segment) !== null)) return null;
  if (segments[0] === SEEDS_DIR && opts.seeds !== true) return null;
  if (fileLeftOut(name) !== null) return null;
  if (name === 'package.json') {
    const stripped = strippedPackageJson(Buffer.from(bytes).toString('utf8'));
    return stripped === null ? null : new Uint8Array(Buffer.from(stripped, 'utf8'));
  }
  return bytes;
}

/**
 * The source of an app folder, ready for a package: every plain file the
 * rules keep, sorted by path. Links and anything else that is not a plain
 * file or folder are skipped, never followed.
 */
export function readAppSource(dir: string): SourceFile[] {
  const out: SourceFile[] = [];
  const walk = (at: string, prefix: string): void => {
    for (const entry of readdirSync(at, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(at, entry.name);
      const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      const stat = lstatSync(full);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        if (folderLeftOut(entry.name) !== null) continue;
        if (prefix === '' && entry.name === SEEDS_DIR) continue;
        walk(full, path);
        continue;
      }
      if (!stat.isFile()) continue;
      const kept = sourceFileOf(path, new Uint8Array(readFileSync(full)));
      if (kept !== null) out.push({ path, bytes: kept });
    }
  };
  walk(dir, '');
  return out;
}
