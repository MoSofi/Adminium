/**
 * 11-T20 — the offline smoke test (11-electron.md §7).
 *
 * Launches the built app with a `session.webRequest` deny-all for every
 * non-loopback request, walks the same first-run → demo → dashboard → CRUD →
 * chart flow, and asserts ZERO blocked-request log entries: no Google Fonts, no
 * Leaflet/tile fetches (geo widgets render the choropleth grid), no CDN. Updates
 * are forced off with `ADMINIUM_DISABLE_UPDATES=1` and telemetry is off by
 * default, so an air-gapped install makes zero non-loopback requests — the
 * acceptance criterion.
 *
 * WHAT THIS COVERS AND WHAT IT DOES NOT. The deny-all sits on the renderer's
 * Chromium session, which is where fonts/tiles/CDN requests would originate. The
 * updater and the server's telemetry are Node-level in the main / utility
 * processes and do not traverse this session — so "zero update/telemetry
 * traffic" is enforced structurally (disabled mode never constructs the updater;
 * `ADMINIUM_DISABLE_TELEMETRY=1` vetoes server telemetry) and unit-tested
 * (apps/desktop/src/main/updates.test.ts), not observed here. This test's
 * contribution is proving the renderer walk is silent on the wire.
 */

import { randomBytes } from 'node:crypto';

import { expect, test, type ElectronApplication, type Page } from '@playwright/test';

import { editEmployeeTitle, readEmployeeTitle } from './helpers/api.js';
import { assertChartRenders, completeFirstRunDemo, openEmployeesGrid } from './helpers/flow.js';
import {
  closeDesktop,
  installOfflineDenyAll,
  launchDesktop,
  readBlockedRequests,
  waitForAppWindow,
} from './helpers/launch.js';

test.describe('desktop app: offline smoke (§7)', () => {
  test.describe.configure({ mode: 'serial' });

  let app: ElectronApplication;
  let userDataDir: string;
  let page: Page;

  test.beforeAll(async () => {
    // `ADMINIUM_DISABLE_UPDATES=1` forces `updates.mode=disabled` regardless of
    // config (§11 `resolveUpdateMode`), so there is no update traffic even during
    // a true first-run; telemetry is off by default (§7).
    ({ app, userDataDir } = await launchDesktop({ env: { ADMINIUM_DISABLE_UPDATES: '1' } }));
    // Install the deny-all BEFORE the SPA loads — the multi-second server boot is
    // the window in which it must be in place.
    await installOfflineDenyAll(app);
    page = await waitForAppWindow(app);
  });

  test.afterAll(async () => {
    await closeDesktop(app, userDataDir);
  });

  test('walks first-run → demo → dashboard → CRUD → chart making zero non-loopback requests', async () => {
    await completeFirstRunDemo(page);

    await openEmployeesGrid(page);
    const marker = `E2E ${randomBytes(4).toString('hex')}`;
    const record = await editEmployeeTitle(page, marker);
    expect(await readEmployeeTitle(page, record)).toBe(marker);

    await assertChartRenders(page);

    const blocked = await readBlockedRequests(app);
    expect(
      blocked,
      `the renderer attempted non-loopback requests during the offline walk:\n  ${blocked.join('\n  ')}`,
    ).toEqual([]);
  });
});
