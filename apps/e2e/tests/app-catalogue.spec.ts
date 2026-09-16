// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The online app catalogue in Studio (48-self-hosted-downloads.md §6b G8-D7),
 * with nothing fetched.
 *
 * ─── HOW THIS STAYS OFFLINE, WHICH IS THE POINT ─────────────────────────────
 *
 * The catalogue's two network actions are a REFRESH and a DOWNLOAD, and both
 * are jobs that talk to adminium.dev and downloads.adminium.dev — addresses the
 * server holds as compile-time constants with no override, exactly so no
 * deployment can be pointed somewhere else. A suite that clicked either would
 * reach the real internet from CI, so this one clicks neither:
 *
 *  - the cached catalogue document is written INTO the server's app store by
 *    hand (`helpers.ts#serverDataDir`), which is the same file a refresh would
 *    have written and is read the same way;
 *  - the update leg updates to a version already on disk, which the page states
 *    as `updateStaged` and which needs no download at all — and the spec
 *    asserts the browser never posted one.
 *
 * The legs this cannot reach are covered where they belong: the server proves
 * it makes no outbound call with either switch off in
 * `apps/server/test/app-network-isolation.test.ts` (a recording thrower over
 * fetch/net/http/https), and the real download from the real bucket is the
 * round trip's app leg (`apps/server/scripts/add-on-round-trip.mjs
 * --online-catalog`).
 *
 * ─── WHAT IT IS ACTUALLY FOR ────────────────────────────────────────────────
 *
 * Two properties that only exist once the page, the routes and the store are
 * wired to each other:
 *
 *  1. THE SWITCH DECIDES, not the cache. A cached document outlives the switch
 *     being turned off, and with it off the shelf must offer nothing from it —
 *     otherwise the page would advertise downloads the download route refuses.
 *  2. UPDATE MOVES THE SERVED TREE. The row's version changing proves the
 *     record moved; only a request to the app's own mount proves the files did,
 *     which is why the bundle writes its version into the HTML it serves.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { APP_KEY, APP_NEXT_VERSION, APP_VERSION, appBundle } from './appBundle.js';
import { seededConnectionId, serverDataDir, signIn } from './helpers.js';

/** Catalogue-only rows: one this server can take, one it cannot (G8-D2). */
const MARKET_KEY = 'e2e-market';
const FUTURE_KEY = 'e2e-future';

/**
 * A row's shape is the feed's, strict — a field this server does not know is a
 * refusal.
 *
 * THE LOCALE KEYS ARE THE WEBSITE'S SHORT CODES (`en`, `de`, `zh-tw`), not
 * Adminium's own locale ids (`en_US`): the feed is emitted by adminium.dev and
 * `pickLocalized` bridges the two by lowercasing and falling back to the bare
 * language. A fixture keyed `en-US` matches NOTHING and the card silently falls
 * back to showing the key — which is exactly what the first draft of this spec
 * did, and it reads as "the catalogue is not being merged".
 */
function entry(key: string, name: string, minAdminiumVersion: string) {
  return {
    key,
    version: '2.0.0',
    // Never used: nothing here downloads. The store checks it when something does.
    integrity: 'sha512-Yy5rnBbCoEEyi5SFAhXCd3gWGpQaqBRjocnSlS0cOG0=',
    name: { en: name, de: name },
    tagline: { en: `${name}, from the catalogue.`, de: `${name}.` },
    categories: ['operations'],
    capabilities: [],
    publisher: 'Adminium',
    sides: ['staff'],
    minAdminiumVersion,
  };
}

/**
 * The document a refresh would have cached, written where the store reads it.
 *
 * `2.0.0` for `e2e-future`'s minimum is a version no release of Adminium has,
 * so the row is listed and refused for the true reason rather than a rigged
 * one; 0.1.0 for the other is met by every server this suite runs.
 */
function seedCatalogueCache(): string {
  const appsDir = join(serverDataDir(), 'apps');
  mkdirSync(appsDir, { recursive: true });
  const file = join(appsDir, '.catalog-cache.json');
  writeFileSync(
    file,
    `${JSON.stringify({
      fetchedAt: Date.now(),
      document: {
        schemaVersion: 2,
        generatedAt: new Date().toISOString(),
        apps: [
          entry(MARKET_KEY, 'E2E Market', '0.1.0'),
          entry(FUTURE_KEY, 'E2E Future', '99.0.0'),
        ],
      },
    })}\n`,
    { mode: 0o600 },
  );
  return file;
}

/** Puts a version of the e2e bundle on disk, the way the bundled set would. */
async function stage(page: Page, version: string): Promise<void> {
  const bundle = appBundle('reuse', version);
  const query = new URLSearchParams({
    key: APP_KEY,
    version,
    expectedSha512: bundle.integrity,
  });
  const staged = await page.request.post(`/api/v1/apps/upload?${query.toString()}`, {
    headers: { 'content-type': 'application/octet-stream' },
    data: bundle.buffer,
  });
  expect(staged.ok(), await staged.text()).toBe(true);
}

/** The version the app's own mount is serving, from the HTML the bundle wrote. */
async function servedVersion(page: Page): Promise<string> {
  const response = await page.request.get(`/apps/${APP_KEY}/customer/`);
  expect(response.status()).toBe(200);
  const match = /data-version="([^"]+)"/.exec(await response.text());
  return match?.[1] ?? '';
}

const catalogueCard = (page: Page, name: string) =>
  page.getByRole('article').filter({ hasText: name });

test.describe.configure({ mode: 'serial' });

test.describe('the online app catalogue', () => {
  test.afterAll(async ({ browser }) => {
    // The suite shares one instance and one settings store: a switch left on,
    // or a cached document left on disk, would put two catalogue-only cards on
    // the shelf every later spec renders.
    const page = await browser.newPage();
    await page.request.delete(`/api/v1/apps/${APP_KEY}`).catch(() => undefined);
    for (const version of [APP_VERSION, APP_NEXT_VERSION]) {
      await page.request.delete(`/api/v1/apps/staged/${APP_KEY}/${version}`).catch(() => undefined);
    }
    await page.request
      .put('/api/v1/apps/catalog', { data: { enabled: false } })
      .catch(() => undefined);
    await page.close();
  });

  test('the switch decides whether a cached catalogue is offered at all', async ({ page }) => {
    const cacheFile = seedCatalogueCache();

    await signIn(page);
    await page.goto('/studio/apps');
    await expect(page.getByRole('heading', { name: 'Hosted apps' })).toBeVisible();

    // ── Off: the document is on disk and none of it is offered ───────────
    const toggle = page.getByRole('switch', { name: 'Browse the online app catalogue' });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(catalogueCard(page, 'E2E Market')).toHaveCount(0);
    await expect(catalogueCard(page, 'E2E Future')).toHaveCount(0);
    // Refreshing is not even offered while browsing online is off.
    await expect(page.getByRole('button', { name: 'Check for newer' })).toHaveCount(0);

    // ── On: the cached rows appear, and say where they came from ─────────
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('button', { name: 'Check for newer' })).toBeVisible();

    const market = catalogueCard(page, 'E2E Market');
    await expect(market).toBeVisible();
    // "Online" is the card's own answer to "where would this come from?".
    await expect(market.getByText('Online')).toBeVisible();
    await expect(market.getByText('E2E Market, from the catalogue.')).toBeVisible();
    await expect(market.getByRole('button', { name: 'Install' })).toBeEnabled();

    /*
     * The row this server is too old for is LISTED (G8-D2). Hiding it would
     * leave an operator who read about the app wondering where it went; the
     * card names the version it needs and the button does not offer to try.
     */
    const future = catalogueCard(page, 'E2E Future');
    await expect(future).toBeVisible();
    await expect(future.getByText('Needs Adminium 99.0.0 or later')).toBeVisible();
    await expect(future.getByRole('button', { name: 'Install' })).toBeDisabled();

    // ── Off again: the cache survives, the offer does not ────────────────
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(catalogueCard(page, 'E2E Market')).toHaveCount(0);
    expect(existsSync(cacheFile), 'turning the switch off deleted the cached document').toBe(true);
  });

  test('an installed app updates to a version already on disk, with no download', async ({
    page,
  }) => {
    await signIn(page);
    const connectionId = await seededConnectionId(page);

    await stage(page, APP_VERSION);
    const installed = await page.request.post('/api/v1/apps/install', {
      data: { key: APP_KEY, version: APP_VERSION, connectionId },
    });
    expect(installed.ok(), await installed.text()).toBe(true);
    expect(await servedVersion(page)).toBe(APP_VERSION);

    // The newer version arrives on disk the way a download would leave it.
    await stage(page, APP_NEXT_VERSION);

    // Nothing this test does may post a download; `updateStaged` is the page's
    // own claim that it does not have to, and this is what holds it to it.
    const downloads: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/v1/apps/download')) downloads.push(request.url());
    });

    await page.goto('/studio/apps');
    await expect(page.getByText('1 update available')).toBeVisible();
    await expect(page.getByText(`Update to v${APP_NEXT_VERSION}`)).toBeVisible();

    await page.getByRole('button', { name: 'Update' }).click();

    // No consent dialog: this version needs no table the installed one lacked,
    // which is the comp's "applies at once" (the tables path is swept by
    // app-install-a11y.spec.ts).
    const done = page.getByText(`${APP_KEY} updated to v${APP_NEXT_VERSION}`);
    await expect(done).toBeVisible({ timeout: 30_000 });

    /*
     * AND IT IS STILL THERE once both lists have come back. An answer that
     * blinks out the moment the page refreshes itself is one the operator can
     * miss entirely, so the pills going away and the answer staying are
     * asserted together.
     */
    await expect(page.getByText(`Update to v${APP_NEXT_VERSION}`)).toHaveCount(0);
    await expect(page.getByText('1 update available')).toHaveCount(0);
    await expect(done).toBeVisible();

    expect(downloads, 'the page downloaded a version it already had on disk').toEqual([]);

    // The row moved AND the mount serves the new tree — the second is the half
    // a row-only assertion would have missed.
    expect(await servedVersion(page)).toBe(APP_NEXT_VERSION);
    const list = (await (await page.request.get('/api/v1/apps')).json()) as {
      apps: { key: string; version: string; connectionId: string | null }[];
    };
    expect(list.apps.find((app) => app.key === APP_KEY)).toMatchObject({
      version: APP_NEXT_VERSION,
      // The same row, so the connection it was installed against survives.
      connectionId,
    });

    await page.request.delete(`/api/v1/apps/${APP_KEY}`);
  });
});
