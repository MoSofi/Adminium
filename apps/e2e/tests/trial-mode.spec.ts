// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Trial mode, walked in a browser on an instance booted the way an operator
 * boots one: the built CLI's `adminium start`, its meta store on the leg's
 * engine (an embedded file on SQLite, a database of its own on Postgres and
 * MySQL), and the operator's variables only. Nothing is seeded behind the
 * server's back.
 *
 *   ADMINIUM_TRIAL_MODE=on, an end date ten days out, a setup token, the
 *   public origin (`http://localhost:<port>`: the browser's Host, so every
 *   other Host is a 421), the database host list, the operator's own source
 *   database (`ADMINIUM_SOURCE_URL`, where the leg has a database server), the
 *   mail relay pointed at the run's SMTP sink, the Upgrade address, and the
 *   operator endpoint on a second loopback port.
 *
 * One file, one instance, booted twice: running, then again with its end date
 * in the past, on the same data folder and meta store. Its own server means its
 * own sign-in budget, and the walk signs in nobody at all: setup makes the
 * session, and the second boot keeps it. The tests are serial and share one
 * browser context; a failure skips the rest, which build on it.
 *
 * On the SQLite leg in CI there is no database server, so the instance has no
 * source: the setup wizard then shows its connect step (whose SQLite choice is
 * the switched-off one walked by keyboard), and the read-only Tooltip on a data
 * page is not reached. Where TEST_POSTGRES_URL or TEST_MYSQL_URL is set the
 * SQLite leg takes that server as its source and walks everything.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { createRequire } from 'node:module';
import { connect } from 'node:net';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { E2E_DATABASE, ENGINE, PORT, SINK_URL, SMTP_PORT, TEST_MYSQL_URL, TEST_POSTGRES_URL, type E2eEngine, type SinkMessage } from './constants.js';

const require = createRequire(import.meta.url);
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const CLI = join(repoRoot, 'apps', 'server', 'dist', 'cli', 'index.js');
const DASHBOARD = join(repoRoot, 'apps', 'dashboard', 'dist');

/** Clear of +0, +20, +40, the own-apps servers (+60, +80) and every sink (+100 up). */
const TRIAL_PORT = PORT + 120;
const OPERATOR_PORT = PORT + 121;
const ORIGIN = `http://localhost:${String(TRIAL_PORT)}`;
const OPERATOR_URL = `http://127.0.0.1:${String(OPERATOR_PORT)}/api/v1/operator`;

const SETUP_TOKEN = randomBytes(16).toString('hex');
const OPERATOR_TOKEN = randomBytes(32).toString('hex');
const SECRET = randomBytes(32).toString('hex');
const RELAY_FROM = 'i-e2e-trial@relay.example.test';
/** The operator's page, answered by the test itself: nothing leaves the machine. */
const UPGRADE_URL = 'https://upgrade.example.test/keep';
const OWNER = { email: 'owner@trial.example.test', password: 'a-long-trial-owner-password' };
/** Its own address on every run: the sink is the run's, and a server reused locally keeps what earlier runs sent. */
const TEAMMATE = `mate-${randomBytes(4).toString('hex')}@trial.example.test`;
const TEST_ENVIRONMENT = 'This is a test environment. Please don’t put real customer data in.';
const READ_ONLY = 'Read-only: this trial has ended';
const NOINDEX = 'noindex, nofollow';
/** A public page every instance serves: the mail door's answer to a link it does not know. */
const MAIL_DOOR = '/m/u/not-a-token';

const SOURCE_DATABASE = `${E2E_DATABASE}_trial`;
const META_DATABASE = `${E2E_DATABASE}_trial_meta`;
const SOURCE_TABLE = 'trial_orders';

// ── the operator's databases ────────────────────────────────────────────────

/** The source's engine: the leg's own server, or on SQLite whichever server this machine has. */
function sourceEngine(): Exclude<E2eEngine, 'sqlite'> | null {
  if (ENGINE !== 'sqlite') return ENGINE;
  if (TEST_POSTGRES_URL !== '') return 'postgres';
  if (TEST_MYSQL_URL !== '') return 'mysql';
  return null;
}

/**
 * `base` with `database` as its path, and its login named: on an operator host a trial may use only the user and
 * database `ADMINIUM_SOURCE_URL` names, so a URL that leaves the user to the driver (the OS user, as `pg` does) has it
 * written in.
 */
function databaseUrl(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  if (url.username === '') url.username = userInfo().username;
  return url.toString();
}

interface PgClient {
  connect(): Promise<void>;
  query(sql: string): Promise<unknown>;
  end(): Promise<void>;
}
type PgModule = { Client: new (options: { connectionString: string }) => PgClient };

async function onPostgres(url: string, statements: string[]): Promise<void> {
  const pg = require('pg') as PgModule;
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    for (const sql of statements) await client.query(sql);
  } finally {
    await client.end();
  }
}

async function onMysql(url: string, statements: string[]): Promise<void> {
  const mysql = await import('mysql2/promise');
  const client = await mysql.createConnection({ uri: url });
  try {
    for (const sql of statements) await client.query(sql);
  } finally {
    await client.end();
  }
}

const TABLE_SQL = [
  `CREATE TABLE ${SOURCE_TABLE} (id integer PRIMARY KEY, customer varchar(100) NOT NULL, total numeric(10, 2) NOT NULL)`,
  `INSERT INTO ${SOURCE_TABLE} (id, customer, total) VALUES (1, 'Ada Lovelace', 12.50), (2, 'Bo Diddley', 8.00)`,
];

/** Fresh databases for this file: the operator's source (when there is a server) and, off SQLite, the meta store. */
async function createDatabases(): Promise<{ sourceUrl: string | null; metaUrl: string | null; hosts: string }> {
  const engine = sourceEngine();
  const names = [SOURCE_DATABASE, ...(ENGINE === 'sqlite' ? [] : [META_DATABASE])];
  if (engine === 'postgres') {
    await onPostgres(TEST_POSTGRES_URL, names.flatMap((name) => [`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`, `CREATE DATABASE ${name}`]));
    await onPostgres(databaseUrl(TEST_POSTGRES_URL, SOURCE_DATABASE), TABLE_SQL);
  } else if (engine === 'mysql') {
    await onMysql(TEST_MYSQL_URL, names.flatMap((name) => [`DROP DATABASE IF EXISTS \`${name}\``, `CREATE DATABASE \`${name}\``]));
    await onMysql(databaseUrl(TEST_MYSQL_URL, SOURCE_DATABASE), TABLE_SQL);
  }
  const base = engine === 'postgres' ? TEST_POSTGRES_URL : engine === 'mysql' ? TEST_MYSQL_URL : null;
  const sourceUrl = base === null ? null : databaseUrl(base, SOURCE_DATABASE);
  const metaUrl = ENGINE === 'sqlite' || base === null ? null : databaseUrl(base, META_DATABASE);
  // The list names the host the source is on; with no server, a host nothing here connects to.
  const hosts = base === null ? '127.0.0.1:5432' : `${new URL(base).hostname}:${new URL(base).port || (engine === 'mysql' ? '3306' : '5432')}`;
  return { sourceUrl, metaUrl, hosts };
}

async function dropDatabases(): Promise<void> {
  const engine = sourceEngine();
  const names = [SOURCE_DATABASE, ...(ENGINE === 'sqlite' ? [] : [META_DATABASE])];
  if (engine === 'postgres') await onPostgres(TEST_POSTGRES_URL, names.map((name) => `DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  else if (engine === 'mysql') await onMysql(TEST_MYSQL_URL, names.map((name) => `DROP DATABASE IF EXISTS \`${name}\``));
}

// ── the instance ────────────────────────────────────────────────────────────

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(true));
  });
}

class TrialInstance {
  private child: ChildProcess | null = null;
  private text = '';

  constructor(
    private readonly dataDir: string,
    private readonly databases: { sourceUrl: string | null; metaUrl: string | null; hosts: string },
  ) {}

  /** The operator's environment: nothing of the shell's Adminium variables, not production (the image's loopback rule is not under test). */
  private env(endsAt: string): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value === undefined || key.startsWith('ADMINIUM_') || key === 'NODE_ENV' || key === 'NODE_OPTIONS') continue;
      env[key] = value;
    }
    return {
      ...env,
      PORT: String(TRIAL_PORT),
      HOST: '127.0.0.1',
      ADMINIUM_SECRET: SECRET,
      ADMINIUM_DATA_DIR: this.dataDir,
      ADMINIUM_STATIC_ROOT: DASHBOARD,
      ...(this.databases.metaUrl === null ? {} : { ADMINIUM_META_URL: this.databases.metaUrl }),
      ADMINIUM_TRIAL_MODE: 'on',
      ADMINIUM_TRIAL_ENDS_AT: endsAt,
      ADMINIUM_SETUP_TOKEN: SETUP_TOKEN,
      ADMINIUM_PUBLIC_ORIGIN: ORIGIN,
      ADMINIUM_DATABASE_HOSTS: this.databases.hosts,
      ...(this.databases.sourceUrl === null ? {} : { ADMINIUM_SOURCE_URL: this.databases.sourceUrl }),
      ADMINIUM_TRIAL_SMTP_URL: `smtp://127.0.0.1:${String(SMTP_PORT)}`,
      ADMINIUM_TRIAL_MAIL_FROM: RELAY_FROM,
      ADMINIUM_TRIAL_UPGRADE_URL: UPGRADE_URL,
      ADMINIUM_OPERATOR_TOKEN: OPERATOR_TOKEN,
      ADMINIUM_OPERATOR_LISTEN: `127.0.0.1:${String(OPERATOR_PORT)}`,
    };
  }

  output(): string {
    return this.text;
  }

  async start(endsAt: string): Promise<void> {
    await this.stop();
    if (!(await portIsFree(TRIAL_PORT))) throw new Error(`port ${String(TRIAL_PORT)} is taken`);
    const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'adminium-e2e-trial-cwd-')));
    const child = spawn(process.execPath, [CLI, 'start'], { cwd, env: this.env(endsAt), stdio: ['ignore', 'pipe', 'pipe'] });
    this.child = child;
    child.stdout?.on('data', (chunk: Buffer) => (this.text += chunk.toString('utf8')));
    child.stderr?.on('data', (chunk: Buffer) => (this.text += chunk.toString('utf8')));
    for (const deadline = Date.now() + 180_000; ; await sleep(250)) {
      if (child.exitCode !== null) throw new Error(`the trial instance exited ${String(child.exitCode)}:\n${this.text.slice(-4000)}`);
      // The health check answers on every host; the deep one waits for what the dashboard needs.
      const ready = await fetch(`http://127.0.0.1:${String(TRIAL_PORT)}/api/v1/readyz?deep=1`).then((res) => res.ok, () => false);
      if (ready) return;
      if (Date.now() > deadline) throw new Error(`the trial instance was not ready in 180 s:\n${this.text.slice(-4000)}`);
    }
  }

  async stop(): Promise<void> {
    const child = this.child;
    this.child = null;
    if (child === null || child.exitCode !== null) return;
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill('SIGTERM');
    await Promise.race([exited, sleep(20_000)]);
    if (child.exitCode === null) {
      child.kill('SIGKILL');
      await exited;
    }
    for (const deadline = Date.now() + 20_000; !(await portIsFree(TRIAL_PORT)); await sleep(250)) {
      if (Date.now() > deadline) throw new Error(`port ${String(TRIAL_PORT)} is still taken after the instance stopped`);
    }
  }
}

/** The operator endpoint, as the control service calls it. */
async function operator(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${OPERATOR_URL}${path}`, {
    method,
    headers: { authorization: `Bearer ${OPERATOR_TOKEN}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

/** A public page as a stranger's browser loads it: no cookie, a page load, the Host given (the browser's by default). */
function strangerLoads(path: string, host = `localhost:${String(TRIAL_PORT)}`): Promise<{ status: number; robots: string | null; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: TRIAL_PORT, path, headers: { host, accept: 'text/html', 'sec-fetch-mode': 'navigate' } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => (body += chunk));
      res.on('end', () => {
        const robots = res.headers['x-robots-tag'];
        resolve({ status: res.statusCode ?? 0, robots: typeof robots === 'string' ? robots : null, body });
      });
    });
    req.once('error', reject);
    req.end();
  });
}

async function sinkFor(address: string): Promise<SinkMessage[]> {
  const all = (await (await fetch(`${SINK_URL}/messages`)).json()) as SinkMessage[];
  return all.filter((message) => message.envelope.to.includes(address));
}

const days = (n: number): string => new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Both strips of a running trial, whole and unclosable. */
async function expectRunningStrips(page: Page): Promise<void> {
  const note = page.getByTestId('trial-test-environment');
  await expect(note).toBeVisible();
  await expect(note).toHaveText(TEST_ENVIRONMENT);
  await expect(note).toHaveAttribute('role', 'note');
  const daysStrip = page.getByTestId('trial-days');
  await expect(daysStrip).toBeVisible();
  await expect(daysStrip).toContainText(/\b(9|10) days left/);
  await expect(daysStrip.getByTestId('trial-export')).toHaveText('Export everything');
  await expect(daysStrip.getByTestId('trial-upgrade')).toHaveText('Upgrade');
  // Neither can be closed.
  await expect(note.getByRole('button')).toHaveCount(0);
  await expect(daysStrip.getByRole('button')).toHaveCount(0);
}

// ── the walk ────────────────────────────────────────────────────────────────

test.describe.configure({ mode: 'serial' });

test.describe('trial mode', () => {
  test.setTimeout(240_000);

  let work: string;
  let instance: TrialInstance;
  let context: BrowserContext;
  let page: Page;
  let hasSource = false;

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    test.setTimeout(300_000);
    if (!existsSync(CLI) || !existsSync(join(DASHBOARD, 'index.html'))) throw new Error('build the server and the dashboard first');
    work = realpathSync(mkdtempSync(join(tmpdir(), 'adminium-e2e-trial-')));
    const databases = await createDatabases();
    hasSource = databases.sourceUrl !== null;
    instance = new TrialInstance(join(work, 'data'), databases);
    await instance.start(days(10));
    // An empty state, stated: the run's saved sessions belong to the shared server.
    context = await browser.newContext({ baseURL: ORIGIN, storageState: { cookies: [], origins: [] } });
    // The operator's Upgrade page, answered here.
    await context.route(`${UPGRADE_URL}**`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Keep your trial</title><h1>Keep your trial</h1>' }));
    page = await context.newPage();
  });

  test.afterAll(async () => {
    await context?.close().catch(() => undefined);
    await instance?.stop().catch(() => undefined);
    await dropDatabases().catch(() => undefined);
    if (work !== undefined) rmSync(work, { recursive: true, force: true });
  });

  // eslint-disable-next-line no-empty-pattern -- Playwright reads fixtures from this pattern, and the hook needs none.
  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) await testInfo.attach('instance output', { body: instance.output().slice(-8000), contentType: 'text/plain' });
  });

  test('setup opens with the #setup-token= link, under both strips', async () => {
    // The welcome link the control service sends: the token in the fragment, which never reaches the server.
    // The meta store is on the leg's engine: the walk below runs on each of the three.
    const info = (await (await context.request.get('/api/v1/system/info')).json()) as { dialect: string; trial: { on: boolean; daysLeft: number } };
    expect(info.dialect).toBe(ENGINE);
    expect(info.trial).toMatchObject({ on: true, daysLeft: 10 });

    await page.goto(`/#setup-token=${SETUP_TOKEN}`);
    await expect(page).toHaveURL(/\/setup$/);
    // Read and wiped from the address bar; no token screen.
    expect(new URL(page.url()).hash).toBe('');
    await expect(page.getByRole('heading', { name: 'Enter your setup token' })).toHaveCount(0);
    await expectRunningStrips(page);

    if (!hasSource) {
      // No database yet, so the wizard asks for one: its SQLite choice is shown, switched off, with the reason.
      await expect(page.getByRole('heading', { name: 'What will you build first?' })).toHaveCount(1);
      await page.getByRole('button', { name: /Continue/ }).click();
      await expect(page.getByRole('heading', { name: 'Connect your database' })).toHaveCount(1);
      const sqlite = page.getByRole('radio', { name: /SQLite/ });
      await expect(sqlite).toHaveAttribute('aria-disabled', 'true');
      await expect(page.getByTestId('off-by-operator-note')).toContainText('does not open SQLite files');
      // Reached by keyboard: the arrows walk the engines onto it, and it stays unchosen.
      await page.getByRole('radio', { name: /PostgreSQL/ }).focus();
      for (let i = 0; i < 3 && !(await sqlite.evaluate((el) => el === document.activeElement)); i += 1) await page.keyboard.press('ArrowRight');
      await expect(sqlite).toBeFocused();
      await expect(sqlite).toHaveAttribute('aria-checked', 'false');
      await expect(page.getByRole('tooltip').filter({ hasText: 'does not open SQLite files' })).toHaveCount(1);
      await page.getByRole('button', { name: 'Skip' }).click();
    }

    await expect(page.getByRole('heading', { name: 'Create your account' })).toHaveCount(1);
    await page.getByLabel(/^Email/).fill(OWNER.email);
    await page.getByLabel(/^Password/).fill(OWNER.password);
    await page.getByLabel(/^Confirm password/).fill(OWNER.password);
    await page.getByRole('button', { name: /Create account/ }).click();

    // The meta store is the operator's: whatever that step says, there is nothing to choose.
    const team = page.getByRole('heading', { name: 'Bring your team' });
    const meta = page.getByRole('heading', { name: 'Where Adminium keeps its own data' });
    await expect(team.or(meta)).toBeVisible({ timeout: 30_000 });
    if (await meta.isVisible()) await page.getByRole('button', { name: /Continue/ }).click();

    // An invitation is account mail: it goes out through the operator's relay, From pinned.
    await expect(team).toBeVisible();
    await page.getByLabel(/Teammate/).fill(TEAMMATE);
    await page.getByRole('button', { name: 'Invite' }).click();
    await expect(page.getByText(TEAMMATE)).toBeVisible();
    await expect.poll(async () => (await sinkFor(TEAMMATE)).length, { timeout: 30_000 }).toBe(1);
    const [invitation] = await sinkFor(TEAMMATE);
    expect(invitation?.envelope.from).toBe(RELAY_FROM);
    expect(invitation?.from).toContain(RELAY_FROM);
    await page.getByRole('button', { name: /Continue/ }).click();

    await expect(page.getByRole('heading', { name: /You’re all set/ })).toHaveCount(1);
    await page.getByRole('button', { name: /Go to dashboard/ }).click();
    await expect(page).not.toHaveURL(/\/setup/, { timeout: 30_000 });
  });

  test('the shell and the sign-in page carry both strips, the whole sentence on a phone', async ({ browser }) => {
    await page.goto('/');
    await expectRunningStrips(page);

    // A phone: the full sentence, wrapped rather than shortened, and no sideways scroll.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expectRunningStrips(page);
    const note = page.getByTestId('trial-test-environment');
    const sentence = note.getByText(TEST_ENVIRONMENT);
    const lineHeight = await sentence.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
    expect((await sentence.boundingBox())?.height ?? 0).toBeGreaterThan(lineHeight * 1.5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.setViewportSize({ width: 1280, height: 720 });

    // Signed out, in a browser of its own: the sign-in page has its own mount.
    const stranger = await browser.newContext({ baseURL: ORIGIN, storageState: { cookies: [], origins: [] } });
    try {
      const signIn = await stranger.newPage();
      await signIn.goto('/login');
      await expect(signIn.getByRole('button', { name: /Sign in/ })).toHaveCount(1);
      await expectRunningStrips(signIn);
    } finally {
      await stranger.close();
    }
  });

  test('a switched-off choice is shown, disabled with its reason, and reached by keyboard', async () => {
    // Storage: only the default folder; "Add a destination" stays in the tab order with the reason.
    await page.goto('/studio/storage');
    const add = page.getByTestId('studio-storage-add');
    await expect(add).toBeVisible();
    await expect(add).toHaveAttribute('aria-disabled', 'true');
    await page.locator('body').focus();
    for (let i = 0; i < 80 && !(await add.evaluate((el) => el === document.activeElement)); i += 1) await page.keyboard.press('Tab');
    await expect(add).toBeFocused();
    await expect(page.getByRole('tooltip').filter({ hasText: 'The operator keeps this installation’s files on its own disk' })).toHaveCount(1);
    // Pressed anyway: nothing opens.
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // The connect wizard: SQLite is there, switched off, and says why.
    await page.goto('/studio/connect');
    await expect(page.getByRole('heading', { name: 'New connection' })).toHaveCount(1);
    for (let i = 0; i < 4 && !(await page.getByRole('radio', { name: 'SQLite' }).isVisible()); i += 1) {
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
    }
    await expect(page.getByRole('radio', { name: 'SQLite' })).toBeDisabled();
    await expect(page.getByTestId('off-by-operator-note')).toContainText('does not open SQLite files');
  });

  test('Settings shows what the operator set', async () => {
    await page.goto('/studio/settings');
    // The relay, the address in email links, the calls home and the databases on this server: each "Set by the operator".
    await expect(page.getByText('Email is sent through the operator’s mail service')).toBeVisible();
    await expect(page.getByText(RELAY_FROM)).toBeVisible();
    await expect(page.getByText('The server’s operator set this address.', { exact: false })).toHaveCount(1);
    await expect(page.getByText('Set by the operator').first()).toBeVisible();
    expect(await page.getByText('Set by the operator').count()).toBeGreaterThanOrEqual(3);
  });

  test('the user menu and the Export page offer Upgrade, in the same tab', async () => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Account menu' }).click();
    const menu = page.getByRole('menu');
    const upgrade = menu.getByTestId('topbar-upgrade');
    await expect(upgrade).toHaveText('Upgrade');
    // One group: Upgrade first, then "Put this online…".
    const items = await menu.getByRole('menuitem').allTextContents();
    const at = items.findIndex((text) => text.includes('Upgrade'));
    expect(items[at + 1]).toContain('Put this online');
    await page.keyboard.press('Escape');

    await page.goto('/studio/settings/export');
    await expect(page.getByTestId('export-download-everything')).toBeVisible();
    const card = page.getByText('Keep this installation: everything stays as it is.');
    await expect(card).toBeVisible();
    const pages = context.pages().length;
    await page.getByRole('link', { name: 'Upgrade' }).last().click();
    await expect(page).toHaveURL(new RegExp(`^${UPGRADE_URL.replace(/\./g, '\\.')}\\?instance=${encodeURIComponent(ORIGIN).replace(/\./g, '\\.')}$`));
    await expect(page.getByRole('heading', { name: 'Keep your trial' })).toHaveCount(1);
    expect(context.pages()).toHaveLength(pages);
  });

  test('a public page says noindex, and any other Host is a 421', async ({ browser }) => {
    const door = await strangerLoads(MAIL_DOOR);
    expect(door.status).toBeLessThan(500);
    expect(door.robots).toBe(NOINDEX);
    expect(door.body).toContain('<meta name="robots" content="noindex, nofollow">');
    // In a browser too, as a search engine's renderer would see it.
    const stranger = await browser.newContext({ baseURL: ORIGIN, storageState: { cookies: [], origins: [] } });
    try {
      const visit = await stranger.newPage();
      const res = await visit.goto(MAIL_DOOR);
      expect(res?.headers()['x-robots-tag']).toBe(NOINDEX);
      await expect(visit.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
      const robots = await visit.request.get('/robots.txt');
      expect(await robots.text()).toBe('User-agent: *\nDisallow: /\n');
    } finally {
      await stranger.close();
    }
    // The instance answers on the operator's address only.
    expect((await strangerLoads(MAIL_DOOR, `127.0.0.1:${String(TRIAL_PORT)}`)).status).toBe(421);
    expect((await strangerLoads('/', 'evil.example')).status).toBe(421);
  });

  test('the operator hides the public pages and shows them again', async () => {
    const status = await operator('GET', '/status');
    expect(status.status).toBe(200);
    expect(status.json['data']).toMatchObject({ publicPages: { hidden: false } });

    const hide = await operator('POST', '/public-pages', { hidden: true, reason: 'Reported as phishing; under review.' });
    expect(hide.status, JSON.stringify(hide.json)).toBe(200);
    const hidden = await strangerLoads(MAIL_DOOR);
    expect(hidden.status).toBe(404);
    expect(hidden.body).toContain('This page is unavailable.');
    expect(hidden.robots).toBe(NOINDEX);
    // Staff pages stay, and Studio says why with the operator's reason.
    await page.goto('/studio/settings');
    await expect(page.getByTestId('trial-test-environment')).toBeVisible();
    await expect(page.getByText('Your public pages are hidden by the operator.')).toBeVisible();
    await expect(page.getByText('Reason: Reported as phishing; under review.')).toBeVisible();

    const show = await operator('POST', '/public-pages', { hidden: false });
    expect(show.status, JSON.stringify(show.json)).toBe(200);
    expect((await strangerLoads(MAIL_DOOR)).body).not.toContain('This page is unavailable.');
    await page.reload();
    await expect(page.getByText('Your public pages are hidden by the operator.')).toHaveCount(0);
  });

  test('past the end date: one strip, read-only with the Tooltip, public pages hidden, Export still works', async () => {
    // The same instance, its container outliving its date.
    await instance.start(days(-1));
    await page.goto('/');
    const ended = page.getByTestId('trial-ended');
    await expect(ended).toBeVisible();
    await expect(ended).toHaveAttribute('role', 'status');
    await expect(ended).toContainText('This trial has ended.');
    await expect(ended.getByTestId('trial-export')).toBeVisible();
    await expect(ended.getByTestId('trial-upgrade')).toBeVisible();
    await expect(page.getByTestId('trial-test-environment')).toHaveCount(0);
    await expect(page.getByTestId('trial-days')).toHaveCount(0);

    if (hasSource) {
      // A data page: the Read-only chip, and every write control locked with the shared Tooltip, by keyboard too.
      await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: /Trial orders/i }).first().click();
      await expect(page.getByTestId('trial-read-only')).toBeVisible();
      const locked = page.locator('[data-write-locked]').first();
      await expect(locked).toBeVisible();
      await expect(locked).toHaveAttribute('aria-disabled', 'true');
      await locked.focus();
      await expect(page.getByRole('tooltip').filter({ hasText: READ_ONLY })).toHaveCount(1);
      await locked.press('Enter');
      await expect(page.getByRole('dialog')).toHaveCount(0);
    } else {
      test.info().annotations.push({ type: 'not walked', description: 'no database server on this leg: no data page to show the read-only Tooltip on' });
    }

    // The public page is hidden, on its own: the operator's hold is off.
    expect((await operator('GET', '/status')).json['data']).toMatchObject({ publicPages: { hidden: false } });
    const door = await strangerLoads(MAIL_DOOR);
    expect(door.status).toBe(404);
    expect(door.body).toContain('This page is unavailable.');

    // The way out still works: Export everything makes its file and hands it over.
    await page.goto('/studio/settings/export');
    await page.getByTestId('export-download-everything').click();
    await expect(page.getByTestId('export-ready')).toBeVisible({ timeout: 60_000 });
    const download = page.waitForEvent('download');
    await page.getByTestId('export-ready').getByRole('link', { name: 'Download' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/\.zip$/);
    expect(await file.failure()).toBeNull();
  });
});
