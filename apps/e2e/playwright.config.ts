/**
 * Playwright config for the 3-engine e2e matrix (M9-T05, 01-architecture.md
 * §11 task 01-T10): drives the BUILT server serving the BUILT dashboard,
 * seeded with the Northwind demo data by `scripts/e2e-server.mjs`.
 *
 * Engine selection (workplan/15-quality.md env-gate conventions):
 *   - default            → sqlite  (file DB, zero external services)
 *   - E2E_ENGINE=postgres → needs TEST_POSTGRES_URL (e.g. postgres://postgres:postgres@127.0.0.1:5432/postgres)
 *   - E2E_ENGINE=mysql    → needs TEST_MYSQL_URL    (e.g. mysql://root:root@127.0.0.1:3306 — same var as the
 *                           adapter-mysql live suite)
 *
 * Build first: `pnpm turbo run build --filter=@adminium/e2e...` (or let
 * `pnpm turbo run e2e` do it — the `e2e` task depends on `^build`).
 */
import { defineConfig, devices } from '@playwright/test';

import {
  ADMIN_EMAIL,
  ADMIN_NAME,
  ADMIN_PASSWORD,
  BASE_URL,
  E2E_DATABASE,
  ENGINE,
  PORT,
  SEED_CONNECTION_NAME,
  storageStatePath,
  TEST_MYSQL_URL,
  TEST_POSTGRES_URL,
} from './tests/constants.js';

if (ENGINE !== 'sqlite' && ENGINE !== 'postgres' && ENGINE !== 'mysql') {
  throw new Error(`E2E_ENGINE must be sqlite | postgres | mysql, got "${String(ENGINE)}"`);
}
if (ENGINE === 'postgres' && TEST_POSTGRES_URL === '') {
  throw new Error('E2E_ENGINE=postgres needs TEST_POSTGRES_URL (postgres://user:pass@127.0.0.1:5432/postgres)');
}
if (ENGINE === 'mysql' && TEST_MYSQL_URL === '') {
  throw new Error('E2E_ENGINE=mysql needs TEST_MYSQL_URL (mysql://root:root@127.0.0.1:3306)');
}

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1, // one shared server + seeded dataset; CRUD tests mutate it
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : [['list']],
  timeout: 60_000,
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    // One real UI sign-in per run (tests/auth.setup.ts): the §6 auth-login
    // bucket allows 5 logins/min/ip in PRODUCTION CODE, and this suite would
    // otherwise perform ~16 — the 6th would 429 by design. Every test then
    // reuses the saved session below.
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: storageStatePath() },
      dependencies: ['setup'],
    },
  ],
  webServer: {
    command: 'node scripts/e2e-server.mjs',
    // /api/v1/healthz answers only once the server listens — and the boot
    // script listens only AFTER Northwind is seeded, introspected, and pages
    // are generated, so a 200 here means the app is fully ready.
    url: `${BASE_URL}/api/v1/healthz`,
    reuseExistingServer: !process.env['CI'],
    timeout: 240_000,
    env: {
      ...process.env,
      E2E_ENGINE: ENGINE,
      E2E_PORT: String(PORT),
      E2E_ADMIN_EMAIL: ADMIN_EMAIL,
      E2E_ADMIN_NAME: ADMIN_NAME,
      E2E_ADMIN_PASSWORD: ADMIN_PASSWORD,
      E2E_CONNECTION_NAME: SEED_CONNECTION_NAME,
      E2E_DATABASE,
    },
  },
});
