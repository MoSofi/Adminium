// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Locating the dashboard build (01-architecture.md §4.1: the published package
 * "bundles the server, the dashboard `dist/`, and the meta migrations").
 *
 * `buildServer({ staticRoot })` wants a directory containing `index.html`; the
 * static plugin no-ops cleanly when the directory is absent, so a miss here
 * degrades to an API-only server rather than a crash — the same contract
 * `scripts/demo-v01.mjs` relies on.
 *
 * Two layouts must both work, hence the candidate list:
 *  - **published tarball** — `<package>/dashboard/` (the `files` allow-list ships
 *    it; `scripts/bundle-dashboard.mjs` copies it in at build time),
 *  - **monorepo checkout** — `<repo>/apps/dashboard/dist/`, exactly where
 *    demo-v01.mjs looks, so `pnpm --filter @adminium/server exec …` works from a
 *    dev tree with no extra step.
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Directory name the dashboard build is bundled under inside the published
 * package. Kept next to the resolver so the bundling script and the runtime
 * lookup share one constant.
 */
export const BUNDLED_DASHBOARD_DIR = 'dashboard';

/** The package root — `dist/cli/…` and `src/cli/…` are both two levels down. */
function packageRoot(moduleUrl: string): string {
  return resolve(dirname(fileURLToPath(moduleUrl)), '..', '..');
}

export interface ResolveStaticRootOptions {
  /** Explicit override (`--static-root`, `ADMINIUM_STATIC_ROOT`) — wins outright. */
  override?: string | undefined;
  /** Test seam; defaults to this module's own location. */
  moduleUrl?: string;
  /** Test seam. */
  exists?: (path: string) => boolean;
}

/**
 * The candidate directories, in precedence order. Exported for the test — the
 * point of the resolver is the ORDER, and asserting on it beats asserting on
 * whichever candidate happens to exist on the machine running the suite.
 */
export function staticRootCandidates(opts: ResolveStaticRootOptions = {}): string[] {
  const root = packageRoot(opts.moduleUrl ?? import.meta.url);
  const candidates: string[] = [];
  if (opts.override !== undefined && opts.override !== '') candidates.push(resolve(opts.override));
  // Published tarball: apps/server/dashboard/.
  candidates.push(join(root, BUNDLED_DASHBOARD_DIR));
  // Monorepo checkout: apps/server/../dashboard/dist.
  candidates.push(join(root, '..', 'dashboard', 'dist'));
  return candidates.map((candidate) => resolve(candidate));
}

/**
 * First candidate that actually holds an `index.html`, else `undefined` (→ the
 * static plugin serves nothing and the API still boots).
 */
export function resolveStaticRoot(opts: ResolveStaticRootOptions = {}): string | undefined {
  const exists = opts.exists ?? existsSync;
  for (const candidate of staticRootCandidates(opts)) {
    if (exists(join(candidate, 'index.html'))) return candidate;
  }
  return undefined;
}
