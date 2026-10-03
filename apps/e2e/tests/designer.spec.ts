// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Adminium Designer, end to end, with a scripted model.
 *
 * `adminium design` in a project folder; its one-use link opens the Designer
 * signed in (no sign-in form); a request from Home starts a session; the
 * model writes a table, its page and its role, checks the app and applies it; the turn is saved as
 * v1; the preview frames the app on the preview's own host name, signed in
 * as the low preview user; the Architecture tab draws the new table. Each
 * page is swept by axe, in the light and the dark theme.
 *
 * The model speaks Ollama's streaming protocol from this process
 * (`createDesignerModelServer`): it proves the wiring, never that a real
 * model can build — that is the evaluation's job.
 */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

import { createDesignerModelServer } from '../scripts/fake-llm.mjs';
import { ProjectHarness } from './projectHarness.js';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const BLOCKING = new Set(['critical', 'serious']);
const APP_KEY = 'repair-desk';

let project: ProjectHarness;
let model: Server;
let link: string;

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
  model = createDesignerModelServer({ appKey: APP_KEY, files: Object.fromEntries(Object.entries(files).map(([file, value]) => [file, JSON.stringify(value, null, 2)])) });
  await new Promise<void>((resolve) => model.listen(0, '127.0.0.1', resolve));
  const modelUrl = `http://127.0.0.1:${String((model.address() as AddressInfo).port)}`;
  link = await project.design({ ADMINIUM_AI_OLLAMA_BASE_URL: modelUrl, ADMINIUM_AI_MODEL: 'ollama/fake' });
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

  // The preview: the dashboard, on the preview's own host name, signed in as the preview user.
  const frame = page.frameLocator('iframe[title="Dashboard"]');
  await expect(frame.getByRole('heading', { name: 'Jobs', exact: true })).toBeVisible({ timeout: 60_000 });
  expect(await page.locator('iframe[title="Dashboard"]').getAttribute('src')).toMatch(/^http:\/\/localhost:\d+\/designer-preview\/enter\?ticket=/);

  // The architecture: the table the turn applied, with its real name.
  await page.getByRole('tab', { name: 'Architecture' }).click();
  await expect(page.getByRole('heading', { name: 'How Repair desk fits together' })).toBeVisible();
  await expect(page.getByRole('tabpanel').last().getByRole('button', { name: 'jobs' })).toBeVisible();
  await bothThemes(page, 'Architecture', testInfo);

  // The chat column over a streamed turn, in a window short enough that it scrolls: it stays at its
  // end at every frame, and never moves back up while the Designer writes (it used to, by a line at
  // every file written, and a stray scroll event could stop it following for good).
  await page.setViewportSize({ width: 1280, height: 520 });
  await page.getByRole('tab', { name: 'Preview' }).click();
  await page.evaluate(() => {
    const scroller = document.querySelector('aside .nb-scroll') as HTMLElement;
    const frames: [number, number, number][] = [];
    (window as unknown as { chatFrames: typeof frames }).chatFrames = frames;
    const tick = (): void => {
      frames.push([scroller.scrollTop, scroller.scrollHeight, scroller.clientHeight]);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.getByRole('textbox', { name: 'Message to Adminium Designer' }).fill('Write them again, exactly as they are.');
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
    // Up, while nothing was taken away below it.
    if (before !== undefined && top < before[0] - 1 && height >= before[1]) movedBack += 1;
  });
  expect({ offEnd, movedBack }).toEqual({ offEnd: 0, movedBack: 0 });
});
