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
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { composeServer, type ComposedServer } from '../src/compose.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import type { MetaStoreHandle } from '../src/meta/store.js';
import { buildProject } from '../src/project/build.js';
import { APP_VERSION } from '../src/version.js';
import { asProject } from './app-project-helpers.js';
import { makeEnv } from './helpers.js';
import { fakePictures, type FakePictures } from './picture-sources-fake.js';
import { makeInstall, type Install } from './project-fixtures.js';

const DESIGN_PORT = 4798;
const HOST = `127.0.0.1:${String(DESIGN_PORT)}`;
const PASSWORD = 'a-long-enough-test-password-1!';

// A model that says it is done: these routes need a session, not a turn.
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
      const echo = sent.tools?.some((tool) => tool.function.name === 'echo') === true && !sent.messages.some((message) => message.role === 'tool');
      line({ model: 'fake', done: false, message: echo ? { role: 'assistant', content: '', tool_calls: [{ function: { name: 'echo', arguments: { word: 'adminium' } } }] } : { role: 'assistant', content: 'Done.' } });
      line({ model: 'fake', done: true, done_reason: 'stop', prompt_eval_count: 50, eval_count: 5, message: { role: 'assistant', content: '' } });
      response.end();
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
afterEach(async () => {
  vi.unstubAllEnvs();
  await composed?.app.close();
  composed = undefined;
  await install?.close();
  install = null;
});

export interface Client {
  root: string;
  fake: FakePictures;
  call: (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) => Promise<{ status: number; body: Record<string, unknown>; raw: Buffer; headers: Record<string, unknown> }>;
  session: () => Promise<string>;
}

async function server(opts: { keys?: boolean } = {}): Promise<Client> {
  if (opts.keys !== false) {
    vi.stubEnv('PEXELS_API_KEY', 'pexels-key');
    vi.stubEnv('UNSPLASH_ACCESS_KEY', 'unsplash-key');
  }
  install = await makeInstall();
  const root = asProject(install.dir);
  await buildProject({ root, configFile: join(root, 'adminium.config.ts') }, { version: APP_VERSION });
  const { meta } = install;
  const fake = fakePictures();
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
    fake,
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

  it('offers a source only with its key, and none where the server calls nothing outside', async () => {
    const client = await server({ keys: false });
    const id = await client.session();
    expect((await client.call('GET', search(id, { q: 'diner', source: 'Pexels' }))).body).toEqual({ state: 'off' });
    expect((await client.call('GET', search(id, { q: 'diner', source: 'Openverse' }))).body).toMatchObject({ state: 'ok' });
    // A source that is none of the three is no search at all.
    expect((await client.call('GET', search(id, { q: 'diner', source: 'Nowhere' }))).status).toBe(422);
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
