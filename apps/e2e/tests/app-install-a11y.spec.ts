// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/studio/apps` and the install wizard under axe (47-app-installation.md
 * step 3): the page with nothing installed, the page with an app on it, the
 * uninstall dialog, and each of the wizard's steps — including the plan step
 * with its DDL preview open, which is the one state that paints a dark code
 * block on a themed page. Each in light and dark. Zero serious/critical
 * violations is the gate; lesser counts are annotated per state so a
 * regression in them is visible in the report.
 *
 * THE SWEEP ASSERTS IT ANALYSED SOMETHING. An `AxeBuilder` pointed at a
 * selector that matches nothing returns zero violations and reports success, so
 * every state also asserts a floor on `passes` — without it this file could go
 * green while measuring an empty page, which is the failure mode a11y suites
 * fail in silently.
 *
 * AN OPEN LAYER IS ANALYSED WITHIN ITSELF. Radix marks everything outside a
 * modal `aria-hidden` and traps focus inside it; axe's `aria-hidden-focus` rule
 * reads the trapped-out background as "hidden but focusable" and fails every
 * overlay in the product. That conflict is recorded in 39 §6.1 and is not
 * masked here — page-level states still run over the whole document.
 *
 * Theme is the signed-in user's own pref, restored afterwards, because the
 * suite shares one seeded account and runs serially.
 */
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

import { APP_KEY, APP_VERSION, appBundle } from './appBundle.js';
import { signIn, seededConnectionId } from './helpers.js';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const BLOCKING = new Set(['critical', 'serious']);

interface Sweep {
  states: number;
  minor: number;
  failures: string[];
}

async function sweep(
  page: Page,
  label: string,
  tally: Sweep,
  testInfo: TestInfo,
  within?: string,
): Promise<void> {
  // Overlays fade in; axe reads computed colours, so a dialog measured
  // mid-transition reports backdrop-blended colours and fails contrast it
  // passes at rest.
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))),
  );
  const builder = new AxeBuilder({ page }).withTags(TAGS);
  const results = await (within === undefined ? builder : builder.include(within)).analyze();

  expect(results.passes.length, `${label}: axe analysed nothing`).toBeGreaterThan(10);

  const blocking = results.violations.filter((violation) => BLOCKING.has(violation.impact ?? ''));
  const lesser = results.violations.filter((violation) => !BLOCKING.has(violation.impact ?? ''));
  tally.states += 1;
  tally.minor += lesser.length;
  if (lesser.length > 0) {
    testInfo.annotations.push({
      type: 'axe-lesser',
      description: `${label}: ${lesser.map((v) => `${String(v.impact)}:${v.id}`).join(', ')}`,
    });
  }
  const report = blocking
    .map(
      (v) =>
        `${String(v.impact)}: ${v.id} — ${v.help}\n` +
        v.nodes
          .slice(0, 4)
          .map((n) => `    ${n.target.join(' ')}\n      ${n.html.slice(0, 200)}`)
          .join('\n'),
    )
    .join('\n');
  // Collected, not thrown: one run should name EVERY failing state.
  if (blocking.length > 0) tally.failures.push(`${label} — ${String(blocking.length)} blocking:\n${report}`);
}

async function setTheme(page: Page, theme: string | null): Promise<void> {
  const reply = await page.request.patch('/api/v1/me/prefs', { data: { theme, locale: null } });
  expect(reply.ok(), `prefs → ${String(reply.status())}`).toBe(true);
}

/** Uploads + installs the reuse bundle over the API, for the "installed" states. */
async function installOverApi(page: Page, connectionId: string): Promise<void> {
  const bundle = appBundle('reuse');
  const query = new URLSearchParams({
    key: APP_KEY,
    version: APP_VERSION,
    expectedSha512: bundle.integrity,
  });
  const uploaded = await page.request.post(`/api/v1/apps/upload?${query.toString()}`, {
    headers: { 'content-type': 'application/octet-stream' },
    data: bundle.buffer,
  });
  expect(uploaded.ok(), await uploaded.text()).toBe(true);
  const installed = await page.request.post('/api/v1/apps/install', {
    data: { key: APP_KEY, version: APP_VERSION, connectionId },
  });
  expect(installed.ok(), await installed.text()).toBe(true);
}

/** Drives the wizard to the plan step with the DDL preview open. */
async function toPlanStep(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Install an app' }).click();
  const bundle = appBundle('create');
  await page.locator('input[type="file"]').setInputFiles({
    name: `${APP_KEY}-${APP_VERSION}.tgz`,
    mimeType: 'application/gzip',
    buffer: bundle.buffer,
  });
  await page.getByLabel(/Integrity/).fill(bundle.integrity);
}

test.describe.configure({ mode: 'serial' });

test.describe('/studio/apps under axe', () => {
  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.request.delete(`/api/v1/apps/${APP_KEY}`).catch(() => undefined);
    await page.request.patch('/api/v1/me/prefs', { data: { theme: null, locale: null } }).catch(() => undefined);
    await page.close();
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`every state, ${theme}`, async ({ page }, testInfo) => {
      test.setTimeout(180_000);
      const tally: Sweep = { states: 0, minor: 0, failures: [] };

      await signIn(page);
      const connectionId = await seededConnectionId(page);
      await setTheme(page, theme);
      await page.goto('/studio/apps');
      await expect(page.getByRole('heading', { name: 'Hosted apps' })).toBeVisible();

      /*
       * THE THEME IS PROVEN, NOT ASSUMED — and the first draft of this probe is
       * why the check is written twice over.
       *
       * It read `[data-part="app-shell"], main`, and both themes came back
       * `rgba(0, 0, 0, 0)`: those elements are transparent, so the "dark" run
       * would have swept a light page and reported two green themes. So the
       * attribute the provider actually stamps is asserted, AND the colour is
       * read off an element with a background token on it.
       */
      const probe = await page.evaluate(() => {
        const card = document.querySelector('.bg-surface') ?? document.body;
        return {
          attribute: document.documentElement.getAttribute('data-theme'),
          painted: getComputedStyle(card).backgroundColor,
        };
      });
      expect(probe.attribute, 'the theme pref never reached the document').toBe(theme);
      expect(probe.painted, 'the probe read an unpainted element').not.toBe('rgba(0, 0, 0, 0)');
      testInfo.annotations.push({
        type: 'theme-probe',
        description: `${theme}: data-theme=${String(probe.attribute)} surface=${probe.painted}`,
      });

      await expect(page.getByText('No apps installed yet')).toBeVisible();
      await sweep(page, `${theme} · page, nothing installed`, tally, testInfo);

      // ── the wizard ────────────────────────────────────────────────────
      await toPlanStep(page);
      await sweep(page, `${theme} · wizard, bundle step`, tally, testInfo);

      await page.getByRole('button', { name: 'Upload' }).click();
      await expect(page.getByText('Install into which database?')).toBeVisible();
      await sweep(page, `${theme} · wizard, database step`, tally, testInfo);

      // Back to the bundle step, which now confirms the app the upload read
      // from its manifest instead of showing the file picker again.
      await page.getByRole('button', { name: 'Back' }).click();
      await expect(page.getByText('Install E2E Desk')).toBeVisible();
      await sweep(page, `${theme} · wizard, bundle step after the upload`, tally, testInfo);
      await page.getByRole('button', { name: 'Continue' }).click();
      await expect(page.getByText('Install into which database?')).toBeVisible();

      await page.getByRole('radio', { name: /northwind/i }).click();
      await page.getByRole('button', { name: 'Continue' }).click();
      await expect(page.getByText('Review the schema plan')).toBeVisible();
      await sweep(page, `${theme} · wizard, plan step`, tally, testInfo);

      await page.getByRole('button', { name: 'Show the DDL preview' }).click();
      await expect(page.getByText('CREATE TABLE e2e_app_probe')).toBeVisible();
      await sweep(page, `${theme} · wizard, plan step with DDL open`, tally, testInfo);

      // Cancel writes nothing — the staged bundle is all that is left, and the
      // install below replaces it.
      await page.getByRole('button', { name: 'Cancel' }).click();

      // ── installed, and the dialog that removes it ─────────────────────
      await installOverApi(page, connectionId);
      await page.reload();
      await expect(page.getByText(`/apps/${APP_KEY}/staff/`).first()).toBeVisible();
      /*
       * The SHELF has a card by now — the package is on disk, so the catalogue
       * lists it — and this assertion is what stops the sweep below passing
       * over an empty shelf and reporting the card state as covered.
       */
      await expect(page.getByRole('article').filter({ hasText: 'E2E Desk' })).toBeVisible();
      await sweep(page, `${theme} · page, one app installed`, tally, testInfo);

      await page.getByRole('button', { name: 'Uninstall' }).first().click();
      await expect(page.getByText(/tables it created in your database are left alone/i)).toBeVisible();
      await sweep(page, `${theme} · uninstall dialog`, tally, testInfo, '[role="dialog"]');

      await page.keyboard.press('Escape');
      await page.request.delete(`/api/v1/apps/${APP_KEY}`);

      testInfo.annotations.push({
        type: 'axe-summary',
        description: `${theme}: ${String(tally.states)} states, ${String(tally.minor)} lesser`,
      });
      expect(tally.states, 'no state was swept').toBeGreaterThanOrEqual(8);
      expect(tally.failures.join('\n\n')).toBe('');
    });
  }
});
