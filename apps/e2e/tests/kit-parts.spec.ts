// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A kit part on an app's own screen.
 *
 * What only a browser and a real server can show: an app's staff page that is
 * a bundle of its own (here plain DOM, with no React at all) reads its side's
 * config, imports the kit's entry from the address the config names, and
 * mounts the mention text area; the box is drawn by the kit's own React and
 * styled by the kit's own sheet, under the server's content policy, with no
 * inline script; `@` and a few letters offer the real people of this
 * Adminium, read with the person's own session; a pick stores
 * `@[Name](usr_…)`; and the same box speaks Arabic, right to left.
 */
import { expect, test, type Page } from '@playwright/test';

import { bundleOf } from './appBundle.js';
import { ADMIN_NAME } from './constants.js';
import { seededConnectionId, signIn } from './helpers.js';

const KEY = 'e2e-kit';
const VERSION = '1.0.0';
const STAFF = `/apps/${KEY}/staff/`;

/**
 * An app of its own key with one table of its own name (`e2e_kit_notes`): a
 * table one app uses cannot be another's, so it shares none with the other
 * specs' apps, and the table goes with the app when the spec is done.
 */
const MANIFEST = {
  kind: 'app',
  manifestVersion: 1,
  key: KEY,
  name: 'E2E Kit',
  version: VERSION,
  publisher: { id: 'adminium', name: 'Adminium' },
  license: 'AGPL-3.0-only',
  description: { key: 'mft.e2e-kit.desc', fallback: 'A staff screen that mounts a kit part.' },
  categories: ['operations'],
  // A floor this server meets, as the other fixtures': the kit is the server's, not the manifest's.
  compatibility: { minAdminiumVersion: '0.2.8' },
  requiredSchema: {
    prefixed: true,
    tables: [{ ref: 'notes', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'body', type: 'text', nullable: true }] }],
  },
  pages: [{ ref: 'e2e-kit-notes', template: 'page-crud', title: { key: 'mft.e2e-kit.notes', fallback: 'Kit notes' }, nav: { group: 'library', icon: 'list', order: 9 }, bindings: { rows: 'notes' } }],
  frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { notes: '/' } }],
};

const PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Kit screen</title>
    <link rel="stylesheet" href="./screen.css" />
  </head>
  <body data-app="e2e-kit-staff">
    <h1 id="title">Notes</h1>
    <textarea id="own" aria-label="The app's own box"></textarea>
    <div id="box"></div>
    <pre id="stored"></pre>
    <p id="failed"></p>
    <script type="module" src="./screen.js"></script>
  </body>
</html>`;

/** The app's own sheet: its own font, and one token of its own to show the kit takes it. */
const SHEET = `body { font-family: Georgia, serif; margin: 24px; }
#own { border: 3px dashed rgb(1, 2, 3); }
body[data-tokens] { --accent: rgb(200, 30, 90); }`;

/** The whole screen: no framework, no bundler. What an app's loader does, in a dozen lines. */
const SCREEN = `const stored = document.querySelector('#stored');
try {
  const config = await (await fetch('surface-config.json', { credentials: 'same-origin' })).json();
  const asked = new URLSearchParams(location.search);
  const kit = await import(config.kit.entry);
  const box = await kit.mount('mentions', document.querySelector('#box'), {
    value: '',
    onChange: (text) => { stored.textContent = text; },
    label: asked.get('label') ?? 'Comment',
    placeholder: 'Write a note',
    locale: asked.get('locale') ?? config.locale,
    dir: asked.get('dir') ?? config.dir,
  });
  window.kitScreen = { config, box, contract: kit.contract, parts: kit.parts, kit };
  document.body.dataset.kit = 'ready';
} catch (error) {
  document.querySelector('#failed').textContent = String(error);
  document.body.dataset.kit = 'failed';
}`;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await signIn(page);
  const connectionId = await seededConnectionId(page);
  await page.request.delete(`/api/v1/apps/${KEY}`, { data: { dropTables: true, confirmKey: KEY } }).catch(() => undefined);
  const bundle = bundleOf({
    'package.json': JSON.stringify({ name: `@adminium-apps/${KEY}`, version: VERSION }),
    'manifest.json': JSON.stringify(MANIFEST),
    'staff/index.html': PAGE,
    'staff/screen.js': SCREEN,
    'staff/screen.css': SHEET,
  });
  const uploaded = await page.request.post(`/api/v1/apps/upload?expectedSha512=${encodeURIComponent(bundle.integrity)}`, { headers: { 'content-type': 'application/octet-stream' }, data: bundle.buffer });
  expect(uploaded.ok(), await uploaded.text()).toBe(true);
  const install = { key: KEY, version: VERSION, connectionId };
  const planned = await page.request.post('/api/v1/apps/plan', { data: install });
  expect(planned.ok(), await planned.text()).toBe(true);
  const { plan } = (await planned.json()) as { plan: { installable: boolean; checksum: string } };
  expect(plan.installable).toBe(true);
  const installed = await page.request.post('/api/v1/apps/install', { data: { ...install, planChecksum: plan.checksum } });
  expect(installed.ok(), await installed.text()).toBe(true);
  await page.close();
});

test.afterAll(async ({ browser }) => {
  const page = await browser.newPage();
  await signIn(page);
  await page.request.delete(`/api/v1/apps/${KEY}`, { data: { dropTables: true, confirmKey: KEY } }).catch(() => undefined);
  await page.close();
});

/** Everything the page was refused or could not run, for "nothing was blocked". */
function watch(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(String(error)));
  return problems;
}

async function open(page: Page, query = ''): Promise<void> {
  await page.goto(STAFF + query);
  await expect(page.locator('body')).toHaveAttribute('data-kit', /ready|failed/, { timeout: 30_000 });
  expect(await page.locator('#failed').textContent()).toBe('');
}

test('the config names the kit and the map, and the files it names are kept for good', async ({ page }) => {
  await signIn(page);
  const config = (await (await page.request.get(`${STAFF}surface-config.json`)).json()) as { kit?: { contract: number; entry: string; styles: string | null }; maps?: unknown; locale?: string; dir?: string };
  expect(config.kit?.contract).toBe(1);
  expect(config.kit?.entry).toMatch(/^\/assets\/kit\/kit-[\w-]+\.js$/);
  expect(config.maps).toEqual({ enabled: expect.any(Boolean) as unknown, server: expect.anything() as unknown, routing: expect.any(Boolean) as unknown });
  expect(config.locale).toBe('en-US');
  expect(config.dir).toBe('ltr');
  const entry = await page.request.get(config.kit!.entry);
  expect(entry.ok()).toBe(true);
  expect(entry.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
  expect(entry.headers()['content-type']).toContain('javascript');
});

test('a plain page mounts the mention box, and a person picked from the real list is stored by id', async ({ page }) => {
  await signIn(page);
  const problems = watch(page);
  const asked: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/api/v1/people')) asked.push(url.pathname + url.search);
  });
  await open(page);

  // The door's own answers.
  expect(await page.evaluate(() => (window as unknown as { kitScreen: { contract: number; parts: string[] } }).kitScreen.contract)).toBe(1);
  expect(await page.evaluate(() => (window as unknown as { kitScreen: { parts: string[] } }).kitScreen.parts)).toEqual(['mentions']);
  // The page has no React of its own, and the kit put none on the window.
  expect(await page.evaluate(() => 'React' in window || 'ReactDOM' in window)).toBe(false);
  // Only the mention box's files came: the door, the part, the words of one language, what they share with the dashboard, one sheet.
  expect(asked.some((path) => /^\/assets\/kit\/kit-[\w-]+\.js$/.test(path))).toBe(true);
  expect(asked.some((path) => /^\/assets\/kit\/mentions-[\w-]+\.js$/.test(path))).toBe(true);
  expect(asked.some((path) => /^\/assets\/kit\/en-US-[\w-]+\.js$/.test(path))).toBe(true);
  expect(asked.filter((path) => /^\/assets\/kit\/[a-z]{2}-[A-Z]{2}-/.test(path))).toHaveLength(1);
  expect(asked.filter((path) => path.endsWith('.css'))).toHaveLength(1);
  expect(asked.some((path) => /maplibre|index-/.test(path))).toBe(false);

  const box = page.getByLabel('Comment');
  await expect(box).toBeVisible();
  await expect(box).toHaveAttribute('placeholder', 'Write a note');
  const wrapper = page.locator('#box > .adm-kit');
  await expect(wrapper).toHaveAttribute('data-kit-part', 'mentions');
  await expect(wrapper).toHaveAttribute('dir', 'ltr');

  // The kit's sheet is on, and only inside the wrapper: the app's own heading, box and font are as the app made them.
  expect(await box.evaluate((el) => getComputedStyle(el).borderRadius)).toBe('10px');
  expect(await box.evaluate((el) => getComputedStyle(el).fontFamily)).toContain('Georgia');
  expect(await page.locator('#title').evaluate((el) => getComputedStyle(el).marginTop)).not.toBe('0px');
  expect(await page.locator('#own').evaluate((el) => getComputedStyle(el).borderTopStyle + ' ' + getComputedStyle(el).borderTopColor)).toBe('dashed rgb(1, 2, 3)');

  // By keyboard: `@`, a few letters, the real people of this Adminium, Enter.
  await box.click();
  await page.keyboard.type(`Thanks @${ADMIN_NAME.slice(0, 5)}`);
  const list = page.getByRole('listbox', { name: 'People to mention' });
  await expect(list).toBeVisible();
  const option = list.getByRole('option', { name: ADMIN_NAME, exact: true });
  await expect(option).toBeVisible();
  expect(await list.evaluate((el) => getComputedStyle(el).position)).toBe('absolute');
  expect(asked.some((path) => path.startsWith('/api/v1/people?limit=8&q='))).toBe(true);
  // Down to the person, wherever they are in the list.
  const index = await list.getByRole('option').evaluateAll((items, name) => items.findIndex((item) => item.textContent === name), ADMIN_NAME);
  for (let step = 0; step < index; step += 1) await page.keyboard.press('ArrowDown');
  await expect(option).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect(list).toBeHidden();
  await expect(box).toHaveValue(`Thanks @${ADMIN_NAME} `);
  await expect(box).toBeFocused();
  const stored = (await page.locator('#stored').textContent()) ?? '';
  expect(stored).toMatch(new RegExp(`^Thanks @\\[${ADMIN_NAME}\\]\\(usr_[0-9A-Za-z]{6,40}\\) $`));

  // The app changes a prop while the person is in the box: the caret stays, and typing goes on.
  await page.evaluate(() => (window as unknown as { kitScreen: { box: { update(props: Record<string, unknown>): void } } }).kitScreen.box.update({ placeholder: 'Another', invalid: true }));
  await expect(box).toHaveAttribute('aria-invalid', 'true');
  await expect(box).toBeFocused();
  await page.keyboard.type('for today');
  await expect(page.locator('#stored')).toHaveText(`${stored}for today`);

  // A second pick, by the mouse.
  await page.keyboard.type(` @${ADMIN_NAME.slice(0, 3)}`);
  await list.getByRole('option', { name: ADMIN_NAME, exact: true }).click();
  await expect(box).toBeFocused();
  expect((await page.locator('#stored').textContent())?.match(/@\[/g)).toHaveLength(2);

  // The app's own token colours the kit: the focus ring's border is the app's accent.
  await page.evaluate(() => document.body.setAttribute('data-tokens', ''));
  await page.evaluate(() => (window as unknown as { kitScreen: { box: { update(props: Record<string, unknown>): void } } }).kitScreen.box.update({ invalid: false }));
  await expect(box).not.toHaveAttribute('aria-invalid', 'true');
  await expect.poll(() => box.evaluate((el) => getComputedStyle(el).borderTopColor)).toBe('rgb(200, 30, 90)');

  // A part that is not built yet is refused by name; the page stands.
  const refused = await page.evaluate(async () => {
    const { kit } = (window as unknown as { kitScreen: { kit: { mount(part: string, element: Element, props: unknown): Promise<unknown> } } }).kitScreen;
    return kit.mount('board', document.body, {}).then(
      () => 'mounted',
      (error: { code?: string }) => error.code ?? 'no code',
    );
  });
  expect(refused).toBe('KIT_PART_NOT_YET');

  // Taken away again, the element is the app's as it was.
  await page.evaluate(() => (window as unknown as { kitScreen: { box: { unmount(): void } } }).kitScreen.box.unmount());
  await expect(page.locator('#box')).toBeEmpty();
  expect(problems).toEqual([]);
});

test('in Arabic the box reads right to left and speaks Arabic', async ({ page }) => {
  await signIn(page);
  const problems = watch(page);
  const asked: string[] = [];
  page.on('request', (request) => asked.push(new URL(request.url()).pathname));
  await open(page, `?locale=ar-EG&dir=rtl&label=${encodeURIComponent('تعليق')}`);

  const wrapper = page.locator('#box > .adm-kit');
  await expect(wrapper).toHaveAttribute('dir', 'rtl');
  await expect(wrapper).toHaveAttribute('lang', 'ar-EG');
  expect(asked.some((path) => /^\/assets\/kit\/ar-EG-[\w-]+\.js$/.test(path))).toBe(true);
  expect(asked.some((path) => /^\/assets\/kit\/en-US-/.test(path))).toBe(false);

  const box = page.getByLabel('تعليق');
  expect(await box.evaluate((el) => getComputedStyle(el).direction)).toBe('rtl');
  // The page around it stays as the app wrote it.
  expect(await page.locator('#title').evaluate((el) => getComputedStyle(el).direction)).toBe('ltr');
  await box.click();
  await page.keyboard.type(`@${ADMIN_NAME.slice(0, 5)}`);
  const list = page.getByRole('listbox', { name: 'أشخاص يمكن ذكرهم' });
  await expect(list).toBeVisible();
  // Under the box and as wide as it, from its right edge.
  const [boxEdge, listEdge] = await Promise.all([box.boundingBox(), list.boundingBox()]);
  expect(Math.round(listEdge!.x + listEdge!.width)).toBe(Math.round(boxEdge!.x + boxEdge!.width));
  expect(await list.getByRole('option').first().evaluate((el) => getComputedStyle(el).textAlign)).toMatch(/start|right/);
  await list.getByRole('option', { name: ADMIN_NAME, exact: true }).click();
  await expect.poll(() => page.locator('#stored').textContent()).toMatch(new RegExp(`^@\\[${ADMIN_NAME}\\]\\(usr_[0-9A-Za-z]{6,40}\\) $`));
  expect(problems).toEqual([]);
});
