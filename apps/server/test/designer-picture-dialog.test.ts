// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The picture dialog's routes, on a whole server over a real project: a
 * search of one source at a time, a pick kept for the session, and Apply.
 * The sources are a fake reached through the safe fetch's own seams (a
 * test-only compose option): no setting points the server anywhere but the
 * sources' own addresses.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { fakePictures as fakePictureMaker, type MakeRequest } from '@adminium/llm';
import { assistantUseDay, auditRepo, pictureUseRepo, settingsRepo, usersRepo } from '@adminium/meta';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { composeServer, type ComposedServer } from '../src/compose.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { setHostModels, stopHostModels, useHostModels } from '../src/llm/host-models.js';
import { createRunService } from '../src/llm/run-service.js';
import type { MetaStoreHandle } from '../src/meta/store.js';
import { builtInStylesDir } from '../src/project/apps/design-skills.js';
import { cleanLook, missingFonts } from '../src/project/apps/look.js';
import { addSide, starterParts } from '../src/project/apps/scaffold-app.js';
import { buildProject } from '../src/project/build.js';
import { APP_VERSION } from '../src/version.js';
import { asProject } from './app-project-helpers.js';
import { makeEnv } from './helpers.js';
import { fakePictures, type FakePictures } from './picture-sources-fake.js';
import { makeInstall, type Install } from './project-fixtures.js';

const DESIGN_PORT = 4798;
const HOST = `127.0.0.1:${String(DESIGN_PORT)}`;
const PASSWORD = 'a-long-enough-test-password-1!';

// A model the Designer can build with: it passes the build check (calls `echo`), writes what a test scripts, and otherwise says it is done.
type ScriptStep = () => { text: string } | { calls: { name: string; arguments: Record<string, unknown> }[] };
let script: ScriptStep[] = [];
/** The next reply is held until the test lets it go. */
let waits = false;
const heldReplies: (() => void)[] = [];
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
      const sent = JSON.parse(body) as { messages: { role: string }[]; tools?: { function: { name: string } }[] };
      const line = (value: unknown): void => {
        response.write(`${JSON.stringify(value)}\n`);
      };
      const done = { model: 'fake', done: true, done_reason: 'stop', prompt_eval_count: 50, eval_count: 5, message: { role: 'assistant', content: '' } };
      if (sent.tools?.some((tool) => tool.function.name === 'echo') === true) {
        if (sent.messages.some((message) => message.role === 'tool')) line({ model: 'fake', done: false, message: { role: 'assistant', content: 'done' } });
        else line({ model: 'fake', done: false, message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'echo', arguments: { word: 'adminium' } } }] } });
        line(done);
        response.end();
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
        heldReplies.push(finish);
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

let composed: ComposedServer | undefined;
let install: Install | null = null;
/** A write of an Apply that is made to fail, as a full disk or a crash would leave it. */
let failWrite: string | null = null;
afterEach(async () => {
  for (const release of heldReplies.splice(0)) release();
  script = [];
  waits = false;
  failWrite = null;
  vi.unstubAllEnvs();
  stopHostModels();
  await composed?.app.close();
  composed = undefined;
  await install?.close();
  install = null;
});

export interface Client {
  root: string;
  meta: import('@adminium/meta').MetaDb;
  fake: FakePictures;
  /** What the fake picture maker was asked. */
  made: MakeRequest[];
  call: (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) => Promise<{ status: number; body: Record<string, unknown>; raw: Buffer; headers: Record<string, unknown> }>;
  session: () => Promise<string>;
}

async function server(opts: { keys?: boolean } = {}): Promise<Client> {
  if (opts.keys !== false) {
    vi.stubEnv('PEXELS_API_KEY', 'pexels-key');
    vi.stubEnv('UNSPLASH_ACCESS_KEY', 'unsplash-key');
    vi.stubEnv('PIXABAY_API_KEY', 'pixabay-key');
  }
  install = await makeInstall();
  const root = asProject(install.dir);
  await buildProject({ root, configFile: join(root, 'adminium.config.ts') }, { version: APP_VERSION });
  const { meta } = install;
  const fake = fakePictures();
  const made: MakeRequest[] = [];
  const runService = createRunService({ meta });
  const store: MetaStoreHandle = { meta, url: 'sqlite::memory:', engine: 'sqlite', source: 'embedded', close: async () => Promise.resolve() };
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
    pictureSeams: fake.seams,
    pictureMakerSeam: () => fakePictureMaker({ calls: made }),
    designerSeam: async (step, detail) => {
      if (step === 'write' && detail === failWrite) throw new Error('the disk is full');
    },
  });
  const { app } = composed;
  await app.ready();
  const setup = await app.inject({ method: 'POST', url: '/api/v1/setup/super-admin', headers: { host: HOST }, payload: { email: 'owner@example.test', password: PASSWORD, name: 'Owner' } });
  expect(setup.statusCode, setup.body).toBe(201);
  const owner = String(setup.headers['set-cookie']).split(';')[0] ?? '';
  const call: Client['call'] = async (method, url, payload) => {
    const res = await app.inject({ method, url, headers: { host: HOST, cookie: owner }, ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }) });
    const json = (res.headers['content-type'] ?? '').toString().includes('json');
    return { status: res.statusCode, body: (json && res.body !== '' ? res.json() : {}) as Record<string, unknown>, raw: res.rawPayload, headers: res.headers };
  };
  return {
    root,
    meta,
    fake,
    made,
    call,
    session: async () => {
      const made = await call('POST', '/api/v1/designer/sessions', { name: 'Crispy Bites', target: 'web', connectionId: 'env:ollama', model: 'fake' });
      expect(made.status, JSON.stringify(made.body)).toBe(201);
      return (made.body['session'] as { id: string }).id;
    },
  };
}

const search = (id: string, query: Record<string, string>): string => `/api/v1/designer/sessions/${id}/pictures/search?${new URLSearchParams(query).toString()}`;

describe('searching for a picture', { timeout: 120_000 }, () => {
  it('asks one source, gives each picture by an id of the server’s with its licence, and serves its small copy to that session only', async () => {
    const client = await server();
    const id = await client.session();
    const found = await client.call('GET', search(id, { q: 'fried chicken', source: 'Openverse', shape: 'wide' }));
    expect(found.status, JSON.stringify(found.body)).toBe(200);
    expect(found.body).toMatchObject({ state: 'ok', more: true, page: 1 });
    const pictures = found.body['pictures'] as { id: string; licence: { code: string; name: string }; page: string; title: string }[];
    // A licence that forbids selling is dropped: six of eight are left.
    expect(pictures).toHaveLength(6);
    expect(pictures.map((picture) => picture.licence.code)).toEqual(['by', 'cc0', 'by-sa', 'by', 'cc0', 'by-sa']);
    expect(pictures[1]?.licence.name).toBe('CC0 1.0');
    expect(pictures[0]?.page).toBe('https://www.flickr.com/photos/fried-chicken-1-0');
    // No address of the source's own reaches the page but the picture's page.
    expect(JSON.stringify(found.body)).not.toContain('staticflickr');
    expect(JSON.stringify(found.body)).not.toContain('api.openverse.org');
    expect(client.fake.seen[0]).toContain('aspect_ratio=wide');

    const shelf = found.body['shelf'] as string;
    const thumb = await client.call('GET', `/api/v1/designer/sessions/${id}/picture-thumb/${shelf}/${pictures[0]?.id as string}`);
    expect(thumb.status).toBe(200);
    expect(thumb.headers['content-type']).toBe('image/jpeg');
    expect(String(thumb.headers['content-security-policy'])).toMatch(/^default-src 'none'; sandbox/);
    const other = await client.session();
    expect((await client.call('GET', `/api/v1/designer/sessions/${other}/picture-thumb/${shelf}/${pictures[0]?.id as string}`)).status).toBe(404);

    // "More" adds to the same page of results.
    const more = await client.call('GET', search(id, { q: 'fried chicken', source: 'Openverse', page: '2', shelf }));
    expect(more.body).toMatchObject({ state: 'ok', shelf, page: 2 });
    expect(client.fake.seen.at(-1)).toContain('page=2');
  });

  it('pauses only the source that is busy, says for how long, and the others keep answering', async () => {
    const client = await server();
    const id = await client.session();
    client.fake.fail.unsplash = { status: 429, headers: { 'retry-after': '720' } };
    expect((await client.call('GET', search(id, { q: 'diner', source: 'Unsplash' }))).body).toEqual({ state: 'busy', source: 'Unsplash', minutes: 12 });
    const asked = client.fake.calls['api.unsplash.com'];
    expect((await client.call('GET', search(id, { q: 'diner', source: 'Unsplash' }))).body).toEqual({ state: 'busy', source: 'Unsplash', minutes: 12 });
    expect(client.fake.calls['api.unsplash.com']).toBe(asked);
    expect((await client.call('GET', search(id, { q: 'diner', source: 'Pexels' }))).body).toMatchObject({ state: 'ok' });
    expect((await client.call('GET', search(id, { q: 'diner', source: 'Openverse' }))).body).toMatchObject({ state: 'ok' });
  });

  it('searches Pixabay with its key, gives a search asked again within a day what was kept, and copies a chosen picture', async () => {
    const client = await server();
    const id = await client.session();
    const view = await client.call('GET', `/api/v1/designer/sessions/${id}/pictures`);
    expect((view.body['sources'] as { name: string }[]).map((source) => source.name)).toEqual(['Openverse', 'Pexels', 'Unsplash', 'Pixabay']);
    const found = await client.call('GET', search(id, { q: 'lemon cake', source: 'Pixabay', shape: 'tall' }));
    expect(found.body).toMatchObject({ state: 'ok', more: true, page: 1 });
    expect(client.fake.seen.at(-1)).toBe('https://pixabay.com/api/?key=pixabay-key&q=lemon+cake&image_type=photo&safesearch=true&per_page=20&page=1&orientation=vertical');
    const pictures = found.body['pictures'] as { id: string; source: string; licence: { code: string; name: string }; page: string; shown?: true }[];
    expect(pictures).toHaveLength(5);
    expect(pictures[0]).toMatchObject({ source: 'Pixabay', licence: { code: 'pixabay', name: 'Pixabay Content License' }, page: 'https://pixabay.com/photos/lemon-cake-1-0/' });
    expect(pictures[0]?.shown).toBeUndefined();
    // The key and Pixabay's own picture addresses never reach the page.
    expect(JSON.stringify(found.body)).not.toContain('pixabay-key');
    expect(JSON.stringify(found.body)).not.toContain('/get/');
    const asked = client.fake.calls['pixabay.com'];
    // Another session, the same search: what was kept, with ids of its own; Pixabay is not asked.
    const other = await client.session();
    const again = await client.call('GET', search(other, { q: 'lemon cake', source: 'Pixabay', shape: 'tall' }));
    expect((again.body['pictures'] as { page: string }[]).map((picture) => picture.page)).toEqual(pictures.map((picture) => picture.page));
    expect((again.body['pictures'] as { id: string }[])[0]?.id).not.toBe(pictures[0]?.id);
    expect(client.fake.calls['pixabay.com']).toBe(asked);
    // Its small copy is served by this server; a chosen picture is copied, the full one first.
    const shelf = again.body['shelf'] as string;
    const first = (again.body['pictures'] as { id: string }[])[0]?.id as string;
    expect((await client.call('GET', `/api/v1/designer/sessions/${other}/picture-thumb/${shelf}/${first}`)).headers['content-type']).toBe('image/jpeg');
    expect((await client.call('POST', `/api/v1/designer/sessions/${other}/pictures/pin`, { shelf, picture: first })).body).toEqual({ state: 'kept', small: false });
    expect(client.fake.seen).toContain('https://pixabay.com/get/lemon-cake-1-0_1280.jpg');
  });

  it('offers a source only with its key, and none where the server calls nothing outside', async () => {
    const client = await server({ keys: false });
    const id = await client.session();
    expect((await client.call('GET', search(id, { q: 'diner', source: 'Pexels' }))).body).toEqual({ state: 'off' });
    expect((await client.call('GET', search(id, { q: 'diner', source: 'Pixabay' }))).body).toEqual({ state: 'off' });
    expect((await client.call('GET', search(id, { q: 'diner', source: 'Openverse' }))).body).toMatchObject({ state: 'ok' });
    // A source that is none of the three is no search at all.
    expect((await client.call('GET', search(id, { q: 'diner', source: 'Nowhere' }))).status).toBe(422);
  });
});

describe('the keys of Pexels and Unsplash, given in the dialog', { timeout: 120_000 }, () => {
  it('are kept by the host that keeps keys, in use from the next search, and never in a reply or the audit log', async () => {
    // As the desktop app is: it keeps the keys, and the project's server holds them in memory only.
    const kept: Record<string, string | null>[] = [];
    useHostModels({ keep: (values) => kept.push({ ...values }) });
    setHostModels({ ADMINIUM_AI_OLLAMA_BASE_URL: modelUrl, ADMINIUM_AI_MODEL: 'ollama/fake' });
    const client = await server({ keys: false });
    const id = await client.session();
    const view = async () => (await client.call('GET', `/api/v1/designer/sessions/${id}/pictures`)).body as { sources: { name: string }[]; keys: unknown };
    expect(await view()).toMatchObject({ sources: [{ name: 'Openverse' }], keys: { Pexels: false, Unsplash: false, keeping: 'key-store', pages: { Pexels: 'https://www.pexels.com/api/', Unsplash: 'https://unsplash.com/developers' } } });
    expect((await client.call('GET', search(id, { q: 'diner', source: 'Pexels' }))).body).toEqual({ state: 'off' });

    const saved = await client.call('PUT', '/api/v1/designer/picture-keys', { source: 'Pexels', key: ' pexels-key-0001 ' });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body).toEqual({ keys: { Pexels: true, Unsplash: false, keeping: 'key-store', pages: { Pexels: 'https://www.pexels.com/api/', Unsplash: 'https://unsplash.com/developers' } } });
    expect(kept).toEqual([{ PEXELS_API_KEY: 'pexels-key-0001' }]);
    // No restart: the next read lists it, and the next search asks it with that key.
    expect((await view()).sources.map((source) => source.name)).toEqual(['Openverse', 'Pexels']);
    expect((await client.call('GET', search(id, { q: 'diner', source: 'Pexels' }))).body).toMatchObject({ state: 'ok' });
    expect(JSON.stringify(await view())).not.toContain('pexels-key-0001');

    expect((await client.call('PUT', '/api/v1/designer/picture-keys', { source: 'Unsplash', key: 'unsplash-key-0001' })).body).toMatchObject({ keys: { Unsplash: true } });
    expect((await view()).sources.map((source) => source.name)).toEqual(['Openverse', 'Pexels', 'Unsplash']);

    // Taken away: gone from the list at once.
    expect((await client.call('PUT', '/api/v1/designer/picture-keys', { source: 'Pexels', key: null })).body).toEqual({ keys: { Pexels: false, Unsplash: true, keeping: 'key-store', pages: { Pexels: 'https://www.pexels.com/api/', Unsplash: 'https://unsplash.com/developers' } } });
    expect(kept.at(-1)).toEqual({ PEXELS_API_KEY: null });
    expect((await view()).sources.map((source) => source.name)).toEqual(['Openverse', 'Unsplash']);

    // What is not a key, and a source that takes none, are refused before anything is kept.
    for (const body of [{ source: 'Pexels', key: 'two words' }, { source: 'Pexels', key: 'short' }, { source: 'Openverse', key: 'openverse-key-1' }, { source: 'Pexels', key: 'pexels-key-0002', extra: 1 }]) {
      expect((await client.call('PUT', '/api/v1/designer/picture-keys', body)).status, JSON.stringify(body)).toBe(422);
    }
    expect(kept).toHaveLength(3);

    const audit = await client.meta.db.selectFrom('adminium_audit_log').select(['action', 'changes']).where('action', 'like', 'designer.picture-key.%').orderBy('id').execute();
    expect(audit.map((row) => row.action)).toEqual(['designer.picture-key.saved', 'designer.picture-key.saved', 'designer.picture-key.removed']);
    expect(JSON.stringify(audit)).not.toContain('key-0001');
  });

  it('are not taken where no host keeps them: a server reads its own environment', async () => {
    const client = await server({ keys: false });
    const id = await client.session();
    expect((await client.call('GET', `/api/v1/designer/sessions/${id}/pictures`)).body).toMatchObject({ keys: null });
    const refused = await client.call('PUT', '/api/v1/designer/picture-keys', { source: 'Pexels', key: 'pexels-key-0001' });
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ error: { details: { reason: 'KEYS_NOT_KEPT_HERE' } } });
    // Nothing is written to the project's file either.
    const dotEnv = join(client.root, '.env');
    expect(existsSync(dotEnv) ? readFileSync(dotEnv, 'utf8') : '').not.toContain('pexels-key-0001');
  });

  it('says a key the source refused as that, and a spent hour as no refusal', async () => {
    const client = await server();
    const id = await client.session();
    client.fake.fail.pexels = { status: 401 };
    expect((await client.call('GET', search(id, { q: 'diner', source: 'Pexels' }))).body).toEqual({ state: 'refused', source: 'Pexels' });
    client.fake.fail.unsplash = { status: 403 };
    expect((await client.call('GET', search(id, { q: 'diner', source: 'Unsplash' }))).body).toEqual({ state: 'refused', source: 'Unsplash' });
    // Unsplash says a spent hour with a 403 and nothing left: that is not the key.
    client.fake.fail.unsplash = { status: 403, headers: { 'x-ratelimit-remaining': '0' } };
    expect((await client.call('GET', search(id, { q: 'diner', source: 'Unsplash' }))).body).toEqual({ state: 'failed' });
    // Openverse is asked with no key: its 401 is a failure like any other.
    client.fake.fail.openverse = { status: 401 };
    expect((await client.call('GET', search(id, { q: 'diner', source: 'Openverse' }))).body).toEqual({ state: 'failed' });
  });
});

describe('a picture put in what changes', { timeout: 120_000 }, () => {
  it('is kept with its bytes fetched now: the original up to 5 MB, or the small copy, said as that', async () => {
    const client = await server();
    const id = await client.session();
    const found = await client.call('GET', search(id, { q: 'kitchen', source: 'Openverse' }));
    const shelf = found.body['shelf'] as string;
    const [first, second] = found.body['pictures'] as { id: string }[];
    client.fake.big.add('kitchen-1-1.jpg');
    const pin = (picture: string) => client.call('POST', `/api/v1/designer/sessions/${id}/pictures/pin`, { shelf, picture });
    expect((await pin(first?.id as string)).body).toEqual({ state: 'kept', small: false });
    expect((await pin(second?.id as string)).body).toEqual({ state: 'kept', small: true });
    // Asked again, it is read from what was kept: the source is not asked twice.
    const flickr = client.fake.calls['live.staticflickr.com'];
    expect((await pin(first?.id as string)).body).toEqual({ state: 'kept', small: false });
    expect(client.fake.calls['live.staticflickr.com']).toBe(flickr);
    expect((await pin('pic_000000000000')).body).toEqual({ state: 'gone' });
    expect((await client.call('POST', `/api/v1/designer/sessions/${id}/pictures/pin`, { shelf: 'shelf_0000000000000000', picture: first?.id })).body).toEqual({ state: 'gone' });
  });

  it('outlives twelve more pages of results: its small copy is still served', async () => {
    const client = await server();
    const id = await client.session();
    const found = await client.call('GET', search(id, { q: 'hero', source: 'Pexels' }));
    const shelf = found.body['shelf'] as string;
    const pick = (found.body['pictures'] as { id: string }[])[0]?.id as string;
    expect((await client.call('POST', `/api/v1/designer/sessions/${id}/pictures/pin`, { shelf, picture: pick })).body).toMatchObject({ state: 'kept' });
    for (let page = 0; page < 12; page += 1) expect((await client.call('GET', search(id, { q: `more ${String(page)}`, source: 'Pexels' }))).body).toMatchObject({ state: 'ok' });
    expect((await client.call('GET', `/api/v1/designer/sessions/${id}/picture-thumb/${shelf}/${pick}`)).status).toBe(200);
    // A picture of that page nobody pinned is gone with it.
    const other = (found.body['pictures'] as { id: string }[])[1]?.id as string;
    expect((await client.call('GET', `/api/v1/designer/sessions/${id}/picture-thumb/${shelf}/${other}`)).status).toBe(404);
  });

  it('is never fetched when its source shows it from its own site', async () => {
    const client = await server();
    const id = await client.session();
    const found = await client.call('GET', search(id, { q: 'diner', source: 'Unsplash' }));
    const picture = (found.body['pictures'] as { id: string; shown?: boolean }[])[0];
    expect(picture?.shown).toBe(true);
    const before = client.fake.calls['images.unsplash.com'] ?? 0;
    expect((await client.call('POST', `/api/v1/designer/sessions/${id}/pictures/pin`, { shelf: found.body['shelf'], picture: picture?.id })).body).toEqual({ state: 'kept', small: false, shown: true });
    expect(client.fake.calls['images.unsplash.com'] ?? 0).toBe(before);
  });
});

// ── an app with picture spots ────────────────────────────────────────────────

const APP = 'apps/crispy-bites';
const PICTURE_COLUMN = { ref: 'picture', type: 'text', semantic: 'image', nullable: true, label: { 'en-US': 'Picture' }, rules: { file: { accept: ['png', 'jpeg', 'webp', 'gif'], maxBytes: 5_242_880 } } };

/** The first turn: the starter's files, a table whose rows take a picture, and two sample rows. */
const writesApp: ScriptStep = () => {
  const parts = starterParts({ key: 'crispy-bites', name: 'Crispy Bites', sides: [], version: APP_VERSION });
  const items = parts['manifest/tables/items.json'] as { columns: unknown[] };
  const files: Record<string, unknown> = {
    ...parts,
    'manifest/tables/items.json': { ...items, columns: [...items.columns, PICTURE_COLUMN] },
    'manifest/sample.json': { sampleData: { file: 'seeds/sample.json' } },
    'seeds/sample.json': { format: 'adminium.sample/1', app: 'crispy-bites', tables: [{ ref: 'items', rows: [{ title: 'Spicy wings', picture: null }, { title: 'Classic burger', picture: null }] }] },
  };
  return { calls: Object.entries(files).filter(([file]) => file !== 'manifest/app.json').map(([file, value]) => ({ name: 'write_file', arguments: { path: `${APP}/${file}`, content: JSON.stringify(value, null, 2) } })) };
};

const SPOTS = {
  hero: { label: 'Hero', shape: 'wide', shows: 'the shop at night', search: 'fried chicken', file: null, alt: '', decorative: false },
  team: { label: 'Team', shape: 'wide', shows: 'the people who cook', search: 'chefs', file: null, alt: '', decorative: false },
  kitchen: { label: 'Kitchen', shape: 'square', shows: 'the kitchen', search: 'kitchen', file: null, alt: '', decorative: false },
};

type Picked = { shelf: string; picture: string };
interface WithApp extends Client {
  id: string;
  state: () => Promise<{ spots: { id: string; version: string; thumb: string | null; licence: { code: string } | null }[]; tables: { table: string; rows: { row: number; version: string; label: string; thumb: string | null }[] }[]; inApp: { key: string }[]; version: number | null; legacy: number }>;
  /** A search on a source, and its first pictures, each picked (kept with its bytes). */
  pick: (q: string, count?: number, source?: string) => Promise<Picked[]>;
  apply: (fills: unknown[], id?: string) => Promise<{ status: number; body: Record<string, unknown> }>;
  disk: (path: string) => string;
}

async function withApp(): Promise<WithApp> {
  const client = await server();
  script = [writesApp];
  const made = await client.call('POST', '/api/v1/designer/sessions', { name: 'Crispy Bites', target: 'auto', connectionId: 'env:ollama', model: 'fake', text: 'Make me a fried chicken shop.' });
  expect(made.status, JSON.stringify(made.body)).toBe(201);
  const id = (made.body['session'] as { id: string }).id;
  await vi.waitFor(async () => expect(((await client.call('GET', `/api/v1/designer/sessions/${id}/events-since?after=0`)).body['events'] as { kind: string }[]).some((event) => event.kind === 'turn-finished')).toBe(true), { timeout: 60_000, interval: 100 });
  addSide({ root: client.root, key: 'crispy-bites', name: 'Crispy Bites', side: 'customer' });
  const without = missingFonts(client.root, cleanLook({ skill: 'clean' }), { builtInDir: builtInStylesDir() }).map((font) => font.family);
  writeFileSync(join(client.root, APP, 'look.json'), JSON.stringify({ skill: 'clean', without }));
  writeFileSync(join(client.root, APP, 'assets', 'pictures', 'spots.json'), JSON.stringify(SPOTS, null, 2));
  const styled = await client.call('POST', `/api/v1/designer/sessions/${id}/look`, { skill: 'clean' });
  expect(styled.body, JSON.stringify(styled.body)).toMatchObject({ applied: true });
  const state = async () => (await client.call('GET', `/api/v1/designer/sessions/${id}/pictures`)).body as never;
  return {
    ...client,
    id,
    state,
    pick: async (q, count = 1, source = 'Openverse') => {
      const found = await client.call('GET', search(id, { q, source }));
      const shelf = found.body['shelf'] as string;
      const out: Picked[] = [];
      for (const picture of (found.body['pictures'] as { id: string }[]).slice(0, count)) {
        expect((await client.call('POST', `/api/v1/designer/sessions/${id}/pictures/pin`, { shelf, picture: picture.id })).body).toMatchObject({ state: 'kept' });
        out.push({ shelf, picture: picture.id });
      }
      return out;
    },
    apply: async (fills, applyId = `apply-${Math.random().toString(36).slice(2, 12)}`) => client.call('POST', `/api/v1/designer/sessions/${id}/pictures/apply`, { id: applyId, fills }),
    disk: (path) => readFileSync(join(client.root, APP, path), 'utf8'),
  };
}

const versionOf = (state: Awaited<ReturnType<WithApp['state']>>, spot: string): string => state.spots.find((entry) => entry.id === spot)?.version as string;

describe('the picture dialog’s view of an app', { timeout: 180_000 }, () => {
  it('lists the spots with their versions, the tables whose rows take a picture, and serves the app’s own pictures and nothing else', async () => {
    const app = await withApp();
    const state = await app.state();
    expect(state.spots.map((spot) => [spot.id, spot.thumb])).toEqual([['hero', null], ['team', null], ['kitchen', null]]);
    expect(state.tables).toEqual([
      {
        table: 'items',
        label: expect.any(String),
        column: 'picture',
        people: false,
        groups: [],
        rows: [expect.objectContaining({ row: 1, label: 'Spicy wings', thumb: null }), expect.objectContaining({ row: 2, label: 'Classic burger' })],
      },
    ]);
    // The words a made picture starts from, by plain code.
    expect((state.tables[0]?.rows[0] as unknown as { words: string }).words).toMatch(/^Spicy wings/);
    expect((state.spots[0] as unknown as { words: string }).words).toMatch(/^fried chicken, for /);
    expect(state.version).toBe(2);
    expect(state.legacy).toBe(0);
    for (const path of ['../../../.env', 'assets/pictures/../../look.json', 'assets/pictures/spots.json', 'look.json', 'seeds/sample.json']) {
      expect((await app.call('GET', `/api/v1/designer/sessions/${app.id}/pictures/file?path=${encodeURIComponent(path)}`)).status, path).toBe(404);
    }
  });
});

describe('Apply', { timeout: 180_000 }, () => {
  it('puts a pick from a search in its spot with its credit, saves a version named for it, says so in the chat, and tells the page', async () => {
    const app = await withApp();
    const [hero] = await app.pick('fried chicken');
    // Twelve more pages of results: the pick from the first is still there to apply.
    for (let page = 0; page < 12; page += 1) await app.call('GET', search(app.id, { q: `more ${String(page)}`, source: 'Openverse' }));
    const before = await app.state();
    const applied = await app.apply([{ spot: 'hero', version: versionOf(before, 'hero'), from: hero, alt: 'Fried chicken on a board' }]);
    expect(applied.status, JSON.stringify(applied.body)).toBe(200);
    expect(applied.body).toMatchObject({ results: [{ target: 'spot:hero', state: 'applied' }], applied: true, before: 2, version: { n: 3, name: 'v3 · Pictures: Hero' } });
    const spots = JSON.parse(app.disk('assets/pictures/spots.json')) as Record<string, { file: string | null; alt: string }>;
    expect(spots['hero']).toMatchObject({ alt: 'Fried chicken on a board', file: expect.stringMatching(/^hero-[0-9a-f]{8}\.jpg$/) });
    expect(readFileSync(join(app.root, APP, 'assets', 'pictures', spots['hero']?.file as string)).subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    const credits = JSON.parse(app.disk('assets/pictures/CREDITS.json')) as { file: string; licence: string; licenceCode: string; creator: string }[];
    expect(credits).toEqual([expect.objectContaining({ file: `assets/pictures/${spots['hero']?.file as string}`, licence: 'CC BY 2.0', licenceCode: 'by', creator: 'Maker 1' })]);
    const events = (await app.call('GET', `/api/v1/designer/sessions/${app.id}/events-since?after=0`)).body['events'] as { kind: string; by?: string; what?: string; names?: string[]; version?: unknown }[];
    expect(events.filter((event) => event.by === 'person').slice(-7).map((event) => event.kind)).toEqual(['hold', 'check', 'build', 'apply', 'version', 'pictures', 'released']);
    expect(events.find((event) => event.kind === 'hold' && event.what === 'pictures')).toBeDefined();
    expect(events.find((event) => event.kind === 'pictures')).toMatchObject({ names: ['Hero'], version: { n: 3 } });
    // The dialog now shows it, with its licence.
    expect((await app.state()).spots[0]).toMatchObject({ id: 'hero', licence: { code: 'by' }, thumb: expect.stringContaining('/pictures/file?path=assets%2Fpictures%2Fhero-') });
  });

  it('writes nothing over a spot someone changed since the dialog opened, and applies the others', async () => {
    const app = await withApp();
    const opened = await app.state();
    const [one, two, three] = await app.pick('kitchen', 3);
    expect((await app.apply([{ spot: 'kitchen', version: versionOf(opened, 'kitchen'), from: one }])).body).toMatchObject({ results: [{ state: 'applied' }] });
    const placed = (JSON.parse(app.disk('assets/pictures/spots.json')) as Record<string, { file: string }>)['kitchen']?.file;
    // The second dialog was opened before that Apply.
    const second = await app.apply([
      { spot: 'kitchen', version: versionOf(opened, 'kitchen'), from: two },
      { spot: 'team', version: versionOf(opened, 'team'), from: three },
    ]);
    expect(second.body['results']).toEqual([{ target: 'spot:kitchen', state: 'conflict' }, { target: 'spot:team', state: 'applied' }]);
    const spots = JSON.parse(app.disk('assets/pictures/spots.json')) as Record<string, { file: string }>;
    // The first person's picture stays where they put it.
    expect(spots['kitchen']?.file).toBe(placed);
    expect(spots['team']?.file).toMatch(/^team-/);
    expect((second.body['version'] as { name: string }).name).toMatch(/Pictures: Team$/);
  });

  it('applies a repeated Apply once, and answers the repeat with the first answer', async () => {
    const app = await withApp();
    const opened = await app.state();
    const [pick] = await app.pick('team');
    const fills = [{ spot: 'team', version: versionOf(opened, 'team'), from: pick }];
    const [first, again] = await Promise.all([app.apply(fills, 'apply-same-0001'), app.apply(fills, 'apply-same-0001')]);
    expect(again.body).toEqual(first.body);
    expect((await app.apply(fills, 'apply-same-0001')).body).toEqual(first.body);
    const versions = (await app.call('GET', `/api/v1/designer/sessions/${app.id}/versions`)).body['versions'] as { name: string }[];
    expect(versions.filter((version) => version.name.includes('Pictures: Team'))).toHaveLength(1);
  });

  it('leaves no credited picture without its credit when it stops between the credits and the spots', async () => {
    const app = await withApp();
    const opened = await app.state();
    const [pick] = await app.pick('chicken');
    failWrite = 'assets/pictures/spots.json';
    expect((await app.apply([{ spot: 'hero', version: versionOf(opened, 'hero'), from: pick }])).status).toBe(500);
    // The spots are as they were: no screen shows a picture whose credit is missing. The extra credit line is harmless.
    expect(JSON.parse(app.disk('assets/pictures/spots.json'))).toEqual(SPOTS);
    const credits = JSON.parse(app.disk('assets/pictures/CREDITS.json')) as { licenceCode: string }[];
    expect(credits.map((line) => line.licenceCode)).toEqual(['by']);
    // The folder is let go, and the next Apply goes through.
    failWrite = null;
    expect((await app.apply([{ spot: 'hero', version: versionOf(opened, 'hero'), from: pick }])).body).toMatchObject({ results: [{ state: 'applied' }], applied: true });
  });

  it('says a pick whose page of results is gone as gone, a small copy as applied with a warning, and applies the rest', async () => {
    const app = await withApp();
    const opened = await app.state();
    app.fake.big.add('kitchen-1-1.jpg');
    const [, small] = await app.pick('kitchen', 2);
    const result = await app.apply([
      { spot: 'hero', version: versionOf(opened, 'hero'), from: { shelf: 'shelf_00000000000000aa', picture: 'pic_0000000000aa' } },
      { spot: 'kitchen', version: versionOf(opened, 'kitchen'), from: small },
    ]);
    expect(result.body['results']).toEqual([{ target: 'spot:hero', state: 'gone' }, { target: 'spot:kitchen', state: 'applied', small: true }]);
  });

  it('gives each sample row a file of its own, from a search or from a picture already in the app, and adds the installed rows again with it', async () => {
    const app = await withApp();
    const opened = await app.state();
    const [pick] = await app.pick('wings');
    const rows = opened.tables[0]?.rows ?? [];
    const first = await app.apply([{ row: { table: 'items', row: 1 }, version: rows[0]?.version, from: pick }]);
    expect(first.body).toMatchObject({ results: [{ target: 'row:items:1', state: 'applied' }], applied: true });
    const bundle = JSON.parse(app.disk('seeds/sample.json')) as { assets: Record<string, { file: string; sha256: string }>; tables: { rows: Record<string, unknown>[] }[] };
    expect(bundle.tables[0]?.rows[0]?.['picture']).toEqual({ '@asset': 'picture-items-1' });
    const asset = bundle.assets['picture-items-1'] as { file: string; sha256: string };
    expect(asset.file).toMatch(/^seeds\/pictures\/items-1-[0-9a-f]{8}\.jpg$/);
    // The installed sample row was added again with the picture: a stored file of the same bytes holds it.
    await vi.waitFor(async () => expect((await app.meta.db.selectFrom('adminium_files').select('sha256').where('sha256', '=', asset.sha256).execute()).length).toBeGreaterThan(0), { timeout: 30_000 });
    // The same picture for the second row, from the app: a copy of its own.
    writeFileSync(join(app.root, APP, 'assets', 'pictures', 'shop.jpg'), readFileSync(join(app.root, APP, asset.file)));
    const second = await app.apply([{ row: { table: 'items', row: 2 }, version: rows[1]?.version, from: { file: 'shop.jpg' } }]);
    expect(second.body).toMatchObject({ results: [{ state: 'applied' }] });
    const after = JSON.parse(app.disk('seeds/sample.json')) as { assets: Record<string, { file: string }> };
    expect(after.assets['picture-items-2']?.file).toMatch(/^seeds\/pictures\/items-2-/);
    expect(after.assets['picture-items-2']?.file).not.toBe(after.assets['picture-items-1']?.file);
  });

  it('keeps what a design does with pictures, chosen in its footer, with the pictures it saves, or alone', async () => {
    const app = await withApp();
    const opened = await app.state();
    const [pick] = await app.pick('team');
    const both = await app.call('POST', `/api/v1/designer/sessions/${app.id}/pictures/apply`, { id: 'apply-mode-0001', fills: [{ spot: 'team', version: versionOf(opened, 'team'), from: pick }], mode: 'choose' });
    expect(both.body).toMatchObject({ applied: true, version: { name: expect.stringContaining('Pictures: Team') } });
    expect(JSON.parse(app.disk('look.json'))).toMatchObject({ pictures: 'choose' });
    expect((await app.state() as unknown as { mode: string }).mode).toBe('choose');
    const alone = await app.call('POST', `/api/v1/designer/sessions/${app.id}/pictures/apply`, { id: 'apply-mode-0002', fills: [], mode: 'placeholders' });
    expect(alone.body).toMatchObject({ results: [], applied: true, version: { name: expect.stringContaining('Pictures: placeholders after each design') } });
    expect(JSON.parse(app.disk('look.json'))).toMatchObject({ pictures: 'placeholders' });
    // Nothing to change at all is no Apply.
    expect((await app.call('POST', `/api/v1/designer/sessions/${app.id}/pictures/apply`, { id: 'apply-mode-0003', fills: [] })).status).toBe(422);
  });

  it('keeps the choice of an app with no look kept, with the look its sides are drawn with; one whose look was kept before styles is asked none', async () => {
    const app = await withApp();
    rmSync(join(app.root, APP, 'look.json'));
    expect((await app.state() as unknown as { mode: string | null }).mode).toBe('placeholders');
    const kept = await app.call('POST', `/api/v1/designer/sessions/${app.id}/pictures/apply`, { id: 'apply-nolook-01', fills: [], mode: 'choose' });
    expect(kept.body).toMatchObject({ applied: true });
    expect(JSON.parse(app.disk('look.json'))).toMatchObject({ skill: 'clean', pictures: 'choose' });
    writeFileSync(join(app.root, APP, 'look.json'), JSON.stringify({ direction: 'warm' }));
    expect((await app.state() as unknown as { mode: string | null }).mode).toBeNull();
  });

  it('is refused while a turn runs: “Wait for the Designer to finish, then apply.”', async () => {
    const app = await withApp();
    const opened = await app.state();
    const [pick] = await app.pick('team');
    waits = true;
    expect((await app.call('POST', `/api/v1/designer/sessions/${app.id}/turns`, { text: 'Make the hero bigger.' })).status).toBe(202);
    const refused = await app.apply([{ spot: 'team', version: versionOf(opened, 'team'), from: pick }]);
    expect([refused.status, (refused.body['error'] as { details?: { reason?: string } }).details?.reason]).toEqual([409, 'TURN_RUNNING']);
    expect(JSON.parse(app.disk('assets/pictures/spots.json'))).toEqual(SPOTS);
  });

  it('tells Unsplash once a picture of its is in a spot, after the write, and lets the page load pictures from its site', async () => {
    const app = await withApp();
    const opened = await app.state();
    const [pick] = await app.pick('diner', 1, 'Unsplash');
    const before = app.fake.seen.filter((url) => url.endsWith('/download')).length;
    const done = await app.apply([{ spot: 'hero', version: versionOf(opened, 'hero'), from: pick }]);
    expect(done.body).toMatchObject({ results: [{ state: 'applied' }] });
    expect((JSON.parse(app.disk('assets/pictures/spots.json')) as Record<string, { file: string }>)['hero']?.file).toBe('https://images.unsplash.com/diner-1-0?w=1080');
    await vi.waitFor(() => expect(app.fake.seen.filter((url) => url.endsWith('/download')).length).toBe(before + 1));
    expect(app.disk('assets/pictures/CREDITS.json')).toContain('Unsplash licence');
  });

  it('is undone back to the version before it, said in the chat; and not once the app changed since', async () => {
    const app = await withApp();
    const opened = await app.state();
    const [pick] = await app.pick('team');
    const done = await app.apply([{ spot: 'team', version: versionOf(opened, 'team'), from: pick }]);
    const undo = await app.call('POST', `/api/v1/designer/sessions/${app.id}/pictures/undo`, { from: (done.body['version'] as { n: number }).n, to: done.body['before'] });
    expect(undo.status, JSON.stringify(undo.body)).toBe(200);
    expect(JSON.parse(app.disk('assets/pictures/spots.json'))).toEqual(SPOTS);
    const events = (await app.call('GET', `/api/v1/designer/sessions/${app.id}/events-since?after=0`)).body['events'] as { kind: string; to?: number }[];
    expect(events.find((event) => event.kind === 'pictures')).toMatchObject({ names: ['Team'], version: { n: 3 } });
    expect(events.at(-1)).toMatchObject({ kind: 'pictures-undone', to: 2 });
    // Undone already: the app is at another version now.
    expect((await app.call('POST', `/api/v1/designer/sessions/${app.id}/pictures/undo`, { from: (done.body['version'] as { n: number }).n, to: done.body['before'] })).status).toBe(409);
  });
});

describe('the picture spots, as a turn that applied ends', { timeout: 180_000 }, () => {
  const turnEvents = async (app: WithApp, turn: number): Promise<{ kind: string; turn: number; note?: string; count?: number; card?: { type: string; spots?: { id: string }[]; rows?: unknown } }[]> => {
    let events: { kind: string; turn: number }[] = [];
    await vi.waitFor(
      async () => {
        events = (await app.call('GET', `/api/v1/designer/sessions/${app.id}/events-since?after=0`)).body['events'] as never;
        expect(events.filter((event) => event.kind === 'turn-finished')).toHaveLength(turn);
      },
      { timeout: 60_000, interval: 100 },
    );
    return events.filter((event) => event.turn === turn) as never;
  };
  const addsSpot: ScriptStep = () => ({ calls: [{ name: 'add_spots', arguments: { spots: [{ id: 'deals', label: 'Deals', shape: 'wide', shows: 'the deals of the week' }] } }] });

  it('says the spots it made are placeholders when nobody chose, opens the picture card when the person chose to, and reminds of empty ones after', async () => {
    const app = await withApp();
    script = [addsSpot];
    expect((await app.call('POST', `/api/v1/designer/sessions/${app.id}/turns`, { text: 'Add a deals section.' })).status).toBe(202);
    const first = await turnEvents(app, 2);
    expect(first.find((event) => event.kind === 'pictures-note')).toMatchObject({ note: 'placeholders', count: 4 });
    expect(first.some((event) => event.kind === 'card')).toBe(false);

    // The person chose to pick pictures after each design.
    const look = JSON.parse(app.disk('look.json')) as Record<string, unknown>;
    writeFileSync(join(app.root, APP, 'look.json'), JSON.stringify({ ...look, pictures: 'choose' }));
    script = [() => ({ calls: [{ name: 'add_spots', arguments: { spots: [{ id: 'menu', label: 'Menu', shape: 'square' }] } }] })];
    expect((await app.call('POST', `/api/v1/designer/sessions/${app.id}/turns`, { text: 'Add a menu picture.' })).status).toBe(202);
    const second = await turnEvents(app, 3);
    const card = second.find((event) => event.kind === 'card')?.card;
    expect(card).toMatchObject({ type: 'spots', rows: { count: 2 } });
    expect(card?.spots?.map((spot) => spot.id)).toEqual(['hero', 'team', 'kitchen', 'deals', 'menu']);
    // It waits for nothing: the turn is over, and nobody is asked.
    expect(second.at(-1)?.kind).toBe('turn-finished');

    // A turn that makes no spot, while some are empty: one line.
    expect((await app.call('POST', `/api/v1/designer/sessions/${app.id}/turns`, { text: 'Make the title bigger.' })).status).toBe(202);
    expect((await turnEvents(app, 4)).find((event) => event.kind === 'pictures-note')).toMatchObject({ note: 'still-empty', count: 5 });
  });
});

describe('a picture the person placed', { timeout: 180_000 }, () => {
  const HERO = `${APP}/customer/src/Hero.tsx`;
  const drawn = "import { Picture } from '@adminiumjs/adminium/side';\n\nexport function Hero() {\n  return <Picture spot=\"hero\" className=\"hero-media\" />;\n}\n";
  const gone = 'export function Hero() {\n  return <h1>Crispy Bites</h1>;\n}\n';

  /** An app whose hero the person filled, on a screen that draws it. */
  async function placed(): Promise<WithApp> {
    const app = await withApp();
    writeFileSync(join(app.root, HERO), drawn);
    const opened = await app.state();
    const [pick] = await app.pick('hero');
    expect((await app.apply([{ spot: 'hero', version: versionOf(opened, 'hero'), from: pick }])).body).toMatchObject({ applied: true });
    return app;
  }
  const eventsOf = async (app: WithApp) => (await app.call('GET', `/api/v1/designer/sessions/${app.id}/events-since?after=0`)).body['events'] as { kind: string; turn: number; outcome?: string; card?: { id: string; type: string; label?: string; screen?: string }; message?: string; stage?: string }[];
  const turnOf = async (app: WithApp, text: string, steps: ScriptStep[]): Promise<number> => {
    script = steps;
    const started = await app.call('POST', `/api/v1/designer/sessions/${app.id}/turns`, { text });
    expect(started.status, JSON.stringify(started.body)).toBe(202);
    return started.body['turn'] as number;
  };

  it('is not taken off its screen by a turn without the person’s word: “Keep it there” stops the apply and says what to put back', async () => {
    const app = await placed();
    const turn = await turnOf(app, 'Make the hero a heading.', [() => ({ calls: [{ name: 'write_file', arguments: { path: HERO, content: gone } }] })]);
    let card: { id: string; type: string; label?: string; screen?: string } | undefined;
    await vi.waitFor(async () => {
      card = (await eventsOf(app)).find((event) => event.kind === 'card' && event.turn === turn && event.card?.type === 'keep-spot')?.card;
      expect(card).toBeDefined();
    }, { timeout: 60_000, interval: 100 });
    expect(card).toMatchObject({ type: 'keep-spot', spot: 'hero', label: 'Hero', screen: 'Hero' });
    expect((await app.call('POST', `/api/v1/designer/sessions/${app.id}/answers`, { cardId: card?.id, value: { accept: true } })).status).toBe(200);
    await vi.waitFor(async () => expect((await eventsOf(app)).find((event) => event.kind === 'turn-finished' && event.turn === turn)).toMatchObject({ outcome: 'not-applied' }), { timeout: 60_000, interval: 100 });
    const refused = (await eventsOf(app)).filter((event) => event.kind === 'apply' && event.turn === turn).at(-1);
    expect(refused).toMatchObject({ stage: 'pictures', message: expect.stringContaining('put <Picture spot="hero" /> back in customer/src/Hero.tsx') });
    // The spot keeps its picture: nothing of the person's was undone.
    expect((JSON.parse(app.disk('assets/pictures/spots.json')) as Record<string, { file: string | null }>)['hero']?.file).not.toBeNull();
  });

  it('lets it go when the person says so, and the turn applies', async () => {
    const app = await placed();
    const turn = await turnOf(app, 'Make the hero a heading.', [() => ({ calls: [{ name: 'write_file', arguments: { path: HERO, content: gone } }] })]);
    let card: { id: string } | undefined;
    await vi.waitFor(async () => {
      card = (await eventsOf(app)).find((event) => event.kind === 'card' && event.turn === turn && event.card?.type === 'keep-spot')?.card;
      expect(card).toBeDefined();
    }, { timeout: 60_000, interval: 100 });
    await app.call('POST', `/api/v1/designer/sessions/${app.id}/answers`, { cardId: card?.id, value: { accept: false } });
    await vi.waitFor(async () => expect((await eventsOf(app)).find((event) => event.kind === 'turn-finished' && event.turn === turn)).toMatchObject({ outcome: 'done' }), { timeout: 60_000, interval: 100 });
  });

  it('asks nothing of a turn that leaves it where it is, or moves an empty spot', async () => {
    const app = await placed();
    const turn = await turnOf(app, 'Make the hero rounder.', [() => ({ calls: [{ name: 'write_file', arguments: { path: HERO, content: drawn.replace('hero-media', 'hero-media round') } }] })]);
    await vi.waitFor(async () => expect((await eventsOf(app)).find((event) => event.kind === 'turn-finished' && event.turn === turn)).toMatchObject({ outcome: 'done' }), { timeout: 60_000, interval: 100 });
    expect((await eventsOf(app)).some((event) => event.kind === 'card' && event.card?.type === 'keep-spot')).toBe(false);
  });
});

// ─── making a picture with AI ──────────────────────────────────────

type MadePicture = { id: string; shelf: string; title: string; creator: string; licence: { code: string }; made: { label: string; model: string; words: string }; pinned: boolean };
type Job = { job: string; state: string; stoppedBy?: string; lines: { name: string; asked: number; made: number; refused: number; failed: number; state: string; code?: string; pictures: MadePicture[] }[]; left: { mine: number; all: number } };

/** Make, and wait for the job to end. */
async function make(app: WithApp, body: Record<string, unknown>): Promise<{ status: number; reply: Record<string, unknown>; job: Job | null }> {
  const res = await app.call('POST', `/api/v1/designer/sessions/${app.id}/pictures/make`, { id: `make-${Math.random().toString(36).slice(2, 12)}`, shape: 'wide', count: 1, ...body });
  if (res.body['state'] !== 'accepted') return { status: res.status, reply: res.body, job: null };
  const id = (res.body['job'] as Job).job;
  let job: Job | null = null;
  await vi.waitFor(
    async () => {
      job = (await app.call('GET', `/api/v1/designer/sessions/${app.id}/pictures/make/${id}`)).body as unknown as Job;
      expect(job.state).not.toBe('running');
    },
    { timeout: 20_000, interval: 50 },
  );
  return { status: res.status, reply: res.body, job };
}

const choose = async (app: WithApp) => {
  const chosen = await app.call('PUT', '/api/v1/designer/pictures/maker', { id: 'env:ollama', model: 'fake-picture-1' });
  expect(chosen.status, JSON.stringify(chosen.body)).toBe(200);
  return chosen.body;
};

describe('making a picture with AI', { timeout: 180_000 }, () => {
  it('makes nothing until someone who manages AI chooses a service, then makes, counts and keeps what it made', async () => {
    const app = await withApp();
    // Nobody chose: nothing is made, and nothing is counted.
    expect((await app.call('GET', '/api/v1/designer/pictures/makers')).body).toMatchObject({ state: 'none', chosen: null, canChoose: true, limits: { mine: 20, all: 100 } });
    expect((await make(app, { lines: [{ words: 'a fried chicken shop at night', target: { spot: 'hero' } }] })).reply).toEqual({ state: 'none' });
    expect(app.made).toHaveLength(0);

    const chosen = await choose(app);
    expect(chosen).toMatchObject({ state: 'ok', chosen: { id: 'env:ollama', model: 'fake-picture-1', local: true }, chat: true });
    expect((chosen['makers'] as { id: string; models: string[] }[]).find((one) => one.id === 'env:ollama')?.models).toEqual(['fake-picture-1']);

    const words = 'a fried chicken shop at night, warm light';
    const { status, job } = await make(app, { lines: [{ words, target: { spot: 'hero' } }], count: 2 });
    expect(status).toBe(200);
    expect(job).toMatchObject({ state: 'done', left: { mine: 18, all: 98 }, lines: [{ name: 'Hero', asked: 2, made: 2, refused: 0, failed: 0, state: 'done' }] });
    // Only the words, the model, the count and the shape reach the service.
    expect(app.made.at(-1)).toMatchObject({ prompt: words, model: 'fake-picture-1', shape: 'wide', count: 2 });
    const pictures = job?.lines[0]?.pictures ?? [];
    // Kept for an Apply only once it is picked: of two made, the one not chosen may make way later.
    expect(pictures[0]).toMatchObject({ title: 'Hero', creator: 'Ollama · fake-picture-1', licence: { code: 'made' }, made: { label: 'Ollama', model: 'fake-picture-1', words }, pinned: false });

    // Its tile is served from disk, whole, with the headers every picture of the dialog has.
    const tile = await app.call('GET', `/api/v1/designer/sessions/${app.id}/picture-thumb/${pictures[0]?.shelf ?? ''}/${pictures[0]?.id ?? ''}`);
    expect(tile.status).toBe(200);
    expect(tile.headers['content-type']).toBe('image/png');
    // Listed again from disk, for "Made earlier".
    expect(((await app.call('GET', `/api/v1/designer/sessions/${app.id}/pictures/made`)).body['pictures'] as unknown[]).length).toBe(2);
    // Its events reached the session's log.
    const events = (await app.call('GET', `/api/v1/designer/sessions/${app.id}/events-since?after=0`)).body['events'] as { kind: string }[];
    expect(events.filter((event) => event.kind === 'picture-make').length).toBeGreaterThanOrEqual(2);

    // Applied like any pick: the credit says it was made with AI, keeps the words, and the side draws neither the words nor a person.
    const state = await app.state();
    const applied = await app.apply([{ spot: 'hero', version: versionOf(state, 'hero'), from: { shelf: pictures[0]?.shelf, picture: pictures[0]?.id } }]);
    expect(applied.status, JSON.stringify(applied.body)).toBe(200);
    const creditOf = () => (JSON.parse(app.disk('assets/pictures/CREDITS.json')) as { file: string; licenceCode?: string; licence: string; words?: string; creator: string }[]).find((line) => line.licenceCode === 'made');
    expect(creditOf()).toMatchObject({ licence: 'Made with AI', creator: 'Ollama · fake-picture-1', words, source: 'AI' });
    // A second Apply, of another spot, keeps the words of the first.
    const [found] = await app.pick('kitchen');
    expect((await app.apply([{ spot: 'kitchen', version: versionOf(await app.state(), 'kitchen'), from: found }])).status).toBe(200);
    expect(creditOf()?.words).toBe(words);

    // The audit says who, which service and how many: never the words.
    const audit = await auditRepo(app.meta).list({ limit: 50 });
    const line = audit.find((entry) => entry.action === 'designer.picture.made');
    expect(line).toBeDefined();
    expect(JSON.stringify(line)).not.toContain('fried chicken');
  });

  it('answers the same request once, refuses its id for other words, and holds every make to the day’s allowance', async () => {
    const app = await withApp();
    await choose(app);
    const body = { id: 'make-same-0001', lines: [{ words: 'chefs at work', target: { spot: 'team' } }], shape: 'wide', count: 1 };
    const first = await app.call('POST', `/api/v1/designer/sessions/${app.id}/pictures/make`, body);
    const again = await app.call('POST', `/api/v1/designer/sessions/${app.id}/pictures/make`, body);
    expect((again.body['job'] as Job).job).toBe((first.body['job'] as Job).job);
    const other = await app.call('POST', `/api/v1/designer/sessions/${app.id}/pictures/make`, { ...body, lines: [{ words: 'something else', target: { spot: 'team' } }] });
    expect(other.status).toBe(409);
    await vi.waitFor(async () => expect(((await app.call('GET', '/api/v1/designer/pictures/makers')).body['left'] as { mine: number }).mine).toBe(19), { timeout: 10_000 });
    expect(app.made).toHaveLength(1);
    await vi.waitFor(async () => expect(((await app.call('GET', `/api/v1/designer/sessions/${app.id}/pictures/made`)).body['running'])).toBeNull(), { timeout: 10_000 });

    // Two Makes at the same moment (a double click): one is made and paid for, the other is busy.
    const twice = await Promise.all(
      ['make-twice-0001', 'make-twice-0002'].map((id) => app.call('POST', `/api/v1/designer/sessions/${app.id}/pictures/make`, { id, lines: [{ words: 'slow chefs', target: { spot: 'team' } }], shape: 'wide', count: 1 })),
    );
    expect(twice.map((res) => res.body['state']).sort()).toEqual(['accepted', 'busy']);
    await vi.waitFor(async () => expect(((await app.call('GET', '/api/v1/designer/pictures/makers')).body['left'] as { mine: number }).mine).toBe(18), { timeout: 10_000 });
    await vi.waitFor(async () => expect(((await app.call('GET', `/api/v1/designer/sessions/${app.id}/pictures/made`)).body['running'])).toBeNull(), { timeout: 10_000 });
    expect(app.made).toHaveLength(2);

    // Over the person's day: nothing is asked.
    await settingsRepo(app.meta).set('designer.pictures.perDay', 3);
    expect((await make(app, { lines: [{ words: 'x', target: { spot: 'hero' } }], count: 2 })).reply).toMatchObject({ state: 'allowance', left: { mine: 1 } });
    // 0 turns making off: not "no limit".
    await settingsRepo(app.meta).set('designer.pictures.perDay', 0);
    expect((await make(app, { lines: [{ words: 'x', target: { spot: 'hero' } }] })).reply).toEqual({ state: 'switched-off' });
    expect(app.made).toHaveLength(2);
  });

  it('keeps a refusal counted, gives back what a rate limit proves was never made, and stops the batch there', async () => {
    const app = await withApp();
    await choose(app);
    const day = assistantUseDay(Date.now());
    const userId = (await usersRepo(app.meta).findByEmail('owner@example.test'))?.id ?? '';
    const refused = await make(app, { lines: [{ words: 'please refuse this', target: { spot: 'hero' } }] });
    expect(refused.job?.lines[0]).toMatchObject({ refused: 1, made: 0, code: 'refused' });
    expect((await pictureUseRepo(app.meta).use(userId, day)).mine).toBe(1);

    const batch = await make(app, {
      lines: [
        { words: 'one kitchen', target: { spot: 'kitchen' } },
        { words: 'busy now', target: { spot: 'team' } },
        { words: 'never asked', target: { spot: 'hero' } },
      ],
    });
    expect(batch.job).toMatchObject({ state: 'stopped', stoppedBy: 'rate_limit' });
    expect(batch.job?.lines.map((line) => [line.made, line.state])).toEqual([
      [1, 'done'],
      [0, 'done'],
      [0, 'done'],
    ]);
    // The made one and the refusal stay counted; the rate-limited and the never-sent lines came back.
    expect((await pictureUseRepo(app.meta).use(userId, day)).mine).toBe(2);
    expect(app.made.map((one) => one.prompt)).toEqual(['please refuse this', 'one kitchen', 'busy now']);
  });

  it('refuses a group the table does not have, and puts one picture on several rows as one file', async () => {
    const app = await withApp();
    await choose(app);
    // A group is a value a column of the table really holds: this one does not.
    expect((await make(app, { lines: [{ words: 'chicken dishes', target: { table: 'items', column: 'title', value: 'Mains' } }], shape: 'square' })).status).toBe(422);
    const { job } = await make(app, { lines: [{ words: 'chicken dishes', target: { table: 'items', row: 1 } }], shape: 'square' });
    const picture = job?.lines[0]?.pictures[0];
    expect(job?.lines[0]).toMatchObject({ name: 'Spicy wings', made: 1 });
    const rows = (await app.state()).tables.find((table) => table.table === 'items')?.rows ?? [];
    const from = { shelf: picture?.shelf, picture: picture?.id };
    const applied = await app.apply(rows.map((row) => ({ row: { table: 'items', row: row.row }, version: row.version, from })));
    expect(applied.status, JSON.stringify(applied.body)).toBe(200);
    const bundle = JSON.parse(app.disk('seeds/sample.json')) as { assets: Record<string, { file: string }> };
    const files = new Set(Object.values(bundle.assets).map((asset) => asset.file));
    expect(Object.keys(bundle.assets)).toHaveLength(2);
    expect(files.size).toBe(1);
    const credits = (JSON.parse(app.disk('assets/pictures/CREDITS.json')) as { file: string; licenceCode?: string }[]).filter((line) => line.licenceCode === 'made');
    expect(credits.map((line) => line.file)).toEqual([...files]);
  });

  it('says the service changed when the key behind the choice is not the one it was made with', async () => {
    const app = await withApp();
    await choose(app);
    const held = await settingsRepo(app.meta).get('designer.pictures.maker');
    await settingsRepo(app.meta).set('designer.pictures.maker', { ...(held as { id: string; provider: string; keyHash: string; model: string }), keyHash: 'another-key' });
    expect((await app.call('GET', '/api/v1/designer/pictures/makers')).body).toMatchObject({ state: 'changed' });
    expect((await make(app, { lines: [{ words: 'x', target: { spot: 'hero' } }] })).reply).toEqual({ state: 'changed' });
    // A target the app does not have is refused before anything is asked.
    await choose(app);
    expect((await make(app, { lines: [{ words: 'x', target: { spot: 'nowhere' } }] })).status).toBe(422);
    expect(app.made).toHaveLength(0);
  });
});

describe('the Designer making pictures in the chat', { timeout: 180_000 }, () => {
  const finished = async (app: WithApp, turns: number) => {
    let events: { kind: string; turn: number; label?: string; tool?: string; state?: string; job?: Job; by?: string }[] = [];
    await vi.waitFor(
      async () => {
        events = (await app.call('GET', `/api/v1/designer/sessions/${app.id}/events-since?after=0`)).body['events'] as never;
        expect(events.filter((event) => event.kind === 'turn-finished')).toHaveLength(turns);
      },
      { timeout: 60_000, interval: 100 },
    );
    return events;
  };

  it('makes a spot’s picture with the chosen service, puts it in place, says it in its turn, and counts it', async () => {
    const app = await withApp();
    await choose(app);
    script = [() => ({ calls: [{ name: 'make_pictures', arguments: { for: 'spot', spot: 'hero', words: 'a crispy fried chicken bucket' } }] })];
    expect((await app.call('POST', `/api/v1/designer/sessions/${app.id}/turns`, { text: 'Make me a hero picture.' })).status).toBe(202);
    const events = await finished(app, 2);
    const made = events.find((event) => event.kind === 'picture-make' && event.by !== 'person');
    expect(made?.job).toMatchObject({ state: 'done', lines: [{ name: 'Hero', made: 1 }] });
    // The dialog's progress events are not in a chat turn: the chat's make said nothing as it went.
    expect(events.filter((event) => event.kind === 'picture-make')).toHaveLength(1);
    expect(app.made.at(-1)).toMatchObject({ prompt: 'a crispy fried chicken bucket', count: 1, shape: 'wide' });
    const spots = JSON.parse(app.disk('assets/pictures/spots.json')) as Record<string, { file: string | null; alt: string }>;
    expect(spots['hero']?.file).not.toBeNull();
    expect(spots['hero']?.alt).toBe('a crispy fried chicken bucket');
    expect((JSON.parse(app.disk('assets/pictures/CREDITS.json')) as { licenceCode?: string }[]).some((line) => line.licenceCode === 'made')).toBe(true);
    expect(((await app.call('GET', '/api/v1/designer/pictures/makers')).body['left'] as { mine: number }).mine).toBe(19);
  });

  it('makes nothing when the chat is switched off, or past what a turn may make', async () => {
    const app = await withApp();
    await choose(app);
    await app.call('PUT', '/api/v1/designer/pictures/maker', { chat: false });
    script = [() => ({ calls: [{ name: 'make_pictures', arguments: { for: 'spot', spot: 'hero' } }] })];
    await app.call('POST', `/api/v1/designer/sessions/${app.id}/turns`, { text: 'Pictures please.' });
    let events = await finished(app, 2);
    expect(events.find((event) => event.kind === 'step' && event.tool === 'make_pictures' && event.state === 'done')).toBeUndefined();
    expect(app.made).toHaveLength(0);

    await app.call('PUT', '/api/v1/designer/pictures/maker', { chat: true });
    await settingsRepo(app.meta).set('designer.pictures.perTurn', 1);
    script = [() => ({ calls: [{ name: 'make_pictures', arguments: { for: 'rows', table: 'items' } }] })];
    await app.call('POST', `/api/v1/designer/sessions/${app.id}/turns`, { text: 'Pictures for the menu.' });
    events = await finished(app, 3);
    expect(app.made).toHaveLength(0);
  });
});
