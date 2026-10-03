// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The owner `adminium design` made, given an address and a password on the
 * page (plan 65, R3), and whom the preview is seen as.
 *
 *  1. The owner the link signs in has no password: the state says so, and the
 *     route sets an address and a password once. A short password, a string
 *     that is no address and a second call are refused, changing nothing.
 *  2. Nobody else sets it: no session, and an account that is not that owner.
 *  3. It is not there at all on the preview's name, where a model's screens run.
 *  4. The same function serves `adminium owner set`.
 */
import { join } from 'node:path';

import { createLocalOwner, settingsRepo, usersRepo, type MetaDb } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { LocalOwnerError, appRoleNames, needsPassword, setLocalOwnerCredentials } from '../src/auth/local-owner.js';
import { verifyPassword } from '../src/auth/passwords.js';
import { composeServer, type ComposedServer } from '../src/compose.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import type { MetaStoreHandle } from '../src/meta/store.js';
import { buildProject } from '../src/project/build.js';
import { APP_VERSION } from '../src/version.js';
import { asProject } from './app-project-helpers.js';
import { makeEnv } from './helpers.js';
import { makeInstall, type Install } from './project-fixtures.js';

const PORT = 4798;
const DESIGNER = `127.0.0.1:${String(PORT)}`;
const PREVIEW = `localhost:${String(PORT)}`;
const TOKEN = 'b'.repeat(64);
const GOOD = { email: 'sam@example.test', password: 'a-long-enough-test-password-1!' };

let install: Install | null = null;
let composed: ComposedServer | null = null;
afterEach(async () => {
  await composed?.app.close();
  await install?.close();
  composed = null;
  install = null;
});

async function serve(): Promise<{ meta: MetaDb; ownerId: string; call: (method: 'GET' | 'POST', url: string, payload?: unknown, opts?: { cookie?: string; host?: string; origin?: string }) => Promise<{ status: number; body: Record<string, unknown> }>; cookie: string }> {
  install = await makeInstall();
  const root = asProject(install.dir);
  await buildProject({ root, configFile: join(root, 'adminium.config.ts') }, { version: APP_VERSION });
  const { meta } = install;
  const owner = await createLocalOwner(meta);
  const runService = createRunService({ meta });
  composed = await composeServer({
    env: makeEnv({ HOST: '127.0.0.1' }),
    metaStore: { meta, url: 'sqlite::memory:', engine: 'sqlite', source: 'embedded', close: async () => Promise.resolve() } satisfies MetaStoreHandle,
    manager: install.manager,
    runService,
    applyService: createApplyService({ meta, runService }),
    allowed: { templates: [], widgets: [], widgetContracts: {} },
    logger: false,
    telemetry: false,
    onMetaRelocated: () => undefined,
    project: { root, mode: 'dev', log: () => undefined, warn: () => undefined, databases: ['main'] },
    designer: { mode: 'local', token: TOKEN, port: PORT },
    designerBundler: () => true,
  });
  const { app } = composed;
  await app.ready();
  const origin = `http://${DESIGNER}`;
  const signIn = await app.inject({ method: 'POST', url: '/api/v1/auth/design-session', headers: { host: DESIGNER, origin }, payload: { designToken: TOKEN } });
  expect(signIn.statusCode, signIn.body).toBe(200);
  const cookie = String(signIn.headers['set-cookie']).split(';')[0] ?? '';
  return {
    meta,
    ownerId: owner.id,
    cookie,
    call: async (method, url, payload, opts = {}) => {
      const host = opts.host ?? DESIGNER;
      const res = await app.inject({
        method,
        url,
        headers: { host, ...(opts.origin === undefined ? {} : { origin: opts.origin }), ...((opts.cookie ?? cookie) === '' ? {} : { cookie: opts.cookie ?? cookie }) },
        ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
      });
      return { status: res.statusCode, body: (res.body === '' ? {} : (JSON.parse(res.body) as Record<string, unknown>)) };
    },
  };
}

describe('the local owner’s first password, from the dashboard', () => {
  it('is offered to the owner the link signed in, and set once', async () => {
    const h = await serve();
    expect((await h.call('GET', '/api/v1/designer/state')).body['ownerNeedsPassword']).toBe(true);

    // Refused, and nothing changed: a short password, something that is no address.
    const short = await h.call('POST', '/api/v1/designer/owner-password', { email: GOOD.email, password: 'short' });
    expect(short.status).toBe(422);
    expect(short.body).toMatchObject({ error: { details: { reason: 'PASSWORD' } } });
    const noAddress = await h.call('POST', '/api/v1/designer/owner-password', { email: 'not an address', password: GOOD.password });
    expect(noAddress.status).toBe(422);
    expect(noAddress.body).toMatchObject({ error: { details: { reason: 'EMAIL' } } });
    expect((await usersRepo(h.meta).findById(h.ownerId))?.passwordHash).toBeNull();

    const done = await h.call('POST', '/api/v1/designer/owner-password', GOOD);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body).toEqual({ email: GOOD.email });
    const owner = await usersRepo(h.meta).findById(h.ownerId);
    expect(owner?.email).toBe(GOOD.email);
    expect(await verifyPassword(owner?.passwordHash ?? '', GOOD.password)).toBe(true);
    // The password itself is nowhere but in its hash.
    expect(JSON.stringify(done.body)).not.toContain(GOOD.password);
    // As `adminium owner set`: the project is no longer opened by the link.
    expect(await settingsRepo(h.meta).get('designer.localOwnerId')).toBeNull();

    // The session goes on; the banner does not come back; and it cannot be used to change a password that exists.
    expect((await h.call('GET', '/api/v1/designer/state')).body['ownerNeedsPassword']).toBe(false);
    const again = await h.call('POST', '/api/v1/designer/owner-password', { email: 'other@example.test', password: 'another-long-password-2!' });
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ error: { details: { reason: 'NOT_THE_LOCAL_OWNER' } } });
    expect((await usersRepo(h.meta).findById(h.ownerId))?.email).toBe(GOOD.email);
  });

  it('is nobody else’s to call, and is not there on the preview’s name', async () => {
    const h = await serve();
    // No session.
    expect((await h.call('POST', '/api/v1/designer/owner-password', GOOD, { cookie: '' })).status).toBe(401);
    // A page in a browser, the owner's cookie riding along, without the token every dashboard write carries: another site's, or a model's screen on the preview's name.
    for (const origin of ['http://evil.example', `http://${PREVIEW}`, `http://${DESIGNER}`]) {
      expect((await h.call('POST', '/api/v1/designer/owner-password', GOOD, { origin })).status, origin).toBe(403);
    }
    // The preview's name, where a model's screens run: the Designer's routes do not exist there.
    const fromPreview = await h.call('POST', '/api/v1/designer/owner-password', GOOD, { host: PREVIEW });
    expect([403, 404]).toContain(fromPreview.status);
    expect((await usersRepo(h.meta).findById(h.ownerId))?.passwordHash).toBeNull();
  });
});

describe('the function behind it and behind `adminium owner set`', () => {
  it('refuses with a reason, and changes nothing, unless it is the owner `design` made with no password', async () => {
    install = await makeInstall();
    const { meta } = install;
    await expect(setLocalOwnerCredentials(meta, GOOD)).rejects.toMatchObject({ reason: 'not-local' });
    const owner = await createLocalOwner(meta);
    expect(await needsPassword(meta, owner.id)).toBe(true);
    expect(await needsPassword(meta, 'someone-else')).toBe(false);
    expect(await needsPassword(meta, null)).toBe(false);
    await expect(setLocalOwnerCredentials(meta, { email: 'x', password: GOOD.password })).rejects.toBeInstanceOf(LocalOwnerError);
    await expect(setLocalOwnerCredentials(meta, { email: GOOD.email, password: 'x' })).rejects.toMatchObject({ reason: 'password-short' });
    expect((await setLocalOwnerCredentials(meta, GOOD)).email).toBe(GOOD.email);
    expect(await needsPassword(meta, owner.id)).toBe(false);
    await expect(setLocalOwnerCredentials(meta, GOOD)).rejects.toMatchObject({ reason: 'not-local' });
    // No app, no roles: the preview is seen as a person with none.
    expect(await appRoleNames(meta, 'nope')).toEqual([]);
  });
});
