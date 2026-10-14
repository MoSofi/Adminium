// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The signature pad and the photo field on an app's own screen: a crew's
 * phone signing a job off.
 *
 * What only a browser and a real server can show: a plain page (no React of
 * its own) mounts both parts as somebody whose role opens ONLY this app's
 * screens; a signature drawn with the mouse and two photos are sent for their
 * columns with that person's session, and one create with a retry key names
 * them; the server keeps the files with the sign-off, a picture without its
 * camera notes. The same walk by keyboard alone (the name typed for a
 * signature). A refused sign-off throws its uploads away; a sign-off sent
 * again under its key answers the first; another sign-off naming the first's
 * signature is refused. Arabic runs right to left, at 390 wide and dark, and
 * the page never scrolls sideways.
 *
 * The file columns are the operator's own column rule here (`column.file`,
 * set through the schema overrides, as Studio sets one): the same rule an
 * app's manifest installs, which this server's version reads as an override
 * before it reads it in a manifest.
 */
import { deflateSync } from 'node:zlib';

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { bundleOf } from './appBundle.js';
import { BASE_URL } from './constants.js';
import { seededConnectionId, signIn } from './helpers.js';

const KEY = 'e2e-kit-files';
const VERSION = '1.0.0';
const STAFF = `/apps/${KEY}/staff/`;
const TABLE = 'e2e_kit_files_sign_offs';
const FITTER = { email: 'e2e-kit-fitter@adminium.local', name: 'Kit Fitter', password: 'adminium-e2e-kit-fitter' };

const MANIFEST = {
  kind: 'app',
  manifestVersion: 1,
  key: KEY,
  name: 'E2E Kit Files',
  version: VERSION,
  publisher: { id: 'adminium', name: 'Adminium' },
  license: 'AGPL-3.0-only',
  description: { key: 'mft.e2e-kit-files.desc', fallback: 'A crew phone that signs a job off.' },
  categories: ['operations'],
  compatibility: { minAdminiumVersion: '0.3.26' },
  // Somebody who opens this app's screens and nothing of the dashboard: reads and makes sign-offs.
  roles: [{ key: 'fitter', name: 'Fitter', screensOnly: true, permissions: ['table:@sign_offs:read', 'table:@sign_offs:create', 'app:@:staff'] }],
  requiredSchema: {
    prefixed: true,
    tables: [
      {
        ref: 'sign_offs',
        columns: [
          { ref: 'id', type: 'int', role: 'pk' },
          { ref: 'job', type: 'text', maxLength: 80 },
          { ref: 'signer_name', type: 'text', maxLength: 120 },
          { ref: 'signature', type: 'text', maxLength: 64, nullable: true },
          { ref: 'photos', type: 'json', nullable: true },
          { ref: 'retry_key', type: 'text', maxLength: 64, nullable: true, unique: true, rules: { retryKey: true } },
        ],
      },
    ],
  },
  pages: [{ ref: 'e2e-kit-files-sign-offs', template: 'page-crud', title: { key: 'mft.e2e-kit-files.signoffs', fallback: 'Kit sign-offs' }, nav: { group: 'library', icon: 'list', order: 13 }, bindings: { rows: 'sign_offs' } }],
  frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { home: '/' } }],
};

const PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Sign off</title>
    <link rel="stylesheet" href="./screen.css" />
  </head>
  <body>
    <h1>Sign off the job</h1>
    <div id="signature"></div>
    <div id="photos"></div>
    <label for="signer">Signed by</label>
    <input id="signer" autocomplete="off" />
    <button id="sign-off" type="button">Sign off</button>
    <p id="said" role="status"></p>
    <p id="failed"></p>
    <script type="module" src="./screen.js"></script>
  </body>
</html>`;

const SHEET = `body { font-family: Georgia, serif; margin: 16px; }
body[data-theme="dark"] { background: #0a0a0d; color: #f4f4f6; color-scheme: dark; }
#signer { display: block; margin: 12px 0; }`;

/**
 * The phone's screen, as an app with no framework writes it: the two parts
 * for the sign-off's columns, and one create with a retry key that names what
 * they kept. A refused create throws its uploads away.
 */
const SCREEN = `try {
  const config = await (await fetch('surface-config.json', { credentials: 'same-origin' })).json();
  const asked = new URLSearchParams(location.search);
  const kit = await import(config.kit.entry);
  const theme = asked.get('theme');
  if (theme !== null) document.body.dataset.theme = theme;
  const locale = asked.get('locale') ?? config.locale;
  const dir = asked.get('dir') ?? config.dir;
  document.documentElement.dir = dir;
  const target = { connectionId: config.connectionId, table: config.tables.sign_offs, csrfToken: config.csrfToken, locale, dir, ...(theme === null ? {} : { theme }) };
  const state = { signature: null, photos: [], busy: false, results: [], discarded: [] };
  const pad = await kit.mount('signature', document.querySelector('#signature'), { ...target, column: 'signature', label: asked.get('label') ?? 'Customer signature', onChange: (id) => { state.signature = id; } });
  const field = await kit.mount('photos', document.querySelector('#photos'), { ...target, column: 'photos', label: 'Photos of the job', max: 3, onChange: (ids) => { state.photos = ids; }, onBusy: (busy) => { state.busy = busy; } });
  const rows = '/api/v1/data/' + config.connectionId + '/' + config.tables.sign_offs;
  const headers = { 'content-type': 'application/json', 'x-adminium-csrf': config.csrfToken };
  async function signOff() {
    const signer = document.querySelector('#signer').value;
    const key = 'sign-off-' + crypto.randomUUID();
    const values = { job: 'Kitchen at 14 Elm Row', signature: state.signature, photos: state.photos, ...(signer === '' ? {} : { signer_name: signer }) };
    const reply = await fetch(rows, { method: 'POST', credentials: 'same-origin', headers, body: JSON.stringify({ values, clientKey: key }) });
    const body = await reply.json().catch(() => ({}));
    state.results.push({ status: reply.status, body, key, values });
    if (reply.ok) {
      pad.update({ value: state.signature });
      field.update({ value: state.photos });
      document.querySelector('#said').textContent = 'Signed off.';
      return;
    }
    // Refused, and given up: the uploads go. (Kept, they could be named again on another try.)
    for (const id of [state.signature, ...state.photos].filter(Boolean)) {
      const gone = await fetch('/api/v1/files/' + id, { method: 'DELETE', credentials: 'same-origin', headers: { 'x-adminium-csrf': config.csrfToken } });
      state.discarded.push({ id, status: gone.status });
    }
    document.querySelector('#said').textContent = 'Not signed off.';
  }
  document.querySelector('#sign-off').addEventListener('click', () => void signOff());
  window.kitScreen = { config, kit, pad, field, state };
  document.body.dataset.kit = 'ready';
} catch (error) {
  document.querySelector('#failed').textContent = String(error);
  document.body.dataset.kit = 'failed';
}`;

/** A real PNG (a decoder draws it) with a comment that says where it was taken, and an Exif block. */
function photo(fill: number): Buffer {
  const crc = (bytes: Buffer): number => {
    let c = 0xffffffff;
    for (const byte of bytes) {
      c ^= byte;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    }
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const head = Buffer.from(type, 'latin1');
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(Buffer.concat([head, data])));
    return Buffer.concat([length, head, data, sum]);
  };
  const size = 24;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const rows = Buffer.concat(Array.from({ length: size }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3, fill)])));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('tEXt', Buffer.from('Comment\0GPS 51.5074 N, taken at 14 Elm Row', 'latin1')),
    chunk('eXIf', Buffer.from('MM\0*GPSLatitude 51.5074 N', 'latin1')),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

type Override = { op: string; tableName: string; columnName?: string; value: unknown; status?: string };

let connectionId = '';
let tableId = '';
let kept: Override[] = [];
let fitter: { id: string; cookies: Awaited<ReturnType<BrowserContext['cookies']>> } | undefined;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  const page = await browser.newPage();
  await signIn(page);
  connectionId = await seededConnectionId(page);
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

  // The two file columns, as the operator's own rule: a PNG signature of 512 KiB at most, three pictures of 8 MiB.
  const schema = (await (await page.request.get(`/api/v1/connections/${connectionId}/schema`)).json()) as { tables?: { id: string; name: string }[]; model?: { tables: { id: string; name: string }[] }; data?: { tables: { id: string; name: string }[] } };
  tableId = (schema.tables ?? schema.model?.tables ?? schema.data?.tables ?? []).find((table) => table.name === TABLE)!.id;
  const held = (await (await page.request.get(`/api/v1/connections/${connectionId}/overrides`)).json()) as { overrides: (Override & { columnName: string | null })[] };
  kept = held.overrides.map((one) => ({ op: one.op, tableName: one.tableName, ...(one.columnName === null ? {} : { columnName: one.columnName }), value: one.value, ...(one.status === undefined ? {} : { status: one.status }) }));
  const put = await page.request.put(`/api/v1/connections/${connectionId}/overrides`, {
    data: {
      overrides: [
        ...kept,
        { op: 'column.file', tableName: tableId, columnName: 'signature', value: { accept: ['png'], maxBytes: 524_288 } },
        { op: 'column.file', tableName: tableId, columnName: 'photos', value: { accept: ['jpeg', 'png', 'webp'], maxBytes: 8_388_608, maxCount: 3 } },
      ],
    },
  });
  expect(put.ok(), await put.text()).toBe(true);

  // The fitter: invited with the app's one role, activated, signed in ONCE (five sign-ins a minute per address).
  const roles = ((await (await page.request.get('/api/v1/roles')).json()) as { roles: { id: string; slug: string }[] }).roles;
  const role = roles.find((one) => one.slug === `${KEY}-fitter`)!.id;
  const users = (await (await page.request.get('/api/v1/users?q=e2e-kit-fitter')).json()) as { users?: { id: string; email: string }[] };
  for (const user of users.users ?? []) if (user.email === FITTER.email) await page.request.delete(`/api/v1/users/${user.id}`);
  const invited = await page.request.post('/api/v1/users', { data: { email: FITTER.email, name: FITTER.name, roleIds: [role] } });
  expect(invited.status(), await invited.text()).toBe(201);
  const { invite, user } = (await invited.json()) as { invite: { token: string }; user: { id: string } };
  const context = await browser.newContext({ baseURL: BASE_URL, storageState: { cookies: [], origins: [] } });
  const own = await context.newPage();
  expect((await own.request.post('/api/v1/auth/password/reset', { data: { token: invite.token, newPassword: FITTER.password } })).ok()).toBe(true);
  await own.goto('/login');
  const login = (): Promise<number> =>
    own.evaluate(async ([email, password]) => (await fetch('/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) })).status, [FITTER.email, FITTER.password] as const);
  let status = await login();
  if (status === 429) {
    await own.waitForTimeout(61_000);
    status = await login();
  }
  expect(status, 'the fitter signs in').toBe(200);
  fitter = { id: user.id, cookies: await context.cookies() };
  await context.close();
  await page.close();
});

test.afterAll(async ({ browser }) => {
  const page = await browser.newPage();
  await signIn(page);
  await page.request.put(`/api/v1/connections/${connectionId}/overrides`, { data: { overrides: kept } }).catch(() => undefined);
  if (fitter !== undefined) await page.request.delete(`/api/v1/users/${fitter.id}`).catch(() => undefined);
  await page.request.delete(`/api/v1/apps/${KEY}`, { data: { dropTables: true, confirmKey: KEY } }).catch(() => undefined);
  await page.close();
});

/** The fitter's own page, on their session. */
async function fitterPage(browser: Browser): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ baseURL: BASE_URL, storageState: { cookies: fitter!.cookies, origins: [] } });
  return { page: await context.newPage(), close: () => context.close() };
}

function watch(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (message) => {
    // A refused create is the screen's own doing, and the browser reports its 422 and 409s.
    if (message.type() === 'error' && !/status of (409|422)/.test(message.text())) problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(String(error)));
  return problems;
}

async function open(page: Page, query = ''): Promise<void> {
  await page.goto(STAFF + query);
  await expect(page.locator('body')).toHaveAttribute('data-kit', /ready|failed/, { timeout: 30_000 });
  expect(await page.locator('#failed').textContent()).toBe('');
}

type ScreenState = { signature: string | null; photos: string[]; busy: boolean; results: { status: number; body: { data?: Record<string, unknown>; error?: { code: string; details?: unknown } }; key: string; values: Record<string, unknown> }[]; discarded: { id: string; status: number }[] };
const screenState = (page: Page): Promise<ScreenState> => page.evaluate(() => (window as unknown as { kitScreen: { state: ScreenState } }).kitScreen.state);

/** Every class a part wears that no sheet of the page styles. */
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
    for (const element of document.querySelectorAll('.adm-kit, .adm-kit *')) for (const name of element.classList) if (!all.includes(`.${CSS.escape(name)}`)) bare.add(name);
    return [...bare].sort();
  });
}

/** Draws a stroke across the pad with the mouse. */
async function sign(page: Page): Promise<void> {
  const pad = page.getByTestId('kit-signature-pad');
  const box = (await pad.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.6);
  await page.mouse.down();
  for (const [x, y] of [[0.3, 0.4], [0.45, 0.65], [0.6, 0.35], [0.75, 0.6]] as const) await page.mouse.move(box.x + box.width * x, box.y + box.height * y, { steps: 4 });
  await page.mouse.up();
}

/** Adds photos through the field's own button, by its name in the page's language. */
async function addPhotos(page: Page, fills: number[], name = 'Add a photo'): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#photos').getByRole('button', { name }).click();
  await (await chooser).setFiles(fills.map((fill, index) => ({ name: `IMG_00${String(index + 1)}.png`, mimeType: 'image/png', buffer: photo(fill) })));
}

test('a fitter whose role opens only these screens signs a job off: a drawn signature, two photos, one create; the files are the sign-off’s, kept clean', async ({ browser }) => {
  const { page, close } = await fitterPage(browser);
  const problems = watch(page);
  const doors: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/')) doors.push(`${request.method()} ${url.pathname}`);
  });
  await open(page);
  expect(await page.evaluate(() => 'React' in window)).toBe(false);
  await expect(page.locator('#signature').getByRole('group', { name: 'Customer signature' })).toBeVisible();

  await sign(page);
  await page.locator('#signature').getByRole('button', { name: 'Keep this signature' }).click();
  await expect(page.locator('#signature').getByRole('img', { name: 'The signature as kept' })).toBeVisible();
  await addPhotos(page, [90, 160]);
  await expect(page.locator('#photos').getByRole('img')).toHaveCount(2);
  await expect.poll(async () => (await screenState(page)).photos.length).toBe(2);
  expect((await screenState(page)).busy).toBe(false);
  await page.locator('#signer').fill('Ada Customer');
  await page.getByRole('button', { name: 'Sign off' }).click();
  await expect(page.locator('#said')).toHaveText('Signed off.');

  const state = await screenState(page);
  const made = state.results.at(-1)!;
  expect(made.status).toBe(201);
  expect(made.body.data).toMatchObject({ signer_name: 'Ada Customer', signature: state.signature, photos: state.photos });
  // Only the doors a screen needs: the uploads, one create, and nothing of the dashboard.
  expect(doors.filter((door) => door === 'POST /api/v1/files')).toHaveLength(3);
  expect(doors.filter((door) => /\/api\/v1\/(bootstrap|connections|pages|schema)/.test(door))).toEqual([]);

  // The files are read back with the record, by the fitter; the signature a PNG, each photo with no word of where it was taken.
  for (const id of [state.signature!, ...state.photos]) {
    const file = await page.request.get(`/api/v1/files/${id}`);
    expect(file.ok(), await file.text()).toBe(true);
    expect(((await file.json()) as { data: { entity: { table: string } | null } }).data.entity?.table).toBe(tableId);
    const content = await page.request.get(`/api/v1/files/${id}/content`);
    expect(content.ok()).toBe(true);
    expect((await content.body()).toString('latin1')).not.toMatch(/GPS|Elm Row/);
  }
  expect(((await (await page.request.get(`/api/v1/files/${state.signature!}`)).json()) as { data: { mime: string } }).data.mime).toBe('image/png');
  // Kept, the files are the record's: the fitter who uploaded them cannot throw one away by itself.
  const csrf = await page.evaluate(() => (window as unknown as { kitScreen: { config: { csrfToken: string } } }).kitScreen.config.csrfToken);
  const held = await page.request.delete(`/api/v1/files/${state.photos[0]!}`, { headers: { 'x-adminium-csrf': csrf } });
  expect(held.status()).toBe(409);
  expect(await unstyledClasses(page)).toEqual([]);
  expect(problems).toEqual([]);
  await close();
});

test('the same sign-off by keyboard alone: the name typed for a signature, a photo added and taken out, the sign-off sent', async ({ browser }) => {
  const { page, close } = await fitterPage(browser);
  const problems = watch(page);
  await open(page);
  // The first stop is the pad's own way round drawing: type the name instead.
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toHaveText('Type the name instead');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator(':focus')).toHaveAccessibleName('Name, as the signature');
  await page.keyboard.type('Ada Lovelace');
  await page.keyboard.press('Enter');
  await expect(page.locator('#signature').getByRole('img', { name: 'The signature as kept' })).toBeVisible();
  // The keyboard is left on the button that undoes it.
  await expect(page.locator(':focus')).toHaveText('Sign again');

  // On to the photos: Enter opens the phone's own chooser.
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toHaveText('Add a photo');
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Enter');
  await (await chooser).setFiles([{ name: 'IMG_001.png', mimeType: 'image/png', buffer: photo(60) }, { name: 'IMG_002.png', mimeType: 'image/png', buffer: photo(200) }]);
  await expect(page.locator('#photos').getByRole('img')).toHaveCount(2);
  await expect.poll(async () => (await screenState(page)).photos.length).toBe(2);
  const [first] = (await screenState(page)).photos;
  // Back to the first photo's button, and it goes: thrown away on the server, the keyboard kept in the field.
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator(':focus')).toHaveAccessibleName('Take photo 1 out');
  await page.keyboard.press('Enter');
  await expect(page.locator('#photos').getByRole('img')).toHaveCount(1);
  await expect(page.locator(':focus')).toHaveText('Add a photo');
  await expect.poll(async () => (await page.request.get(`/api/v1/files/${first!}/content`)).status()).toBe(404);

  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toHaveAttribute('id', 'signer');
  await page.keyboard.type('Ada Lovelace');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(page.locator('#said')).toHaveText('Signed off.');
  const state = await screenState(page);
  expect(state.results.at(-1)).toMatchObject({ status: 201, body: { data: { signature: state.signature, photos: state.photos } } });
  expect(state.photos).toHaveLength(1);
  expect(problems).toEqual([]);
  await close();
});

test('a refused sign-off throws its uploads away; sent again under its key it answers the first; a second sign-off may not name the first’s signature', async ({ browser }) => {
  const { page, close } = await fitterPage(browser);
  await open(page);
  const csrf = await page.evaluate(() => (window as unknown as { kitScreen: { config: { csrfToken: string } } }).kitScreen.config.csrfToken);
  const headers = { 'x-adminium-csrf': csrf };
  const rows = `/api/v1/data/${connectionId}/${TABLE}`;

  // No name: the create is refused, and the screen throws the signature and the photo away.
  await sign(page);
  await page.locator('#signature').getByRole('button', { name: 'Keep this signature' }).click();
  await addPhotos(page, [120]);
  await expect.poll(async () => (await screenState(page)).photos.length).toBe(1);
  await page.getByRole('button', { name: 'Sign off' }).click();
  await expect(page.locator('#said')).toHaveText('Not signed off.');
  const refused = await screenState(page);
  // Refused for the name it lacks (a column the table requires).
  expect(refused.results.at(-1)!.status).toBeGreaterThanOrEqual(400);
  expect(refused.discarded.map((one) => one.status)).toEqual([200, 200]);
  for (const one of refused.discarded) expect((await page.request.get(`/api/v1/files/${one.id}/content`)).status()).toBe(404);

  // A sign-off sent, and sent again after a lost reply: one row, the first's, with its files.
  const signature = (await (await page.request.post(`/api/v1/files?connectionId=${connectionId}&table=${TABLE}&column=signature&filename=signature.png`, { headers: { ...headers, 'content-type': 'image/png' }, data: photo(30) })).json()) as { data: { id: string } };
  const values = { job: 'Bathroom at 3 Mill Lane', signer_name: 'Ben Customer', signature: signature.data.id };
  const once = await page.request.post(rows, { headers, data: { values, clientKey: 'e2e-kit-files-sign-off-mill-lane' } });
  expect(once.status(), await once.text()).toBe(201);
  const again = await page.request.post(rows, { headers, data: { values, clientKey: 'e2e-kit-files-sign-off-mill-lane' } });
  expect(again.status(), await again.text()).toBe(200);
  expect(await again.json()).toMatchObject({ replayed: true, data: { id: ((await once.json()) as { data: { id: number } }).data.id } });
  // The upload was cleaned too: what the camera wrote is not in it.
  expect((await (await page.request.get(`/api/v1/files/${signature.data.id}/content`)).body()).toString('latin1')).not.toMatch(/GPS|Elm Row/);

  // Another job, signed with the first job's signature: refused, and the first keeps it.
  const stolen = await page.request.post(rows, { headers, data: { values: { job: 'Hall at 9 Quay Street', signer_name: 'Ben Customer', signature: signature.data.id } } });
  expect(stolen.status()).toBe(422);
  expect(((await stolen.json()) as { error: { details: { fields: Record<string, { code: string }> } } }).error.details.fields).toEqual({ signature: { code: 'file-not-here' } });
  expect((await page.request.get(`/api/v1/files/${signature.data.id}/content`)).ok()).toBe(true);
  await close();
});

test('in Arabic, at 390 wide and dark: both parts read right to left, are styled whole, and the page never scrolls sideways', async ({ browser }) => {
  const { page, close } = await fitterPage(browser);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark' });
  const problems = watch(page);
  await open(page, `?locale=ar-EG&dir=rtl&theme=dark&label=${encodeURIComponent('توقيع العميل')}`);
  const pad = page.locator('#signature');
  await expect(pad.getByRole('button', { name: 'احتفظ بهذا التوقيع' })).toBeVisible();
  await expect(page.locator('#photos').getByRole('button', { name: 'أضف صورة' })).toBeVisible();
  expect(await page.locator('#signature .adm-kit').getAttribute('dir')).toBe('rtl');
  expect(await page.locator('#signature .adm-kit').getAttribute('data-kit-theme')).toBe('dark');
  // The pad is paper whatever the theme; the buttons take the dark set.
  const paper = await page.locator('#signature .adm-kit-pad').evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(paper).toBe('rgb(255, 255, 255)');
  const button = await pad.getByRole('button', { name: 'وقّع بخط اليد بدلًا من ذلك' }).or(pad.getByRole('button', { name: 'اكتب الاسم بدلًا من ذلك' })).first().evaluate((el) => getComputedStyle(el).color);
  expect(Math.min(...(button.match(/\d+/g) ?? []).slice(0, 3).map(Number))).toBeGreaterThan(120);
  // The first button of the row sits at the right, as Arabic reads.
  const actions = await pad.locator('.adm-kit-files-actions button').evaluateAll((all) => all.map((one) => one.getBoundingClientRect().x));
  expect(actions[0]!).toBeGreaterThan(actions[actions.length - 1]!);

  await sign(page);
  await pad.getByRole('button', { name: 'احتفظ بهذا التوقيع' }).click();
  await expect(pad.getByRole('img', { name: 'التوقيع المحفوظ' })).toBeVisible();
  await addPhotos(page, [70, 140, 210], 'أضف صورة');
  await expect(page.locator('#photos').getByRole('img')).toHaveCount(3);
  await expect(page.locator('#photos').getByRole('button', { name: 'أضف صورة' })).toBeDisabled();
  for (const part of ['#signature', '#photos']) {
    const box = (await page.locator(part).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
  }
  const widths = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, view: document.documentElement.clientWidth }));
  expect(widths.page).toBeLessThanOrEqual(widths.view);
  expect(await unstyledClasses(page)).toEqual([]);
  expect(problems).toEqual([]);
  await close();
});
