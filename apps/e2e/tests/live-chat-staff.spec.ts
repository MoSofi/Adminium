// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE LIVE CHAT ADD-ON'S STAFF PAGES against a real server
 * (`liveChatStaffWorld.ts`), with the package installed from the add-ons
 * checkout:
 *
 * - a visitor starts a chat; it comes into the inbox live; staff take it and
 *   reply; the visitor's window reads the reply;
 * - the visitor leaves: the line under the composer says the reply also goes
 *   by e-mail, and the reply is mailed;
 * - "Make an enquiry" makes a row in the CRM's enquiries;
 * - Chat settings: saved, read back as Adminium keeps them, and shown again.
 *
 * Then each staff and settings board of the comps, drawn for the side-by-side
 * comparison (screenshots into `LIVE_CHAT_SHOTS`).
 *
 * Run alone, on its own port, after `pnpm build`:
 * `E2E_PORT=4880 ADD_ONS_REPO=<add-ons checkout> pnpm --filter @adminium/e2e e2e:chat-staff`
 * (or `LIVE_CHAT_PACKAGE=<live-chat .tgz>`). Without the package it is skipped,
 * saying why: the add-on lives in the add-ons repository.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { KEY, liveChatPackage, SERVER, startStaffWorld, type StaffWorld } from './liveChatStaffWorld.js';

let world: StaffWorld;
const SHOTS = process.env['LIVE_CHAT_SHOTS'] ?? '';
const found = liveChatPackage();

test.describe.configure({ mode: 'serial' });
test.skip('missing' in found, `skipped: ${'missing' in found ? found.missing : ''}`);

test.beforeAll(async () => {
  if ('missing' in found) return;
  world = await startStaffWorld();
});

test.afterAll(async () => {
  await world?.close();
});

async function signedIn(context: BrowserContext): Promise<void> {
  const [name, value] = world.cookie.split('=');
  await context.addCookies([{ name: name!, value: value!, domain: '127.0.0.1', path: '/' }]);
}

const inbox = (page: Page, conversation?: string) => page.goto(`${SERVER}/add-ons/${KEY}/${KEY}${conversation === undefined ? '' : `?conversation=${conversation}`}`);
const shot = async (page: Page, name: string): Promise<void> => {
  if (SHOTS === '') return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: false });
};

let token = '';
let id = '';

test('a visitor’s chat comes into the inbox live; staff take it and reply; the visitor reads the reply', async ({ page, context }) => {
  await signedIn(context);
  await page.setViewportSize({ width: 1440, height: 900 });
  await inbox(page);
  await expect(page.getByRole('heading', { name: 'Chat', level: 2 })).toBeVisible();
  await expect(page.getByText('No conversations')).toBeVisible();

  // The visitor writes; nobody reloads the inbox.
  const started = await world.start('Hello, we’re moving office in September. Can someone look at our layout?');
  token = started.token;
  id = started.id;
  await world.details(token, 'Marta Kovac', 'marta.kovac@cobaltlegal.example');
  await world.talk(token);
  const row = page.getByRole('listitem').filter({ hasText: 'Marta Kovac' });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row.getByRole('img', { name: 'Waiting for a person' })).toBeVisible();
  await expect(row.getByText('Website')).toBeVisible();

  await row.getByRole('button').click();
  await expect(page.getByRole('log', { name: 'Conversation' }).getByText('Hello, we’re moving office in September. Can someone look at our layout?')).toBeVisible();
  await page.getByRole('button', { name: 'Take over' }).click();
  await expect(page.getByText('You’re answering')).toBeVisible();
  await page.getByRole('textbox', { name: 'Write a message…' }).fill('Hi Marta, I’m Dana. Yes, we can look at the layout today.');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('log', { name: 'Conversation' }).getByText('Hi Marta, I’m Dana. Yes, we can look at the layout today.')).toBeVisible();

  const read = await world.poll(token);
  expect((read['messages'] as { kind: string; body: string }[]).filter((one) => one.kind === 'staff').map((one) => one.body)).toEqual(['Hi Marta, I’m Dana. Yes, we can look at the layout today.']);
  expect(world.rows('conversations', `id = ${id}`)[0]!['state']).toBe('open');
});

test('the visitor leaves: the line says the reply also goes by e-mail, and it is mailed', async ({ page, context }) => {
  await signedIn(context);
  await page.setViewportSize({ width: 1440, height: 900 });
  world.leave(id, 10);
  await inbox(page, id);
  const line = page.getByText('Marta has left the page. Your reply also goes to marta.kovac@cobaltlegal.example by e-mail.');
  await expect(line).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('complementary', { name: 'Visitor details' }).getByText(/Left the page/)).toBeVisible();
  await expect(page.getByRole('log', { name: 'Conversation' }).getByText(/Marta left the page/)).toBeVisible();
  await shot(page, 'build-2f');
  const before = await world.mailsQueued();
  await page.getByRole('textbox', { name: 'Write a message…' }).fill('Here is the layout we talked about.');
  const replied = page.waitForResponse((res) => res.url().endsWith(`/conversations/${id}/reply`));
  await page.getByRole('button', { name: 'Send' }).click();
  const answer = (await (await replied).json()) as { data: { mailed: boolean; reason: string | null } };
  expect(answer.data).toMatchObject({ mailed: true, reason: null });
  await expect.poll(() => world.mailsQueued()).toBeGreaterThan(before);
});

test('with no mail server, the line gives its reason and its link', async ({ page, context }) => {
  await signedIn(context);
  await page.setViewportSize({ width: 1440, height: 900 });
  const off = await world.composed.app.inject({ method: 'PUT', url: '/api/v1/settings/email', headers: { cookie: world.cookie }, payload: { smtp: null } });
  expect(off.statusCode, off.body).toBeLessThan(300);
  await inbox(page, id);
  await expect(page.getByText('Marta has left the page. Your reply shows only if Marta comes back. E-mail isn’t set up:', { exact: false })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('link', { name: 'Workspace settings → Email' })).toBeVisible();
  await shot(page, 'build-2g');
});

test('"Make an enquiry" makes a row in the table the CRM opens to the chat', async ({ page, context }) => {
  await signedIn(context);
  await page.setViewportSize({ width: 1440, height: 900 });
  await inbox(page, id);
  await page.getByRole('button', { name: 'Make an enquiry' }).click();
  await expect(page.getByText(/^Enquiry \d+$/)).toBeVisible();
  const enquiries = world.rows('enquiries');
  expect(enquiries).toHaveLength(1);
  expect(enquiries[0]).toMatchObject({ person: 'Marta Kovac', email: 'marta.kovac@cobaltlegal.example', state: 'open' });
  expect(world.rows('conversations', `id = ${id}`)[0]!['became_key']).toBe(String(enquiries[0]!['id']));
  await expect(page.getByRole('complementary', { name: 'Visitor details' }).getByText('Contact')).toBeVisible();
});

test('Chat settings round-trip: saved as Adminium keeps them, and shown again', async ({ page, context }) => {
  await signedIn(context);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${SERVER}/add-ons/${KEY}/${KEY}/settings`);
  await expect(page.getByRole('heading', { name: 'Opening hours' })).toBeVisible();
  await page.getByLabel('Welcome line, English').fill('We usually answer within an hour');
  await page.getByRole('switch', { name: 'Open on Sunday' }).click();
  await page.getByRole('switch', { name: /Milo drafts replies/ }).click();
  await page.getByLabel('Keep conversations for:').selectOption('6');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Chat settings saved')).toBeVisible();
  const saved = world.rows('settings')[0]!;
  expect(JSON.parse(String(saved['welcome']))).toEqual({ 'en-US': 'We usually answer within an hour' });
  expect(Number(saved['milo_drafts'])).toBe(1);
  expect(Number(saved['transcripts_months'])).toBe(6);
  await page.reload();
  await expect(page.getByLabel('Welcome line, English')).toHaveValue('We usually answer within an hour');
  await expect(page.getByLabel('Keep conversations for:')).toHaveValue('6');
});

test.describe('the comps’ boards, drawn for the comparison', () => {
  test.skip(SHOTS === '', 'set LIVE_CHAT_SHOTS to a folder to draw the boards');

  test('board 2, 2-mid, 2-phone, and the settings boards', async ({ page, context }) => {
    await signedIn(context);
    world.settle({ milo_drafts: true });
    for (const [name, width, height] of [['build-2', 1440, 900], ['build-2-mid', 1024, 900], ['build-2-phone', 390, 844]] as const) {
      await page.setViewportSize({ width, height });
      await inbox(page, id);
      await expect(page.getByRole('log', { name: 'Conversation' })).toBeVisible();
      await shot(page, name);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${SERVER}/add-ons/${KEY}/${KEY}/settings`);
    await expect(page.getByRole('heading', { name: 'Opening hours' })).toBeVisible();
    await shot(page, 'build-3a');
    await page.screenshot({ path: join(SHOTS, 'build-3a-full.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Opening hours' })).toBeVisible();
    await page.screenshot({ path: join(SHOTS, 'build-3e-full.png'), fullPage: true });
  });
});
