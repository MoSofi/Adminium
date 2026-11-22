// SPDX-License-Identifier: AGPL-3.0-only
/**
 * CONNECTED ACCOUNTS, on the whole server and on every engine: a real app
 * installed through the installer, real roles signed in as themselves, and a
 * fake provider behind `fetch`.
 *
 * The cases are the critique's: an authorize address opened in someone else's
 * browser, a wrong account on a reconnect, a short grant, a mail scanner, a
 * studio's expired secret read as six people's problem, a token in a log.
 */
import {
  auditRepo,
  connectedAccountsRepo,
  manifestsRepo,
  notificationsRepo,
  overridesRepo,
  permissionsRepo,
  rolesRepo,
  settingsRepo,
  usersRepo,
  type MetaTableDump,
  type User,
} from '@adminium/meta';
import { validateManifest } from '@adminium/manifest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { CALENDAR_PROVIDER_CONTRACT, CALENDAR_PROVIDER_FACTORY, CALENDAR_PROVIDER_VERSION } from '@adminium/add-on-contracts';

import { addOnCredentialCryptoFromSecret } from '../src/add-ons/credential-crypto.js';
import { createAddOnHttpClient } from '../src/add-ons/egress.js';
import type { AddOnRuntimeState } from '../src/add-ons/runtime.js';
import { calendarProviderFor } from '../src/calendar-sync/provider.js';
import { addOnVisibleCredential } from '../src/add-ons/oauth.js';
import { sanitizeDump } from '../src/archive/policy.js';
import { encryptSecret } from '../src/config/secrets.js';
import { emailSecretKey } from '../src/email/config.js';
import { loadSnapshotView } from '../src/data-io/snapshot-view.js';
import { runConnectedAccountsTick } from '../src/connected-accounts/jobs.js';
import { AccountTokenError, createConnectedAccounts, type ConnectedAccounts } from '../src/connected-accounts/service.js';
import { connectReachOf, endpointsFor, identityOf, missingScopes, type AccountSpec } from '../src/connected-accounts/spec.js';
import { addOnEventKind, registerAddOnEventHandlers } from '../src/jobs/add-on-events.js';
import { createJobRegistry } from '../src/jobs/registry.js';
import { reachability } from '../src/payments/reachability.js';
import { scrubSecretFields } from '../src/log-redaction.js';
import { scrubUrlForLog } from '../src/log-scrub.js';
import { ADMIN_PASSWORD, adminPasswordHash, sessionCookie } from './auth-helpers.js';
import { TEST_SECRET } from './helpers.js';
import { LEGS, installInvoicing, invoicingManifest, type InvoicingHarness } from './invoicing-install.helpers.js';
import { servePublic } from './public-lane.helpers.js';

// The words these manifests use are read from the release after the one in package.json.
vi.mock('../src/version.js', async (original) => ({ ...(await original<typeof import('../src/version.js')>()), APP_VERSION: '0.4.0' }));

const ORIGIN = 'https://studio.example.com';
const KEY = 'calendar-test';
const CALLBACK = `/api/v1/add-ons/${KEY}/oauth/callback`;

const addOnManifest = () => ({
  kind: 'add-on',
  manifestVersion: 1,
  key: KEY,
  name: 'Test Calendar',
  version: '1.0.0',
  publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
  license: 'AGPL-3.0-only',
  description: { key: 'd', fallback: 'A calendar.' },
  categories: ['data'],
  compatibility: { minAdminiumVersion: '0.3.71', requires: [] },
  capabilities: ['oauth-connect', 'outbound-http'],
  addOn: {
    attaches: [{ app: 'studio', range: '^0.2.0' }],
    provides: [],
    consumes: [],
    slots: [],
    events: [],
    connect: {
      kind: 'oauth2',
      authorizeUrl: 'https://auth.cal.example/{tenant}/authorize',
      tokenUrl: 'https://auth.cal.example/{tenant}/token',
      revokeUrl: 'https://auth.cal.example/revoke',
      scopes: ['openid', 'email', 'cal.read', 'cal.write'],
      requiredScopes: ['cal.read', 'cal.write'],
      accounts: 'row',
      authorizeParams: { access_type: 'offline', prompt: 'consent' },
      identity: { subject: 'sub', address: ['email'] },
      tenant: { default: 'common' },
    },
    scopes: [],
    network: { allow: ['auth.cal.example', 'api.cal.example'] },
  },
});

const id = { ref: 'id', type: 'int', role: 'pk' };

const appManifest = (): Record<string, unknown> => ({
  ...invoicingManifest([
    {
      ref: 'team',
      belongs: [{ column: 'user_id' }],
      indexes: [['user_id']],
      connectedAccounts: { from: [KEY], address: 'email', name: 'name', active: 'active' },
      columns: [
        id,
        { ref: 'name', type: 'text', maxLength: 80 },
        { ref: 'email', type: 'text', maxLength: 254, nullable: true },
        { ref: 'active', type: 'bool', default: true },
        { ref: 'user_id', type: 'text', maxLength: 36, nullable: true, rules: { staff: true } },
      ],
    },
  ]),
  compatibility: { minAdminiumVersion: '0.3.71' },
  addOns: { suggests: [{ key: KEY, range: '>=1.0.0', reason: { 'en-US': 'Calendars.' } }] },
  pages: [{ ref: 'studio-team', template: 'page-crud', title: { key: 't', fallback: 'Team' }, nav: { group: 'library', icon: 'list', order: 1 }, bindings: { rows: 'team' } }],
  roles: [
    { key: 'owner', name: 'Owner', permissions: ['app:@:staff', 'table:@team:read', 'table:@team:read_pii', 'table:@team:update', 'accounts:@:connect', 'accounts:@:send-link', 'accounts:@:disconnect'] },
    { key: 'desk', name: 'Desk', permissions: ['app:@:staff', 'table:@team:read', 'accounts:@:send-link'] },
    {
      key: 'specialist',
      name: 'Specialist',
      permissions: ['app:@:staff', 'table:@team:read', 'table:@team:update', 'accounts:@:connect', 'accounts:@:disconnect'],
      limits: { team: { rows: { read: { reach: 'own' }, update: { reach: 'own' } } } },
    },
  ],
});

/** A signed-looking ID token: only its claims are read. */
function idToken(claims: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'none' })}.${part(claims)}.sig`;
}

interface Grant {
  subject: string;
  email?: string | null;
  scope?: string;
  noRefresh?: boolean;
  refreshExpiresIn?: number;
}

/** The provider, behind `fetch`. */
function fakeProvider() {
  const codes = new Map<string, Grant>();
  const calls: { url: string; form: URLSearchParams; headers: Headers }[] = [];
  const state = { tokenStatus: 200, tokenError: null as string | null, tokenCodes: null as number[] | null, apiStatus: [] as number[], counter: 0, delayMs: 0 };
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const form = new URLSearchParams(typeof init?.body === 'string' ? init.body : '');
    calls.push({ url, form, headers: new Headers(init?.headers) });
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (url.endsWith('/revoke')) return json({});
    if (url.startsWith('https://api.cal.example/')) return json({ ok: true }, state.apiStatus.shift() ?? 200);
    if (state.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, state.delayMs));
    if (state.tokenError !== null) return json({ error: state.tokenError, error_description: `leaked ${form.get('client_secret') ?? ''}`, ...(state.tokenCodes === null ? {} : { error_codes: state.tokenCodes }) }, state.tokenStatus);
    if (state.tokenStatus !== 200) return json({}, state.tokenStatus);
    state.counter += 1;
    if (form.get('grant_type') === 'refresh_token') {
      return json({ access_token: `at-refreshed-${String(state.counter)}`, expires_in: 3600, scope: 'openid email cal.read cal.write' });
    }
    if (form.get('grant_type') === 'client_credentials') return json({ access_token: 'at-app', expires_in: 3600 });
    const grant = codes.get(form.get('code') ?? '');
    if (grant === undefined) return json({ error: 'invalid_grant' }, 400);
    return json({
      access_token: `at-${grant.subject}`,
      ...(grant.noRefresh === true ? {} : { refresh_token: `rt-${grant.subject}` }),
      expires_in: 3600,
      scope: grant.scope ?? 'openid email cal.read cal.write',
      id_token: idToken({ sub: grant.subject, aud: 'client-1', ...(grant.email === null ? {} : { email: grant.email ?? `${grant.subject}@gmail.example` }) }),
      ...(grant.refreshExpiresIn === undefined ? {} : { refresh_token_expires_in: grant.refreshExpiresIn }),
    });
  }) as typeof globalThis.fetch;
  return { codes, calls, state, fetchImpl };
}

const tokenCalls = (provider: ReturnType<typeof fakeProvider>) => provider.calls.filter((call) => call.url.includes('/token'));

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`connected accounts on ${dialect}`, () => {
    let h: InvoicingHarness;
    let app: Awaited<ReturnType<typeof servePublic>>['composed']['app'];
    let table: string;
    let real: string;
    let installId: string;
    const people: Record<string, User> = {};
    const cookies: Record<string, string> = {};
    const rowOf: Record<string, string> = {};
    const provider = fakeProvider();
    let codeNumber = 0;

    const staff = (who: string, method: 'GET' | 'POST', url: string, payload?: Record<string, unknown>) =>
      app.inject({ method, url: `/api/v1${url}`, headers: { cookie: cookies[who]! }, ...(payload === undefined ? {} : { payload }) });
    const ref = (name: string) => ({ connection: h.connectionId, table, row: rowOf[name]! });
    // Each call from its own address: the door's per-address cap is not what these tests are about.
    let doorCalls = 0;
    const door = (path: string, payload: Record<string, unknown>, cookie?: string) => {
      doorCalls += 1;
      return app.inject({ method: 'POST', url: `/x/connect/api/${path}`, payload, remoteAddress: `10.8.${String(Math.floor(doorCalls / 250))}.${String((doorCalls % 250) + 1)}`, headers: cookie === undefined ? {} : { cookie } });
    };
    const tokenOf = (url: string) => url.slice(url.indexOf('#') + 1);

    /** A link for a person's row, minted as the owner copies one. */
    async function linkFor(name: string): Promise<string> {
      const reply = await staff('owner', 'POST', '/connected-accounts/link', { ...ref(name), copy: true });
      expect(reply.statusCode, reply.body).toBe(200);
      return tokenOf((reply.json() as { url: string }).url);
    }

    /** Presses "Connect": the authorize address and this browser's cookie. */
    async function start(token: string) {
      const reply = await door('start', { token, provider: KEY });
      expect(reply.statusCode, reply.body).toBe(200);
      const authorize = new URL((reply.json() as { authorizeUrl: string }).authorizeUrl);
      const raw = reply.headers['set-cookie'] as string;
      return { token, authorize, state: authorize.searchParams.get('state')!, cookie: raw.split(';')[0]!, raw };
    }

    /** The provider says yes, and the door page finishes it. */
    async function finish(started: { token: string; state: string; cookie: string }, grant: Grant) {
      codeNumber += 1;
      const code = `code-${String(codeNumber)}`;
      provider.codes.set(code, grant);
      const reply = await door('complete', { token: started.token, state: started.state, code }, started.cookie);
      expect(reply.statusCode, reply.body).toBe(200);
      return reply.json() as { outcome: string; address?: string | null; addressDiffers?: boolean; testing?: boolean; missing?: string[] };
    }

    const connectAs = async (name: string, grant: Grant) => finish(await start(await linkFor(name)), grant);
    const repo = () => connectedAccountsRepo(h.meta, addOnCredentialCryptoFromSecret(TEST_SECRET));
    const target = (name: string) => ({ connectionId: h.connectionId, tableName: table, rowKey: rowOf[name]! });
    const accountOf = async (name: string) => (await repo().forTarget(target(name)))[0] ?? null;

    /** The same engine over the same store, driven directly for what a job or a provider call would do. */
    function engine(sleep?: (ms: number) => Promise<void>): ConnectedAccounts {
      return createConnectedAccounts({
        meta: h.meta,
        crypto: addOnCredentialCryptoFromSecret(TEST_SECRET),
        secret: TEST_SECRET,
        httpFor: (manifest) => createAddOnHttpClient({ key: manifest.key, allow: manifest.addOn.network?.allow ?? [], hasOutboundHttp: true, fetchImpl: provider.fetchImpl }),
        rows: {
          read: async (_connection, _table, rowKey) => {
            const rows = await h.rows(`SELECT * FROM ${real} WHERE id = ${String(Number(rowKey))}`);
            return rows[0];
          },
          tableId: (_connection, name) => Promise.resolve(name === h.real('team') ? table : null),
          list: () => Promise.resolve([]),
        },
        publicOrigin: () => Promise.resolve(ORIGIN),
        reach: () => Promise.resolve(reachability({ networkFeatures: true, desktop: false, trustProxy: false, forwarded: false, publicOrigin: ORIGIN })),
        ...(sleep === undefined ? {} : { sleep }),
      });
    }

    beforeAll(async () => {
      vi.stubGlobal('fetch', provider.fetchImpl);
      h = await installInvoicing(dialect, appManifest());
      const manifests = manifestsRepo(h.meta, addOnCredentialCryptoFromSecret(TEST_SECRET));
      const installed = await manifests.install({ manifestKey: KEY, version: '1.0.0', kind: 'add-on', source: 'marketplace', document: addOnManifest(), scopeKey: h.connectionId, connectionId: h.connectionId });
      installId = installed.row.id;
      await manifests.attach(installId, 'studio');
      await settingsRepo(h.meta).set('system.publicOrigin', ORIGIN);
      app = (await servePublic(h, null, { ADMINIUM_NETWORK_FEATURES: 'true', ADMINIUM_PUBLIC_ORIGIN: '' })).composed.app;

      const users = usersRepo(h.meta);
      const roles = rolesRepo(h.meta);
      const hash = await adminPasswordHash();
      const make = async (name: string, role: string) => {
        const user = await users.create({ email: `${name}-${dialect}@studio.dev`, name, passwordHash: hash, status: 'active' });
        people[name] = user;
        await roles.assignToUser(user.id, (await roles.findBySlug(role))!.id);
      };
      await make('admin', 'super-admin');
      await make('owner', 'studio-owner');
      await make('desk', 'studio-desk');
      await make('elin', 'studio-specialist');
      for (const [i, who] of ['admin', 'owner', 'desk', 'elin'].entries()) {
        const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: people[who]!.email, password: ADMIN_PASSWORD }, remoteAddress: `10.0.0.${String(i + 1)}` });
        expect(login.statusCode, login.body).toBe(200);
        cookies[who] = sessionCookie(login.headers['set-cookie']);
      }
      real = h.real('team');
      table = (await loadSnapshotView(h.meta, h.connectionId)).model.tables.find((one) => one.name === real)!.id;
      const insert = async (name: string, user: string | null) => {
        await h.rows(`INSERT INTO ${real} (name, email, active, user_id) VALUES ('${name}', '${name}@studio.dev', ${dialect === 'postgres' ? 'TRUE' : '1'}, ${user === null ? 'NULL' : `'${user}'`})`);
        const rows = await h.rows(`SELECT id FROM ${real} WHERE name = '${name}'`);
        rowOf[name] = String(rows[0]!['id']);
      };
      await insert('elin', people['elin']!.id);
      for (const name of ['noor', 'rafa', 'ivy', 'ivy2', 'june', 'june2', 'wes', 'lou', 'kit', 'ana', 'marco', 'gone', 'off']) await insert(name, null);
      const put = await app.inject({ method: 'PUT', url: `/api/v1/add-ons/${KEY}/connect/app`, headers: { cookie: cookies['admin']! }, payload: { clientId: 'client-1', clientSecret: 'client-secret-1' } });
      expect(put.statusCode, put.body).toBe(200);
    }, 240_000);

    afterAll(async () => {
      vi.unstubAllGlobals();
      await h?.close();
    });

    beforeEach(() => {
      provider.state.tokenStatus = 200;
      provider.state.tokenError = null;
      provider.state.tokenCodes = null;
      provider.state.apiStatus = [];
      provider.state.delayMs = 0;
    });

    // ─── The registration and the fixed address ────────────────────────────

    it('keeps the secret in, says the fixed address, and refuses the old one-credential routes', async () => {
      const status = await staff('admin', 'GET', `/add-ons/${KEY}/connect/accounts`);
      expect(status.statusCode, status.body).toBe(200);
      expect(status.body).not.toContain('client-secret-1');
      expect(status.json()).toMatchObject({ per: 'row', registered: true, clientId: 'client-1', redirectUri: `${ORIGIN}${CALLBACK}`, reach: 'push', install: 'ready' });
      const old = await staff('admin', 'POST', `/add-ons/${KEY}/connect/oauth/start`, { clientId: 'x', clientSecret: 'y', redirectUri: 'https://evil.example/cb' });
      expect(old.statusCode).toBe(422);
    });

    it('lets only whoever manages add-ons touch the registration', async () => {
      for (const who of ['owner', 'desk', 'elin']) {
        expect((await staff(who, 'GET', `/add-ons/${KEY}/connect/accounts`)).statusCode).toBe(403);
      }
    });

    it('asks the provider for what it needs to last, with PKCE, the tenant and the person', async () => {
      const { authorize, raw } = await start(await linkFor('marco'));
      expect(authorize.origin + authorize.pathname).toBe('https://auth.cal.example/common/authorize');
      const q = authorize.searchParams;
      expect(q.get('access_type')).toBe('offline');
      expect(q.get('prompt')).toBe('consent');
      expect(q.get('redirect_uri')).toBe(`${ORIGIN}${CALLBACK}`);
      expect(q.get('code_challenge_method')).toBe('S256');
      expect(q.get('login_hint')).toBe('marco@studio.dev');
      expect(q.get('scope')).toBe('openid email cal.read cal.write');
      expect(raw).toMatch(/^__Host-adminium-connect=[^;]+; Path=\/; Max-Age=600; HttpOnly; Secure; SameSite=Lax$/);
    });

    it('answers the callback with no work: 303, the code in the fragment, nothing stored', async () => {
      const reply = await app.inject({ method: 'GET', url: `${CALLBACK}?code=abc&state=def&scope=x` });
      expect(reply.statusCode).toBe(303);
      expect(reply.headers['location']).toBe('/x/connect/back#state=def&code=abc');
      expect(reply.headers['cache-control']).toBe('no-store');
      expect(reply.headers['referrer-policy']).toBe('no-referrer');
    });

    // ─── The flow ──────────────────────────────────────────────────────────

    it('connects a person, says as whom, and spends the link', async () => {
      const token = await linkFor('noor');
      const opened = await door('open', { token });
      expect(opened.json()).toMatchObject({ person: 'noor', purpose: 'connect', providers: [{ key: KEY, name: 'Test Calendar' }] });
      const done = await finish(await start(token), { subject: 'sub-noor', email: 'noor@studio.dev' });
      expect(done).toMatchObject({ outcome: 'connected', address: 'noor@studio.dev', addressDiffers: false, testing: false });
      expect(await accountOf('noor')).toMatchObject({ subject: 'sub-noor', state: 'connected', hasTokens: true });
      // Spent: it now reads like any link that never was.
      expect((await door('open', { token })).statusCode).toBe(404);
    });

    it('shows an address that is not the one on file, and refuses nothing for it', async () => {
      const done = await connectAs('rafa', { subject: 'sub-rafa', email: 'rafa.private@gmail.example' });
      expect(done).toMatchObject({ outcome: 'connected', addressDiffers: true });
      const read = await staff('owner', 'GET', `/connected-accounts?connection=${h.connectionId}&table=${table}&row=${rowOf['rafa']!}`);
      expect(read.json()).toMatchObject({ accounts: [{ address: 'rafa.private@gmail.example', addressDiffers: true, state: 'connected' }] });
    });

    it('OUT-1: an authorize address opened in another browser connects nothing, and costs the right one nothing', async () => {
      const token = await linkFor('ivy');
      const started = await start(token);
      provider.codes.set('stolen', { subject: 'sub-elin-private' });
      for (const cookie of [undefined, '__Host-adminium-connect=someone-elses']) {
        expect((await door('complete', { token: started.token, state: started.state, code: 'stolen' }, cookie)).json()).toEqual({ outcome: 'nothing' });
      }
      expect(await accountOf('ivy')).toBeNull();
      expect(await finish(started, { subject: 'sub-ivy' })).toMatchObject({ outcome: 'connected' });
      expect((await accountOf('ivy'))?.subject).toBe('sub-ivy');
    });

    it('takes no code sent to the right browser from a page that never held the link', async () => {
      const token = await linkFor('ivy2');
      const started = await start(token);
      // The attacker signed in on the copied authorize address and sends the victim the way back, with the attacker's code.
      provider.codes.set('injected', { subject: 'sub-attacker', email: 'attacker@gmail.example' });
      expect((await door('complete', { state: started.state, code: 'injected' }, started.cookie)).json()).toEqual({ outcome: 'nothing' });
      expect((await door('complete', { token: 'x'.repeat(43), state: started.state, code: 'injected' }, started.cookie)).json()).toEqual({ outcome: 'nothing' });
      expect(await accountOf('ivy2')).toBeNull();
      // The person's own tab is not cost anything by it.
      expect(await finish(started, { subject: 'sub-ivy2' })).toMatchObject({ outcome: 'connected' });
      expect((await accountOf('ivy2'))?.subject).toBe('sub-ivy2');
    });

    it('flags an account that proves no address when the row has one on file', async () => {
      const done = await connectAs('june2', { subject: 'sub-june2', email: null });
      expect(done).toMatchObject({ outcome: 'connected', address: null, addressDiffers: true });
      const read = await staff('owner', 'GET', `/connected-accounts?connection=${h.connectionId}&table=${table}&row=${rowOf['june2']!}`);
      expect(read.json()).toMatchObject({ accounts: [{ address: null, addressDiffers: true }] });
    });

    it('a link dies when its row comes to hold someone else', async () => {
      const corrected = await linkFor('wes');
      await h.rows(`UPDATE ${real} SET email = 'wes.corrected@studio.dev' WHERE id = ${rowOf['wes']!}`);
      expect((await door('open', { token: corrected })).statusCode).toBe(404);
      expect((await door('start', { token: corrected, provider: KEY })).statusCode).toBe(404);

      const reused = await linkFor('wes');
      expect((await door('open', { token: reused })).statusCode).toBe(200);
      await h.rows(`DELETE FROM ${real} WHERE id = ${rowOf['wes']!}`);
      await h.rows(`INSERT INTO ${real} (id, name, email, active, user_id) VALUES (${rowOf['wes']!}, 'New Hire', 'new.hire@studio.dev', ${dialect === 'postgres' ? 'TRUE' : '1'}, NULL)`);
      expect((await door('open', { token: reused })).statusCode).toBe(404);
    });

    it('sends one person\'s link once a minute, so a colleague\'s inbox and link cannot be worn out', async () => {
      await settingsRepo(h.meta).set('email.smtp', { host: 'localhost', port: 587, user: 'postmaster', passEncrypted: encryptSecret('hunter2', emailSecretKey(TEST_SECRET)), secure: false, from: 'Studio <no-reply@studio.example>' } as never);
      try {
        const first = await staff('desk', 'POST', '/connected-accounts/link', ref('lou'));
        expect(first.statusCode, first.body).toBe(200);
        const held = await repo().linkOnTarget(target('lou'), Date.now());
        const again = await staff('desk', 'POST', '/connected-accounts/link', ref('lou'));
        expect(again.statusCode, again.body).toBe(429);
        // The link already sent still stands.
        expect((await repo().linkOnTarget(target('lou'), Date.now()))?.id).toBe(held?.id);
      } finally {
        await settingsRepo(h.meta).unset('email.smtp');
      }
    });

    it('takes a code once', async () => {
      const started = await start(await linkFor('june'));
      provider.codes.set('once', { subject: 'sub-june' });
      expect((await door('complete', { token: started.token, state: started.state, code: 'once' }, started.cookie)).json()).toMatchObject({ outcome: 'connected' });
      expect((await door('complete', { token: started.token, state: started.state, code: 'once' }, started.cookie)).json()).toEqual({ outcome: 'nothing' });
    });

    it('opening a link spends nothing, so a mail scanner cannot use it up', async () => {
      const token = await linkFor('marco');
      for (let i = 0; i < 3; i += 1) expect((await door('open', { token })).statusCode).toBe(200);
      expect((await door('start', { token, provider: KEY })).statusCode).toBe(200);
    });

    it('PRV-9: a short grant is not saved, says what is missing, and the link still works', async () => {
      const token = await linkFor('marco');
      expect(await finish(await start(token), { subject: 'sub-marco', scope: 'openid email cal.write' })).toEqual({ outcome: 'partial', missing: ['cal.read'] });
      expect(await accountOf('marco')).toBeNull();
      expect((await door('open', { token })).statusCode).toBe(200);
    });

    it('OUT-4: an answer with no refresh token connects nothing', async () => {
      const token = await linkFor('marco');
      expect(await finish(await start(token), { subject: 'sub-marco', noRefresh: true })).toEqual({ outcome: 'nothing' });
      expect(await accountOf('marco')).toBeNull();
      expect((await door('open', { token })).statusCode).toBe(200);
    });

    it('PRV-10: a grant the provider ends within days says the app is still in testing', async () => {
      const done = await connectAs('marco', { subject: 'sub-marco', refreshExpiresIn: 604_800 });
      expect(done).toMatchObject({ outcome: 'connected', testing: true });
      const ended = await staff('owner', 'POST', '/connected-accounts/disconnect', { ...ref('marco'), addOn: KEY });
      expect(ended.statusCode, ended.body).toBe(200);
    });

    it('OUT-2: a reconnect must be the same account', async () => {
      const before = await accountOf('noor');
      expect(await connectAs('noor', { subject: 'sub-somebody-else' })).toEqual({ outcome: 'different-account' });
      expect(await accountOf('noor')).toMatchObject({ subject: 'sub-noor', version: before!.version });
      expect(await connectAs('noor', { subject: 'sub-noor', email: 'noor@studio.dev' })).toMatchObject({ outcome: 'connected' });
    });

    it('says a person said no, and leaves the link', async () => {
      const token = await linkFor('marco');
      const started = await start(token);
      const denied = await door('complete', { token: started.token, state: started.state, error: 'access_denied' }, started.cookie);
      expect(denied.json()).toEqual({ outcome: 'denied' });
      expect((await door('open', { token })).statusCode).toBe(200);
    });

    it('a new link retires the one before', async () => {
      const first = await linkFor('marco');
      const second = await linkFor('marco');
      expect((await door('open', { token: first })).statusCode).toBe(404);
      expect((await door('open', { token: second })).statusCode).toBe(200);
    });

    it('serves the door\'s two pages, with the door\'s headers, and nothing in them to keep', async () => {
      for (const url of ['/x/connect', '/x/connect/back']) {
        const page = await app.inject({ method: 'GET', url });
        // 503 where the `x` bundle is not built, as in this harness; a door that were closed would answer 404.
        expect([200, 503]).toContain(page.statusCode);
        expect(page.headers['content-security-policy']).toContain("frame-ancestors 'none'");
        expect(page.headers['cache-control']).toBe('no-store');
        expect(page.headers['referrer-policy']).toBe('no-referrer');
      }
    });

    it('reads the same for a made-up link', async () => {
      const made = await door('open', { token: 'x'.repeat(43) });
      expect(made.statusCode).toBe(404);
      expect(made.json()).toEqual({ error: 'unavailable' });
    });

    it('refuses a call from another site', async () => {
      const token = await linkFor('marco');
      const reply = await app.inject({ method: 'POST', url: '/x/connect/api/open', headers: { origin: 'https://evil.example' }, payload: { token } });
      expect(reply.statusCode).toBe(404);
    });

    it('runs the door as nobody, whoever is signed in', async () => {
      const reply = await app.inject({ method: 'POST', url: '/x/connect/api/open', headers: { cookie: cookies['admin']! }, payload: { token: 'x'.repeat(43) } });
      expect(reply.statusCode).toBe(404);
      expect(reply.headers['content-security-policy']).toContain("default-src 'none'");
      expect(reply.headers['cache-control']).toBe('no-store');
    });

    // ─── Who may do what, as each role ─────────────────────────────────────

    it('front desk: reads and sends, never connects, copies or disconnects', async () => {
      const read = await staff('desk', 'GET', `/connected-accounts?connection=${h.connectionId}&table=${table}&row=${rowOf['noor']!}`);
      expect(read.statusCode, read.body).toBe(200);
      expect(read.json()).toMatchObject({ may: { connect: false, sendLink: true, copyLink: false, disconnect: false } });
      expect((await staff('desk', 'POST', '/connected-accounts/connect', { ...ref('marco'), addOn: KEY })).statusCode).toBe(403);
      expect((await staff('desk', 'POST', '/connected-accounts/disconnect', { ...ref('noor'), addOn: KEY })).statusCode).toBe(403);
      expect((await staff('desk', 'POST', '/connected-accounts/link', { ...ref('marco'), copy: true })).statusCode).toBe(403);
    });

    it('front desk: with no mail set up it says so, and the link the person holds still works', async () => {
      const held = await linkFor('marco');
      const refused = await staff('desk', 'POST', '/connected-accounts/link', ref('marco'));
      expect(refused.statusCode).toBe(422);
      expect(JSON.stringify(refused.json())).toContain('MAIL_OFF');
      expect((await door('open', { token: held })).statusCode).toBe(200);
    });

    it('front desk: a typed address is not a thing the route takes', async () => {
      await settingsRepo(h.meta).set('email.smtp', { host: 'localhost', port: 587, user: 'postmaster', passEncrypted: encryptSecret('hunter2', emailSecretKey(TEST_SECRET)), from: 'Studio <no-reply@studio.example>', secure: false } as never);
      try {
        const reply = await staff('desk', 'POST', '/connected-accounts/link', { ...ref('kit'), to: 'attacker@evil.example' });
        // The body is read for what the schema names: the mail goes to the row's own address or nowhere.
        if (reply.statusCode === 200) expect(reply.json()).toEqual({ sentTo: null, url: null });
        else expect(reply.statusCode).toBe(422);
      } finally {
        await settingsRepo(h.meta).unset('email.smtp');
      }
    });

    it('front desk: with mail set up, the link goes to the row’s own address and nowhere else', async () => {
      await settingsRepo(h.meta).set('email.smtp', { host: 'localhost', port: 587, user: 'postmaster', passEncrypted: encryptSecret('hunter2', emailSecretKey(TEST_SECRET)), from: 'Studio <no-reply@studio.example>', secure: false } as never);
      try {
        const sent = await staff('desk', 'POST', '/connected-accounts/link', ref('marco'));
        expect(sent.statusCode, sent.body).toBe(200);
        // The desk may not read personal columns here, so it is not told the address it sent to.
        expect(sent.json()).toEqual({ sentTo: null, url: null });
        const byOwner = await staff('owner', 'POST', '/connected-accounts/link', ref('marco'));
        expect(byOwner.json()).toEqual({ sentTo: 'marco@studio.dev', url: null });
        const jobs = await h.meta.db.selectFrom('adminium_jobs').select('kind').where('kind', '=', 'email.send').execute();
        expect(jobs.length).toBeGreaterThan(0);
      } finally {
        await settingsRepo(h.meta).unset('email.smtp');
      }
    });

    it('specialist: connects their own row and no one else’s, whose rows read as not there', async () => {
      const own = await staff('elin', 'GET', `/connected-accounts?connection=${h.connectionId}&table=${table}&row=${rowOf['elin']!}`);
      expect(own.statusCode, own.body).toBe(200);
      expect(own.json()).toMatchObject({ may: { connect: true, sendLink: false, copyLink: false, disconnect: true } });
      const other = await staff('elin', 'GET', `/connected-accounts?connection=${h.connectionId}&table=${table}&row=${rowOf['noor']!}`);
      expect(other.statusCode).toBe(404);
      expect((await staff('elin', 'POST', '/connected-accounts/disconnect', { ...ref('noor'), addOn: KEY })).statusCode).toBe(404);
      expect((await staff('elin', 'POST', '/connected-accounts/connect', { ...ref('noor'), addOn: KEY })).statusCode).toBe(404);
      expect((await staff('elin', 'POST', '/connected-accounts/link', ref('elin'))).statusCode).toBe(403);

      const connect = await staff('elin', 'POST', '/connected-accounts/connect', { ...ref('elin'), addOn: KEY });
      expect(connect.statusCode, connect.body).toBe(200);
      const url = (connect.json() as { url: string }).url;
      expect(url.startsWith(`${ORIGIN}/x/connect#`)).toBe(true);
      expect(await finish(await start(tokenOf(url)), { subject: 'sub-elin', email: 'elin@gmail.example' })).toMatchObject({ outcome: 'connected', addressDiffers: true });
    });

    it('owner: may copy a link and disconnect anyone', async () => {
      await connectAs('june', { subject: 'sub-june' }).catch(() => undefined);
      const read = await staff('owner', 'GET', `/connected-accounts?connection=${h.connectionId}&table=${table}&row=${rowOf['june']!}`);
      expect(read.json()).toMatchObject({ may: { connect: true, sendLink: true, copyLink: true, disconnect: true } });
    });

    it('a role with no grant on the table is told nothing', async () => {
      const bare = await rolesRepo(h.meta).create({ slug: `bare-${dialect}`, name: 'Bare' });
      const user = await usersRepo(h.meta).create({ email: `bare-${dialect}@studio.dev`, name: 'bare', passwordHash: await adminPasswordHash(), status: 'active' });
      await rolesRepo(h.meta).assignToUser(user.id, bare.id);
      await permissionsRepo(h.meta).grant(bare.id, 'app', 'studio', { staff: true });
      const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: user.email, password: ADMIN_PASSWORD }, remoteAddress: '10.0.1.1' });
      cookies['bare'] = sessionCookie(login.headers['set-cookie']);
      expect((await staff('bare', 'GET', `/connected-accounts?connection=${h.connectionId}&table=${table}&row=${rowOf['noor']!}`)).statusCode).toBe(404);
    });

    // ─── Tokens ────────────────────────────────────────────────────────────

    it('OUT-3: hands a provider a client that adds the token, and never the token', async () => {
      const account = (await accountOf('noor'))!;
      const client = await engine().tokens.clientFor(account.id);
      expect(Object.keys(client).sort()).toEqual(['account', 'http']);
      expect(JSON.stringify(client.account)).not.toContain('at-');
      const reply = await client.http('https://api.cal.example/events');
      expect(reply.status).toBe(200);
      expect(provider.calls.at(-1)!.headers.get('authorization')).toMatch(/^Bearer at-/);
    });

    it('OUT-3: an add-on\'s event never receives the secret or the refresh token', () => {
      const registration = { kind: 'oauth2', secret: { oauthApp: 1, clientId: 'c', clientSecret: 's' } };
      expect(addOnVisibleCredential(registration)).toBeNull();
      expect(addOnVisibleCredential({ kind: 'oauth2', secret: { clientId: 'c', clientSecret: 's', accessToken: 'a', refreshToken: 'r', redirectUri: 'x' } })).toEqual({ accessToken: 'a' });
      expect(addOnVisibleCredential({ kind: 'api-key', secret: { apiKey: 'k' } })).toEqual({ apiKey: 'k' });
    });

    it('OUT-10: refreshes once when several ask at once, and keeps the refresh token', async () => {
      const account = (await accountOf('noor'))!;
      await h.meta.db.updateTable('adminium_connected_accounts').set({ expiresAt: Date.now() + 1000 }).where('id', '=', account.id).execute();
      const before = tokenCalls(provider).length;
      provider.state.delayMs = 20;
      const tokens = engine().tokens;
      const got = await Promise.all([tokens.accessToken(account.id), tokens.accessToken(account.id), tokens.accessToken(account.id)]);
      expect(new Set(got).size).toBe(1);
      expect(tokenCalls(provider).length - before).toBe(1);
      expect((await repo().tokensOf(account.id))?.refreshToken).toBe('rt-sub-noor');
      expect(tokenCalls(provider).at(-1)!.form.get('client_secret')).toBe('client-secret-1');
    });

    it('OUT-10: two processes refresh once between them', async () => {
      const account = (await accountOf('noor'))!;
      await h.meta.db.updateTable('adminium_connected_accounts').set({ expiresAt: Date.now() + 1000 }).where('id', '=', account.id).execute();
      const before = tokenCalls(provider).length;
      provider.state.delayMs = 60;
      const [a, b] = await Promise.all([engine().tokens.accessToken(account.id), engine((ms) => new Promise((resolve) => setTimeout(resolve, ms))).tokens.accessToken(account.id)]);
      expect(a).toBe(b);
      expect(tokenCalls(provider).length - before).toBe(1);
    });

    it('OUT-3: a 401 refreshes once and repeats the call', async () => {
      const account = (await accountOf('noor'))!;
      const before = tokenCalls(provider).length;
      provider.state.apiStatus = [401, 200];
      const reply = await (await engine().tokens.clientFor(account.id)).http('https://api.cal.example/events');
      expect(reply.status).toBe(200);
      expect(tokenCalls(provider).length - before).toBe(1);
    });

    it('OUT-4: the provider being down changes no state', async () => {
      const account = (await accountOf('noor'))!;
      await h.meta.db.updateTable('adminium_connected_accounts').set({ expiresAt: Date.now() + 1000 }).where('id', '=', account.id).execute();
      provider.state.tokenStatus = 503;
      await expect(engine().tokens.accessToken(account.id)).rejects.toMatchObject({ failure: 'transient' });
      expect(await accountOf('noor')).toMatchObject({ state: 'connected' });
      expect(await repo().refusedOf(installId)).toBeNull();
      expect((await repo().find(account.id))?.leaseUntil).toBeNull();
      provider.state.tokenStatus = 200;
      await expect(engine().tokens.accessToken(account.id)).resolves.toMatch(/^at-refreshed/);
    });

    it('SYN-8, PRV-10: a refused client is the studio’s state, told once, and nobody must reconnect', async () => {
      const noor = (await accountOf('noor'))!;
      const rafa = (await accountOf('rafa'))!;
      for (const account of [noor, rafa]) await h.meta.db.updateTable('adminium_connected_accounts').set({ expiresAt: Date.now() + 1000 }).where('id', '=', account.id).execute();
      const countNotices = async () => Number((await h.meta.db.selectFrom('adminium_notifications').select((eb) => eb.fn.countAll().as('n')).where('kind', '=', 'accounts.setup-refused').executeTakeFirstOrThrow()).n);
      const before = await countNotices();
      provider.state.tokenStatus = 401;
      provider.state.tokenError = 'invalid_client';
      const service = engine();
      await expect(service.tokens.accessToken(noor.id)).rejects.toMatchObject({ failure: 'setup' });
      await expect(service.tokens.accessToken(rafa.id)).rejects.toMatchObject({ failure: 'setup' });
      expect((await accountOf('noor'))?.state).toBe('connected');
      expect((await accountOf('rafa'))?.state).toBe('connected');
      // One notice per person who manages it, for the one refusal.
      const told = (await countNotices()) - before;
      expect(told).toBeGreaterThan(0);
      expect(told).toBeLessThanOrEqual(2);
      const read = await staff('owner', 'GET', `/connected-accounts?connection=${h.connectionId}&table=${table}&row=${rowOf['noor']!}`);
      expect(read.json()).toMatchObject({ accounts: [{ state: 'setup' }] });
      const status = await staff('admin', 'GET', `/add-ons/${KEY}/connect/accounts`);
      expect(status.json()).toMatchObject({ install: 'secret-refused' });

      // A new secret clears it, for everyone, with no one reconnecting.
      provider.state.tokenError = null;
      provider.state.tokenStatus = 200;
      const put = await app.inject({ method: 'PUT', url: `/api/v1/add-ons/${KEY}/connect/app`, headers: { cookie: cookies['admin']! }, payload: { clientId: 'client-1', clientSecret: 'client-secret-1' } });
      expect(put.statusCode, put.body).toBe(200);
      await expect(service.tokens.accessToken(noor.id)).resolves.toMatch(/^at-refreshed/);
    });

    it('SYN-8: a refused client is asked again now and then, so a refusal taken back needs nobody', async () => {
      const noor = (await accountOf('noor'))!;
      await h.meta.db.updateTable('adminium_connected_accounts').set({ expiresAt: Date.now() + 1000 }).where('id', '=', noor.id).execute();
      await repo().markRefused(installId, 'invalid_client', Date.now());
      const before = tokenCalls(provider).length;
      await expect(engine().tokens.accessToken(noor.id)).rejects.toMatchObject({ failure: 'setup' });
      expect(tokenCalls(provider).length).toBe(before);
      // Past the wait, one try: and it worked, so the install reads ready again.
      await h.meta.db.updateTable('adminium_add_on_credentials').set({ refusedAt: Date.now() - 16 * 60_000 }).where('manifestId', '=', installId).execute();
      await expect(engine().tokens.accessToken(noor.id)).resolves.toMatch(/^at-refreshed/);
      expect(tokenCalls(provider).length).toBe(before + 1);
      expect(await repo().refusedOf(installId)).toBeNull();
    });

    it('OUT-7: says when the public address moved, so the provider is given the new one', async () => {
      await settingsRepo(h.meta).set('system.publicOrigin', 'https://new.example.com');
      try {
        const moved = await staff('admin', 'GET', `/add-ons/${KEY}/connect/accounts`);
        expect(moved.json()).toMatchObject({ redirectUri: `https://new.example.com${CALLBACK}`, redirectMoved: true });
      } finally {
        await settingsRepo(h.meta).set('system.publicOrigin', ORIGIN);
      }
      expect((await staff('admin', 'GET', `/add-ons/${KEY}/connect/accounts`)).json()).toMatchObject({ redirectMoved: false });
    });

    it('records each connection, though the door runs as nobody', async () => {
      const rows = await h.meta.db.selectFrom('adminium_audit_log').select(['action', 'changes']).where('action', '=', 'connected-account.connected').execute();
      expect(rows.length).toBeGreaterThan(0);
      expect(JSON.stringify(rows)).not.toContain('rt-');
      expect(JSON.stringify(rows)).not.toContain('at-sub');
    });

    it('OUT-4: invalid_grant moves that one account to reconnect, and its error says only that', async () => {
      const rafa = (await accountOf('rafa'))!;
      await h.meta.db.updateTable('adminium_connected_accounts').set({ expiresAt: Date.now() + 1000 }).where('id', '=', rafa.id).execute();
      provider.state.tokenStatus = 400;
      provider.state.tokenError = 'invalid_grant';
      const failure = await engine().tokens.accessToken(rafa.id).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(AccountTokenError);
      expect((failure as Error).message).not.toContain('client-secret');
      expect((failure as Error).message).not.toContain('leaked');
      expect((await accountOf('rafa'))?.state).toBe('reconnect');
      expect((await accountOf('noor'))?.state).toBe('connected');
      provider.state.tokenError = null;
      provider.state.tokenStatus = 200;
      // The same account coming back clears it.
      expect(await connectAs('rafa', { subject: 'sub-rafa', email: 'rafa.private@gmail.example' })).toMatchObject({ outcome: 'connected' });
      expect((await accountOf('rafa'))?.state).toBe('connected');
    });

    // ─── Ending a connection ───────────────────────────────────────────────

    it('OUT-11: runs cleanups, gives the grant back, and removes the tokens', async () => {
      const account = (await accountOf('june'))!;
      const service = engine();
      const seen: string[] = [];
      service.addCleanup({ run: async ({ account: one }) => (seen.push(`stop:${one.state}`), Promise.resolve({ removed: 7 })) });
      service.addCleanup({ run: async () => { throw new Error('the calendar is gone'); } });
      const ended = await service.end(account.id);
      expect(ended).toEqual({ removed: 7, incomplete: true, revoked: true });
      const revoke = provider.calls.filter((call) => call.url.endsWith('/revoke')).at(-1)!;
      expect(revoke.form.get('token')).toBe('rt-sub-june');
      expect(await accountOf('june')).toBeNull();
      expect(seen).toEqual(['stop:connected']);
    });

    it('leaves the grant alone while the same account is connected on another database under the same client', async () => {
      await connectAs('ana', { subject: 'sub-shared' });
      const here = (await accountOf('ana'))!;
      const manifests = manifestsRepo(h.meta, addOnCredentialCryptoFromSecret(TEST_SECRET));
      const other = await manifests.install({ manifestKey: KEY, version: '1.0.0', kind: 'add-on', source: 'marketplace', document: addOnManifest(), scopeKey: 'another-database', instanceSlug: 'another', connectionId: h.connectionId });
      try {
        await manifests.setCredential(other.row.id, (await manifests.getCredential(installId))!);
        const at = Date.now();
        const link = await repo().mintLink({ connectionId: h.connectionId, tableName: 'elsewhere', rowKey: '1', providers: [KEY], purpose: 'connect', tokenHash: 'c'.repeat(64), createdBy: null, expiresAt: at + 60_000 }, at);
        const twin = await repo().connect({ manifestId: other.row.id, target: { connectionId: h.connectionId, tableName: 'elsewhere', rowKey: '1' }, subject: 'sub-shared', address: null, tokens: { accessToken: 'at-twin', refreshToken: 'rt-twin' }, expiresAt: at + 3_600_000, refreshExpiresAt: null, scopes: ['cal.read', 'cal.write'], state: 'connected' }, link.id, at);
        expect(twin).not.toBeNull();
        const before = provider.calls.filter((call) => call.url.endsWith('/revoke')).length;
        const ended = await engine().end(here.id);
        expect(ended).toMatchObject({ revoked: false });
        expect(provider.calls.filter((call) => call.url.endsWith('/revoke')).length).toBe(before);
      } finally {
        await h.meta.db.deleteFrom('adminium_connected_accounts').where('manifestId', '=', other.row.id).execute();
        await manifests.uninstall(other.row.id);
      }
    });

    it('OUT-11: disconnects through the route, as the owner, and says what it did', async () => {
      await connectAs('june', { subject: 'sub-june' });
      const reply = await staff('owner', 'POST', '/connected-accounts/disconnect', { ...ref('june'), addOn: KEY });
      expect(reply.statusCode, reply.body).toBe(200);
      expect(reply.json()).toEqual({ removed: 0, incomplete: false, revoked: true });
      expect(await accountOf('june')).toBeNull();
    });

    it('OUT-11: the sweep ends a row that is gone or switched off, and nothing while the database cannot answer', async () => {
      await connectAs('gone', { subject: 'sub-gone' });
      await connectAs('off', { subject: 'sub-off' });
      await h.rows(`DELETE FROM ${real} WHERE name = 'gone'`);
      await h.rows(`UPDATE ${real} SET active = ${dialect === 'postgres' ? 'FALSE' : '0'} WHERE name = 'off'`);
      const service = engine();
      const queued: string[] = [];
      const run = await runConnectedAccountsTick(service, (input) => {
        queued.push(String(input.payload['accountId']));
        return Promise.resolve();
      });
      expect(run.ending).toBe(2);
      const goneId = (await accountOf('gone'))!.id;
      const offId = (await accountOf('off'))!.id;
      expect(queued.sort()).toEqual([goneId, offId].sort());
      // The row came back before its job ran: that one is left alone.
      await h.rows(`UPDATE ${real} SET active = ${dialect === 'postgres' ? 'TRUE' : '1'} WHERE name = 'off'`);
      expect(await service.endBySystem(offId)).toBeNull();
      expect(await accountOf('off')).not.toBeNull();
      await h.rows(`UPDATE ${real} SET active = ${dialect === 'postgres' ? 'FALSE' : '0'} WHERE name = 'off'`);
      for (const accountId of queued) await service.endBySystem(accountId);
      expect(await accountOf('gone')).toBeNull();
      expect(await accountOf('off')).toBeNull();
      expect(await accountOf('noor')).not.toBeNull();

      const blind = createConnectedAccounts({
        meta: h.meta,
        crypto: addOnCredentialCryptoFromSecret(TEST_SECRET),
        secret: TEST_SECRET,
        httpFor: () => provider.fetchImpl as never,
        rows: { read: () => Promise.reject(new Error('the database is away')), tableId: (_connection, name) => Promise.resolve(name === h.real('team') ? table : null) , list: () => Promise.resolve([]) },
        publicOrigin: () => Promise.resolve(ORIGIN),
        reach: () => Promise.resolve(reachability({ networkFeatures: true, desktop: false, trustProxy: false, forwarded: false, publicOrigin: ORIGIN })),
      });
      expect((await blind.sweep()).ending).toEqual([]);

      // A snapshot that lost the table says nothing about the people on it.
      const lostTable = createConnectedAccounts({
        meta: h.meta,
        crypto: addOnCredentialCryptoFromSecret(TEST_SECRET),
        secret: TEST_SECRET,
        httpFor: () => provider.fetchImpl as never,
        rows: { read: () => Promise.reject(new Error('not in the snapshot')), tableId: () => Promise.resolve(null) , list: () => Promise.resolve([]) },
        publicOrigin: () => Promise.resolve(ORIGIN),
        reach: () => Promise.resolve(reachability({ networkFeatures: true, desktop: false, trustProxy: false, forwarded: false, publicOrigin: ORIGIN })),
      });
      expect((await lostTable.sweep()).ending).toEqual([]);
      const noor = (await accountOf('noor'))!;
      expect(await lostTable.endBySystem(noor.id)).toBeNull();
      expect(await accountOf('noor')).not.toBeNull();
    });

    it('a screens-only person coming back signed in reaches the door', async () => {
      const reply = await app.inject({ method: 'GET', url: `${CALLBACK}?code=abc&state=def`, headers: { cookie: cookies['elin']! } });
      expect(reply.statusCode).toBe(303);
    });

    it('OUT-11: a disconnect does not cut the same account on another row', async () => {
      expect(await connectAs('june', { subject: 'sub-shared' })).toMatchObject({ outcome: 'connected' });
      expect(await connectAs('marco', { subject: 'sub-shared' })).toMatchObject({ outcome: 'connected' });
      const revokes = () => provider.calls.filter((call) => call.url.endsWith('/revoke')).length;
      const before = revokes();
      const first = await staff('owner', 'POST', '/connected-accounts/disconnect', { ...ref('june'), addOn: KEY });
      expect(first.json()).toMatchObject({ revoked: false });
      expect(revokes()).toBe(before);
      // The last row holding it gives the grant back.
      const last = await staff('owner', 'POST', '/connected-accounts/disconnect', { ...ref('marco'), addOn: KEY });
      expect(last.json()).toMatchObject({ revoked: true });
      expect(revokes()).toBe(before + 1);
    });

    it('PRV-9, OUT-2: a sign-in that connected nothing gives its grant back, unless that account is connected here', async () => {
      const revokes = () => provider.calls.filter((call) => call.url.endsWith('/revoke')).map((call) => call.form.get('token'));
      const before = revokes().length;
      await finish(await start(await linkFor('june')), { subject: 'sub-stranger', scope: 'openid email cal.read' });
      expect(revokes().slice(before)).toEqual(['rt-sub-stranger']);
      // Noor is connected through this app: her own short re-grant must not end her connection.
      const again = revokes().length;
      await finish(await start(await linkFor('noor')), { subject: 'sub-noor', scope: 'openid email cal.read' });
      expect(revokes().length).toBe(again);
      expect((await accountOf('noor'))?.state).toBe('connected');
    });

    it('a disconnect while the provider is answering wins: nothing is written after it', async () => {
      await connectAs('june', { subject: 'sub-june' });
      const started = await start(await linkFor('june'));
      provider.codes.set('slow', { subject: 'sub-june' });
      provider.state.delayMs = 150;
      const finishing = door('complete', { token: started.token, state: started.state, code: 'slow' }, started.cookie);
      await new Promise((resolve) => setTimeout(resolve, 40));
      const ended = await staff('owner', 'POST', '/connected-accounts/disconnect', { ...ref('june'), addOn: KEY });
      expect(ended.statusCode, ended.body).toBe(200);
      expect((await finishing).json()).toEqual({ outcome: 'nothing' });
      expect(await accountOf('june')).toBeNull();
    });

    it('SYN-8: a second 401 from the API is told as it came, and moves no state', async () => {
      const account = (await accountOf('noor'))!;
      provider.state.apiStatus = [401, 401];
      const reply = await (await engine().tokens.clientFor(account.id)).http('https://api.cal.example/events');
      expect(reply.status).toBe(401);
      expect((await accountOf('noor'))?.state).toBe('connected');
    });

    it('OUT-4: a late invalid_grant does not undo a reconnect that landed meanwhile', async () => {
      const account = (await accountOf('noor'))!;
      await h.meta.db.updateTable('adminium_connected_accounts').set({ expiresAt: Date.now() + 1000 }).where('id', '=', account.id).execute();
      provider.state.tokenStatus = 400;
      provider.state.tokenError = 'invalid_grant';
      provider.state.delayMs = 120;
      const late = engine().tokens.accessToken(account.id);
      await new Promise((resolve) => setTimeout(resolve, 30));
      await h.meta.db.updateTable('adminium_connected_accounts').set({ version: account.version + 7, expiresAt: Date.now() + 3_600_000 }).where('id', '=', account.id).execute();
      await expect(late).resolves.toEqual(expect.any(String));
      expect((await accountOf('noor'))?.state).toBe('connected');
    });

    it('OUT-5: a row whose tokens could not travel reads Reconnect, and is not forgotten', async () => {
      await connectAs('marco', { subject: 'sub-marco' });
      const account = (await accountOf('marco'))!;
      await h.meta.db.updateTable('adminium_connected_accounts').set({ payload: null }).where('id', '=', account.id).execute();
      const read = await staff('owner', 'GET', `/connected-accounts?connection=${h.connectionId}&table=${table}&row=${rowOf['marco']!}`);
      expect(read.json()).toMatchObject({ accounts: [{ state: 'reconnect', address: 'sub-marco@gmail.example' }] });
      await expect(engine().tokens.accessToken(account.id)).rejects.toMatchObject({ failure: 'reconnect' });
    });

    it('keeps an install-level account through the same door, for whoever manages add-ons', async () => {
      const SOLO = 'calendar-solo';
      const base = addOnManifest();
      const solo = { ...base, key: SOLO, name: 'Solo Calendar', addOn: { ...base.addOn, connect: { ...base.addOn.connect, accounts: 'install' } } };
      expect(validateManifest(solo).ok).toBe(true);
      const manifests = manifestsRepo(h.meta, addOnCredentialCryptoFromSecret(TEST_SECRET));
      const install = await manifests.install({ manifestKey: SOLO, version: '1.0.0', kind: 'add-on', source: 'marketplace', document: solo, scopeKey: h.connectionId, connectionId: h.connectionId });
      expect((await staff('owner', 'POST', `/add-ons/${SOLO}/connect/accounts/link`)).statusCode).toBe(403);
      const none = await staff('admin', 'POST', `/add-ons/${SOLO}/connect/accounts/link`);
      expect(JSON.stringify(none.json())).toContain('NOT_SET_UP');
      const put = await app.inject({ method: 'PUT', url: `/api/v1/add-ons/${SOLO}/connect/app`, headers: { cookie: cookies['admin']! }, payload: { clientId: 'client-1', clientSecret: 'client-secret-solo', tenant: 'contoso.example' } });
      expect(put.statusCode, put.body).toBe(200);

      const link = await staff('admin', 'POST', `/add-ons/${SOLO}/connect/accounts/link`);
      expect(link.statusCode, link.body).toBe(200);
      const token = tokenOf((link.json() as { url: string }).url);
      expect((await door('open', { token })).json()).toMatchObject({ person: null, providers: [{ key: SOLO, name: 'Solo Calendar' }] });
      const begun = await door('start', { token, provider: SOLO });
      expect(begun.statusCode, begun.body).toBe(200);
      const authorize = new URL((begun.json() as { authorizeUrl: string }).authorizeUrl);
      expect(authorize.pathname).toBe('/contoso.example/authorize');
      expect(authorize.searchParams.has('login_hint')).toBe(false);
      const done = await finish({ token, state: authorize.searchParams.get('state')!, cookie: (begun.headers['set-cookie'] as string).split(';')[0]! }, { subject: 'sub-solo' });
      expect(done).toMatchObject({ outcome: 'connected', address: 'sub-solo@gmail.example' });

      const [account] = await repo().forInstall(install.row.id);
      expect(account).toMatchObject({ subject: 'sub-solo', connectionId: '', tableName: '@install', rowKey: install.row.id });
      // An install-level account stands with no row behind it.
      expect((await engine().sweep()).ending).not.toContain(account!.id);
      const ended = await staff('admin', 'POST', `/add-ons/${SOLO}/connect/accounts/${account!.id}/disconnect`);
      expect(ended.statusCode, ended.body).toBe(200);
      expect(await repo().forInstall(install.row.id)).toEqual([]);
      await manifests.uninstall(install.row.id);
    });

    // ─── The add-on's page ─────────────────────────────────────────────────

    const check = (who: string, payload: Record<string, unknown>) => app.inject({ method: 'POST', url: `/api/v1/add-ons/${KEY}/connect/check`, headers: { cookie: cookies[who]! }, payload, remoteAddress: `10.9.0.${String(++checkCalls)}` });
    let checkCalls = 0;
    const putApp = (payload: Record<string, unknown>) => app.inject({ method: 'PUT', url: `/api/v1/add-ons/${KEY}/connect/app`, headers: { cookie: cookies['admin']! }, payload });
    const day = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

    it('"Check my setup" reads only the provider\'s word, and never echoes it', async () => {
      provider.calls.length = 0;
      const good = await check('admin', { grant: 'pair' });
      expect(good.statusCode, good.body).toBe(200);
      expect(good.json()).toEqual({ result: 'accepted' });
      const sent = tokenCalls(provider).at(-1)!.form;
      expect(sent.get('grant_type')).toBe('authorization_code');
      expect(sent.get('code')).toBe('adminium-setup-check');
      expect(sent.get('client_id')).toBe('client-1');

      provider.state.tokenStatus = 401;
      provider.state.tokenError = 'invalid_client';
      const refused = await check('admin', { grant: 'pair' });
      expect(refused.json()).toEqual({ result: 'refused' });
      expect(refused.body).not.toContain('client-secret-1');
      expect(refused.body).not.toContain('leaked');

      provider.state.tokenCodes = [7000222];
      expect((await check('admin', { grant: 'pair' })).json()).toEqual({ result: 'expired' });

      provider.state.tokenCodes = null;
      provider.state.tokenError = null;
      provider.state.tokenStatus = 500;
      expect((await check('admin', { grant: 'pair' })).json()).toEqual({ result: 'unreachable' });
    });

    it('an app\'s own sign-in is asked only on a named directory', async () => {
      provider.calls.length = 0;
      expect((await check('admin', { grant: 'app', scope: 'https://api.cal.example/.default' })).json()).toEqual({ result: 'unknown' });
      expect(tokenCalls(provider)).toEqual([]);
      expect((await putApp({ clientId: 'client-1', tenant: 'contoso.example' })).statusCode).toBe(200);
      expect((await check('admin', { grant: 'app', scope: 'https://api.cal.example/.default' })).json()).toEqual({ result: 'accepted' });
      const call = tokenCalls(provider).at(-1)!;
      expect(call.url).toContain('/contoso.example/token');
      expect(call.form.get('grant_type')).toBe('client_credentials');
      expect((await putApp({ clientId: 'client-1', tenant: null })).statusCode).toBe(200);
      const wrong = await check('admin', { grant: 'app', scope: 'https://evil.example/not-default' });
      expect(wrong.statusCode).toBe(422);
    });

    it('lets only whoever manages add-ons check the setup or list the people', async () => {
      for (const who of ['owner', 'desk', 'elin']) {
        expect((await check(who, { grant: 'pair' })).statusCode, who).toBe(403);
        expect((await staff(who, 'GET', `/add-ons/${KEY}/connect/people`)).statusCode, who).toBe(403);
      }
    });

    it('checks what is about to be saved without saving it', async () => {
      provider.state.tokenStatus = 401;
      provider.state.tokenError = 'invalid_client';
      const reply = await check('admin', { grant: 'pair', clientId: 'client-typo', clientSecret: 'typo-secret' });
      expect(reply.json()).toEqual({ result: 'refused' });
      const sent = tokenCalls(provider).at(-1)!.form;
      expect(sent.get('client_id')).toBe('client-typo');
      expect(sent.get('client_secret')).toBe('typo-secret');
      expect(reply.body).not.toContain('typo-secret');
      expect((await staff('admin', 'GET', `/add-ons/${KEY}/connect/accounts`)).json()).toMatchObject({ clientId: 'client-1', install: 'ready' });
    });

    it('counts who is connected and who must reconnect, for the add-ons list', async () => {
      const held = await repo().forInstall(installId);
      const live = held.filter((one) => one.state !== 'disconnecting');
      const owed = live.filter((one) => !one.hasTokens || one.state === 'reconnect' || one.state === 'partial').length;
      const reply = (await staff('admin', 'GET', `/add-ons/${KEY}/connect/accounts`)).json() as { accounts: number; counts: { connected: number; reconnect: number } };
      expect(reply.accounts).toBe(live.length);
      expect(reply.counts).toEqual({ connected: live.length - owed, reconnect: owed });
    });

    it('remembers the calendar a person left, across a re-save, and hands it back once', async () => {
      const running = engine();
      await running.rememberCalendar(installId, 'sub-left', 'calendar-left');
      expect((await putApp({ clientId: 'client-1' })).statusCode).toBe(200);
      expect(await running.takeCalendar(installId, 'sub-left')).toBe('calendar-left');
      expect(await running.takeCalendar(installId, 'sub-left')).toBeNull();
      expect((await staff('admin', 'GET', `/add-ons/${KEY}/connect/accounts`)).body).not.toContain('calendar-left');
    });

    it('leaves the sign-in cookie alone on an answer that took no flow', async () => {
      const reply = await door('complete', { state: 'x'.repeat(20), code: 'stray' }, '__Host-adminium-connect=someone');
      expect(reply.json()).toEqual({ outcome: 'nothing' });
      expect(reply.headers['set-cookie']).toBeUndefined();
    });

    it('makes no call on a person\'s account while the add-on is switched off for the app', async () => {
      const account = await accountOf('noor');
      expect(account?.state).toBe('connected');
      const runtime = { providers: new Map([[`${CALENDAR_PROVIDER_CONTRACT}@${String(CALENDAR_PROVIDER_VERSION)}`, [{ addOnKey: KEY, module: { [CALENDAR_PROVIDER_FACTORY]: () => ({ traits: { listsCalendars: false, allDayKnown: true, busyPush: false } }) } }]]]) } as unknown as AddOnRuntimeState;
      const deps = { accounts: engine(), runtime: () => runtime, demo: null };
      const before = provider.calls.length;
      const manifests = manifestsRepo(h.meta, addOnCredentialCryptoFromSecret(TEST_SECRET));
      await manifests.setAttachmentEnabled(installId, 'studio', false);
      try {
        expect(await calendarProviderFor(deps, account!)).toEqual({ ok: false, reason: 'unavailable' });
        expect(provider.calls.length).toBe(before);
        // What ends a connection still runs: a switched-off add-on must be able to take its events back.
        expect((await calendarProviderFor(deps, account!, { ending: true })).ok).toBe(true);
      } finally {
        await manifests.setAttachmentEnabled(installId, 'studio', true);
      }
      expect((await calendarProviderFor(deps, account!)).ok).toBe(true);
    });

    it('keeps a masked address and name from a reader who may not read personal data', async () => {
      const specialist = (await rolesRepo(h.meta).findBySlug('studio-specialist'))!;
      await permissionsRepo(h.meta).grant(specialist.id, 'system', 'manifests.manage', { allowed: true });
      const masked = await overridesRepo(h.meta).create({ connectionId: h.connectionId, op: 'column.pii', tableName: table, columnName: 'email', value: { masked: true }, origin: 'user' } as never);
      try {
        const reply = await staff('elin', 'GET', `/add-ons/${KEY}/connect/people`);
        expect(reply.statusCode, reply.body).toBe(200);
        const [only] = (reply.json() as { people: { address: string | null; canEmail: boolean }[] }).people;
        expect(only).toMatchObject({ address: null, canEmail: true });
        expect(reply.body).not.toContain('elin@studio.dev');
        const admin = await staff('admin', 'GET', `/add-ons/${KEY}/connect/people`);
        expect(admin.body).toContain('elin@studio.dev');
      } finally {
        await overridesRepo(h.meta).delete((masked as { id: string }).id);
        await permissionsRepo(h.meta).revoke(specialist.id, 'system', 'manifests.manage');
      }
    });

    it('keeps the secret out of every reply and audit row of a check, and counts each person\'s presses', async () => {
      provider.state.tokenStatus = 401;
      provider.state.tokenError = 'invalid_client';
      const replies: string[] = [];
      let limited = false;
      for (let press = 0; press < 12 && !limited; press += 1) {
        const reply = await check('admin', { grant: 'pair' });
        replies.push(reply.body);
        limited = reply.statusCode === 429;
      }
      expect(limited).toBe(true);
      for (const body of replies) {
        expect(body).not.toContain('client-secret');
        expect(body).not.toContain('leaked');
      }
      const audit = await auditRepo(h.meta).list({ limit: 200 });
      const rows = JSON.stringify(audit);
      expect(rows).toContain('add-on.app-checked');
      expect(rows).not.toContain('client-secret');
      expect(rows).not.toContain('leaked');
    });

    it('lists only the people a reader\'s own row access allows, with no token in the reply', async () => {
      const specialist = (await rolesRepo(h.meta).findBySlug('studio-specialist'))!;
      await permissionsRepo(h.meta).grant(specialist.id, 'system', 'manifests.manage', { allowed: true });
      try {
        const reply = await staff('elin', 'GET', `/add-ons/${KEY}/connect/people`);
        expect(reply.statusCode, reply.body).toBe(200);
        const seen = (reply.json() as { people: { row: string }[] }).people.map((one) => one.row);
        expect(seen).toEqual([rowOf['elin']]);
        for (const word of ['client-secret', 'rt-', 'at-sub', 'refreshToken', 'accessToken']) expect(reply.body).not.toContain(word);
      } finally {
        await permissionsRepo(h.meta).revoke(specialist.id, 'system', 'manifests.manage');
      }
      expect((await staff('elin', 'GET', `/add-ons/${KEY}/connect/people`)).statusCode).toBe(403);
    });

    it('lists the people who may connect, with their state, and leaves out a row that is off', async () => {
      await h.rows(`UPDATE ${real} SET active = ${dialect === 'postgres' ? 'FALSE' : '0'} WHERE name = 'off'`);
      const reply = await staff('admin', 'GET', `/add-ons/${KEY}/connect/people`);
      expect(reply.statusCode, reply.body).toBe(200);
      const { people: listed } = reply.json() as { people: { row: string; name: string; address: string; account: { state: string; provider: string } | null; elsewhere: boolean }[] };
      const names = listed.map((one) => one.name);
      expect(names).toContain('june');
      expect(names).not.toContain('off');
      expect(listed.find((one) => one.name === 'june')).toMatchObject({ address: 'june@studio.dev', account: null, elsewhere: false, row: rowOf['june'] });
      const noor = listed.find((one) => one.name === 'noor');
      if (noor?.account != null) expect(noor.account.provider).toBe(KEY);
      expect(reply.body).not.toContain('rt-');
      await h.rows(`UPDATE ${real} SET active = ${dialect === 'postgres' ? 'TRUE' : '1'} WHERE name = 'off'`);
    });

    it('tells the link\'s holder who sent it and who it is for', async () => {
      const token = await linkFor('june');
      const opened = (await door('open', { token })).json() as Record<string, unknown>;
      expect(opened).toMatchObject({ person: 'june', address: 'june@studio.dev', sentBy: 'owner' });
      expect('contact' in opened).toBe(true);
    });

    it('keeps the secret\'s end date, drops it with the secret, and warns once, 30 days ahead', async () => {
      await connectAs('ivy', { subject: 'sub-ivy-secret', email: 'ivy@studio.dev' });
      const inbox = async () => (await notificationsRepo(h.meta).listForUser(people['admin']!.id)).filter((one) => one.kind === 'accounts.secret-ending');
      const before = (await inbox()).length;

      expect((await putApp({ clientId: 'client-1', secretEndsOn: day(90) })).statusCode).toBe(200);
      expect((await staff('admin', 'GET', `/add-ons/${KEY}/connect/accounts`)).json()).toMatchObject({ secretEndsOn: day(90) });
      await engine().sweep();
      expect((await inbox()).length).toBe(before);

      expect((await putApp({ clientId: 'client-1', secretEndsOn: day(10) })).statusCode).toBe(200);
      await engine().sweep();
      await engine().sweep();
      const told = await inbox();
      expect(told.length).toBe(before + 1);
      expect(told[0]!.title).toContain(day(10));

      // The same date saved again is not news; a new secret has no date until one is given.
      expect((await putApp({ clientId: 'client-1', secretEndsOn: day(10) })).statusCode).toBe(200);
      await engine().sweep();
      expect((await inbox()).length).toBe(before + 1);
      expect((await putApp({ clientId: 'client-1', clientSecret: 'client-secret-1b' })).statusCode).toBe(200);
      expect((await staff('admin', 'GET', `/add-ons/${KEY}/connect/accounts`)).json()).toMatchObject({ secretEndsOn: null });
      expect((await putApp({ clientId: 'client-1', clientSecret: 'client-secret-1' })).statusCode).toBe(200);
    });

    it('OUT-11: an install cannot lose its registration while people are connected through it', async () => {
      const reply = await app.inject({ method: 'DELETE', url: `/api/v1/add-ons/${KEY}/connect`, headers: { cookie: cookies['admin']! } });
      expect(reply.statusCode).toBe(422);
      expect(JSON.stringify(reply.json())).toContain('accounts');
    });
  });
}

describe('what an add-on declares', () => {
  const withConnect = (connect: Record<string, unknown>) => {
    const manifest = addOnManifest();
    return validateManifest({ ...manifest, addOn: { ...manifest.addOn, connect: { ...manifest.addOn.connect, ...connect } } });
  };

  it('takes the full connected-accounts block', () => {
    expect(withConnect({}).ok).toBe(true);
  });

  it.each([
    ['a parameter Adminium writes itself', { authorizeParams: { client_id: 'mine' } }],
    ['a required scope it does not ask for', { requiredScopes: ['other'] }],
    ['a tenant slot in one address only', { tokenUrl: 'https://auth.cal.example/token' }],
    ['a tenant slot with no default', { tenant: undefined }],
    ['no way to read who connected', { identity: undefined }],
  ])('refuses %s', (_what, connect) => {
    expect(withConnect(connect).ok).toBe(false);
  });

  it('needs the release that reads it', () => {
    const manifest = addOnManifest();
    expect(validateManifest({ ...manifest, compatibility: { ...manifest.compatibility, minAdminiumVersion: '0.3.70' } }).ok).toBe(false);
  });
});

describe('add-on event handlers across runtime rebuilds (OUT-13)', () => {
  const event = (addOnKey: string, name: string, tag: string) => ({
    addOnKey,
    event: name,
    module: { handle: () => tag },
    http: (() => Promise.reject(new Error('no calls'))) as never,
    credential: () => Promise.resolve(null),
  });
  const run = async (registry: ReturnType<typeof createJobRegistry>, kind: string) =>
    registry.get(kind)!.run({ addOnKey: 'a-key', event: 'e', data: {} }, { progress: () => undefined, log: () => undefined, signal: new AbortController().signal } as never);

  it('survives three rebuilds, with the newest code answering', async () => {
    const registry = createJobRegistry();
    for (const tag of ['one', 'two', 'three']) registerAddOnEventHandlers(registry, [event('a-key', 'order.sent', tag)]);
    expect(await run(registry, addOnEventKind('a-key', 'order.sent'))).toBe('three');
  });

  it('forgets the kind of an add-on that went, and leaves the engine\'s own', () => {
    const registry = createJobRegistry();
    registry.registerJobHandler('engine.kind', z.object({}), () => undefined);
    registerAddOnEventHandlers(registry, [event('a-key', 'order.sent', 'one')]);
    registerAddOnEventHandlers(registry, []);
    expect(registry.has(addOnEventKind('a-key', 'order.sent'))).toBe(false);
    expect(registry.has('engine.kind')).toBe(true);
  });

  it('takes a key and an event of the longest lengths, as two different kinds', () => {
    const registry = createJobRegistry();
    const key = `a${'b'.repeat(79)}`;
    const names = [`${'e'.repeat(79)}1`, `${'e'.repeat(79)}2`];
    expect(registerAddOnEventHandlers(registry, names.map((name) => event(key, name, name))).registered).toHaveLength(2);
    expect(new Set(names.map((name) => addOnEventKind(key, name))).size).toBe(2);
    for (const name of names) expect(addOnEventKind(key, name).length).toBeLessThanOrEqual(60);
  });

  it('leaves a short kind as it always was, since queued jobs name it', () => {
    expect(addOnEventKind('shipping-dhl', 'order.sent')).toBe('add-on:shipping-dhl:order.sent');
  });
});

describe('the pieces', () => {
  const spec: AccountSpec = {
    key: KEY,
    per: 'row',
    authorizeUrl: 'https://login.example/{tenant}/authorize',
    tokenUrl: 'https://login.example/{tenant}/token',
    revokeUrl: null,
    scopes: [],
    requiredScopes: [],
    authorizeParams: {},
    identity: { subject: 'sub', address: ['email', 'preferred_username'] },
    tenantDefault: 'common',
    allow: ['login.example'],
  };

  it('PRV-5: fills the tenant, and never lets it become a path', () => {
    expect(endpointsFor(spec, { tenant: null }).tokenUrl).toBe('https://login.example/common/token');
    expect(endpointsFor(spec, { tenant: 'contoso.onmicrosoft.com' }).authorizeUrl).toBe('https://login.example/contoso.onmicrosoft.com/authorize');
    for (const bad of ['../evil', 'a/b', 'a?x=1', 'a#b', '']) expect(() => endpointsFor(spec, { tenant: bad })).toThrow();
  });

  it('PRV-3: reads who connected from the ID token, for this client only', () => {
    const token = (claims: Record<string, unknown>) => idToken({ aud: 'client-1', ...claims });
    expect(identityOf(spec, token({ sub: 's1', email: 'a@b.example' }), 'client-1')).toEqual({ subject: 's1', address: 'a@b.example' });
    expect(identityOf(spec, token({ sub: 's1', preferred_username: 'a@b.example' }), 'client-1')?.address).toBe('a@b.example');
    expect(identityOf(spec, token({ sub: 's1', email: 'a@b.example', email_verified: false }), 'client-1')).toEqual({ subject: 's1', address: null });
    expect(identityOf(spec, token({ sub: 's1' }), 'another-client')).toBeNull();
    expect(identityOf(spec, token({ email: 'a@b.example' }), 'client-1')).toBeNull();
    expect(identityOf(spec, null, 'client-1')).toBeNull();
    expect(identityOf(spec, 'not-a-token', 'client-1')).toBeNull();
  });

  it('PRV-9: compares scopes the way providers echo them', () => {
    expect(missingScopes(['Calendars.ReadWrite'], ['openid', 'https://graph.microsoft.com/calendars.readwrite'])).toEqual([]);
    expect(missingScopes(['a', 'b'], ['a'])).toEqual(['b']);
    expect(missingScopes(['a'], null)).toEqual([]);
  });

  it('OUT-8: says what this address allows', () => {
    const at = (publicOrigin: string | null, extra: { desktop?: boolean; forwarded?: boolean } = {}) =>
      connectReachOf(reachability({ networkFeatures: true, desktop: extra.desktop ?? false, trustProxy: false, forwarded: extra.forwarded ?? false, publicOrigin }));
    expect(at('https://studio.example.com')).toBe('push');
    expect(at('https://studio.example.com', { forwarded: true })).toBe('poll-only');
    expect(at('https://studio.example.com', { desktop: true })).toBe('cannot-connect');
    expect(at('http://studio.example.com')).toBe('cannot-connect');
    expect(at('https://192.168.1.20')).toBe('cannot-connect');
    expect(at('https://studio.local')).toBe('cannot-connect');
    expect(at(null)).toBe('cannot-connect');
  });

  it('OUT-12: no token name reaches a log, and neither does the code or state of a callback', () => {
    for (const name of ['access_token', 'refresh_token', 'id_token', 'clientSecret', 'client_secret', 'codeVerifier', 'code_verifier', 'clientState']) {
      expect(scrubSecretFields({ [name]: 'the-value' })[name]).not.toBe('the-value');
    }
    const scrubbed = scrubUrlForLog(`${CALLBACK}?code=abc123&state=def456&scope=x`);
    expect(scrubbed).not.toContain('abc123');
    expect(scrubbed).not.toContain('def456');
  });

  it('OUT-5: an export clears sealed tokens, keeps the row, and carries no link or flow', () => {
    const dump = (table: string, columns: string[], rows: unknown[][]): MetaTableDump => ({ table, columns, kinds: {}, rows }) as unknown as MetaTableDump;
    const tables = new Map<string, MetaTableDump>([
      ['adminium_connected_accounts', dump('adminium_connected_accounts', ['id', 'subject', 'payload'], [['cac_1', 'sub', 'enc:v1:sealed']])],
      ['adminium_connect_links', dump('adminium_connect_links', ['id', 'token_hash'], [['clk_1', 'hash']])],
      ['adminium_oauth_flows', dump('adminium_oauth_flows', ['id'], [['ofl_1']])],
    ]);
    const report = sanitizeDump(tables, { kind: 'export', dialect: 'sqlite' });
    expect(tables.get('adminium_connected_accounts')?.rows).toEqual([['cac_1', 'sub', null]]);
    expect(report.droppedTables).toEqual(expect.arrayContaining(['adminium_connect_links', 'adminium_oauth_flows']));
    expect(tables.has('adminium_oauth_flows')).toBe(false);
  });
});
