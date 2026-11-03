// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A CAMPAIGN THAT STARTS WITH A LINK: a form's "Send by e-mail" opens
 * `/email-templates?kind=campaign&link=<https address>`.
 *
 *  1. "New campaign" opens at once; the campaign a start makes holds a text
 *     block with the address after whatever the start gave it, saved through
 *     the editor's own document save; the address leaves the bar once used,
 *     so going back opens nothing again; and an address that is not
 *     `https://` opens nothing at all.
 *  2. The dialog and the editor it leads to under axe: light and dark,
 *     English and Arabic (RTL), desktop and 390 wide. Every finding fails,
 *     whatever its impact. The open dialog is analysed within itself (Radix
 *     hides the page behind it, which axe's `aria-hidden-focus` reads as
 *     hidden-but-focusable: see `email-a11y.spec.ts`).
 *
 * Theme and locale are the signed-in user's own prefs, put back afterwards:
 * the suite shares one account.
 */
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { signIn } from './helpers.js';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
const LINK = 'https://forms.meridian.example/x/forms/showroom-visit?from=newsletter';

async function setPrefs(page: Page, prefs: { theme: string | null; locale: string | null }): Promise<void> {
  const reply = await page.request.patch('/api/v1/me/prefs', { data: prefs });
  expect(reply.ok(), `prefs → ${String(reply.status())}`).toBe(true);
}

async function sweep(page: Page, label: string, failures: string[], within?: string): Promise<void> {
  // Settled: a dialog measured mid-fade reports its backdrop-blended colours.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
  const builder = new AxeBuilder({ page }).withTags(TAGS);
  const results = await (within === undefined ? builder : builder.include(within)).analyze();
  expect(results.passes.length, `${label}: axe examined nothing`).toBeGreaterThan(0);
  if (results.violations.length > 0) {
    failures.push(
      `${label}:\n` +
        results.violations
          .map((v) => `  ${String(v.impact)}: ${v.id} — ${v.help}\n${v.nodes.slice(0, 3).map((n) => `    ${n.target.join(' ')}  ${n.html.slice(0, 160)}`).join('\n')}`)
          .join('\n'),
    );
  }
}

/** The campaign the page went on to: its id from the editor's address. */
async function openedCampaign(page: Page): Promise<string> {
  await page.waitForURL(/\/email-templates\/[^/?#]+$/);
  return new URL(page.url()).pathname.split('/').pop()!;
}

/** Opens the address a form's "Send by e-mail" opens, and starts a blank campaign from it. */
async function startFromLink(page: Page, made: string[]): Promise<string> {
  await page.goto(`/email-templates?kind=campaign&link=${encodeURIComponent(LINK)}`);
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('email-new-grid')).toBeVisible();
  await dialog.locator('[data-testid="email-starter"][data-starter=""]').click();
  const id = await openedCampaign(page);
  made.push(id);
  return id;
}

test.describe('a campaign that starts with a form’s link', () => {
  test.describe.configure({ mode: 'serial' });
  const made: string[] = [];

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    await setPrefs(page, { theme: null, locale: null });
    for (const id of made) await page.request.delete(`/api/v1/email-templates/${id}`);
    await page.close();
  });

  test('"New campaign" opens at once, and the campaign holds the link; going back opens nothing, and a plain http address nothing at all', async ({ page }) => {
    await setPrefs(page, { theme: null, locale: null });
    await signIn(page);

    // Not https: dropped, and the page is the manager as it always is.
    await page.goto(`/email-templates?kind=campaign&link=${encodeURIComponent('http://forms.meridian.example/x/forms/showroom-visit')}`);
    await expect(page.getByTestId('email-new')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.goto(`/email-templates?kind=campaign&link=${encodeURIComponent(LINK)}`);
    const dialog = page.getByRole('dialog', { name: 'New campaign' });
    await expect(dialog).toBeVisible();
    await dialog.locator('[data-testid="email-starter"][data-starter=""]').click();
    const id = await openedCampaign(page);
    made.push(id);

    // The editor opens on it: the last block is a text block holding the address, as saved.
    await expect(page.getByTestId('email-block').last()).toContainText(LINK);
    const saved = (await (await page.request.get(`/api/v1/email-templates/${id}`)).json()) as { kind: string; document: { blocks: { block: string; data: { paras?: string[] } }[] } };
    expect(saved.kind).toBe('campaign');
    expect(saved.document.blocks.at(-1)).toMatchObject({ block: 'email.text', data: { paras: [LINK] } });

    // Used once: the address left the bar, so back on the list nothing opens again.
    await page.goBack();
    await expect(page).toHaveURL(/\/email-templates(\?|$)/);
    expect(new URL(page.url()).searchParams.has('link')).toBe(false);
    await expect(page.getByTestId('email-new')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('the dialog and the campaign it makes under axe: light and dark, English and Arabic, desktop and 390 wide', async ({ page }) => {
    test.setTimeout(300_000);
    const failures: string[] = [];
    let states = 0;
    await setPrefs(page, { theme: null, locale: null });
    await signIn(page);
    try {
      for (const [theme, locale, dir] of [
        ['light', 'en_US', 'ltr'],
        ['dark', 'en_US', 'ltr'],
        ['light', 'ar_EG', 'rtl'],
        ['dark', 'ar_EG', 'rtl'],
      ] as const) {
        await setPrefs(page, { theme, locale });
        for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
          await page.setViewportSize(viewport);
          const at = `${theme}, ${locale}, ${String(viewport.width)}`;
          await page.goto(`/email-templates?kind=campaign&link=${encodeURIComponent(LINK)}`);
          await expect(page.locator('html')).toHaveAttribute('dir', dir);
          await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
          await expect(page.getByRole('dialog').getByTestId('email-new-grid')).toBeVisible();
          await expect(page.getByRole('dialog').getByTestId('email-starter').nth(1)).toBeVisible();
          await sweep(page, `${at}: New campaign, opened by the link`, failures, '[role="dialog"]');
          states += 1;

          await page.getByRole('dialog').locator('[data-testid="email-starter"][data-starter=""]').click();
          made.push(await openedCampaign(page));
          await expect(page.getByTestId('email-block').last()).toContainText(LINK);
          await expect(page.getByTestId('email-mail-shell')).toBeVisible();
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${at}: no sideways scroll`).toBe(true);
          await sweep(page, `${at}: the campaign with the link`, failures);
          states += 1;
        }
      }
    } finally {
      await setPrefs(page, { theme: null, locale: null });
    }
    expect(states).toBe(4 * 2 * 2);
    expect(failures.join('\n\n')).toBe('');
  });
});
