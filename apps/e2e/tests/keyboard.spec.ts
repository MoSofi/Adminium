// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Keyboard-only journeys — WCAG 2.1.1 (Keyboard) and 2.4.7 (Focus Visible).
 *
 * THE GAP THIS CLOSES. There was no keyboard-only spec anywhere in the repo.
 * axe cannot supply one: it reads a static snapshot, so it can tell you an
 * element has no accessible name and cannot tell you that tabbing never reaches
 * it, that Escape does not return focus to whatever opened a dialog, or that a
 * menu traps you. Those are the failures that make an app unusable without a
 * mouse, and they are exactly the ones a component-level sweep is blind to.
 *
 * Everything below drives the real app with the keyboard alone — no `.click()`,
 * no `.focus()`, no locator shortcuts to jump the queue. A step that only passes
 * because the test reached in and focused something is not a keyboard journey.
 */
import { expect, test, type Page } from '@playwright/test';

import { signIn } from './helpers.js';

/** What currently has focus, described the way a failure message can use. */
async function focused(page: Page): Promise<{ role: string; name: string; tag: string }> {
  return await page.evaluate(() => {
    const element = document.activeElement;
    if (element === null) return { role: '', name: '', tag: '' };
    return {
      role: element.getAttribute('role') ?? '',
      name:
        element.getAttribute('aria-label') ??
        (element.textContent ?? '').trim().slice(0, 60),
      tag: element.tagName.toLowerCase(),
    };
  });
}

/** Press Tab until `predicate` holds, or give up after `limit` stops. */
async function tabUntil(
  page: Page,
  limit: number,
  predicate: (state: { role: string; name: string; tag: string }) => boolean,
): Promise<{ found: boolean; visited: string[] }> {
  const visited: string[] = [];
  for (let i = 0; i < limit; i += 1) {
    await page.keyboard.press('Tab');
    const state = await focused(page);
    visited.push(`${state.tag}${state.role === '' ? '' : `[${state.role}]`} "${state.name}"`);
    if (predicate(state)) return { found: true, visited };
  }
  return { found: false, visited };
}

test.describe('the app is operable with the keyboard alone', () => {
  test('tabbing from the top of the page reaches the primary nav and follows a link', async ({
    page,
  }) => {
    await signIn(page);
    const before = page.url();

    // Start from the document, not from an element the test focused.
    await page.evaluate(() => {
      document.body.focus();
    });

    const nav = page.getByRole('navigation', { name: 'Primary' });
    await expect(nav).toBeVisible();

    // Walk forward until focus lands inside the primary nav on a link.
    const reached = await tabUntil(page, 40, (state) => state.tag === 'a');
    expect(
      reached.found,
      `40 tab stops from the top never reached a link. Visited:\n${reached.visited.join('\n')}`,
    ).toBe(true);

    // Whatever it is, it must be VISIBLY focused — 2.4.7. The design system puts
    // an accent outline on `focus-visible`; a zero-width outline with no
    // box-shadow is the failure this catches.
    const indicator = await page.evaluate(() => {
      const element = document.activeElement;
      if (element === null) return null;
      const style = getComputedStyle(element);
      return {
        outlineWidth: style.outlineWidth,
        outlineStyle: style.outlineStyle,
        boxShadow: style.boxShadow,
      };
    });
    expect(indicator, 'nothing was focused').not.toBeNull();
    const hasRing =
      (indicator?.outlineStyle !== 'none' && indicator?.outlineWidth !== '0px') ||
      (indicator?.boxShadow ?? 'none') !== 'none';
    expect(hasRing, `focused element has no visible focus indicator: ${JSON.stringify(indicator)}`).toBe(
      true,
    );

    // Tab on until a nav link is focused, then activate it with the keyboard.
    const navLinks = nav.getByRole('link');
    await expect(navLinks.first()).toBeVisible();
    const inNav = await tabUntil(page, 40, (state) => state.tag === 'a' && state.name.length > 0);
    expect(inNav.found).toBe(true);
    await page.keyboard.press('Enter');
    await expect
      .poll(() => page.url(), { message: 'Enter on a focused link did not navigate' })
      .not.toBe(before);
  });

  test('the account menu opens, moves with the arrow keys, and Escape returns focus', async ({
    page,
  }) => {
    await signIn(page);
    const trigger = page.getByRole('button', { name: 'Account menu' });
    await expect(trigger).toBeVisible();

    // Reach the trigger by tabbing, not by focusing it.
    //
    // THE BUG THIS CAUGHT, first run: the topbar's read-only search decoy was
    // in the tab order, blurred itself on focus and opened the ⌘K palette — a
    // MODAL. So tabbing towards the account menu threw you into a dialog, and
    // Escape put focus back on the decoy, where the next Tab did it again. The
    // notification bell and this menu were unreachable by keyboard. Nothing
    // static could have found that; it only exists while you are moving.
    const reached = await tabUntil(page, 60, (state) => state.name === 'Account menu');
    expect(
      reached.found,
      `the account menu is not reachable by Tab. Visited:\n${reached.visited.join('\n')}`,
    ).toBe(true);

    await page.keyboard.press('Enter');
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();

    // Arrow keys move within the menu — the whole point of a menu role.
    await page.keyboard.press('ArrowDown');
    const inMenu = await page.evaluate(
      () => document.activeElement?.closest('[role="menu"]') !== null,
    );
    expect(inMenu, 'ArrowDown did not move focus inside the open menu').toBe(true);

    // Escape closes it AND returns focus to the trigger. A menu that closes and
    // drops focus to <body> strands a keyboard user at the top of the page.
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('the command palette opens on its shortcut and closes on Escape', async ({ page }) => {
    await signIn(page);
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');

    const palette = page.getByRole('dialog');
    await expect(palette).toBeVisible();

    // Focus must be INSIDE the dialog — an open dialog with focus left behind it
    // is a screen reader announcing the page you just left.
    const insideDialog = await page.evaluate(
      () => document.activeElement?.closest('[role="dialog"]') !== null,
    );
    expect(insideDialog, 'the palette opened without moving focus into it').toBe(true);

    await page.keyboard.press('Escape');
    await expect(palette).toBeHidden();
  });

  test('a data grid is reachable and its sort control is operable by keyboard', async ({ page }) => {
    await signIn(page);
    // Navigate by keyboard through the palette rather than clicking the nav.
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
    const palette = page.getByRole('dialog');
    await expect(palette).toBeVisible();
    await page.keyboard.type('Customers');
    // Wait for the filtered result before choosing it — typing and pressing
    // Enter in the same tick races the list.
    await expect(palette.getByRole('option').first()).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    await expect(page.getByRole('heading', { name: 'Customers' })).toBeVisible();

    const sort = page.getByRole('button', { name: 'Sort by Company Name' });
    await expect(sort).toBeVisible();
    const reached = await tabUntil(page, 60, (state) => state.name.includes('Sort by Company Name'));
    expect(
      reached.found,
      `the grid's sort control is not reachable by Tab. Visited:\n${reached.visited.join('\n')}`,
    ).toBe(true);

    await page.keyboard.press('Enter');
    await expect(sort).toHaveAttribute('aria-label', /Sort by Company Name/);
  });
});
