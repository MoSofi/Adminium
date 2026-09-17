// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The oldest Node the CLI will run on, checked before anything native loads.
 *
 * better-sqlite3 13 ships prebuilt binaries built for Node-API 10, and Node has
 * Node-API 10 only from 22.14 (on the 23 line, from 23.6). An older Node does
 * not throw when it loads such a binary: it crashes inside `dlopen`. So on
 * Node 21.5, `npx @adminiumjs/adminium` → "In your browser" printed
 * `segmentation fault` and nothing else (2026-09-16). npm did not warn first,
 * because better-sqlite3's own `engines` says `>=22`.
 *
 * The check reads `process.versions.napi` rather than comparing version numbers
 * alone, because 23.0–23.5 are "newer than 22.14" and still crash.
 *
 * NO IMPORTS IN THIS FILE. `cli/index.ts` imports it statically, and ESM runs
 * every static import before the importing file's own code. Anything here that
 * reached better-sqlite3 or argon2 would load, and crash, before the check ran.
 * The pin lives in test/m10-regressions.test.ts under `packaging`.
 */

/** Shown to users. Keep in step with `engines.node` in package.json. */
export const MIN_NODE = '22.14.0';

/** better-sqlite3 13's prebuilds are built with `NAPI_VERSION=10`. */
export const MIN_NAPI = 10;

export interface NodeVersions {
  readonly node?: string | undefined;
  readonly napi?: string | undefined;
}

function parts(version: string): number[] {
  return version
    .replace(/^v/, '')
    .split('.')
    .map((part) => Number.parseInt(part, 10));
}

function atLeast(version: string, floor: string): boolean {
  const have = parts(version);
  const want = parts(floor);
  for (let i = 0; i < want.length; i++) {
    const a = have[i] ?? 0;
    const b = want[i] ?? 0;
    if (Number.isNaN(a)) return false;
    if (a !== b) return a > b;
  }
  return true;
}

/**
 * `null` when this Node can run Adminium, otherwise the message to print.
 * A missing `napi` counts as unsupported: nothing that lacks it can load the
 * database driver.
 */
export function unsupportedNodeMessage(versions: NodeVersions): string | null {
  const node = versions.node ?? 'unknown';
  const napi = Number(versions.napi);
  if (napi >= MIN_NAPI && atLeast(node, MIN_NODE)) return null;

  const [major, minor] = parts(MIN_NODE);
  const floor = `${String(major)}.${String(minor)}`;
  const on23 = parts(node)[0] === 23 ? ' On Node.js 23, that means 23.6 or newer.' : '';
  return [
    `Adminium needs Node.js ${floor} or newer. This is Node.js ${node}.${on23}`,
    'Older versions crash while loading the database driver.',
    '',
    'Install the current LTS release from https://nodejs.org,',
    'or run `nvm install --lts` if you use nvm. Then run this command again.',
    '',
  ].join('\n');
}
