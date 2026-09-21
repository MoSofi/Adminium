// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The template-fit surfaces, through axe, in light and dark.
 *
 * Every state a page's repair can be in on the create screen: the panel
 * explaining what a table lacks (with its offers of other tables and of the
 * missing columns), the exact statement those columns would run, and the
 * "start a new table" entry with its own review. Planning writes nothing, and
 * nothing here applies — this suite shares one seeded dataset.
 *
 * Same sweep as `create-dialog-a11y.spec.ts`: blocking impacts fail, lesser
 * ones are annotated, and a run that examined nothing fails too.
 */
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

import { chooseSeededSource, signIn } from './helpers.js';

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
    Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))),
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

async function startCalendar(page: Page): Promise<void> {
  await page.goto('/studio/pages/new');
  await page.getByTestId('studio-pages-template').selectOption('page-calendar');
  await chooseSeededSource(page);
  await expect(page.getByTestId('studio-pages-create-table')).toBeEnabled();
}

async function customersId(page: Page): Promise<string> {
  const values = await page
    .getByTestId('studio-pages-create-table')
    .locator('option')
    .evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).value));
  const id = values.find((value) => value.endsWith('.customers'));
  if (id === undefined) throw new Error(`no customers table: ${values.join(', ')}`);
  return id;
}

test('the template-fit panel, its reviews and the new-table entry are clean', async ({ page }, testInfo) => {
  test.slow();
  await signIn(page);
  const tally: Sweep = { states: 0, minor: 0, failures: [] };

  try {
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme);

      // A table that cannot back a calendar: the panel with every offer.
      await startCalendar(page);
      await page.getByTestId('studio-pages-create-table').selectOption(await customersId(page));
      await expect(page.getByTestId('studio-pages-fit-alternatives')).toBeVisible();
      await expect(page.getByTestId('studio-pages-fit-columns')).toBeVisible();
      await sweep(page, `${theme}: the fit panel`, tally, testInfo);

      // The statement the missing columns would run — reviewed, never applied.
      await page.getByTestId('studio-pages-fit-columns-plan').click();
      await expect(page.getByTestId('studio-pages-fit-columns-plan-review')).toBeVisible();
      await sweep(page, `${theme}: the add-columns review`, tally, testInfo);

      // No table at all: the new-table entry, and its review.
      await startCalendar(page);
      await page.getByTestId('studio-pages-create-new-table').click();
      await expect(page.getByTestId('studio-pages-fit-table-plan')).toBeEnabled();
      await sweep(page, `${theme}: the new-table entry`, tally, testInfo);
      await page.getByTestId('studio-pages-fit-table-plan').click();
      await expect(page.getByTestId('studio-pages-fit-table-plan-review')).toBeVisible();
      await sweep(page, `${theme}: the new-table review`, tally, testInfo);
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
