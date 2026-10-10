// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The offer to keep versions, in a project opened on a computer with no git.
 *
 * "No git" is the second test seam (`ADMINIUM_DESKTOP_E2E_GIT`, read only by an
 * unpackaged build): the app looks for nothing but its own git, and what it
 * fetches on a yes is this test's file from this test's server, checked
 * against this test's hash. Everything after the fetch is the product's own:
 * the hash as the file arrives, the unpack, the record, the look, the word to
 * the running server, and the version a turn then ends with.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test, type ElectronApplication, type Page } from '@playwright/test';

import { createDesignerModelServer } from '../scripts/fake-llm.mjs';
import { ProjectHarness } from '../tests/projectHarness.js';
import { closeDesktop, keepModels, launchDesktop, newUserDataDir } from './helpers/launch.js';

const APP_KEY = 'repair-desk';
const FIRST_PORT = process.env['E2E_PORT'] === undefined || process.env['E2E_PORT'] === '' ? 4760 : Number(process.env['E2E_PORT']) + 60;

let project: ProjectHarness;
let model: Server;
let downloads: Server;
let scratch: string;
let app: ElectronApplication;
let page: Page;
let userDataDir: string;
/** How many times the stand-in file was asked for. */
let fetched = 0;

test.describe.configure({ mode: 'serial' });

/** A git in the shape the real download has (`bin/git`), which hands every call to this machine's own. */
function standInGit(folder: string): { archive: Buffer; sha256: string } {
  const real = execFileSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  mkdirSync(join(folder, 'tree', 'bin'), { recursive: true });
  writeFileSync(join(folder, 'tree', 'bin', 'git'), `#!/bin/sh\nexec "${real}" "$@"\n`);
  chmodSync(join(folder, 'tree', 'bin', 'git'), 0o755);
  execFileSync('tar', ['-czf', join(folder, 'git.tar.gz'), '-C', join(folder, 'tree'), 'bin'], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
  const archive = readFileSync(join(folder, 'git.tar.gz'));
  return { archive, sha256: createHash('sha256').update(archive).digest('hex') };
}

// eslint-disable-next-line no-empty-pattern -- Playwright reads fixtures from this pattern, and the hook needs none.
test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(300_000);
  project = await ProjectHarness.create({}, ['react', 'react-dom']);
  const files = {
    'manifest/tables/jobs.json': {
      ref: 'jobs',
      label: { 'en-US': 'Job' },
      labelPlural: { 'en-US': 'Jobs' },
      keyField: 'title',
      columns: [
        { ref: 'id', type: 'int', role: 'pk' },
        { ref: 'title', type: 'text', maxLength: 120, default: 'Untitled', label: { 'en-US': 'Title' } },
      ],
    },
  };
  model = createDesignerModelServer({ appKey: APP_KEY, appName: 'Repair desk', files: Object.fromEntries(Object.entries(files).map(([file, value]) => [file, JSON.stringify(value, null, 2)])) });
  await new Promise<void>((resolve) => model.listen(0, '127.0.0.1', resolve));
  userDataDir = newUserDataDir();
  keepModels(userDataDir, { ADMINIUM_AI_OLLAMA_BASE_URL: `http://localhost:${String((model.address() as AddressInfo).port)}`, ADMINIUM_AI_MODEL: 'ollama/fake' });

  scratch = mkdtempSync(join(tmpdir(), 'adminium-e2e-git-'));
  const git = standInGit(scratch);
  downloads = createServer((request, response) => {
    if (request.url !== '/git.tar.gz') {
      response.writeHead(404).end();
      return;
    }
    fetched += 1;
    response.writeHead(200, { 'content-type': 'application/gzip', 'content-length': String(git.archive.length) }).end(git.archive);
  });
  await new Promise<void>((resolve) => downloads.listen(0, '127.0.0.1', resolve));

  ({ app } = await launchDesktop({
    userDataDir,
    env: {
      ADMINIUM_DESKTOP_E2E_PROJECT: project.root,
      ADMINIUM_DESKTOP_E2E_PORT: String(FIRST_PORT),
      ADMINIUM_DESKTOP_E2E_GIT: JSON.stringify({ url: `http://127.0.0.1:${String((downloads.address() as AddressInfo).port)}/git.tar.gz`, sha256: git.sha256, bytes: git.archive.length }),
      ADMINIUM_DISABLE_UPDATES: '1',
    },
  }));
  page = await app.firstWindow();
});

test.afterAll(async () => {
  if (app !== undefined) await closeDesktop(app, userDataDir);
  for (const server of [model, downloads]) await new Promise<void>((resolve) => (server === undefined ? resolve() : server.close(() => resolve())));
  await project?.close();
  if (scratch !== undefined) rmSync(scratch, { recursive: true, force: true });
});

test('with no git on the computer, Home offers to keep versions and fetches nothing by itself', async () => {
  await expect(page.getByRole('heading', { name: 'What do you want to build?' })).toBeVisible({ timeout: 180_000 });
  await expect(page.getByRole('heading', { name: 'Keep versions of your work?' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Download git \(\d+ MB\)$/ })).toBeVisible();
  expect(fetched).toBe(0);
  expect(existsSync(join(userDataDir, 'git'))).toBe(false);
});

test('"Not now" is kept for this computer, and the button under the lead brings the offer back', async () => {
  await page.getByRole('button', { name: 'Not now' }).click();
  await expect(page.getByRole('heading', { name: 'Keep versions of your work?' })).toBeHidden();
  await expect.poll(() => (JSON.parse(readFileSync(join(userDataDir, 'config.json'), 'utf8')) as { versionsDeclined?: boolean }).versionsDeclined).toBe(true);
  // A reload is a new page: the answer is the app's, not the page's.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Turn versions on' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Keep versions of your work?' })).toBeHidden();
  expect(fetched).toBe(0);
});

test('a request builds with versions off, and the version button says so with the way to turn them on', async () => {
  test.setTimeout(240_000);
  await page.getByRole('textbox', { name: 'Describe your app' }).fill('A repair desk: jobs and parts.');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/design\/ds_[0-9a-z]{24}$/);
  await expect(page.getByText('The app has a jobs table now. It is applied and saved.')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText(/^Saved as v1$/)).toBeHidden();
  await page.getByRole('button', { name: 'Versions: off' }).click();
  await expect(page.getByText('Versions are off on this computer.')).toBeVisible();
  await page.getByRole('menuitem', { name: 'Turn versions on' }).click();
  await expect(page.getByRole('dialog', { name: 'Keep versions of your work?' })).toBeVisible();
});

test('the download is checked, unpacked into the app’s own folder, and versions come on without a restart', async () => {
  const before = page.url();
  await page.getByRole('dialog').getByRole('button', { name: /^Download git/ }).click();
  await expect(page.getByText('Versions are on')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('dialog')).toBeHidden();
  expect(fetched).toBe(1);
  // The record is written last: with it, the folder is the app's own git.
  const record = JSON.parse(readFileSync(join(userDataDir, 'git', 'v2.53.0-4', 'installed.json'), 'utf8')) as { tag: string; entries: number };
  expect(record.tag).toBe('v2.53.0-4');
  expect(existsSync(join(userDataDir, 'git', 'v2.53.0-4', 'bin', 'git'))).toBe(true);
  // Asked for, so no longer declined.
  expect((JSON.parse(readFileSync(join(userDataDir, 'config.json'), 'utf8')) as { versionsDeclined?: boolean }).versionsDeclined).toBe(false);
  // The same server, the same page: nothing was restarted.
  expect(page.url()).toBe(before);
  // What was built before versions were on is kept as the first version, the moment they are.
  const versions = await page.evaluate(async (id) => (await fetch(`/api/v1/designer/sessions/${id}/versions`)).json() as Promise<{ available: boolean }>, new URL(before).pathname.split('/').pop() ?? '');
  expect(versions.available).toBe(true);
  await expect(page.getByRole('button', { name: 'Versions: off' })).toBeHidden();
});

test('the next launch finds the app’s own git and offers nothing', async () => {
  await closeDesktop(app, undefined);
  ({ app } = await launchDesktop({
    userDataDir,
    env: {
      ADMINIUM_DESKTOP_E2E_PROJECT: project.root,
      ADMINIUM_DESKTOP_E2E_PORT: String(FIRST_PORT),
      // The same seam: still no git on the computer but the app's own, which is now there.
      ADMINIUM_DESKTOP_E2E_GIT: JSON.stringify({ url: `http://127.0.0.1:${String((downloads.address() as AddressInfo).port)}/git.tar.gz`, sha256: (JSON.parse(readFileSync(join(userDataDir, 'git', 'v2.53.0-4', 'installed.json'), 'utf8')) as { sha256: string }).sha256, bytes: 1 }),
      ADMINIUM_DISABLE_UPDATES: '1',
    },
  }));
  page = await app.firstWindow();
  await expect(page.getByRole('heading', { name: 'What do you want to build?' })).toBeVisible({ timeout: 180_000 });
  await expect(page.getByRole('heading', { name: 'Keep versions of your work?' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Turn versions on' })).toBeHidden();
  expect(fetched).toBe(1);
});
