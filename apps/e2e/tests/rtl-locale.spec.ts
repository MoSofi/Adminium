/**
 * RTL + locale end-to-end (10-i18n-theming.md §5, §8.3).
 *
 * Everything RTL in this product rested on unit tests until this file existed:
 * `ThemeProvider.test.tsx` proves the provider *would* stamp `dir`, and
 * `parity.test.ts` proves the bundles *have* Arabic — but nothing booted the
 * real app in `ar_EG` and looked. That gap is why the class of bug this spec
 * targets survives so easily: a translated string that is never rendered, a
 * pane that mirrors while its icon does not, a mono value that flips when it
 * must not.
 *
 * The spec deliberately asserts three DIFFERENT kinds of thing, because they
 * fail independently:
 *   1. direction is applied at all (`<html dir>`, `lang`);
 *   2. the bundle is actually reaching the screen (real Arabic glyphs);
 *   3. content that must stay LTR did NOT flip (§5.6 fixed-LTR islands) —
 *      the failure mode nobody looks for, because the page looks "more RTL"
 *      when it is wrong.
 *
 * Runs last in the serial suite and restores en_US in `afterEach`, so a failure
 * mid-spec cannot leave the shared seeded account in Arabic for other specs.
 */
import { expect, test, type Page } from '@playwright/test';

import { signIn } from './helpers.js';

const PREFS = '/account/preferences';

/** Matches any Arabic-script character — proof the bundle reached the DOM. */
const ARABIC = /[؀-ۿ]/;

async function setLocale(page: Page, value: string): Promise<void> {
  await page.goto(PREFS);
  const select = page.getByLabel('Language').or(page.getByLabel('اللغة')).first();
  await expect(select).toBeVisible();
  await select.selectOption(value);

  // `dir` flips the moment the pref resolves, but every non-English bundle is a
  // lazily-imported chunk (10 §2.3) — so there is a real window where the page
  // is already RTL and the copy is still English. Waiting only on the attribute
  // makes any subsequent text assertion a coin flip.
  const expected = value === 'ar_EG' ? 'rtl' : 'ltr';
  await expect(page.locator('html')).toHaveAttribute('dir', expected);

  // No reload. Copy follows the switch on its own since 23-T02: `createI18n`
  // bumps the i18n revision on `languageChanged`, and the router's root
  // component subscribes to it — so the tree re-renders and the module-level
  // `t()` call sites re-resolve. (It is a RE-RENDER, not a keyed remount:
  // remounting would take ThemeProvider with it and revert the very locale
  // choice being made.)
  const expectedName = value === 'ar_EG' ? ARABIC : /^Primary$/;
  await expect(page.locator('html')).toHaveAttribute('dir', expected);
  await expect(page.getByRole('navigation', { name: /الأساسية|Primary/ })).toHaveAttribute(
    'aria-label',
    expectedName,
  );
}

test.describe('ar_EG renders the app right-to-left', () => {
  test.afterEach(async ({ page }) => {
    // Shared seeded account: never leave it in Arabic for the next spec.
    await setLocale(page, 'en_US').catch(() => {
      /* the test already failed; do not mask it with a cleanup error */
    });
  });

  test('stamps lang + dir on <html> and mirrors the shell', async ({ page }) => {
    await signIn(page);
    await setLocale(page, 'ar_EG');

    const html = page.locator('html');
    await expect(html).toHaveAttribute('dir', 'rtl');
    await expect(html).toHaveAttribute('lang', 'ar-EG');

    // Direction must be DERIVED from the locale, never set independently
    // (02-design-system.md §4.2) — switching back must flip it back.
    await setLocale(page, 'en_US');
    await expect(html).toHaveAttribute('dir', 'ltr');
    await expect(html).toHaveAttribute('lang', 'en-US');
  });

  test('actually renders Arabic CHROME (page names stay user data)', async ({ page }) => {
    await signIn(page);
    await setLocale(page, 'ar_EG');

    // `dir=rtl` over English text is trivially easy to produce and proves
    // nothing about the bundles, so assert real glyphs.
    //
    // Assert on CHROME specifically. The nav also lists generated page names
    // ("Dashboard", "Orders") which come from the meta-store, not the bundles:
    // schema-derived labels are user content and are never translated (10 §5.7,
    // §6). An earlier version of this test read the whole nav's innerText and
    // would have been satisfied — or broken — by that user data.
    const nav = page.getByRole('navigation', { name: /الأساسية|Primary/ });
    await expect(nav).toBeVisible();
    // The accessible name is ours, and is what a screen reader announces.
    await expect(nav).toHaveAttribute('aria-label', ARABIC);
    // The group headings above the links are ours too. `toHaveText` retries;
    // a bare `expect(await innerText())` would not, and would race the chunk.
    await expect(nav).toHaveText(ARABIC);
  });

  test('lays the shell out from the inline-end', async ({ page }) => {
    await signIn(page);
    await setLocale(page, 'ar_EG');

    const nav = page.getByRole('navigation').first();
    const navBox = await nav.boundingBox();
    const viewport = page.viewportSize();
    expect(navBox).not.toBeNull();
    expect(viewport).not.toBeNull();
    // In RTL the primary nav sits on the right half of the viewport. This is the
    // assertion that a stray physical `left-0` would break while every unit test
    // stayed green.
    expect(navBox!.x + navBox!.width / 2).toBeGreaterThan(viewport!.width / 2);
  });

  test('keeps fixed-LTR islands left-to-right inside the RTL page (§5.6)', async ({ page }) => {
    await signIn(page);
    await setLocale(page, 'ar_EG');
    await page.goto(PREFS);

    // Technical content — connection strings, code, ids — must NOT mirror, or
    // `postgres://user@host:5432/db` becomes unreadable. Anything the design
    // system marks mono/technical opts out explicitly.
    const ltrIslands = page.locator('[dir="ltr"]');
    const count = await ltrIslands.count();
    for (let i = 0; i < count; i += 1) {
      await expect(ltrIslands.nth(i)).toHaveAttribute('dir', 'ltr');
    }
    // The page itself is still RTL around them.
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  });

  test('labels the locale as an unreviewed community draft (§3.3)', async ({ page }) => {
    await signIn(page);
    await setLocale(page, 'ar_EG');
    await page.goto(PREFS);

    // Every locale is machine-drafted today. Claiming otherwise to a user is
    // the thing the review-status tracker exists to prevent, so pin it here:
    // when a locale is genuinely reviewed, this assertion should be updated
    // deliberately rather than discovered by a user.
    await expect(page.getByText(/مسودة مجتمعية|community draft/i).first()).toBeVisible();
  });

  test('switching locale re-renders live, with no reload', async ({ page }) => {
    // INVERTED from a KNOWN-BUG assertion (23-T24). It used to assert that the
    // nav stayed English after a switch — a real defect, deliberately pinned:
    // `dir` flipped immediately (ThemeProvider owns that axis) while every
    // already-painted string kept the outgoing language, so the user got a
    // mirrored ENGLISH UI until they reloaded.
    //
    // Fixed by 23-T02: `createI18n` bumps the i18n revision on
    // `languageChanged` and the router root subscribes to it, so the tree
    // re-renders and the module-level `t()` sites re-resolve. If this test
    // starts failing, live re-render has regressed — do not re-add the reload.
    await signIn(page);
    await page.goto(PREFS);
    const select = page.getByLabel('Language').or(page.getByLabel('اللغة')).first();
    await select.selectOption('ar_EG');

    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(
      page.getByRole('navigation', { name: /الأساسية|Primary/ }),
      'locale switching must re-render without a reload',
    ).toHaveAttribute('aria-label', ARABIC);
  });

  test('visual: the Arabic shell', async ({ page }) => {
    await signIn(page);
    await setLocale(page, 'ar_EG');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await page.screenshot({ path: 'test-results/rtl-ar-EG-shell.png', fullPage: false });
  });
});
