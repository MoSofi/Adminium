// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Check this before it goes live", on a whole server over a real project, on every engine.
 *
 * In a session that holds words from outside (a site template, a page, a stylesheet, a Figma
 * frame), what an app newly lets strangers do, or newly grants a role, is asked of the person
 * before the apply puts it on the server. What the last apply allowed is the measure; taking
 * access away is never asked; a change answered in a turn is not asked again in it; and what the
 * person approved on a template plan is not asked a second time.
 *
 * The model is a small HTTP server on this machine that speaks Ollama's streaming chat, so each
 * turn runs through the real tools, the real check, build and apply, and the real cards.
 */
import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { AdapterRegistry, type AdapterProvider } from '@adminium/engine/adapter';
import { publicEndpointsRepo, publicKeysRepo, type MetaDb } from '@adminium/meta';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { composeServer, type ComposedServer } from '../src/compose.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { registerAdapters } from '../src/connections/register-adapters.js';
import { createAttachments } from '../src/designer/attachments.js';
import { judgeSite, type SiteEntry } from '../src/designer/site/judge.js';
import type { TemplatePlanFile } from '../src/designer/site/template-plan.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import type { MetaStoreHandle } from '../src/meta/store.js';
import { starterParts } from '../src/project/apps/scaffold-app.js';
import { buildProject } from '../src/project/build.js';
import { syncProjectDatabases } from '../src/project/databases.js';
import { APP_VERSION } from '../src/version.js';
import { asProject } from './app-project-helpers.js';
import { makeEnv } from './helpers.js';
import { META_ENGINES, type MetaEngine } from './meta-dialects.js';
import { INSTALL_SECRET } from './project-fixtures.js';

// ── a model on this machine ──────────────────────────────────────────────────

/** A model's steps in order, each made when it is reached: text, or tool calls. */
type ScriptStep = () => { text: string } | { calls: { name: string; arguments: Record<string, unknown> }[] };
let script: ScriptStep[] = [];
/** What each request to the model carried: its messages, as sent. */
let asked: { role: string; content?: string }[][] = [];
let model: Server;
let modelUrl = '';

beforeAll(async () => {
  model = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8');
    });
    request.on('end', () => {
      if (request.url === '/api/tags') {
        response.end(JSON.stringify({ models: [{ name: 'fake', model: 'fake' }] }));
        return;
      }
      const sent = JSON.parse(body) as { messages: { role: string; content?: string }[]; tools?: { function: { name: string } }[] };
      const line = (value: unknown): void => {
        response.write(`${JSON.stringify(value)}\n`);
      };
      const done = { model: 'fake', done: true, done_reason: 'stop', prompt_eval_count: 50, eval_count: 5, message: { role: 'assistant', content: '' } };
      // The build check: call `echo`, then answer once the result is back.
      if (sent.tools?.some((tool) => tool.function.name === 'echo') === true) {
        if (sent.messages.some((message) => message.role === 'tool')) line({ model: 'fake', done: false, message: { role: 'assistant', content: 'done' } });
        else line({ model: 'fake', done: false, message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'echo', arguments: { word: 'adminium' } } }] } });
        line(done);
        response.end();
        return;
      }
      asked.push(sent.messages);
      const made = script.shift()?.() ?? { text: 'Done.' };
      line({ model: 'fake', done: false, message: 'calls' in made ? { role: 'assistant', content: '', tool_calls: made.calls.map((call) => ({ function: call })) } : { role: 'assistant', content: made.text } });
      line(done);
      response.end();
    });
  });
  await new Promise<void>((resolve) => model.listen(0, '127.0.0.1', resolve));
  modelUrl = `http://127.0.0.1:${String((model.address() as AddressInfo).port)}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => model.close(() => resolve()));
});

// ── a project on an engine ───────────────────────────────────────────────────

interface Install {
  dir: string;
  meta: MetaDb;
  manager: ConnectionManager;
  mainId: string;
  close: () => Promise<void>;
}

/** A project whose meta store and `main` database are both on the engine: each a database of its own, dropped after. */
async function installOn(engine: MetaEngine): Promise<Install> {
  const dir = await mkdtemp(join(tmpdir(), 'adminium-outside-card-'));
  const handle = await engine.make();
  const { meta } = handle;
  const name = `adminium_outside_${randomBytes(4).toString('hex')}`;
  let dsn: string;
  let drop: () => Promise<void> = async () => undefined;
  if (engine.name === 'sqlite') {
    const file = join(dir, 'main.db');
    new BetterSqlite3(file).close();
    dsn = `sqlite:${file}`;
  } else if (engine.name === 'postgres') {
    const base = process.env['TEST_POSTGRES_URL'] as string;
    const { default: pg } = await import('pg');
    const admin = new pg.Client({ connectionString: base });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${name}"`);
    await admin.end();
    const url = new URL(base);
    url.pathname = `/${name}`;
    dsn = url.toString();
    drop = async () => {
      const again = new pg.Client({ connectionString: base });
      await again.connect();
      await again.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await again.end();
    };
  } else {
    const base = process.env['TEST_MYSQL_URL'] as string;
    const mysql = await import('mysql2/promise');
    const admin = await mysql.createConnection({ uri: base });
    await admin.query(`CREATE DATABASE \`${name}\``);
    await admin.end();
    const url = new URL(base);
    url.pathname = `/${name}`;
    dsn = url.toString();
    drop = async () => {
      const again = await mysql.createConnection({ uri: base });
      await again.query(`DROP DATABASE IF EXISTS \`${name}\``);
      await again.end();
    };
  }
  const registry = new AdapterRegistry<AdapterProvider>();
  await registerAdapters(registry);
  const manager = new ConnectionManager({ meta, crypto: dsnCryptoFromSecret(INSTALL_SECRET), registry, metaDsn: null, blockLoopback: false });
  await syncProjectDatabases({ manager, meta, root: dir, databases: new Map([['main', dsn]]), missing: [], log: () => undefined, warn: () => undefined });
  const main = await manager.connections.findByProjectKey('main');
  if (main === null) throw new Error('the project database was not connected');
  return {
    dir,
    meta,
    manager,
    mainId: main.id,
    async close() {
      await manager.disposeAll().catch(() => undefined);
      await handle.destroy().catch(() => undefined);
      await drop().catch(() => undefined);
      await rm(dir, { recursive: true, force: true });
    },
  };
}

// ── a server, and a Designer session on it ──────────────────────────────────

const DESIGN_PORT = 4797;
const HOST = `127.0.0.1:${String(DESIGN_PORT)}`;
const KEY = 'contact-desk';
const APP = `apps/${KEY}`;

let composed: ComposedServer | undefined;
let install: Install | null = null;
afterEach(async () => {
  script = [];
  asked = [];
  await composed?.app.close();
  composed = undefined;
  await install?.close();
  install = null;
});

type Card = { id: string; type: string; changes?: unknown[]; more?: number; planned?: boolean };
type DesignerEventRow = { kind: string; turn: number; outcome?: string; ok?: boolean; state?: string; stage?: string; message?: string; card?: Card };

/** Asks `probe` every 100 ms until it gives a value; a minute without one fails with `what`. */
async function until<T>(probe: () => Promise<T | undefined>, what: () => string): Promise<T> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    const value = await probe();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`waited a minute: ${what()}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

interface Desk {
  root: string;
  call: (method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) => Promise<{ status: number; body: Record<string, unknown> }>;
  meta: MetaDb;
  mainId: string;
  id: string;
  /** Starts a turn whose model makes these steps; its number. */
  turn: (text: string, steps: ScriptStep[]) => Promise<number>;
  /**
   * The turn's events once it is over, having asked `cards` access cards. One more card than that
   * would hold the turn for an answer that never comes: it fails at once.
   */
  over: (turn: number, cards?: number) => Promise<DesignerEventRow[]>;
  /** The turn's `count`-th "Check this before it goes live" card, once it is asked; fails at once when the turn ends without it. */
  card: (turn: number, count?: number) => Promise<Card>;
  answer: (card: Card, accept: boolean) => Promise<void>;
}

const accessCards = (events: DesignerEventRow[], turn: number): Card[] => events.flatMap((event) => (event.kind === 'card' && event.turn === turn && event.card?.type === 'access-change' ? [event.card] : []));
const ended = (events: DesignerEventRow[], turn: number): boolean => events.some((event) => event.kind === 'turn-finished' && event.turn === turn);

/** The starter's tables, page and role, a contact form's table, and a shop's products: as the files a model writes. */
function appFiles(over: Record<string, unknown> = {}): Record<string, unknown> {
  const parts = starterParts({ key: KEY, name: 'Contact desk', sides: [], version: APP_VERSION });
  const text = (ref: string, max: number) => ({ ref, type: 'text', maxLength: max, nullable: true });
  return {
    ...Object.fromEntries(Object.entries(parts).filter(([file]) => file !== 'manifest/app.json')),
    'manifest/tables/messages.json': { ref: 'messages', label: { 'en-US': 'Message' }, labelPlural: { 'en-US': 'Messages' }, keyField: 'name', columns: [{ ref: 'id', type: 'int', role: 'pk' }, text('name', 80), text('email', 160), text('phone', 40), text('body', 1000)] },
    'manifest/tables/products.json': { ref: 'products', label: { 'en-US': 'Product' }, labelPlural: { 'en-US': 'Products' }, keyField: 'name', columns: [{ ref: 'id', type: 'int', role: 'pk' }, text('name', 80)] },
    ...over,
  };
}
const writes = (files: Record<string, unknown>): { name: string; arguments: Record<string, unknown> }[] =>
  Object.entries(files).map(([file, value]) => ({ name: 'write_file', arguments: { path: `${APP}/${file}`, content: JSON.stringify(value, null, 2) } }));
const APPLY = { name: 'apply_app', arguments: {} };

/** A contact form anyone may send. */
const CONTACT = { table: 'messages', methods: ['POST'], select: ['id'], writable: ['name', 'email', 'body'], humanCheck: true };
const accessFile = (entries: unknown[]): Record<string, unknown> => ({ 'manifest/access.json': { publicAccess: entries } });
/** The starter's staff role with more grants. */
const staffWith = (...more: string[]): Record<string, unknown> => {
  const [staff] = starterParts({ key: KEY, name: 'Contact desk', sides: [], version: APP_VERSION })['manifest/roles.json'] as { permissions: string[] }[];
  return { 'manifest/roles.json': [{ ...staff, permissions: [...(staff?.permissions ?? []), ...more] }] };
};

/** A server in design mode over a project on the engine, with an app made and applied by a first turn of a session that holds nothing from outside. */
async function desk(engine: MetaEngine, first: Record<string, unknown> = appFiles()): Promise<Desk> {
  install = await installOn(engine);
  const root = asProject(install.dir);
  await buildProject({ root, configFile: join(root, 'adminium.config.ts') }, { version: APP_VERSION });
  const { meta, mainId } = install;
  const runService = createRunService({ meta });
  const store: MetaStoreHandle = { meta, url: `${engine.name}://test`, engine: engine.name, source: 'embedded', close: async () => Promise.resolve() };
  composed = await composeServer({
    env: makeEnv({ HOST: '127.0.0.1', ADMINIUM_AI_OLLAMA_BASE_URL: modelUrl, ADMINIUM_AI_MODEL: 'ollama/fake' }),
    metaStore: store,
    manager: install.manager,
    runService,
    applyService: createApplyService({ meta, runService }),
    allowed: { templates: [], widgets: [], widgetContracts: {} },
    logger: false,
    telemetry: false,
    onMetaRelocated: () => undefined,
    project: { root, mode: 'dev', log: () => undefined, warn: () => undefined, databases: ['main'] },
    designer: { mode: 'local' as const, token: 'a'.repeat(64), port: DESIGN_PORT },
    designerBundler: () => true,
  });
  const { app } = composed;
  await app.ready();
  const setup = await app.inject({ method: 'POST', url: '/api/v1/setup/super-admin', headers: { host: HOST }, payload: { email: 'owner@example.test', password: 'a-long-enough-test-password-1!', name: 'Owner' } });
  expect(setup.statusCode, setup.body).toBe(201);
  const owner = String(setup.headers['set-cookie']).split(';')[0] ?? '';
  const call = async (method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown): Promise<{ status: number; body: Record<string, unknown> }> => {
    const res = await app.inject({ method, url, headers: { host: HOST, cookie: owner }, ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }) });
    return { status: res.statusCode, body: (res.body === '' ? {} : res.json()) as Record<string, unknown> };
  };
  script = [() => ({ calls: writes(first) })];
  const made = await call('POST', '/api/v1/designer/sessions', { name: 'Contact desk', target: 'auto', connectionId: 'env:ollama', model: 'fake', text: 'Make me a contact desk.' });
  expect(made.status, JSON.stringify(made.body)).toBe(201);
  const session = made.body['session'] as { id: string; appKey: string };
  expect(session.appKey).toBe(KEY);
  const { id } = session;
  const events = async (): Promise<DesignerEventRow[]> => (await call('GET', `/api/v1/designer/sessions/${id}/events-since?after=0`)).body['events'] as DesignerEventRow[];
  let last: DesignerEventRow[] = [];
  const said = (turn: number) => () => JSON.stringify(last.filter((event) => event.turn === turn && ['card', 'apply', 'check', 'build', 'turn-finished'].includes(event.kind)));
  const over: Desk['over'] = async (turn, cards = 0) =>
    until(async () => {
      last = await events();
      const asked = accessCards(last, turn).length;
      if (asked > cards) throw new Error(`turn ${String(turn)} asked ${String(asked)} access cards, not ${String(cards)}: ${said(turn)()}`);
      return ended(last, turn) ? last.filter((event) => event.turn === turn) : undefined;
    }, said(turn));
  const ready: Desk = {
    root,
    call,
    meta,
    mainId,
    id,
    over,
    turn: async (text, steps) => {
      script = steps;
      const started = await call('POST', `/api/v1/designer/sessions/${id}/turns`, { text });
      expect(started.status, JSON.stringify(started.body)).toBe(202);
      return started.body['turn'] as number;
    },
    card: async (turn, count = 1) =>
      until(async () => {
        last = await events();
        const asked = accessCards(last, turn);
        if (asked.length < count && ended(last, turn)) throw new Error(`turn ${String(turn)} ended with ${String(asked.length)} access cards, not ${String(count)}: ${said(turn)()}`);
        return asked[count - 1];
      }, said(turn)),
    answer: async (card, accept) => {
      const answered = await call('POST', `/api/v1/designer/sessions/${id}/answers`, { cardId: card.id, value: { accept } });
      expect(answered.status, JSON.stringify(answered.body)).toBe(200);
    },
  };
  const opened = await over(1);
  expect(opened.at(-1), said(1)()).toMatchObject({ kind: 'turn-finished', outcome: 'done' });
  return ready;
}

// ── words from outside ──────────────────────────────────────────────────────

const PAGE = '<!doctype html>\n<html><head><title>Harbor Bakery</title></head><body><h1>Harbor Bakery</h1><form action="https://forms.example/send" method="post"><input name="email"><textarea name="body"></textarea></form></body></html>\n';
const files = (desk: Desk) => createAttachments(desk.root);
const attachPage = (desk: Desk): void => {
  files(desk).add(desk.id, { filename: 'index.html', bytes: Buffer.from(PAGE, 'utf8') });
};
const attachStylesheet = (desk: Desk): void => {
  files(desk).add(desk.id, { filename: 'site.css', bytes: Buffer.from('body { color: #222; }\n.hero { padding: 2rem; }\n', 'utf8') });
};
const attachFigma = (desk: Desk): void => {
  files(desk).add(desk.id, {
    filename: 'frame.md',
    bytes: Buffer.from('# Contact\n\nA contact form: name, email and a message.\n', 'utf8'),
    imported: { source: 'figma', figma: { fileKey: 'AbCdEf123456', nodeId: '1:2', version: '42', frame: 'Contact' }, label: 'Contact (Figma)' },
  });
};
const entry = (path: string, text: string): SiteEntry => ({ path, size: Buffer.byteLength(text), type: 'file', read: async () => Buffer.from(text, 'utf8') });
async function attachSite(desk: Desk): Promise<{ id: string; sha256: string }> {
  const judged = await judgeSite('harbor.zip', [entry('index.html', PAGE), entry('css/site.css', 'body { margin: 0; }\n')]);
  const { attachment } = files(desk).addSite(desk.id, { label: 'harbor', judged });
  return { id: attachment.id, sha256: attachment.sha256 };
}

/** A plan the person approved: the contact form's create on messages, and staff given the products. */
function writePlan(desk: Desk, site: { id: string; sha256: string }): void {
  const plan: TemplatePlanFile = {
    version: 1,
    site: { attachment: site.id, name: 'harbor', sha256: site.sha256 },
    at: new Date(0).toISOString(),
    plan: {
      site: { attachment: site.id, name: 'harbor', pages: 1, files: 2 },
      tables: [{ table: 'products', label: 'Products', columns: [{ column: 'name', label: 'Name' }], shownOn: ['Home'], fromTemplate: 3, filler: 0, madeUp: 0, publicRead: [] }],
      forms: [{ form: 'contact', label: 'Contact form', table: 'messages', tableLabel: 'Messages', writable: ['name', 'email', 'body'], linesWritable: [], perHour: null }],
      report: [],
      links: [],
      roles: [{ role: 'staff', tables: ['products'] }],
      added: [],
    },
    answer: { tables: ['products'], decisions: {}, links: {}, takeOutEmpty: true, added: [] },
    approved: { access: [{ table: 'messages', methods: ['POST'], writable: ['name', 'email', 'body'], humanCheck: true }], roles: [{ role: 'staff', tables: ['products'] }] },
  };
  writeFileSync(join(desk.root, APP, 'template-plan.json'), `${JSON.stringify(plan, null, 2)}\n`);
}

// ── what is checked ─────────────────────────────────────────────────────────

/**
 * What strangers may do on the server now: each public endpoint the app's live keys grant, with the methods they
 * grant and what it writes. (An endpoint taken out of the manifest keeps its row; its key no longer grants it.)
 */
async function liveAccess(desk: Desk): Promise<string[]> {
  const keys = (await publicKeysRepo(desk.meta).listManagedBy(KEY)).filter((key) => key.revokedAt === null && key.access !== null);
  const granted = new Map<string, Set<string>>();
  for (const key of keys) {
    for (const [endpoint, methods] of Object.entries(JSON.parse(key.access as string) as Record<string, string[]>)) {
      for (const method of methods) granted.set(endpoint, (granted.get(endpoint) ?? new Set()).add(method));
    }
  }
  const endpoints = await publicEndpointsRepo(desk.meta).listByConnection(desk.mainId);
  return endpoints
    .flatMap((endpoint) => {
      const methods = [...(granted.get(endpoint.id) ?? [])].sort();
      if (methods.length === 0) return [];
      const definition = JSON.parse(endpoint.definition) as { path: string; writable?: string[] };
      return [`${definition.path} ${methods.join(',')}${definition.writable === undefined ? '' : ` writes ${definition.writable.join(',')}`}`];
    })
    .sort();
}
/** What a tool told the model, in every request it was sent. */
const toolSaid = (): string[] => [...new Set(asked.flatMap((messages) => messages.filter((message) => message.role === 'tool').map((message) => message.content ?? '')))];
const applied = (desk: Desk): { access: { table: string; methods: string[]; writable: string[] }[]; roles: Record<string, string[]> } =>
  JSON.parse(readFileSync(join(desk.root, '.adminium', 'designer', 'applied', `${KEY}.json`), 'utf8')) as never;

const ADD_MESSAGES = { kind: 'access', verb: 'add', table: 'messages' };
const CONTACT_LIVE = '/contact_desk_messages POST writes name,email,body';
const applies = (events: DesignerEventRow[]): DesignerEventRow[] => events.filter((event) => event.kind === 'apply');

describe.each(META_ENGINES)('Check this before it goes live, on $name', (engine) => {
  describe.skipIf(!engine.available)('', { timeout: 180_000 }, () => {
    it('is not asked in a session that holds nothing from outside: a new public create applies as it is', async () => {
      const d = await desk(engine);
      const turn = await d.turn('Let people send a message.', [() => ({ calls: [...writes(accessFile([CONTACT])), APPLY] })]);
      expect((await d.over(turn)).at(-1)).toMatchObject({ kind: 'turn-finished', outcome: 'done' });
      expect(await liveAccess(d)).toEqual([CONTACT_LIVE]);
    });

    it('is asked in a session that holds a page from outside, in the server’s words, as no plan’s', async () => {
      const d = await desk(engine);
      attachPage(d);
      const turn = await d.turn('Let people send a message.', [() => ({ calls: [...writes(accessFile([CONTACT])), APPLY] })]);
      const card = await d.card(turn);
      expect(card).toMatchObject({ type: 'access-change', changes: [ADD_MESSAGES], planned: false });
      // Nothing is on the server while the person is asked.
      expect(await liveAccess(d)).toEqual([]);
      await d.answer(card, true);
      expect((await d.over(turn, 1)).at(-1)).toMatchObject({ outcome: 'done' });
    });

    it('“Do not allow” stops the apply, leaves the server as it was, and tells the model what to take out, asked once in the turn', async () => {
      const d = await desk(engine);
      attachPage(d);
      const turn = await d.turn('Let people send a message.', [() => ({ calls: [...writes(accessFile([CONTACT])), APPLY] }), () => ({ text: 'The form is ready.' })]);
      await d.answer(await d.card(turn), false);
      const events = await d.over(turn, 1);
      // apply_app's apply, and the turn's own last one: both refused, the second without asking again.
      const refused = applies(events);
      expect(refused).toHaveLength(2);
      for (const apply of refused) {
        expect(apply).toMatchObject({ ok: false, state: 'not-applied', stage: 'access' });
        expect(apply.message).toContain('The person did not allow this: strangers could add rows to messages.');
      }
      expect(events.at(-1)).toMatchObject({ kind: 'turn-finished', outcome: 'not-applied' });
      expect(events.some((event) => event.kind === 'build')).toBe(false);
      expect(await liveAccess(d)).toEqual([]);
      expect(applied(d).access).toEqual([]);
      expect(toolSaid()).toContainEqual(
        'It was not applied (access): The person did not allow this: strangers could add rows to messages. Build without it (take it out of access.json, roles.json or the page\'s code), then apply_app again. Do not ask for it again in this turn.',
      );
    });

    it('“Allow” applies it; the same change is not asked again in the turn, and the next turn is measured from it', async () => {
      const d = await desk(engine);
      attachStylesheet(d);
      const turn = await d.turn('Let people send a message.', [() => ({ calls: [...writes(accessFile([CONTACT])), APPLY] }), () => ({ calls: [APPLY] }), () => ({ text: 'The form is live.' })]);
      await d.answer(await d.card(turn), true);
      const events = await d.over(turn, 1);
      expect(applies(events).map((apply) => apply.ok)).toEqual([true, true, true]);
      expect(events.at(-1)).toMatchObject({ outcome: 'done' });
      expect(await liveAccess(d)).toEqual([CONTACT_LIVE]);
      expect(applied(d).access).toEqual([{ table: 'messages', methods: ['POST'], select: ['id'], writable: ['name', 'email', 'body'], humanCheck: true, rows: '{}' }]);

      const next = await d.turn('Make the title bigger.', [() => ({ calls: [APPLY] }), () => ({ text: 'Done.' })]);
      expect((await d.over(next)).at(-1)).toMatchObject({ outcome: 'done' });
    });

    it('is asked in a session that holds a frame imported from Figma', async () => {
      const d = await desk(engine);
      attachFigma(d);
      const turn = await d.turn('Build the contact frame.', [() => ({ calls: [...writes(accessFile([CONTACT])), APPLY] })]);
      const card = await d.card(turn);
      expect(card).toMatchObject({ type: 'access-change', changes: [ADD_MESSAGES], planned: false });
      await d.answer(card, true);
      expect((await d.over(turn, 1)).at(-1)).toMatchObject({ outcome: 'done' });
      expect(await liveAccess(d)).toEqual([CONTACT_LIVE]);
    });

    it('is never asked for access taken away', async () => {
      const d = await desk(engine, appFiles({ ...accessFile([CONTACT]), ...staffWith('table:@messages:read') }));
      expect(await liveAccess(d)).toEqual([CONTACT_LIVE]);
      attachPage(d);
      const turn = await d.turn('Close the form.', [() => ({ calls: [...writes({ ...accessFile([]), ...staffWith() }), APPLY] })]);
      const events = await d.over(turn);
      expect(applies(events).map((apply) => apply.ok)).toEqual([true, true]);
      expect(events.at(-1)).toMatchObject({ outcome: 'done' });
      expect(applied(d)).toMatchObject({ access: [], roles: { staff: expect.not.arrayContaining(['table:@messages:read']) } });
      expect(await liveAccess(d)).toEqual([]);
    });

    it('asks nothing a template plan the person approved covers, and only what goes beyond it', async () => {
      const d = await desk(engine);
      writePlan(d, await attachSite(d));
      const covered = await d.turn('Build the contact form.', [() => ({ calls: [...writes(accessFile([CONTACT])), APPLY] })]);
      expect((await d.over(covered)).at(-1)).toMatchObject({ outcome: 'done' });
      expect(await liveAccess(d)).toEqual([CONTACT_LIVE]);

      // A column the plan did not let strangers write, and a table it did not let them read.
      const beyond = await d.turn('Ask for a phone number, and show the products.', [
        () => ({ calls: [...writes(accessFile([{ ...CONTACT, writable: [...CONTACT.writable, 'phone'] }, { table: 'products', methods: ['GET'], select: ['id', 'name'] }])), APPLY] }),
      ]);
      const card = await d.card(beyond);
      expect(card).toMatchObject({
        type: 'access-change',
        changes: [
          { kind: 'access', verb: 'write-columns', table: 'messages', columns: ['phone'] },
          { kind: 'access', verb: 'read', table: 'products' },
        ],
        planned: true,
      });
      await d.answer(card, false);
      expect((await d.over(beyond, 1)).at(-1)).toMatchObject({ outcome: 'not-applied' });
      expect(await liveAccess(d)).toEqual([CONTACT_LIVE]);
    });

    it('asks nothing of what the plan approved for a role, and asks for a grant on a table it does not name', async () => {
      const d = await desk(engine);
      writePlan(d, await attachSite(d));
      const covered = await d.turn('Let the staff see the products.', [() => ({ calls: [...writes(staffWith('table:@products:read')), APPLY] })]);
      expect((await d.over(covered)).at(-1)).toMatchObject({ outcome: 'done' });

      const beyond = await d.turn('Let the staff delete items.', [() => ({ calls: [...writes(staffWith('table:@products:read', 'table:@items:delete')), APPLY] })]);
      const card = await d.card(beyond);
      expect(card).toMatchObject({ type: 'access-change', changes: [{ kind: 'role', role: 'staff', isNew: false }], planned: true });
      await d.answer(card, true);
      expect((await d.over(beyond, 1)).at(-1)).toMatchObject({ outcome: 'done' });
      expect(applied(d).roles['staff']).toContain('table:@items:delete');
    });

    it('refuses, outside a turn, what the person did not allow: a restore and a hand save apply none of it', async () => {
      const d = await desk(engine);
      // A version that lets strangers write messages, made in a turn before anything came from outside, then taken back.
      const opened = await d.turn('Let people send a message.', [() => ({ calls: [...writes(accessFile([CONTACT])), APPLY] })]);
      expect((await d.over(opened)).at(-1)).toMatchObject({ outcome: 'done' });
      const closed = await d.turn('Close the form again.', [() => ({ calls: [...writes(accessFile([])), APPLY] })]);
      expect((await d.over(closed)).at(-1)).toMatchObject({ outcome: 'done' });
      expect(await liveAccess(d)).toEqual([]);
      attachPage(d);

      // Going back to the version that grants it (kept as a version of its own): never asked, so not applied.
      const back = await d.call('POST', `/api/v1/designer/sessions/${d.id}/versions/2/restore`, { record: true });
      expect(back.status, JSON.stringify(back.body)).toBe(200);
      expect(back.body).toMatchObject({ applied: false });
      const restored = applies(await d.over(closed)).at(-1);
      expect(restored).toMatchObject({ ok: false, state: 'not-applied', stage: 'access' });
      expect(restored?.message).toMatch(/^Not applied: the app would let strangers do more than the person allowed \(strangers could add rows to messages\)\./);
      expect(await liveAccess(d)).toEqual([]);

      // A hand save of a dashboard page, as the person makes one.
      const page = `${APP}/manifest/pages/${KEY}-items.json`;
      const handSave = async (fallback: string): Promise<string> => {
        const listed = (await d.call('GET', `/api/v1/designer/sessions/${d.id}/files`)).body['groups'] as { files: { path: string; hash: string }[] }[];
        const base = listed.flatMap((group) => group.files).find((file) => file.path === page)?.hash;
        expect(base, page).toBeDefined();
        const content = readFileSync(join(d.root, page), 'utf8').replace(/"fallback": "[^"]*"/, `"fallback": "${fallback}"`);
        const saved = await d.call('PUT', `/api/v1/designer/sessions/${d.id}/files`, { files: [{ path: page, content, base }] });
        expect(saved.status, JSON.stringify(saved.body)).toBe(200);
        expect(saved.body).toMatchObject({ applied: false, problems: { stage: 'apply' } });
        return (saved.body['problems'] as { lines: string[] }).lines[0] ?? '';
      };
      expect(await handSave('Things')).toMatch(/^Not applied: the app would let strangers do more than the person allowed \(strangers could add rows to messages\)\./);
      expect(await liveAccess(d)).toEqual([]);

      // The next turn asks it, and the person says no; the files still hold it, and the next hand save applies none of it.
      const asking = await d.turn('Keep going.', [() => ({ calls: [APPLY] }), () => ({ text: 'Done.' })]);
      await d.answer(await d.card(asking), false);
      expect((await d.over(asking, 1)).at(-1)).toMatchObject({ outcome: 'not-applied' });
      expect(await handSave('Stuff')).toMatch(/^Not applied: the person did not allow this, and it is still in the app's files: strangers could add rows to messages\./);
      expect(await liveAccess(d)).toEqual([]);
      expect(applied(d).access).toEqual([]);

    });

    it('lists twelve changes and how many more, and “Do not allow” refuses every one of them', async () => {
      const boxes = Array.from({ length: 14 }, (_unused, n) => `box_${String(n + 1).padStart(2, '0')}`);
      const tables = Object.fromEntries(
        boxes.map((ref) => [`manifest/tables/${ref}.json`, { ref, label: { 'en-US': 'Box' }, labelPlural: { 'en-US': 'Boxes' }, keyField: 'name', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'name', type: 'text', maxLength: 80, nullable: true }] }]),
      );
      const d = await desk(engine, appFiles(tables));
      attachPage(d);
      const turn = await d.turn('Let people drop things in every box.', [
        () => ({ calls: [...writes(accessFile(boxes.map((table) => ({ table, methods: ['POST'], select: ['id'], writable: ['name'], humanCheck: true })))), APPLY] }),
        () => ({ text: 'The boxes are open.' }),
      ]);
      const card = await d.card(turn);
      expect(card.changes).toEqual(boxes.slice(0, 12).map((table) => ({ kind: 'access', verb: 'add', table })));
      expect(card.more).toBe(2);
      await d.answer(card, false);
      // apply_app's apply and the turn's last: both refused, the second asking nothing of the two past the twelve.
      const events = await d.over(turn, 1);
      expect(applies(events).map((apply) => apply.stage)).toEqual(['access', 'access']);
      expect(await liveAccess(d)).toEqual([]);
      expect(applied(d).access).toEqual([]);
      const told = toolSaid().find((said) => said.startsWith('It was not applied (access):')) ?? '';
      expect(told).toContain(`The person did not allow this: ${boxes.slice(0, 12).map((table) => `strangers could add rows to ${table}`).join('; ')}; and 2 more.`);
    });

    it('is asked of an app built from a template plan, in a session that holds nothing from outside', async () => {
      const d = await desk(engine);
      writePlan(d, { id: 'att_00000000000000000000', sha256: '0'.repeat(64) });
      const turn = await d.turn('Show the products.', [() => ({ calls: [...writes(accessFile([{ table: 'products', methods: ['GET'], select: ['id', 'name'] }])), APPLY] })]);
      const card = await d.card(turn);
      expect(card).toMatchObject({ changes: [{ kind: 'access', verb: 'read', table: 'products' }], planned: true });
      await d.answer(card, false);
      expect((await d.over(turn, 1)).at(-1)).toMatchObject({ outcome: 'not-applied' });
      expect(await liveAccess(d)).toEqual([]);
    });

    it('is asked of an app whose screens are a template’s, in a session that holds nothing from outside', async () => {
      const d = await desk(engine);
      writeFileSync(join(d.root, APP, 'look.json'), JSON.stringify({ skill: 'clean', templateSides: ['customer'] }));
      const turn = await d.turn('Let people send a message.', [() => ({ calls: [...writes(accessFile([CONTACT])), APPLY] })]);
      const card = await d.card(turn);
      expect(card).toMatchObject({ changes: [ADD_MESSAGES], planned: false });
      await d.answer(card, false);
      expect((await d.over(turn, 1)).at(-1)).toMatchObject({ outcome: 'not-applied' });
      expect(await liveAccess(d)).toEqual([]);
    });

    it('asks for access widened with no new column named: a read that loses its columns, a create its check, a read its filter', async () => {
      const PRODUCTS = { table: 'products', methods: ['GET'], select: ['id', 'name'] };
      const OPEN_ITEMS = { table: 'items', methods: ['GET'], select: ['id', 'title', 'status'], filters: [{ column: 'status', op: 'eq', value: 'open' }] };
      const d = await desk(engine, appFiles(accessFile([PRODUCTS, CONTACT, OPEN_ITEMS])));
      attachPage(d);
      const { select: _select, ...allProducts } = PRODUCTS;
      const { humanCheck: _check, ...unchecked } = CONTACT;
      const { filters: _filters, ...allItems } = OPEN_ITEMS;
      const turn = await d.turn('Open it all up.', [() => ({ calls: [...writes(accessFile([allProducts, unchecked, allItems])), APPLY] })]);
      const card = await d.card(turn);
      expect(card).toMatchObject({
        changes: [
          { kind: 'access', verb: 'read-all', table: 'products' },
          { kind: 'access', verb: 'no-check', table: 'messages' },
          { kind: 'access', verb: 'hidden-rows', table: 'items' },
        ],
        planned: false,
      });
      expect(card.more).toBeUndefined();
      await d.answer(card, true);
      expect((await d.over(turn, 1)).at(-1)).toMatchObject({ outcome: 'done' });
    });

    it('asks nothing of a planned role’s page of a plan table, and asks for its page of another table', async () => {
      const page = (table: string) => ({ [`manifest/pages/${KEY}-${table}.json`]: { ref: `${KEY}-${table}`, template: 'page-crud', title: { key: `${KEY}.${table}`, fallback: table }, nav: { group: 'main', icon: 'list', order: 3 }, bindings: { rows: table } } });
      const d = await desk(engine, appFiles({ ...page('products'), ...page('messages') }));
      writePlan(d, await attachSite(d));
      const covered = await d.turn('Let the staff open the products.', [() => ({ calls: [...writes(staffWith('table:@products:read', `page:@${KEY}-products:view`)), APPLY] })]);
      expect((await d.over(covered)).at(-1)).toMatchObject({ outcome: 'done' });

      const beyond = await d.turn('And the messages page.', [() => ({ calls: [...writes(staffWith('table:@products:read', `page:@${KEY}-products:view`, `page:@${KEY}-messages:view`)), APPLY] })]);
      const card = await d.card(beyond);
      expect(card).toMatchObject({ changes: [{ kind: 'role', role: 'staff', isNew: false }], planned: true });
      await d.answer(card, false);
      expect((await d.over(beyond, 1)).at(-1)).toMatchObject({ outcome: 'not-applied' });
      expect(toolSaid()).toContainEqual(expect.stringContaining('the role "staff" could do more than before (1 new right)'));
    });
  });
});
