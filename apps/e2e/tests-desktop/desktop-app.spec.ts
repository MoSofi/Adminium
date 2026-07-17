/**
 * 11-T20 — the desktop E2E happy path (Playwright `_electron`).
 *
 * Launches the BUILT app (`apps/desktop/out/main/index.js`) and walks §6's
 * first-run → demo DB → dashboard → CRUD edit → chart render → backup, asserting
 * the §2.4 renderer security posture along the way. One app, launched once, is
 * driven serially — the flow is stateful (the wizard builds the database the
 * later steps read).
 *
 * This runs in CI (a display + a native-ABI rebuild are prerequisites — see
 * `helpers/paths.ts`). It is gated behind the `desktop-e2e` Playwright project
 * and the `e2e:desktop` script, so it never runs in the repo-wide `pnpm test`.
 */

import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test, type ElectronApplication, type Page } from '@playwright/test';

import { editEmployeeTitle, readEmployeeTitle } from './helpers/api.js';
import { assertChartRenders, completeFirstRunDemo, openEmployeesGrid } from './helpers/flow.js';
import {
  closeDesktop,
  launchDesktop,
  stubBackupDialogs,
  triggerMenuItem,
  waitForAppWindow,
} from './helpers/launch.js';
import { assertNavigationLockdown, assertRendererSecurity } from './helpers/security.js';

test.describe('desktop app: first-run → demo → dashboard → CRUD → chart → backup', () => {
  test.describe.configure({ mode: 'serial' });

  let app: ElectronApplication;
  let userDataDir: string;
  let page: Page;

  test.beforeAll(async () => {
    ({ app, userDataDir } = await launchDesktop());
    page = await waitForAppWindow(app);
  });

  test.afterAll(async () => {
    await closeDesktop(app, userDataDir);
  });

  test('renderer security: isolation on, sandbox on, node off, bridge present', async () => {
    // Asserted on the first-run wizard page — already the loopback SPA, so the
    // posture holds before we touch anything.
    await assertRendererSecurity(page);
  });

  test('first-run wizard builds the demo database and opens the app', async () => {
    await completeFirstRunDemo(page);
  });

  test('CRUD edit round-trips through the embedded server to SQLite', async () => {
    await openEmployeesGrid(page);
    const marker = `E2E ${randomBytes(4).toString('hex')}`;
    const record = await editEmployeeTitle(page, marker);
    expect(await readEmployeeTitle(page, record), 'the edit must persist through the embedded stack').toBe(
      marker,
    );
  });

  test('generated dashboard renders a chart', async () => {
    await assertChartRenders(page);
  });

  test('navigation is locked to loopback; external links open the system browser', async () => {
    await assertNavigationLockdown(app, page);
  });

  test('backup writes a §9 archive via the File → Back up now… menu item', async () => {
    const savePath = join(mkdtempSync(join(tmpdir(), 'adminium-backup-')), 'adminium-backup-e2e.zip');
    await stubBackupDialogs(app, savePath);

    const fired = await triggerMenuItem(app, 'Back up now');
    expect(fired, 'the File → Back up now… menu item must exist and be wired').toBe(true);

    await expect
      .poll(() => existsSync(savePath), {
        message: 'the backup archive must be written to the chosen path',
        timeout: 60_000,
      })
      .toBe(true);

    // §9's archive is a zip: assert the PK\x03\x04 local-file-header magic.
    const head = readFileSync(savePath).subarray(0, 4);
    expect([head[0], head[1], head[2], head[3]], 'backup must be a real zip archive').toEqual([
      0x50, 0x4b, 0x03, 0x04,
    ]);
  });
});
