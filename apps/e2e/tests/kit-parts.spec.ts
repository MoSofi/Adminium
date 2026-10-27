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
 *
 * And the import wizard, as somebody whose role opens ONLY this app's
 * screens: they have no dashboard, and the part asks for none of it. Three
 * rows are pasted, looked at (which are new, which are here already), run,
 * and are in the table; pasted again, every one is already here and nothing
 * is brought in; the whole walk is made with the keyboard alone; what the
 * person's role does not let them do (import at all, or update the rows a
 * file matches) is said in the part in words, and the server refuses the
 * same call made directly; Arabic runs right to left; and at 390 wide no
 * step makes the page scroll sideways.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { bundleOf } from './appBundle.js';
import { ADMIN_NAME, BASE_URL, ownStorageStatePath } from './constants.js';
import { seededConnectionId, signIn, useOwnPrincipal } from './helpers.js';

/*
 * Its own `api` budget (constants.ts OWN_PRINCIPALS): this file alone makes
 * about 260 calls in its minute, and on the shared admin the board's first
 * read met a 429 wherever the specs before it had spent that minute.
 */
const PRINCIPAL = 'kit';
useOwnPrincipal(PRINCIPAL);

/**
 * The seeded connection's id, asked for once: this file reads it before almost
 * every call it makes, and a request for each would spend the server's
 * per-minute budget on the same answer.
 */
let connection: Promise<string> | undefined;
const connectionOf = (page: Page): Promise<string> => (connection ??= seededConnectionId(page));

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
  // Two roles that open this app's screens and nothing of the dashboard: one may read and bring in companies
  // (and not change one that is there), the other may only read them.
  roles: [
    { key: 'rep', name: 'Rep', screensOnly: true, permissions: ['table:@companies:read', 'table:@companies:create', 'table:@companies:import', 'app:@:staff'] },
    { key: 'looker', name: 'Looker', screensOnly: true, permissions: ['table:@companies:read', 'app:@:staff'] },
  ],
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
        ref: 'companies',
        columns: [
          { ref: 'id', type: 'int', role: 'pk' },
          { ref: 'name', type: 'text', maxLength: 80 },
          // The company's own number: what no two rows share, and what a pasted line is matched on.
          { ref: 'code', type: 'text', maxLength: 20, nullable: true },
          { ref: 'city', type: 'text', maxLength: 80, nullable: true },
        ],
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
    { ref: 'e2e-kit-companies', template: 'page-crud', title: { key: 'mft.e2e-kit.companies', fallback: 'Kit companies' }, nav: { group: 'library', icon: 'list', order: 12 }, bindings: { rows: 'companies' } },
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
    <div id="import"></div>
    <div id="consent"></div>
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
body[data-part="map"] { margin: 12px; }
body[data-part="import"] > h1, body[data-part="import"] > #own, body[data-part="import"] > #stored { display: none; }
body[data-part="import"] { margin: 12px; }
body[data-part="consent"] > h1, body[data-part="consent"] > #own, body[data-part="consent"] > #stored { display: none; }
body[data-part="consent"] { margin: 12px; }`;

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
  if (asked.get('part') === 'consent') {
    document.body.dataset.part = 'consent';
    const { consent } = await import('./consent.js');
    window.kitScreen = { config, kit, ...(await consent(config, kit, asked)) };
    document.body.dataset.kit = 'ready';
    throw 'mounted';
  }
  if (asked.get('part') === 'import') {
    document.body.dataset.part = 'import';
    const { importer } = await import('./import.js');
    window.kitScreen = { config, kit, ...(await importer(config, kit, asked)) };
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
  const actions = [];
  // The Pipeline's own actions on a card, when the page is asked for them: one is not to be had on a deal that is won.
  const actionsOf = (row) => asked.get('actions') === null ? {} : { actions: [
    { id: 'close', label: 'Close: won or lost…' },
    { id: 'room', label: 'Open the deal room' },
    { id: 'hand', label: 'Hand it over…', disabled: row.stage === 'won' },
    { id: 'drop', label: 'Delete', tone: 'danger' },
  ] };
  const ODDS = { new: '10%', talking: '40%' };
  // A board with a height of its own: its columns then scroll inside it.
  if (asked.get('long') !== null) document.querySelector('#board').style.height = '420px';

  async function read() {
    const { data } = await (await call('?limit=50&order=id.asc')).json();
    const cards = data.map((row) => ({
      ...actionsOf(row),
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
      return { ...stage, count: rows.length, total: money.format(rows.reduce((sum, row) => sum + row.amount, 0)), ...(asked.get('actions') === null || ODDS[stage.id] === undefined ? {} : { badge: ODDS[stage.id] }) };
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
    ...(asked.get('actions') === null ? {} : { onAction: (cardId, actionId) => { actions.push({ cardId, actionId }); } }),
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
  return { board, saves, actions };
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
  const statuses = [];
  const placed = [];
  const stopped = [];

  // ?colour=1: each pin in a colour of the map's eight, by something of its row (here, its place in the list).
  const coloured = asked.get('colour') !== null;
  async function read() {
    const { data } = await (await call('?limit=50&order=id.asc')).json();
    return data.map((row, index) => ({
      id: String(row.id), label: row.name, lat: Number(row.lat), lng: Number(row.lng),
      ...(row.name === 'Depot' ? { tone: 'warn' } : {}),
      ...(coloured ? { colour: index + 1, group: 'Rep ' + (index + 1) } : {}),
    }));
  }

  // ?areas=1: two named areas, each in a colour: a small one round Berlin and a wide one round Paris.
  const AREAS = [
    { id: 'north', name: 'North', colour: 1, geometry: { type: 'Polygon', coordinates: [[[13.2, 52.4], [13.6, 52.4], [13.6, 52.64], [13.2, 52.64], [13.2, 52.4]]] } },
    { id: 'west', name: 'الغرب', colour: 2, geometry: { type: 'Polygon', coordinates: [[[-1, 46], [6, 46], [6, 51], [-1, 51], [-1, 46]]] } },
  ];

  // ?own=1: the app draws the list itself, in the page before the map is mounted, and names it to the map.
  // A row picks its pin, an area's row picks its area, and a row with no place yet is put on the map.
  let own = null;
  let map = null;
  const mark = (id) => { for (const row of own?.querySelectorAll('[data-row]') ?? []) row.setAttribute('aria-pressed', String(row.dataset.row === id)); };
  function drawOwn(pins) {
    if (asked.get('own') === null) return;
    if (own === null) {
      own = document.createElement('ul');
      own.id = 'own-list';
      own.setAttribute('aria-label', 'Customers, in a list of the app');
      document.querySelector('#map').after(own);
    }
    own.replaceChildren();
    const add = (label, attrs, press) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      for (const [name, value] of Object.entries(attrs)) button.setAttribute(name, value);
      button.addEventListener('click', press);
      item.append(button);
      own.append(item);
    };
    for (const pin of pins) add(pin.label, { 'data-row': pin.id, 'aria-pressed': 'false' }, () => { mark(pin.id); map.update({ selected: pin.id }); });
    if (asked.get('areas') !== null) for (const area of AREAS) add('Area: ' + area.name, { 'data-area': area.id }, () => map.update({ selectedArea: area.id }));
    if (asked.get('place') !== null) add('Place Fourth Wall', { 'data-place': 'new' }, () => map.update({ placing: { id: 'new', label: 'Fourth Wall' } }));
  }
  const first = await read();
  drawOwn(first);

  const refusedOf = async (reply) => ({ refused: (await reply.json().catch(() => ({}))).error?.message ?? 'Not saved.' });

  let routeAsks = 0;
  map = await kit.mount('map', document.querySelector('#map'), {
    maps: asked.get('maps') === 'off' ? { enabled: false, server: null, routing: false } : config.maps,
    pins: first,
    ...(asked.get('areas') === null ? {} : { areas: AREAS, onSelectArea: (areaId) => { document.body.dataset.area = areaId; } }),
    ...(asked.get('own') === null ? {} : { hostList: 'own-list' }),
    onStatus: (status) => { statuses.push(status); document.body.dataset.mapStatus = status; },
    onPlacingStop: () => { stopped.push(true); },
    // A row with no place yet: the app makes the row where the person put it. ?place=bad sends what the server refuses (no name).
    onPlacePin: async (pinId, at) => {
      const values = asked.get('place') === 'bad' ? { lat: at.lat, lng: at.lng } : { name: 'Fourth Wall', lat: at.lat, lng: at.lng };
      const reply = await call('', { method: 'POST', body: JSON.stringify({ values }) });
      placed.push({ pinId, lat: at.lat, lng: at.lng, status: reply.status });
      if (!reply.ok) return refusedOf(reply);
    },
    ariaLabel: 'Customers',
    locale: asked.get('locale') ?? config.locale,
    dir: asked.get('dir') ?? config.dir,
    ...(asked.get('theme') === null ? {} : { theme: asked.get('theme') }),
    ...(asked.get('settings') === null ? {} : { settingsHref: asked.get('settings') }),
    onSelect: (pinId) => { picked.push(pinId); document.body.dataset.picked = pinId; mark(pinId); },
    onMovePin: async (pinId, at) => {
      const reply = await call('/' + pinId, { method: 'PATCH', body: JSON.stringify({ values: { lat: at.lat, lng: at.lng } }) });
      saves.push({ pinId, lat: at.lat, lng: at.lng, status: reply.status });
      if (!reply.ok) return refusedOf(reply);
    },
    ...(asked.get('route') === null ? {} : {
      route: async (stops) => {
        routeAsks += 1;
        // ?route=flaky: the first asking fails, as a network that dropped would.
        if (asked.get('route') === 'flaky' && routeAsks === 1) { routes.push(0); throw new Error('No route.'); }
        const reply = await fetch('/api/v1/geo/route', { method: 'POST', credentials: 'same-origin', headers, body: JSON.stringify({ stops }) });
        routes.push(reply.status);
        if (!reply.ok) throw new Error('No route.');
        return (await reply.json()).data;
      },
    }),
  });
  return { map, saves, picked, routes, read, statuses, placed, stopped };
}`;

/**
 * The app's "Paste a list" screen: the app knows its table, what to call it,
 * the columns a person may bring in and which of them no two rows share, and
 * which modes this person is allowed. It hands those over with the config's
 * connection and token, and hears what the import did.
 */
/**
 * The app's contact page: a person's e-mail consent, for the record the page
 * is about, by its key and its name as the page shows them. The app hears
 * each change (to read a line of its own again).
 */
const CONSENT = `export async function consent(config, kit, asked) {
  const changes = [];
  const panel = await kit.mount('consent', document.querySelector('#consent'), {
    connectionId: config.connectionId,
    table: config.tables.companies,
    recordId: asked.get('id'),
    name: asked.get('name') ?? undefined,
    csrfToken: config.csrfToken,
    locale: asked.get('locale') ?? config.locale,
    dir: asked.get('dir') ?? config.dir,
    ...(asked.get('theme') === null ? {} : { theme: asked.get('theme') }),
    onChange: () => { changes.push(Date.now()); document.body.dataset.changes = String(changes.length); },
  });
  return { panel, changes };
}`;

const IMPORT = `export async function importer(config, kit, asked) {
  const done = [];
  const part = await kit.mount('import', document.querySelector('#import'), {
    connectionId: config.connectionId,
    tables: [{
      table: config.tables.companies,
      label: 'Companies',
      matchOn: 'code',
      columns: [{ key: 'name', label: 'Name' }, { key: 'code', label: 'Code', unique: true }, { key: 'city', label: 'City' }],
    }],
    csrfToken: config.csrfToken,
    modes: (asked.get('modes') ?? 'skip').split(','),
    title: 'Paste a list',
    locale: asked.get('locale') ?? config.locale,
    dir: asked.get('dir') ?? config.dir,
    ...(asked.get('theme') === null ? {} : { theme: asked.get('theme') }),
    onDone: (result) => { done.push(result); document.body.dataset.done = JSON.stringify(result); },
    onClose: () => { document.body.dataset.closed = 'yes'; },
  });
  return { part, done };
}`;

test.describe.configure({ mode: 'serial' });

/** A page on this file's own session, for the hooks: stated, so their calls are counted against this file's budget too. */
async function hookPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ baseURL: BASE_URL, storageState: ownStorageStatePath(PRINCIPAL) });
  return context.newPage();
}

test.beforeAll(async ({ browser }) => {
  const page = await hookPage(browser);
  await signIn(page);
  const connectionId = await connectionOf(page);
  await page.request.delete(`/api/v1/apps/${KEY}`, { data: { dropTables: true, confirmKey: KEY } }).catch(() => undefined);
  const bundle = bundleOf({
    'package.json': JSON.stringify({ name: `@adminium-apps/${KEY}`, version: VERSION }),
    'manifest.json': JSON.stringify(MANIFEST),
    'staff/index.html': PAGE,
    'staff/screen.js': SCREEN,
    'staff/board.js': BOARD,
    'staff/map.js': MAP,
    'staff/import.js': IMPORT,
    'staff/consent.js': CONSENT,
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
  await page.context().close();
});

test.afterAll(async ({ browser }) => {
  const page = await hookPage(browser);
  await signIn(page);
  await page.request.delete(`/api/v1/apps/${KEY}`, { data: { dropTables: true, confirmKey: KEY } }).catch(() => undefined);
  await page.context().close();
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
  // Every sheet of the kit, the one all parts stand on first, then the board's own, the consent panel's, the file parts', the import's and the map's.
  expect(config.kit?.styles).toHaveLength(6);
  expect(config.kit?.styles[0]).toMatch(/^\/assets\/kit\/root-[\w-]+\.css$/);
  expect(config.kit?.styles[1]).toMatch(/^\/assets\/kit\/board-[\w-]+\.css$/);
  expect(config.kit?.styles[2]).toMatch(/^\/assets\/kit\/consent-[\w-]+\.css$/);
  // The signature pad's and the photo field's, one sheet for the two.
  expect(config.kit?.styles[3]).toMatch(/^\/assets\/kit\/files-[\w-]+\.css$/);
  expect(config.kit?.styles[4]).toMatch(/^\/assets\/kit\/import-[\w-]+\.css$/);
  expect(config.kit?.styles[5]).toMatch(/^\/assets\/kit\/map-[\w-]+\.css$/);
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
  expect(await page.evaluate(() => (window as unknown as { kitScreen: { parts: string[] } }).kitScreen.parts)).toEqual(['mentions', 'board', 'map', 'import', 'signature', 'photos', 'consent']);
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

  // A part the kit never heard of is refused by name; the page stands.
  const refused = await page.evaluate(async () => {
    const { kit } = (window as unknown as { kitScreen: { kit: { mount(part: string, element: Element, props: unknown): Promise<unknown> } } }).kitScreen;
    return kit.mount('wizard', document.body, {}).then(
      () => 'mounted',
      (error: { code?: string }) => error.code ?? 'no code',
    );
  });
  expect(refused).toBe('KIT_PART_UNKNOWN');

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

/** Where each deal stands when a test begins: three new, one being talked about, one won. */
const STAGES: Record<string, string> = { 'Harbour Cafe': 'new', 'Second Wind': 'new', 'Third Coast': 'new', 'Fourth Wall': 'talking', 'Fifth Season': 'won' };

/**
 * The five deals as every test expects to find them, through the data API as
 * the signed-in person.
 *
 * What the test before left is put right where it can be, and the table is
 * made afresh only where it cannot. Making it afresh is fourteen calls, and
 * this file's calls are counted against the server's own budget of 300 a
 * minute for one person: a test that left the deals alone costs one. A deal
 * that was moved on from New is moved back (the table's rule allows that
 * step and no other backwards), a card a test added is deleted, and anything
 * else (a deal that was won, one that is missing) starts over, since a deal
 * made again would stand after the others in its column.
 */
async function seedDeals(page: Page): Promise<Record<string, string>> {
  const connectionId = await connectionOf(page);
  const table = `/api/v1/data/${connectionId}/e2e_kit_deals`;
  const listed = (await (await page.request.get(`${table}?limit=200&order=id.asc`)).json()) as { data: { id: number; title: string; stage: string }[] };
  const kept = listed.data.filter((row) => row.title in STAGES);
  const mendable =
    kept.length === DEALS.length &&
    kept.every((row, index) => row.title === DEALS[index] && (row.stage === STAGES[row.title] || (row.stage === 'talking' && STAGES[row.title] === 'new')));
  if (mendable) {
    for (const row of listed.data.filter((one) => !(one.title in STAGES))) expect((await page.request.delete(`${table}/${String(row.id)}`)).ok()).toBe(true);
    for (const row of kept.filter((one) => one.stage !== STAGES[one.title])) {
      const back = await page.request.patch(`${table}/${String(row.id)}`, { data: { values: { stage: 'new' }, from: 'talking' } });
      expect(back.ok(), await back.text()).toBe(true);
    }
    return Object.fromEntries(kept.map((row) => [row.title, String(row.id)]));
  }
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
  // The columns share the board's width, none narrower than 260 (the Project Board comp).
  expect(boxes[0]!.width).toBeGreaterThanOrEqual(260);
  expect(Math.round(boxes[1]!.width)).toBe(Math.round(boxes[0]!.width));
  expect(boxes[1]!.x).toBeGreaterThan(boxes[0]!.x + boxes[0]!.width);
  expect(Math.round(boxes[1]!.y)).toBe(Math.round(boxes[0]!.y));
  const face = card(page, 'Harbour Cafe').locator('> div');
  expect(await face.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 255, 255)');
  expect(await face.evaluate((el) => getComputedStyle(el).borderTopWidth + ' ' + getComputedStyle(el).borderTopStyle)).toBe('1px solid');
  expect(await face.evaluate((el) => getComputedStyle(el).borderRadius)).toBe('12px');
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
  const to = (await column(page, 'talking').boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2 + 6, { steps: 3 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  // While it is held, the column under it shows where it will land.
  await expect(column(page, 'talking')).toHaveAttribute('data-drop-target', '');
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
  await expect(column(page, 'won')).toHaveAttribute('data-drop-target', '');
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
  await expect(column(page, 'new')).toHaveAttribute('data-drop-target', '');
  await page.keyboard.press('ArrowLeft');
  await expect(column(page, 'talking')).toHaveAttribute('data-drop-target', '');
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
  expect(await face.locator('p').first().evaluate((el) => getComputedStyle(el).color)).toBe('rgb(244, 244, 246)');
  // The app's own accent: the ring round a card that has the focus.
  await page.evaluate(() => document.body.setAttribute('data-tokens', ''));
  await card(page, 'Harbour Cafe').focus();
  await page.keyboard.press('Space');
  await expect.poll(() => card(page, 'Harbour Cafe').evaluate((el) => getComputedStyle(el).boxShadow)).toContain('rgb(200, 30, 90)');
  await page.keyboard.press('Escape');
  expect(problems).toEqual([]);
});

/* -------------------------------------------------- a card's own actions */

/*
 * The tests from here on do not open the dashboard first. The session this
 * project starts every page with (the setup project's) is the signed-in
 * person's already, and each visit to the dashboard is a dozen calls against
 * the same per-minute budget this file's own reads and saves are counted in.
 */

const ACTIONS_PAGE = `${BOARD_PAGE}&actions=1`;
const moreOf = (page: Page, title: string, name = `Actions for ${title}`) => page.locator('#board').getByRole('button', { name, exact: true });
const menu = (page: Page) => page.locator('#board [role="menu"]');
const chosen = (page: Page): Promise<{ cardId: string; actionId: string }[]> => page.evaluate(() => (window as unknown as { kitScreen: { actions: { cardId: string; actionId: string }[] } }).kitScreen.actions);

/** Every item of the open menu is whole inside the window and is what a press at its middle would land on: nothing cuts it off or covers it. */
async function menuIsWhole(page: Page): Promise<void> {
  const faults = await menu(page)
    .locator('[role="menuitem"]')
    .evaluateAll((items) =>
      items.flatMap((item) => {
        const box = item.getBoundingClientRect();
        const inside = box.left >= 0 && box.top >= 0 && box.right <= document.documentElement.clientWidth && box.bottom <= document.documentElement.clientHeight;
        const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return inside && top !== null && item.contains(top) ? [] : [`${item.textContent ?? ''}: inside=${String(inside)} on top=${String(top !== null && item.contains(top))}`];
      }),
    );
  expect(faults).toEqual([]);
}

test('a card’s own actions open by the mouse from a button that is no part of the card, and the app hears the choice', async ({ page }) => {
  const ids = await seedDeals(page);
  const problems = watch(page);
  await open(page, ACTIONS_PAGE);

  // The app's odds stand after two headings, and nowhere else.
  await expect(column(page, 'new').locator('[data-part="column-badge"]')).toHaveText('10%');
  await expect(column(page, 'talking').locator('[data-part="column-badge"]')).toHaveText('40%');
  await expect(column(page, 'won').locator('[data-part="column-badge"]')).toHaveCount(0);
  const [label, badge] = await Promise.all([column(page, 'new').locator('header h3').boundingBox(), column(page, 'new').locator('[data-part="column-badge"]').boundingBox()]);
  expect(badge!.x).toBeGreaterThanOrEqual(label!.x + label!.width);
  expect(await column(page, 'new').locator('[data-part="column-badge"]').evaluate((el) => getComputedStyle(el).borderTopWidth + ' ' + getComputedStyle(el).borderTopLeftRadius)).not.toBe('0px 0px');

  // Every card has its button: at the card's far corner, drawn over it, and not inside it.
  await expect(page.locator('#board [data-part="board-card-actions"]')).toHaveCount(DEALS.length);
  const more = moreOf(page, 'Harbour Cafe');
  await expect(more).toBeVisible();
  expect(await more.evaluate((el) => el.tagName + ' ' + String(el.closest('[data-board-card]') === null))).toBe('BUTTON true');
  const [face, corner] = await Promise.all([card(page, 'Harbour Cafe').boundingBox(), more.boundingBox()]);
  expect(corner!.x).toBeGreaterThan(face!.x + face!.width / 2);
  expect(corner!.x + corner!.width).toBeLessThanOrEqual(face!.x + face!.width);
  expect(corner!.y).toBeGreaterThanOrEqual(face!.y);
  expect(corner!.y - face!.y).toBeLessThan(20);
  // The grip stands before it, not under it.
  const grip = (await card(page, 'Harbour Cafe').locator('[data-part="board-card-grip"]').boundingBox())!;
  expect(grip.x + grip.width).toBeLessThanOrEqual(corner!.x + 1);
  expect(await unstyledClasses(page)).toEqual([]);

  await more.click();
  await expect(menu(page)).toBeVisible();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  await expect(menu(page)).toHaveAttribute('aria-label', 'Actions for Harbour Cafe');
  await expect(menu(page).getByRole('menuitem')).toHaveText(['Close: won or lost…', 'Open the deal room', 'Hand it over…', 'Delete']);
  await menuIsWhole(page);
  expect(await unstyledClasses(page)).toEqual([]);
  // A menu, as the kit draws one: its own surface, a border, a shadow; and the one that cannot be taken back is red.
  expect(await menu(page).evaluate((el) => [getComputedStyle(el).position, getComputedStyle(el).backgroundColor, getComputedStyle(el).borderTopWidth].join(' '))).toBe('fixed rgb(255, 255, 255) 1px');
  expect(await menu(page).evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe('none');
  expect(await menu(page).getByRole('menuitem', { name: 'Delete' }).evaluate((el) => getComputedStyle(el).color)).toBe('rgb(207, 39, 60)');
  // It hangs under the button, its far edge on the button's.
  const [under, hung] = await Promise.all([more.boundingBox(), menu(page).boundingBox()]);
  expect(Math.abs(hung!.x + hung!.width - (under!.x + under!.width))).toBeLessThanOrEqual(1);
  expect(hung!.y).toBeGreaterThanOrEqual(under!.y + under!.height);

  await menu(page).getByRole('menuitem', { name: 'Open the deal room' }).click();
  await expect(menu(page)).toHaveCount(0);
  expect(await chosen(page)).toEqual([{ cardId: ids['Harbour Cafe'], actionId: 'room' }]);
  await expect(more).toBeFocused();
  // Choosing an action neither opened the card nor moved it.
  expect(await page.locator('body').getAttribute('data-opened')).toBeNull();
  expect(await saves(page)).toEqual([]);

  // A press anywhere else puts the menu away, and chooses nothing.
  await more.click();
  await expect(menu(page)).toBeVisible();
  await page.locator('#own-classes').click();
  await expect(menu(page)).toHaveCount(0);
  expect(await chosen(page)).toHaveLength(1);

  // The button does not start a drag: pressed and pulled across to the next column, the card stays.
  const grab = (await more.boundingBox())!;
  const drop = (await column(page, 'talking').boundingBox())!;
  await page.mouse.move(grab.x + grab.width / 2, grab.y + grab.height / 2);
  await page.mouse.down();
  await page.mouse.move(grab.x + 40, grab.y + 20, { steps: 4 });
  await page.mouse.move(drop.x + drop.width / 2, drop.y + drop.height / 2, { steps: 10 });
  await expect(column(page, 'talking')).not.toHaveAttribute('data-drop-target', '');
  await page.mouse.up();
  expect(await cardsIn(page, 'new')).toEqual(['Harbour Cafe', 'Second Wind', 'Third Coast']);
  expect(await saves(page)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(menu(page)).toHaveCount(0);

  // The card itself is dragged as ever, and its button goes with it to the new column.
  const from = (await card(page, 'Second Wind').boundingBox())!;
  await page.mouse.move(from.x + 40, from.y + from.height - 12);
  await page.mouse.down();
  await page.mouse.move(from.x + 52, from.y + from.height - 6, { steps: 3 });
  await page.mouse.move(drop.x + drop.width / 2, drop.y + drop.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect.poll(() => cardsIn(page, 'talking')).toEqual(['Second Wind', 'Fourth Wall']);
  await expect.poll(() => saves(page)).toEqual([{ cardId: ids['Second Wind'], to: 'talking', from: 'new', status: 200 }]);
  await expect(column(page, 'talking').getByRole('button', { name: 'Actions for Second Wind', exact: true })).toBeVisible();
  expect(problems).toEqual([]);
});

test('by keyboard alone: Tab goes from a card to its button, the menu is worked with the arrows, and the same card is still moved and opened', async ({ page }) => {
  const ids = await seedDeals(page);
  const problems = watch(page);
  await open(page, ACTIONS_PAGE);

  // What a screen reader is told on the card: it can be dragged, and how it is opened.
  const face = card(page, 'Harbour Cafe');
  await expect(face).toHaveAttribute('aria-roledescription', 'draggable card');
  const hint = await face.getAttribute('aria-describedby');
  expect(await page.locator(`[id="${hint!}"]`).textContent()).toBe('Enter picks this card up to move it. Shift+Enter opens it.');

  await face.focus();
  await page.keyboard.press('Tab');
  const more = moreOf(page, 'Harbour Cafe');
  await expect(more).toBeFocused();
  // The ring the button shows a keyboard is the app's accent or Adminium's: it can be seen.
  expect(await more.evaluate((el) => getComputedStyle(el).outlineStyle + ' ' + getComputedStyle(el).outlineWidth)).toBe('solid 2px');

  await page.keyboard.press('Enter');
  await expect(menu(page)).toBeVisible();
  const items = menu(page).getByRole('menuitem');
  await expect(items.nth(0)).toBeFocused();
  // Enter on the button opened a menu: it did not pick the card up.
  await expect(face).not.toHaveAttribute('aria-grabbed', 'true');
  await expect(spoken(page)).toHaveText('');
  await page.keyboard.press('ArrowUp');
  await expect(items.nth(3)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(items.nth(0)).toBeFocused();
  await page.keyboard.press('End');
  await expect(items.nth(3)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu(page)).toHaveCount(0);
  await expect(more).toBeFocused();
  expect(await chosen(page)).toEqual([]);

  await page.keyboard.press('ArrowDown');
  await expect(items.nth(0)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Space');
  await expect(menu(page)).toHaveCount(0);
  expect(await chosen(page)).toEqual([{ cardId: ids['Harbour Cafe'], actionId: 'room' }]);
  await expect(more).toBeFocused();

  // Tab from the open menu closes it and goes on to the next card, as if the menu had not been there.
  await page.keyboard.press('Enter');
  await expect(menu(page)).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(menu(page)).toHaveCount(0);
  await expect(card(page, 'Second Wind')).toBeFocused();

  // One that is not to be had, on the deal that is won: reached, said, and a press does nothing.
  await moreOf(page, 'Fifth Season').focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(items.nth(2)).toBeFocused();
  await expect(items.nth(2)).toHaveAttribute('aria-disabled', 'true');
  expect(Number(await items.nth(2).evaluate((el) => getComputedStyle(el).opacity))).toBeLessThan(1);
  await page.keyboard.press('Enter');
  await expect(menu(page)).toBeVisible();
  expect(await chosen(page)).toHaveLength(1);
  await page.keyboard.press('Escape');

  // The very card whose action was chosen is opened and moved, with the same keyboard.
  await more.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(face).toBeFocused();
  await page.keyboard.press('Shift+Enter');
  await expect(page.locator('body')).toHaveAttribute('data-opened', ids['Harbour Cafe']!);
  await expect(face).not.toHaveAttribute('aria-grabbed', 'true');
  await page.keyboard.press('Enter');
  await expect(face).toHaveAttribute('aria-grabbed', 'true');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect.poll(() => cardsIn(page, 'talking')).toEqual(['Harbour Cafe', 'Fourth Wall']);
  await expect.poll(() => saves(page)).toEqual([{ cardId: ids['Harbour Cafe'], to: 'talking', from: 'new', status: 200 }]);
  await expect(card(page, 'Harbour Cafe')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(moreOf(page, 'Harbour Cafe')).toBeFocused();
  expect(problems).toEqual([]);
});

test('the menu of the last card of a long column is whole: the column’s scroll box does not cut it off, and scrolling puts it away', async ({ page }) => {
  await seedDeals(page);
  const table = `/api/v1/data/${await connectionOf(page)}/e2e_kit_deals`;
  for (let extra = 1; extra <= 6; extra += 1) expect((await page.request.post(table, { data: { values: { title: `Extra ${String(extra)}`, amount: 10 } } })).ok()).toBe(true);
  const problems = watch(page);
  await open(page, `${ACTIONS_PAGE}&long=1`);

  // Nine cards in a board 420 high: the column's list of cards scrolls inside it.
  const cell = column(page, 'new').locator('[data-part="column-cards"]');
  const sizes = await cell.evaluate((el) => ({ inner: el.scrollHeight, box: el.clientHeight }));
  expect(sizes.inner).toBeGreaterThan(sizes.box + 400);
  const more = moreOf(page, 'Extra 6');
  await more.focus();
  await expect.poll(() => cell.evaluate((el) => el.scrollTop)).toBeGreaterThan(400);
  await page.keyboard.press('Enter');
  await expect(menu(page)).toBeVisible();
  await menuIsWhole(page);
  // It is taller than what is left of the column under the button, and reaches outside the column's own box.
  const [hung, edge] = await Promise.all([menu(page).boundingBox(), cell.boundingBox()]);
  expect(hung!.y + hung!.height > edge!.y + edge!.height || hung!.y < edge!.y || hung!.x < edge!.x).toBe(true);
  await expect(menu(page).getByRole('menuitem').first()).toBeFocused();

  // The column is scrolled under it: the menu would be left hanging where its button no longer is, so it goes.
  await cell.evaluate((el) => el.scrollBy(0, -200));
  await expect(menu(page)).toHaveCount(0);

  // And with no room under the button it opens above it: the window is cut to end just under the button.
  await more.focus();
  const low = (await more.boundingBox())!;
  await page.setViewportSize({ width: 1280, height: Math.round(low.y + low.height + 40) });
  await expect(more).toBeFocused();
  expect((await more.boundingBox())!.y).toBeCloseTo(low.y, 0);
  await page.keyboard.press('Enter');
  await expect(menu(page)).toBeVisible();
  await menuIsWhole(page);
  const [above, button] = await Promise.all([menu(page).boundingBox(), more.boundingBox()]);
  expect(above!.y + above!.height).toBeLessThanOrEqual(button!.y);
  await page.keyboard.press('Escape');
  await expect(more).toBeFocused();
  expect(problems).toEqual([]);
});

test('in Arabic a card’s button is at its left, its menu opens toward the right, and both speak Arabic', async ({ page }) => {
  const ids = await seedDeals(page);
  const problems = watch(page);
  await open(page, `${ACTIONS_PAGE}&locale=ar-EG&dir=rtl`);
  const words = (JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', '..', 'packages', 'i18n', 'locales', 'ar-EG', 'ui.json'), 'utf8')) as { widgets: { boards: { cardActions: string; a11y: Record<string, string> } } }).widgets.boards;

  const face = card(page, 'Harbour Cafe');
  await expect(face).toHaveAttribute('aria-roledescription', words.a11y['draggable']!);
  expect(words.a11y['draggable']).not.toBe('draggable card');
  expect(await page.locator(`[id="${(await face.getAttribute('aria-describedby'))!}"]`).textContent()).toBe(words.a11y['openHint']);
  const more = moreOf(page, 'Harbour Cafe', words.cardActions.replace('{title}', 'Harbour Cafe'));
  await expect(more).toBeVisible();
  const [box, corner] = await Promise.all([face.boundingBox(), more.boundingBox()]);
  expect(corner!.x + corner!.width).toBeLessThan(box!.x + box!.width / 2);
  expect(corner!.x).toBeGreaterThanOrEqual(box!.x);
  // The grip is on the button's other side: after it, reading right to left.
  const grip = (await face.locator('[data-part="board-card-grip"]').boundingBox())!;
  expect(grip.x).toBeGreaterThanOrEqual(corner!.x + corner!.width - 1);

  await face.focus();
  await page.keyboard.press('Tab');
  await expect(more).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(menu(page)).toBeVisible();
  await menuIsWhole(page);
  // Its near edge is on the button's, and it reaches toward the start of the line, which is the right here.
  const hung = (await menu(page).boundingBox())!;
  expect(Math.abs(hung.x - corner!.x)).toBeLessThanOrEqual(1);
  expect(hung.x + hung.width).toBeGreaterThan(corner!.x + corner!.width);
  expect(await menu(page).getByRole('menuitem').first().evaluate((el) => getComputedStyle(el).direction + ' ' + getComputedStyle(el).textAlign)).toMatch(/^rtl (start|right)$/);
  await page.keyboard.press('Enter');
  expect(await chosen(page)).toEqual([{ cardId: ids['Harbour Cafe'], actionId: 'close' }]);
  await expect(more).toBeFocused();
  // Picked up, the card is announced in Arabic, grip and all.
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Space');
  await expect(spoken(page)).toHaveText(words.a11y['grabbed']!.replace('{title}', 'Harbour Cafe'));
  await page.keyboard.press('Escape');
  await expect(face.locator('[data-part="board-card-grip"]')).toHaveAttribute('title', (JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', '..', 'packages', 'i18n', 'locales', 'ar-EG', 'ui.json'), 'utf8')) as { widgets: { boards: { grip: string } } }).widgets.boards.grip);
  expect(await unstyledClasses(page)).toEqual([]);
  expect(problems).toEqual([]);
});

test('at 390 wide and dark, a card’s menu is whole inside the window and the page never scrolls sideways', async ({ page }) => {
  const ids = await seedDeals(page);
  await page.setViewportSize({ width: 390, height: 800 });
  const problems = watch(page);
  await open(page, `${ACTIONS_PAGE}&theme=dark`);

  const more = moreOf(page, 'Third Coast');
  await more.click();
  await expect(menu(page)).toBeVisible();
  await menuIsWhole(page);
  const hung = (await menu(page).boundingBox())!;
  expect(hung.x).toBeGreaterThanOrEqual(0);
  expect(hung.x + hung.width).toBeLessThanOrEqual(390);
  expect(await menu(page).evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(20, 20, 25)');
  expect(await menu(page).getByRole('menuitem').first().evaluate((el) => getComputedStyle(el).color)).toBe('rgb(244, 244, 246)');
  const widths = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, view: document.documentElement.clientWidth, left: window.scrollX }));
  expect(widths.page).toBeLessThanOrEqual(widths.view);
  expect(widths.left).toBe(0);
  await menu(page).getByRole('menuitem', { name: 'Close: won or lost…' }).click();
  expect(await chosen(page)).toEqual([{ cardId: ids['Third Coast'], actionId: 'close' }]);
  // The board scrolled sideways under an open menu puts it away too.
  await more.click();
  await expect(menu(page)).toBeVisible();
  await page.locator('#board [data-board-scroller]').evaluate((el) => el.scrollBy(120, 0));
  await expect(menu(page)).toHaveCount(0);
  expect(await unstyledClasses(page)).toEqual([]);
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

/**
 * The three places where every test expects them, through the data API as the
 * signed-in person. As with the deals, what is there is put right rather than
 * made again: a pin a test moved is put back, a place a test added is
 * deleted, and only a place that is missing starts the table over.
 */
async function seedPlaces(page: Page): Promise<Record<string, string>> {
  const connectionId = await connectionOf(page);
  const table = `/api/v1/data/${connectionId}/e2e_kit_places`;
  const listed = (await (await page.request.get(`${table}?limit=200&order=id.asc`)).json()) as { data: { id: number; name: string; lat: number | string; lng: number | string }[] };
  const kept = listed.data.filter((row) => PLACES.some(([name]) => name === row.name));
  if (kept.length === PLACES.length && kept.every((row, index) => row.name === PLACES[index]![0])) {
    for (const row of listed.data.filter((one) => !kept.includes(one))) expect((await page.request.delete(`${table}/${String(row.id)}`)).ok()).toBe(true);
    for (const [index, row] of kept.entries()) {
      const [, lat, lng] = PLACES[index]!;
      if (Number(row.lat) === lat && Number(row.lng) === lng) continue;
      const back = await page.request.patch(`${table}/${String(row.id)}`, { data: { values: { lat, lng } } });
      expect(back.ok(), await back.text()).toBe(true);
    }
    return Object.fromEntries(kept.map((row) => [row.name, String(row.id)]));
  }
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
  const reply = await page.request.get(`/api/v1/data/${await connectionOf(page)}/e2e_kit_places/${id}`);
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
async function mapServer(page: Page, how: 'up' | 'down' = 'up'): Promise<{ origin: string; asked: string[]; turn(next: 'up' | 'down'): void }> {
  const config = (await (await page.request.get(`${STAFF}surface-config.json`)).json()) as { maps: { enabled: boolean; server: string | null } };
  expect(config.maps.enabled).toBe(true);
  const origin = new URL(config.maps.server!).origin;
  const asked: string[] = [];
  const state = { how };
  const cors = { 'access-control-allow-origin': '*' };
  await page.route(`${origin}/**`, async (route) => {
    const { pathname } = new URL(route.request().url());
    asked.push(pathname);
    if (state.how === 'down') return route.abort('connectionrefused');
    if (pathname.startsWith('/styles/')) return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(styleOf(origin, pathname.endsWith('/dark'))) });
    if (pathname.endsWith('.json')) return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '{}' });
    if (pathname.endsWith('.png')) return route.fulfill({ status: 200, headers: cors, contentType: 'image/png', body: PIXEL });
    // Letters and map pictures: an empty answer is a tile with nothing on it.
    return route.fulfill({ status: 200, headers: cors, contentType: 'application/x-protobuf', body: Buffer.alloc(0) });
  });
  return { origin, asked, turn: (next) => void (state.how = next) };
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
  const made = await page.request.post(`/api/v1/data/${await connectionOf(page)}/e2e_kit_places`, { data: { values: { name: 'Fourth Wall', lat: 40.4168, lng: -3.7038 } } });
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
  expect((await page.request.delete(`/api/v1/data/${await connectionOf(page)}/e2e_kit_places/${ids['Depot']!}`)).ok()).toBe(true);
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

/* ---------------------------------------- what the two map screens draw */

interface Placed {
  pinId: string;
  lat: number;
  lng: number;
  status: number;
}
const ownRow = (page: Page, label: string) => page.locator('#own-list button', { hasText: label });
const areaNames = (page: Page) => page.locator('#map [data-part="map-area-name"]');
const placingLine = (page: Page) => page.locator('#map [data-part="map-placing"]');
const mapCanvas = (page: Page) => page.locator('#map canvas.maplibregl-canvas');
const placedOf = (page: Page): Promise<Placed[]> => page.evaluate(() => (window as unknown as { kitScreen: { placed: Placed[] } }).kitScreen.placed);
const kitMapUpdate = (page: Page, props: Record<string, unknown>): Promise<void> =>
  page.evaluate((change) => (window as unknown as { kitScreen: { map: { update(props: Record<string, unknown>): void } } }).kitScreen.map.update(change), props);

/** A spot on the map with no pin near it: where a click is a click on the map and not on a pin. */
async function emptySpot(page: Page): Promise<{ x: number; y: number }> {
  const [taken, frame] = await Promise.all([spots(page), page.locator('#map [data-part="map-canvas"]').boundingBox()]);
  let best = { x: 0, y: 0, room: -1 };
  for (let col = 1; col < 8; col += 1) {
    for (let row = 1; row < 6; row += 1) {
      const x = Math.round(frame!.x + (frame!.width * col) / 8);
      const y = Math.round(frame!.y + (frame!.height * row) / 6);
      // Away from the middle too, where the cross is, and from the library's buttons in the corners.
      const room = Math.min(...Object.values(taken).map((pin) => Math.hypot(pin.x - x, pin.y - y)), Math.hypot(frame!.x + frame!.width / 2 - x, frame!.y + frame!.height / 2 - y));
      if (room > best.room) best = { x, y, room };
    }
  }
  expect(best.room).toBeGreaterThan(30);
  return { x: best.x, y: best.y };
}

test('areas are named on the map, pins take a colour and an outline, and a row of the app’s own list picks and frames, by keyboard', async ({ page }) => {
  const ids = await seedPlaces(page);
  const problems = watch(page);
  const server = await mapServer(page);
  const origins = new Set<string>();
  page.on('request', (request) => origins.add(new URL(request.url()).origin));
  await openMap(page, '&areas=1&colour=1&own=1');

  // The app's own list is in the page and named, so the map's own is left out; the pins are still named buttons.
  await expect(page.locator('#own-list')).toBeVisible();
  await expect(page.locator('#map [data-part="geo-ranking"]')).toHaveCount(0);
  await expect(page.locator('#map [data-part="geo-areas"]')).toHaveCount(0);
  await expect(pins(page)).toHaveCount(3);

  // A colour of the map's eight for each pin, each with an outline of its own, and what the colour stands for in its name.
  const cafe = pinOf(page, 'Harbour Cafe');
  await expect(cafe).toHaveAttribute('aria-label', /^Harbour Cafe · Rep 1 · /);
  expect(await cafe.evaluate((el) => [getComputedStyle(el).borderTopColor, getComputedStyle(el).borderTopLeftRadius].join(' '))).toBe('rgb(14, 165, 233) 3px');
  const wind = pinOf(page, 'Second Wind');
  expect(await wind.evaluate((el) => [getComputedStyle(el).borderTopColor, getComputedStyle(el).borderTopLeftRadius, getComputedStyle(el).borderBottomLeftRadius].join(' '))).toBe('rgb(20, 184, 166) 50% 0px');
  // A colour stands in the place of a tone: the depot's `warn` gives way.
  expect(await pinOf(page, 'Depot').evaluate((el) => getComputedStyle(el).borderTopColor)).toBe('rgb(245, 158, 11)');

  // The wide area has its name written on it, in the name's own direction on a map that does not mirror.
  await expect(areaNames(page)).toHaveCount(2);
  const west = areaNames(page).nth(1);
  await expect(west).toHaveText('الغرب');
  await expect(west).toBeVisible();
  await expect(west).toHaveAttribute('aria-hidden', 'true');
  expect(await west.evaluate((el) => [getComputedStyle(el).direction, getComputedStyle(el).pointerEvents].join(' '))).toBe('rtl none');
  expect(await page.locator('#map [data-part="map-canvas"]').evaluate((el) => getComputedStyle(el).direction)).toBe('ltr');
  expect(await west.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
  const [name, frame] = await Promise.all([west.boundingBox(), page.locator('#map [data-part="map-canvas"]').boundingBox()]);
  expect(name!.x).toBeGreaterThan(frame!.x);
  expect(name!.x + name!.width).toBeLessThan(frame!.x + frame!.width);
  // The small one is too small on screen to hold its name: it is not written across its neighbours.
  const north = areaNames(page).first();
  await expect(north).toHaveText('North');
  await expect(north).toBeHidden();

  // A row of the app's own list, by keyboard: the pin is marked and the map goes to it.
  const before = await spots(page);
  await ownRow(page, 'Depot').focus();
  await page.keyboard.press('Enter');
  await expect(pinOf(page, 'Depot')).toHaveAttribute('aria-current', 'true');
  await expect(ownRow(page, 'Depot')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => JSON.stringify(await spots(page))).not.toBe(JSON.stringify(before));
  // The app only said which is picked: nothing was "picked" on the map.
  expect(await page.locator('body').getAttribute('data-picked')).toBeNull();
  // The picked place has its way out under the map: a plain link to OpenStreetMap with the position and nothing else.
  const out = page.locator('#map [data-part="geo-picked-link"] a');
  await expect(out).toHaveText('Open on OpenStreetMap (new tab)');
  expect(await out.getAttribute('href')).toBe('https://www.openstreetmap.org/?mlat=41.90280&mlon=12.49640#map=16/41.90280/12.49640');
  expect(await out.evaluate((el: HTMLAnchorElement) => [el.target, el.rel, el.referrerPolicy].join(' '))).toBe('_blank noopener noreferrer no-referrer');

  // An area's row: the map brings it into view, where its name now fits, and marks it.
  await ownRow(page, 'Area: North').focus();
  await page.keyboard.press('Enter');
  await expect(north).toBeVisible();
  await expect(north).toHaveAttribute('data-selected', '');
  const framed = await spots(page);
  const box = (await page.locator('#map [data-part="map-canvas"]').boundingBox())!;
  // The café is inside North: it is in the frame now.
  expect(framed['Harbour Cafe']!.x).toBeGreaterThan(box.x);
  expect(framed['Harbour Cafe']!.x).toBeLessThan(box.x + box.width);

  // On the map, with the mouse: a pin is told to the app, which marks its own row; an area under a click is told too.
  await pinOf(page, 'Harbour Cafe').click();
  await expect(page.locator('body')).toHaveAttribute('data-picked', ids['Harbour Cafe']!);
  await expect(ownRow(page, 'Harbour Cafe')).toHaveAttribute('aria-pressed', 'true');
  await expect(ownRow(page, 'Depot')).toHaveAttribute('aria-pressed', 'false');
  await spots(page);
  await page.mouse.click(box.x + box.width / 2 - 90, box.y + box.height / 2 + 40);
  await expect(page.locator('body')).toHaveAttribute('data-area', 'north');

  expect(await unstyledClasses(page)).toEqual([]);
  // The link was never followed: nothing went anywhere but this Adminium and the map server.
  expect([...origins].sort()).toEqual([new URL(page.url()).origin, server.origin].sort());
  expect(problems).toEqual([]);
});

test('a row with no place yet is put on the map by a click, then by the keyboard under the cross, and the server holds it', async ({ page }) => {
  await seedPlaces(page);
  const problems = watch(page);
  await mapServer(page);
  await openMap(page, '&own=1&place=1');
  await expect(page.locator('body')).toHaveAttribute('data-map-status', 'ready');
  await expect(placingLine(page)).toHaveCount(0);

  await ownRow(page, 'Place Fourth Wall').click();
  await expect(placingLine(page)).toContainText('Click the map where Fourth Wall is.');
  const cross = page.locator('#map [data-part="map-cross"]');
  await expect(cross).toBeVisible();
  expect(await mapCanvas(page).evaluate((el) => getComputedStyle(el).cursor)).toBe('crosshair');
  expect(await unstyledClasses(page)).toEqual([]);

  // With the mouse.
  const at = await emptySpot(page);
  // Where on the map itself: the line above it goes when the state ends, and the whole map moves up the page.
  const frameOf = async (): Promise<{ x: number; y: number }> => (await page.locator('#map [data-part="map-canvas"]').boundingBox())!;
  const clicked = { x: at.x - (await frameOf()).x, y: at.y - (await frameOf()).y };
  await page.mouse.click(at.x, at.y);
  await expect.poll(() => placedOf(page)).toHaveLength(1);
  const [first] = await placedOf(page);
  expect(first!.pinId).toBe('new');
  expect(first!.status).toBeLessThan(300);
  await expect(pins(page)).toHaveCount(4);
  await expect(mapSaid(page)).toHaveText(/^Fourth Wall placed at /);
  // The state ended with the save, and the pin stands where the click was.
  await expect(placingLine(page)).toHaveCount(0);
  await expect(cross).toHaveCount(0);
  await page.waitForTimeout(600);
  const stood = (await spots(page))['Fourth Wall']!;
  expect(Math.abs(stood.x - (await frameOf()).x - clicked.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(stood.y - (await frameOf()).y - clicked.y)).toBeLessThanOrEqual(2);
  const rows = (await (await page.request.get(`/api/v1/data/${await connectionOf(page)}/e2e_kit_places?limit=50&order=id.asc`)).json()) as { data: { name: string; lat: number | string; lng: number | string }[] };
  const kept = rows.data.find((row) => row.name === 'Fourth Wall')!;
  expect(Number(kept.lat)).toBeCloseTo(first!.lat, 5);
  expect(Number(kept.lng)).toBeCloseTo(first!.lng, 5);

  // With the keyboard: the row's button, then the map itself: the arrows move it, Enter puts the place under the cross.
  await ownRow(page, 'Place Fourth Wall').focus();
  await page.keyboard.press('Enter');
  await expect(cross).toBeVisible();
  await mapCanvas(page).focus();
  await page.keyboard.press('ArrowRight');
  await spots(page);
  await page.keyboard.press('Enter');
  await expect.poll(() => placedOf(page)).toHaveLength(2);
  await expect(placingLine(page)).toHaveCount(0);
  await page.waitForTimeout(600);
  const frame = (await page.locator('#map [data-part="map-canvas"]').boundingBox())!;
  const moved = (await spots(page))['Fourth Wall']!;
  expect(Math.abs(moved.x - (frame.x + frame.width / 2))).toBeLessThanOrEqual(3);
  expect(Math.abs(moved.y - (frame.y + frame.height / 2))).toBeLessThanOrEqual(3);
  await expect(pins(page)).toHaveCount(4);

  // And the button, for somebody who never focuses the map.
  await ownRow(page, 'Place Fourth Wall').click();
  await page.locator('#map').getByRole('button', { name: 'Place it at the middle of the map' }).click();
  await expect.poll(() => placedOf(page)).toHaveLength(3);
  expect(problems).toEqual([]);
});

test('a placing the server refuses takes the pin away and says the server’s own reason; Escape on the map leaves the state', async ({ page }) => {
  await seedPlaces(page);
  const faults: string[] = [];
  page.on('console', (message) => {
    // The browser itself logs the refused save; anything else is a fault.
    if (message.type() === 'error' && !/40\d|422/.test(message.text())) faults.push(message.text());
  });
  page.on('pageerror', (error) => faults.push(String(error)));
  await mapServer(page);
  await openMap(page, '&own=1&place=bad');

  await ownRow(page, 'Place Fourth Wall').click();
  await expect(placingLine(page)).toBeVisible();
  const at = await emptySpot(page);
  const answered = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().includes('/e2e_kit_places'));
  await page.mouse.click(at.x, at.y);
  const reply = await answered;
  expect(reply.ok()).toBe(false);
  const { error } = (await reply.json()) as { error: { message: string } };
  expect(error.message.length).toBeGreaterThan(5);

  const notice = page.locator('#map [data-part="map-refused"]');
  await expect(notice).toContainText('Fourth Wall was not placed.');
  await expect(notice.locator('[data-part="map-refused-reason"]')).toHaveText(error.message);
  await expect(notice.locator('[data-part="map-refused-reason"]')).toHaveAttribute('role', 'alert');
  await expect(mapSaid(page)).toHaveText('Fourth Wall was not placed.');
  await expect(pins(page)).toHaveCount(3);
  await expect(page.locator('#map [data-pin="placing"]')).toHaveCount(0);
  // Still placing, for another try; Escape, with the map focused, stops, and the app is told.
  await expect(placingLine(page)).toBeVisible();
  await mapCanvas(page).focus();
  await page.keyboard.press('Escape');
  await expect(placingLine(page)).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { kitScreen: { stopped: boolean[] } }).kitScreen.stopped.length)).toBe(1);
  // A click on the map now places nothing.
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(300);
  expect(await placedOf(page)).toHaveLength(1);
  expect(await unstyledClasses(page)).toEqual([]);
  expect(faults).toEqual([]);
});

test('“Try again” brings the map back once its server answers, and a route that did not come is asked again, both by keyboard', async ({ page }) => {
  await seedPlaces(page);
  const faults: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && !/ERR_CONNECTION_REFUSED|Failed to load resource/.test(message.text())) faults.push(message.text());
  });
  page.on('pageerror', (error) => faults.push(String(error)));
  const server = await mapServer(page, 'down');
  await open(page, `${MAP_PAGE}&route=flaky`);

  await expect(bubble(page)).toHaveAttribute('data-map-status', 'unavailable', { timeout: 30_000 });
  const retry = page.locator('#map [data-part="map-retry"]');
  await expect(retry).toHaveText('Try again');
  // Still down: asked again, and the notice and its button come back.
  await retry.click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { kitScreen: { statuses: string[] } }).kitScreen.statuses.join(' ')), { timeout: 30_000 }).toBe('loading unreachable loading unreachable');
  await expect(bubble(page)).toHaveAttribute('data-map-status', 'unavailable');
  await expect(page.locator('#map [data-part="geo-ranking-row"]')).toHaveCount(3);

  // The server is back. By keyboard.
  server.turn('up');
  await retry.focus();
  await page.keyboard.press('Enter');
  await expect(mapSaid(page)).toHaveText('Trying the map again.');
  await expect(bubble(page)).toHaveAttribute('data-map-status', 'ready', { timeout: 30_000 });
  await expect(page.locator('#map [data-part="map-unavailable"]')).toHaveCount(0);
  await expect(mapCanvas(page)).toBeVisible();
  await expect(pins(page)).toHaveCount(3);
  // The keyboard was not thrown back to the top of the page: the focus is in the map's own box.
  expect(await page.evaluate(() => document.activeElement?.closest('#map') !== null && document.activeElement !== document.body)).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { kitScreen: { statuses: string[] } }).kitScreen.statuses)).toEqual(['loading', 'unreachable', 'loading', 'unreachable', 'loading', 'ready']);

  // The route's first asking failed: said, with the legs unknown and no total that leaves one out.
  const lost = page.locator('#map [data-part="route-unavailable"]');
  await expect(lost).toHaveText('The way between the stops could not be worked out, so the distances are unknown.');
  await expect(page.locator('#map [data-part="geo-row-note"]').first()).toHaveText('distance from the stop before unknown');
  await expect(page.locator('#map [data-part="geo-route-total"]')).toHaveCount(0);
  await page.locator('#map [data-part="route-retry"]').focus();
  await page.keyboard.press('Enter');
  await expect(lost).toHaveCount(0);
  await expect(page.locator('#map [data-part="geo-row-note"]').first()).toHaveText(/^about [\d.,]+ km from the stop before$/);
  // Straight legs: about, no drive time to give, and the whole way since every leg has a length.
  await expect(page.locator('#map [data-part="geo-route-total"]')).toHaveText(/^The whole way: about [\d.,]+ km$/);
  expect(await page.evaluate(() => (window as unknown as { kitScreen: { routes: number[] } }).kitScreen.routes)).toEqual([0, 200]);
  expect(await unstyledClasses(page)).toEqual([]);
  expect(faults).toEqual([]);
});

test('a routing server’s drive time is beside each leg, and the whole way under the list', async ({ page }) => {
  await seedPlaces(page);
  const problems = watch(page);
  await mapServer(page);
  // The routing server is the operator's to switch on; its answer is stood in for here, in the form `POST /geo/route` gives.
  await page.route('**/api/v1/geo/route', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { legs: [{ distanceM: 1_054_000, durationS: 36_840, estimate: false }, { distanceM: 1_421_000, durationS: 50_100, estimate: false }] } }),
    }),
  );
  await openMap(page, '&route=1');
  const notes = page.locator('#map [data-part="geo-row-note"]');
  await expect(notes).toHaveText(['1,054 km from the stop before · 10 hr 14 min drive', '1,421 km from the stop before · 13 hr 55 min drive']);
  await expect(page.locator('#map [data-part="geo-route-total"]')).toHaveText('The whole way: 2,475 km · 24 hr 9 min drive');
  expect(await unstyledClasses(page)).toEqual([]);
  expect(problems).toEqual([]);
});

test('in Arabic, at 390 wide and dark, for somebody who asked for less motion: names, placing and the whole way read right and nothing scrolls sideways', async ({ page }) => {
  await seedPlaces(page);
  await page.setViewportSize({ width: 390, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const problems = watch(page);
  const server = await mapServer(page);
  await openMap(page, '&locale=ar-EG&dir=rtl&theme=dark&areas=1&colour=1&route=1&place=1');
  const words = (JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', '..', 'packages', 'i18n', 'locales', 'ar-EG', 'ui.json'), 'utf8')) as { widgets: { geo: { mapBubble: Record<string, string> } } }).widgets.geo.mapBubble;
  // A sentence of the catalogue as a pattern: its words exactly, anything where it takes a name or a figure.
  const pattern = (text: string): RegExp => {
    const exact = text.split(/\{[a-z]+\}/).map((piece) => piece.replace(/[.*+?^$()|[\]\\]/g, '\\$&'));
    return new RegExp('^' + exact.join('.+') + '$');
  };
  const sideways = async (): Promise<void> => {
    const widths = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, view: document.documentElement.clientWidth }));
    expect(widths.page).toBeLessThanOrEqual(widths.view);
  };
  expect(server.asked).toContain('/styles/dark');
  await sideways();

  // The whole way, in Arabic, under the list (which is under the map at this width).
  await expect(page.locator('#map [data-part="geo-route-total"]')).toHaveText(pattern(words['totalAbout']!));
  // An area's name: light on the dark surface, and each in its own direction whichever way the page reads.
  const west = areaNames(page).nth(1);
  await expect(west).toBeVisible();
  const shade = await west.evaluate((el) => (getComputedStyle(el).color.match(/\d+/g) ?? []).slice(0, 3).map(Number));
  expect(Math.min(...shade)).toBeGreaterThan(180);
  // Less motion: the area the app picks is in view at once, with no flight to wait for.
  await kitMapUpdate(page, { selectedArea: 'north' });
  const north = areaNames(page).first();
  await expect(north).toBeVisible();
  const atOnce = JSON.stringify(await pins(page).evaluateAll((all) => all.map((pin) => Math.round(pin.getBoundingClientRect().x))));
  await page.waitForTimeout(500);
  expect(JSON.stringify(await pins(page).evaluateAll((all) => all.map((pin) => Math.round(pin.getBoundingClientRect().x))))).toBe(atOnce);
  expect(await north.evaluate((el) => getComputedStyle(el).direction)).toBe('ltr');
  expect(await west.evaluate((el) => getComputedStyle(el).direction)).toBe('rtl');
  await sideways();

  // Placing: the line and its buttons are Arabic and run right to left; the cross is there; by keyboard, the button.
  await kitMapUpdate(page, { placing: { id: 'new', label: 'Fourth Wall' } });
  const line = placingLine(page);
  await expect(line.locator('p')).toHaveText(words['placingHint']!.replaceAll('{name}', 'Fourth Wall'));
  expect(await line.evaluate((el) => getComputedStyle(el).direction)).toBe('rtl');
  await expect(page.locator('#map [data-part="map-cross"]')).toBeVisible();
  await expect(line.getByRole('button', { name: words['placingStop']! })).toBeVisible();
  await sideways();
  const middle = line.getByRole('button', { name: words['placeAtMiddle']! });
  await middle.focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => placedOf(page)).toHaveLength(1);
  await expect(mapSaid(page)).toHaveText(pattern(words['saidPlaced']!));
  await expect(pins(page)).toHaveCount(4);
  await expect(line).toHaveCount(0);
  await sideways();
  expect(await page.evaluate(() => window.scrollX)).toBe(0);
  expect(await unstyledClasses(page)).toEqual([]);
  expect(problems).toEqual([]);
});

test('switched off with a list of the app’s own: the notice, no map code, no request, and nothing can be placed', async ({ page }) => {
  await seedPlaces(page);
  const problems = watch(page);
  const server = await mapServer(page);
  const asked: string[] = [];
  const origins = new Set<string>();
  page.on('request', (request) => {
    const url = new URL(request.url());
    origins.add(url.origin);
    if (url.pathname.startsWith('/assets/')) asked.push(url.pathname);
  });
  await open(page, `${MAP_PAGE}&maps=off&own=1&place=1&areas=1&colour=1`);

  await expect(bubble(page)).toHaveAttribute('data-map-status', 'off');
  await expect(page.locator('#map [data-part="map-off"]')).toContainText('Maps are switched off. Here is the list.');
  // The list is the app's, whole without a map; the map's own stays out.
  await expect(page.locator('#own-list button[data-row]')).toHaveCount(3);
  await expect(page.locator('#map [data-part="geo-ranking"]')).toHaveCount(0);
  await expect(page.locator('body')).toHaveAttribute('data-map-status', 'off');
  // A row still picks, and the app is the one that marks it. No link out: the operator said no outside map.
  await ownRow(page, 'Second Wind').click();
  await expect(ownRow(page, 'Second Wind')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#map [data-part="geo-picked-link"]')).toHaveCount(0);
  // Placing needs a map: asked for, there is no line, no cross and nothing to click.
  await ownRow(page, 'Place Fourth Wall').click();
  await expect(placingLine(page)).toHaveCount(0);
  await expect(page.locator('#map [data-part="map-cross"]')).toHaveCount(0);

  await page.waitForTimeout(1_000);
  expect(server.asked).toEqual([]);
  expect([...origins]).toEqual([new URL(page.url()).origin]);
  expect(asked.some((path) => /maplibre|map-engine/.test(path))).toBe(false);
  expect(await placedOf(page)).toEqual([]);
  expect(await unstyledClasses(page)).toEqual([]);
  expect(problems).toEqual([]);
});

/* ------------------------------------------------------------ the import */

const IMPORT_PAGE = '?part=import';
const REP = { email: 'e2e-kit-rep@adminium.local', name: 'Kit Rep', password: 'adminium-e2e-kit-rep' };
const PASTED = ['Name,Code,City', 'Harbour Cafe,HC-1,Kiel', 'Second Wind,SW-2,Lyon', 'Third Coast,TC-3,Rome'];

/** The rep: somebody whose one role opens this app's screens and nothing of the dashboard. Made and signed in once, when the first test needs them. */
let rep: { id: string; cookies: Awaited<ReturnType<BrowserContext['cookies']>>; roles: Record<'rep' | 'looker', string> } | undefined;

/**
 * Invited by the administrator with the app's `rep` role, activated through
 * the reset route, and signed in ONCE; every test then starts from that
 * session. The sign-in is one of the five a minute this server takes from an
 * address, and a run of this file alone meets the setup project's in the same
 * minute: a refusal is waited out once, never worked round.
 */
async function repOf(browser: Browser, admin: Page): Promise<NonNullable<typeof rep>> {
  if (rep !== undefined) return rep;
  test.setTimeout(180_000);
  const all = ((await (await admin.request.get('/api/v1/roles')).json()) as { roles: { id: string; slug: string }[] }).roles;
  const roles = { rep: all.find((role) => role.slug === `${KEY}-rep`)!.id, looker: all.find((role) => role.slug === `${KEY}-looker`)!.id };
  const users = (await (await admin.request.get('/api/v1/users?q=e2e-kit-rep')).json()) as { users?: { id: string; email: string }[] };
  for (const user of users.users ?? []) if (user.email === REP.email) await admin.request.delete(`/api/v1/users/${user.id}`);
  const invited = await admin.request.post('/api/v1/users', { data: { email: REP.email, name: REP.name, roleIds: [roles.rep] } });
  expect(invited.status(), await invited.text()).toBe(201);
  const { invite, user } = (await invited.json()) as { invite: { token: string }; user: { id: string } };
  const context = await browser.newContext({ baseURL: BASE_URL, storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  const activated = await page.request.post('/api/v1/auth/password/reset', { data: { token: invite.token, newPassword: REP.password } });
  expect(activated.ok(), await activated.text()).toBe(true);
  await page.goto('/login');
  const signIn = (): Promise<number> =>
    page.evaluate(
      async ([email, password]) => (await fetch('/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) })).status,
      [REP.email, REP.password] as const,
    );
  let status = await signIn();
  if (status === 429) {
    await page.waitForTimeout(61_000);
    status = await signIn();
  }
  expect(status, 'the rep signs in').toBe(200);
  rep = { id: user.id, cookies: await context.cookies(), roles };
  await context.close();
  return rep;
}

/** A page of the rep's own, on their session. */
async function repPage(browser: Browser, admin: Page): Promise<{ page: Page; close: () => Promise<void>; person: NonNullable<typeof rep> }> {
  const person = await repOf(browser, admin);
  const context = await browser.newContext({ baseURL: BASE_URL, storageState: { cookies: person.cookies, origins: [] } });
  return { page: await context.newPage(), close: () => context.close(), person };
}

/** The companies table as a test begins: empty, or holding the rows given. Through the data API, as the administrator. */
async function seedCompanies(admin: Page, rows: { name: string; code: string; city: string }[] = []): Promise<void> {
  const table = `/api/v1/data/${await connectionOf(admin)}/e2e_kit_companies`;
  const listed = (await (await admin.request.get(`${table}?limit=200`)).json()) as { data: { id: number }[] };
  for (const row of listed.data) expect((await admin.request.delete(`${table}/${String(row.id)}`)).ok()).toBe(true);
  for (const values of rows) expect((await admin.request.post(table, { data: { values } })).ok()).toBe(true);
}

async function companies(admin: Page): Promise<{ name: string; code: string; city: string }[]> {
  const { data } = (await (await admin.request.get(`/api/v1/data/${await connectionOf(admin)}/e2e_kit_companies?limit=200&order=id.asc`)).json()) as { data: { name: string; code: string; city: string }[] };
  return data.map(({ name, code, city }) => ({ name, code, city }));
}

const wizard = (page: Page) => page.locator('#import');
const lines = (page: Page): Promise<string[]> =>
  wizard(page)
    .locator('[data-testid="import-preview"] [data-line]')
    .evaluateAll((all) => all.map((line) => `${line.getAttribute('data-status') ?? ''} ${line.querySelector('[data-part="line-label"]')?.textContent ?? ''}`));

/** Pastes the three rows and walks to the preview, with the mouse. */
async function pasteAndLook(page: Page): Promise<void> {
  await wizard(page).getByRole('textbox').fill(PASTED.join('\n'));
  await wizard(page).getByTestId('import-paste-use').click();
  await wizard(page).getByTestId('wizard-validate').click();
  await expect(wizard(page).getByTestId('validation-summary')).toBeVisible();
}

test('somebody whose role opens only the app’s screens pastes three rows: looked at, run, in the table; pasted again, nothing is brought in', async ({ page: admin, browser }) => {
  await seedCompanies(admin, [{ name: 'Second Wind (as it was)', code: 'SW-2', city: 'Paris' }]);
  const { page, close } = await repPage(browser, admin);
  const problems = watch(page);
  const asked: string[] = [];
  const doors: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/assets/')) asked.push(url.pathname);
    if (url.pathname.startsWith('/api/')) doors.push(`${request.method()} ${url.pathname}`);
  });
  await open(page, IMPORT_PAGE);

  // The person has no dashboard: this Adminium sends them back to their app when they ask for it.
  // And the part asked for nothing of it: no session's bootstrap, no list of connections, no page.
  expect(doors.filter((door) => /\/api\/v1\/(bootstrap|connections|pages|schema)/.test(door))).toEqual([]);
  expect(doors.filter((door) => /\/api\/v1\/(imports|jobs)/.test(door))).toEqual([]);
  // Its own files, the wizard's and the two sheets; not the dashboard's entry, and so not its translator.
  expect(asked.filter((path) => /^\/assets\/kit\/import-[\w-]+\.js$/.test(path))).toHaveLength(1);
  expect(asked.filter((path) => /^\/assets\/ImportWizard-[\w-]+\.js$/.test(path))).toHaveLength(1);
  expect(asked.filter((path) => path.endsWith('.css')).sort()).toEqual([expect.stringMatching(/^\/assets\/kit\/import-/), expect.stringMatching(/^\/assets\/kit\/root-/)]);
  expect(asked.some((path) => /board-|KanbanBoard-|maplibre|mentions-/.test(path))).toBe(false);
  const entry = /<script[^>]+src="(\/assets\/index-[\w-]+\.js)"/.exec(await (await admin.request.get('/')).text())?.[1];
  expect(entry).toBeTruthy();
  expect(asked).not.toContain(entry);
  for (const path of asked.filter((one) => one.endsWith('.js'))) expect((await (await admin.request.get(path)).text()).includes('i18next:'), path).toBe(false);

  const part = page.locator('#import > .adm-kit');
  await expect(part).toHaveAttribute('data-kit-part', 'import');
  await expect(page.getByRole('group', { name: 'Paste a list' })).toBeVisible();
  // One table: nobody is asked which. The four steps, and the first is the one in hand.
  await expect(wizard(page).getByTestId('import-target')).toHaveCount(0);
  await expect(wizard(page).getByText('Map columns')).toBeVisible();
  await expect(wizard(page).getByText('Drop a CSV file to import')).toBeVisible();
  expect(await unstyledClasses(page)).toEqual([]);
  // The look is the kit's: the paste box has its border and its corners, in the app's own typeface.
  const box = wizard(page).getByRole('textbox');
  expect(await box.evaluate((el) => getComputedStyle(el).borderTopWidth + ' ' + getComputedStyle(el).borderTopStyle)).toBe('1px solid');
  expect(await box.evaluate((el) => getComputedStyle(el).fontFamily)).toContain('Georgia');
  expect(await page.locator('#own-classes').evaluate((el) => [getComputedStyle(el).display, getComputedStyle(el).position, getComputedStyle(el).borderTopWidth].join(' '))).toBe('block static 0px');

  await box.fill(PASTED.join('\n'));
  await wizard(page).getByTestId('import-paste-use').click();
  // The columns are matched by their names to the columns the app named, and lines are matched on the one no two rows share.
  await expect.poll(() => wizard(page).locator('[data-part="mapping-row"] [data-part="mapping-target"]').evaluateAll((all) => all.map((select) => (select as HTMLSelectElement).value))).toEqual(['name', 'code', 'city']);
  const match = wizard(page).getByTestId('import-match-on');
  await expect(match).toHaveValue('code');
  expect(await match.locator('option').allTextContents()).toEqual(['Nothing: every line is new', 'Code']);
  // The app allows this person one thing for a line already here, so they are not asked.
  await expect(wizard(page).getByTestId('import-when-here')).toHaveCount(0);
  expect(await unstyledClasses(page)).toEqual([]);
  await wizard(page).getByTestId('wizard-validate').click();

  // Looked at before anything is written.
  await expect(wizard(page).getByTestId('validation-summary')).toHaveText('2 new lines will be brought in.');
  await expect(wizard(page).getByTestId('validation-rest')).toHaveText('1 already here will be left as they are');
  expect(await lines(page)).toEqual(['new HC-1', 'here SW-2', 'new TC-3']);
  expect(await unstyledClasses(page)).toEqual([]);
  expect(await companies(admin)).toHaveLength(1);
  await expect(wizard(page).getByTestId('wizard-run')).toHaveText('Bring in 2 new lines');
  await wizard(page).getByTestId('wizard-run').click();

  const review = wizard(page).getByTestId('import-review');
  await expect(review).toBeVisible({ timeout: 30_000 });
  expect(await review.locator('.font-mono').allTextContents()).toEqual(['3', '2', '0', '1']);
  await expect(page.locator('body')).toHaveAttribute('data-done', JSON.stringify({ created: 2, updated: 0, skipped: 1, failed: 0 }));
  expect(await unstyledClasses(page)).toEqual([]);
  // In the table: the two new rows as pasted, and the one that was here exactly as it was.
  expect(await companies(admin)).toEqual([
    { name: 'Second Wind (as it was)', code: 'SW-2', city: 'Paris' },
    { name: 'Harbour Cafe', code: 'HC-1', city: 'Kiel' },
    { name: 'Third Coast', code: 'TC-3', city: 'Rome' },
  ]);
  // Every door the part used was an import's or the job's, and each change carried the app's token (the server took them).
  expect([...new Set(doors.map((door) => door.replace(/imp_[^/]+|job_[^/]+|\/[0-9A-Za-z_-]{16,}/g, ':id')))].every((door) => /^(GET|POST) \/api\/v1\/(imports|jobs)/.test(door))).toBe(true);
  await wizard(page).getByTestId('wizard-close').click();
  await expect(page.locator('body')).toHaveAttribute('data-closed', 'yes');

  // The same list a second time: every line is already here, nothing would be brought in, and nothing is.
  await open(page, IMPORT_PAGE);
  await pasteAndLook(page);
  expect(await lines(page)).toEqual(['here HC-1', 'here SW-2', 'here TC-3']);
  await expect(wizard(page).getByTestId('import-nothing')).toHaveText('Nothing here would be brought in.');
  await expect(wizard(page).getByTestId('wizard-run')).toBeDisabled();
  expect(await companies(admin)).toHaveLength(3);
  expect(problems).toEqual([]);
  await close();
});

test('the whole import by keyboard alone, from the paste to the close', async ({ page: admin, browser }) => {
  await seedCompanies(admin);
  const { page, close } = await repPage(browser, admin);
  const problems = watch(page);
  await open(page, IMPORT_PAGE);

  /** Tab, until the thing with this test id has the focus. */
  const tabTo = async (id: string): Promise<void> => {
    for (let presses = 0; presses < 40; presses += 1) {
      if (await page.evaluate((wanted) => document.activeElement?.getAttribute('data-testid') === wanted || document.activeElement?.closest(`[data-testid="${wanted}"]`) !== null, id)) return;
      await page.keyboard.press('Tab');
    }
    throw new Error(`Tab never reached ${id}`);
  };

  await tabTo('import-paste');
  await expect(wizard(page).getByRole('textbox')).toBeFocused();
  for (const [index, row] of PASTED.entries()) {
    if (index > 0) await page.keyboard.press('Enter');
    await page.keyboard.type(row);
  }
  await tabTo('import-paste-use');
  await page.keyboard.press('Enter');
  await expect(wizard(page).getByTestId('wizard-validate')).toBeVisible();
  // The City column is taken out of the import with the keyboard: its picker, then "Don't import".
  await tabTo('import-match-on');
  await page.keyboard.press('Shift+Tab');
  await expect(wizard(page).locator('[data-part="mapping-target"]').nth(2)).toBeFocused();
  await wizard(page).locator('[data-part="mapping-target"]').nth(2).selectOption('__skip__');
  await tabTo('wizard-validate');
  await page.keyboard.press('Enter');
  await expect(wizard(page).getByTestId('validation-summary')).toHaveText('3 new lines will be brought in.');
  await tabTo('wizard-run');
  await page.keyboard.press('Enter');
  await expect(wizard(page).getByTestId('import-review')).toBeVisible({ timeout: 30_000 });
  await expect(wizard(page).getByTestId('wizard-close')).toBeVisible();
  await tabTo('wizard-close');
  await page.keyboard.press('Enter');
  await expect(page.locator('body')).toHaveAttribute('data-closed', 'yes');
  expect(await companies(admin)).toEqual([
    { name: 'Harbour Cafe', code: 'HC-1', city: null },
    { name: 'Second Wind', code: 'SW-2', city: null },
    { name: 'Third Coast', code: 'TC-3', city: null },
  ]);
  expect(problems).toEqual([]);
  await close();
});

test('what the person’s role does not let them do is said in words, and the server refuses the same call made directly', async ({ page: admin, browser }) => {
  await seedCompanies(admin, [{ name: 'Second Wind', code: 'SW-2', city: 'Lyon' }]);
  const { page, close, person } = await repPage(browser, admin);
  const faults: string[] = [];
  page.on('console', (message) => {
    // The browser itself logs a 403; anything else is a fault.
    if (message.type() === 'error' && !/403/.test(message.text())) faults.push(message.text());
  });
  page.on('pageerror', (error) => faults.push(String(error)));
  const setRoles = async (roleIds: string[]): Promise<void> => {
    const put = await admin.request.put(`/api/v1/users/${person.id}/roles`, { data: { roleIds } });
    expect(put.ok(), await put.text()).toBe(true);
  };
  const config = async (): Promise<{ connectionId: string; tables: Record<string, string> }> => (await (await page.request.get(`${STAFF}surface-config.json`)).json()) as { connectionId: string; tables: Record<string, string> };
  /** The same import, made by a direct call as this person, with the file they uploaded. */
  const direct = async (options: Record<string, unknown>): Promise<{ status: number; code?: string; permission?: string }> => {
    const { connectionId, tables } = await config();
    const upload = await page.request.post('/api/v1/imports/upload?filename=direct.csv', { headers: { 'content-type': 'text/csv' }, data: PASTED.join('\n') });
    expect(upload.ok(), await upload.text()).toBe(true);
    const { fileId } = ((await upload.json()) as { data: { fileId: string } }).data;
    const made = await page.request.post('/api/v1/imports', {
      data: { fileId, connectionId, table: tables['companies'], mapping: { columns: [{ from: 'Name', to: 'name' }, { from: 'Code', to: 'code' }, { from: 'City', to: 'city' }] }, options },
    });
    const body = (await made.json().catch(() => ({}))) as { error?: { code?: string; details?: { permission?: string } } };
    return { status: made.status(), ...(body.error?.code === undefined ? {} : { code: body.error.code }), ...(body.error?.details?.permission === undefined ? {} : { permission: body.error.details.permission.split(':').pop()! }) };
  };

  try {
    // The rep may bring companies in and may not change one: asked to update the lines already here, the server says no.
    await open(page, `${IMPORT_PAGE}&modes=update,skip`);
    await wizard(page).getByRole('textbox').fill(PASTED.join('\n'));
    await wizard(page).getByTestId('import-paste-use').click();
    await expect(wizard(page).getByTestId('import-when-here')).toHaveValue('upsert');
    await wizard(page).getByTestId('wizard-validate').click();
    const refusal = wizard(page).getByText('You do not hold the right to change rows of Companies.');
    await expect(refusal).toBeVisible();
    await expect(refusal).toContainText('Leave the lines already here as they are, or ask an administrator for it.');
    expect(await unstyledClasses(page)).toEqual([]);
    // Drawn as a refusal: the kit's red at its edge, on a page that has no such colour of its own.
    expect(await refusal.evaluate((el) => getComputedStyle(el.closest('[data-tone]')!).borderTopColor)).toBe('color(srgb 0.811765 0.152941 0.235294 / 0.3)');
    expect(await direct({ mode: 'upsert', matchColumn: 'code', skipInvalid: true })).toEqual({ status: 403, code: 'TABLE_FORBIDDEN', permission: 'update' });
    // Still on the step, and the other choice goes through: the person is not stuck.
    await wizard(page).getByTestId('import-when-here').selectOption('skip');
    await wizard(page).getByTestId('wizard-validate').click();
    await expect(wizard(page).getByTestId('validation-summary')).toHaveText('2 new lines will be brought in.');

    // Now somebody who may only read companies: the import itself is refused, by the table's name.
    await setRoles([person.roles.looker]);
    await open(page, IMPORT_PAGE);
    await wizard(page).getByRole('textbox').fill(PASTED.join('\n'));
    await wizard(page).getByTestId('import-paste-use').click();
    await wizard(page).getByTestId('wizard-validate').click();
    await expect(wizard(page).getByText('You do not hold the right to import into Companies. Ask an administrator for it.')).toBeVisible();
    await expect(wizard(page).getByTestId('wizard-validate')).toBeEnabled();
    expect(await direct({ mode: 'skip', matchColumn: 'code', skipInvalid: true })).toEqual({ status: 403, code: 'TABLE_FORBIDDEN', permission: 'import' });
    // Nothing was written by any of it.
    expect(await companies(admin)).toEqual([{ name: 'Second Wind', code: 'SW-2', city: 'Lyon' }]);
    expect(faults).toEqual([]);
  } finally {
    await setRoles([person.roles.rep]);
    await close();
  }
});

test('in Arabic the wizard runs right to left and speaks Arabic, plurals and all', async ({ page: admin, browser }) => {
  await seedCompanies(admin, [{ name: 'Second Wind', code: 'SW-2', city: 'Lyon' }]);
  const { page, close } = await repPage(browser, admin);
  const problems = watch(page);
  const asked: string[] = [];
  page.on('request', (request) => asked.push(new URL(request.url()).pathname));
  await open(page, `${IMPORT_PAGE}&locale=ar-EG&dir=rtl`);
  const words = (JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', '..', 'packages', 'i18n', 'locales', 'ar-EG', 'dataio.json'), 'utf8')) as { import: Record<string, string> }).import;

  const wrapper = page.locator('#import > .adm-kit');
  await expect(wrapper).toHaveAttribute('dir', 'rtl');
  await expect(wrapper).toHaveAttribute('lang', 'ar-EG');
  expect(asked.some((path) => /^\/assets\/kit\/ar-EG-[\w-]+\.js$/.test(path))).toBe(true);
  expect(asked.some((path) => /^\/assets\/kit\/en-US-/.test(path))).toBe(false);
  // The steps read from the right: the first is the rightmost.
  const [first, second] = await Promise.all([wizard(page).getByText(words['stepUpload']!, { exact: true }).boundingBox(), wizard(page).getByText(words['stepMap']!, { exact: true }).boundingBox()]);
  expect(first!.x).toBeGreaterThan(second!.x);
  expect(await wizard(page).getByRole('textbox').evaluate((el) => getComputedStyle(el).direction)).toBe('rtl');
  expect(await page.locator('#own-classes').evaluate((el) => getComputedStyle(el).direction)).toBe('ltr');
  await expect(wizard(page).getByTestId('import-paste-use')).toHaveText(words['pasteUse']!);

  await wizard(page).getByRole('textbox').fill(PASTED.join('\n'));
  await wizard(page).getByTestId('import-paste-use').click();
  await wizard(page).getByTestId('wizard-validate').click();
  await expect(wizard(page).getByTestId('validation-summary')).toBeVisible();
  // Two new lines: Arabic's own form for two, with no brace left in anything the part says.
  const summary = (await wizard(page).getByTestId('validation-summary').textContent()) ?? '';
  expect(summary).toMatch(/[؀-ۿ]/);
  expect((await wizard(page).textContent()) ?? '').not.toMatch(/[{}]/);
  await expect(wizard(page).locator('[data-testid="import-preview"] [data-count="here"]')).toContainText(words['previewHere']!);
  expect(await unstyledClasses(page)).toEqual([]);
  expect(problems).toEqual([]);
  await close();
});

test('at 390 wide and dark, no step of the wizard makes the page scroll sideways', async ({ page: admin, browser }) => {
  await seedCompanies(admin);
  const { page, close } = await repPage(browser, admin);
  await page.setViewportSize({ width: 390, height: 800 });
  const problems = watch(page);
  await open(page, `${IMPORT_PAGE}&theme=dark`);
  const fits = async (step: string): Promise<void> => {
    const widths = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, view: document.documentElement.clientWidth, left: window.scrollX }));
    expect(widths.page, step).toBeLessThanOrEqual(widths.view);
    expect(widths.left, step).toBe(0);
    expect(await unstyledClasses(page), step).toEqual([]);
  };

  await expect(page.locator('#import > .adm-kit')).toHaveAttribute('data-kit-theme', 'dark');
  const box = wizard(page).getByRole('textbox');
  expect((await box.boundingBox())!.width).toBeLessThanOrEqual(390);
  expect(await box.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(244, 244, 246)');
  await fits('upload');
  await box.fill(PASTED.join('\n'));
  await wizard(page).getByTestId('import-paste-use').click();
  await expect(wizard(page).getByTestId('wizard-validate')).toBeVisible();
  // The mapping's three columns are wider than the screen: they scroll inside their own box.
  const table = (await wizard(page).locator('[data-widget="column-mapping-table"]').boundingBox())!;
  expect(table.x).toBeGreaterThanOrEqual(0);
  expect(table.x + table.width).toBeLessThanOrEqual(390);
  await fits('map');
  await wizard(page).getByTestId('wizard-validate').click();
  await expect(wizard(page).getByTestId('validation-summary')).toBeVisible();
  await fits('validate');
  await wizard(page).getByTestId('wizard-run').click();
  await expect(wizard(page).getByTestId('import-review')).toBeVisible({ timeout: 30_000 });
  await fits('review');
  expect(await companies(admin)).toHaveLength(3);
  expect(problems).toEqual([]);
  await close();
});

/* ------------------------------------------------------- the e-mail consent */

/**
 * The record's consent, as the server answers it, with `declared` set: an app
 * that declares a people table needs Adminium 0.3.38, which this server
 * (0.3.37) refuses to install. Every other word of the reply, and every
 * write, is the server's own.
 */
async function declared(page: Page): Promise<void> {
  await page.route('**/api/v1/consent/panel', async (route) => {
    const answer = await route.fetch();
    const body = (await answer.json()) as { data?: Record<string, unknown> };
    await route.fulfill({ response: answer, json: body.data === undefined ? body : { data: { ...body.data, declared: true } } });
  });
}

async function companyId(admin: Page, name: string): Promise<string> {
  const { data } = (await (await admin.request.get(`/api/v1/data/${await connectionOf(admin)}/e2e_kit_companies?limit=200`)).json()) as { data: { id: number; name: string }[] };
  return String(data.find((row) => row.name === name)!.id);
}

const consentPart = (page: Page) => page.locator('#consent');

test('a plain contact page mounts the e-mail consent panel; Replied and Record consent open inside it and write through the server', async ({ page }) => {
  await signIn(page);
  await seedCompanies(page, [{ name: 'Harbour Cafe', code: 'HC-1', city: 'Kiel' }]);
  const id = await companyId(page, 'Harbour Cafe');
  await declared(page);
  const problems = watch(page);
  const asked: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/assets/')) asked.push(url.pathname);
  });
  await open(page, `?part=consent&id=${id}&name=Harbour%20Cafe`);
  await expect(consentPart(page).locator('> .adm-kit')).toHaveAttribute('data-kit-part', 'consent');
  const panel = consentPart(page).getByTestId('consent-panel');
  await expect(panel.getByRole('heading', { name: 'E-mail consent' })).toBeVisible();
  // Its own files and two sheets: not the dashboard's entry, and nothing of the house's dialogs.
  expect(asked.filter((path) => /^\/assets\/kit\/consent-[\w-]+\.js$/.test(path))).toHaveLength(1);
  expect(asked.filter((path) => path.endsWith('.css')).sort()).toEqual([expect.stringMatching(/^\/assets\/kit\/consent-/), expect.stringMatching(/^\/assets\/kit\/root-/)]);
  const entry = /<script[^>]+src="(\/assets\/index-[\w-]+\.js)"/.exec(await (await page.request.get('/')).text())?.[1];
  expect(asked).not.toContain(entry);
  expect(await unstyledClasses(page)).toEqual([]);

  // "Replied": asked inside the panel, Cancel first.
  await panel.getByTestId('consent-replied').click();
  const step = consentPart(page).getByRole('group', { name: 'Mark as replied?' });
  await expect(step).toContainText('This stops their e-mail sequences.');
  await expect(step.getByRole('button', { name: 'Cancel' })).toBeFocused();
  expect(await unstyledClasses(page)).toEqual([]);
  await step.getByRole('button', { name: 'Mark as replied' }).click();
  await expect(panel.getByTestId('consent-history')).toContainText('Replied — e-mail sequences stopped');
  await expect(panel.getByRole('status')).toHaveText('Marked as replied. Their e-mail sequences stop.');
  await expect(page.locator('body')).toHaveAttribute('data-changes', '1');

  // "Record consent": the form inside the panel, worked by the keyboard.
  await panel.getByTestId('consent-record').click();
  const form = consentPart(page).getByRole('group', { name: 'Record consent' });
  await expect(form.getByRole('radio', { name: 'Newsletter' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(form.getByRole('radio', { name: 'Surveys' })).toHaveAttribute('aria-checked', 'true');
  await form.getByRole('radio', { name: 'By phone' }).click();
  await form.getByTestId('consent-dialog-note').fill('Rang the café');
  expect(await unstyledClasses(page)).toEqual([]);
  await form.getByTestId('consent-dialog-save').click();
  await expect(panel.getByTestId('consent-badge-surveys')).toHaveText('May be e-mailed');
  await expect(panel.getByTestId('consent-history')).toContainText('Agreed by phone, recorded by');
  await expect(page.locator('body')).toHaveAttribute('data-changes', '2');
  // Escape closes a step and writes nothing.
  await panel.getByTestId('consent-record').click();
  await page.keyboard.press('Escape');
  await expect(consentPart(page).getByRole('group', { name: 'Record consent' })).toHaveCount(0);
  await expect(page.locator('body')).toHaveAttribute('data-changes', '2');
  expect(problems).toEqual([]);
});

test('somebody whose role opens only the app’s screens reads a contact’s consent; in Arabic at 390 wide it runs right to left and nothing scrolls sideways', async ({ page: admin, browser }) => {
  await signIn(admin);
  const id = await companyId(admin, 'Harbour Cafe');
  const { page, close } = await repPage(browser, admin);
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await declared(page);
    const problems = watch(page);
    await open(page, `?part=consent&id=${id}&locale=ar-EG&dir=rtl`);
    const panel = consentPart(page).getByTestId('consent-panel');
    // Read through the server's door for a screens-only person: the panel, and no button (the rep may not change a company).
    await expect(panel.getByRole('heading', { name: 'موافقة البريد الإلكتروني' })).toBeVisible();
    await expect(panel.getByTestId('consent-history')).toContainText('تمّ الردّ');
    await expect(panel.getByTestId('consent-replied')).toHaveCount(0);
    await expect(consentPart(page).locator('> .adm-kit')).toHaveAttribute('dir', 'rtl');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await unstyledClasses(page)).toEqual([]);
    expect(problems).toEqual([]);
  } finally {
    await close();
  }
});
