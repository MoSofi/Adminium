// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The public API's surfaces through axe, in light and dark: the keys page,
 * the create-key sheet in both layouts, the endpoint builder stacked over it,
 * and the public `/api-docs` explorer — at desktop width and at 375 px, where
 * its three columns stack.
 *
 * Same sweep as `template-fit-a11y.spec.ts`: blocking impacts fail, lesser
 * ones are annotated, and a run that examined nothing fails too. Nothing is
 * created here except one endpoint grant for the explorer to list, which is
 * revoked again at the end.
 */
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

import { BASE_URL, publicApiStorageStatePath } from './constants.js';
import { seededConnectionId, signIn } from './helpers.js';

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

/*
 * The `api` bucket is 300 requests a minute PER PRINCIPAL, and the keys page
 * is a heavy load. On the shared admin these sweeps tipped the specs after
 * them into 429s, so they run as their own principal (constants.ts
 * `PUBLIC_API_ADMIN_EMAIL`).
 */
test.use({ storageState: publicApiStorageStatePath() });

test('the keys page, both sheet layouts and the builder are clean', async ({ page }, testInfo) => {
  test.slow();
  await signIn(page);
  const connectionId = await seededConnectionId(page);
  const tally: Sweep = { states: 0, minor: 0, failures: [] };
  try {
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme);
      await page.goto(`/studio/public-api?connection=${connectionId}`);
      await expect(page.getByRole('heading', { name: 'Active keys' })).toBeVisible();
      await sweep(page, `${theme}: the keys page`, tally, testInfo);

      // One load per theme: both layouts and the builder are swept from the
      // same open sheet, which is also the order a person meets them in.
      await page.getByRole('button', { name: 'Create key' }).first().click();
      const sheet = page.getByRole('dialog', { name: 'Create API key' });
      await expect(sheet).toBeVisible();
      for (const layout of ['Panes', 'List'] as const) {
        await sheet.getByRole('radio', { name: layout }).click();
        await sweep(page, `${theme}: the sheet, ${layout}`, tally, testInfo);
      }
      await sheet.getByRole('radio', { name: 'Panes' }).click();

      // The builder, stacked over the sheet: the lower sheet must be inert.
      await sheet.getByRole('button', { name: 'Edit endpoint' }).first().click();
      await expect(page.getByRole('dialog', { name: 'Edit endpoint' })).toBeVisible();
      await sweep(page, `${theme}: the builder over the sheet`, tally, testInfo);
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
    }
    expect(tally.states, 'every state was swept').toBeGreaterThanOrEqual(8);
    expect(tally.failures.join('\n\n')).toBe('');
    testInfo.annotations.push({ type: 'axe-summary', description: `${String(tally.states)} states, ${String(tally.minor)} lesser findings` });
  } finally {
    await setTheme(page, null);
  }
});

test('/api-docs is clean for a signed-out visitor, light and dark, desktop and phone', async ({ page, browser }, testInfo) => {
  test.slow();
  await signIn(page);
  const connectionId = await seededConnectionId(page);
  const put = await page.request.put('/api/v1/public-api', { data: { enabled: true, docsEnabled: true } });
  expect(put.status()).toBe(200);
  const created = await page.request.post('/api/v1/public-keys', {
    data: { name: 'E2E a11y reader', connectionId, access: [{ ref: 'orders', methods: ['GET', 'PATCH'] }] },
  });
  expect(created.status(), await created.text()).toBe(201);
  const { key } = (await created.json()) as { key: { id: string } };

  const tally: Sweep = { states: 0, minor: 0, failures: [] };
  const context = await browser.newContext({ baseURL: BASE_URL, storageState: { cookies: [], origins: [] } });
  const visitor = await context.newPage();
  try {
    for (const size of [{ width: 1440, height: 940 }, { width: 375, height: 812 }]) {
      await visitor.setViewportSize(size);
      await visitor.goto('/api-docs?resource=orders&endpoint=update');
      await expect(visitor.getByRole('heading', { level: 1, name: 'orders' })).toBeVisible();
      for (const theme of ['light', 'dark'] as const) {
        const toggle = visitor.getByRole('button', { name: theme === 'dark' ? 'Dark mode' : 'Light mode' });
        if (await toggle.isVisible()) await toggle.click();
        await expect(visitor.locator('html')).toHaveAttribute('data-theme', theme);
        await sweep(visitor, `${theme} ${String(size.width)}px: /api-docs`, tally, testInfo);
      }
    }
    expect(tally.states).toBeGreaterThanOrEqual(4);
    expect(tally.failures.join('\n\n')).toBe('');
    testInfo.annotations.push({ type: 'axe-summary', description: `${String(tally.states)} states, ${String(tally.minor)} lesser findings` });
  } finally {
    await context.close();
    await page.request.delete(`/api/v1/public-keys/${key.id}`);
    await page.request.put('/api/v1/public-api', { data: { enabled: false, docsEnabled: false } });
  }
});
