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
