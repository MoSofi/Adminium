// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A model added in the desktop app is kept by the app, not by the project: the
 * Designer's own "Add a model" saves it through the app (which seals it with
 * the system's key store where there is one), the project's `.env` gains
 * nothing, and the next launch has the model without asking.
 *
 * And the other way round: a model a project's own `.env` names is not used
 * in the app. A folder from someone else must not point this computer's key
 * at an address of theirs.
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

import { expect, test, type ElectronApplication, type Page } from '@playwright/test';

import { createDesignerModelServer } from '../scripts/fake-llm.mjs';
import { ProjectHarness } from '../tests/projectHarness.js';
import { closeDesktop, launchDesktop } from './helpers/launch.js';

const FIRST_PORT = process.env['E2E_PORT'] === undefined || process.env['E2E_PORT'] === '' ? 4720 : Number(process.env['E2E_PORT']) + 20;

let project: ProjectHarness;
let model: Server;
let modelUrl: string;
let app: ElectronApplication;
let page: Page;
let userDataDir: string;
let envBefore: string;

test.describe.configure({ mode: 'serial' });

const launch = async (): Promise<void> => {
  ({ app, userDataDir } = await launchDesktop({
    ...(userDataDir === undefined ? {} : { userDataDir }),
    env: { ADMINIUM_DESKTOP_E2E_PROJECT: project.root, ADMINIUM_DESKTOP_E2E_PORT: String(FIRST_PORT), ADMINIUM_DISABLE_UPDATES: '1' },
  }));
  page = await app.firstWindow();
};

// eslint-disable-next-line no-empty-pattern -- Playwright reads fixtures from this pattern, and the hook needs none.
test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(300_000);
  project = await ProjectHarness.create({}, ['react', 'react-dom']);
  model = createDesignerModelServer({ appKey: 'repair-desk', appName: 'Repair desk', files: {} });
  await new Promise<void>((resolve) => model.listen(0, '127.0.0.1', resolve));
  modelUrl = `http://localhost:${String((model.address() as AddressInfo).port)}`;
  // The folder arrives naming a model and an address of its own.
  appendFileSync(join(project.root, '.env'), '\nADMINIUM_AI_COMPATIBLE_BASE_URL=http://localhost:9/v1\nADMINIUM_AI_COMPATIBLE_API_KEY=from-the-folder\nADMINIUM_AI_MODEL=compatible/theirs\n');
  envBefore = readFileSync(join(project.root, '.env'), 'utf8');
  await launch();
});

test.afterAll(async () => {
  if (app !== undefined) await closeDesktop(app, userDataDir);
  await new Promise<void>((resolve) => (model === undefined ? resolve() : model.close(() => resolve())));
  await project?.close();
});

test('a model the project’s own .env names is not used in the app', async () => {
  await expect(page.getByRole('heading', { name: 'What do you want to build?' })).toBeVisible({ timeout: 180_000 });
  await expect(page.getByRole('textbox', { name: 'Describe your app' })).toHaveAttribute('placeholder', 'Add a model to start');
  await expect(page.getByRole('button', { name: /^Model: / })).toHaveCount(0);
  const models = await page.evaluate(async () => (await fetch('/api/v1/designer/models')).json() as Promise<{ connections: unknown[]; kept: string | null; ignoredEnv: string[] }>);
  expect(models.connections).toEqual([]);
  expect(models.kept).toMatch(/^(key-store|plain)$/);
  expect(models.ignoredEnv.sort()).toEqual(['ADMINIUM_AI_COMPATIBLE_API_KEY', 'ADMINIUM_AI_COMPATIBLE_BASE_URL', 'ADMINIUM_AI_MODEL']);
});

test('"Add a model" keeps it with the app: the project’s .env gains nothing, and the screen says where it is kept', async () => {
  await page.getByRole('button', { name: 'Add a model' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Add a model' });
  await dialog.getByRole('button', { name: /Ollama/ }).click();
  await expect(dialog.getByRole('note')).toHaveText('This project’s .env names a model. In the app, models are kept on this computer; that line is not used.');
  await expect(dialog).toContainText('It is not put in your project, so a project you export or share carries none.');
  await dialog.getByRole('textbox', { name: 'Address' }).fill(modelUrl);
  await dialog.getByRole('button', { name: 'Test' }).click();
  await expect(dialog.getByText(/^Connected\./)).toBeVisible({ timeout: 30_000 });
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('button', { name: 'Model: fake' })).toBeVisible({ timeout: 30_000 });

  // Kept by the app, in its own folder; sealed wherever this system has a key store.
  const kept = JSON.parse(readFileSync(join(userDataDir, 'models.json'), 'utf8')) as { storage: string; values: Record<string, string> };
  expect(Object.keys(kept.values).sort()).toEqual(['ADMINIUM_AI_MODEL', 'ADMINIUM_AI_OLLAMA_BASE_URL']);
  if (kept.storage === 'key-store') expect(JSON.stringify(kept.values)).not.toContain(modelUrl);
  // The project's folder was not written to.
  expect(readFileSync(join(project.root, '.env'), 'utf8')).toBe(envBefore);
  // And the app's own settings file carries none of it.
  const config = join(userDataDir, 'config.json');
  if (existsSync(config)) expect(readFileSync(config, 'utf8')).not.toContain('ADMINIUM_AI');
});

test('the next launch has the model without asking', async () => {
  await closeDesktop(app, undefined);
  await launch();
  await expect(page.getByRole('heading', { name: 'What do you want to build?' })).toBeVisible({ timeout: 180_000 });
  await expect(page.getByRole('button', { name: 'Model: fake' })).toBeVisible({ timeout: 30_000 });
  expect(readFileSync(join(project.root, '.env'), 'utf8')).toBe(envBefore);
});
