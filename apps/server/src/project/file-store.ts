// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Reading and writing a project's page and schema files.
 *
 * Only `pages/*.json` and `schema/*.json` are listed (see `parseProjectPath`):
 * a README, a `.gitkeep` or a hand-written `pages/revenue.tsx` in the same
 * folders is never touched. Writes go to a temporary file first and are then
 * renamed over the target, so an editor or a watcher never sees half a file.
 *
 * A path is only used when its file sits directly in `pages/` or `schema/`.
 * On Windows `\` separates folders too, so a name such as `..\..\x` would
 * otherwise reach outside the project.
 */

import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { LISTS_DIR, PAGES_DIR, SCHEMA_DIR, fromProjectPath, parseProjectPath, type PathApi } from './paths.js';

/** The file-system calls the store makes; tests pass an in-memory one. */
export interface FileStoreFs {
  readdir(dir: string): Promise<string[]>;
  readFile(file: string): Promise<string>;
  writeFile(file: string, text: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  /** Removes a file; a missing one is fine. */
  rm(file: string): Promise<void>;
  mkdir(dir: string): Promise<void>;
}

const nodeFs: FileStoreFs = {
  readdir: (dir) => readdir(dir),
  readFile: (file) => readFile(file, 'utf8'),
  writeFile: (file, text) => writeFile(file, text, 'utf8'),
  rename: (from, to) => rename(from, to),
  rm: (file) => rm(file, { force: true }),
  mkdir: async (dir) => {
    await mkdir(dir, { recursive: true });
  },
};

export interface ProjectFileStore {
  /** The paths of every page and schema file, sorted. */
  list(): Promise<string[]>;
  /** The file's text, or null when it does not exist. */
  read(projectPath: string): Promise<string | null>;
  write(projectPath: string, text: string): Promise<void>;
  remove(projectPath: string): Promise<void>;
}

function isMissing(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'ENOENT';
}

export function diskFileStore(root: string, api: PathApi = path, fs: FileStoreFs = nodeFs): ProjectFileStore {
  const absolute = (projectPath: string): string => {
    if (parseProjectPath(projectPath) === null) {
      throw new Error(`${projectPath} is not a page, schema or list file`);
    }
    const file = fromProjectPath(root, projectPath, api);
    const [dir] = projectPath.split('/') as [string];
    if (api.dirname(file) !== api.join(root, dir)) {
      throw new Error(`${projectPath} is not a file in ${dir}/`);
    }
    return file;
  };

  return {
    async list() {
      const paths: string[] = [];
      for (const dir of [PAGES_DIR, SCHEMA_DIR, LISTS_DIR]) {
        let names: string[];
        try {
          names = await fs.readdir(api.join(root, dir));
        } catch (error) {
          if (isMissing(error)) continue;
          throw error;
        }
        for (const name of names) {
          const projectPath = `${dir}/${name}`;
          if (parseProjectPath(projectPath) !== null) paths.push(projectPath);
        }
      }
      return paths.sort();
    },

    async read(projectPath) {
      const file = absolute(projectPath);
      try {
        return await fs.readFile(file);
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },

    async write(projectPath, text) {
      const target = absolute(projectPath);
      const dir = api.dirname(target);
      await fs.mkdir(dir);
      const temporary = api.join(dir, `.${randomBytes(6).toString('hex')}.tmp`);
      await fs.writeFile(temporary, text);
      try {
        await fs.rename(temporary, target);
      } catch (error) {
        await fs.rm(temporary);
        throw error;
      }
    },

    async remove(projectPath) {
      await fs.rm(absolute(projectPath));
    },
  };
}

/** A store kept in memory, for tests and for `check` on text it was handed. */
export function memoryFileStore(initial: Record<string, string> = {}): ProjectFileStore & {
  files: Map<string, string>;
} {
  const files = new Map(Object.entries(initial));
  return {
    files,
    list: async () => [...files.keys()].filter((key) => parseProjectPath(key) !== null).sort(),
    read: async (projectPath) => files.get(projectPath) ?? null,
    write: async (projectPath, text) => {
      files.set(projectPath, text);
    },
    remove: async (projectPath) => {
      files.delete(projectPath);
    },
  };
}
