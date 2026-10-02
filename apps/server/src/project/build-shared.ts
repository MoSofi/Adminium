// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What the project build and the builds it runs (an app's screens, the apps
 * as a whole) all need, in a module that imports none of them.
 */

import { existsSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';

import { CliError } from '../cli/exit.js';

export const BUILD_DIR = join('.adminium', 'build');

/** The folders server code lives in, which are also its kinds. */
export const SERVER_CODE_FOLDERS = ['hooks', 'actions'] as const;
const SOURCE_EXTENSIONS = ['.ts', '.mts', '.js', '.mjs'];

/** The package name project code imports its helpers from. */
export const HELPERS_PACKAGE = '@adminiumjs/adminium';

export interface ServerCodeSource {
  kind: (typeof SERVER_CODE_FOLDERS)[number];
  /** The file name without its extension. */
  name: string;
  /** Relative to the project, with `/`: `hooks/orders.ts`. */
  source: string;
}

/**
 * The hook and action files: the top level of `hooks/` and `actions/`, in
 * TypeScript or JavaScript. Names starting with `.` or `_` are left out, so a
 * shared helper can sit beside them as `_shared.ts`.
 */
export function serverCodeSources(root: string): ServerCodeSource[] {
  const out: ServerCodeSource[] = [];
  for (const kind of SERVER_CODE_FOLDERS) {
    const dir = join(root, kind);
    if (!existsSync(dir)) continue;
    const seen = new Map<string, string>();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
      if (entry.name.endsWith('.d.ts') || /\.test\.[cm]?[jt]s$/.test(entry.name)) continue;
      const extension = extname(entry.name);
      if (!SOURCE_EXTENSIONS.includes(extension)) continue;
      const name = entry.name.slice(0, -extension.length);
      const other = seen.get(name);
      if (other !== undefined) {
        throw new CliError(`${kind}/${other} and ${kind}/${entry.name} have the same name. Keep one of them.`);
      }
      seen.set(name, entry.name);
      out.push({ kind, name, source: `${kind}/${entry.name}` });
    }
  }
  return out.sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : 0));
}
