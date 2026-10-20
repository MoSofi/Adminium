// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/api/v1/designer/figma`, the whole server: a person connects their own Figma token, imports a
 * frame, and sends it with a message. Figma is a fake reached through the safe fetch's own seams (a
 * test-only compose option): there is no setting that points the server anywhere but api.figma.com.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

import { figmaTokensRepo, rolesRepo, usersRepo, type MetaDb } from '@adminium/meta';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { hashPassword } from '../src/auth/passwords.js';
import { composeServer, type ComposedServer } from '../src/compose.js';
import { decryptSecret, deriveKey } from '../src/config/secrets.js';
import { createAttachments } from '../src/designer/attachments.js';
import { FIGMA_TOKEN_SALT } from '../src/designer/figma/tokens.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import type { MetaStoreHandle } from '../src/meta/store.js';
import { buildProject } from '../src/project/build.js';
import { APP_VERSION } from '../src/version.js';
import { asProject } from './app-project-helpers.js';
import { checkoutFrame, fakeFigma, type FakeFigma } from './figma-fake.js';
import { makeEnv, TEST_SECRET } from './helpers.js';
import { makeInstall, type Install } from './project-fixtures.js';

const KEY = 'AbCdEf0123456789';
const TOKEN = 'figd_good_token_0001';
const LINK = `https://www.figma.com/design/${KEY}/Crispy-Bites?node-id=1-2`;
const DESIGN_PORT = 4799;
const HOST = `127.0.0.1:${String(DESIGN_PORT)}`;
const PASSWORD = 'a-long-enough-test-password-1!';

// A model the Designer can build with: it passes the build check (calls `echo`) and otherwise says it is done.
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

interface Client {
  meta: MetaDb;
  root: string;
  fake: FakeFigma;
  call: (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown, cookie?: string) => Promise<{ status: number; body: Record<string, unknown> }>;
  owner: string;
  /** A second person, who may use the Designer. */
  other: () => Promise<string>;
}

async function server(opts: { designer?: boolean; environment?: Record<string, string> } = {}): Promise<Client> {
  install = await makeInstall();
  const root = asProject(install.dir);
  await buildProject({ root, configFile: join(root, 'adminium.config.ts') }, { version: APP_VERSION });
  const { meta } = install;
  const fake = fakeFigma();
  fake.files.set(KEY, { name: 'Crispy Bites', version: '42', nodes: { '1:2': checkoutFrame() } });
  const runService = createRunService({ meta });
  const store: MetaStoreHandle = { meta, url: 'sqlite::memory:', engine: 'sqlite', source: 'embedded', close: async () => Promise.resolve() };
  composed = await composeServer({
    env: makeEnv({ HOST: '127.0.0.1', ADMINIUM_AI_OLLAMA_BASE_URL: modelUrl, ADMINIUM_AI_MODEL: 'ollama/fake', ...(opts.environment ?? {}) }),
    metaStore: store,
    manager: install.manager,
    runService,
    applyService: createApplyService({ meta, runService }),
    allowed: { templates: [], widgets: [], widgetContracts: {} },
    logger: false,
    telemetry: false,
    onMetaRelocated: () => undefined,
    project: { root, mode: 'dev', log: () => undefined, warn: () => undefined, databases: ['main'] },
    ...(opts.designer === false ? {} : { designer: { mode: 'local' as const, token: 'a'.repeat(64), port: DESIGN_PORT } }),
    designerBundler: () => true,
    figmaSeams: fake.seams,
  });
  const { app } = composed;
  await app.ready();
  const setup = await app.inject({ method: 'POST', url: '/api/v1/setup/super-admin', headers: { host: HOST }, payload: { email: 'owner@example.test', password: PASSWORD, name: 'Owner' } });
  expect(setup.statusCode, setup.body).toBe(201);
  const owner = String(setup.headers['set-cookie']).split(';')[0] ?? '';
  const call: Client['call'] = async (method, url, payload, cookie = owner) => {
    const res = await app.inject({ method, url, headers: { host: HOST, ...(cookie === '' ? {} : { cookie }) }, ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }) });
    return { status: res.statusCode, body: (res.body === '' ? {} : res.json()) as Record<string, unknown> };
  };
  return {
    meta,
    root,
    fake,
    call,
    owner,
    other: async () => {
      // Ben, a second Super Admin: made in the store, signed in as anyone is.
      const ben = await usersRepo(meta).create({ email: 'ben@example.test', name: 'Ben', passwordHash: await hashPassword(PASSWORD) });
      const role = await rolesRepo(meta).findBySlug('super-admin');
      await rolesRepo(meta).assignToUser(ben.id, (role as { id: string }).id);
      const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { host: HOST }, payload: { email: 'ben@example.test', password: PASSWORD } });
      expect(login.statusCode, login.body).toBe(200);
      return String(login.headers['set-cookie']).split(';')[0] ?? '';
    },
  };
}

describe('a person’s Figma connection', { timeout: 120_000 }, () => {
  it('is checked with Figma before it is kept, kept encrypted under its own key, and never sent back', async () => {
    const client = await server();
    expect((await client.call('GET', '/api/v1/designer/figma')).body).toEqual({ connected: false, source: null, handle: null, network: true, lasting: true });

    const refused = await client.call('PUT', '/api/v1/designer/figma', { token: 'figd_dead_token_0000' });
    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({ error: { message: 'Figma did not accept this token. Check it and paste it again.', details: { reason: 'FIGMA', figma: { kind: 'token' } } } });
    expect((await figmaTokensRepo(client.meta).read((await client.meta.db.selectFrom('adminium_users').select('id').executeTakeFirstOrThrow()).id))?.encrypted).toBeNull();

    const saved = await client.call('PUT', '/api/v1/designer/figma', { token: TOKEN });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body).toEqual({ connected: true, source: 'mine', handle: 'ava.reyes', network: true, lasting: true });
    const row = await client.meta.db.selectFrom('adminium_users').select(['figmaTokenEncrypted', 'figmaUserId']).where('email', '=', 'owner@example.test').executeTakeFirstOrThrow();
    expect(row.figmaTokenEncrypted).not.toContain(TOKEN);
    expect(decryptSecret(row.figmaTokenEncrypted as string, deriveKey(TEST_SECRET, FIGMA_TOKEN_SALT))).toBe(TOKEN);
    // Not under the two-factor key, nor any other.
    expect(() => decryptSecret(row.figmaTokenEncrypted as string, deriveKey(TEST_SECRET, 'adminium:totp-secret'))).toThrow();
    expect(row.figmaUserId).toBe('1111');

    // No reply carries the token or its envelope: the person's own, the users routes, the audit log.
    for (const path of ['/api/v1/designer/figma', '/api/v1/me', '/api/v1/users', '/api/v1/audit']) {
      const text = JSON.stringify((await client.call('GET', path)).body);
      expect(text, path).not.toContain(TOKEN);
      expect(text, path).not.toContain(String(row.figmaTokenEncrypted).slice(0, 24));
    }
    const audits = await client.meta.db.selectFrom('adminium_audit_log').select(['action', 'changes']).where('action', 'like', 'designer.figma.%').execute();
    expect(audits.map((entry) => entry.action)).toEqual(['designer.figma.connected']);
  });

  it('is taken off the server by Disconnect, with what was read with it', async () => {
    const client = await server();
    await client.call('PUT', '/api/v1/designer/figma', { token: TOKEN });
    expect((await client.call('POST', '/api/v1/designer/figma/import', { link: LINK })).status).toBe(200);
    const gone = await client.call('DELETE', '/api/v1/designer/figma');
    expect(gone.body).toMatchObject({ connected: false, source: null, handle: null });
    expect((await client.meta.db.selectFrom('adminium_users').select('figmaTokenEncrypted').where('email', '=', 'owner@example.test').executeTakeFirstOrThrow()).figmaTokenEncrypted).toBeNull();
    const { readdirSync, existsSync } = await import('node:fs');
    const folder = join(client.root, '.adminium', 'designer', 'figma');
    expect(existsSync(folder) ? readdirSync(folder) : []).toEqual([]);
    // Importing now asks to connect first.
    const after = await client.call('POST', '/api/v1/designer/figma/import', { link: LINK });
    expect(after.body).toMatchObject({ error: { details: { reason: 'FIGMA', figma: { kind: 'not-connected' } } } });
  });

  it('honours the project’s own token for its owner under `adminium design`, from the process’s environment only', async () => {
    vi.stubEnv('ADMINIUM_FIGMA_TOKEN', TOKEN);
    const client = await server();
    // The owner `design` made is the owner here: a project with no local owner has none, so nobody gets it.
    expect((await client.call('GET', '/api/v1/designer/figma')).body).toMatchObject({ connected: false, source: null });
    const ownerId = (await client.meta.db.selectFrom('adminium_users').select('id').where('email', '=', 'owner@example.test').executeTakeFirstOrThrow()).id;
    const { settingsRepo } = await import('@adminium/meta');
    await settingsRepo(client.meta).set('designer.localOwnerId', ownerId, { updatedBy: null });
    expect((await client.call('GET', '/api/v1/designer/figma')).body).toMatchObject({ connected: true, source: 'environment', handle: null });
    expect((await client.call('POST', '/api/v1/designer/figma/import', { link: LINK })).status).toBe(200);
    expect(client.fake.seen.find((call) => call.url.includes('/nodes'))?.headers['x-figma-token']).toBe(TOKEN);
  });

  it('ignores the project’s own token on a server that is not `adminium design`, and says so', async () => {
    vi.stubEnv('ADMINIUM_FIGMA_TOKEN', TOKEN);
    const client = await server({ designer: false, environment: { ADMINIUM_DESIGNER: 'live' } });
    // On a live server the Designer is off until switched on; a person still sees their connection, and nothing stands in for it.
    expect((await client.call('GET', '/api/v1/designer/figma')).body).toMatchObject({ connected: false, source: null });
    const off = await client.call('PUT', '/api/v1/designer/figma', { token: TOKEN });
    expect(off.body).toMatchObject({ error: { details: { reason: 'DESIGNER_OFF' } } });
    expect((await client.call('PUT', '/api/v1/designer/live', { on: true, password: PASSWORD })).status).toBe(200);
    expect((await client.call('GET', '/api/v1/designer/state')).body['ignoredEnv']).toContain('ADMINIUM_FIGMA_TOKEN');
    // A person's own token is theirs on a live server too: no "set in Settings → AI" refusal.
    const saved = await client.call('PUT', '/api/v1/designer/figma', { token: TOKEN });
    expect(saved.body).toMatchObject({ connected: true, source: 'mine' });
  });
});

describe('importing a frame and sending it', { timeout: 120_000 }, () => {
  it('refuses a link that names no design frame, in the dialog’s words, before calling Figma', async () => {
    const client = await server();
    await client.call('PUT', '/api/v1/designer/figma', { token: TOKEN });
    const board = await client.call('POST', '/api/v1/designer/figma/import', { link: `https://www.figma.com/board/${KEY}/Plan?node-id=1-2` });
    expect(board.status).toBe(422);
    expect(board.body).toMatchObject({ error: { message: 'That is a FigJam board. Paste a link to a design frame.', details: { reason: 'FIGMA_LINK', link: 'figjam' } } });
    expect(client.fake.calls.nodes + client.fake.calls.meta).toBe(0);
  });

  it('keeps the frame on the server under an id, and stamps the two files when the message carries them', async () => {
    const client = await server();
    await client.call('PUT', '/api/v1/designer/figma', { token: TOKEN });
    const imported = await client.call('POST', '/api/v1/designer/figma/import', { link: LINK });
    expect(imported.status, JSON.stringify(imported.body)).toBe(200);
    expect(imported.body).toMatchObject({ outlineName: 'Checkout — Figma design.md', pictureName: 'Checkout.png', width: 1440, height: 1024, reads: 2 });
    const importId = imported.body['importId'] as string;
    expect(importId).toMatch(/^imp_[0-9a-f]{24}$/);
    // The same frame again: from the copy the server kept, no read Figma counts.
    expect((await client.call('POST', '/api/v1/designer/figma/import', { link: LINK })).body).toMatchObject({ reads: 0 });

    const made = await client.call('POST', '/api/v1/designer/sessions', { name: 'Shop', target: 'web', connectionId: 'env:ollama', model: 'fake' });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const session = made.body['session'] as { id: string };
    const upload = (part: string, id = importId, cookie?: string) => client.call('POST', `/api/v1/designer/sessions/${session.id}/attachments?filename=x&figma=${id}&figma_part=${part}`, undefined, cookie);
    const picture = await upload('picture');
    const outline = await upload('outline');
    expect(picture.status, JSON.stringify(picture.body)).toBe(201);
    expect(picture.body['attachment']).toEqual({ id: expect.stringMatching(/^att_/), label: 'Checkout.png', kind: 'image', mediaType: 'image/png', bytes: expect.any(Number) });
    expect(outline.body['attachment']).toMatchObject({ label: 'Checkout — Figma design.md', kind: 'doc' });
    // The stamp is the server's own, and never leaves it.
    expect(JSON.stringify(picture.body)).not.toContain(KEY);
    const kept = createAttachments(client.root).list(session.id);
    expect(kept.map((entry) => [entry.source, entry.figma?.fileKey, entry.figma?.nodeId, entry.figma?.version])).toEqual([
      ['figma', KEY, '1:2', '42'],
      ['figma', KEY, '1:2', '42'],
    ]);
    expect(kept[1]?.design).toBe(true);
    expect(kept[1]?.figma?.short).toContain('— Figma design');

    // An id that is not this person's, or names nothing, is the same 404.
    const ben = await client.other();
    expect((await upload('picture', importId, ben)).status).toBe(404);
    expect((await upload('picture', `imp_${'0'.repeat(24)}`)).status).toBe(404);
  });

  it('reads an import again from the kept copy once its bytes are no longer held, with no counted read', async () => {
    const client = await server();
    await client.call('PUT', '/api/v1/designer/figma', { token: TOKEN });
    vi.useFakeTimers({ now: Date.now(), toFake: ['Date'] });
    try {
      const importId = (await client.call('POST', '/api/v1/designer/figma/import', { link: LINK })).body['importId'] as string;
      const counted = client.fake.calls.nodes + client.fake.calls.images;
      vi.setSystemTime(Date.now() + 60 * 60 * 1000);
      const session = (await client.call('POST', '/api/v1/designer/sessions', { name: 'Shop', target: 'web', connectionId: 'env:ollama', model: 'fake' })).body['session'] as { id: string };
      const sent = await client.call('POST', `/api/v1/designer/sessions/${session.id}/attachments?filename=x&figma=${importId}&figma_part=outline`);
      expect(sent.status, JSON.stringify(sent.body)).toBe(201);
      expect(client.fake.calls.nodes + client.fake.calls.images).toBe(counted);
    } finally {
      vi.useRealTimers();
    }
  });

  it('says what Figma refused, for the dialog to say it', async () => {
    const client = await server();
    await client.call('PUT', '/api/v1/designer/figma', { token: TOKEN });
    client.fake.fail.nodes = { status: 429, headers: { 'retry-after': '86400', 'x-figma-rate-limit-type': 'low' } };
    const limited = await client.call('POST', '/api/v1/designer/figma/import', { link: LINK });
    expect(limited.status).toBe(422);
    expect(limited.body).toMatchObject({ error: { details: { reason: 'FIGMA', figma: { kind: 'limit', type: 'low', retryAfterSeconds: 86400 } } } });
    delete client.fake.fail.nodes;
    client.fake.access.set(KEY, new Set(['someone-else']));
    expect((await client.call('POST', '/api/v1/designer/figma/import', { link: LINK })).body).toMatchObject({ error: { details: { figma: { kind: 'no-access' } } } });
  });

  it('is off, with its reason, where network features are off', async () => {
    const client = await server({ environment: { ADMINIUM_NETWORK_FEATURES: 'off' } });
    expect((await client.call('GET', '/api/v1/designer/figma')).body).toMatchObject({ network: false });
    const refused = await client.call('PUT', '/api/v1/designer/figma', { token: TOKEN });
    expect(refused.body).toMatchObject({ error: { details: { reason: 'FIGMA', figma: { kind: 'network-off' } } } });
    expect(client.fake.seen).toHaveLength(0);
  });
});
