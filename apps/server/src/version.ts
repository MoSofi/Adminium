// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';

/**
 * App version read from apps/server/package.json at module load. The relative
 * hop works from both `src/` (vitest/tsx) and `dist/` (compiled) because both
 * sit one level below the package root.
 */
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

export const APP_VERSION: string = pkg.version;

/**
 * The name this CLI is published under on npm — the ONE place it is written
 * down, so nothing in the tree can drift onto a name we do not own.
 *
 * It is scoped and it does not match the workspace name: the unscoped npm name
 * `adminium` belongs to an unrelated third party, and so does the `@adminium`
 * scope, so `scripts/release/publish-npm.mjs` rewrites `@adminium/server` to
 * `@<NPM_SCOPE>/adminium` (default scope `adminiumjs`) at publish time. The
 * installed binary is still called `adminium`; only the install spec is scoped.
 * Keep this in sync with that script's `mappedName()` if `NPM_SCOPE` changes.
 */
export const NPM_PACKAGE_NAME = '@adminiumjs/adminium';
