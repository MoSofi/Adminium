// SPDX-License-Identifier: AGPL-3.0-only
/**
 * OFFERS UNDER AXE.
 *
 * The Overview and the screens that are the add-on's own code — the list of
 * discounts, a discount being written, Look up with nothing found yet and
 * with a gift card found, the Issue sheet and Offer rules — with the sample
 * data in, swept in light and dark, in English and in Arabic (right to left),
 * at 1440 and at 390 pixels: fifty-six states. The screens are drawn by the
 * add-on with the dashboard's own parts, so what goes wrong here is what a
 * person meets — a heading order, a control with no name, a colour that only
 * fails on the dark theme or under a translated, longer label.
 *
 * EVERY SWEEP ASSERTS ITS OWN `passes`: an axe run that analysed nothing
 * reports zero violations too.
 *
 * Needs what `offers.spec.ts` needs (the built add-ons checkout, a server of
 * 0.3.19 or later, the add-on trusted), and skips saying which is missing.
 * The reader's theme and language are put back at the end: the suite shares
 * one seeded account.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page, type TestInfo } from '@playwright/test';

const KEY = 'offers';
const REPO = process.env['ADMINIUM_ADD_ONS_REPO'];
const PACKAGE = REPO === undefined || REPO === '' ? null : join(REPO, 'packages', KEY);
const built = PACKAGE !== null && ['server.js', 'documents.js', 'pages/look-up.js', 'pages/discounts.js', 'pages/issue.js', 'pages/rules.js'].every((file) => existsSync(join(PACKAGE, 'dist', file)));

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

async function cleanUp(request: APIRequestContext): Promise<void> {
  await request.delete(`/api/v1/add-ons/${KEY}`, { data: { dropTables: true, confirmKey: KEY } });
}
async function setReader(page: Page, prefs: { theme: string | null; locale: string | null }): Promise<void> {
  const reply = await page.request.patch('/api/v1/me/prefs', { data: prefs });
  expect(reply.ok(), `prefs → ${String(reply.status())}`).toBe(true);
}

/** The sample card the guide quotes. */
const CARD = 'GC-7K2M-W3HN-Q4XP';

/** The screens, each with what shows once it has drawn, and what is done on it before it is swept. */
const SCREENS: readonly [label: string, path: string, ready: string, before?: (page: Page) => Promise<void>][] = [
  ['the Overview', '/p/offers-overview', 'main [data-widget-type], main article, main section'],
  ['Discounts', '/add-ons/offers/offers-discounts', 'text=Autumn 5'],
  ['a new discount', '/add-ons/offers/offers-discounts/new', 'input[type="text"], input:not([type])'],
  ['Look up', '/add-ons/offers/offers-look-up', 'input[placeholder*="GC-"]'],
  [
    'Look up, a card found',
    '/add-ons/offers/offers-look-up',
    'input[placeholder*="GC-"]',
    async (page) => {
      const field = page.locator('input[placeholder*="GC-"]').first();
      await field.fill(CARD);
      await field.press('Enter');
      await expect(page.locator('text=Q4XP').first(), 'the card was not found').toBeVisible({ timeout: 30_000 });
    },
  ],
  ['Issue', '/add-ons/offers/offers-issue', '[role="dialog"] [role="tablist"]'],
  ['Offer rules', '/add-ons/offers/offers-rules', 'text=/Add a rule|إضافة قاعدة/'],
];

test.describe('Offers under axe', () => {
  test.skip(!built, 'the add-ons checkout is not built here: set ADMINIUM_ADD_ONS_REPO to it and run `npm run build` in packages/offers');
  test.skip(!(process.env['ADMINIUM_ADD_ON_DEV_TRUST'] ?? '').split(',').includes(KEY), 'an uploaded add-on\'s deciding file runs only when trusted: set ADMINIUM_ADD_ON_DEV_TRUST=offers');

  test.afterEach(async ({ page }) => {
    await setReader(page, { theme: null, locale: null });
    await cleanUp(page.request);
  });

  test('the Overview and the screens are clean in light and dark, in English and Arabic, wide and narrow', async ({ page }, testInfo) => {
    test.setTimeout(600_000);
    await page.goto('/');
    const staff = page.request;
    await cleanUp(staff);
    const out = mkdtempSync(join(tmpdir(), 'adminium-offers-'));
    const [packed] = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', out], { cwd: PACKAGE!, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })) as { filename: string; version: string }[];
    const bytes = readFileSync(join(out, packed!.filename));
    const upload = await staff.post(`/api/v1/add-ons/upload?expectedSha512=${encodeURIComponent(`sha512-${createHash('sha512').update(bytes).digest('base64')}`)}`, { headers: { 'content-type': 'application/octet-stream' }, data: bytes });
    const refused = upload.ok() ? '' : await upload.text();
    test.skip(refused.includes('REQUIRES_NEWER_ADMINIUM'), 'this build is older than 0.3.19: Offers asks a price question and brings a card in under its own code, which a server does from 0.3.19 on');
    expect(upload.ok(), refused).toBe(true);
    expect((await staff.post('/api/v1/add-ons', { data: { key: KEY, version: packed!.version, attachTo: [] } })).ok()).toBe(true);
    expect((await staff.post(`/api/v1/add-ons/${KEY}/sample-data`)).ok()).toBe(true);
    await expect.poll(async () => ((await (await staff.get(`/api/v1/add-ons/${KEY}/sample-data`)).json()) as { total: number }).total, { timeout: 120_000, intervals: [1000] }).toBe(706);

    const tally: Sweep = { states: 0, minor: 0, failures: [] };
    for (const theme of ['light', 'dark'] as const) {
      for (const locale of ['en_US', 'ar_EG'] as const) {
        await setReader(page, { theme, locale });
        for (const width of [1440, 390] as const) {
          await page.setViewportSize({ width, height: 900 });
          for (const [label, path, ready, before] of SCREENS) {
            await page.goto(path);
            await expect(page.locator(ready).first(), `${label} did not draw`).toBeVisible({ timeout: 30_000 });
            if (before !== undefined) await before(page);
            await page.waitForLoadState('networkidle');
            await sweep(page, `${theme} · ${locale} · ${String(width)} · ${label}`, tally, testInfo);
          }
        }
      }
    }
    expect(tally.states).toBe(56);
    testInfo.annotations.push({ type: 'axe', description: `${String(tally.states)} states, ${String(tally.minor)} lesser findings` });
    expect(tally.failures, tally.failures.join('\n\n')).toEqual([]);
  });
});
