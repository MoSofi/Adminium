// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Four screens' words load with their screens — in the real build.
 *
 * The English text of the knowledge base, About and Team is not in the first
 * load (`COMMON_DEFERRED_GROUPS`): it is a chunk of its own, fetched the
 * just after the first paint (a dashboard page draws through the builder, so
 * the home page needs them too). The unit tests prove the loader and the
 * wait; only a built dashboard can prove the bundler really split the chunk
 * out of the entry, that it is fetched once, and that each screen still
 * shows its words.
 */
import { expect, test, type Page } from '@playwright/test';

import { signIn } from './helpers.js';

const CHUNK = /\/assets\/common-deferred-[^/]+\.js$/;

/** Every script the page asks for from here on. */
function scriptsOf(page: Page): string[] {
  const seen: string[] = [];
  page.on('request', (request) => {
    if (request.resourceType() === 'script') seen.push(new URL(request.url()).pathname);
  });
  return seen;
}

test.describe('the words of the screens behind lazy routes', () => {
  test('are a chunk of their own: not part of what the page itself names, and fetched once a load', async ({ page }) => {
    // What index.html asks for is the entry: the chunk is not in it.
    const html = await (await page.request.get('/')).text();
    expect(html).toMatch(/<script[^>]+src="\/assets\/index-[^"]+\.js"/);
    expect(html.includes('common-deferred')).toBe(false);

    const scripts = scriptsOf(page);
    await signIn(page);
    // One load of the page asks for it once, however many of its screens wait on it.
    scripts.length = 0;
    await page.goto('/about');
    await expect(page.getByRole('heading', { name: 'About Adminium' })).toBeVisible();
    await expect.poll(() => scripts.filter((path) => CHUNK.test(path)).length).toBe(1);
    // No raw key on the page: a screen that painted before its words would show one for a text read by name.
    await expect(page.locator('main')).not.toContainText(/\babout\.[a-z]+\.[a-zA-Z.]+\b/);
  });

  test('a slow chunk keeps the home page waiting, never the rail', async ({ page }) => {
    // The home page is a dashboard, drawn by the builder: it waits for these words after the shell is on screen.
    await page.addInitScript(() => {
      const log: string[] = [];
      (window as unknown as { __rail: string[] }).__rail = log;
      let was = false;
      new MutationObserver(() => {
        const rail = document.querySelector<HTMLElement>('nav[aria-label="Primary"]');
        const now = rail !== null && rail.offsetParent !== null;
        if (now !== was) log.push(now ? 'shown' : 'gone');
        was = now;
      }).observe(document, { subtree: true, childList: true, attributes: true });
    });
    await page.route(CHUNK, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      await route.continue();
    });
    await page.goto('/');
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
    // The page's own words arrive with the chunk; by then the rail has been on screen the whole time.
    await expect(page.locator('main').getByRole('button', { name: 'Edit' })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __rail: string[] }).__rail)).toEqual(['shown']);
  });

  test('each screen shows its own words', async ({ page }) => {
    await signIn(page);
    for (const [path, heading] of [
      ['/help', 'Knowledge Base'],
      ['/settings/team', 'People'],
      ['/settings/teams', 'Teams'],
      // And the account screen's, which joined them to make room for People and Teams in the rail.
      ['/account', 'Account'],
      ['/about', 'About Adminium'],
      // The groups that joined them: the audit log and the setup checklist.
      ['/audit', 'Audit log'],
      ['/welcome', 'Getting started'],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: heading, exact: true }).first()).toBeVisible();
    }
    // And the command palette, whose own code is fetched when it is first opened: its words come with it.
    await page.goto('/');
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();
    await expect(palette.getByPlaceholder('Type a command or search…')).toBeVisible();
  });

  test('the first paint needs none of them: sign-in, a page that is not there and the shell have their words while the chunk never arrives', async ({ page, browser }) => {
    // Somebody not signed in, on a cold load, with the deferred words held back for good.
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const cold = await context.newPage();
    const held: string[] = [];
    await cold.route(CHUNK, (route) => {
      held.push(route.request().url());
      // Never answered.
    });
    await cold.goto('/login');
    await expect(cold.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await expect(cold.getByText('Turn any database into a dashboard.')).toBeVisible();
    await expect(cold.getByLabel('Email')).toBeVisible();
    await expect(cold.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await expect(cold.getByText('Keep me signed in')).toBeVisible();
    await context.close();

    // Signed in: the rail, the top bar and a page that does not exist, all in words, with the chunk still held back.
    await page.route(CHUNK, (route) => {
      held.push(route.request().url());
    });
    await page.goto('/p/no-such-page-anywhere');
    const rail = page.getByRole('navigation', { name: 'Primary' });
    await expect(rail).toBeVisible();
    await expect(rail.getByRole('link', { name: 'Dashboard' })).toBeVisible();
    await expect(rail.getByRole('link', { name: 'Audit log' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Notifications' })).toBeVisible();
    await expect(page.getByText('This page went missing')).toBeVisible();
    await expect(page.getByText('Error 404')).toBeVisible();
    // No text on screen is a bare key of a group that was deferred.
    expect((await page.locator('body').innerText()).match(/\b(onboarding|audit|capabilities|palette)\.[a-z][A-Za-z.]+/g)).toBeNull();
  });
});
