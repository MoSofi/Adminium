// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Adminium Designer, end to end, with a scripted model.
 *
 * `adminium design` in a project folder; its one-use link opens the Designer
 * signed in (no sign-in form); a request from Home starts a session; the
 * model writes a table, its page and its role, checks the app and applies it; the turn is saved as
 * v1; the preview frames the person's own dashboard, as the owner; the Architecture tab draws the new table. Each
 * page is swept by axe, in the light and the dark theme.
 *
 * The model speaks Ollama's streaming protocol from this process
 * (`createDesignerModelServer`): it proves the wiring, never that a real
 * model can build — that is the evaluation's job.
 */
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

import { createDesignerModelServer } from '../scripts/fake-llm.mjs';
import { ProjectHarness } from './projectHarness.js';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const BLOCKING = new Set(['critical', 'serious']);
const APP_KEY = 'repair-desk';
/** A word with nowhere to break, as a pasted address is. */
const LONG_WORD = `http://127.0.0.1:4700/api/v1/files/file_${'01M42ZQKVJ062DHES0A3P9SG1T'.repeat(3)}/content`;

let project: ProjectHarness;
let model: Server;
let link: string;
let designEnv: Record<string, string>;

test.describe.configure({ mode: 'serial' });
test.use({ storageState: { cookies: [], origins: [] } });

// eslint-disable-next-line no-empty-pattern -- Playwright reads fixtures from this pattern, and the hook needs none.
test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(240_000);
  project = await ProjectHarness.create({}, ['react', 'react-dom']);
  // What the model writes into the bare app: one table, its page, and the role that may use them.
  const files = {
    'manifest/tables/jobs.json': {
      ref: 'jobs',
      label: { 'en-US': 'Job' },
      labelPlural: { 'en-US': 'Jobs' },
      keyField: 'title',
      columns: [
        { ref: 'id', type: 'int', role: 'pk' },
        { ref: 'title', type: 'text', maxLength: 120, default: 'Untitled', label: { 'en-US': 'Title' } },
        { ref: 'status', type: 'enum', enum: ['open', 'done'], default: 'open', label: { 'en-US': 'Status' } },
      ],
    },
    [`manifest/pages/${APP_KEY}-jobs.json`]: {
      ref: `${APP_KEY}-jobs`,
      template: 'page-crud',
      title: { key: `${APP_KEY}.jobs`, fallback: 'Jobs' },
      nav: { group: 'main', icon: 'list-checks', order: 1 },
      bindings: { rows: 'jobs' },
    },
    'manifest/roles.json': [
      { key: 'staff', name: 'Repair desk staff', permissions: ['table:@jobs:read', 'table:@jobs:create', 'table:@jobs:update', `page:@${APP_KEY}-jobs:view`] },
    ],
  };
  model = createDesignerModelServer({ appKey: APP_KEY, appName: 'Repair desk', files: Object.fromEntries(Object.entries(files).map(([file, value]) => [file, JSON.stringify(value, null, 2)])) });
  await new Promise<void>((resolve) => model.listen(0, '127.0.0.1', resolve));
  const modelUrl = `http://127.0.0.1:${String((model.address() as AddressInfo).port)}`;
  designEnv = { ADMINIUM_AI_OLLAMA_BASE_URL: modelUrl, ADMINIUM_AI_MODEL: 'ollama/fake' };
  link = await project.design(designEnv);
});

test.afterAll(async () => {
  await project?.close();
  await new Promise<void>((resolve) => (model === undefined ? resolve() : model.close(() => resolve())));
});

// eslint-disable-next-line no-empty-pattern -- Playwright reads fixtures from this pattern, and the hook needs none.
test.afterEach(async ({}, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    await testInfo.attach('design server output', { body: project.output(), contentType: 'text/plain' });
  }
});

async function sweep(page: Page, label: string, testInfo: TestInfo): Promise<void> {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
  // The preview frame is the person's app, on another site: not ours to sweep.
  const results = await new AxeBuilder({ page }).withTags(TAGS).exclude('iframe').analyze();
  expect(results.passes.length, `${label} — axe analysed nothing`).toBeGreaterThan(3);
  const lesser = results.violations.filter((violation) => !BLOCKING.has(violation.impact ?? ''));
  if (lesser.length > 0) testInfo.annotations.push({ type: 'axe-lesser', description: `${label}: ${lesser.map((v) => `${String(v.impact)}:${v.id}`).join(', ')}` });
  const blocking = results.violations.filter((violation) => BLOCKING.has(violation.impact ?? ''));
  const report = blocking.map((v) => `${String(v.impact)}: ${v.id} — ${v.help}\n${v.nodes.slice(0, 4).map((n) => `    ${n.target.join(' ')}`).join('\n')}`).join('\n');
  expect(blocking, `${label} has ${String(blocking.length)} blocking violations:\n${report}`).toEqual([]);
}

/** Light, then dark, then back: the top bar's own theme button. */
async function bothThemes(page: Page, label: string, testInfo: TestInfo): Promise<void> {
  await sweep(page, `${label} (light)`, testInfo);
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await sweep(page, `${label} (dark)`, testInfo);
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
}

test('design opens signed in; a request builds, applies, previews and draws an app', async ({ page }, testInfo) => {
  testInfo.setTimeout(240_000);
  await page.goto(link);
  // No sign-in form: the link signed the owner in, and left the address.
  await expect(page.getByRole('heading', { name: 'What do you want to build?' })).toBeVisible();
  expect(new URL(page.url()).hash).toBe('');
  await expect(page.getByRole('button', { name: 'Model: fake' })).toBeVisible();
  await bothThemes(page, 'Home', testInfo);

  await page.getByRole('textbox', { name: 'Describe your app' }).fill('A repair desk: jobs and parts.');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/design\/ds_[0-9a-z]{24}$/);

  // The turn: the table written, checked, applied, saved as v1.
  await expect(page.getByText('The app has a jobs table now. It is applied and saved.')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText(/^Saved as v1$/)).toBeVisible();
  await page.getByRole('button', { name: /steps ·/ }).click();
  await expect(page.getByText('Checked the app — no errors')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Version v1: v1' })).toBeVisible();
  await bothThemes(page, 'Build', testInfo);

  // The preview's dashboard is the person's own, on the Designer's name: the owner, with the app's page and Studio both in reach.
  const frame = page.frameLocator('iframe[title="Dashboard"]');
  expect(await page.locator('iframe[title="Dashboard"]').getAttribute('src')).toBe('/');
  await expect(page.getByLabel('Seen as: owner. You, the owner.')).toBeVisible();
  await expect(frame.getByRole('button', { name: 'Set your password' })).toBeVisible({ timeout: 60_000 });
  expect(await frame.locator('body').evaluate(async () => (await fetch('/api/v1/auth/session')).text())).toContain('owner@adminium.localhost');

  // The architecture: the table the turn applied, with its real name.
  await page.getByRole('tab', { name: 'Architecture' }).click();
  await expect(page.getByRole('heading', { name: 'How Repair desk fits together' })).toBeVisible();
  await expect(page.getByRole('tabpanel').last().getByRole('button', { name: 'jobs' })).toBeVisible();
  await bothThemes(page, 'Architecture', testInfo);

  // The address bar: it reads where the dashboard's frame is, lists the app's pages, and takes a typed one, in place.
  await page.getByRole('tab', { name: 'Preview' }).click();
  // The same frame as before the other tab was looked at: the preview is kept, not opened again.
  await expect(frame.getByRole('button', { name: 'Set your password' })).toBeVisible();
  const address = page.getByRole('combobox', { name: 'Address on the dashboard side' });
  await expect(address).toBeEditable({ timeout: 15_000 });
  await address.click();
  const pages = page.getByRole('listbox', { name: 'Pages on this side' });
  await expect(pages.getByRole('option', { name: /repair-desk-jobs/ })).toContainText('Jobs');
  await sweep(page, 'Build, the address list open', testInfo);
  await address.fill(`p/${APP_KEY}-jobs/`);
  await page.keyboard.press('Enter');
  await expect(address).toHaveValue(`/p/${APP_KEY}-jobs`);
  await expect(frame.getByRole('heading', { name: 'Jobs' }).first()).toBeVisible({ timeout: 30_000 });
  // Moved in place: the dashboard was not loaded again, and Back still leaves the build page.
  expect(await frame.locator('body').evaluate(() => performance.getEntriesByType('navigation').length)).toBe(1);
  // A reload of the preview comes back to that page.
  await page.getByRole('button', { name: 'Reload the preview' }).click();
  await expect(page.locator('iframe[title="Dashboard"]')).toHaveAttribute('src', `/p/${APP_KEY}-jobs`);
  await expect(address).toHaveValue(`/p/${APP_KEY}-jobs`);
  // The Designer itself is never shown inside its own preview.
  await address.click();
  await address.fill('/design');
  await page.keyboard.press('Enter');
  await expect(address).toHaveValue(`/p/${APP_KEY}-jobs`);

  // Bar 1's menus and the dialog, each swept while open.
  await page.getByRole('button', { name: 'Version v1: v1' }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await sweep(page, 'Build, the version menu open', testInfo);
  await page.keyboard.press('Escape');

  // The work bar folds as the window narrows and never scrolls sideways; under about 1,100 the chat and the work area are two views.
  const sideways = (): Promise<number> =>
    page.evaluate(() => {
      const bar = document.querySelector<HTMLElement>('[data-part="work-bar"]:not([inert] *)');
      return bar === null ? -1 : Math.max(bar.scrollWidth - bar.clientWidth, document.documentElement.scrollWidth - window.innerWidth);
    });
  const levelNow = (): Promise<string | undefined> => page.evaluate(() => document.querySelector<HTMLElement>('[data-part="work-bar"]:not([inert] *)')?.dataset['level']);
  const seen: Record<number, string | undefined> = {};
  const layouts: Record<number, string> = {};
  let sweptMore = false;
  let sweptSize = false;
  for (const width of [1500, 1200, 1100, 1024, 900, 768, 390]) {
    await page.setViewportSize({ width, height: 800 });
    const views = page.getByRole('tablist', { name: 'View' });
    // Where the two views begin is measured from the bar's own words. This app has one side, so its bar is short
    // and the chat stays beside it further down than an app with a side switch: only the ends are fixed here.
    if (width >= 1200) await expect(views).toHaveCount(0);
    if (width <= 768) await expect(views).toBeVisible();
    await page.waitForTimeout(250);
    const two = (await views.count()) > 0;
    if (two) await views.getByRole('tab', { name: 'Work area' }).click();
    await expect(address).toBeVisible();
    await expect.poll(sideways, { message: `the bar at ${String(width)}` }).toBeLessThanOrEqual(1);
    seen[width] = await levelNow();
    layouts[width] = two ? 'two views' : 'one view';
    // Nothing is lost, only moved: the camera switch is in the bar or in "More".
    if (seen[width] === '0') await expect(page.getByRole('button', { name: 'The Designer looks at the page after it builds' })).toBeVisible();
    else {
      await page.getByRole('button', { name: 'More' }).click();
      await expect(page.getByRole('menuitemcheckbox', { name: 'The Designer looks at the page after it builds' })).toBeVisible();
      if (!sweptMore || width === 390) await sweep(page, `Build at ${String(width)}, More open`, testInfo);
      sweptMore = true;
      await page.keyboard.press('Escape');
    }
    // The size is one menu button from the bar's second fold on, wherever this app's bar reaches it.
    if (!sweptSize && (seen[width] === '2' || seen[width] === '3')) {
      await page.getByRole('button', { name: /^Size: / }).click();
      await expect(page.getByRole('menuitemradio', { name: 'Tablet' })).toBeVisible();
      await sweep(page, `Build at ${String(width)}, the size menu open`, testInfo);
      sweptSize = true;
      await page.keyboard.press('Escape');
    }
  }
  testInfo.annotations.push({ type: 'bar-levels', description: JSON.stringify({ seen, layouts }) });
  console.log(`bar levels ${JSON.stringify(seen)} ${JSON.stringify(layouts)}`);
  expect(seen[390]).toBe('4');
  expect(Number(seen[1500])).toBeLessThanOrEqual(Number(seen[900]));
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(page.getByRole('tablist', { name: 'View' })).toHaveCount(0);

  // The chat column over a streamed turn, in a window short enough that it scrolls: it stays at its
  // end at every frame, and never moves back up while the Designer writes (it used to, by a line at
  // every file written, and a stray scroll event could stop it following for good).
  await page.setViewportSize({ width: 1280, height: 520 });
  await page.getByRole('tab', { name: 'Preview' }).click();
  await page.evaluate(() => {
    const scroller = document.querySelector('aside .nb-scroll') as HTMLElement;
    const frames: [number, number, number][] = [];
    (window as unknown as { chatFrames: typeof frames }).chatFrames = frames;
    const page = window as unknown as { pageOverflow: number };
    page.pageOverflow = 0;
    const tick = (): void => {
      frames.push([scroller.scrollTop, scroller.scrollHeight, scroller.clientHeight]);
      page.pageOverflow = Math.max(page.pageOverflow, document.documentElement.scrollHeight - window.innerHeight);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.getByRole('textbox', { name: 'Message to Adminium Designer' }).fill(`Write them again, exactly as they are. ${LONG_WORD}`);
  await page.keyboard.press('Enter');
  // The same files again change nothing, so no version is saved: the turn is over when its own reply and summary are there.
  await expect(page.getByText('The app has a jobs table now. It is applied and saved.')).toHaveCount(2, { timeout: 120_000 });
  await expect(page.getByRole('button', { name: /steps ·/ })).toHaveCount(2);
  const frames = await page.evaluate(() => (window as unknown as { chatFrames: [number, number, number][] }).chatFrames);
  expect(frames.length).toBeGreaterThan(5);
  expect(Math.max(...frames.map(([, height, client]) => height - client)), 'the chat never overflowed: the test proves nothing').toBeGreaterThan(40);
  let offEnd = 0;
  let movedBack = 0;
  frames.forEach(([top, height, client], index) => {
    const before = frames[index - 1];
    // Off its end for two frames running is something a person sees.
    if (height - top - client > 1 && before !== undefined && before[1] - before[0] - before[2] > 1) offEnd += 1;
    // Up, while nothing was taken away below it, and not because the column itself grew taller (the message box shrinks once a long message is sent).
    if (before !== undefined && top < before[0] - 1 && height >= before[1] && client <= before[2]) movedBack += 1;
  });
  expect({ offEnd, movedBack }).toEqual({ offEnd: 0, movedBack: 0 });
  // A message with a word too long for its bubble (an address) is broken inside it: the chat never scrolls sideways.
  await expect(page.getByText(LONG_WORD)).toBeVisible();
  expect(await page.evaluate(() => ((scroller) => scroller.scrollWidth - scroller.clientWidth)(document.querySelector('aside .nb-scroll') as HTMLElement))).toBe(0);
  // The page itself never grows past the window while a step runs (a running step's hidden word once sat far below it, and the whole page scrolled to empty space).
  expect(await page.evaluate(() => (window as unknown as { pageOverflow: number }).pageOverflow)).toBe(0);

  // A picture from another site: the server names the sites pictures may come from, and none is added without a yes.
  const policyOf = async (): Promise<string> => (await page.request.get(new URL('/', page.url()).href)).headers()['content-security-policy'] ?? '';
  expect(await policyOf()).not.toContain('images.example.com');
  await page.getByRole('textbox', { name: 'Message to Adminium Designer' }).fill('Use pictures from images.example.com on the page.');
  await page.keyboard.press('Enter');
  // Asked on the one card for what a design needs: a checkbox for the site, ticked, with what allowing it means; "Send" says yes.
  const needs = page.getByRole('group', { name: 'The design needs a few things. Add them?' });
  await expect(needs).toBeVisible({ timeout: 120_000 });
  await expect(needs.getByRole('checkbox', { name: /Pictures from images\.example\.com — shown straight from that site/ })).toBeChecked();
  await expect(needs).toContainText('That site then sees each visit to a page that shows its pictures.');
  expect(await policyOf()).not.toContain('images.example.com');
  await needs.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(needs).toContainText('Added: pictures from images.example.com.');
  await expect(page.getByText(/^Pictures from images\.example\.com: Pictures from images\.example\.com show now\./)).toBeVisible({ timeout: 120_000 });
  // In the next reply's policy, with no restart, and kept in the project's .env for the next start.
  expect(await policyOf()).toMatch(/img-src 'self'[^;]* https:\/\/images\.example\.com(;|$)/);
  expect(readFileSync(project.path('.env'), 'utf8')).toMatch(/^ADMINIUM_CSP_IMG_HOSTS=https:\/\/images\.example\.com$/m);
});

test('tabs left open across a restart of the server do not stop a new one from loading', async ({ context }, testInfo) => {
  testInfo.setTimeout(240_000);
  const REPLY = 'The app has a jobs table now. It is applied and saved.';
  // Three tabs on the session, each with its live connections.
  const first = await context.newPage();
  await first.goto(await project.design(designEnv));
  await first.getByRole('button', { name: /^Continue / }).click();
  await expect(first).toHaveURL(/\/design\/ds_[0-9a-z]{24}$/);
  const session = first.url();
  const tabs = [first, await context.newPage(), await context.newPage()];
  for (const tab of tabs) {
    if (tab !== first) await tab.goto(session);
    await expect(tab.getByText(REPLY).first()).toBeVisible({ timeout: 60_000 });
  }

  /*
   * The server goes away for longer than three failed connects, as a restart
   * does, and comes back. Each open tab fell back to an event stream, which
   * holds one of the browser's six connections to the server; they used to
   * keep them for good, and a tab opened next waited forever for its data.
   */
  await project.stop();
  await first.waitForTimeout(6_000);
  const again = await project.design(designEnv);
  const fresh = await context.newPage();
  await fresh.goto(again);
  await expect(fresh.getByRole('heading', { name: 'What do you want to build?' })).toBeVisible({ timeout: 30_000 });
  await fresh.goto(session);
  await expect(fresh.getByText(REPLY).first()).toBeVisible({ timeout: 30_000 });
  // And the dashboard, in one more tab.
  const dashboard = await context.newPage();
  await dashboard.goto(new URL('/', session).href);
  await expect(dashboard.getByRole('button', { name: 'Set your password' })).toBeVisible({ timeout: 30_000 });

  // The old tabs are back on their sockets, and hold no stream.
  for (const tab of tabs) {
    await expect
      .poll(() => tab.evaluate(() => performance.getEntriesByType('resource').filter((entry) => entry.name.includes('/api/v1/events?')).every((entry) => (entry as PerformanceResourceTiming).responseEnd > 0)), { timeout: 60_000 })
      .toBe(true);
  }
});
