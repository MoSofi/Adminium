/**
 * Shared constants for the e2e suite. `playwright.config.ts` forwards these
 * to `scripts/e2e-server.mjs` through `webServer.env`, so this file is the
 * single source of truth when tests run under Playwright. The boot script
 * carries identical fallbacks so `pnpm --filter @adminium/e2e e2e:server`
 * also works standalone (manual browsing).
 */

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type E2eEngine = 'sqlite' | 'postgres' | 'mysql';

export const ENGINE: E2eEngine = (process.env['E2E_ENGINE'] as E2eEngine | undefined) ?? 'sqlite';

/**
 * One default port per engine so a leftover local server from another leg is
 * never mistaken for this one (`webServer.reuseExistingServer`).
 */
const DEFAULT_PORTS: Record<E2eEngine, number> = { sqlite: 4610, postgres: 4611, mysql: 4612 };

export const PORT = Number(process.env['E2E_PORT'] ?? DEFAULT_PORTS[ENGINE] ?? 4610);

export const BASE_URL = `http://127.0.0.1:${String(PORT)}`;

/** Seeded super admin (created by scripts/e2e-server.mjs at boot). */
export const ADMIN_EMAIL = 'e2e@adminium.local';
export const ADMIN_NAME = 'E2E Admin';
export const ADMIN_PASSWORD = 'adminium-e2e-password';

/** Name of the connection the boot script seeds + generates pages for. */
export const SEED_CONNECTION_NAME = 'northwind';

/**
 * storageState file the `setup` project (tests/auth.setup.ts) writes and the
 * `chromium` project preloads into every context. Per engine, because the
 * legs run on different ports but 127.0.0.1 cookies ignore the port — two
 * legs sharing one file could hand each other dead sessions. Lives under the
 * gitignored `.playwright/`.
 */
export function storageStatePath(): string {
  return fileURLToPath(
    new URL(`../.playwright/auth/state-${ENGINE}.json`, import.meta.url),
  );
}

/** postgres/mysql: database (re)created by the boot script on the service. */
export const E2E_DATABASE = 'adminium_e2e';

/** Engine-gated URL env vars, aligned with the adapter live-suite gates. */
export const TEST_POSTGRES_URL = process.env['TEST_POSTGRES_URL'] ?? '';
export const TEST_MYSQL_URL = process.env['TEST_MYSQL_URL'] ?? '';

/** The DSN the Studio wizard test types in (postgres engine only). */
export function wizardDsn(): string {
  const url = new URL(TEST_POSTGRES_URL);
  url.pathname = `/${E2E_DATABASE}`;
  return url.toString();
}

/**
 * Deterministic on-disk path of the sqlite Northwind the boot script seeds
 * (`scripts/e2e-server.mjs` computes the identical path). Shared by the seeded
 * `northwind` connection AND the T15 enrichment wizard leg, so the test can type
 * a real DSN into the wizard without knowing a per-run temp path. Kept in
 * `tmpdir()` (not a mkdtemp subdir) precisely so both processes derive it.
 */
export function sqliteSourcePath(): string {
  return join(tmpdir(), `adminium-e2e-source-sqlite-${String(PORT)}.db`);
}

/**
 * The DSN the T15 golden-enrichment wizard leg types in, per engine. sqlite uses
 * the deterministic seeded file; postgres/mysql point the new connection at the
 * already-seeded `E2E_DATABASE` (a second connection to the same DB, as the
 * studio-wizard leg already does for postgres).
 */
export function enrichWizardDsn(): string {
  if (ENGINE === 'sqlite') return `sqlite:${sqliteSourcePath()}`;
  if (ENGINE === 'postgres') return wizardDsn();
  const url = new URL(TEST_MYSQL_URL);
  url.pathname = `/${E2E_DATABASE}`;
  return url.toString();
}
