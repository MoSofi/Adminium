// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Designer's preview on a server people reach (`designer/live-preview.ts`).
 *
 * Such a server has one name, so it had no preview: an app's screens framed
 * there would run beside the signed-in person's session. With
 * `ADMINIUM_PREVIEW_ORIGIN` it has a second one. Each test here is a door
 * someone would try: the person's own session presented on the preview's
 * address, the preview user's presented on the instance's, the preview's code
 * calling the Designer or a sign-in route, a ticket spent on the wrong name,
 * another site framing the preview.
 */
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { composeServer, type ComposedServer } from '../src/compose.js';
import { envSchema } from '../src/config/env.js';
import { livePreviewOf, sessionBelongsHere } from '../src/designer/live-preview.js';
import { PREVIEW_USER_EMAIL } from '../src/designer/preview.js';
import { createSessionStore } from '../src/designer/session-store.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import type { MetaStoreHandle } from '../src/meta/store.js';
import { buildProject } from '../src/project/build.js';
import { operatorHostsOf } from '../src/trial/operator-hosts.js';
import { APP_VERSION } from '../src/version.js';
import { asProject } from './app-project-helpers.js';
import { makeEnv, TEST_SECRET } from './helpers.js';
import { makeInstall, type Install } from './project-fixtures.js';

const OWN = 'shop.example.test';
const DOMAIN = 'www.shop-own.test';
const PREVIEW = 'shop.preview-example.test';
const PASSWORD = 'a-long-enough-test-password-1!';
const ADDRESSES = { ADMINIUM_PUBLIC_ORIGIN: `https://${OWN}`, ADMINIUM_OPERATOR_DOMAINS: DOMAIN };

let composed: ComposedServer | undefined;
let install: Install | null = null;
afterEach(async () => {
  await composed?.app.close();
  composed = undefined;
  await install?.close();
  install = null;
});

interface Client {
  app: ComposedServer['app'];
  /** The owner's session cookie, set on the instance's own address. */
  owner: string;
  get: (host: string, url: string, cookie?: string) => Promise<{ status: number; body: Record<string, unknown>; headers: Record<string, unknown> }>;
}

/** A server people reach, with the live Designer allowed and switched on. */
async function server(environment: Record<string, string>): Promise<Client> {
  install = await makeInstall();
  const root = asProject(install.dir);
  await buildProject({ root, configFile: join(root, 'adminium.config.ts') }, { version: APP_VERSION });
  const { meta } = install;
  const metaStore: MetaStoreHandle = { meta, url: 'sqlite::memory:', engine: 'sqlite', source: 'embedded', close: async () => Promise.resolve() };
  const runService = createRunService({ meta });
  composed = await composeServer({
    env: makeEnv({ HOST: '127.0.0.1', ADMINIUM_DESIGNER: 'live', ...ADDRESSES, ...environment }),
    metaStore,
    manager: install.manager,
    runService,
    applyService: createApplyService({ meta, runService }),
    allowed: { templates: [], widgets: [], widgetContracts: {} },
    logger: false,
    telemetry: false,
    onMetaRelocated: () => undefined,
    project: { root, mode: 'server', log: () => undefined, warn: () => undefined, databases: ['main'] },
    designerBundler: () => true,
  });
  const { app } = composed;
  await app.ready();
  const setup = await app.inject({ method: 'POST', url: '/api/v1/setup/super-admin', headers: { host: OWN }, payload: { email: 'owner@example.test', password: PASSWORD, name: 'Owner' } });
  expect(setup.statusCode, setup.body).toBe(201);
  const owner = String(setup.headers['set-cookie']).split(';')[0] ?? '';
  const on = await app.inject({ method: 'PUT', url: '/api/v1/designer/live', headers: { host: OWN, cookie: owner }, payload: { on: true, password: PASSWORD } });
  expect(on.statusCode, on.body).toBe(200);
  return {
    app,
    owner,
    get: async (host, url, cookie) => {
      const res = await app.inject({ method: 'GET', url, headers: { host, ...(cookie === undefined ? {} : { cookie }) } });
      let body: Record<string, unknown> = {};
      try {
        body = res.json();
      } catch {
        // Not JSON: a page, or a plain line.
      }
      return { status: res.statusCode, body, headers: res.headers };
    },
  };
}

/** A ticket for the staff side of `repairs`, asked on the instance's own address as the owner. */
async function ticket(client: Client): Promise<{ status: number; body: Record<string, unknown> }> {
  const session = createSessionStore(install!.dir).create({ appKey: 'repairs', title: 'Repairs', target: 'auto', connectionId: 'env:ollama', model: 'm', createdApp: false });
  const res = await client.app.inject({ method: 'POST', url: `/api/v1/designer/sessions/${session.id}/preview-ticket`, headers: { host: OWN, cookie: client.owner }, payload: { to: '/apps/repairs/staff/' } });
  return { status: res.statusCode, body: res.json() };
}

describe('ADMINIUM_PREVIEW_ORIGIN', () => {
  const parse = (over: Record<string, string>) => envSchema.safeParse({ ADMINIUM_SECRET: TEST_SECRET, ...over });
  const said = (over: Record<string, string>): string => {
    const result = parse(over);
    return result.success ? '' : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n');
  };

  it('is one origin, beside the instance’s own address', () => {
    expect(parse({ ...ADDRESSES, ADMINIUM_PREVIEW_ORIGIN: `https://${PREVIEW}` }).success).toBe(true);
    expect(said({ ...ADDRESSES, ADMINIUM_PREVIEW_ORIGIN: `https://${PREVIEW}/enter` })).toContain('ADMINIUM_PREVIEW_ORIGIN');
    expect(said({ ...ADDRESSES, ADMINIUM_PREVIEW_ORIGIN: PREVIEW })).toContain('ADMINIUM_PREVIEW_ORIGIN');
  });

  it('needs the instance’s own address: only that may frame the preview', () => {
    expect(said({ ADMINIUM_PREVIEW_ORIGIN: `https://${PREVIEW}` })).toMatch(/ADMINIUM_PREVIEW_ORIGIN: is set, but ADMINIUM_PUBLIC_ORIGIN is not/);
  });

  it('is refused on an address the instance already answers on', () => {
    expect(said({ ...ADDRESSES, ADMINIUM_PREVIEW_ORIGIN: `https://${OWN}` })).toMatch(/an address this instance already answers on/);
    expect(said({ ...ADDRESSES, ADMINIUM_PREVIEW_ORIGIN: `https://${DOMAIN}` })).toMatch(/an address this instance already answers on/);
  });

  it('is framed by the instance’s own addresses, and is none of the operator’s domains', () => {
    const env = makeEnv({ ...ADDRESSES, ADMINIUM_PREVIEW_ORIGIN: `https://${PREVIEW}` });
    const hosts = operatorHostsOf(env);
    expect(hosts?.hosts.has(PREVIEW)).toBe(true);
    // Answered on, and nothing more: links never point there, and no side can be mapped to it.
    expect(hosts?.domains).toEqual([DOMAIN]);
    expect(hosts?.origin).toBe(`https://${DOMAIN}`);
    expect(livePreviewOf(env, hosts)).toEqual({ origin: `https://${PREVIEW}`, host: PREVIEW, framers: [`https://${OWN}`, `https://${DOMAIN}`] });
    expect(livePreviewOf(makeEnv(ADDRESSES), operatorHostsOf(makeEnv(ADDRESSES)))).toBeNull();
  });

  it('reads a session only on the address it belongs to', () => {
    const env = makeEnv({ ...ADDRESSES, ADMINIUM_PREVIEW_ORIGIN: `https://${PREVIEW}` });
    const preview = livePreviewOf(env, operatorHostsOf(env));
    const person = { email: 'owner@example.test' };
    const previewUser = { email: PREVIEW_USER_EMAIL };
    expect(sessionBelongsHere(preview, { host: OWN }, person)).toBe(true);
    expect(sessionBelongsHere(preview, { host: `${PREVIEW}:443` }, person)).toBe(false);
    expect(sessionBelongsHere(preview, { host: PREVIEW.toUpperCase() }, previewUser)).toBe(true);
    expect(sessionBelongsHere(preview, { host: OWN }, previewUser)).toBe(false);
    expect(sessionBelongsHere(preview, { host: DOMAIN }, previewUser)).toBe(false);
    // With no preview address nothing changes: every session is read, as it always was.
    expect(sessionBelongsHere(null, { host: OWN }, previewUser)).toBe(true);
  });
});

describe('a server people reach, with a preview address', { timeout: 120_000 }, () => {
  it('answers on the preview’s address, says it has a preview, and still refuses any other name', async () => {
    const client = await server({ ADMINIUM_PREVIEW_ORIGIN: `https://${PREVIEW}` });
    expect((await client.get(PREVIEW, '/api/v1/system/info')).status).toBe(200);
    expect((await client.get('evil.example', '/api/v1/system/info')).status).toBe(421);
    expect((await client.get(OWN, '/api/v1/system/info')).body).toMatchObject({ designer: { mode: 'live', preview: true } });
  });

  it('keeps the preview’s address away from everything that acts for the person', async () => {
    const client = await server({ ADMINIUM_PREVIEW_ORIGIN: `https://${PREVIEW}` });
    for (const url of ['/api/v1/designer/state', '/api/v1/llm/connections', '/api/v1/setup/state', '/api/v1/users', '/api/v1/settings', '/api/v1/api-keys']) {
      const res = await client.get(PREVIEW, url, client.owner);
      expect(res.status, url).toBe(403);
      expect(res.body, url).toMatchObject({ error: { details: { reason: 'PREVIEW_HOST' } } });
    }
    // Nor any door that would leave a session on that address.
    for (const url of ['/api/v1/auth/login', '/api/v1/auth/2fa/verify', '/api/v1/auth/password/reset', '/api/v1/setup/super-admin']) {
      const res = await client.app.inject({ method: 'POST', url, headers: { host: PREVIEW }, payload: {} });
      expect(res.statusCode, url).toBe(403);
      expect(res.json(), url).toMatchObject({ error: { details: { reason: 'PREVIEW_HOST' } } });
    }
    // On the instance's own address they are what they always were.
    expect((await client.get(OWN, '/api/v1/designer/state', client.owner)).status).toBe(200);
  });

  it('does not read the person’s own session on the preview’s address', async () => {
    const client = await server({ ADMINIUM_PREVIEW_ORIGIN: `https://${PREVIEW}` });
    expect((await client.get(OWN, '/api/v1/auth/session', client.owner)).status).toBe(200);
    expect((await client.get(DOMAIN, '/api/v1/auth/session', client.owner)).status).toBe(200);
    // The cookie is the owner's and still good: on the preview's address it signs nobody in.
    expect((await client.get(PREVIEW, '/api/v1/auth/session', client.owner)).status).toBe(401);
  });

  it('issues a ticket on the instance’s address and spends it once on the preview’s, for the preview user alone', async () => {
    const client = await server({ ADMINIUM_PREVIEW_ORIGIN: `https://${PREVIEW}` });
    const asked = await ticket(client);
    expect(asked.status, JSON.stringify(asked.body)).toBe(200);
    const { url, origin } = asked.body as { url: string; origin: string };
    expect(origin).toBe(`https://${PREVIEW}`);
    const path = url.slice(origin.length);

    // On the instance's own address the enter address does not exist.
    expect((await client.get(OWN, path)).status).toBe(404);
    const entered = await client.app.inject({ method: 'GET', url: path, headers: { host: PREVIEW } });
    expect(entered.statusCode, entered.body).toBe(303);
    expect(entered.headers.location).toBe('/apps/repairs/staff/');
    const set = String(entered.headers['set-cookie']);
    // Framed by the instance's address, another site: only a SameSite=None (so Secure) cookie is sent inside the frame.
    for (const flag of [/; HttpOnly/, /; Secure/, /; SameSite=None/, /; Partitioned/]) expect(set).toMatch(flag);
    // Once.
    expect((await client.get(PREVIEW, path)).status).toBe(401);

    // The session it left is the preview user's: read on the preview's address, and nowhere else.
    const cookie = set.split(';')[0] ?? '';
    const there = await client.get(PREVIEW, '/api/v1/auth/session', cookie);
    expect(there.status, JSON.stringify(there.body)).toBe(200);
    expect(JSON.stringify(there.body)).toContain(PREVIEW_USER_EMAIL);
    expect((await client.get(OWN, '/api/v1/auth/session', cookie)).status).toBe(401);
    expect((await client.get(DOMAIN, '/api/v1/auth/session', cookie)).status).toBe(401);
    // And with it the Designer stays out of reach there.
    expect((await client.get(PREVIEW, '/api/v1/designer/state', cookie)).status).toBe(403);
  });

  it('lets the instance’s own addresses frame the preview, and nothing else', async () => {
    const client = await server({ ADMINIUM_PREVIEW_ORIGIN: `https://${PREVIEW}` });
    const own = await client.get(OWN, '/api/v1/system/info');
    expect(String(own.headers['content-security-policy'])).toContain(`frame-src 'self' https://${PREVIEW}`);
    expect(own.headers['x-frame-options']).toBe('SAMEORIGIN');
    const preview = await client.get(PREVIEW, '/api/v1/system/info');
    expect(String(preview.headers['content-security-policy'])).toContain(`frame-ancestors 'self' https://${OWN} https://${DOMAIN}`);
    expect(String(preview.headers['content-security-policy'])).not.toContain('frame-src');
    expect(preview.headers['x-frame-options']).toBeUndefined();
  });
});

describe('a server people reach, with no preview address', { timeout: 120_000 }, () => {
  it('has no preview, as before: no ticket, no second name, nothing framed', async () => {
    const client = await server({});
    expect((await client.get(OWN, '/api/v1/system/info')).body).toMatchObject({ designer: { mode: 'live', preview: false } });
    expect((await client.get(PREVIEW, '/api/v1/system/info')).status).toBe(421);
    const asked = await ticket(client);
    expect(asked.status).toBe(404);
    expect(asked.body).toMatchObject({ error: { details: { reason: 'NO_PREVIEW' } } });
    const own = await client.get(OWN, '/api/v1/system/info');
    expect(String(own.headers['content-security-policy'])).not.toContain('frame-src');
    expect(own.headers['x-frame-options']).toBe('SAMEORIGIN');
  });
});
