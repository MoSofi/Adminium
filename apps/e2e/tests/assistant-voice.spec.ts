// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Speaking to the assistant, in a browser, against a real server.
 *
 * The browser records from Chromium's stand-in microphone (a test tone), the
 * recording goes through the server to the scripted model service's
 * transcription route, and the words come back into the field. What only this
 * can show: the button is absent while the workspace has it off; the one-time
 * notice comes before anything is heard; a real recording is made and sent;
 * and nothing is sent to the assistant by voice alone.
 */
import { expect, test } from '@playwright/test';

import { clearProvider, configureFakeProvider, signIn } from './helpers.js';

test.use({
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
  permissions: ['microphone'],
});

const voice = (page: import('@playwright/test').Page, value: Record<string, unknown>) => page.request.put('/api/v1/assistant/settings', { data: { voice: value } });

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await signIn(page);
  await configureFakeProvider(page);
  await page.close();
});

test.afterAll(async ({ browser }) => {
  const page = await browser.newPage();
  await signIn(page);
  await voice(page, { input: false });
  await clearProvider(page);
  await page.close();
});

test('the microphone: absent while switched off; then a notice, a recording, and the words in the field', async ({ page }) => {
  await signIn(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  expect((await voice(page, { input: false })).ok()).toBe(true);

  await page.goto('/settings/team');
  await page.getByTestId('assistant-bubble').click();
  const input = page.getByTestId('assistant-input');
  await expect(input).toBeVisible({ timeout: 20_000 });
  // Off in this workspace: there is no microphone to press.
  await expect(page.getByTestId('assistant-mic')).toHaveCount(0);

  // An administrator switches it on; the panel learns it when it is opened again.
  expect((await voice(page, { input: true })).ok()).toBe(true);
  await page.reload();
  await expect(input).toBeVisible({ timeout: 20_000 });
  const mic = page.getByRole('button', { name: 'Speak to Milo' });
  await expect(mic).toBeVisible({ timeout: 20_000 });

  // The first press says where the voice goes, and hears nothing yet.
  await mic.click();
  const notice = page.getByTestId('assistant-mic-notice');
  await expect(notice).toContainText('What you say is sent to');
  await expect(notice).toContainText('to be written down. Nothing is kept.');
  await expect(page.getByTestId('assistant-mic')).toHaveAttribute('data-state', 'idle');

  // Read: now it listens, in the person's language, with the seconds counting.
  const sent = page.waitForRequest((request) => request.url().includes('/api/v1/assistant/transcribe') && request.method() === 'POST');
  await page.getByTestId('assistant-mic-notice-ok').click();
  await expect(page.getByTestId('assistant-mic')).toHaveAttribute('data-state', 'listening', { timeout: 15_000 });
  await expect(page.getByTestId('assistant-mic-listening')).toContainText('English');
  // Nothing is sent by voice alone.
  await expect(page.getByTestId('assistant-send')).toBeDisabled();
  await page.waitForTimeout(1_600);

  // A second press stops and writes down.
  await page.getByRole('button', { name: 'Stop listening' }).click();
  const request = await sent;
  expect(request.headers()['content-type']).toContain('audio/webm');
  expect(request.url()).toContain('language=en_US');

  // The words wait in the field to be checked; the assistant was asked nothing. (The scripted service answers
  // only a form that holds a real recording, and says the language it was told: the recording travelled.)
  await expect(input).toHaveValue('How many orders shipped today (en)?', { timeout: 20_000 });
  await expect(page.getByTestId('assistant-mic-note')).toHaveText('Check the text, then send.');
  await expect(page.getByTestId('assistant-send')).toBeEnabled();

  // The second time there is no notice: straight to listening; Escape stops and writes down, after what was there.
  await input.fill('First.');
  await page.getByRole('button', { name: 'Speak to Milo' }).click();
  await expect(page.getByTestId('assistant-mic-notice')).toHaveCount(0);
  await expect(page.getByTestId('assistant-mic')).toHaveAttribute('data-state', 'listening', { timeout: 15_000 });
  await page.waitForTimeout(1_200);
  await page.getByTestId('assistant-mic').press('Escape');
  await expect(input).toHaveValue('First. How many orders shipped today (en)?', { timeout: 20_000 });
  // Escape stopped the microphone, not the panel.
  await expect(input).toBeVisible();

  // The day's minutes are counted: with none left, it says so and writes nothing.
  expect((await voice(page, { dailyMinutes: 1 })).ok()).toBe(true);
  const settings = (await (await page.request.get('/api/v1/assistant/availability')).json()) as { voice: { input: string } };
  expect(settings.voice.input).toBe('provider');
  expect((await voice(page, { dailyMinutes: 30 })).ok()).toBe(true);
});
