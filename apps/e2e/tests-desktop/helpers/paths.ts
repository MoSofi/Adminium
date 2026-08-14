/**
 * Where the BUILT Electron app lives (11-electron.md §3, 11-T20).
 *
 * The desktop E2E suite does not import `@adminium/desktop` — it LAUNCHES its
 * build output by filesystem path, exactly the way `scripts/e2e-server.mjs`
 * consumes `apps/dashboard/dist` as a build input rather than an import. So this
 * module is the single place that knows the layout electron-vite emits
 * (`out/main/index.js`, `out/server/index.js`, `out/dashboard`) and turns a
 * missing build into an actionable error rather than a cryptic Playwright
 * launch failure.
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// tests-desktop/helpers → tests-desktop → apps/e2e → apps → <repo root>.
const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(here, '..', '..', '..', '..');

export const DESKTOP_ROOT = join(REPO_ROOT, 'apps', 'desktop');

/** The Electron `main` entry Playwright's `_electron.launch` runs (§3). */
export const DESKTOP_MAIN_ENTRY = join(DESKTOP_ROOT, 'out', 'main', 'index.js');

/** The forked utilityProcess server bundle (§2.1) — asserted, never launched directly. */
export const DESKTOP_SERVER_ENTRY = join(DESKTOP_ROOT, 'out', 'server', 'index.js');

/** The dashboard SPA the embedded server serves over loopback (§3). */
export const DESKTOP_DASHBOARD_DIR = join(DESKTOP_ROOT, 'out', 'dashboard');

/** The §6 demo seed script; resolved from `resources/`, not `out/` (see main/index.ts). */
export const DEMO_SEED_SCRIPT = join(DESKTOP_ROOT, 'resources', 'demo', 'demo-seed.mjs');

/**
 * Fail early, and with instructions, when the app has not been built.
 *
 * ─── THE NATIVE-ABI PREREQUISITE — RESOLVED UPSTREAM (2026-08-14) ────────────
 *
 * This block used to describe a hard prerequisite: a plain `electron-vite build`
 * emits `out/**` but does NOT rebuild `better-sqlite3`/`argon2` against
 * Electron's ABI, so launching `out/main/index.js` with a Node-ABI
 * `better-sqlite3` crashed the utilityProcess at the `meta-store` stage and the
 * app rendered the crash screen instead of the SPA — failing every spec here at
 * {@link module:helpers/launch.waitForAppWindow}. The desktop-e2e job therefore
 * had to run, between build and run:
 *
 *   pnpm --filter @adminium/desktop exec electron-builder install-app-deps
 *   # or: electron-rebuild -w better-sqlite3,argon2
 *
 * Both addons are Node-API now — `better-sqlite3` >= 13 (the v13 major migrated
 * to N-API and ships its own prebuilds) and `argon2` >= 0.44 (`napi_versions:
 * [8]`, resolved by node-gyp-build). An N-API binary is ABI-stable across Node
 * and Electron by construction, so there is no Node-ABI/Electron-ABI split for
 * this suite to fall into. The CI step is kept as a harmless no-op.
 *
 * The old reason it had to be a CI step rather than part of the suite —
 * `@electron/rebuild` rewriting the SHARED workspace copy and breaking every
 * Node-ABI vitest suite — is obsolete for the same reason: there is only one ABI
 * now. apps/desktop/package.json (`//native-modules`) still explains why this can
 * never be a workspace `postinstall`, which has not changed.
 */
export function assertDesktopBuilt(): void {
  const missing: string[] = [];
  if (!existsSync(DESKTOP_MAIN_ENTRY)) missing.push(DESKTOP_MAIN_ENTRY);
  if (!existsSync(DESKTOP_SERVER_ENTRY)) missing.push(DESKTOP_SERVER_ENTRY);
  if (!existsSync(join(DESKTOP_DASHBOARD_DIR, 'index.html'))) {
    missing.push(join(DESKTOP_DASHBOARD_DIR, 'index.html'));
  }
  if (missing.length === 0) return;
  throw new Error(
    'The desktop app is not built. Run `pnpm --filter @adminium/desktop build` first ' +
      '(turbo does this via the @adminium/e2e#e2e:desktop ← @adminium/desktop#build edge), ' +
      'then rebuild native modules for Electron’s ABI in the desktop app ' +
      '(electron-builder install-app-deps) before running this suite.\n' +
      `Missing:\n  ${missing.join('\n  ')}`,
  );
}
