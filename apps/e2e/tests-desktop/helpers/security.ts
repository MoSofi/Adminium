/**
 * Renderer security posture + navigation lockdown assertions (11-electron.md
 * §2.4, and the acceptance criterion "Renderer security: contextIsolation on,
 * sandbox on, nodeIntegration off, navigation locked to the loopback origin,
 * external links open the system browser — verified in E2E").
 *
 * The posture is proven BEHAVIOURALLY, which is stronger than reading back a
 * `webPreferences` flag: the frozen `WEB_PREFERENCES` object is already
 * unit-tested in `apps/desktop/src/main/window.test.ts`, so what a real launch
 * adds is confirmation that the flags took EFFECT — that the running renderer
 * actually has no Node, and that the running window actually refuses to leave
 * loopback.
 */

import { expect, type ElectronApplication, type Page } from '@playwright/test';

import { appOrigin, readExternalOpens, stubExternalOpen } from './launch.js';

/**
 * contextIsolation on + sandbox on + nodeIntegration off, as the renderer can
 * observe them:
 *  - no `require`/`process`/`module` in the main world (nodeIntegration off,
 *    sandbox on);
 *  - the §4 preload bridge IS present — which is only reachable through
 *    `contextBridge`, so its presence is proof contextIsolation held (a leaked
 *    main-world assignment would fail with isolation on, and a bridge exposed
 *    without isolation would not be an isolated-world object at all).
 */
export async function assertRendererSecurity(page: Page): Promise<void> {
  const probe = await page.evaluate(() => {
    const world = window as unknown as Record<string, unknown>;
    return {
      require: typeof world['require'],
      process: typeof world['process'],
      module: typeof world['module'],
      bridge: typeof world['adminiumDesktop'],
    };
  });
  expect(probe.require, 'renderer must not expose require (nodeIntegration off)').toBe('undefined');
  expect(probe.process, 'renderer must not expose process (sandbox on)').toBe('undefined');
  expect(probe.module, 'renderer must not expose module').toBe('undefined');
  expect(probe.bridge, 'the §4 preload bridge must be exposed (contextIsolation on)').toBe('object');
}

/**
 * §2.4: navigation is locked to `http://127.0.0.1:<port>`; external `https:`
 * goes to the system browser (`shell.openExternal`); everything else goes
 * nowhere and is NOT handed to the OS.
 */
export async function assertNavigationLockdown(app: ElectronApplication, page: Page): Promise<void> {
  await stubExternalOpen(app);
  const origin = appOrigin(page);

  // (1) `target="_blank"` / window.open to an external https URL → system
  // browser, window unmoved (setWindowOpenHandler denies the child window).
  const externalUrl = 'https://adminium.example/docs';
  await page.evaluate((url) => {
    window.open(url, '_blank');
  }, externalUrl);
  await expect
    .poll(() => readExternalOpens(app), {
      message: 'an external https link must be handed to shell.openExternal',
      timeout: 10_000,
    })
    .toContain(externalUrl);
  expect(new URL(page.url()).origin, 'the window must stay on the loopback origin').toBe(origin);

  // (2) a top-level navigation to a denied scheme (`file:`) is cancelled and is
  // NOT passed to the OS (will-navigate → deny, never openExternal).
  await page.evaluate(() => {
    try {
      window.location.assign('file:///etc/hosts');
    } catch {
      /* blocked synchronously — also fine */
    }
  });
  // Give will-navigate a beat; the page must not have moved.
  await expect
    .poll(() => new URL(page.url()).origin, { timeout: 5_000 })
    .toBe(origin);
  const opens = await readExternalOpens(app);
  expect(opens, 'a file: URL must never reach shell.openExternal').not.toContain('file:///etc/hosts');
}
