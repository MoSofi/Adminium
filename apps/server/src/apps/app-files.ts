// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Where an installed app's files are.
 *
 * Until now there was one answer: the store, `<dataDir>/apps/<key>/<version>/`,
 * an unpacked package with a pin beside it. A project folder can now carry an
 * app as well, and that app has no package: its manifest is what
 * `adminium build` composed, its screens are what the build wrote, and its
 * sample data sits in the folder a person edits.
 *
 * Every reader of an app's files goes through this one interface, so "is it
 * here", "read its manifest", "where are its screens" have one answer per key
 * and a folder app is never asked of the store (where it would read as an
 * install whose files are gone).
 *
 * A key the project's build lists is the folder's. Every other key is the
 * store's, exactly as before.
 */

import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import { packageIsInStore } from '../add-ons/store.js';
import type { AppStore } from './store.js';

/** The file an app's manifest is read from, in a package. */
const MANIFEST_FILE = 'manifest.json';

/** What a project's build says of one app it carries. */
export interface FolderApp {
  key: string;
  /** Absolute: `apps/<key>/`, the folder a person edits. */
  sourceDir: string;
  /** Absolute: `.adminium/build/apps/<key>/`, holding `app.json` and one folder per built side. */
  buildDir: string;
}

export interface AppFiles {
  /** Which of the two holds this key's files. */
  sourceOf(key: string): 'store' | 'folder';
  /** Whether the files of this install are on this server. */
  has(key: string, version: string): Promise<boolean>;
  /** One file by its path in the package: `manifest.json`, `seeds/sample.json`. */
  readFile(key: string, version: string, path: string): Promise<Buffer>;
  /** The same, with the hash of what was read: checked against the pin for a package. */
  readVerifiedFile(key: string, version: string, path: string): Promise<{ bytes: Buffer; sha256: string }>;
  /** A package is re-checked against its pin; a folder is the person's own and has none. */
  verify(key: string, version: string): Promise<void>;
  /** The folder holding `<side>/index.html`. Throws for a key or version that names no safe path. */
  dirFor(key: string, version: string): string;
}

/** Thrown for a path that would leave an app's folder. */
export class AppFilesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AppFilesError';
  }
}

/**
 * A file inside `dir`, by a path a manifest or a sample bundle named: plain
 * segments only, and the file it resolves to must really be inside the folder
 * (a link out of it is refused, not followed).
 */
export function fileInside(dir: string, path: string): string {
  const segments = path.split('/');
  if (path === '' || isAbsolute(path) || segments.some((segment) => segment === '' || segment === '.' || segment === '..' || segment.startsWith('.'))) {
    throw new AppFilesError(`"${path}" is not a file of this app.`);
  }
  const file = resolve(dir, ...segments);
  if (!existsSync(file)) throw new AppFilesError(`"${path}" does not exist.`);
  // Plain files, and no link anywhere on the way: the real path stays under the real folder.
  if (!lstatSync(file).isFile()) throw new AppFilesError(`"${path}" is not a plain file.`);
  const inside = relative(realpathSync(dir), realpathSync(file));
  if (inside === '' || inside.startsWith('..') || isAbsolute(inside) || inside.split(sep).join('/') !== segments.join('/')) {
    throw new AppFilesError(`"${path}" is not a file of this app.`);
  }
  return file;
}

export function createAppFiles(deps: {
  store: AppStore;
  /** The apps the project's build lists; absent outside a project. */
  folder?: (() => readonly FolderApp[]) | undefined;
}): AppFiles {
  const folderApp = (key: string): FolderApp | undefined => deps.folder?.().find((app) => app.key === key);

  /** Where one of a folder app's files really is. */
  function folderFile(app: FolderApp, path: string): string {
    // The manifest is the composed one the build wrote, never a part file.
    if (path === MANIFEST_FILE) return fileInside(app.buildDir, 'app.json');
    return fileInside(app.sourceDir, path);
  }

  return {
    sourceOf: (key) => (folderApp(key) === undefined ? 'store' : 'folder'),

    async has(key, version) {
      const app = folderApp(key);
      if (app !== undefined) return existsSync(join(app.buildDir, 'app.json'));
      return packageIsInStore(deps.store, { key, version });
    },

    async readFile(key, version, path) {
      const app = folderApp(key);
      if (app !== undefined) return readFileSync(folderFile(app, path));
      return deps.store.readFile(key, version, path);
    },

    async readVerifiedFile(key, version, path) {
      const app = folderApp(key);
      if (app !== undefined) {
        const bytes = readFileSync(folderFile(app, path));
        return { bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
      }
      return deps.store.readVerifiedFile(key, version, path);
    },

    async verify(key, version) {
      if (folderApp(key) !== undefined) return;
      await deps.store.verifyTree(key, version);
    },

    dirFor(key, version) {
      const app = folderApp(key);
      if (app !== undefined) return app.buildDir;
      return deps.store.dirFor(key, version);
    },
  };
}
