// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Per visitor" and Counts only on a stranger's form page, in the BUILT
 * bundle (`apps/dashboard/dist/x/`), with the browser's own cookie jar and
 * storage read:
 *
 *  - at Counts only (the server says nothing of a visitor) the page sets no
 *    cookie, writes no storage, asks nothing of `/x/consent/visit`, and its
 *    answer goes as it always did; no banner, no "Cookie choice";
 *  - at Per visitor nothing is stored before an answer; "No" sets no cookie
 *    and keeps only the choice in this browser; "Yes" leaves the server's
 *    cookie (`__Host-`: host-only, `Path=/`, Secure, HttpOnly, Lax) and
 *    nothing in storage;
 *  - the banner is docked under the page, never over it, at desktop and
 *    phone width, in English and right to left in Arabic, light and dark,
 *    and passes axe (WCAG 2.2 AA and best practice) asking and after a
 *    choice.
 *
 * No server: the page and its files are read from the build, and its API is
 * answered here as the server answers it (`apps/server/test/forms-door-counting.test.ts`
 * proves the server's side: no cookie at Counts only, none in a frame, the
 * cookie's attributes, the rows a "yes" writes).
 */
import { readFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page, type Route } from '@playwright/test';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dashboard', 'dist');
const ORIGIN = 'https://forms.meridian.example';
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
const TYPES: Readonly<Record<string, string>> = { '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff' };

const BUSINESS = { name: 'Meridian', legalName: 'Meridian Workplace Ltd', email: 'hello@meridian.example', privacyNotice: 'https://www.meridian.example/privacy', hasLogo: false };

const BANNER = {
  'en-US': {
    title: 'Can we remember your visit?',
    text: 'If you say yes, we remember which of our pages you look at, and if you then send us a form, we keep that with your message so we can answer you better. Nothing about your visit is remembered if you say no.',
    yes: 'Yes',
    no: 'No',
  },
  'ar-EG': {
    title: 'هل نتذكر زيارتك؟',
    text: 'إذا قلت نعم، نتذكر صفحاتنا التي تطّلع عليها، وإذا أرسلت إلينا نموذجًا بعدها نحفظ ذلك مع رسالتك لنجيبك بشكل أفضل. لا نتذكر شيئًا عن زيارتك إذا قلت لا.',
    yes: 'نعم',
    no: 'لا',
  },
} as const;

type Tag = keyof typeof BANNER;

const w = (en: string, ar: string) => ({ 'en-US': en, 'ar-EG': ar });

function form(tag: Tag) {
  const pick = (words: Record<string, string>) => ({ [tag]: words[tag] });
  return {
    v: 1,
    kind: 'form',
    languages: [tag],
    defaultLanguage: tag,
    title: pick(w('Book a showroom visit', 'احجز زيارة لصالة العرض')),
    intro: pick(w('See the new booths and desks in our Leeds showroom.', 'شاهد الكبائن والمكاتب الجديدة في صالة العرض في ليدز.')),
    questions: [
      { id: 'qname', kind: 'short', role: 'name', required: true, maxLength: 200, label: pick(w('Your name', 'اسمك')) },
      { id: 'qemail', kind: 'short', check: 'email', role: 'email', required: true, maxLength: 200, label: pick(w('Work e-mail', 'البريد الإلكتروني للعمل')) },
      { id: 'qnote', kind: 'long', required: false, maxLength: 2000, label: pick(w('Anything else?', 'أي شيء آخر؟')) },
    ],
    ending: { kind: 'words', words: pick(w("We'll confirm your visit within one working day.", 'سنؤكد زيارتك خلال يوم عمل واحد.')) },
  };
}

interface World {
  level: 'counts' | 'visitor';
  /** The visitor's cookie, once the server set it. */
  said: boolean;
  consent: { method: string; cookie: string | undefined }[];
  answers: { cookie: string | undefined }[];
}

/** Serves the built page and answers its API as the server would at `world.level`. */
async function serve(page: Page, world: World): Promise<void> {
  await page.route(`${ORIGIN}/**`, async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const cookie = (await request.allHeaders())['cookie'];
    if (path.startsWith('/x/assets/')) {
      const file = join(DIST, path);
      return route.fulfill({ status: 200, contentType: TYPES[extname(file)] ?? 'application/octet-stream', body: readFileSync(file) });
    }
    if (path === '/x/consent/visit') {
      world.consent.push({ method: request.method(), cookie });
      // The server's cookie, as `views/visitor.ts` sets it (a fulfilled route's Set-Cookie is not applied, so the jar is told directly).
      if (request.method() === 'POST') {
        world.said = true;
        await page.context().addCookies([{ name: '__Host-adm_v', value: 'Qm9vdGhzQW5kRGVza3NMZWVkcw', url: `${ORIGIN}/`, expires: Math.floor(Date.now() / 1000) + 15_552_000, httpOnly: true, secure: true, sameSite: 'Lax' }]);
        return route.fulfill({ status: 200, json: { state: 'yes' } });
      }
      world.said = false;
      await page.context().clearCookies({ name: '__Host-adm_v' });
      return route.fulfill({ status: 200, json: { state: 'withdrawn' } });
    }
    if (path.endsWith('/challenge')) return route.fulfill({ status: 200, json: { id: 'eyJ2IjoxfQ~sig', salt: 'salt', difficulty: 1, expiresAt: Date.now() + 60_000 } });
    if (path.endsWith('/answers')) {
      world.answers.push({ cookie });
      return route.fulfill({ status: 200, json: { state: 'sent', ending: 'sent' } });
    }
    if (path === '/x/forms/api/showroom-visit') {
      const tag: Tag = url.searchParams.get('lang') === 'ar-EG' ? 'ar-EG' : 'en-US';
      const visitor = world.level === 'visitor' ? { visitor: { banner: { language: tag, ...BANNER[tag], version: 'w-0123456789abcdef01234567' }, said: world.said ? 'yes' : null } } : {};
      return route.fulfill({ status: 200, json: { state: 'live', business: BUSINESS, accent: 'teal', today: '2026-11-18', form: { kind: 'form', language: tag, languages: [tag], definition: form(tag), anonymous: false }, ...visitor } });
    }
    if (path.startsWith('/x/')) return route.fulfill({ status: 200, contentType: 'text/html', body: readFileSync(join(DIST, 'x', 'index.html'), 'utf8') });
    return route.fulfill({ status: 404, body: '' });
  });
}

/** Everything the page stored: cookies, and both storages of its origin. */
async function stored(context: BrowserContext, page: Page) {
  const storage = await page.evaluate(() => ({ local: Object.keys(window.localStorage), session: Object.keys(window.sessionStorage) }));
  // Every cookie of the jar, whatever its path.
  return { cookies: await context.cookies(), ...storage };
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

const fresh = { storageState: { cookies: [], origins: [] } };

test.describe('the visitor banner on a stranger’s form page', () => {
  test('at Counts only: no cookie, no storage, no banner, and nothing asked of the consent door', async ({ browser }) => {
    const context = await browser.newContext(fresh);
    const page = await context.newPage();
    const world: World = { level: 'counts', said: false, consent: [], answers: [] };
    await serve(page, world);
    await page.goto(`${ORIGIN}/x/forms/showroom-visit`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('region', { name: BANNER['en-US'].title })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Cookie choice' })).toHaveCount(0);
    await page.locator('#x-q-qname').fill('Marta Kovac');
    await page.locator('#x-q-qemail').fill('marta.kovac@cobaltlegal.example');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
    expect(world.answers).toHaveLength(1);
    expect(world.consent).toEqual([]);
    expect(await stored(context, page)).toEqual({ cookies: [], local: [], session: [] });
    await context.close();
  });

  test('at Per visitor: nothing stored before an answer; "No" sets no cookie; "Yes" leaves only the server\'s cookie', async ({ browser }) => {
    const context = await browser.newContext(fresh);
    const page = await context.newPage();
    const world: World = { level: 'visitor', said: false, consent: [], answers: [] };
    await serve(page, world);
    await page.goto(`${ORIGIN}/x/forms/showroom-visit`);
    const banner = page.getByRole('region', { name: BANNER['en-US'].title });
    await expect(banner).toBeVisible();
    // Before any answer: nothing at all.
    expect(await stored(context, page)).toEqual({ cookies: [], local: [], session: [] });
    expect(world.consent).toEqual([]);

    // "No": no cookie, no request; only the choice, in this browser.
    await banner.getByRole('button', { name: 'No' }).click();
    await expect(page.getByText('Saved: no. Change it any time under Cookie choice.')).toBeVisible();
    expect(world.consent).toEqual([]);
    expect(await stored(context, page)).toEqual({ cookies: [], local: ['adm.x.choice'], session: [] });
    // The next page asks nothing.
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('region', { name: BANNER['en-US'].title })).toHaveCount(0);

    // "Cookie choice", then "Yes": the server's cookie, and the choice kept here goes.
    await page.getByRole('button', { name: 'Cookie choice' }).click();
    await expect(page.getByRole('heading', { name: BANNER['en-US'].title })).toBeFocused();
    await page.getByRole('region', { name: BANNER['en-US'].title }).getByRole('button', { name: 'Yes' }).click();
    await expect(page.getByText('Saved: yes. Change it any time under Cookie choice.')).toBeVisible();
    const after = await stored(context, page);
    expect(after.local).toEqual([]);
    expect(after.session).toEqual([]);
    expect(after.cookies.map(({ name, path, httpOnly, secure, sameSite, domain }) => ({ name, path, httpOnly, secure, sameSite, domain }))).toEqual([
      { name: '__Host-adm_v', path: '/', httpOnly: true, secure: true, sameSite: 'Lax', domain: 'forms.meridian.example' },
    ]);
    expect(after.cookies[0]!.expires * 1000).toBeLessThanOrEqual(Date.now() + 183 * 24 * 60 * 60 * 1000);
    // The answer goes with the cookie, so the server can join the visitor.
    await page.locator('#x-q-qname').fill('Marta Kovac');
    await page.locator('#x-q-qemail').fill('marta.kovac@cobaltlegal.example');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
    expect(world.answers.at(-1)?.cookie).toContain('__Host-adm_v=');
    await context.close();
  });

  test('docked under the page and clean through axe: desktop and phone, English and Arabic, light and dark', async ({ browser }) => {
    test.slow();
    const failures: string[] = [];
    for (const colorScheme of ['light', 'dark'] as const) {
      for (const viewport of [{ width: 1280, height: 760 }, { width: 390, height: 844 }]) {
        for (const tag of ['en-US', 'ar-EG'] as const) {
          const context = await browser.newContext({ ...fresh, viewport, colorScheme, locale: tag });
          const page = await context.newPage();
          await serve(page, { level: 'visitor', said: false, consent: [], answers: [] });
          const at = `${colorScheme}, ${String(viewport.width)}, ${tag}`;
          await page.goto(`${ORIGIN}/x/forms/showroom-visit?lang=${tag}`);
          const banner = page.getByRole('region', { name: BANNER[tag].title });
          await expect(banner).toBeVisible();
          await expect(page.locator('[data-testid="x-banner"]')).toHaveAttribute('dir', tag === 'ar-EG' ? 'rtl' : 'ltr');
          // Under the page, never over it: the band ends at the window's foot, the page's own part above it.
          const band = (await page.locator('[data-testid="x-banner"]').boundingBox())!;
          const scroll = (await page.locator('.x-scroll').boundingBox())!;
          expect(Math.round(band.y + band.height), `${at}: the band sits at the bottom`).toBe(viewport.height);
          expect(scroll.y + scroll.height, `${at}: nothing of the page is under the band`).toBeLessThanOrEqual(band.y + 1);
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${at}: no sideways scroll`).toBe(true);
          // The two buttons are the same size.
          const [yes, no] = await Promise.all([banner.getByRole('button', { name: BANNER[tag].yes }).boundingBox(), banner.getByRole('button', { name: BANNER[tag].no }).boundingBox()]);
          expect([Math.round(yes!.width), Math.round(yes!.height)], `${at}: equal buttons`).toEqual([Math.round(no!.width), Math.round(no!.height)]);
          expect(yes!.height).toBeGreaterThanOrEqual(44);
          await sweep(page, `${at}: asking`, failures);
          await banner.getByRole('button', { name: BANNER[tag].no }).click();
          await expect(page.getByRole('status').filter({ hasText: /Cookie|ملفات/ })).toBeVisible();
          await sweep(page, `${at}: answered`, failures);
          await context.close();
        }
      }
    }
    expect(failures, failures.join('\n\n')).toEqual([]);
  });
});
