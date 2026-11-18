// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A LANDING PAGE AS A STRANGER SEES IT, against a real server
 * (`landingWorld.ts`): the built `/x/` bundle, the pages door and the forms
 * door, with the `/x/` policy the server sends (Trusted Types with no policy,
 * calls to `/x/` only), watched on every page (`xPolicy.ts`).
 *
 *  - a live page at 1280 and 390: every block kind drawn, one `h1`, nothing
 *    wider than the window;
 *  - an Arabic page, right to left;
 *  - a Form block sends an answer (the human check solved for real), with
 *    the page's key on its read and on its answer, and "Sent" shows inside
 *    the page, focused;
 *  - a form that is not live is left out; a picture that does not load
 *    draws its quiet box; a switched-off page answers "not available";
 *  - the head, as a link previewer reads it (no script): title,
 *    description, `og:image`, and no `noindex` on its own host;
 *  - axe (WCAG 2.2 AA and best practice): light, right to left, phone;
 *  - at Counts only no cookie and no storage; at Per visitor nothing before
 *    "Yes", and the banner docked as on a form's page.
 *
 * With `E2E_SHOTS` set to a folder, the comp's boards are saved there.
 * Run alone, on its own port: `pnpm --filter @adminium/e2e e2e:landing`.
 */
import { request as httpRequest } from 'node:http';
import { join } from 'node:path';

import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { BUSINESS, PAGES_PORT, PUBLIC_HOST, SERVER, startLandingWorld, type LandingWorld } from './landingWorld.js';
import { watchXPolicy, type XPolicyWatch } from './xPolicy.js';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
const SHOTS = process.env['E2E_SHOTS'];
const fresh = { storageState: { cookies: [], origins: [] } };
const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };

let world: LandingWorld;
let watch: XPolicyWatch;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  world = await startLandingWorld();
});

test.afterAll(async () => {
  await world?.close();
});

test.beforeEach(({ page }) => {
  watch = watchXPolicy(page);
});

// Every call of a landing page stays under /x/, and its policy refuses nothing.
test.afterEach(() => {
  expect(watch.outside()).toEqual([]);
  expect(watch.refused()).toEqual([]);
});

async function shot(page: Page, board: string): Promise<void> {
  if (SHOTS === undefined || SHOTS === '') return;
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.screenshot({ path: join(SHOTS, `${board}.png`), fullPage: true });
}

async function sweep(page: Page, label: string, failures: string[]): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(results.passes.length, `${label}: axe examined nothing`).toBeGreaterThan(0);
  if (results.violations.length > 0) {
    failures.push(`${label}:\n${results.violations.map((v) => `  ${String(v.impact)}: ${v.id} — ${v.help}\n${v.nodes.slice(0, 3).map((n) => `    ${n.target.join(' ')}  ${n.html.slice(0, 160)}`).join('\n')}`).join('\n')}`);
  }
}

/** A stranger opens a page: its first load, its data, its pictures. */
async function open(page: Page, slug: string): Promise<void> {
  await page.goto(`${SERVER}/x/pages/${slug}`);
  await expect(page.locator('.lp, .x-status').first()).toBeVisible();
}

/**
 * Opens the page on the install's own public host, as a stranger does: "Per
 * visitor" asks only there. The browser's requests to that host are made to
 * this server with the host named, through the context's own cookie jar.
 */
async function openOnPublicHost(page: Page, slug: string): Promise<void> {
  await page.route(`http://${PUBLIC_HOST}/**`, async (route) => {
    const url = new URL(route.request().url());
    const response = await route.fetch({ url: `${SERVER}${url.pathname}${url.search}`, headers: { ...route.request().headers(), host: PUBLIC_HOST } });
    await route.fulfill({ response });
  });
  await page.goto(`http://${PUBLIC_HOST}/x/pages/${slug}`);
  await expect(page.locator('.lp, .x-status').first()).toBeVisible();
}

/** Everything a page stored: cookies, and both storages of its origin. */
async function stored(context: BrowserContext, page: Page) {
  const storage = await page.evaluate(() => ({ local: Object.keys(window.localStorage), session: Object.keys(window.sessionStorage) }));
  return { cookies: await context.cookies(), ...storage };
}

/** The page's HTML as a link previewer fetches it: no script, the public host named. */
function headOf(path: string, host: string): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port: PAGES_PORT, path, headers: { host, 'user-agent': 'Mozilla/5.0 (compatible; LinkPreview/1.0)' } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (part: string) => (body += part));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

test.describe('a landing page, for a stranger', () => {
  for (const viewport of [DESKTOP, PHONE]) {
    test(`draws every block, one h1, at ${String(viewport.width)}`, async ({ browser }) => {
      const context = await browser.newContext({ ...fresh, viewport });
      const page = await context.newPage();
      const own = watchXPolicy(page);
      await open(page, 'acoustic-booths');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Acoustic booths for open offices');
      await expect(page.locator('h1')).toHaveCount(1);
      // Every kind but a Hero here (the open day's page has one), each drawn.
      for (const kind of ['heading', 'text', 'picture', 'button', 'columns', 'spacer', 'features', 'quote', 'questions', 'form']) await expect(page.locator(`.lp-block[data-kind="${kind}"]`).first()).toBeVisible();
      await expect(page.getByRole('img', { name: 'Two grey acoustic booths in an open office' })).toHaveJSProperty('complete', true);
      expect(await page.getByRole('img', { name: 'Two grey acoustic booths in an open office' }).evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(320);
      await expect(page.getByRole('link', { name: 'See them at our open day' })).toHaveAttribute('href', '/x/pages/open-day');
      await expect(page.getByRole('heading', { level: 2, name: 'Book a showroom visit' })).toBeVisible();
      await expect(page.locator('.lp-feature-icon svg')).toHaveCount(3);
      // The shell: the business, the footer with the privacy notice, no language menu; light.
      await expect(page.getByRole('banner')).toContainText(BUSINESS.name);
      await expect(page.getByRole('contentinfo').getByRole('link', { name: 'Privacy notice' })).toHaveAttribute('href', BUSINESS.notice);
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
      await expect(page).toHaveTitle('Acoustic booths for open offices');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await shot(page, viewport.width === 1280 ? '1a' : '1b');
      expect(own.outside()).toEqual([]);
      expect(own.refused()).toEqual([]);
      await context.close();
    });
  }

  test('a Hero, and a picture that does not load, drawn as its quiet box', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await open(page, 'open-day');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Open day at our Leeds showroom');
    const box = page.getByRole('img', { name: 'A bright showroom with booths and desks' });
    await expect(box).toBeVisible();
    await expect(box).toHaveClass(/lp-picture-empty/);
    await expect(box).toHaveText('A bright showroom with booths and desks');
    await shot(page, '1d-2');
  });

  test('a form that is not live is left out of the page', async ({ page }) => {
    await open(page, 'thanks-open-day');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Thanks, see you there');
    await expect(page.locator('.lp-form')).toHaveCount(0);
    await expect(page.getByText('Spring raffle')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'See the booths' })).toHaveAttribute('href', '/x/pages/acoustic-booths');
  });

  test('an Arabic page runs right to left', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await open(page, 'kabain');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar-EG');
    await expect(page.locator('.lp')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('كبائن هادئة للمكاتب المفتوحة');
    // The engine's words in the page's language, and the form in it too.
    await expect(page.getByRole('contentinfo').getByRole('link', { name: 'إشعار الخصوصية' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'احجز زيارة لصالة العرض' })).toBeVisible();
    // Right to left: the heading starts at the right edge.
    const heading = (await page.getByRole('heading', { level: 1 }).boundingBox())!;
    expect(heading.x + heading.width).toBeGreaterThan(PHONE.width - 40);
  });

  test('a Form block asks and sends with the page key, and says Sent inside the page', async ({ page }) => {
    await page.setViewportSize(PHONE);
    const asked: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/x/forms/api/showroom-visit')) asked.push(`${request.method()} ${new URL(request.url()).pathname}${new URL(request.url()).search}`);
    });
    await open(page, 'acoustic-booths');
    const key = world.keys['acoustic-booths']!;
    // Not before it nears the screen.
    expect(asked.filter((one) => one.startsWith('GET /x/forms/api/showroom-visit?'))).toEqual([]);
    await page.getByRole('heading', { level: 2, name: 'Book a showroom visit' }).scrollIntoViewIfNeeded();
    await expect.poll(() => asked.filter((one) => one.startsWith('GET /x/forms/api/showroom-visit?'))).toEqual([`GET /x/forms/api/showroom-visit?lang=en-US&on=${key}`]);
    const form = page.locator('.lp-form');
    await form.getByLabel(/Your name/).fill('Marta Kovac');
    await form.getByLabel(/Work e-mail/).fill('marta.kovac@cobaltlegal.example');
    const before = (await form.locator('form').boundingBox())!;
    await form.getByRole('button', { name: 'Send', exact: true }).click();
    const sent = page.getByRole('heading', { level: 2, name: 'Thanks, Marta.' });
    await expect(sent).toBeFocused({ timeout: 30_000 });
    await expect(form).toContainText("We'll confirm your time within one working day.");
    expect(asked).toContain(`POST /x/forms/api/showroom-visit/answers?on=${key}`);
    // The card keeps the form's height: nothing under it moved.
    const after = (await form.locator('.xp-ending').boundingBox())!;
    expect(Math.round(after.height)).toBeGreaterThanOrEqual(Math.floor(before.height));
    await expect(page.locator('h1')).toHaveCount(1);
    await shot(page, '1e-1');
  });

  test('a page switched off is not available, on its page and its data', async ({ page }) => {
    const data = await page.request.get(`${SERVER}/x/pages/api/old-offer`);
    expect(data.status()).toBe(404);
    expect(await data.json()).toMatchObject({ state: 'unavailable' });
    const response = await page.goto(`${SERVER}/x/pages/old-offer`);
    expect(response!.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1, name: 'This page isn’t available.' })).toBeVisible();
    await expect(page.locator('.lp')).toHaveCount(0);
  });

  test('the head, as a link previewer reads it: title, description, sharing picture, indexable on its own host', async () => {
    const page = await headOf('/x/pages/acoustic-booths', PUBLIC_HOST);
    expect(page.status).toBe(200);
    expect(page.body).toContain('<html lang="en-US" dir="ltr">');
    expect(page.body).toContain('<title>Acoustic booths for open offices</title>');
    expect(page.body).toContain('<meta name="description" content="Our booths cut the noise of a busy floor by half." />');
    expect(page.body).toContain(`<meta property="og:image" content="https://${PUBLIC_HOST}/x/pages/api/acoustic-booths/pictures/${world.files['share']!}" />`);
    expect(page.body).not.toMatch(/noindex/);
    expect(page.headers['x-robots-tag']).toBeUndefined();
    // On any other host, the same page is not to be indexed.
    const elsewhere = await headOf('/x/pages/acoustic-booths', `127.0.0.1:${String(PAGES_PORT)}`);
    expect(`${elsewhere.body} ${String(elsewhere.headers['x-robots-tag'])}`).toMatch(/noindex/);
  });

  test('passes axe: light at 1280, right to left, a phone, and the form sent', async ({ browser }) => {
    test.slow();
    const failures: string[] = [];
    for (const [slug, viewport] of [
      ['acoustic-booths', DESKTOP],
      ['acoustic-booths', PHONE],
      ['kabain', PHONE],
      ['open-day', DESKTOP],
      ['thanks-open-day', PHONE],
      ['old-offer', PHONE],
    ] as const) {
      const context = await browser.newContext({ ...fresh, viewport });
      const page = await context.newPage();
      await open(page, slug);
      await sweep(page, `${slug} at ${String(viewport.width)}`, failures);
      await context.close();
    }
    expect(failures, failures.join('\n\n')).toEqual([]);
  });
});

test.describe('counting on a landing page', () => {
  test('at Counts only: no cookie, no storage, no banner', async ({ browser }) => {
    await world.counting('counts');
    const context = await browser.newContext({ ...fresh, viewport: PHONE });
    const page = await context.newPage();
    const own = watchXPolicy(page);
    await openOnPublicHost(page, 'acoustic-booths');
    await page.getByRole('heading', { level: 2, name: 'Book a showroom visit' }).scrollIntoViewIfNeeded();
    await expect(page.getByRole('region', { name: 'Can we remember your visit?' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Cookie choice' })).toHaveCount(0);
    expect(await stored(context, page)).toEqual({ cookies: [], local: [], session: [] });
    expect(own.outside()).toEqual([]);
    await context.close();
  });

  test('at Per visitor: docked under the page, nothing stored before "Yes", in English and Arabic', async ({ browser }) => {
    await world.counting('visitor');
    const failures: string[] = [];
    for (const [slug, title, yes, board] of [
      ['acoustic-booths', 'Can we remember your visit?', 'Yes', '1g-2'],
      ['kabain', 'هل نتذكر زيارتك؟', 'نعم', '1i'],
    ] as const) {
      const context = await browser.newContext({ ...fresh, viewport: PHONE });
      const page = await context.newPage();
      const own = watchXPolicy(page);
      await openOnPublicHost(page, slug);
      const banner = page.getByRole('region', { name: title });
      await expect(banner).toBeVisible();
      await expect(page.locator('.x-page')).toHaveAttribute('data-docked', '');
      // Under the page, never over it.
      const band = (await page.locator('[data-testid="x-banner"]').boundingBox())!;
      const scroll = (await page.locator('.x-scroll').boundingBox())!;
      expect(Math.round(band.y + band.height)).toBe(PHONE.height);
      expect(scroll.y + scroll.height).toBeLessThanOrEqual(band.y + 1);
      expect(await stored(context, page)).toEqual({ cookies: [], local: [], session: [] });
      await sweep(page, `${slug}: the banner asking`, failures);
      await shot(page, board);
      if (slug === 'acoustic-booths') {
        await banner.getByRole('button', { name: yes }).click();
        await expect(page.getByText('Saved: yes. Change it any time under Cookie choice.')).toBeVisible();
        const after = await stored(context, page);
        expect(after.local).toEqual([]);
        // The browser keeps the server's cookie on the page's host (the jar also holds the proxy's own copy for this server's address).
        const kept = after.cookies.filter((cookie) => cookie.domain === PUBLIC_HOST).map(({ name, path, httpOnly }) => ({ name, path, httpOnly }));
        expect(kept).toEqual([{ name: 'adm_v', path: '/x/', httpOnly: true }]);
        expect(after.cookies.every((cookie) => cookie.name === 'adm_v')).toBe(true);
        await expect(page.getByRole('contentinfo').getByRole('button', { name: 'Cookie choice' })).toBeVisible();
      }
      expect(own.outside()).toEqual([]);
      expect(own.refused()).toEqual([]);
      await context.close();
    }
    await world.counting('counts');
    expect(failures, failures.join('\n\n')).toEqual([]);
  });
});
