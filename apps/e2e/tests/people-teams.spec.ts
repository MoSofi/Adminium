// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The console's people screens and the two cards of notification settings,
 * as a browser draws them (plan 67, T30 and T33).
 *
 * What only a browser shows: People and Teams as two entries of the rail and
 * two pages; a team made, led and deleted through its side sheet, by mouse
 * and by keyboard; the People list's Teams column; Suspend asking "Hand their
 * rows to…" before it suspends; "Which rows" in the design's sentences and
 * its three choices; the Quiet hours and Summaries cards, each with a switch
 * the server keeps. Every screen in Arabic (right to left), dark, at a
 * phone's 390 px, with no blocking axe finding and no sideways scroll.
 *
 * Two reads are answered by this test, not by the server under test: the rows
 * that name a person (the seeded Northwind tables say whose no row is, so no
 * row could name anybody), and the tables a role's limit could hold (the same
 * reason). What the server answers for them, to whom, and the hand-over
 * itself are proved on three engines (`apps/server/test/row-reach-routes.test.ts`).
 * The suspension, the hand-over call, the teams and the schedule are the real
 * server's.
 */
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { ADMIN_NAME } from './constants.js';
import { signIn } from './helpers.js';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const BLOCKING = new Set(['critical', 'serious']);
const STAMP = String(Date.now()).slice(-6);
const TEAM = `E2E North ${STAMP}`;
const LEAVER = { name: `E2E Leaver ${STAMP}`, email: `e2e-leaver-${STAMP}@adminium.local` };

const NAMED = {
  total: 8,
  private: true,
  unreadable: [],
  named: [
    { connectionId: 'c1', connectionName: 'Main', tableId: 'main.crm_deals', tableLabel: 'Deals', column: 'owner_id', rows: 6 },
    { connectionId: 'c1', connectionName: 'Main', tableId: 'main.crm_follow_ups', tableLabel: 'Follow-ups', column: 'owner_id', rows: 2 },
  ],
};

async function noBlockingAxe(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(results.passes.length, `${label}: axe analysed nothing`).toBeGreaterThan(10);
  const blocking = results.violations.filter((violation) => BLOCKING.has(violation.impact ?? ''));
  expect(blocking.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(' | ')}`), label).toEqual([]);
}

async function noSidewaysScroll(page: Page, label: string): Promise<void> {
  const wide = await page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth);
  expect(wide, `${label}: the page scrolls sideways`).toBeLessThanOrEqual(0);
}

async function schedule(page: Page): Promise<Record<string, unknown>> {
  const reply = await page.request.get('/api/v1/me/notification-schedule');
  expect(reply.ok()).toBe(true);
  return ((await reply.json()) as { data: Record<string, unknown> }).data;
}

const NOTHING_SET = { timezone: null, quiet: null, digestDay: null, digestTime: null, quietOn: true, summariesOn: true };

test.describe('the console’s people screens and notification settings', () => {
  let leaverId = '';

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    const made = await page.request.post('/api/v1/users', { data: { email: LEAVER.email, name: LEAVER.name } });
    expect(made.ok(), await made.text()).toBe(true);
    leaverId = ((await made.json()) as { user: { id: string } }).user.id;
    await page.close();
  });

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.request.delete(`/api/v1/users/${leaverId}?permanent=true`).catch(() => undefined);
    const teams = ((await (await page.request.get('/api/v1/teams')).json()) as { teams: { id: string; name: string }[] }).teams;
    for (const team of teams.filter((one) => one.name.startsWith('E2E North'))) await page.request.delete(`/api/v1/teams/${team.id}`).catch(() => undefined);
    await page.request.put('/api/v1/me/notification-schedule', { data: NOTHING_SET }).catch(() => undefined);
    await page.request.patch('/api/v1/me/prefs', { data: { theme: null, locale: null } }).catch(() => undefined);
    await page.close();
  });

  test.afterEach(async ({ page }) => {
    await page.request.patch('/api/v1/me/prefs', { data: { theme: null, locale: null } }).catch(() => undefined);
  });

  test('People and Teams are two pages of the rail; a team is made, led and deleted in its sheet', async ({ page }) => {
    await signIn(page);
    const rail = page.getByRole('navigation', { name: 'Primary' });
    await expect(rail.getByRole('link', { name: 'People', exact: true })).toHaveAttribute('href', '/settings/team');
    await rail.getByRole('link', { name: 'Teams', exact: true }).click();
    await expect(page).toHaveURL(/\/settings\/teams$/);
    await expect(page.getByRole('heading', { name: 'Teams', level: 1 })).toBeVisible();
    await expect(page.getByTestId('teams-notice')).toContainText('A team decides whose records a person can open');

    // A new team: nothing is made without a name, then the draft is saved at once.
    await page.getByTestId('teams-new').click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByText('Tick who leads. A lead’s “their team’s” covers everyone here.')).toBeVisible();
    await sheet.getByTestId('team-sheet-save').click();
    await expect(sheet.getByText('Give the team a name first.')).toBeVisible();
    await sheet.getByTestId('team-sheet-name').fill(TEAM);
    await sheet.getByTestId('team-sheet-add').selectOption({ label: ADMIN_NAME });
    await sheet.getByTestId('team-sheet-add-confirm').click();
    await sheet.getByRole('checkbox', { name: 'Leads' }).check();
    await sheet.getByTestId('team-sheet-save').click();
    await expect(sheet).toBeHidden();
    const row = page.getByTestId(`teams-row-${TEAM}`);
    await expect(row).toContainText(ADMIN_NAME);
    await expect(row).toContainText('Only the lead');

    // The server holds it as drawn.
    const held = ((await (await page.request.get('/api/v1/teams')).json()) as { teams: { name: string; members: { name: string; lead: boolean }[] }[] }).teams.find((team) => team.name === TEAM);
    expect(held?.members).toEqual([expect.objectContaining({ name: ADMIN_NAME, lead: true })]);

    // The People list says it: the same person, leading the team.
    await rail.getByRole('link', { name: 'People', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'People', level: 1 })).toBeVisible();
    const me = page.getByTestId('team-row').filter({ hasText: ADMIN_NAME });
    await expect(me.getByTestId('team-row-teams')).toContainText(`${TEAM} (leads)`);

    // By keyboard: the team's name opens its sheet, Escape closes it and gives the focus back.
    await page.goto('/settings/teams');
    const open = page.getByRole('button', { name: TEAM });
    await open.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByTestId('team-sheet-name')).toHaveValue(TEAM);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(open).toBeFocused();

    // Deleting asks first and says what it does not touch.
    await open.click();
    await page.getByTestId('team-sheet-delete').click();
    await expect(page.getByText('Its lead stops reaching the members’ rows. Nobody’s account and nobody’s rows are touched.')).toBeVisible();
    await page.getByTestId('teams-delete-confirm').click();
    await expect(page.getByTestId(`teams-row-${TEAM}`)).toHaveCount(0);
  });

  test('Suspend asks who takes their rows, and suspends and hands them over in one call', async ({ page }) => {
    await page.route('**/api/v1/users/*/rows', (route) => (route.request().method() === 'GET' ? route.fulfill({ json: NAMED }) : route.fallback()));
    const sent: string[] = [];
    page.on('request', (request) => {
      if (request.method() !== 'GET' && request.url().includes('/api/v1/users/')) sent.push(`${request.method()} ${new URL(request.url()).pathname}${new URL(request.url()).search}`);
    });
    await signIn(page);
    await page.goto('/settings/team');
    const row = page.getByTestId('team-row').filter({ hasText: LEAVER.email });
    await row.getByRole('button', { name: 'Suspend' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(`Suspend ${LEAVER.name}?`)).toBeVisible();
    const rows = dialog.getByTestId('team-suspend-rows');
    await expect(rows.getByText('Hand their 8 rows to…')).toBeVisible();
    await expect(rows.getByText('Deals: 6')).toBeVisible();
    await expect(rows.getByTestId('team-suspend-rows-kept')).toBeVisible();
    await expect(dialog.getByTestId('team-suspend-confirm')).toHaveText('Suspend');
    // The keyboard reaches the taker and the button in order.
    await rows.getByTestId('team-suspend-rows-to').focus();
    await rows.getByTestId('team-suspend-rows-to').selectOption({ label: ADMIN_NAME });
    await expect(dialog.getByTestId('team-suspend-confirm')).toHaveText('Hand over and suspend');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(dialog.getByTestId('team-suspend-confirm')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    expect(sent.filter((one) => one.startsWith('DELETE'))).toEqual([expect.stringMatching(new RegExp(`^DELETE /api/v1/users/${leaverId}\\?handTo=usr_`))]);
    await expect(row).toContainText('Suspended');

    // Suspended, their row offers the rows' hand-over for later.
    await row.getByRole('button', { name: 'Hand on rows' }).click();
    await expect(page.getByRole('dialog').getByText(`${LEAVER.name} is suspended and still owns these. Choose who takes them.`)).toBeVisible();
    await page.getByTestId('team-suspend-rows-to').selectOption({ label: ADMIN_NAME });
    await page.getByTestId('team-suspend-confirm').click();
    await expect(page.getByRole('dialog')).toBeHidden();
    expect(sent.at(-1)).toBe(`POST /api/v1/users/${leaverId}/rows/hand-over`);
  });

  test('Which rows: the design’s sentences and its three choices', async ({ page }) => {
    await page.route('**/api/v1/roles/*/rows', (route) =>
      route.fulfill({
        json: {
          roleId: 'x',
          locked: false,
          tables: [
            {
              ref: 'c1/main.crm_deals',
              connectionId: 'c1',
              connectionName: 'Main',
              tableId: 'main.crm_deals',
              label: 'Deals',
              private: false,
              ways: [{ kind: 'person', column: 'owner_id', label: 'Owner' }],
              granted: { read: true, update: false, delete: false },
              own: true,
              limit: null,
            },
          ],
        },
      }),
    );
    await signIn(page);
    await page.goto('/settings/roles');
    await page.getByTestId('roles-rows-viewer').click();
    const dialog = page.getByRole('dialog');
    const sentence = dialog.getByTestId('roles-rows-main.crm_deals-read-sentence');
    await expect(sentence).toHaveText('Every row of Deals, whoever Owner is.');
    const choices = dialog.getByTestId('roles-rows-main.crm_deals-read').getByRole('radio');
    await expect(choices).toHaveText(['All rows', 'Their team’s', 'Their own']);
    // One tab stop; the arrows move and choose.
    await choices.first().focus();
    await page.keyboard.press('ArrowRight');
    await expect(sentence).toHaveText('Only rows of Deals where Owner is this person, or someone in a team they lead.');
    await page.keyboard.press('ArrowRight');
    await expect(sentence).toHaveText('Only rows of Deals where Owner is this person.');
    await page.keyboard.press('Escape');
  });

  test('Quiet hours and Summaries: two cards, each with a switch the server keeps', async ({ page }) => {
    await page.request.put('/api/v1/me/notification-schedule', { data: NOTHING_SET });
    await signIn(page);
    await page.goto('/account/notifications');
    const quiet = page.getByTestId('quiet-hours');
    await expect(quiet.getByRole('heading', { name: 'Quiet hours' })).toBeVisible();
    await expect(quiet.getByTestId('quiet-lead')).toHaveText('Off. Notices and their e-mails arrive as they happen.');
    // By keyboard: the switch takes Space.
    await quiet.getByRole('switch', { name: 'Quiet hours' }).focus();
    await page.keyboard.press('Space');
    await expect(quiet.getByTestId('quiet-lead')).toContainText('Only its e-mail waits, and goes when they end.');
    await expect(quiet.getByTestId('quiet-example')).toHaveText('An e-mail that comes at 18:30 on Monday is sent at 08:00 on Tuesday, unless its kind is ticked below.');
    await expect.poll(async () => (await schedule(page))['quietOn']).toBe(true);
    const hours = (await schedule(page))['quiet'];
    expect(Object.keys(hours as object)).toHaveLength(7);

    // Off keeps the hours; on again brings back the same ones.
    await quiet.getByRole('switch', { name: 'Quiet hours' }).click();
    await expect(quiet.getByTestId('quiet-zone')).toHaveCount(0);
    await expect.poll(async () => (await schedule(page))['quietOn']).toBe(false);
    expect((await schedule(page))['quiet']).toEqual(hours);
    await page.reload();
    await expect(page.getByTestId('quiet-hours').getByRole('switch', { name: 'Quiet hours' })).toHaveAttribute('aria-checked', 'false');

    // "Not me": the day and time are kept.
    const summaries = page.getByTestId('summaries');
    await summaries.getByTestId('digest-day').selectOption('1');
    await expect.poll(async () => (await schedule(page))['digestDay']).toBe(1);
    await summaries.getByRole('switch', { name: 'Summaries' }).click();
    await expect(summaries.getByTestId('summaries-lead')).toHaveText('Off. No rule sends you a summary. Your day and time are kept for when you switch them on.');
    await expect.poll(async () => (await schedule(page))['summariesOn']).toBe(false);
    expect(await schedule(page)).toMatchObject({ digestDay: 1, digestTime: '08:00' });
  });

  for (const look of [
    { theme: 'light', locale: null, dir: 'ltr', width: 1280, heads: ['People', 'Teams', 'Quiet hours'] },
    { theme: 'dark', locale: 'ar_EG', dir: 'rtl', width: 390, heads: ['الأشخاص', 'الفِرق', 'ساعات الهدوء'] },
  ] as const) {
    test(`each screen, ${look.theme}, ${look.dir}, ${String(look.width)} px wide`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.request.put('/api/v1/me/notification-schedule', { data: { ...NOTHING_SET, timezone: 'UTC', quiet: { '1': { from: '18:30', to: '08:00' } } } });
      // Signed in first: the shell's own names are the chosen language's once the prefs are set.
      await signIn(page);
      await page.request.patch('/api/v1/me/prefs', { data: { theme: look.theme, locale: look.locale } });
      await page.setViewportSize({ width: look.width, height: 844 });
      const [people, teams, quietTitle] = look.heads;
      for (const [path, heading] of [
        ['/settings/team', people],
        ['/settings/teams', teams],
      ] as const) {
        await page.goto(path);
        await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
        expect(await page.evaluate(() => [document.documentElement.getAttribute('dir'), document.documentElement.getAttribute('data-theme')])).toEqual([look.dir, look.theme]);
        await noSidewaysScroll(page, path);
        await noBlockingAxe(page, `${path} · ${look.theme} · ${look.dir}`);
      }
      // The team sheet, open.
      await page.getByTestId('teams-new').click();
      await expect(page.getByRole('dialog')).toBeVisible();
      // Once it has slid in: inside the window, on the side the reading starts from the end of.
      await expect
        .poll(async () => {
          const box = await page.getByRole('dialog').boundingBox();
          return box !== null && box.x >= 0 && box.x + box.width <= look.width + 1;
        }, { message: 'the sheet fits the width' })
        .toBe(true);
      await noBlockingAxe(page, `team sheet · ${look.theme} · ${look.dir}`);
      await page.keyboard.press('Escape');

      await page.goto('/account/notifications');
      await expect(page.getByTestId('quiet-hours').getByRole('heading', { name: quietTitle })).toBeVisible();
      await expect(page.getByTestId('summaries')).toBeVisible();
      await noSidewaysScroll(page, 'notification settings');
      await noBlockingAxe(page, `notification settings · ${look.theme} · ${look.dir}`);
    });
  }
});
