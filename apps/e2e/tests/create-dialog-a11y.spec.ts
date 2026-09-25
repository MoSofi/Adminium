// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE CREATE DIALOG AND THE FILTER BAR UNDER AXE, light and dark.
 *
 * Storybook's sweep covers the components in isolation. This covers them where
 * a person meets them: a real dialog over a real table, with the real values,
 * the real focus trap and the real theme tokens — which is where contrast and
 * labelling actually go wrong.
 *
 * EVERY SWEEP ASSERTS ITS OWN `passes`. An axe run that analysed nothing
 * reports zero violations, so "clean" and "did not run" are the same output;
 * a positive pass count is the only thing that tells them apart.
 *
 * AN OPEN LAYER IS ANALYSED WITHIN ITSELF. Radix marks everything outside a
 * modal `aria-hidden` while trapping focus inside it, and axe's
 * `aria-hidden-focus` rule reads that as "hidden but focusable" for every
 * overlay in the product. That is a primitive-versus-rule conflict recorded
 * elsewhere, not masked here: the page-level states still run over the whole
 * document.
 *
 * Theme is the signed-in user's own preference and is put back to "inherit" at
 * the end, because the suite shares one seeded account.
 */
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

import { signIn } from './helpers.js';

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
  // mid-transition reports its backdrop-blended colours and fails a contrast
  // check it passes at rest.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        // Not a spinner, whose animation never finishes.
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
  const builder = new AxeBuilder({ page }).withTags(TAGS);
  const results = await (within === undefined ? builder : builder.include(within)).analyze();

  // The negative control: a run that examined nothing would report zero
  // violations too.
  expect(results.passes.length, `${label}: axe examined nothing`).toBeGreaterThan(0);

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
  if (blocking.length > 0) {
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
    tally.failures.push(`${label} — ${String(blocking.length)} blocking:\n${report}`);
  }
}

async function setTheme(page: Page, theme: string | null): Promise<void> {
  const reply = await page.request.patch('/api/v1/me/prefs', { data: { theme } });
  expect(reply.ok(), `prefs → ${String(reply.status())}`).toBe(true);
}

test('the create dialog and the filter bar are clean in light and dark', async ({ page }, testInfo) => {
  test.slow();
  await signIn(page);
  const tally: Sweep = { states: 0, minor: 0, failures: [] };

  try {
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme);
      await page.goto('/p/shippers');
      await expect(page.getByRole('button', { name: /New row/ })).toBeVisible();
      await sweep(page, `${theme}: the table`, tally, testInfo);

      // The dialog, analysed within itself.
      await page.getByRole('button', { name: /New row/ }).click();
      const form = page.getByRole('dialog');
      await expect(form).toBeVisible();
      await sweep(page, `${theme}: the new dialog`, tally, testInfo, '[role="dialog"]');

      // …and the same dialog wearing its refusals, which is the state whose
      // colours and `aria-describedby` nothing else exercises.
      await form.getByRole('button', { name: /^(Create|Add) / }).click();
      await expect(form.locator('[aria-invalid="true"]').first()).toBeVisible();
      await sweep(page, `${theme}: the new dialog, refused`, tally, testInfo, '[role="dialog"]');
      await form.getByRole('button', { name: /Cancel/ }).click();
      await expect(form).toBeHidden();

      // The filter bar with a menu open: a popover is its own layer.
      await page.goto('/p/orders');
      const opener = page.locator('[data-testid^="filter-open-"]').first();
      await expect(opener).toBeVisible();
      await opener.click();
      await sweep(page, `${theme}: a filter menu`, tally, testInfo);
      await page.keyboard.press('Escape');
    }

    expect(tally.states, 'every state was swept').toBeGreaterThanOrEqual(8);
    expect(tally.failures.join('\n\n')).toBe('');
    testInfo.annotations.push({
      type: 'axe-summary',
      description: `${String(tally.states)} states, ${String(tally.minor)} lesser findings`,
    });
  } finally {
    await setTheme(page, null);
  }
});
