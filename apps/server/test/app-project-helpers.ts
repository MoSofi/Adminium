// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A temp project for the `adminium app` tests, with what a real project has
 * installed linked in: the esbuild that comes with vitest's own bundler,
 * React (this package's dev dependency), and the public client.
 */
import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const fromHere = createRequire(import.meta.url);

/** The folder of an installed package, or null when this checkout has none. */
function packageFolder(name: string, from: NodeJS.Require = fromHere): string | null {
  try {
    return dirname(from.resolve(`${name}/package.json`));
  } catch {
    // A package whose `exports` hide its package.json: walk up from its entry.
    try {
      for (let dir = dirname(from.resolve(name)); dir !== dirname(dir); dir = dirname(dir)) {
        if (existsSync(join(dir, 'package.json'))) return dir;
      }
    } catch {
      return null;
    }
    return null;
  }
}

function esbuildFolder(): string | null {
  try {
    const vite = createRequire(fromHere.resolve('vitest/package.json')).resolve('vite');
    return packageFolder('esbuild', createRequire(vite));
  } catch {
    return null;
  }
}

const LINKED: Record<string, string | null> = {
  esbuild: esbuildFolder(),
  react: packageFolder('react'),
  'react-dom': packageFolder('react-dom'),
  // Published as `@adminiumjs/public-client`, which is what a side imports.
  '@adminiumjs/public-client': packageFolder('@adminium/public-client'),
};

/** False when this checkout cannot build a side: the suites that need one skip. */
export const canBuildSides = Object.values(LINKED).every((folder) => folder !== null);

/** Make `root` a project folder: a config, a package.json and the packages linked. */
export function asProject(root: string): string {
  writeFileSync(join(root, 'adminium.config.ts'), 'export default {};\n');
  writeFileSync(join(root, 'package.json'), `${JSON.stringify({ name: 'my-admin', private: true, type: 'module' }, null, 2)}\n`);
  for (const [name, folder] of Object.entries(LINKED)) {
    if (folder === null) continue;
    mkdirSync(dirname(join(root, 'node_modules', name)), { recursive: true });
    symlinkSync(folder, join(root, 'node_modules', name), 'dir');
  }
  return root;
}

/** A project folder with a config, a package.json and the packages linked. */
export function tempProject(prefix: string): string {
  return asProject(mkdtempSync(join(tmpdir(), prefix)));
}
