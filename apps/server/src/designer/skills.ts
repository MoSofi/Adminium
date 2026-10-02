// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The skills, as the Designer reads them.
 *
 * The same files a coding agent reads (`skills/` in the repository, copied
 * into the published package by `scripts/bundle-skills.mjs`): one body of
 * knowledge for both. A file is read by its name from the bundle's own list,
 * never by joining a path the model wrote.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Where the skills are: in the package beside `dist/`, else the repository's own `skills/`. */
export function skillsDir(moduleUrl: string = import.meta.url): string | null {
  const here = dirname(fileURLToPath(moduleUrl));
  for (const candidate of [join(here, '..', '..', 'skills'), join(here, '..', '..', '..', '..', 'skills')]) {
    if (existsSync(join(candidate, 'adminium', 'SKILL.md'))) return candidate;
  }
  return null;
}

export interface Skills {
  /** Every file, by its name relative to the skills folder: `adminium-app/SKILL.md`. */
  names(): string[];
  /** One file's text, or null when the name is not one of them. */
  read(name: string): string | null;
  size(name: string): number | null;
}

export function createSkills(dir: string | null = skillsDir()): Skills {
  const files = new Map<string, string>();
  const walk = (folder: string): void => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const path = join(folder, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && /\.(md|txt)$/.test(entry.name)) files.set(relative(dir as string, path).split(sep).join('/'), path);
    }
  };
  if (dir !== null) walk(dir);
  return {
    names: () => [...files.keys()].sort(),
    read: (name) => {
      const path = files.get(name);
      return path === undefined ? null : readFileSync(path, 'utf8');
    },
    size: (name) => {
      const path = files.get(name);
      return path === undefined ? null : statSync(path).size;
    },
  };
}
