// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The page assistant under axe: every phase the modal has — idle, asking,
 * working, a result with each of its three tabs, the read-only bar, the
 * unavailable bar, the confirm layered over it — in light and dark, LTR
 * (en_US) and RTL (ar_EG), at 1440 × 940 and at 390 px. Zero serious/critical
 * violations is the gate; the lesser counts are annotated per state so a
 * regression in them is visible in the report.
 *
 * AN ANALYSIS OF NOTHING REPORTS ZERO VIOLATIONS. Every sweep therefore
 * asserts that axe actually had something to look at (`passes.length` above a
 * floor) — a selector that stopped matching would otherwise turn this file
 * into a very reassuring no-op.
 *
 * IT OWNS THE PROVIDER. This file sorts before `assistant.spec.ts` (`-` < `.`),
 * so it cannot inherit one: it configures the scripted provider itself and
 * clears it afterwards, because `llm.enabled` is bootstrap state for the whole
 * instance.
 *
 * AN OPEN LAYER IS ANALYSED WITHIN ITSELF. Radix marks everything outside a
 * dialog `aria-hidden` and traps focus inside it; axe's `aria-hidden-focus`
 * rule reads the trapped-out background as "hidden but focusable" and fails
 * every overlay in the product. That is a primitive-versus-rule conflict
 * recorded across this suite, not masked here — the page-level states still
 * run over the whole document.
 *
 * Theme and locale are the signed-in user's own prefs, restored to "inherit"
 * afterwards because the suite shares one account and runs serially. Every
 * selector is a test id or a role without a name: in Arabic the names are
 * Arabic.
 */
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

import { clearProvider, configureFakeProvider, signIn } from './helpers.js';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const BLOCKING = new Set(['critical', 'serious']);

const COMBOS = [
  { theme: 'light', locale: 'en_US' },
  { theme: 'dark', locale: 'en_US' },
  { theme: 'light', locale: 'ar_EG' },
  { theme: 'dark', locale: 'ar_EG' },
] as const;

interface Sweep {
  states: number;
  minor: number;
}

async function sweep(page: Page, label: string, tally: Sweep, testInfo: TestInfo, within?: string): Promise<void> {
  // Overlays fade in; axe reads computed colours, so a dialog measured mid-transition
  // reports its backdrop-blended colours and fails contrast it passes at rest.
  await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))));
  const builder = new AxeBuilder({ page }).withTags(TAGS);
  const results = await (within === undefined ? builder : builder.include(within)).analyze();
  // The floor that makes a green run mean something: a modal has a dialog, a
  // heading, buttons and text, so a handful of rules always have work to do.
  expect(results.passes.length, `${label} — axe analysed nothing`).toBeGreaterThan(3);
  const blocking = results.violations.filter((violation) => BLOCKING.has(violation.impact ?? ''));
  const lesser = results.violations.filter((violation) => !BLOCKING.has(violation.impact ?? ''));
  tally.states += 1;
  tally.minor += lesser.length;
  if (lesser.length > 0) {
    testInfo.annotations.push({ type: 'axe-lesser', description: `${label}: ${lesser.map((v) => `${String(v.impact)}:${v.id}`).join(', ')}` });
  }
  const report = blocking
    .map(
      (v) =>
        `${String(v.impact)}: ${v.id} — ${v.help}\n` +
        v.nodes
          .slice(0, 4)
          .map((n) => `    ${n.target.join(' ')}\n      ${n.html.slice(0, 160)}`)
          .join('\n'),
    )
    .join('\n');
  expect(blocking, `${label} has ${String(blocking.length)} blocking violations:\n${report}`).toEqual([]);
}

async function setPrefs(page: Page, prefs: { theme: string | null; locale: string | null }): Promise<void> {
  const reply = await page.request.patch('/api/v1/me/prefs', { data: prefs });
  expect(reply.ok(), `prefs → ${String(reply.status())}`).toBe(true);
}

const modal = (page: Page) =>
  page.getByRole('dialog').filter({ has: page.getByTestId('assistant-thread') });

/**
 * The two dialogs, as axe `include` selectors.
 *
 * `:has()` rather than the test id alone, because the handle is on the BODY
 * and a dialog's heading and buttons are siblings of it — including the body
 * analysed two rules and nothing else, which the `passes.length` floor caught
 * the first time this file ran.
 */
const DIALOG = '[role="dialog"]:has([data-testid="assistant-thread"])';
const CONFIRM = '[role="dialog"]:has([data-testid="assistant-confirm"])';

async function openAssistant(page: Page): Promise<void> {
  await page.getByTestId('ask-assistant').click();
  await expect(modal(page)).toBeVisible({ timeout: 20_000 });
}

/** Ids this spec created, removed in `afterAll` whatever happened. */
const made: string[] = [];

test.describe('the page assistant under axe', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await signIn(page);
    await configureFakeProvider(page);
    await page.close();
  });

  test.afterAll(async ({ browser }) => {
    // API only: `signIn` reads the English navigation label, and the last
    // combination leaves the shared account in Arabic until this reset lands.
    const page = await browser.newPage();
    await setPrefs(page, { theme: null, locale: null });
    for (const id of made) await page.request.delete(`/api/v1/email-templates/${id}`);
    await clearProvider(page);
    await page.close();
  });

  for (const combo of COMBOS) {
    test(`${combo.theme} · ${combo.locale}: every phase of the window`, async ({ page }, testInfo) => {
      test.setTimeout(300_000);
      const tally: Sweep = { states: 0, minor: 0 };
      await setPrefs(page, { theme: null, locale: null }); // the previous combination's prefs would sign in in Arabic
      await signIn(page);
      await setPrefs(page, { theme: combo.theme, locale: combo.locale });

      // --- idle -----------------------------------------------------------------
      await page.goto('/email-templates');
      await expect(page.getByTestId('email-manager')).toBeVisible();
      await sweep(page, `${combo.theme}/${combo.locale} manager with the Ask button`, tally, testInfo);

      await openAssistant(page);
      await sweep(page, `${combo.theme}/${combo.locale} idle`, tally, testInfo, DIALOG);

      // --- working, then a result ------------------------------------------------
      await modal(page).getByTestId('assistant-chip').first().click();
      await expect(modal(page).getByTestId('assistant-steps')).toBeVisible({ timeout: 20_000 });
      await sweep(page, `${combo.theme}/${combo.locale} working`, tally, testInfo, DIALOG);

      await expect(modal(page).getByTestId('assistant-steps')).toHaveAttribute('data-state', /done|failed/, { timeout: 30_000 });
      const result = modal(page).getByTestId('assistant-result');
      await expect(result).toBeVisible();
      await sweep(page, `${combo.theme}/${combo.locale} result · preview`, tally, testInfo, DIALOG);

      for (const tab of ['diff', 'details'] as const) {
        await result.locator(`[data-testid="assistant-tab"][data-tab="${tab}"]`).click();
        await sweep(page, `${combo.theme}/${combo.locale} result · ${tab}`, tally, testInfo, DIALOG);
      }

      // --- the read-only bar, and the confirm layered over it ---------------------
      await expect(modal(page).getByTestId('assistant-readonly')).toBeVisible();
      await modal(page).getByTestId('assistant-enable').click();
      await modal(page).locator('[data-testid="assistant-action"][data-action="save"]').click();
      await expect(page.getByTestId('assistant-confirm')).toBeVisible();
      // The confirm is a second dialog OVER the first; analysed within itself
      // for the reason in this file's header.
      await sweep(page, `${combo.theme}/${combo.locale} confirm`, tally, testInfo, CONFIRM);
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('assistant-confirm')).toBeHidden();

      // --- 390 px, where the header wraps and the sheet is at its narrowest -------
      await page.setViewportSize({ width: 390, height: 844 });
      await sweep(page, `${combo.theme}/${combo.locale} result at 390px`, tally, testInfo, DIALOG);
      await page.setViewportSize({ width: 1440, height: 940 });

      // --- the unavailable bar ----------------------------------------------------
      await page.keyboard.press('Escape');
      await clearProvider(page);
      try {
        await page.reload();
        await expect(page.getByTestId('email-manager')).toBeVisible();
        await openAssistant(page);
        await expect(modal(page).getByTestId('assistant-unavailable')).toBeVisible({ timeout: 20_000 });
        await sweep(page, `${combo.theme}/${combo.locale} unavailable`, tally, testInfo, DIALOG);
      } finally {
        await configureFakeProvider(page);
      }

      testInfo.annotations.push({
        type: 'axe-summary',
        description: `${combo.theme}/${combo.locale}: ${String(tally.states)} states swept, ${String(tally.minor)} lesser violations`,
      });
      expect(tally.states, 'every state was swept').toBeGreaterThanOrEqual(9);
    });
  }
});
