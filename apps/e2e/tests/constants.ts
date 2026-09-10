// SPDX-License-Identifier: AGPL-3.0-only
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

/**
 * The FIRST-RUN instance: a second server, migrated and empty, where
 * `setup.state.required` is still true (`scripts/e2e-server.mjs` with
 * `E2E_FIRST_RUN=1`). The six-step onboarding wizard cannot be walked on the
 * shared server at all — that one seeds a super admin before it listens, and
 * the route guard bounces `/setup` to `/login` the moment setup is closed.
 *
 * `+20` sits clear of the engine ports (4610-4612) and of the SMTP sink and its
 * message endpoint, which take `+100` and `+101`.
 */
export const FIRST_RUN_PORT = PORT + 20;
export const FIRST_RUN_BASE_URL = `http://127.0.0.1:${String(FIRST_RUN_PORT)}`;

/** Seeded super admin (created by scripts/e2e-server.mjs at boot). */
export const ADMIN_EMAIL = 'e2e@adminium.local';
export const ADMIN_NAME = 'E2E Admin';
export const ADMIN_PASSWORD = 'adminium-e2e-password';

/**
 * A SECOND super admin, used only by `files.spec.ts`.
 *
 * The `api` rate bucket is 300 requests per minute PER PRINCIPAL
 * (`plugins/core.ts` RATE_BUCKETS). This suite runs serially as one signed-in
 * user, so every spec spends from one budget — and the files specs are the
 * expensive ones: real uploads, a schema plan+apply, a create dialog. Adding
 * them pushed the run over the ceiling, which surfaced as a 429 rendering the
 * rate-limit page in an unrelated spec and read as an SMTP failure.
 *
 * A second principal gives them their own budget. Same reasoning as the
 * storageState above, one bucket up: exercise the shipped limit, do not
 * weaken it for tests.
 */
export const FILES_ADMIN_EMAIL = 'e2e-files@adminium.local';
export const FILES_ADMIN_NAME = 'E2E Files Admin';
export const FILES_ADMIN_PASSWORD = 'adminium-e2e-password';

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

/** The files specs' own session — see {@link FILES_ADMIN_EMAIL}. */
export function filesStorageStatePath(): string {
  return fileURLToPath(
    new URL(`../.playwright/auth/state-files-${ENGINE}.json`, import.meta.url),
  );
}

/** postgres/mysql: database (re)created by the boot script on the service. */
export const E2E_DATABASE = 'adminium_e2e';

/** The SMTP sink's ports derive from the API port (scripts/e2e-server.mjs does the same arithmetic). */
export const SMTP_PORT = Number(process.env['E2E_SMTP_PORT'] ?? PORT + 100);
export const SINK_URL = `http://127.0.0.1:${String(process.env['E2E_SINK_PORT'] ?? PORT + 101)}`;

/** One captured message, as the sink's `GET /messages` returns it. */
export interface SinkMessage {
  receivedAt: number;
  envelope: { from: string; to: string[] };
  subject: string;
  from: string;
  to: string[];
  html: string;
  text: string;
  attachments: { filename: string; contentType: string; cid: string | null; size: number; related: boolean }[];
}

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
