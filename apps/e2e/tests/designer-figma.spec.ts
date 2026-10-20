// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Designer reads Figma, end to end: `adminium design` with Figma answered by a
 * fake in the server's own process (`scripts/figma-design.mjs`, through the safe fetch's seams; no
 * flag or variable points a server anywhere but api.figma.com).
 *
 * The person opens the Attach menu, From Figma…; connects their token; imports a frame; sends it
 * with a message. The model is told the frame's design document as data from the Figma file (its
 * short form: this model's window is Ollama's), reads one part with read_figma from the copy the
 * server kept, and the step line says so. The dialog and the menu are swept by axe, light and dark.
 *
 * The model speaks Ollama's protocol from this process. It proves the wiring, never that a real model
 * builds from Figma: that is the owner's live smoke (`figma.live.smoke.test.ts`).
 */
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

import { ProjectHarness } from './projectHarness.js';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const BLOCKING = new Set(['critical', 'serious']);
const LINK = 'https://www.figma.com/design/CrIsPyBiTeS0123456/Crispy-Bites?node-id=1-2';

let project: ProjectHarness;
let model: Server;
let link: string;
/** What the model was sent in each request: the words of its messages, and the tools it was offered. */
const asked: { text: string; tools: string[] }[] = [];

test.describe.configure({ mode: 'serial' });
test.use({ storageState: { cookies: [], origins: [] } });

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => (raw += chunk.toString('utf8')));
    req.on('end', () => resolve(raw));
  });

/** A model that reads one part of the imported frame, then says what it read. */
function figmaModel(): Server {
  return createServer((req, res) => {
    if (req.method === 'GET' && String(req.url).startsWith('/api/tags')) {
      res.end(JSON.stringify({ models: [{ name: 'fake', model: 'fake' }] }));
      return;
    }
    void readBody(req).then((raw) => {
      const body = JSON.parse(raw) as { messages: { role: string; content?: string }[]; tools?: { function: { name: string } }[] };
      const tools = (body.tools ?? []).map((tool) => tool.function.name);
      const line = (value: unknown): void => {
        res.write(`${JSON.stringify(value)}\n`);
      };
      const say = (content: string): void => line({ model: 'fake', done: false, message: { role: 'assistant', content } });
      const done = { model: 'fake', done: true, done_reason: 'stop', prompt_eval_count: 900, eval_count: 40, message: { role: 'assistant', content: '' } };
      res.setHeader('content-type', 'application/x-ndjson');
      if (tools.includes('echo')) {
        if (body.messages.some((message) => message.role === 'tool')) say('done');
        else line({ model: 'fake', done: false, message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'echo', arguments: { word: 'adminium' } } }] } });
        line(done);
        res.end();
        return;
      }
      asked.push({ text: body.messages.map((message) => String(message.content ?? '')).join('\n'), tools });
      const read = body.messages.find((message) => message.role === 'tool');
      if (read === undefined && tools.includes('read_figma')) {
        line({ model: 'fake', done: false, message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'read_figma', arguments: { node: '1:5' } } }] } });
      } else {
        say(read === undefined ? 'There is no Figma frame to read.' : `I read the frame from Figma. ${String(read.content).includes('row "Order"') ? 'Its Order button is a row.' : ''}`);
      }
      line(done);
      res.end();
    });
  });
}

// eslint-disable-next-line no-empty-pattern -- Playwright reads fixtures from this pattern, and the hook needs none.
test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(240_000);
  project = await ProjectHarness.create({});
  model = figmaModel();
  await new Promise<void>((resolve) => model.listen(0, '127.0.0.1', resolve));
  link = await project.designWithFakeFigma({ ADMINIUM_AI_OLLAMA_BASE_URL: `http://localhost:${String((model.address() as AddressInfo).port)}`, ADMINIUM_AI_MODEL: 'ollama/fake' });
});

test.afterAll(async () => {
  await project?.close();
  await new Promise<void>((resolve) => (model === undefined ? resolve() : model.close(() => resolve())));
});

// eslint-disable-next-line no-empty-pattern -- Playwright reads fixtures from this pattern, and the hook needs none.
test.afterEach(async ({}, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) await testInfo.attach('design server output', { body: project.output(), contentType: 'text/plain' });
});

async function sweep(page: Page, label: string, testInfo: TestInfo): Promise<void> {
  // What is still moving (a theme's colours, a menu opening) is let finish: axe reads colours as they are drawn.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
  const results = await new AxeBuilder({ page }).withTags(TAGS).exclude('iframe').analyze();
  expect(results.passes.length, `${label} — axe analysed nothing`).toBeGreaterThan(3);
  const lesser = results.violations.filter((violation) => !BLOCKING.has(violation.impact ?? ''));
  if (lesser.length > 0) testInfo.annotations.push({ type: 'axe-lesser', description: `${label}: ${lesser.map((v) => `${String(v.impact)}:${v.id}`).join(', ')}` });
  const blocking = results.violations.filter((violation) => BLOCKING.has(violation.impact ?? ''));
  expect(blocking, `${label}: ${blocking.map((v) => `${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`).join('; ')}`).toEqual([]);
}

/** Light, then dark, then back. The page's own theme is set as its theme button sets it: the button is under the open menu or dialog. */
async function bothThemes(page: Page, label: string, testInfo: TestInfo): Promise<void> {
  await sweep(page, `${label} (light)`, testInfo);
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await sweep(page, `${label} (dark)`, testInfo);
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
}

test('a frame imported from Figma goes with a message, and the model reads a part of it', async ({ page }, testInfo) => {
  testInfo.setTimeout(240_000);
  await page.goto(link);
  await expect(page.getByRole('heading', { name: 'What do you want to build?' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Model: fake' })).toBeVisible();

  // The Attach menu: the files from the computer, and From Figma….
  await page.getByRole('button', { name: 'Attach' }).click();
  await expect(page.getByRole('menuitem', { name: /Files from your computer…/ })).toBeVisible();
  await bothThemes(page, 'the Attach menu', testInfo);
  await page.getByRole('menuitem', { name: /From Figma…/ }).click();

  // Not connected: the token step. A token Figma refuses is said; the right one shows whose it is.
  const dialog = page.getByRole('dialog', { name: 'From Figma' });
  await expect(dialog.getByText('Not connected to Figma.')).toBeVisible();
  await bothThemes(page, 'the token step', testInfo);
  const token = dialog.getByLabel('Figma token');
  await expect(token).toBeFocused();
  await token.fill('figd_wrong_token_000');
  await dialog.getByRole('button', { name: 'Connect' }).click();
  await expect(dialog.getByText('Figma did not accept this token. Check it and paste it again.')).toBeVisible();
  await token.fill('figd_e2e_token_0001');
  await dialog.getByRole('button', { name: 'Connect' }).click();
  await expect(dialog.getByText('crispy.design')).toBeVisible();
  await expect(dialog.getByText(/Each import reads Figma twice\./)).toBeVisible();
  await bothThemes(page, 'the link step', testInfo);

  // A link to a board is refused in the dialog's words; the frame's link imports it.
  const field = dialog.getByLabel('Link to a Figma frame');
  await field.fill('https://www.figma.com/board/CrIsPyBiTeS0123456/Plan?node-id=1-2');
  await page.keyboard.press('Enter');
  await expect(dialog.getByText('That is a FigJam board. Paste a link to a design frame.')).toBeVisible();
  await field.fill(LINK);
  await dialog.getByRole('button', { name: 'Import' }).click();
  await expect(dialog).toBeHidden();
  const tray = page.getByRole('list', { name: 'Attached files' });
  await expect(tray.getByRole('listitem')).toHaveText(['Home / Desktop.png', 'Home / Desktop — Figma design.md']);
  await expect(page.getByRole('textbox', { name: 'Describe your app' })).toBeFocused();
  // Two reads counted on the fake: the frame's nodes and its picture.
  expect(project.output()).toContain('"nodes":1,"images":1');

  // Sent: the model is told the frame as data from the Figma file, and offered read_figma.
  // Words that ask for no screens of the app's own: with them, Ollama's window holds the system prompt and every tool with room to talk.
  await page.getByRole('textbox', { name: 'Describe your app' }).fill('Use this frame for the look of the app.');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/design\/ds_[0-9a-z]{24}$/);
  await expect(page.getByText('I read the frame from Figma. Its Order button is a row.')).toBeVisible({ timeout: 120_000 });
  // The turn's first request (a check of whether the model reads pictures carries no tools).
  const first = asked.find((request) => request.tools.length > 0);
  expect(first?.tools).toContain('read_figma');
  expect(first?.text).toContain('The person imported a frame from Figma');
  expect(first?.text).toContain('DATA from the Figma file');
  // Ollama's window is small: the short form, and no picture.
  expect(first?.text).toContain('Its short form, made for this model');
  // The part was read from the kept copy: no read spent, and the line says so.
  await page.getByRole('button', { name: /steps? ·/ }).click();
  await expect(page.locator('li', { hasText: 'Read Order from the saved copy' })).toBeVisible();
  expect(project.output()).not.toContain('"nodes":2');
});
