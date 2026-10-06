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
      ['/settings/team', 'Team'],
      ['/about', 'About Adminium'],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: heading, exact: true }).first()).toBeVisible();
    }
  });
});
