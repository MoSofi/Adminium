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
 *
 * And the board: the same page reads real rows of the app's own table with
 * the person's session, hands them to the kit as plain cards, and saves a
 * move through the data API. A card dragged with the mouse is saved and is
 * still there after a reload; one moved with the keyboard likewise; a move
 * the server refuses (the table's own state rule, a real 409) puts the card
 * back with the server's sentence on the board; Arabic runs right to left;
 * and at 390 wide the columns scroll inside the board, never the page.
 *
 * And the map: the same page hands real rows to the kit as pins, under the
 * server's own content policy, with the map server stood in for by this
 * test (its style, a sprite, letters and map pictures, so nothing leaves the
 * machine). The map library, its worker and its sheet all come from
 * `/assets`; a pin is picked, dragged with the mouse and moved with the
 * keyboard, each saved through the data API; a save the server refuses puts
 * the pin back with the server's sentence above the map; `update` leaves the
 * person's view where it was; switched off, nothing is asked of the map
 * server at all; a map server that is down leaves the list; Arabic runs
 * right to left round a map that does not mirror; and at 390 wide the list
 * goes under the map and the page never scrolls sideways.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
    tables: [
      { ref: 'notes', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'body', type: 'text', nullable: true }] },
      {
        ref: 'deals',
        columns: [
          { ref: 'id', type: 'int', role: 'pk' },
          { ref: 'title', type: 'text', maxLength: 80 },
          { ref: 'stage', type: 'enum', enum: ['new', 'talking', 'won'], default: 'new' },
          { ref: 'amount', type: 'int', default: 0 },
        ],
        // The rule the board's refusal is made of: a deal is won only after it has been talked about.
        states: { column: 'stage', initial: 'new', moves: { new: ['talking'], talking: ['won', 'new'] } },
      },
      {
        ref: 'places',
        columns: [
          { ref: 'id', type: 'int', role: 'pk' },
          { ref: 'name', type: 'text', maxLength: 80 },
          { ref: 'lat', type: 'float' },
          { ref: 'lng', type: 'float' },
        ],
      },
    ],
  },
  pages: [
    { ref: 'e2e-kit-notes', template: 'page-crud', title: { key: 'mft.e2e-kit.notes', fallback: 'Kit notes' }, nav: { group: 'library', icon: 'list', order: 9 }, bindings: { rows: 'notes' } },
    { ref: 'e2e-kit-deals', template: 'page-crud', title: { key: 'mft.e2e-kit.deals', fallback: 'Kit deals' }, nav: { group: 'library', icon: 'list', order: 10 }, bindings: { rows: 'deals' } },
    { ref: 'e2e-kit-places', template: 'page-crud', title: { key: 'mft.e2e-kit.places', fallback: 'Kit places' }, nav: { group: 'library', icon: 'list', order: 11 }, bindings: { rows: 'places' } },
  ],
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
    <p id="own-classes" class="flex hidden truncate sr-only border">The app's own line</p>
    <div id="board"></div>
    <div id="map"></div>
    <pre id="stored"></pre>
    <p id="failed"></p>
    <script type="module" src="./screen.js"></script>
  </body>
</html>`;

/** The app's own sheet: its own font, and one token of its own to show the kit takes it. */
const SHEET = `body { font-family: Georgia, serif; margin: 24px; }
#own { border: 3px dashed rgb(1, 2, 3); }
body[data-tokens] { --accent: rgb(200, 30, 90); }
body[data-part="board"] > h1, body[data-part="board"] > #own, body[data-part="board"] > #stored { display: none; }
body[data-part="board"] { margin: 12px; }
body[data-part="map"] > h1, body[data-part="map"] > #own, body[data-part="map"] > #stored { display: none; }
body[data-part="map"] { margin: 12px; }`;

/** The whole screen: no framework, no bundler. What an app's loader does, in a dozen lines. */
const SCREEN = `const stored = document.querySelector('#stored');
try {
  const config = await (await fetch('surface-config.json', { credentials: 'same-origin' })).json();
  const asked = new URLSearchParams(location.search);
  const kit = await import(config.kit.entry);
  if (asked.get('part') === 'board') {
    document.body.dataset.part = 'board';
    const { pipeline } = await import('./board.js');
    window.kitScreen = { config, kit, ...(await pipeline(config, kit, asked)) };
    document.body.dataset.kit = 'ready';
    throw 'mounted';
  }
  if (asked.get('part') === 'map') {
    document.body.dataset.part = 'map';
    const { places } = await import('./map.js');
    window.kitScreen = { config, kit, ...(await places(config, kit, asked)) };
    document.body.dataset.kit = 'ready';
    throw 'mounted';
  }
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
  if (error !== 'mounted') {
    document.querySelector('#failed').textContent = String(error);
    document.body.dataset.kit = 'failed';
  }
}`;

/**
 * The app's Pipeline screen, as an app with no framework writes it: read the
 * rows as the signed-in person, turn them into cards, save a move with a
 * PATCH that names the stage the card left, and answer the server's own
 * sentence when it says no. Amounts are written as text here: the board
 * prints what it is given.
 */
const BOARD = `const STAGES = [
  { id: 'new', label: 'New', tone: 'info' },
  { id: 'talking', label: 'Talking', tone: 'warn' },
  { id: 'won', label: 'Won', tone: 'pos' },
];

export async function pipeline(config, kit, asked) {
  const table = '/api/v1/data/' + config.connectionId + '/' + config.tables.deals;
  const call = (path, init) => fetch(table + path, { credentials: 'same-origin', ...init, headers: { 'content-type': 'application/json', 'x-adminium-csrf': config.csrfToken } });
  const money = new Intl.NumberFormat(asked.get('locale') ?? config.locale, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  const saves = [];

  async function read() {
    const { data } = await (await call('?limit=50&order=id.asc')).json();
    const cards = data.map((row) => ({
      id: String(row.id),
      columnId: row.stage,
      title: row.title,
      subtitle: 'Harbour Ltd',
      amount: money.format(row.amount),
      lines: [{ label: 'Close', value: '12 Mar' }],
      owner: 'Dana Reyes',
      reference: 'D-' + row.id,
    }));
    const columns = STAGES.map((stage) => {
      const rows = data.filter((row) => row.stage === stage.id);
      return { ...stage, count: rows.length, total: money.format(rows.reduce((sum, row) => sum + row.amount, 0)) };
    });
    return { cards, columns };
  }

  const refusedOf = async (reply) => ({ refused: (await reply.json().catch(() => ({}))).error?.message ?? 'Not saved.' });

  const board = await kit.mount('board', document.querySelector('#board'), {
    ...(await read()),
    ariaLabel: 'Pipeline',
    emptyLabel: 'No deals yet.',
    locale: asked.get('locale') ?? config.locale,
    dir: asked.get('dir') ?? config.dir,
    ...(asked.get('theme') === null ? {} : { theme: asked.get('theme') }),
    onOpen: (cardId) => { document.body.dataset.opened = cardId; },
    onMove: async (cardId, to, from) => {
      const reply = await call('/' + cardId, { method: 'PATCH', body: JSON.stringify({ values: { stage: to }, from }) });
      saves.push({ cardId, to, from, status: reply.status });
      if (!reply.ok) return refusedOf(reply);
      board.update(await read());
    },
    onAdd: async (columnId, title) => {
      const reply = await call('', { method: 'POST', body: JSON.stringify({ values: { title, amount: 0 } }) });
      saves.push({ added: title, columnId, status: reply.status });
      if (!reply.ok) return refusedOf(reply);
      board.update(await read());
    },
  });
  return { board, saves };
}`;

/**
 * The app's Customers screen: real rows as pins, a dragged pin saved with a
 * PATCH, the server's own sentence answered when it says no, and a route's
 * legs asked of this Adminium with the token the config gave. `maps` is the
 * config's, handed over as it came; `?maps=off` is this test saying what a
 * config says when maps are switched off.
 */
const MAP = `export async function places(config, kit, asked) {
  const headers = { 'content-type': 'application/json', 'x-adminium-csrf': config.csrfToken };
  const table = '/api/v1/data/' + config.connectionId + '/' + config.tables.places;
  const call = (path, init) => fetch(table + path, { credentials: 'same-origin', ...init, headers });
  const saves = [];
  const picked = [];
  const routes = [];

  async function read() {
    const { data } = await (await call('?limit=50&order=id.asc')).json();
    return data.map((row) => ({ id: String(row.id), label: row.name, lat: Number(row.lat), lng: Number(row.lng), ...(row.name === 'Depot' ? { tone: 'warn' } : {}) }));
  }

  const refusedOf = async (reply) => ({ refused: (await reply.json().catch(() => ({}))).error?.message ?? 'Not saved.' });

  const map = await kit.mount('map', document.querySelector('#map'), {
    maps: asked.get('maps') === 'off' ? { enabled: false, server: null, routing: false } : config.maps,
    pins: await read(),
    ariaLabel: 'Customers',
    locale: asked.get('locale') ?? config.locale,
    dir: asked.get('dir') ?? config.dir,
    ...(asked.get('theme') === null ? {} : { theme: asked.get('theme') }),
    ...(asked.get('settings') === null ? {} : { settingsHref: asked.get('settings') }),
    onSelect: (pinId) => { picked.push(pinId); document.body.dataset.picked = pinId; },
    onMovePin: async (pinId, at) => {
      const reply = await call('/' + pinId, { method: 'PATCH', body: JSON.stringify({ values: { lat: at.lat, lng: at.lng } }) });
      saves.push({ pinId, lat: at.lat, lng: at.lng, status: reply.status });
      if (!reply.ok) return refusedOf(reply);
    },
    ...(asked.get('route') === null ? {} : {
      route: async (stops) => {
        const reply = await fetch('/api/v1/geo/route', { method: 'POST', credentials: 'same-origin', headers, body: JSON.stringify({ stops }) });
        routes.push(reply.status);
        if (!reply.ok) throw new Error('No route.');
        return (await reply.json()).data;
      },
    }),
  });
  return { map, saves, picked, routes, read };
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
    'staff/board.js': BOARD,
    'staff/map.js': MAP,
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
  const config = (await (await page.request.get(`${STAFF}surface-config.json`)).json()) as { kit?: { contract: number; entry: string; styles: string[] }; maps?: unknown; locale?: string; dir?: string };
  expect(config.kit?.contract).toBe(1);
  expect(config.kit?.entry).toMatch(/^\/assets\/kit\/kit-[\w-]+\.js$/);
  // Every sheet of the kit, the one all parts stand on first, then the board's own and the map's.
  expect(config.kit?.styles).toHaveLength(3);
  expect(config.kit?.styles[0]).toMatch(/^\/assets\/kit\/root-[\w-]+\.css$/);
  expect(config.kit?.styles[1]).toMatch(/^\/assets\/kit\/board-[\w-]+\.css$/);
  expect(config.kit?.styles[2]).toMatch(/^\/assets\/kit\/map-[\w-]+\.css$/);
  for (const sheet of config.kit!.styles) {
    const reply = await page.request.get(sheet);
    expect(reply.headers()['content-type']).toContain('text/css');
    expect(reply.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
  }
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
  expect(await page.evaluate(() => (window as unknown as { kitScreen: { parts: string[] } }).kitScreen.parts)).toEqual(['mentions', 'board', 'map']);
  // The page has no React of its own, and the kit put none on the window.
  expect(await page.evaluate(() => 'React' in window || 'ReactDOM' in window)).toBe(false);
  // Only the mention box's files came: the door, the part, the words of one language, what they share with the dashboard, one sheet.
  expect(asked.some((path) => /^\/assets\/kit\/kit-[\w-]+\.js$/.test(path))).toBe(true);
  expect(asked.some((path) => /^\/assets\/kit\/mentions-[\w-]+\.js$/.test(path))).toBe(true);
  expect(asked.some((path) => /^\/assets\/kit\/en-US-[\w-]+\.js$/.test(path))).toBe(true);
  expect(asked.filter((path) => /^\/assets\/kit\/[a-z]{2}-[A-Z]{2}-/.test(path))).toHaveLength(1);
  expect(asked.filter((path) => path.endsWith('.css'))).toHaveLength(1);
  // Not the map engine, and not the dashboard itself: neither its entry nor its sheet.
  const dashboard = await (await page.request.get('/')).text();
  const entry = /<script[^>]+src="(\/assets\/index-[\w-]+\.js)"/.exec(dashboard)?.[1];
  expect(entry).toBeTruthy();
  expect(asked).not.toContain(entry);
  expect(asked.some((path) => /maplibre|\/assets\/index-[\w-]+\.css/.test(path))).toBe(false);
  // Nothing of the board came with the box: not its code, not drag and drop, not its sheet.
  expect(asked.some((path) => /board-|KanbanBoard-|core\.esm-/.test(path))).toBe(false);

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
    return kit.mount('import', document.body, {}).then(
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

/* ------------------------------------------------------------------ the board */

const BOARD_PAGE = '?part=board';
const DEALS = ['Harbour Cafe', 'Second Wind', 'Third Coast', 'Fourth Wall', 'Fifth Season'];

interface Save {
  cardId?: string;
  to?: string;
  from?: string;
  added?: string;
  status: number;
}

/**
 * Five deals, afresh for each test: three new, one being talked about, one
 * won. Made through the data API as the signed-in person, each stage reached
 * by the moves the table's own rule allows.
 */
async function seedDeals(page: Page): Promise<Record<string, string>> {
  const connectionId = await seededConnectionId(page);
  const table = `/api/v1/data/${connectionId}/e2e_kit_deals`;
  const listed = (await (await page.request.get(`${table}?limit=200`)).json()) as { data: { id: number }[] };
  for (const row of listed.data) expect((await page.request.delete(`${table}/${String(row.id)}`)).ok()).toBe(true);
  const ids: Record<string, string> = {};
  for (const [index, title] of DEALS.entries()) {
    const made = await page.request.post(table, { data: { values: { title, amount: (index + 1) * 100 } } });
    expect(made.ok(), await made.text()).toBe(true);
    ids[title] = String(((await made.json()) as { data: { id: number } }).data.id);
  }
  const move = async (title: string, from: string, to: string): Promise<void> => {
    const moved = await page.request.patch(`${table}/${ids[title]!}`, { data: { values: { stage: to }, from } });
    expect(moved.ok(), await moved.text()).toBe(true);
  };
  await move('Fourth Wall', 'new', 'talking');
  await move('Fifth Season', 'new', 'talking');
  await move('Fifth Season', 'talking', 'won');
  return ids;
}

const column = (page: Page, id: string) => page.locator(`#board [data-board-column="${id}"]`);
const cardsIn = (page: Page, id: string): Promise<string[]> => column(page, id).locator('[data-board-card]').evaluateAll((cards) => cards.map((card) => card.getAttribute('aria-label') ?? ''));
const card = (page: Page, title: string) => page.locator('#board').getByRole('button', { name: title, exact: true });
const saves = (page: Page): Promise<Save[]> => page.evaluate(() => (window as unknown as { kitScreen: { saves: Save[] } }).kitScreen.saves);
const spoken = (page: Page) => page.locator('#board [data-board-liveregion]');

/** Every class worn inside the kit's wrapper that no rule of any sheet names: the board drawn without part of its look. */
function unstyledClasses(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const selectors: string[] = [];
    const collect = (rules: CSSRuleList): void => {
      for (const rule of rules) {
        if ('selectorText' in rule) selectors.push(String(rule.selectorText));
        if ('cssRules' in rule) collect(rule.cssRules as CSSRuleList);
      }
    };
    for (const sheet of document.styleSheets) collect(sheet.cssRules);
    const all = selectors.join('\n');
    const bare = new Set<string>();
    for (const element of document.querySelectorAll('.adm-kit, .adm-kit *')) {
      for (const name of element.classList) {
        // lucide names its icons by class and styles none of them; the map library has two names of its own it styles nothing by.
        if (!name.startsWith('lucide') && name !== 'maplibregl-control-container' && name !== 'maplibregl-marker-anchor-center' && !all.includes(`.${CSS.escape(name)}`)) bare.add(name);
      }
    }
    return [...bare].sort();
  });
}

test('a plain page mounts the board from real rows, and a card dragged with the mouse is saved', async ({ page }) => {
  await signIn(page);
  const ids = await seedDeals(page);
  const problems = watch(page);
  const asked: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/assets/')) asked.push(url.pathname);
  });
  await open(page, BOARD_PAGE);

  // The board's own files came, each once: its code, drag and drop, and the two sheets. No map, no dashboard sheet.
  expect(asked.filter((path) => /^\/assets\/kit\/board-[\w-]+\.js$/.test(path))).toHaveLength(1);
  expect(asked.filter((path) => /^\/assets\/KanbanBoard-/.test(path))).toHaveLength(1);
  expect(asked.filter((path) => path.endsWith('.css')).sort()).toEqual([expect.stringMatching(/^\/assets\/kit\/board-/), expect.stringMatching(/^\/assets\/kit\/root-/)]);
  expect(asked.some((path) => /maplibre|mentions-/.test(path))).toBe(false);
  expect(await page.evaluate(() => 'React' in window || 'ReactDOM' in window)).toBe(false);

  const wrapper = page.locator('#board > .adm-kit');
  await expect(wrapper).toHaveAttribute('data-kit-part', 'board');
  await expect(page.getByRole('group', { name: 'Pipeline' })).toBeVisible();
  expect(await cardsIn(page, 'new')).toEqual(['Harbour Cafe', 'Second Wind', 'Third Coast']);
  expect(await cardsIn(page, 'talking')).toEqual(['Fourth Wall']);
  expect(await cardsIn(page, 'won')).toEqual(['Fifth Season']);
  // The app's own count and total head each column, and a card shows what the app wrote on it.
  await expect(column(page, 'new').locator('[data-part="column-count"]')).toHaveText('3');
  await expect(column(page, 'new').locator('[data-part="column-total"]')).toHaveText('€600');
  await expect(card(page, 'Harbour Cafe')).toContainText('Harbour Ltd');
  await expect(card(page, 'Harbour Cafe')).toContainText('€100');
  await expect(card(page, 'Harbour Cafe')).toContainText('Close');
  await expect(card(page, 'Harbour Cafe')).toContainText(`D-${ids['Harbour Cafe']!}`);

  // The look is the kit's own, with no Tailwind on the page: three columns side by side, a card with its border,
  // corners and surface, and no class left without a rule.
  expect(await unstyledClasses(page)).toEqual([]);
  const boxes = await Promise.all(['new', 'talking', 'won'].map((id) => column(page, id).boundingBox()));
  expect(boxes[0]!.width).toBe(288);
  expect(boxes[1]!.x).toBeGreaterThan(boxes[0]!.x + boxes[0]!.width);
  expect(Math.round(boxes[1]!.y)).toBe(Math.round(boxes[0]!.y));
  const face = card(page, 'Harbour Cafe').locator('> div');
  expect(await face.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 255, 255)');
  expect(await face.evaluate((el) => getComputedStyle(el).borderTopWidth + ' ' + getComputedStyle(el).borderTopStyle)).toBe('1px solid');
  expect(await face.evaluate((el) => getComputedStyle(el).borderRadius)).toBe('14px');
  expect(await face.evaluate((el) => getComputedStyle(el).fontFamily)).toContain('Georgia');
  // The live region is there for a screen reader and takes no room.
  expect(await spoken(page).evaluate((el) => getComputedStyle(el).position + ' ' + getComputedStyle(el).width)).toBe('absolute 1px');
  // Nothing of it reached the app's own page: its line wears `flex hidden truncate sr-only border` and is as the browser draws a paragraph.
  const own = page.locator('#own-classes');
  await expect(own).toBeVisible();
  expect(await own.evaluate((el) => [getComputedStyle(el).display, getComputedStyle(el).position, getComputedStyle(el).borderTopWidth, getComputedStyle(el).whiteSpace].join(' '))).toBe('block static 0px normal');
  expect(await own.evaluate((el) => getComputedStyle(el).marginTop)).not.toBe('0px');

  // Dragged with the mouse from New to Talking.
  const from = (await card(page, 'Second Wind').boundingBox())!;
  const to = (await column(page, 'talking').locator('[data-board-cell]').boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2 + 6, { steps: 3 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  // While it is held, the column under it shows where it will land.
  await expect(column(page, 'talking').locator('[data-board-cell]')).toHaveAttribute('data-drop-target', '');
  await page.mouse.up();

  await expect.poll(() => cardsIn(page, 'talking')).toEqual(['Second Wind', 'Fourth Wall']);
  await expect.poll(() => saves(page)).toEqual([{ cardId: ids['Second Wind'], to: 'talking', from: 'new', status: 200 }]);
  await expect(spoken(page)).toHaveText(/Moved Second Wind to Talking\./);
  // The app read its rows again and handed them over: the headings follow.
  await expect(column(page, 'new').locator('[data-part="column-count"]')).toHaveText('2');
  await expect(column(page, 'talking').locator('[data-part="column-total"]')).toHaveText('€600');
  await expect(page.locator('#board [data-part="board-move-refused"]')).toHaveCount(0);
  // A drag is not a click: the card was not opened. A click is.
  expect(await page.locator('body').getAttribute('data-opened')).toBeNull();
  await card(page, 'Third Coast').click();
  await expect(page.locator('body')).toHaveAttribute('data-opened', ids['Third Coast']!);

  // It is the server that holds it: after a reload the card is where it was dropped.
  await open(page, BOARD_PAGE);
  expect(await cardsIn(page, 'new')).toEqual(['Harbour Cafe', 'Third Coast']);
  expect(await cardsIn(page, 'talking')).toEqual(['Second Wind', 'Fourth Wall']);
  expect(problems).toEqual([]);
});

test('a card is moved with the keyboard, said aloud, saved, and the focus goes with it', async ({ page }) => {
  await signIn(page);
  const ids = await seedDeals(page);
  const problems = watch(page);
  await open(page, BOARD_PAGE);

  await card(page, 'Fourth Wall').focus();
  await page.keyboard.press('Space');
  await expect(card(page, 'Fourth Wall')).toHaveAttribute('aria-grabbed', 'true');
  await expect(spoken(page)).toHaveText(/Grabbed Fourth Wall\. Use the arrow keys to move, Enter to drop, Escape to cancel\./);
  await page.keyboard.press('ArrowRight');
  await expect(spoken(page)).toHaveText(/Fourth Wall is over Won\./);
  await expect(column(page, 'won').locator('[data-board-cell]')).toHaveAttribute('data-drop-target', '');
  // Escape puts it back, and nothing is saved.
  await page.keyboard.press('Escape');
  await expect(spoken(page)).toHaveText(/Fourth Wall returned to its original position\./);
  expect(await saves(page)).toEqual([]);
  await expect(card(page, 'Fourth Wall')).toBeFocused();

  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect.poll(() => cardsIn(page, 'won')).toEqual(['Fourth Wall', 'Fifth Season']);
  await expect(spoken(page)).toHaveText(/Moved Fourth Wall to Won\./);
  await expect.poll(() => saves(page)).toEqual([{ cardId: ids['Fourth Wall'], to: 'won', from: 'talking', status: 200 }]);
  await expect(card(page, 'Fourth Wall')).toBeFocused();

  await open(page, BOARD_PAGE);
  expect(await cardsIn(page, 'won')).toEqual(['Fourth Wall', 'Fifth Season']);
  expect(await cardsIn(page, 'talking')).toEqual([]);
  expect(problems).toEqual([]);
});

test('a move the server refuses puts the card back and says the server’s own reason', async ({ page }) => {
  await signIn(page);
  const ids = await seedDeals(page);
  const refusals: string[] = [];
  page.on('console', (message) => {
    // The browser itself logs a 409; anything else is a fault.
    if (message.type() === 'error' && !/409/.test(message.text())) refusals.push(message.text());
  });
  page.on('pageerror', (error) => refusals.push(String(error)));
  await open(page, BOARD_PAGE);

  // New straight to Won: the table's rule allows New to Talking only.
  await card(page, 'Harbour Cafe').focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(spoken(page)).toHaveText(/Harbour Cafe is over Won\./);
  const answered = page.waitForResponse((response) => response.request().method() === 'PATCH' && response.url().includes('/e2e_kit_deals/'));
  await page.keyboard.press('Enter');
  const reply = await answered;
  expect(reply.status()).toBe(409);
  const { error } = (await reply.json()) as { error: { code: string; message: string } };
  expect(error.code).toBe('STATE_MOVE_REFUSED');
  expect(error.message.length).toBeGreaterThan(10);

  const notice = page.locator('#board [data-part="board-move-refused"]');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('Harbour Cafe was not moved.');
  await expect(notice.locator('[data-part="board-move-refused-reason"]')).toHaveText(error.message);
  await expect(spoken(page)).toHaveText(new RegExp(`Could not move Harbour Cafe; it was returned to its original position\\. ${error.message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  expect(await cardsIn(page, 'new')).toEqual(['Harbour Cafe', 'Second Wind', 'Third Coast']);
  expect(await cardsIn(page, 'won')).toEqual(['Fifth Season']);
  await expect(card(page, 'Harbour Cafe')).toBeFocused();
  expect(await saves(page)).toEqual([{ cardId: ids['Harbour Cafe'], to: 'won', from: 'new', status: 409 }]);
  // The line is drawn as a refusal, and its button puts it away.
  expect(await notice.evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe('1px');
  expect(await unstyledClasses(page)).toEqual([]);
  await notice.getByRole('button', { name: 'Dismiss' }).click();
  await expect(notice).toHaveCount(0);

  // The server never took it.
  await open(page, BOARD_PAGE);
  expect(await cardsIn(page, 'new')).toEqual(['Harbour Cafe', 'Second Wind', 'Third Coast']);
  expect(refusals).toEqual([]);
});

test('a card typed at a column’s foot is added through the app', async ({ page }) => {
  await signIn(page);
  await seedDeals(page);
  const problems = watch(page);
  await open(page, BOARD_PAGE);
  await column(page, 'new').getByRole('button', { name: 'Add card' }).click();
  const box = column(page, 'new').getByRole('textbox', { name: 'Card title…' });
  await expect(box).toBeFocused();
  expect(await unstyledClasses(page)).toEqual([]);
  await page.keyboard.type('Sixth Sense');
  await page.keyboard.press('Enter');
  await expect.poll(() => cardsIn(page, 'new')).toEqual(['Harbour Cafe', 'Second Wind', 'Third Coast', 'Sixth Sense']);
  await expect(box).toHaveValue('');
  expect(await saves(page)).toEqual([{ added: 'Sixth Sense', columnId: 'new', status: 201 }]);
  expect(problems).toEqual([]);
});

test('in Arabic the board runs right to left, the left arrow goes on, and it speaks Arabic', async ({ page }) => {
  await signIn(page);
  const ids = await seedDeals(page);
  const problems = watch(page);
  await open(page, `${BOARD_PAGE}&locale=ar-EG&dir=rtl`);

  const wrapper = page.locator('#board > .adm-kit');
  await expect(wrapper).toHaveAttribute('dir', 'rtl');
  await expect(wrapper).toHaveAttribute('lang', 'ar-EG');
  // The first column is the rightmost, and the page around the board is as the app wrote it.
  const [first, second] = await Promise.all([column(page, 'new').boundingBox(), column(page, 'talking').boundingBox()]);
  expect(first!.x).toBeGreaterThan(second!.x + second!.width - 1);
  expect(await page.locator('#own-classes').evaluate((el) => getComputedStyle(el).direction)).toBe('ltr');
  // The total sits at the heading's far end: its left, here.
  const [heading, total] = await Promise.all([column(page, 'new').locator('header').boundingBox(), column(page, 'new').locator('[data-part="column-total"]').boundingBox()]);
  expect(total!.x - heading!.x).toBeLessThan(heading!.width / 2);

  await card(page, 'Harbour Cafe').focus();
  await page.keyboard.press('Space');
  await expect(spoken(page)).not.toHaveText(/Grabbed/);
  await expect(spoken(page)).toHaveText(/Harbour Cafe/);
  // The right arrow goes back, and there is nowhere before the first column.
  await page.keyboard.press('ArrowRight');
  await expect(column(page, 'new').locator('[data-board-cell]')).toHaveAttribute('data-drop-target', '');
  await page.keyboard.press('ArrowLeft');
  await expect(column(page, 'talking').locator('[data-board-cell]')).toHaveAttribute('data-drop-target', '');
  await page.keyboard.press('Enter');
  await expect.poll(() => cardsIn(page, 'talking')).toEqual(['Harbour Cafe', 'Fourth Wall']);
  await expect.poll(() => saves(page)).toEqual([{ cardId: ids['Harbour Cafe'], to: 'talking', from: 'new', status: 200 }]);
  await expect(column(page, 'new').getByRole('button', { name: 'إضافة بطاقة' })).toBeVisible();
  expect(problems).toEqual([]);
});

test('at 390 wide the columns scroll inside the board, a keyboard move is followed, and the page never scrolls sideways', async ({ page }) => {
  // Signed in at a desktop's width (the dashboard's own menu is what the sign-in looks for), then narrowed.
  await signIn(page);
  await seedDeals(page);
  await page.setViewportSize({ width: 390, height: 800 });
  const problems = watch(page);
  await open(page, BOARD_PAGE);

  const scroller = page.locator('#board [data-board-scroller]');
  const widths = async (): Promise<{ page: number; view: number; inner: number; box: number; left: number; pageLeft: number }> =>
    scroller.evaluate((el) => ({ page: document.documentElement.scrollWidth, view: document.documentElement.clientWidth, inner: el.scrollWidth, box: el.clientWidth, left: Math.abs(el.scrollLeft), pageLeft: window.scrollX }));
  const before = await widths();
  expect(before.page).toBeLessThanOrEqual(before.view);
  expect(before.inner).toBeGreaterThan(before.box + 300);
  expect(before.left).toBe(0);
  // The third column is out of sight to begin with.
  expect((await column(page, 'won').boundingBox())!.x).toBeGreaterThan(390);

  await card(page, 'Fourth Wall').focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowRight');
  // The column the card is held over has come into view, inside the board.
  await expect.poll(async () => (await widths()).left).toBeGreaterThan(100);
  const won = (await column(page, 'won').boundingBox())!;
  expect(won.x).toBeGreaterThanOrEqual(0);
  expect(won.x + won.width).toBeLessThanOrEqual(390);
  await page.keyboard.press('Enter');
  await expect.poll(() => cardsIn(page, 'won')).toEqual(['Fourth Wall', 'Fifth Season']);
  await expect(card(page, 'Fourth Wall')).toBeFocused();
  const after = await widths();
  expect(after.pageLeft).toBe(0);
  expect(after.page).toBeLessThanOrEqual(after.view);

  // New cards from the app (its read after the save) left the board scrolled where the person was.
  expect(after.left).toBeGreaterThan(100);
  expect(problems).toEqual([]);
});

test('the board is dark where the app says dark, and takes the app’s own colour', async ({ page }) => {
  await signIn(page);
  await seedDeals(page);
  const problems = watch(page);
  await open(page, `${BOARD_PAGE}&theme=dark`);
  await expect(page.locator('#board > .adm-kit')).toHaveAttribute('data-kit-theme', 'dark');
  const face = card(page, 'Harbour Cafe').locator('> div');
  expect(await face.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(20, 20, 25)');
  expect(await face.locator('p').evaluate((el) => getComputedStyle(el).color)).toBe('rgb(244, 244, 246)');
  // The app's own accent: the ring round a card that has the focus.
  await page.evaluate(() => document.body.setAttribute('data-tokens', ''));
  await card(page, 'Harbour Cafe').focus();
  await page.keyboard.press('Space');
  await expect.poll(() => card(page, 'Harbour Cafe').evaluate((el) => getComputedStyle(el).boxShadow)).toContain('rgb(200, 30, 90)');
  await page.keyboard.press('Escape');
  expect(problems).toEqual([]);
});

/* ------------------------------------------------------------------ the map */

const MAP_PAGE = '?part=map';
const PLACES: [name: string, lat: number, lng: number][] = [
  ['Harbour Cafe', 52.52, 13.405],
  ['Second Wind', 48.8566, 2.3522],
  ['Depot', 41.9028, 12.4964],
];

interface PinSave {
  pinId: string;
  lat: number;
  lng: number;
  status: number;
}

/** Three places, afresh for each test, made through the data API as the signed-in person. */
async function seedPlaces(page: Page): Promise<Record<string, string>> {
  const connectionId = await seededConnectionId(page);
  const table = `/api/v1/data/${connectionId}/e2e_kit_places`;
  const listed = (await (await page.request.get(`${table}?limit=200`)).json()) as { data: { id: number }[] };
  for (const row of listed.data) expect((await page.request.delete(`${table}/${String(row.id)}`)).ok()).toBe(true);
  const ids: Record<string, string> = {};
  for (const [name, lat, lng] of PLACES) {
    const made = await page.request.post(table, { data: { values: { name, lat, lng } } });
    expect(made.ok(), await made.text()).toBe(true);
    ids[name] = String(((await made.json()) as { data: { id: number } }).data.id);
  }
  return ids;
}

async function placeRow(page: Page, id: string): Promise<{ status: number; lat?: number; lng?: number }> {
  const reply = await page.request.get(`/api/v1/data/${await seededConnectionId(page)}/e2e_kit_places/${id}`);
  if (!reply.ok()) return { status: reply.status() };
  const { data } = (await reply.json()) as { data: { lat: number | string; lng: number | string } };
  return { status: reply.status(), lat: Number(data.lat), lng: Number(data.lng) };
}

/** A picture of one pixel: all the stand-in's sprite holds. */
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

/**
 * A style as a map server writes one, every address in it on that server: a
 * sprite, letters, and map pictures. So the page asks for each kind under the
 * server's content policy, and a kind the policy forgot would be a refusal in
 * the console, which every test here fails on.
 */
function styleOf(origin: string, dark: boolean): Record<string, unknown> {
  return {
    version: 8,
    name: dark ? 'stand-in dark' : 'stand-in light',
    sprite: `${origin}/sprites/stand-in`,
    glyphs: `${origin}/fonts/{fontstack}/{range}.pbf`,
    sources: {
      land: { type: 'vector', tiles: [`${origin}/tiles/{z}/{x}/{y}.pbf`], maxzoom: 6 },
      mark: { type: 'geojson', data: { type: 'Feature', geometry: { type: 'Point', coordinates: [9, 48] }, properties: {} } },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': dark ? '#101418' : '#e6edf2' } },
      { id: 'land', type: 'fill', source: 'land', 'source-layer': 'land', paint: { 'fill-color': dark ? '#1c242c' : '#d3dde4' } },
      { id: 'mark', type: 'symbol', source: 'mark', layout: { 'text-field': 'Stand-in', 'text-font': ['Noto Sans Regular'] } },
    ],
  };
}

/**
 * The map server, stood in for: whatever address this Adminium's config names
 * is answered here, so no test reaches the network. `asked` is every path the
 * page asked that server for; `down` refuses them all.
 */
async function mapServer(page: Page, how: 'up' | 'down' = 'up'): Promise<{ origin: string; asked: string[] }> {
  const config = (await (await page.request.get(`${STAFF}surface-config.json`)).json()) as { maps: { enabled: boolean; server: string | null } };
  expect(config.maps.enabled).toBe(true);
  const origin = new URL(config.maps.server!).origin;
  const asked: string[] = [];
  const cors = { 'access-control-allow-origin': '*' };
  await page.route(`${origin}/**`, async (route) => {
    const { pathname } = new URL(route.request().url());
    asked.push(pathname);
    if (how === 'down') return route.abort('connectionrefused');
    if (pathname.startsWith('/styles/')) return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(styleOf(origin, pathname.endsWith('/dark'))) });
    if (pathname.endsWith('.json')) return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '{}' });
    if (pathname.endsWith('.png')) return route.fulfill({ status: 200, headers: cors, contentType: 'image/png', body: PIXEL });
    // Letters and map pictures: an empty answer is a tile with nothing on it.
    return route.fulfill({ status: 200, headers: cors, contentType: 'application/x-protobuf', body: Buffer.alloc(0) });
  });
  return { origin, asked };
}

const bubble = (page: Page) => page.locator('#map [data-widget="map-bubble"]');
const pins = (page: Page) => page.locator('#map [data-part="map-pin"]');
const pinOf = (page: Page, label: string) => page.locator(`#map [data-part="map-pin"][aria-label^="${label}"]`);
const rowOf = (page: Page, label: string) => page.locator('#map [data-part="geo-ranking-row"]', { hasText: label });
const mapSaid = (page: Page) => page.locator('#map [data-part="map-said"]');
const pinSaves = (page: Page): Promise<PinSave[]> => page.evaluate(() => (window as unknown as { kitScreen: { saves: PinSave[] } }).kitScreen.saves);

async function openMap(page: Page, query = ''): Promise<void> {
  await open(page, MAP_PAGE + query);
  await expect(bubble(page)).toHaveAttribute('data-map-status', 'ready', { timeout: 30_000 });
}

/** Where each pin is drawn, by the name before any hint, once the map has stopped moving. */
async function spots(page: Page): Promise<Record<string, { x: number; y: number }>> {
  const read = (): Promise<Record<string, { x: number; y: number }>> =>
    pins(page).evaluateAll((all) =>
      Object.fromEntries(
        all.map((pin) => {
          const box = pin.getBoundingClientRect();
          return [(pin.getAttribute('aria-label') ?? '').split(' · ')[0], { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) }];
        }),
      ),
    );
  let last = '';
  for (let tries = 0; tries < 60; tries += 1) {
    const now = JSON.stringify(await read());
    if (now === last) return JSON.parse(now) as Record<string, { x: number; y: number }>;
    last = now;
    await page.waitForTimeout(200);
  }
  throw new Error('the map never stopped moving');
}

test('a plain page mounts the map from real rows under the server’s policy; a pin is picked and update leaves the view alone', async ({ page }) => {
  await signIn(page);
  const ids = await seedPlaces(page);
  const problems = watch(page);
  const server = await mapServer(page);
  const asked: string[] = [];
  const origins = new Set<string>();
  page.on('request', (request) => {
    const url = new URL(request.url());
    origins.add(url.origin);
    if (url.pathname.startsWith('/assets/')) asked.push(url.pathname);
  });
  await openMap(page);

  // The map's own files came, each once, all from /assets: its part, the map, the engine, the library and its worker.
  expect(asked.filter((path) => /^\/assets\/kit\/map-[\w-]+\.js$/.test(path))).toHaveLength(1);
  expect(asked.filter((path) => /^\/assets\/MapBubble-[\w-]+\.js$/.test(path))).toHaveLength(1);
  expect(asked.filter((path) => /^\/assets\/map-engine-[\w-]+\.js$/.test(path))).toHaveLength(1);
  expect(asked.filter((path) => /^\/assets\/maplibre-gl-[\w-]+\.js$/.test(path) && !path.includes('worker'))).toHaveLength(1);
  expect(asked.some((path) => /^\/assets\/maplibre-gl-worker-[\w-]+\.js$/.test(path))).toBe(true);
  // Two sheets, both the kit's: the map library's own is inside the map's, under the wrapper, and is not fetched apart.
  expect(asked.filter((path) => path.endsWith('.css')).sort()).toEqual([expect.stringMatching(/^\/assets\/kit\/map-/), expect.stringMatching(/^\/assets\/kit\/root-/)]);
  // Not the board, not the mention box, and not the dashboard: neither its entry nor its translator's home.
  expect(asked.some((path) => /board-|KanbanBoard-|mentions-/.test(path))).toBe(false);
  const dashboard = await (await page.request.get('/')).text();
  const entry = /<script[^>]+src="(\/assets\/index-[\w-]+\.js)"/.exec(dashboard)?.[1];
  expect(entry).toBeTruthy();
  expect(asked).not.toContain(entry);
  expect(await page.evaluate(() => 'React' in window || 'ReactDOM' in window)).toBe(false);
  // Nothing went anywhere but this Adminium and the map server its config names.
  expect([...origins].sort()).toEqual([new URL(page.url()).origin, server.origin].sort());
  // Of the map server: the light style, then what the style itself names there: the sprite, letters, map pictures.
  expect(server.asked).toContain('/styles/positron');
  expect(server.asked).not.toContain('/styles/dark');
  await expect.poll(() => server.asked.some((path) => path.startsWith('/tiles/'))).toBe(true);
  await expect.poll(() => server.asked.filter((path) => path.startsWith('/sprites/')).length).toBeGreaterThanOrEqual(2);
  await expect.poll(() => server.asked.some((path) => path.startsWith('/fonts/'))).toBe(true);

  const part = page.locator('#map > .adm-kit');
  await expect(part).toHaveAttribute('data-kit-part', 'map');
  await expect(page.getByRole('group', { name: 'Customers' })).toBeVisible();
  // A real map: a canvas the library drew, as wide as its frame and 20rem tall less the frame's own border, with the library's own buttons.
  const canvas = page.locator('#map canvas.maplibregl-canvas');
  await expect(canvas).toBeVisible();
  const frame = (await page.locator('#map [data-part="map-canvas"]').boundingBox())!;
  expect(frame.width).toBeGreaterThan(400);
  expect(frame.height).toBeGreaterThanOrEqual(318);
  expect(await page.locator('#map .maplibregl-map').evaluate((el) => getComputedStyle(el).position + ' ' + getComputedStyle(el).overflow)).toBe('relative hidden');
  await expect(page.locator('#map').getByRole('button', { name: 'Zoom in' })).toBeVisible();
  await expect(pins(page)).toHaveCount(3);
  await expect(page.locator('#map').getByRole('list', { name: 'Places' }).locator('[data-part="geo-ranking-row"]')).toHaveText(['1.Harbour Cafe', '2.Second Wind', '3.Depot']);
  // Each pin inside the frame, in the kit's accent, and the one the app toned in its tone.
  for (const [name] of PLACES) {
    const box = (await pinOf(page, name).boundingBox())!;
    expect(box.x).toBeGreaterThan(frame.x);
    expect(box.x + box.width).toBeLessThan(frame.x + frame.width);
    expect(box.y).toBeGreaterThan(frame.y);
    expect(box.y + box.height).toBeLessThan(frame.y + frame.height);
  }
  expect(await pinOf(page, 'Harbour Cafe').evaluate((el) => getComputedStyle(el).borderTopColor)).toBe('rgb(79, 70, 229)');
  expect(await pinOf(page, 'Depot').evaluate((el) => getComputedStyle(el).borderTopColor)).toBe('rgb(169, 88, 0)');
  // No class without a rule, and nothing of it reached the app's own page.
  expect(await unstyledClasses(page)).toEqual([]);
  const own = page.locator('#own-classes');
  expect(await own.evaluate((el) => [getComputedStyle(el).display, getComputedStyle(el).position, getComputedStyle(el).borderTopWidth, getComputedStyle(el).whiteSpace].join(' '))).toBe('block static 0px normal');
  expect(await own.evaluate((el) => getComputedStyle(el).fontFamily)).toContain('Georgia');

  // A pin picked: the app hears its row's id, and the pin and its row say so.
  await pinOf(page, 'Second Wind').click();
  await expect(page.locator('body')).toHaveAttribute('data-picked', ids['Second Wind']!);
  await expect(pinOf(page, 'Second Wind')).toHaveAttribute('aria-current', 'true');
  await expect(rowOf(page, 'Second Wind')).toHaveAttribute('aria-current', 'true');
  expect(await rowOf(page, 'Second Wind').evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
  // And from the list, with the keyboard's twin of a pin.
  await rowOf(page, 'Depot').click();
  await expect(page.locator('body')).toHaveAttribute('data-picked', ids['Depot']!);
  await expect(pinOf(page, 'Depot')).toHaveAttribute('aria-current', 'true');
  await expect(pinOf(page, 'Second Wind')).not.toHaveAttribute('aria-current', 'true');

  // The app reads its rows again and hands them over: the view, the pick and each pin's own button stay.
  const before = await spots(page);
  await pinOf(page, 'Harbour Cafe').evaluate((el) => el.setAttribute('data-mine', 'kept'));
  await page.evaluate(async () => {
    const { map, read } = (window as unknown as { kitScreen: { map: { update(props: Record<string, unknown>): void }; read(): Promise<unknown> } }).kitScreen;
    map.update({ pins: await read(), ariaLabel: 'Customers again' });
  });
  await expect(page.getByRole('group', { name: 'Customers again' })).toBeVisible();
  expect(await spots(page)).toEqual(before);
  await expect(pinOf(page, 'Harbour Cafe')).toHaveAttribute('data-mine', 'kept');
  await expect(pinOf(page, 'Depot')).toHaveAttribute('aria-current', 'true');

  // The person zooms. A new row then arrives from the app: its pin is drawn, and the view is still theirs.
  await page.locator('#map').getByRole('button', { name: 'Zoom in' }).click();
  await expect.poll(async () => JSON.stringify(await spots(page))).not.toBe(JSON.stringify(before));
  const zoomed = await spots(page);
  const made = await page.request.post(`/api/v1/data/${await seededConnectionId(page)}/e2e_kit_places`, { data: { values: { name: 'Fourth Wall', lat: 40.4168, lng: -3.7038 } } });
  expect(made.ok(), await made.text()).toBe(true);
  await page.evaluate(async () => {
    const { map, read } = (window as unknown as { kitScreen: { map: { update(props: Record<string, unknown>): void }; read(): Promise<unknown> } }).kitScreen;
    map.update({ pins: await read() });
  });
  await expect(pins(page)).toHaveCount(4);
  const after = await spots(page);
  for (const [name] of PLACES) expect(after[name], name).toEqual(zoomed[name]);
  await expect(pinOf(page, 'Depot')).toHaveAttribute('aria-current', 'true');

  // Taken away again, the element is the app's as it was.
  await page.evaluate(() => (window as unknown as { kitScreen: { map: { unmount(): void } } }).kitScreen.map.unmount());
  await expect(page.locator('#map')).toBeEmpty();
  expect(problems).toEqual([]);
});

test('a pin dragged with the mouse is saved through the data API and stays where it was dropped', async ({ page }) => {
  await signIn(page);
  const ids = await seedPlaces(page);
  const problems = watch(page);
  await mapServer(page);
  await openMap(page);

  const start = (await spots(page))['Harbour Cafe']!;
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 10, start.y + 6, { steps: 3 });
  await page.mouse.move(start.x + 70, start.y + 40, { steps: 10 });
  await page.mouse.up();

  await expect.poll(() => pinSaves(page)).toHaveLength(1);
  const [save] = await pinSaves(page);
  expect(save!.pinId).toBe(ids['Harbour Cafe']);
  expect(save!.status).toBe(200);
  // East and south of where it stood.
  expect(save!.lng).toBeGreaterThan(13.405);
  expect(save!.lat).toBeLessThan(52.52);
  await expect(mapSaid(page)).toHaveText(/^Pin kept at /);
  // The app handed no pins back; the pin is where it was dropped all the same, after the save has settled.
  await page.waitForTimeout(600);
  const dropped = (await spots(page))['Harbour Cafe']!;
  expect(Math.abs(dropped.x - (start.x + 70))).toBeLessThanOrEqual(2);
  expect(Math.abs(dropped.y - (start.y + 40))).toBeLessThanOrEqual(2);
  await expect(page.locator('#map [data-part="map-refused"]')).toHaveCount(0);
  await expect(mapSaid(page)).not.toHaveText(/not kept/);
  // A drag is not a pick.
  expect(await page.locator('body').getAttribute('data-picked')).toBeNull();

  // It is the server that holds it.
  const row = await placeRow(page, ids['Harbour Cafe']!);
  expect(row.lat).toBeCloseTo(save!.lat, 5);
  expect(row.lng).toBeCloseTo(save!.lng, 5);
  expect(problems).toEqual([]);
});

test('a pin is moved with the keyboard, said aloud and saved; Escape puts it back and saves nothing', async ({ page }) => {
  await signIn(page);
  const ids = await seedPlaces(page);
  const problems = watch(page);
  await mapServer(page);
  await openMap(page);

  const start = (await spots(page))['Second Wind']!;
  await pinOf(page, 'Second Wind').focus();
  await page.keyboard.press('Enter');
  await expect(mapSaid(page)).toHaveText(/^Pin picked up\. Move it with the arrow keys/);
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Escape');
  await expect(mapSaid(page)).toHaveText('The pin is back where it was.');
  expect(await pinSaves(page)).toEqual([]);
  expect((await spots(page))['Second Wind']).toEqual(start);

  await page.keyboard.press('Enter');
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Enter');
  await expect.poll(() => pinSaves(page)).toHaveLength(1);
  const [save] = await pinSaves(page);
  expect(save).toMatchObject({ pinId: ids['Second Wind'], status: 200 });
  expect(save!.lng).toBeGreaterThan(2.3522);
  expect(save!.lat).toBeLessThan(48.8566);
  await page.waitForTimeout(600);
  // Forty pixels each way, and the focus is still on the pin.
  const kept = (await spots(page))['Second Wind']!;
  expect(Math.abs(kept.x - (start.x + 40))).toBeLessThanOrEqual(2);
  expect(Math.abs(kept.y - (start.y + 40))).toBeLessThanOrEqual(2);
  await expect(pinOf(page, 'Second Wind')).toBeFocused();
  const row = await placeRow(page, ids['Second Wind']!);
  expect(row.lng).toBeCloseTo(save!.lng, 5);
  expect(problems).toEqual([]);
});

test('a move the server refuses puts the pin back and says the server’s own reason above the map', async ({ page }) => {
  await signIn(page);
  const ids = await seedPlaces(page);
  const refusals: string[] = [];
  page.on('console', (message) => {
    // The browser itself logs a 404; anything else is a fault.
    if (message.type() === 'error' && !/404/.test(message.text())) refusals.push(message.text());
  });
  page.on('pageerror', (error) => refusals.push(String(error)));
  await mapServer(page);
  await openMap(page);

  // Somebody else deleted the row while this screen was open: the save is a real 404.
  expect((await page.request.delete(`/api/v1/data/${await seededConnectionId(page)}/e2e_kit_places/${ids['Depot']!}`)).ok()).toBe(true);
  // Where the pin stands on the map itself: the notice, when it comes, moves the whole map down the page.
  const onMap = async (): Promise<{ x: number; y: number }> => {
    const [spot, frame] = await Promise.all([spots(page), page.locator('#map [data-part="map-canvas"]').boundingBox()]);
    return { x: Math.round(spot['Depot']!.x - frame!.x), y: Math.round(spot['Depot']!.y - frame!.y) };
  };
  const start = await onMap();
  await pinOf(page, 'Depot').focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Shift+ArrowLeft');
  const answered = page.waitForResponse((response) => response.request().method() === 'PATCH' && response.url().includes('/e2e_kit_places/'));
  await page.keyboard.press('Enter');
  const reply = await answered;
  expect(reply.status()).toBe(404);
  const { error } = (await reply.json()) as { error: { message: string } };
  expect(error.message.length).toBeGreaterThan(5);

  const notice = page.locator('#map [data-part="map-refused"]');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('The new spot was not kept. The pin is back where it was.');
  await expect(notice.locator('[data-part="map-refused-reason"]')).toHaveText(error.message);
  await expect(notice.locator('[data-part="map-refused-reason"]')).toHaveAttribute('role', 'alert');
  await expect(mapSaid(page)).toHaveText('The new spot was not kept. The pin is back where it was.');
  expect(await onMap()).toEqual(start);
  expect(await pinSaves(page)).toMatchObject([{ pinId: ids['Depot'], status: 404 }]);
  // The line is drawn as a refusal, above the map, and its button puts it away.
  expect(await notice.evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe('1px');
  expect((await notice.boundingBox())!.y).toBeLessThan((await page.locator('#map [data-part="map-canvas"]').boundingBox())!.y);
  expect(await unstyledClasses(page)).toEqual([]);
  await notice.getByRole('button', { name: 'Dismiss' }).click();
  await expect(notice).toHaveCount(0);
  expect(refusals).toEqual([]);
});

test('switched off: the list and the way to switch maps on, and nothing at all is asked of the map server', async ({ page }) => {
  await signIn(page);
  const ids = await seedPlaces(page);
  const problems = watch(page);
  const server = await mapServer(page);
  const asked: string[] = [];
  const origins = new Set<string>();
  page.on('request', (request) => {
    const url = new URL(request.url());
    origins.add(url.origin);
    if (url.pathname.startsWith('/assets/')) asked.push(url.pathname);
  });
  await open(page, `${MAP_PAGE}&maps=off&settings=${encodeURIComponent('/settings/maps')}`);

  await expect(bubble(page)).toHaveAttribute('data-map-status', 'off');
  const notice = page.locator('#map [data-part="map-off"]');
  await expect(notice).toContainText('Maps are switched off. Here is the list.');
  await expect(notice.getByRole('link', { name: 'Open Settings → Maps' })).toHaveAttribute('href', '/settings/maps');
  await expect(page.locator('#map [data-part="geo-ranking-row"]')).toHaveCount(3);
  await expect(page.locator('#map [data-part="map-canvas"]')).toHaveCount(0);
  // The list is still the map's twin: a row is a pick.
  await rowOf(page, 'Second Wind').click();
  await expect(page.locator('body')).toHaveAttribute('data-picked', ids['Second Wind']!);
  expect(await unstyledClasses(page)).toEqual([]);

  // Given every chance to: no request to the map server, none anywhere but this Adminium, and no map code fetched.
  await page.waitForTimeout(1_000);
  expect(server.asked).toEqual([]);
  expect([...origins]).toEqual([new URL(page.url()).origin]);
  expect(asked.some((path) => /maplibre|map-engine/.test(path))).toBe(false);
  expect(problems).toEqual([]);
});

test('a map server that cannot be reached leaves the list under its notice', async ({ page }) => {
  await signIn(page);
  await seedPlaces(page);
  const faults: string[] = [];
  page.on('console', (message) => {
    // The browser logs the refused connection itself; anything else is a fault.
    if (message.type() === 'error' && !/ERR_CONNECTION_REFUSED|Failed to load resource/.test(message.text())) faults.push(message.text());
  });
  page.on('pageerror', (error) => faults.push(String(error)));
  const server = await mapServer(page, 'down');
  await open(page, MAP_PAGE);

  await expect(bubble(page)).toHaveAttribute('data-map-status', 'unavailable', { timeout: 30_000 });
  await expect(page.locator('#map [data-part="map-unavailable"]')).toHaveText('The map could not be reached. Here is the list.');
  expect(server.asked).toContain('/styles/positron');
  await expect(page.locator('#map [data-part="geo-ranking-row"]')).toHaveCount(3);
  // No empty frame is left standing where the map would be.
  await expect(page.locator('#map [data-part="map-canvas"]')).toHaveCount(0);
  await expect(page.locator('#map canvas')).toHaveCount(0);
  expect(await unstyledClasses(page)).toEqual([]);
  expect(faults).toEqual([]);
});

test('in Arabic the map’s list and words run right to left round a map that does not mirror', async ({ page }) => {
  await signIn(page);
  await seedPlaces(page);
  const problems = watch(page);
  const asked: string[] = [];
  page.on('request', (request) => asked.push(new URL(request.url()).pathname));
  await mapServer(page);
  await openMap(page, '&locale=ar-EG&dir=rtl');
  const words = (JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', '..', 'packages', 'i18n', 'locales', 'ar-EG', 'ui.json'), 'utf8')) as { widgets: { geo: { mapBubble: Record<string, string> } } }).widgets.geo.mapBubble;

  const wrapper = page.locator('#map > .adm-kit');
  await expect(wrapper).toHaveAttribute('dir', 'rtl');
  await expect(wrapper).toHaveAttribute('lang', 'ar-EG');
  expect(asked.some((path) => /^\/assets\/kit\/ar-EG-[\w-]+\.js$/.test(path))).toBe(true);
  expect(asked.some((path) => /^\/assets\/kit\/en-US-/.test(path))).toBe(false);
  // Geography is an island: the canvas is left to right, the list beside it is not, and the page is as the app wrote it.
  expect(await page.locator('#map [data-part="map-canvas"]').evaluate((el) => getComputedStyle(el).direction)).toBe('ltr');
  const list = page.locator('#map').getByRole('list', { name: words['placesLabel']! });
  await expect(list).toBeVisible();
  expect(await list.evaluate((el) => getComputedStyle(el).direction)).toBe('rtl');
  expect(await page.locator('#own-classes').evaluate((el) => getComputedStyle(el).direction)).toBe('ltr');
  // The map comes first, so it is on the right; the list is to its left.
  const [frame, rows] = await Promise.all([page.locator('#map [data-part="map-canvas"]').boundingBox(), list.boundingBox()]);
  expect(rows!.x + rows!.width).toBeLessThanOrEqual(frame!.x + 1);
  // The library's own buttons and the pins' hint speak Arabic too.
  await expect(page.locator('#map').getByRole('button', { name: words['zoomIn']! })).toBeVisible();
  await pinOf(page, 'Harbour Cafe').focus();
  await page.keyboard.press('Enter');
  await expect(mapSaid(page)).toHaveText(words['saidPinPicked']!);
  await page.keyboard.press('Escape');
  await expect(mapSaid(page)).toHaveText(words['saidPinBack']!);
  expect(await unstyledClasses(page)).toEqual([]);
  expect(problems).toEqual([]);
});

test('at 390 wide the list goes under the map and the page never scrolls sideways', async ({ page }) => {
  // Signed in at a desktop's width (the dashboard's own menu is what the sign-in looks for), then narrowed.
  await signIn(page);
  await seedPlaces(page);
  await page.setViewportSize({ width: 390, height: 800 });
  const problems = watch(page);
  await mapServer(page);
  await openMap(page);

  const widths = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, view: document.documentElement.clientWidth }));
  expect(widths.page).toBeLessThanOrEqual(widths.view);
  const frame = (await page.locator('#map [data-part="map-canvas"]').boundingBox())!;
  const list = (await page.locator('#map [data-part="geo-ranking"]').boundingBox())!;
  expect(frame.x).toBeGreaterThanOrEqual(0);
  expect(frame.x + frame.width).toBeLessThanOrEqual(390);
  expect(frame.width).toBeGreaterThan(300);
  expect(frame.height).toBeGreaterThanOrEqual(318);
  expect(list.y).toBeGreaterThanOrEqual(frame.y + frame.height - 1);
  expect(list.x + list.width).toBeLessThanOrEqual(390);
  await expect(pins(page)).toHaveCount(3);
  // A pin is still moved here, by the keyboard, and the page stays put.
  await pinOf(page, 'Depot').focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect.poll(() => pinSaves(page)).toHaveLength(1);
  expect(await page.evaluate(() => window.scrollX)).toBe(0);
  expect(problems).toEqual([]);
});

test('dark where the app says dark, with the map server’s dark style; and a route’s legs come from this Adminium', async ({ page }) => {
  await signIn(page);
  await seedPlaces(page);
  const problems = watch(page);
  const server = await mapServer(page);
  await openMap(page, '&theme=dark&route=1');

  await expect(page.locator('#map > .adm-kit')).toHaveAttribute('data-kit-theme', 'dark');
  expect(server.asked).toContain('/styles/dark');
  expect(server.asked).not.toContain('/styles/positron');
  // The stops are numbered, in the dark accent, and the list says each leg as the server measured it.
  const first = pinOf(page, '1. Harbour Cafe');
  await expect(first).toHaveText('1');
  expect(await first.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(153, 165, 255)');
  expect(await first.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(15, 15, 20)');
  await expect(page.locator('#map').getByRole('list', { name: 'Stops' })).toBeVisible();
  await expect(page.locator('#map [data-part="geo-row-note"]').first()).toHaveText(/^(about )?[\d.,]+ km from the stop before$/);
  await expect(page.locator('#map [data-part="geo-row-note"]')).toHaveCount(2);
  expect(await page.evaluate(() => (window as unknown as { kitScreen: { routes: number[] } }).kitScreen.routes)).toEqual([200]);
  expect(await rowOf(page, 'Depot').locator('span').last().evaluate((el) => getComputedStyle(el).color)).toBe('rgb(183, 183, 195)');
  expect(await unstyledClasses(page)).toEqual([]);

  // The app turns light: the same map takes the light style, and nothing is built again.
  await pinOf(page, '1. Harbour Cafe').evaluate((el) => el.setAttribute('data-mine', 'kept'));
  await page.evaluate(() => (window as unknown as { kitScreen: { map: { update(props: Record<string, unknown>): void } } }).kitScreen.map.update({ theme: 'light' }));
  await expect.poll(() => server.asked).toContain('/styles/positron');
  await expect(pinOf(page, '1. Harbour Cafe')).toHaveAttribute('data-mine', 'kept');
  await expect.poll(() => first.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(79, 70, 229)');
  expect(problems).toEqual([]);
});
