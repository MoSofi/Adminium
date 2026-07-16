#!/usr/bin/env node
/**
 * Copy the dashboard build into the published package (01-architecture.md §4.1:
 * the `adminium` package "bundles the server, the dashboard `dist/`, and the
 * meta migrations — one `npx adminium` is a complete install").
 *
 *   node scripts/bundle-dashboard.mjs [--check]
 *
 * apps/dashboard/dist/ → apps/server/dashboard/, which is (a) on the `files`
 * allow-list and (b) the first candidate `src/cli/static-root.ts` probes. In a
 * dev checkout nothing needs to run this: the resolver's second candidate is
 * apps/dashboard/dist itself. It exists for `prepack`, where the tarball must
 * carry the build because apps/dashboard is not published.
 *
 * `--check` reports what would be copied and exits non-zero if the dashboard
 * build is missing — for the release pipeline to fail loudly rather than publish
 * an API-only tarball.
 */

import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const serverRoot = join(here, '..');
const dashboardDist = join(serverRoot, '..', 'dashboard', 'dist');
const target = join(serverRoot, 'dashboard');

const check = process.argv.includes('--check');

if (!existsSync(join(dashboardDist, 'index.html'))) {
  console.error(
    `Dashboard build not found at ${dashboardDist}.\n` +
      'Build it first: pnpm --filter @adminium/dashboard build',
  );
  process.exit(1);
}

if (check) {
  const info = await stat(dashboardDist);
  console.log(`ok — dashboard build present (${dashboardDist}, mtime ${info.mtime.toISOString()})`);
  process.exit(0);
}

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(dashboardDist, target, { recursive: true });
console.log(`Bundled dashboard build → ${target}`);
