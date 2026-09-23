// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An app's own addresses under axe — the fifteen states of the App Address
 * Pages design, in light and dark, in English and in Arabic (right to left).
 *
 * WHERE THEY LIVE. Rows 1–11 are the dashboard's own auth screens, which turn
 * into the venue's page only on a STAFF DOMAIN (a host mapped to the app's
 * staff side); rows 12–15 are pages the SERVER writes, with no scripts. So the
 * fixture app is installed and two hosts are mapped to it — `desk.localhost`
 * (staff) and `book.localhost` (customer). `*.localhost` reaches this machine
 * with no resolver flags, and a browser treats it as a trustworthy origin.
 *
 * WHAT IS REAL AND WHAT IS ANSWERED. The limits on this instance are per IP
 * and tight (five sign-ins a minute, three reset mails an hour), and one spec
 * must not spend the whole suite's budget. So the transient states — wrong
 * details, too many tries, no connection, the code step and a bad code, the
 * hand-over, "check your email" — are painted from the server's own reply
 * shapes on `page.route`, and exactly ONE real sign-in is made: the user with
 * no role, whose cookie every later run reuses. The server pages are real: the
 * app is really switched off, side by side and whole.
 *
 * THE SWEEP ASSERTS IT ANALYSED SOMETHING, like app-install-a11y: a floor on
 * `passes` per state, and a count of states at the end.
 */
import { AxeBuilder } from '@axe-core/playwright';
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Cookie,
  type Page,
  type Route,
  type TestInfo,
} from '@playwright/test';

import { APP_KEY, APP_VERSION, REUSE_CHOICES, appBundle } from './appBundle.js';
import { PORT } from './constants.js';
import { seededConnectionId } from './helpers.js';
import { textIn, type UiLocale } from './localeText.js';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const BLOCKING = new Set(['critical', 'serious']);
const STAFF = `desk.localhost:${String(PORT)}`;
const GUEST = `book.localhost:${String(PORT)}`;
const NO_ROLE = { email: 'e2e-no-role@adminium.local', name: 'Robin Norole', password: 'no-role-e2e-password' };

const COMBOS = [
  { theme: 'light', locale: 'en-US', dir: 'ltr' },
  { theme: 'dark', locale: 'en-US', dir: 'ltr' },
  { theme: 'light', locale: 'ar-EG', dir: 'rtl' },
  { theme: 'dark', locale: 'ar-EG', dir: 'rtl' },
] as const;

interface Sweep {
  states: number;
  minor: number;
  failures: string[];
}

async function sweep(page: Page, label: string, tally: Sweep, testInfo: TestInfo, floor = 5): Promise<void> {
  // Wait out the entrance transitions — but not a spinner, whose animation never finishes.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  // These pages are small (a card, a form); a sweep of nothing still passes fewer than this.
  expect(results.passes.length, `${label}: axe analysed nothing`).toBeGreaterThan(floor);
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
  if (blocking.length > 0) tally.failures.push(`${label} — ${String(blocking.length)} blocking:\n${report}`);
}

/** The document says the theme and the direction it was asked for — proven, not assumed. */
async function expectPainted(page: Page, combo: (typeof COMBOS)[number], label: string): Promise<void> {
  const probe = await page.evaluate(() => ({
    dir: document.documentElement.getAttribute('dir') ?? getComputedStyle(document.documentElement).direction,
    scheme: getComputedStyle(document.body).colorScheme,
    theme: document.documentElement.getAttribute('data-theme'),
    background: getComputedStyle(document.body).backgroundColor,
    lang: document.documentElement.getAttribute('lang'),
    sample: document.body.innerText.slice(0, 80).replace(/\s+/g, ' '),
  }));
  expect(probe.dir, `${label}: direction (lang=${String(probe.lang)}: "${probe.sample}")`).toBe(combo.dir);
  // A React page stamps data-theme; a server page follows the colour scheme.
  if (probe.theme !== null) expect(probe.theme, `${label}: theme`).toBe(combo.theme);
  else {
    const [r, g, b] = (probe.background.match(/\d+/g) ?? ['255', '255', '255']).map(Number);
    const light = (r! + g! + b!) / 3 > 128;
    expect(light ? 'light' : 'dark', `${label}: server page background ${probe.background}`).toBe(combo.theme);
  }
}

function contextFor(browser: Browser, host: string, combo: (typeof COMBOS)[number]): Promise<BrowserContext> {
  return browser.newContext({
    baseURL: `http://${host}`,
    locale: combo.locale,
    colorScheme: combo.theme,
    storageState: { cookies: [], origins: [] },
  });
}

/** The session user as `/auth/login` returns it, for the painted replies. */
const USER = { id: 'usr_a11y', email: 'staff@example.test', name: 'Sam Staff', isSuperAdmin: false };

test.describe.configure({ mode: 'serial' });

test.describe('an app’s own addresses under axe', () => {
  let noRoleCookies: Cookie[] = [];
  /** A second, unspent invitation: its link is row 11's "new password" page. */
  let resetPath = '';

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    const connectionId = await seededConnectionId(page);
    const bundle = appBundle('reuse');
    const query = new URLSearchParams({ key: APP_KEY, version: APP_VERSION, expectedSha512: bundle.integrity });
    const uploaded = await page.request.post(`/api/v1/apps/upload?${query.toString()}`, {
      headers: { 'content-type': 'application/octet-stream' },
      data: bundle.buffer,
    });
    expect(uploaded.ok(), await uploaded.text()).toBe(true);
    const installed = await page.request.post('/api/v1/apps/install', {
      data: { key: APP_KEY, version: APP_VERSION, connectionId, choices: REUSE_CHOICES },
    });
    expect(installed.ok(), await installed.text()).toBe(true);
    const mapped = await page.request.put(`/api/v1/apps/${APP_KEY}/domains`, {
      data: { domains: { [STAFF]: { side: 'staff' }, [GUEST]: { side: 'customer' } } },
    });
    expect(mapped.ok(), await mapped.text()).toBe(true);

    // A user with no role, invited and activated through the reset route.
    const invited = await page.request.post('/api/v1/users', { data: { email: NO_ROLE.email, name: NO_ROLE.name } });
    expect(invited.status(), await invited.text()).toBe(201);
    const invite = ((await invited.json()) as { invite: { token: string; activationPath: string } }).invite;
    await page.close();
    // Activated (the host does not matter to the reset route) …
    const activate = await browser.newPage();
    const activated = await activate.request.post('/api/v1/auth/password/reset', {
      data: { token: invite.token, newPassword: NO_ROLE.password },
    });
    expect(activated.ok(), await activated.text()).toBe(true);
    // A fresh invitation for the reset page: the first one is spent now.
    const reinvite = await activate.request.post('/api/v1/users', {
      data: { email: 'e2e-reset-page@adminium.local', name: 'Reset Page' },
    });
    expect(reinvite.status(), await reinvite.text()).toBe(201);
    resetPath = ((await reinvite.json()) as { invite: { activationPath: string } }).invite.activationPath;
    await activate.close();
    /*
     * … then signed in ONCE on the staff address, from a page there: Node's
     * resolver does not know `*.localhost` (Chromium does), and the cookie has
     * to belong to that host anyway. Later runs reuse it.
     */
    const context = await browser.newContext({ baseURL: `http://${STAFF}`, storageState: { cookies: [], origins: [] } });
    const signIn = await context.newPage();
    await signIn.goto('/login');
    const status = await signIn.evaluate(
      async ([email, password]) =>
        (
          await fetch('/api/v1/auth/login', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email, password }),
          })
        ).status,
      [NO_ROLE.email, NO_ROLE.password] as const,
    );
    expect(status, 'the no-role user signs in on the staff address').toBe(200);
    noRoleCookies = await context.cookies();
    await context.close();
  });

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.request.post(`/api/v1/apps/${APP_KEY}/enable`).catch(() => undefined);
    await page.request.put(`/api/v1/apps/${APP_KEY}/domains`, { data: { domains: {} } }).catch(() => undefined);
    await page.request.delete(`/api/v1/apps/${APP_KEY}`).catch(() => undefined);
    const users = (await (await page.request.get('/api/v1/users?q=e2e-')).json()) as { users?: { id: string; email: string }[] };
    for (const user of users.users ?? []) {
      if (user.email === NO_ROLE.email || user.email === 'e2e-reset-page@adminium.local') {
        await page.request.delete(`/api/v1/users/${user.id}`).catch(() => undefined);
      }
    }
    await page.close();
  });

  for (const combo of COMBOS) {
    const name = `${combo.theme}${combo.dir === 'rtl' ? ', Arabic (rtl)' : ''}`;
    test(`every state, ${name}`, async ({ browser, page: admin }, testInfo) => {
      test.setTimeout(240_000);
      const tally: Sweep = { states: 0, minor: 0, failures: [] };
      const tx = textIn(combo.locale as UiLocale);
      const at = (label: string): string => `${name} · ${label}`;

      // ── 1–4: the venue's sign-in, and its three messages ──────────────
      const staff = await contextFor(browser, STAFF, combo);
      const page = await staff.newPage();
      await page.goto('/login?next=%2F');
      await expect(page.locator('[data-part="staff-header"]')).toBeVisible();
      await expectPainted(page, combo, at('sign in'));
      await sweep(page, at('sign in'), tally, testInfo);

      const submit = async (): Promise<void> => {
        await page.locator('input[type="email"]').fill('staff@example.test');
        await page.locator('input[type="password"]').fill('not-the-password');
        await page.locator('input[type="password"]').press('Enter');
      };
      // The login reply, answered: one handler at a time.
      const answer = async (reply: (route: Route) => Promise<void>): Promise<void> => {
        await page.unroute('**/api/v1/auth/login');
        await page.route('**/api/v1/auth/login', reply);
      };
      await answer((route) =>
        route.fulfill({
          status: 401,
          json: { error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.', requestId: 'req_a11y' } },
        }),
      );
      await submit();
      await expect(page.getByText(tx('common:auth.staff.invalid'))).toBeVisible();
      await sweep(page, at('wrong details'), tally, testInfo);

      await answer((route) =>
        route.fulfill({
          status: 429,
          headers: { 'retry-after': '60' },
          json: { error: { code: 'RATE_LIMITED', message: 'Too many requests.', requestId: 'req_a11y' } },
        }),
      );
      await submit();
      await expect(page.getByText(tx('common:auth.staff.rateLimited'))).toBeVisible();
      await sweep(page, at('too many tries'), tally, testInfo);

      await answer((route) => route.abort('internetdisconnected'));
      await submit();
      await expect(page.getByText(tx('common:auth.staff.offline', { app: 'E2E Desk' }))).toBeVisible();
      await sweep(page, at('no connection'), tally, testInfo);

      // ── 5–6: the second step, and a code that does not work ───────────
      await answer((route) =>
        route.fulfill({
          status: 202,
          json: { data: { twoFactorRequired: true, challengeToken: 'challenge_a11y' } },
        }),
      );
      await submit();
      const code = page.locator('input[autocomplete="one-time-code"]');
      await expect(code).toBeVisible();
      await sweep(page, at('the code step'), tally, testInfo);
      await page.route('**/api/v1/auth/2fa/verify', (route) =>
        route.fulfill({
          status: 401,
          json: { error: { code: 'INVALID_2FA_CODE', message: 'Invalid code.', requestId: 'req_a11y' } },
        }),
      );
      await code.fill('123456');
      await code.press('Enter');
      await expect(page.getByText(tx('common:auth.staff.codeInvalid'))).toBeVisible();
      await sweep(page, at('a code that does not work'), tally, testInfo);
      await page.unroute('**/api/v1/auth/2fa/verify');

      /*
       * ── 7: opening the till ───────────────────────────────────────────
       * Shown between a good sign-in and the app's page arriving. A held
       * navigation cannot be swept — Playwright waits for it to commit — so the
       * app's page is answered 204 No Content, which a browser treats as "do
       * not navigate": the hand-over stays on screen, with nothing pending.
       */
      await page.goto('/login?next=%2F');
      await answer((route) => route.fulfill({ status: 200, json: { data: { user: USER } } }));
      await page.route(
        (url) => url.pathname === '/' && url.host === STAFF,
        (route) => (route.request().resourceType() === 'document' ? route.fulfill({ status: 204 }) : route.continue()),
      );
      await submit();
      await expect(page.locator('[data-part="staff-handover"]')).toBeVisible();
      await expect(page.getByText(tx('common:auth.staff.signedInAs', { name: USER.name }))).toBeVisible();
      await sweep(page, at('opening the till'), tally, testInfo);
      await page.unrouteAll({ behavior: 'ignoreErrors' });

      // ── 9–11: forgot, sent, a new password ─────────────────────────────
      await page.goto('/forgot');
      await expect(page.locator('input[type="email"]')).toBeVisible();
      await sweep(page, at('forgot password'), tally, testInfo);
      await page.route('**/api/v1/auth/password/forgot', (route) => route.fulfill({ status: 200, json: { data: { ok: true } } }));
      await page.locator('input[type="email"]').fill('staff@example.test');
      await page.locator('input[type="email"]').press('Enter');
      await expect(page.getByText(tx('common:auth.forgot.sentTitle'))).toBeVisible();
      await sweep(page, at('check your email'), tally, testInfo);
      await page.unroute('**/api/v1/auth/password/forgot');
      await page.goto(resetPath);
      await expect(page.locator('input[type="password"]').first()).toBeVisible();
      await sweep(page, at('a new password'), tally, testInfo);
      await staff.close();

      // ── 8: signed in, but no role for this app ─────────────────────────
      const noRole = await contextFor(browser, STAFF, combo);
      await noRole.addCookies(noRoleCookies);
      const denied = await noRole.newPage();
      /*
       * The page speaks the signed-in person's OWN language (theirs, else the
       * workspace's — what their dashboard would show), not the browser's. So
       * in the Arabic runs this person has chosen Arabic, as a staff member
       * who reads it would have; set in their own session, as they would.
       */
      await denied.goto('/login');
      const prefs = await denied.evaluate(async (locale) => {
        const boot = (await (await fetch('/api/v1/bootstrap')).json()) as { data?: { csrfToken?: string } };
        const reply = await fetch('/api/v1/me/prefs', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', 'x-adminium-csrf': boot.data?.csrfToken ?? '' },
          body: JSON.stringify({ locale }),
        });
        return reply.status;
      }, combo.dir === 'rtl' ? 'ar_EG' : null);
      expect(prefs, 'the no-role user sets their own language').toBe(200);
      const deniedReply = await denied.goto('/');
      testInfo.annotations.push({ type: 'no-role', description: `${name}: / → ${String(deniedReply?.status())}` });
      await expectPainted(denied, combo, at('no role'));
      await sweep(denied, at('no role'), tally, testInfo, 3);
      await noRole.close();

      // ── 12–14: not available — the guests' side, the staff side, the whole app ──
      const guests = await contextFor(browser, GUEST, combo);
      const guestPage = await guests.newPage();
      const staffOff = await contextFor(browser, STAFF, combo);
      const staffPage = await staffOff.newPage();

      expect((await admin.request.patch(`/api/v1/apps/${APP_KEY}/settings`, { data: { off: ['customer'] } })).ok()).toBe(true);
      expect((await guestPage.goto('/'))?.status(), 'the guests’ side switched off').toBe(503);
      await expectPainted(guestPage, combo, at('not available, guests'));
      await sweep(guestPage, at('not available, guests'), tally, testInfo, 3);

      expect((await admin.request.patch(`/api/v1/apps/${APP_KEY}/settings`, { data: { off: ['staff'] } })).ok()).toBe(true);
      expect((await staffPage.goto('/'))?.status(), 'the staff side switched off').toBe(503);
      await expectPainted(staffPage, combo, at('not available, staff side off'));
      await sweep(staffPage, at('not available, staff side off'), tally, testInfo, 3);

      expect((await admin.request.patch(`/api/v1/apps/${APP_KEY}/settings`, { data: { off: [] } })).ok()).toBe(true);
      expect((await admin.request.post(`/api/v1/apps/${APP_KEY}/disable`)).ok()).toBe(true);
      expect((await staffPage.goto('/'))?.status(), 'the app switched off').toBe(503);
      await expectPainted(staffPage, combo, at('not available, app disabled'));
      await sweep(staffPage, at('not available, app disabled'), tally, testInfo, 3);
      expect((await admin.request.post(`/api/v1/apps/${APP_KEY}/enable`)).ok()).toBe(true);

      // ── 15: an address the guests' domain does not serve ──────────────
      const missing = await guestPage.goto('/login');
      expect(missing?.status(), 'a reserved path on the guests’ domain').toBe(404);
      expect(missing?.headers()['content-type'], 'a page load gets a page, not the JSON envelope').toContain('text/html');
      await expectPainted(guestPage, combo, at('address not found'));
      await sweep(guestPage, at('address not found'), tally, testInfo);
      await guests.close();
      await staffOff.close();

      testInfo.annotations.push({
        type: 'axe-summary',
        description: `${name}: ${String(tally.states)} states, ${String(tally.minor)} lesser`,
      });
      expect(tally.states, 'a state was skipped').toBeGreaterThanOrEqual(15);
      expect(tally.failures.join('\n\n')).toBe('');
    });
  }
});
