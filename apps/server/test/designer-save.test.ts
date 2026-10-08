// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Code tab's three routes, on a whole server over a real project folder:
 * the list of an app's files, one file's text, and a save by hand.
 *
 * A save is the one place a person writes an app's files with no model in
 * between, and it runs the engine's check, build and apply on the whole
 * folder. So what is tried here is mostly what must NOT happen: a path that
 * is not on the list is read or written, half a save stays on disk, a save
 * applies a turn's unfinished work under the person's name, two writers have
 * the folder at once. Every body is sent as the page will send it, through
 * the real route.
 */
import { createServer, type Server } from 'node:http';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

import { rolesRepo, usersRepo, type MetaDb } from '@adminium/meta';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { hashPassword } from '../src/auth/passwords.js';
import { composeServer, type ComposedServer } from '../src/compose.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import type { MetaStoreHandle } from '../src/meta/store.js';
import { builtInStylesDir } from '../src/project/apps/design-skills.js';
import { cleanLook, missingFonts } from '../src/project/apps/look.js';
import { addSide, starterParts } from '../src/project/apps/scaffold-app.js';
import { buildProject } from '../src/project/build.js';
import { APP_VERSION } from '../src/version.js';
import { asProject, canBuildSides } from './app-project-helpers.js';
import { makeEnv } from './helpers.js';
import { makeInstall, type Install } from './project-fixtures.js';

// ── a model on this machine ──────────────────────────────────────────────────

type ScriptStep = () => { text: string } | { calls: { name: string; arguments: Record<string, unknown> }[] };
let model: Server;
let modelUrl: string;
/** A model's steps in order; after them it says it is done. */
let script: ScriptStep[] = [];
/** The next reply is held until the test lets it go. */
let waits = false;
const held: (() => void)[] = [];
/** The model's server refuses the next request (a key that stopped working): the turn fails there. */
let refuses = false;
/** What each request to the model carried. */
let asked: { role: string; content?: string }[][] = [];

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
      if (refuses) {
        refuses = false;
        response.statusCode = 401;
        response.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }
      const step = script.shift();
      const finish = (): void => {
        const made = step?.() ?? { text: 'Done.' };
        line({ model: 'fake', done: false, message: 'calls' in made ? { role: 'assistant', content: '', tool_calls: made.calls.map((call) => ({ function: call })) } : { role: 'assistant', content: made.text } });
        line(done);
        response.end();
      };
      if (waits && step === undefined) {
        line({ model: 'fake', done: false, message: { role: 'assistant', content: 'Thinking…' } });
        held.push(finish);
        return;
      }
      finish();
    });
  });
  await new Promise<void>((resolve) => model.listen(0, '127.0.0.1', resolve));
  modelUrl = `http://127.0.0.1:${String((model.address() as AddressInfo).port)}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => model.close(() => resolve()));
});

// ── a server ─────────────────────────────────────────────────────────────────

let composed: ComposedServer | undefined;
let root = '';
let install: Install | null = null;
/** What a save, a style change or going back waits on at a step, when a test holds it open; and a write that is made to fail. */
let gate: { at: string; reached: () => void; open: Promise<void> } | null = null;
let failWrite: string | null = null;

afterEach(async () => {
  for (const release of held.splice(0)) release();
  await composed?.app.close();
  composed = undefined;
  await install?.close();
  install = null;
  script = [];
  waits = false;
  refuses = false;
  asked = [];
  gate = null;
  failWrite = null;
});

const DESIGN_PORT = 4798;
const HOST = `127.0.0.1:${String(DESIGN_PORT)}`;
const PASSWORD = 'a-long-enough-test-password-1!';

interface Reply {
  status: number;
  body: Record<string, unknown>;
  headers: Record<string, unknown>;
}
interface Client {
  meta: MetaDb;
  owner: string;
  call: (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: unknown, cookie?: string) => Promise<Reply>;
}

async function server(opts: { live?: boolean; holdCapMs?: number } = {}): Promise<Client> {
  install = await makeInstall();
  root = asProject(install.dir);
  await buildProject({ root, configFile: join(root, 'adminium.config.ts') }, { version: APP_VERSION });
  const { meta } = install;
  const runService = createRunService({ meta });
  const store: MetaStoreHandle = { meta, url: 'sqlite::memory:', engine: 'sqlite', source: 'embedded', close: async () => Promise.resolve() };
  composed = await composeServer({
    env: makeEnv({ HOST: '127.0.0.1', ADMINIUM_AI_OLLAMA_BASE_URL: modelUrl, ADMINIUM_AI_MODEL: 'ollama/fake', ...(opts.live === true ? { ADMINIUM_DESIGNER: 'live' } : {}) }),
    metaStore: store,
    manager: install.manager,
    runService,
    applyService: createApplyService({ meta, runService }),
    allowed: { templates: [], widgets: [], widgetContracts: {} },
    logger: false,
    telemetry: false,
    onMetaRelocated: () => undefined,
    project: { root, mode: 'dev', log: () => undefined, warn: () => undefined, databases: ['main'] },
    ...(opts.live === true ? {} : { designer: { mode: 'local' as const, token: 'a'.repeat(64), port: DESIGN_PORT } }),
    designerBundler: () => true,
    designerSeam: async (step, detail) => {
      if (step === 'write' && detail === failWrite) throw new Error('the disk is full');
      if (gate !== null && gate.at === `${step}:${detail ?? ''}`) {
        gate.reached();
        await gate.open;
      }
    },
    ...(opts.holdCapMs === undefined ? {} : { designerHoldCapMs: opts.holdCapMs }),
  });
  const { app } = composed;
  await app.ready();
  const setup = await app.inject({ method: 'POST', url: '/api/v1/setup/super-admin', headers: { host: HOST }, payload: { email: 'owner@example.test', password: PASSWORD, name: 'Owner' } });
  expect(setup.statusCode, setup.body).toBe(201);
  const owner = String(setup.headers['set-cookie']).split(';')[0] ?? '';
  return {
    meta,
    owner,
    call: async (method, url, payload, cookie = owner) => {
      const res = await app.inject({ method, url, headers: { host: HOST, ...(cookie === '' ? {} : { cookie }) }, ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }) });
      let body: Record<string, unknown> = {};
      try {
        body = res.body === '' ? {} : (res.json() as Record<string, unknown>);
      } catch {
        body = { raw: res.body };
      }
      return { status: res.statusCode, body, headers: res.headers as Record<string, unknown> };
    },
  };
}

/** Hold the next save, style change or restore open at a step, until `open()` is called. */
function holdAt(at: string): { reached: Promise<void>; open: () => void } {
  let open = (): void => undefined;
  let reached = (): void => undefined;
  const arrived = new Promise<void>((resolve) => {
    reached = resolve;
  });
  gate = {
    at,
    reached,
    open: new Promise<void>((resolve) => {
      open = resolve;
    }),
  };
  return {
    reached: arrived,
    open: () => {
      gate = null;
      open();
    },
  };
}

const APP = 'apps/repair-desk';
const starter = (): Record<string, unknown> => starterParts({ key: 'repair-desk', name: 'Repair desk', sides: [], version: APP_VERSION });
const writesStarter: ScriptStep = () => ({
  calls: Object.entries(starter())
    .filter(([file]) => file !== 'manifest/app.json')
    .map(([file, value]) => ({ name: 'write_file', arguments: { path: `${APP}/${file}`, content: JSON.stringify(value, null, 2) } })),
});

type EventRow = { seq: number; kind: string; turn: number; by?: string; outcome?: string; what?: string; name?: string; ok?: boolean; skill?: string };
const eventsOf = async (client: Client, id: string): Promise<EventRow[]> => (await client.call('GET', `/api/v1/designer/sessions/${id}/events-since?after=0`)).body['events'] as EventRow[];
async function finishedTurn(client: Client, id: string, turn: number): Promise<EventRow[]> {
  let events: EventRow[] = [];
  await vi.waitFor(
    async () => {
      events = await eventsOf(client, id);
      expect(events.filter((event) => event.kind === 'turn-finished')).toHaveLength(turn);
    },
    { timeout: 30_000, interval: 100 },
  );
  return events;
}

interface Listed {
  path: string;
  label: string;
  hash: string;
  size: number;
}
const filesUrl = (id: string): string => `/api/v1/designer/sessions/${id}/files`;
async function listed(client: Client, id: string): Promise<{ groups: { key: string; files: Listed[] }[]; busy: string | null; version: number | null; all: Map<string, Listed> }> {
  const res = await client.call('GET', filesUrl(id));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const groups = res.body['groups'] as { key: string; files: Listed[] }[];
  return { groups, busy: res.body['busy'] as string | null, version: res.body['version'] as number | null, all: new Map(groups.flatMap((group) => group.files).map((file) => [file.path, file])) };
}
/** A save as the page sends it: each file whole, with the hash the list gave it. */
async function save(client: Client, id: string, files: Record<string, string>, bases: Record<string, string> = {}): Promise<Reply> {
  const { all } = await listed(client, id);
  return client.call('PUT', filesUrl(id), { files: Object.entries(files).map(([path, content]) => ({ path, content, base: bases[path] ?? all.get(path)?.hash ?? '0'.repeat(64) })) });
}
const disk = (path: string): string => readFileSync(join(root, path), 'utf8');
/** The files a session holds as the person's own edits, as its file on disk has them (no route says them). */
const handEdits = (id: string): string[] | undefined => (JSON.parse(disk(`.adminium/designer/sessions/${id}/session.json`)) as { handEdits?: string[] }).handEdits;
const reason = (reply: Reply): unknown => (reply.body['error'] as { details?: { reason?: unknown } } | undefined)?.details?.reason;
const details = (reply: Reply): Record<string, unknown> => (reply.body['error'] as { details?: Record<string, unknown> } | undefined)?.details ?? {};

/**
 * A server with an app the Designer built in one turn (a table, two dashboard
 * pages) and, with `side`, a customer side whose style was then changed from
 * the page: so the folder is exactly what the newest version holds.
 */
async function withApp(opts: { side?: boolean; holdCapMs?: number } = {}): Promise<{ client: Client; id: string }> {
  const client = await server(opts.holdCapMs === undefined ? {} : { holdCapMs: opts.holdCapMs });
  script = [writesStarter];
  const created = await client.call('POST', '/api/v1/designer/sessions', { name: 'Repair desk', target: 'auto', connectionId: 'env:ollama', model: 'fake', text: 'Make me a repair desk.' });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const id = (created.body['session'] as { id: string }).id;
  expect((await finishedTurn(client, id, 1)).at(-1)).toMatchObject({ outcome: 'done' });
  if (opts.side === true) {
    addSide({ root, key: 'repair-desk', name: 'Repair desk', side: 'customer' });
    writeFileSync(join(root, APP, 'design.md'), '# Repair desk\n\nPlain and quick.\n');
    // The style's fonts are not in this project, and a turn would first ask for them on a card: this app does without them.
    const without = missingFonts(root, cleanLook({ skill: 'clean' }), { builtInDir: builtInStylesDir() }).map((font) => font.family);
    writeFileSync(join(root, APP, 'look.json'), JSON.stringify({ skill: 'clean', without }));
    const styled = await client.call('POST', `/api/v1/designer/sessions/${id}/look`, { skill: 'clean' });
    expect(styled.status, JSON.stringify(styled.body)).toBe(200);
    expect(styled.body).toMatchObject({ applied: true, version: { n: 2 } });
  }
  return { client, id };
}

const APP_TSX = `${APP}/customer/src/App.tsx`;
const DESIGN_CSS = `${APP}/customer/src/design.css`;
const BRIEF = `${APP}/design.md`;
const PAGE = `${APP}/manifest/pages/repair-desk-items.json`;

describe.skipIf(!canBuildSides)('the files of an app, opened and saved by hand', { timeout: 180_000 }, () => {
  it('lists what a person may open, gives one file’s text, and answers 404 for every path that is not on the list', async () => {
    const { client, id } = await withApp({ side: true });
    const list = await client.call('GET', filesUrl(id));
    expect(list.headers['cache-control']).toBe('no-store');
    const { groups, busy, version, all } = await listed(client, id);
    expect(groups.map((group) => group.key)).toEqual(['customer', 'dashboard', 'settings']);
    expect(groups[0]?.files.map((file) => file.label)).toEqual(expect.arrayContaining(['customer/App.tsx', 'customer/design.css']));
    expect(groups[1]?.files.map((file) => file.label)).toEqual(['dashboard/pages/items.json', 'dashboard/pages/requests.json']);
    expect(groups[2]?.files.map((file) => file.label)).toEqual(['design.md', 'look.json', 'app.json']);
    expect({ busy, version }).toEqual({ busy: null, version: 2 });
    for (const never of ['theme.css', 'fonts.css', 'main.tsx', 'app.css']) expect([...all.keys()], never).not.toContain(`${APP}/customer/src/${never}`);

    const opened = await client.call('GET', `${filesUrl(id)}/content?path=${encodeURIComponent(APP_TSX)}`);
    expect(opened.status, JSON.stringify(opened.body)).toBe(200);
    expect(opened.headers['cache-control']).toBe('no-store');
    expect(opened.body).toEqual({ path: APP_TSX, content: disk(APP_TSX), hash: all.get(APP_TSX)?.hash });

    // Not there and not allowed are one answer.
    mkdirSync(join(root, 'apps/other/manifest'), { recursive: true });
    writeFileSync(join(root, 'apps/other/manifest/app.json'), '{}');
    mkdirSync(join(root, 'hooks'), { recursive: true });
    writeFileSync(join(root, 'hooks/x.ts'), 'export {};');
    writeFileSync(join(root, 'secret.ts'), 'export const key = 1;');
    symlinkSync(join(root, 'secret.ts'), join(root, APP, 'customer/src/linked.ts'));
    for (const path of BREAKING) {
      const res = await client.call('GET', `${filesUrl(id)}/content?path=${encodeURIComponent(path)}`);
      expect([res.status, (res.body['error'] as { code?: string } | undefined)?.code], path).toEqual([404, 'NOT_FOUND']);
      expect(JSON.stringify(res.body), path).not.toContain('export const key');
    }
    expect((await client.call('GET', `${filesUrl(id)}/content`)).status).toBe(422);
    expect((await client.call('GET', `${filesUrl(id)}/content?path=${'a'.repeat(301)}`)).status).toBe(422);

    // A file that is not text is on no list, and opening it says why, with no new kind of error.
    writeFileSync(join(root, APP, 'customer/src/blob.ts'), Buffer.from([0x61, 0x00, 0x62]));
    expect((await listed(client, id)).all.has(`${APP}/customer/src/blob.ts`)).toBe(false);
    const blob = await client.call('GET', `${filesUrl(id)}/content?path=${encodeURIComponent(`${APP}/customer/src/blob.ts`)}`);
    expect([blob.status, (blob.body['error'] as { code?: string }).code, reason(blob)]).toEqual([422, 'VALIDATION_FAILED', 'NOT_TEXT']);
  });

  it('saves nothing at all when one path of a save is not on the list, however it is spelt', async () => {
    const { client, id } = await withApp({ side: true });
    mkdirSync(join(root, 'hooks'), { recursive: true });
    writeFileSync(join(root, 'hooks/x.ts'), 'export {};');
    const before = disk(BRIEF);
    const good = (await listed(client, id)).all.get(BRIEF)?.hash as string;
    const said = (await eventsOf(client, id)).length;
    for (const path of BREAKING) {
      const res = await client.call('PUT', filesUrl(id), {
        files: [
          { path: BRIEF, content: '# Changed\n', base: good },
          { path, content: 'x', base: '0'.repeat(64) },
        ],
      });
      expect([res.status, (res.body['error'] as { code?: string } | undefined)?.code], path).toEqual([404, 'NOT_FOUND']);
      expect(disk(BRIEF), path).toBe(before);
    }
    // A path that does not exist yet is not made, and a folder is no file.
    expect(existsSync(join(root, APP, 'customer/src/New.tsx'))).toBe(false);

    // What the body's own shape refuses: the same path twice, 41 files, no base, a NUL, a file too large, no file.
    const file = { path: BRIEF, content: '# Changed\n', base: good };
    const shapes: [string, unknown][] = [
      ['twice', { files: [file, file] }],
      ['41 files', { files: Array.from({ length: 41 }, (_unused, n) => ({ ...file, path: `${APP}/customer/src/f${String(n)}.ts` })) }],
      ['no base', { files: [{ path: BRIEF, content: 'x' }] }],
      ['a stale shape of base', { files: [{ ...file, base: 'abc' }] }],
      ['263 KB', { files: [{ ...file, content: 'x'.repeat(263 * 1024) }] }],
      ['no file', { files: [] }],
      ['no files', {}],
    ];
    for (const [name, body] of shapes) {
      const res = await client.call('PUT', filesUrl(id), body);
      expect([res.status, (res.body['error'] as { code?: string } | undefined)?.code], name).toEqual([422, 'VALIDATION_FAILED']);
      expect(disk(BRIEF), name).toBe(before);
    }
    // A NUL is refused before the route is reached, as in any request to this server.
    const nul = await client.call('PUT', filesUrl(id), { files: [{ ...file, content: 'a\u0000b' }] });
    expect([nul.status, (nul.body['error'] as { code?: string } | undefined)?.code]).toEqual([400, 'VALIDATION_FAILED']);
    expect(disk(BRIEF)).toBe(before);
    // 40 files and a body of some megabytes are within what a save takes: refused for its paths, not for its size.
    const many = await client.call('PUT', filesUrl(id), { files: Array.from({ length: 40 }, (_unused, n) => ({ path: `${APP}/customer/src/f${String(n)}.ts`, content: 'y'.repeat(60 * 1024), base: good })) });
    expect(many.status, JSON.stringify(many.body).slice(0, 300)).toBe(404);
    // Nothing was kept as a version, nothing is recorded as the person's edit, and no page was told anything happened.
    expect(await eventsOf(client, id)).toHaveLength(said);
    expect((await listed(client, id)).version).toBe(2);
    expect(handEdits(id)).toBeUndefined();
  });

  it('refuses a save whose file changed since it was opened, names only that file, and writes none of the others', async () => {
    const { client, id } = await withApp({ side: true });
    const { all } = await listed(client, id);
    const before = { brief: disk(BRIEF), css: disk(DESIGN_CSS), tsx: disk(APP_TSX) };
    // The Designer, a style change or the person's own editor rewrote one of three since the page read them.
    writeFileSync(join(root, DESIGN_CSS), `${before.css}\n.late { color: red; }\n`);
    const stale = await client.call('PUT', filesUrl(id), {
      files: [
        { path: BRIEF, content: '# Mine\n', base: all.get(BRIEF)?.hash },
        { path: DESIGN_CSS, content: '.mine {}\n', base: all.get(DESIGN_CSS)?.hash },
        { path: APP_TSX, content: `${before.tsx}\n// mine\n`, base: all.get(APP_TSX)?.hash },
      ],
    });
    expect([stale.status, reason(stale)]).toEqual([409, 'FILES_CHANGED']);
    expect(details(stale)['changed']).toEqual([{ path: DESIGN_CSS, hash: (await listed(client, id)).all.get(DESIGN_CSS)?.hash }]);
    expect(disk(BRIEF)).toBe(before.brief);
    expect(disk(APP_TSX)).toBe(before.tsx);
    expect(disk(DESIGN_CSS)).toContain('.late');
    // A hash that was never this file's is the same refusal.
    const wrong = await save(client, id, { [BRIEF]: '# Mine\n' }, { [BRIEF]: 'f'.repeat(64) });
    expect([wrong.status, reason(wrong)]).toEqual([409, 'FILES_CHANGED']);
    expect(disk(BRIEF)).toBe(before.brief);
  });

  it('writes all of a save or none of it: a write that fails puts the earlier files back, byte for byte, and lets the folder go', async () => {
    const { client, id } = await withApp({ side: true });
    // A file with its own line ends and a byte-order mark: what is put back is the bytes, not a reading of them.
    const original = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('# Repair desk\r\n\r\nPlain.\r\n')]);
    writeFileSync(join(root, BRIEF), original);
    const css = disk(DESIGN_CSS);
    failWrite = DESIGN_CSS;
    const failed = await save(client, id, { [BRIEF]: '# Rewritten\n', [DESIGN_CSS]: '.mine {}\n' });
    expect(failed.status).toBe(500);
    expect(readFileSync(join(root, BRIEF)).equals(original)).toBe(true);
    expect(disk(DESIGN_CSS)).toBe(css);
    expect(handEdits(id) ?? []).toEqual([]);
    expect((await eventsOf(client, id)).filter((event) => event.kind === 'version')).toHaveLength(2);
    // The folder was handed back: the page is told, and the next save goes through.
    expect((await eventsOf(client, id)).slice(-2).map((event) => [event.kind, event.what, event.by])).toEqual([['hold', 'save', 'person'], ['released', 'save', 'person']]);
    failWrite = null;
    expect((await listed(client, id)).busy).toBeNull();
    // (The brief was rewritten on disk above, outside any version: it goes with the save, or the save would be refused for it.)
    const again = await save(client, id, { [BRIEF]: '# Rewritten\n', [DESIGN_CSS]: '.mine { color: teal; }\n' });
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(again.body).toMatchObject({ applied: true });
  });

  it('applies a save, keeps it as a version named for the files, says so as a person’s events, and tells the Designer’s next turn', async () => {
    const { client, id } = await withApp({ side: true });
    const one = await save(client, id, { [DESIGN_CSS]: '.mine { color: teal; }\n' });
    expect(one.status, JSON.stringify(one.body)).toBe(200);
    expect(one.body).toMatchObject({ applied: true, version: { n: 3, name: 'v3 · Your edit to design.css' } });
    expect(one.body).not.toHaveProperty('problems');
    expect(one.body['files']).toEqual([{ path: DESIGN_CSS, hash: (await listed(client, id)).all.get(DESIGN_CSS)?.hash }]);
    expect(disk(DESIGN_CSS)).toBe('.mine { color: teal; }\n');
    expect((await listed(client, id)).version).toBe(3);

    // Every event of the save is a person's, of no turn: it carries the last turn's number and opens none.
    const mine = (await eventsOf(client, id)).filter((event) => event.seq > ((one.body['version'] as { n: number }).n, 0)).slice(-6);
    expect(mine.map((event) => event.kind)).toEqual(['hold', 'check', 'build', 'apply', 'version', 'released']);
    expect(mine.every((event) => event.by === 'person' && event.turn === 1)).toBe(true);
    expect(mine[4]).toMatchObject({ name: 'v3 · Your edit to design.css' });
    // The turn's own events are nobody's but the turn's.
    expect((await eventsOf(client, id)).filter((event) => event.kind === 'turn-finished').every((event) => event.by === undefined)).toBe(true);

    // Three files in one save are one version.
    const tsx = disk(APP_TSX);
    const three = await save(client, id, { [BRIEF]: '# Repair desk\n\nMine now.\n', [DESIGN_CSS]: '.mine { color: navy; }\n', [APP_TSX]: `${tsx}\n// a note of mine\n` });
    expect(three.body, JSON.stringify(three.body)).toMatchObject({ applied: true, version: { n: 4, name: 'v4 · Your edit to 3 files' } });
    // The same text again changes nothing: applied, and no version.
    const same = await save(client, id, { [BRIEF]: '# Repair desk\n\nMine now.\n' });
    expect(same.body, JSON.stringify(same.body)).toMatchObject({ applied: true, version: null });
    const versions = (await client.call('GET', `/api/v1/designer/sessions/${id}/versions`)).body['versions'] as { n: number; name: string; current: boolean }[];
    expect(versions.map((version) => version.name)).toEqual(['v4 · Your edit to 3 files', 'v3 · Your edit to design.css', 'v2', 'v1']);

    // Each save is in the audit log, with its files.
    const audit = await client.meta.db.selectFrom('adminium_audit_log').selectAll().where('action', '=', 'designer.files.saved').execute();
    expect(audit).toHaveLength(3);
    expect(JSON.stringify(audit[1])).toContain('customer/src/App.tsx');
    expect(JSON.stringify(audit)).not.toContain('a note of mine');

    // The next turn is told which files, after the person's words and never inside them.
    expect(handEdits(id)).toEqual([DESIGN_CSS, BRIEF, APP_TSX]);
    asked = [];
    // The model writes a file the person changed without reading it, is refused, reads it, and writes on top.
    script = [
      () => ({ calls: [{ name: 'write_file', arguments: { path: DESIGN_CSS, content: '.designer {}\n' } }] }),
      () => ({ calls: [{ name: 'read_file', arguments: { path: DESIGN_CSS } }] }),
      () => ({ calls: [{ name: 'write_file', arguments: { path: DESIGN_CSS, content: '.mine { color: navy; }\n.designer {}\n' } }] }),
    ];
    expect((await client.call('POST', `/api/v1/designer/sessions/${id}/turns`, { text: 'Add a class for the footer.' })).status).toBe(202);
    const events = (await finishedTurn(client, id, 2)) as (EventRow & { tool?: string; state?: string; ended?: string; detail?: string })[];
    expect(events.at(-1)).toMatchObject({ outcome: 'done' });
    const first = asked[0]?.filter((message) => message.role === 'user').at(-1)?.content ?? '';
    expect(first.startsWith('Add a class for the footer.')).toBe(true);
    expect(first).toContain(`(Since your last turn the person changed these files by hand: ${JSON.stringify([DESIGN_CSS, BRIEF, APP_TSX])}. Read each one again before you change it`);
    const steps = events.filter((event) => event.kind === 'step' && event.turn === 2 && event.state !== 'running').map((event) => `${event.tool ?? ''}:${event.state ?? ''}:${event.ended ?? ''}`);
    expect(steps).toEqual(['write_file:failed:miss', 'read_file:done:', 'write_file:done:']);
    expect(JSON.stringify(asked[1])).toContain('Call read_file on it first');
    expect(disk(DESIGN_CSS)).toBe('.mine { color: navy; }\n.designer {}\n');
    // The turn ended well: the files are the app's, and the turn after is told nothing.
    expect(handEdits(id)).toEqual([]);
    asked = [];
    expect((await client.call('POST', `/api/v1/designer/sessions/${id}/turns`, { text: 'Thanks.' })).status).toBe(202);
    await finishedTurn(client, id, 3);
    // (The turn before keeps its own note in the conversation; this turn's message carries none.)
    expect(asked[0]?.filter((message) => message.role === 'user').at(-1)?.content).toBe('Thanks.');
  });

  it('says why a save was not applied, leaves the file written and no version, refuses the next save until the files are put back, and puts them back', async () => {
    const { client, id } = await withApp({ side: true });
    const page = disk(PAGE);
    const broken = await save(client, id, { [PAGE]: '{ "key": "repair-desk-items", ' });
    expect(broken.status, JSON.stringify(broken.body)).toBe(200);
    expect(broken.body).toMatchObject({ applied: false, version: null, problems: { stage: 'check' } });
    const lines = (broken.body['problems'] as { lines: string[] }).lines;
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('\n')).toContain('repair-desk-items.json');
    expect(disk(PAGE)).toBe('{ "key": "repair-desk-items", ');
    expect((await listed(client, id)).version).toBe(2);
    expect((await eventsOf(client, id)).slice(-3).map((event) => [event.kind, event.by, event.ok])).toEqual([
      ['hold', 'person', undefined],
      ['check', 'person', false],
      ['released', 'person', undefined],
    ]);
    // It is on record as the person's edit, whatever came of it.
    expect(handEdits(id)).toEqual([PAGE]);

    // A save of another file would apply the broken one with it, under its own name: refused.
    const other = await save(client, id, { [BRIEF]: '# Something else\n' });
    expect([other.status, reason(other)]).toEqual([409, 'UNFINISHED_CHANGE']);
    expect(disk(BRIEF)).not.toContain('Something else');
    // The same file, put right, is the person's own edit finished: saved.
    const fixed = await save(client, id, { [PAGE]: page.replace('"Items"', '"Things"') === page ? `${page}\n` : page.replace('"Items"', '"Things"') });
    expect(fixed.body, JSON.stringify(fixed.body)).toMatchObject({ applied: true, version: { n: 3 } });

    // Broken again, and this time put back: the files are as the newest version has them, with no new version.
    expect((await save(client, id, { [PAGE]: 'not json at all' })).body).toMatchObject({ applied: false });
    const back = await client.call('POST', `/api/v1/designer/sessions/${id}/versions/3/restore`, { record: false });
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    expect(back.body).toEqual({ version: null, applied: true });
    expect(disk(PAGE)).toBe(disk(PAGE).includes('Things') ? disk(PAGE) : `${page}\n`);
    expect(disk(PAGE)).not.toBe('not json at all');
    expect((await listed(client, id)).version).toBe(3);
    // Nothing is the person's edit any more, the restore's events are a person's too, and a save goes through again.
    expect(handEdits(id)).toEqual([]);
    const tail = (await eventsOf(client, id)).slice(-5);
    expect(tail.map((event) => event.kind)).toEqual(['hold', 'check', 'build', 'apply', 'released']);
    expect(tail.every((event) => event.by === 'person')).toBe(true);
    expect(tail[0]).toMatchObject({ what: 'restore' });
    expect((await save(client, id, { [BRIEF]: '# Repair desk\n\nAfter going back.\n' })).body).toMatchObject({ applied: true, version: { n: 4 } });
  });

  it('refuses a save while the Designer’s last change is unfinished on disk: after a stopped turn, and after one that failed', async () => {
    const { client, id } = await withApp({ side: true });
    const table = `${APP}/manifest/tables/extras.json`;
    const extra = JSON.stringify({ ...(starter()['manifest/tables/items.json'] as object), ref: 'extras', label: { 'en-US': 'Extra' }, labelPlural: { 'en-US': 'Extras' } }, null, 2);

    // Stopped: the turn wrote a table and was stopped before it applied anything.
    script = [() => ({ calls: [{ name: 'write_file', arguments: { path: table, content: extra } }] })];
    waits = true;
    expect((await client.call('POST', `/api/v1/designer/sessions/${id}/turns`, { text: 'Add extras.' })).status).toBe(202);
    await vi.waitFor(() => expect(held.length).toBeGreaterThan(0), { timeout: 15_000, interval: 25 });
    expect(existsSync(join(root, table))).toBe(true);
    // While it runs, a save is refused as busy, and the list says a turn has the folder.
    const during = await save(client, id, { [BRIEF]: '# During\n' });
    expect([during.status, reason(during), details(during)['busy']]).toEqual([409, 'TURN_RUNNING', 'turn']);
    expect((await listed(client, id)).busy).toBe('turn');
    await client.call('POST', `/api/v1/designer/sessions/${id}/stop`);
    expect((await finishedTurn(client, id, 2)).at(-1)).toMatchObject({ outcome: 'stopped' });
    waits = false;

    const brief = disk(BRIEF);
    const stopped = await save(client, id, { [BRIEF]: '# After a stop\n' });
    expect([stopped.status, reason(stopped)]).toEqual([409, 'UNFINISHED_CHANGE']);
    expect(disk(BRIEF)).toBe(brief);
    // The table the turn left is not applied by a save of something else: it is in no version.
    expect((await listed(client, id)).version).toBe(2);
    // "Put the files back" is the way out, and then the save is the person's own.
    expect((await client.call('POST', `/api/v1/designer/sessions/${id}/versions/2/restore`, { record: false })).body).toMatchObject({ applied: true });
    expect(existsSync(join(root, table))).toBe(false);
    expect((await save(client, id, { [BRIEF]: '# After putting back\n' })).body).toMatchObject({ applied: true, version: { n: 3, name: 'v3 · Your edit to design.md' } });

    // Failed: the turn wrote the table, and then its model could not be asked.
    script = [
      () => {
        refuses = true;
        return { calls: [{ name: 'write_file', arguments: { path: table, content: extra } }] };
      },
    ];
    expect((await client.call('POST', `/api/v1/designer/sessions/${id}/turns`, { text: 'Add extras again.' })).status).toBe(202);
    expect((await finishedTurn(client, id, 3)).at(-1)).toMatchObject({ outcome: 'failed' });
    expect(existsSync(join(root, table))).toBe(true);
    const failed = await save(client, id, { [BRIEF]: '# After a failure\n' });
    expect([failed.status, reason(failed)]).toEqual([409, 'UNFINISHED_CHANGE']);
    expect(disk(BRIEF)).toBe('# After putting back\n');
  });

  it('applies a saved look.json as a change of style does, and writes nothing of a save whose look cannot be read', async () => {
    const { client, id } = await withApp({ side: true });
    const LOOK = `${APP}/look.json`;
    const before = { look: disk(LOOK), brief: disk(BRIEF), theme: disk(`${APP}/customer/src/theme.css`) };
    const refusals: [string, string, string][] = [
      ['not JSON', '{ "skill": ', 'This is not valid JSON'],
      ['not an object', '["warm"]', 'one object'],
      ['no style', '{ "accent": "#ff0000" }', 'names a style'],
      ['an unknown style', '{ "skill": "no-such-style" }', 'There is no style called "no-such-style"'],
      ['a style that is no key', '{ "skill": "../../etc" }', 'There is no style called'],
    ];
    for (const [name, content, said] of refusals) {
      // With another file in the same save: neither is written.
      const res = await save(client, id, { [BRIEF]: '# With a bad look\n', [LOOK]: content });
      expect([res.status, (res.body['error'] as { code?: string }).code, reason(res), details(res)['path']], name).toEqual([422, 'VALIDATION_FAILED', 'LOOK', LOOK]);
      expect(String(details(res)['message']), name).toContain(said);
      expect([disk(LOOK), disk(BRIEF), disk(`${APP}/customer/src/theme.css`)], name).toEqual([before.look, before.brief, before.theme]);
    }
    expect((await listed(client, id)).version).toBe(2);

    // A good one: the stylesheets follow it, the file is kept as the server cleans it, and the page is told the style.
    const good = await save(client, id, { [LOOK]: '{\n  "skill": "warm",\n  "accent": "#AA3311",\n  "nonsense": true\n}\n' });
    expect(good.status, JSON.stringify(good.body)).toBe(200);
    expect(good.body).toMatchObject({ applied: true, version: { n: 3, name: 'v3 · Your edit to look.json' } });
    expect(JSON.parse(disk(LOOK))).toEqual({ skill: 'warm', accent: '#aa3311' });
    expect(disk(`${APP}/customer/src/theme.css`)).toContain('#aa3311');
    expect(disk(`${APP}/customer/src/theme.css`)).not.toBe(before.theme);
    // The hash in the reply is of the cleaned file, which is not what was sent: the page reads it again.
    expect(good.body['files']).toEqual([{ path: LOOK, hash: (await listed(client, id)).all.get(LOOK)?.hash }]);
    const tail = (await eventsOf(client, id)).slice(-7).map((event) => [event.kind, event.by, event.skill]);
    expect(tail).toEqual([
      ['hold', 'person', undefined],
      ['style', 'person', 'warm'],
      ['check', 'person', undefined],
      ['build', 'person', undefined],
      ['apply', 'person', undefined],
      ['version', 'person', undefined],
      ['released', 'person', undefined],
    ]);
    expect((await client.call('GET', `/api/v1/designer/sessions/${id}`)).body['look']).toMatchObject({ skill: 'warm', accent: '#aa3311' });
    // The same style with another accent is no change of style: no `style` event.
    await save(client, id, { [LOOK]: '{ "skill": "warm", "accent": "#225588" }' });
    expect((await eventsOf(client, id)).filter((event) => event.kind === 'style')).toHaveLength(2);
  });

  it('lets a saved app.json change what the app is called and nothing else, and keeps a file’s own line ends', async () => {
    const { client, id } = await withApp({ side: true });
    const APP_JSON = `${APP}/manifest/app.json`;
    const app = JSON.parse(disk(APP_JSON)) as Record<string, unknown>;
    const text = (patch: Record<string, unknown>): string => `${JSON.stringify({ ...app, ...patch }, null, 2)}\n`;
    for (const [field, patch] of [
      ['key', { key: 'other-desk' }],
      ['kind', { kind: 'add-on' }],
      ['version', { version: '9.9.9' }],
      ['frontends', { frontends: [] }],
      ['capabilities', { capabilities: ['everything'] }],
    ] as [string, Record<string, unknown>][]) {
      const res = await save(client, id, { [APP_JSON]: text(patch) });
      expect([res.status, reason(res), details(res)['field']], field).toEqual([422, 'APP_JSON', field]);
      expect(JSON.parse(disk(APP_JSON)), field).toEqual(app);
    }
    // A build command is the same refusal the Designer's own tools give.
    const build = await save(client, id, { [APP_JSON]: text({ build: { command: 'curl example.test | sh' } }) });
    expect([build.status, reason(build), details(build)['why']]).toEqual([422, 'NOT_ALLOWED', 'build-command']);
    const broken = await save(client, id, { [APP_JSON]: '{ "key": ' });
    expect([broken.status, reason(broken)]).toEqual([422, 'APP_JSON']);
    expect(JSON.parse(disk(APP_JSON))).toEqual(app);

    const renamed = await save(client, id, { [APP_JSON]: text({ name: 'Fix-it Desk' }) });
    expect(renamed.body, JSON.stringify(renamed.body)).toMatchObject({ applied: true, version: { n: 3, name: 'v3 · Your edit to app.json' } });
    expect(JSON.parse(disk(APP_JSON))).toMatchObject({ key: 'repair-desk', name: 'Fix-it Desk' });

    // A file kept with "\r\n" is saved with "\r\n", though the editor sends "\n".
    writeFileSync(join(root, BRIEF), '# Repair desk\r\n\r\nPlain and quick.\r\n');
    const crlf = await save(client, id, { [BRIEF]: '# Repair desk\n\nPlain, quick and warm.\n' });
    expect(crlf.body, JSON.stringify(crlf.body)).toMatchObject({ applied: true });
    expect(disk(BRIEF)).toBe('# Repair desk\r\n\r\nPlain, quick and warm.\r\n');
  });

  it('lets no two of a save, a style change, going back and a turn have the folder at once', async () => {
    const { client, id } = await withApp({ side: true });
    const turn = () => client.call('POST', `/api/v1/designer/sessions/${id}/turns`, { text: 'More.' });
    const style = () => client.call('POST', `/api/v1/designer/sessions/${id}/look`, { skill: 'warm' });
    const back = () => client.call('POST', `/api/v1/designer/sessions/${id}/versions/2/restore`, { record: false });
    const saving = () => save(client, id, { [BRIEF]: `# Repair desk\n\n${String(Math.random())}\n` });
    const fresh = () => client.call('POST', '/api/v1/designer/sessions', { name: 'Second app', target: 'auto', connectionId: 'env:ollama', model: 'fake', text: 'Another one.' });
    const sessions = async (): Promise<number> => ((await client.call('GET', '/api/v1/designer/sessions')).body['apps'] as unknown[]).length;
    const takers = { save: saving, style, restore: back } as const;

    for (const [kind, take] of Object.entries(takers) as [keyof typeof takers, () => Promise<Reply>][]) {
      const gateAt = holdAt(`held:${kind}`);
      const running = take();
      await gateAt.reached;
      // The page is told what has the folder; a turn is not running.
      expect((await listed(client, id)).busy, kind).toBe(kind);
      expect((await client.call('GET', '/api/v1/designer/state')).body['active'], kind).toBeNull();
      const refusedTurn = await turn();
      expect([refusedTurn.status, reason(refusedTurn), details(refusedTurn)['busy']], `a turn under ${kind}`).toEqual([409, 'DESIGNER_BUSY', kind]);
      for (const [other, attempt] of Object.entries(takers)) {
        // (A second save is listed first, which works while the folder is held; its own claim is what is refused.)
        const refused = await attempt();
        expect([refused.status, reason(refused), details(refused)['busy']], `${other} under ${kind}`).toEqual([409, 'DESIGNER_BUSY', kind]);
      }
      // A new session with a first message takes the folder before it makes anything: refused, and no app is left behind.
      const apps = await sessions();
      const refusedNew = await fresh();
      expect([refusedNew.status, reason(refusedNew)], `a new session under ${kind}`).toEqual([409, 'DESIGNER_BUSY']);
      expect(await sessions(), kind).toBe(apps);
      expect(existsSync(join(root, 'apps/second-app')), kind).toBe(false);
      gateAt.open();
      const done = await running;
      expect(done.status, `${kind}: ${JSON.stringify(done.body)}`).toBe(200);
      expect((await listed(client, id)).busy, kind).toBeNull();
    }
    // No turn was started by any of the refused calls.
    expect((await eventsOf(client, id)).filter((event) => event.kind === 'turn-started')).toHaveLength(1);
    // Handed back: a turn starts. (It first asks for the new style's fonts on a card; stopped there.)
    expect((await turn()).status).toBe(202);
    await client.call('POST', `/api/v1/designer/sessions/${id}/stop`);
    await finishedTurn(client, id, 2);
  });

  it('tells a save that holds the folder too long to stop, and says so', async () => {
    // An app with no side: nothing but this save holds the folder on this server, so nothing else meets the short cap.
    const { client, id } = await withApp({ holdCapMs: 150 });
    const gateAt = holdAt('held:save');
    const running = save(client, id, { [PAGE]: `${disk(PAGE)}\n` });
    await gateAt.reached;
    await new Promise((resolve) => setTimeout(resolve, 300));
    gateAt.open();
    const done = await running;
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body).toMatchObject({ applied: false, version: null, problems: { stage: 'build' } });
    expect((done.body['problems'] as { lines: string[] }).lines[0]).toContain('stopped before it was applied');
    expect((await listed(client, id)).busy).toBeNull();
  });

  it('saves nothing into an app that still waits for its name', async () => {
    const client = await server();
    const created = await client.call('POST', '/api/v1/designer/sessions', { title: 'A cake shop', target: 'auto', connectionId: 'env:ollama', model: 'fake' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const session = created.body['session'] as { id: string; appKey: string };
    const APP_JSON = `apps/${session.appKey}/manifest/app.json`;
    expect((await listed(client, session.id)).all.has(APP_JSON)).toBe(true);
    const before = disk(APP_JSON);
    const res = await save(client, session.id, { [APP_JSON]: before.replace('New app', 'Cakes') });
    expect([res.status, reason(res)]).toEqual([409, 'APP_UNNAMED']);
    expect(disk(APP_JSON)).toBe(before);
  });

  it('is for whoever may use the Designer and nobody else, counts against the Designer’s own limit, and is off when the Designer is', async () => {
    const { client, id } = await withApp();
    const good = (await listed(client, id)).all.get(`${APP}/manifest/app.json`)?.hash as string;
    const body = { files: [{ path: `${APP}/manifest/app.json`, content: '{}', base: good }] };
    const routes: [string, 'GET' | 'PUT', string, unknown?][] = [
      ['the list', 'GET', filesUrl(id)],
      ['a file', 'GET', `${filesUrl(id)}/content?path=${encodeURIComponent(`${APP}/manifest/app.json`)}`],
      ['a save', 'PUT', filesUrl(id), body],
    ];
    const admin = await usersRepo(client.meta).create({ email: 'admin@example.test', name: 'Admin', passwordHash: await hashPassword('another-long-test-password-2!') });
    await rolesRepo(client.meta).assignToUser(admin.id, (await rolesRepo(client.meta).findBySlug('admin'))!.id);
    const login = await composed!.app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { host: HOST }, payload: { email: 'admin@example.test', password: 'another-long-test-password-2!' } });
    const adminCookie = String(login.headers['set-cookie']).split(';')[0] ?? '';
    for (const [name, method, url, payload] of routes) {
      expect((await client.call(method, url, payload, '')).status, `${name}, signed out`).toBe(401);
      expect((await client.call(method, url, payload, adminCookie)).status, `${name}, an Admin`).toBe(403);
      // The Designer's own bucket: 600 a minute for each person.
      const res = await client.call(method, url.replace(id, 'ds_000000000000000000000000'), payload);
      expect([res.status, res.headers['x-ratelimit-limit']], name).toEqual([404, '600']);
    }
    expect(disk(`${APP}/manifest/app.json`)).not.toBe('{}');
  });

  it('answers DESIGNER_OFF on a live server whose Designer is switched off, and works once it is on', async () => {
    const client = await server({ live: true });
    const id = 'ds_000000000000000000000000';
    for (const [method, url, payload] of [
      ['GET', filesUrl(id), undefined],
      ['GET', `${filesUrl(id)}/content?path=apps%2Fx%2Fdesign.md`, undefined],
      ['PUT', filesUrl(id), { files: [{ path: 'apps/x/design.md', content: 'x', base: '0'.repeat(64) }] }],
    ] as ['GET' | 'PUT', string, unknown][]) {
      const off = await client.call(method, url, payload);
      expect([off.status, reason(off)], `${method} ${url}`).toEqual([403, 'DESIGNER_OFF']);
    }
    expect((await client.call('PUT', '/api/v1/designer/live', { on: true, password: PASSWORD })).status).toBe(200);
    const created = await client.call('POST', '/api/v1/designer/sessions', { name: 'Repair desk', target: 'auto', connectionId: 'env:ollama', model: 'fake' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const session = (created.body['session'] as { id: string }).id;
    expect((await listed(client, session)).all.has(`${APP}/manifest/app.json`)).toBe(true);
    // Switched off again while a save holds the folder: the save is told to stop, and the routes are closed.
    const gateAt = holdAt('held:save');
    const APP_JSON = `${APP}/manifest/app.json`;
    const running = save(client, session, { [APP_JSON]: disk(APP_JSON).replace('"Repair desk"', '"Fix-it Desk"') });
    await gateAt.reached;
    expect((await client.call('PUT', '/api/v1/designer/live', { on: false })).status).toBe(200);
    gateAt.open();
    expect((await running).body).toMatchObject({ applied: false, problems: { stage: 'build' } });
    expect(reason(await client.call('GET', filesUrl(session)))).toBe('DESIGNER_OFF');
  });
});

/** Paths that are not on the list: each is a refused read and a refused save. */
const BREAKING: string[] = [
  `${APP}/../../secret.ts`,
  `${APP}/customer/src/../../../../secret.ts`,
  `/${APP}/design.md`,
  `${APP}\\design.md`,
  `APPS/repair-desk/design.md`,
  `${APP}/DESIGN.md`,
  // "é" written as two marks: another spelling of a name is another string.
  `${APP}/customer/src/Café.tsx`,
  `${APP}/customer/src/theme.css`,
  `${APP}/customer/src/fonts.css`,
  `${APP}/customer/src/style.css`,
  `${APP}/customer/src/main.tsx`,
  `${APP}/customer/src/app.css`,
  `${APP}/manifest/tables/items.json`,
  `${APP}/manifest/roles.json`,
  `${APP}/manifest/access.json`,
  `${APP}/seeds/sample.json`,
  `${APP}/tests/app.test.mjs`,
  'hooks/x.ts',
  'apps/other/manifest/app.json',
  `${APP}/dist-customer/index.js`,
  `${APP}/customer/src/node_modules/x/index.js`,
  `${APP}/customer/src/linked.ts`,
  `${APP}/customer/src/New.tsx`,
  `${APP}/customer/src`,
  `${APP}/customer/src/`,
  `${APP}/design.md/`,
  `${APP}/design.md?x=1`,
  `${APP}/customer/src/has space.tsx`,
  `${APP}/customer/src/quote".tsx`,
  `${APP}/customer/src/{brace}.tsx`,
  `${APP}/customer/src/line\nend.tsx`,
  'adminium.config.ts',
  '.env',
  'secret.ts',
];
