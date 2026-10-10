// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The assistant on an app's own staff address.
 *
 * What only a browser and a real server can show: the server adds the loader
 * to a staff side's page for a person who may use the assistant; the loader
 * draws the button in a shadow root of its own; the first press opens the
 * dashboard's panel in a frame; a question is asked and answered there, as
 * the general assistant; closing gives the button back. And the customer side
 * of the same app, opened by the same signed-in person, gets none of it.
 */
import { expect, test } from '@playwright/test';

import { APP_KEY, APP_VERSION, CUSTOMER_MARK, REUSE_CHOICES, STAFF_MARK, appBundle } from './appBundle.js';
import { clearProvider, configureFakeProvider, seededConnectionId, signIn } from './helpers.js';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await signIn(page);
  const connectionId = await seededConnectionId(page);
  const bundle = appBundle('reuse');
  const query = new URLSearchParams({ key: APP_KEY, version: APP_VERSION, expectedSha512: bundle.integrity });
  const uploaded = await page.request.post(`/api/v1/apps/upload?${query.toString()}`, { headers: { 'content-type': 'application/octet-stream' }, data: bundle.buffer });
  expect(uploaded.ok(), await uploaded.text()).toBe(true);
  const installed = await page.request.post('/api/v1/apps/install', { data: { key: APP_KEY, version: APP_VERSION, connectionId, choices: REUSE_CHOICES } });
  expect(installed.ok(), await installed.text()).toBe(true);
  await configureFakeProvider(page);
  await page.close();
});

test.afterAll(async ({ browser }) => {
  const page = await browser.newPage();
  await signIn(page);
  await page.request.delete(`/api/v1/apps/${APP_KEY}`).catch(() => undefined);
  await clearProvider(page);
  await page.close();
});

test('the button on a staff side opens the panel, a question is answered, and the customer side has neither', async ({ page }) => {
  await signIn(page);
  const staff = `/apps/${APP_KEY}/staff/`;

  // The page as the server sends it to this person: the app's own, and one tag more.
  const sent = await (await page.request.get(staff, { headers: { 'sec-fetch-dest': 'document' } })).text();
  expect(sent).toContain(STAFF_MARK);
  expect(sent).toContain(`<script type="module" src="/assets/milo/loader.js" data-milo-loader data-app="${APP_KEY}"></script></body>`);
  // Into a frame (the dashboard's own view of the app) it is the file as it is: the shell's button serves there.
  const framed = await (await page.request.get(staff, { headers: { 'sec-fetch-dest': 'iframe' } })).text();
  expect(framed).toContain(STAFF_MARK);
  expect(framed).not.toContain('data-milo-loader');

  await page.goto(staff);
  await expect(page.locator(`body[data-app="${STAFF_MARK}"]`)).toBeVisible();
  // Drawn in a shadow root of its own, named in the person's language.
  const button = page.locator('[data-milo-host]').getByRole('button', { name: 'Ask Milo' });
  await expect(button).toBeVisible({ timeout: 15_000 });
  // Nothing of the panel is fetched before the first press.
  expect(await page.locator('[data-milo-host] iframe').count()).toBe(0);

  await button.click();
  const panel = page.frameLocator('[data-milo-host] iframe');
  await expect(panel.getByTestId('assistant-input')).toBeVisible({ timeout: 30_000 });
  await expect(button).toBeHidden();

  // The general assistant, asked from the app's address.
  await panel.getByTestId('assistant-input').fill('Where do I invite a colleague?');
  await panel.getByTestId('assistant-send').click();
  await expect(panel.getByText(/Team|do not have access/).last()).toBeVisible({ timeout: 30_000 });
  await expect(panel.getByTestId('assistant-asked-on')).toHaveCount(1);

  // Closed from inside the panel: the frame goes, the button is back and holds the focus.
  await panel.getByTestId('assistant-close').click();
  await expect(button).toBeVisible();
  await expect(page.locator('[data-milo-host] iframe')).toBeHidden();
  // Opened again it is the same conversation, not a new document.
  await button.click();
  await expect(panel.getByTestId('assistant-asked-on')).toHaveCount(1);

  // The customer side of the same app, by the same signed-in person: the file as it is, and no button.
  const customer = await (await page.request.get(`/apps/${APP_KEY}/customer/`, { headers: { 'sec-fetch-dest': 'document' } })).text();
  expect(customer).toContain(CUSTOMER_MARK);
  expect(customer).not.toContain('milo');
  await page.goto(`/apps/${APP_KEY}/customer/`);
  await expect(page.locator(`body[data-app="${CUSTOMER_MARK}"]`)).toBeVisible();
  await page.waitForTimeout(1_000);
  expect(await page.locator('[data-milo-host]').count()).toBe(0);
});
