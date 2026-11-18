// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE LIVE CHAT WINDOW ON A WEBSITE, against a real server (`chatWorld.ts`):
 * the owner's page loads `/x/embed.js` with `data-adminium-chat`, and a
 * visitor chats.
 *
 * - start a chat (the human check is solved for real), an automatic answer,
 *   "Talk to a person", the name and e-mail saved, the chat taken up again
 *   on another page, a person's reply, the chat closed, then a new chat;
 * - outside hours: a question left with an e-mail;
 * - a phone: the window is a sheet over the whole page, which stops
 *   scrolling under it;
 * - an Arabic website: the launcher on the left, the window right to left,
 *   dark as the business set it;
 * - no accessibility rule broken in the open window, light or dark.
 *
 * Run alone, on its own port: `pnpm --filter @adminium/e2e e2e:chat`.
 */
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Frame, type FrameLocator, type Page } from '@playwright/test';

import { ALL_DAY, ANSWER, KEY, NINE_ONLY, SERVER, SITE, startChatWorld, type ChatWorld } from './chatWorld.js';

let world: ChatWorld;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  world = await startChatWorld();
});

test.afterAll(async () => {
  await world?.close();
});

/** The owner's website: one page, with the chat's loader, in its own language and direction. */
async function site(page: Page, opts: { lang?: string; dir?: 'ltr' | 'rtl'; path?: string } = {}): Promise<FrameLocator> {
  await page.route(`${SITE}/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<!doctype html><html lang="${opts.lang ?? 'en'}" dir="${opts.dir ?? 'ltr'}"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Meridian</title></head><body style="margin:0;font-family:sans-serif"><main style="height:2400px;padding:32px"><h1>Visit our showroom</h1><p>Sit in the booths and try the chairs.</p></main><script src="${SERVER}/x/embed.js" data-adminium-chat="${KEY}" data-title="Meridian chat" async></script></body></html>`,
    }),
  );
  await page.goto(`${SITE}${opts.path ?? '/showroom'}`);
  return page.frameLocator('iframe[title="Meridian chat"]');
}

const chatFrame = (page: Page): Frame => page.frames().find((frame) => frame.url().startsWith(`${SERVER}/x/chat/`))!;
const frameBox = async (page: Page) => (await page.locator('iframe[title="Meridian chat"]').boundingBox())!;

/** The axe rules of WCAG 2.2 A and AA, over the page and the chat's frame. */
async function noViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(results.violations.map((one) => `${one.id}: ${one.nodes.map((node) => node.target.join(' ')).join(', ')}`)).toEqual([]);
}

test('a visitor chats: an automatic answer, a person, the chat on another page, closed, and a new one', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  const chat = await site(page);
  const launcher = chat.getByRole('button', { name: 'Chat with Meridian' });
  await expect(launcher).toBeVisible({ timeout: 30_000 });
  await expect(launcher).toHaveAttribute('aria-expanded', 'false');
  // The frame is as big as the launcher, at the page's bottom right.
  const closed = await frameBox(page);
  expect(closed.x + closed.width).toBeCloseTo(1280, 0);
  expect(closed.height).toBeLessThan(160);

  await launcher.click();
  const panel = chat.getByRole('dialog', { name: 'Chat with Meridian' });
  await expect(panel).toBeVisible();
  await expect(panel.getByText(/^Some answers here are automatic, picked from answers Meridian wrote\./)).toBeVisible();
  const open = await frameBox(page);
  expect(open.height).toBeGreaterThan(560);
  expect(open.width).toBeGreaterThan(380);

  const box = chat.getByRole('textbox', { name: 'Write a message…' });
  await expect(box).toBeFocused();
  await box.fill('do you take away our old desks?');
  await box.press('Enter');
  await expect(panel.getByText('do you take away our old desks?')).toBeVisible();
  // The answer comes by the next poll.
  await expect(panel.getByText(ANSWER)).toBeVisible({ timeout: 20_000 });
  await expect(panel.getByText('Automatic answer', { exact: true })).toBeVisible();
  await noViolations(page);
  const row = await world.conversation(await world.latest());
  expect(row['came_from']).toBe(`${SITE}/showroom`);

  await panel.getByRole('button', { name: 'Talk to a person' }).click();
  await expect(panel.getByText('You asked for a person.')).toBeVisible();
  await expect(panel.getByText('A person will answer here.')).toBeVisible();
  await panel.getByLabel('Your name (optional)').fill('Marta');
  await panel.getByLabel('Your e-mail (optional)').fill('marta.kovac@cobaltlegal.example');
  await panel.getByRole('button', { name: 'Save' }).click();
  await expect(panel.getByText(/Thanks, Marta\. If you leave, we’ll reply to/)).toBeVisible();
  expect(await world.conversation(await world.latest())).toMatchObject({ name: 'Marta', email: 'marta.kovac@cobaltlegal.example', state: 'waiting' });

  // Another page of the site: the chat is taken up again, open, from its start.
  await page.goto(`${SITE}/seating`);
  const again = page.frameLocator('iframe[title="Meridian chat"]').getByRole('dialog', { name: 'Chat with Meridian' });
  await expect(again.getByText(/^Your chat from \d\d:\d\d$/)).toBeVisible({ timeout: 30_000 });
  await expect(again.getByText(ANSWER)).toBeVisible();
  await expect(again.getByText(/Thanks, Marta\./)).toBeVisible();

  await world.reply('Hi Marta, I’m Dana. Yes, we can take the old desks away when we fit out your new office.');
  await expect(again.getByText('Dana from Meridian')).toBeVisible({ timeout: 20_000 });
  await expect(again.getByText('DW', { exact: true })).toBeVisible();
  // A person took it: the card goes.
  await expect(again.getByText('A person will answer here.')).toHaveCount(0);

  await world.closeLatest();
  await expect(again.getByText(/^Dana closed this chat · \d\d:\d\d$/)).toBeVisible({ timeout: 20_000 });
  const fresh = again.getByRole('button', { name: 'Start a new chat' });
  await expect(fresh).toBeVisible();
  await expect(again.getByRole('textbox', { name: 'Write a message…' })).toHaveCount(0);
  await fresh.click();
  await expect(again.getByText(ANSWER)).toHaveCount(0);
  await expect(again.getByRole('textbox', { name: 'Write a message…' })).toBeVisible();

  // Hidden, focus is back on the launcher, and the frame back to its size.
  await again.getByRole('button', { name: 'Hide chat' }).first().click();
  await expect(page.frameLocator('iframe[title="Meridian chat"]').getByRole('button', { name: 'Chat with Meridian' })).toBeFocused();
  expect((await frameBox(page)).height).toBeLessThan(160);
});

test('outside hours, a visitor leaves a question with their e-mail', async ({ page }) => {
  await world.settle({ hours: NINE_ONLY, time_zone: 'UTC' });
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    const chat = await site(page);
    await chat.getByRole('button', { name: 'Chat with Meridian' }).click({ timeout: 30_000 });
    const panel = chat.getByRole('dialog', { name: 'Chat with Meridian' });
    await expect(panel.getByText(/^Opens (today|tomorrow) at 9:00$/)).toBeVisible();
    // No automatic answers outside hours, so the first line never says there are.
    await expect(panel.getByText(/^A person answers here\./)).toBeVisible();
    await expect(chat.getByRole('textbox', { name: 'Write a message…' })).toHaveCount(0);
    await expect(panel.getByText(/^We’re away until 9:00 (today|tomorrow)\. Leave your question and your e-mail, and we’ll reply by e-mail\.$/)).toBeVisible();
    await panel.getByLabel('Your question').fill('Can we visit on Saturday?');
    await panel.getByLabel('Your e-mail').fill('marta.kovac@cobaltlegal.example');
    await panel.getByRole('button', { name: 'Send' }).click();
    await expect(panel.getByText('Thanks. We’ll reply to marta.kovac@cobaltlegal.example after 9:00.')).toBeVisible({ timeout: 20_000 });
    expect(await world.conversation(await world.latest())).toMatchObject({ state: 'waiting', email: 'marta.kovac@cobaltlegal.example' });
  } finally {
    await world.settle({ hours: ALL_DAY });
  }
});

test('on a phone the window is a sheet over the whole page, which holds still under it', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  const chat = await site(page);
  const launcher = chat.getByRole('button', { name: 'Chat with Meridian' });
  await expect(launcher).toBeVisible({ timeout: 30_000 });
  await launcher.click();
  const sheet = chat.getByRole('dialog', { name: 'Chat with Meridian' });
  await expect(sheet).toHaveAttribute('aria-modal', 'true');
  await expect.poll(async () => frameBox(page)).toMatchObject({ x: 0, y: 0, width: 390, height: 780 });
  await expect.poll(() => page.evaluate(() => document.documentElement.style.overflow)).toBe('hidden');
  await expect(chat.getByRole('button', { name: /^Chat with Meridian/ })).toHaveCount(0);
  const input = await sheet.getByRole('textbox', { name: 'Write a message…' }).evaluate((element) => getComputedStyle(element).fontSize);
  expect(input).toBe('16px');
  await sheet.getByRole('button', { name: 'Close chat' }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.style.overflow)).toBe('');
  await expect(launcher).toBeFocused();
});

test('on an Arabic website the launcher sits on the left and the window reads right to left, dark', async ({ page }) => {
  await world.settle({ theme: 'dark', welcome: { 'en-US': 'Hello', 'ar-EG': 'مرحبًا' } });
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    const chat = await site(page, { lang: 'ar', dir: 'rtl' });
    const launcher = chat.getByRole('button', { name: 'محادثة مع Meridian' });
    await expect(launcher).toBeVisible({ timeout: 30_000 });
    expect((await frameBox(page)).x).toBe(0);
    await launcher.click();
    const panel = chat.getByRole('dialog', { name: 'محادثة مع Meridian' });
    await expect(panel).toHaveAttribute('dir', 'rtl');
    // The business's own welcome, in Arabic, under its name.
    await expect(panel.locator('.xc-hours')).toHaveText('مرحبًا');
    await expect(panel.getByText(/^بعض الإجابات هنا تلقائية/)).toBeVisible();
    await expect(panel.getByRole('button', { name: 'اللغة: العربية' })).toContainText('AR');
    await expect(chat.locator('.xc')).toHaveAttribute('data-theme', 'dark');
    // The window is dark; the frame's own page stays light, so it stays transparent over the website.
    expect(await chatFrame(page).evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('light');
    const surface = await panel.evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(surface).toBe('rgb(20, 20, 25)');
    await chat.getByRole('textbox', { name: 'اكتب رسالة…' }).fill('هل تأخذون مكاتبنا القديمة؟');
    await chat.getByRole('textbox', { name: 'اكتب رسالة…' }).press('Enter');
    await expect(panel.getByText('هل تأخذون مكاتبنا القديمة؟')).toBeVisible({ timeout: 20_000 });
    await noViolations(page);
  } finally {
    await world.settle({ theme: 'light', welcome: null });
  }
});
