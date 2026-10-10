// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Connect to another Adminium": the other Adminium's pages open in a window
 * of their own with NONE of the app's bridge. A page that is somebody else's
 * must not be able to open a folder, change a setting or install an update on
 * this computer, whatever address it is served from (this spec serves it from
 * this very machine, the address the app's own pages come from).
 */
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

import { expect, test, type ElectronApplication, type Page } from '@playwright/test';

import { closeDesktop, launchDesktop } from './helpers/launch.js';

let other: Server;
let plain: Server;
let app: ElectronApplication;
let page: Page;
let userDataDir: string;
let address: string;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  // Another Adminium, as far as the app can tell: it answers its health with a version, and serves a page.
  other = createServer((request, response) => {
    if (request.url === '/api/v1/healthz') {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, version: '0.3.24', uptime: 1 }));
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>Their page</title><h1>Sign in to the other Adminium</h1>');
  });
  // Something that is not one.
  plain = createServer((_request, response) => void response.writeHead(200, { 'content-type': 'text/html' }).end('<h1>A router</h1>'));
  await new Promise<void>((resolve) => other.listen(0, '127.0.0.1', resolve));
  await new Promise<void>((resolve) => plain.listen(0, '127.0.0.1', resolve));
  address = `127.0.0.1:${String((other.address() as AddressInfo).port)}`;
  ({ app, userDataDir } = await launchDesktop({ env: { ADMINIUM_DISABLE_UPDATES: '1' } }));
  page = await app.firstWindow();
});

test.afterAll(async () => {
  if (app !== undefined) await closeDesktop(app, userDataDir);
  for (const server of [other, plain]) await new Promise<void>((resolve) => (server === undefined ? resolve() : server.close(() => resolve())));
});

test('an address where no Adminium answers is said so, and nothing is opened', async () => {
  await expect(page.getByRole('heading', { name: 'What would you like to do?' })).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: /Connect to another Adminium/ }).click();
  await page.getByLabel('Address').fill(`127.0.0.1:${String((plain.address() as AddressInfo).port)}`);
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(page.getByRole('alert')).toContainText('This address is not encrypted.');
  await page.getByRole('button', { name: 'Connect anyway' }).click();
  await expect(page.getByRole('alert')).toHaveText('Nothing that looks like Adminium answered at that address.');
  expect(app.windows()).toHaveLength(1);
});

test('the other Adminium opens in a window of its own, with none of the app’s bridge', async () => {
  await page.getByLabel('Address').fill(address);
  await page.getByRole('button', { name: 'Connect' }).click();
  const next = app.waitForEvent('window');
  await page.getByRole('button', { name: 'Connect anyway' }).click();
  const guest = await next;
  await expect(guest.getByRole('heading', { name: 'Sign in to the other Adminium' })).toBeVisible();
  // Somebody else's page, served from the same machine the app's own pages are: no bridge is on it.
  expect(await guest.evaluate(() => typeof (window as unknown as { adminiumDesktop?: unknown }).adminiumDesktop)).toBe('undefined');
  expect(await guest.evaluate(() => typeof (window as unknown as { require?: unknown }).require)).toBe('undefined');
  // The app's own window is still there, on its own page, with its bridge.
  expect(app.windows()).toHaveLength(2);
  expect(new URL(page.url()).protocol).toBe('file:');
  expect(await page.evaluate(() => typeof (window as unknown as { adminiumDesktop?: unknown }).adminiumDesktop)).toBe('object');
  // Its window is named by its address, and says it is not encrypted.
  const title = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((window) => window.getTitle()));
  expect(title).toContain(`${address} (not encrypted) — Adminium`);

  await expect(page.getByRole('heading', { name: 'Recent' })).toBeVisible();
  await expect(page.getByText('Adminium 0.3.24')).toBeVisible();
  const kept = JSON.parse(readFileSync(join(userDataDir, 'config.json'), 'utf8')) as { guests: Array<{ address: string; version: string }> };
  expect(kept.guests).toMatchObject([{ address: `http://${address}`, version: '0.3.24' }]);
});

test('"Forget" closes it and takes the address off the list', async () => {
  await page.getByRole('button', { name: `Forget http://${address}` }).click();
  await expect(page.getByRole('heading', { name: 'Recent' })).toBeHidden();
  await expect.poll(() => app.windows().length).toBe(1);
  expect((JSON.parse(readFileSync(join(userDataDir, 'config.json'), 'utf8')) as { guests: unknown[] }).guests).toEqual([]);
});
