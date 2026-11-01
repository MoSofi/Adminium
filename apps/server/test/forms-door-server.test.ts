// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE FORMS DOOR ON THE REAL SERVER, over a forms add-on installed on a real
 * database per engine, with its forms in its own table.
 *
 * - A live form is served (its page and what a stranger is shown of it) with
 *   the public API never opened; a draft, a slug nobody has, a form whose
 *   definition no longer parses and every form of an add-on switched off
 *   answer one same "not available", status and body; a closed form says it
 *   is closed.
 * - While the server cannot be reached from outside (no public address, or a
 *   proxy that is not trusted) every page and every call is "not available".
 * - A stranger is never shown what an answer becomes, who is told, or the
 *   hourly cap; the form comes in the language asked, else the browser's,
 *   else its own default.
 * - A named survey has no open link; an anonymous one says it keeps no names.
 * - `/x/` works on a host mapped to an app's customer side, and an app's own
 *   surface never answers for `/x/embed.js` or `/x/assets/`.
 * - The dashboard still refuses every frame but its own; `/x/` leaves that to
 *   its own policy. No `/api/v1/` route answers with credentials for a stranger.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { formDefinitionSchema } from '@adminium/add-on-contracts/forms';
import { paymentSettingsRepo, settingsRepo } from '@adminium/meta';

import { formsAddOn } from '../../../packages/manifest/test/forms-fixture.js';
import { discoverSurfaces } from '../src/cli/surfaces-root.js';
import { composeServer, type ComposedServer } from '../src/compose.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import { PAY_PAGE_DOC, payPageSchema } from '../src/routes/payments/ways.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { ANONYMOUS, FIT_OUT, NAMED, published, SHOWROOM, SHOWROOM_SETTINGS } from './forms-door.helpers.js';
import { makeEnv, TEST_SECRET } from './helpers.js';
import { LEGS } from './invoicing-install.helpers.js';

const PAGE_HTML = '<!doctype html><html><head><title>Form</title></head><body><noscript><p>This form needs JavaScript.</p></noscript><div id="x-root"></div></body></html>';
const DASH_HTML = '<!doctype html><html><body data-app="dashboard"></body></html>';
const CUSTOMER_HTML = '<!doctype html><html><body data-app="clients-customer"></body></html>';
const EMBED = '(function(){window.adminium={};})();';
const CUSTOMER_HOST = 'shop.meridian.example';
const STAFF_HOST = 'desk.meridian.example';
const NAVIGATE = { 'sec-fetch-mode': 'navigate', accept: 'text/html' };

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- a reply read freely

describe.each(LEGS)('the forms door on the real server — %s', (dialect, available) => {
  let h: Harness;
  let composed: ComposedServer;
  let root: string;
  let formsTable = '';

  const get = (url: string, headers: Record<string, string> = {}) => composed.app.inject({ method: 'GET', url, headers: { host: 'forms.meridian.example', ...headers } });
  const insert = async (id: string, slug: string, kind: 'form' | 'survey', state: 'draft' | 'live' | 'closed', publishedAs: string | null) => {
    const { db } = await h.manager.data(h.connectionId);
    await db
      .insertInto(formsTable)
      .values({ id, title: slug, slug, kind, state, definition: '{}', settings: '{}', published: publishedAs } as never)
      .execute();
  };
  const switchOff = (enabled: boolean) => h.inject({ method: 'PATCH', url: '/add-ons/forms', payload: { attachedTo: 'dashboard', enabled } });

  beforeAll(async () => {
    if (!available) return;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageAddOn(formsAddOn(), { bundled: true });
    const added = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'forms', version: '1.0.0', attachTo: ['dashboard'] } });
    expect(added.statusCode, added.body).toBe(200);
    const record = await h.meta.db.selectFrom('adminium_app_tables').select(['tableName']).where('appKey', '=', 'forms').where('ref', '=', 'forms').executeTakeFirstOrThrow();
    formsTable = record.tableName;

    await insert('frm_showroom', 'showroom-visit', 'form', 'live', published(SHOWROOM, SHOWROOM_SETTINGS));
    await insert('frm_draft', 'spring-draft', 'form', 'draft', published(SHOWROOM, SHOWROOM_SETTINGS));
    await insert('frm_closed', 'old-offer', 'form', 'closed', published(SHOWROOM, SHOWROOM_SETTINGS));
    await insert('frm_broken', 'broken', 'form', 'live', JSON.stringify({ definition: { v: 1 }, settings: {} }));
    await insert('frm_fitout', 'fit-out', 'survey', 'live', published(FIT_OUT, ANONYMOUS));
    await insert('frm_named', 'aftercare', 'survey', 'live', published(FIT_OUT, NAMED));

    const settings = settingsRepo(h.meta);
    await settings.set('system.publicOrigin', 'https://forms.meridian.example', { updatedBy: null });
    await settings.set('privacy.businessName', 'Meridian Workplace Ltd', { updatedBy: null });
    await settings.set('privacy.noticeUrl', 'https://www.meridian.example/privacy', { updatedBy: null });
    await settings.set('appearance.accent', 'teal', { updatedBy: null });
    await settings.set('surfaces.domains', { [CUSTOMER_HOST]: { appKey: 'clients', side: 'customer' }, [STAFF_HOST]: { appKey: 'clients', side: 'staff' } }, { updatedBy: null });
    await paymentSettingsRepo(h.meta).set(PAY_PAGE_DOC, payPageSchema, { shopName: 'Meridian', logoFileId: null, contactEmail: 'hello@meridian.example', contactPhone: null, shopCountry: 'GB', showLines: false });

    root = await mkdtemp(join(tmpdir(), 'forms-door-'));
    const dist = join(root, 'dist');
    await mkdir(join(dist, 'x', 'assets'), { recursive: true });
    await writeFile(join(dist, 'index.html'), DASH_HTML);
    await writeFile(join(dist, 'x', 'index.html'), PAGE_HTML);
    await writeFile(join(dist, 'x', 'embed.js'), EMBED);
    await writeFile(join(dist, 'x', 'assets', 'x-abc123.js'), 'console.log(1);');
    for (const side of ['customer', 'staff']) {
      const dir = join(root, 'surfaces', 'clients', side);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'index.html'), side === 'customer' ? CUSTOMER_HTML : CUSTOMER_HTML.replace('customer', 'staff'));
    }

    const runService = createRunService({ meta: h.meta });
    composed = await composeServer({
      // The public API is never opened: a form must not need it.
      env: makeEnv({ ADMINIUM_DATA_DIR: h.dataDir, HOST: '127.0.0.1', ADMINIUM_SECRET: TEST_SECRET, ADMINIUM_CORS_ORIGINS: 'https://studio.meridian.example' }),
      metaStore: { meta: h.meta, url: 'sqlite::memory:', engine: 'sqlite', source: 'embedded', close: async () => Promise.resolve() },
      manager: h.manager,
      runService,
      applyService: createApplyService({ meta: h.meta, runService }),
      allowed: null,
      staticRoot: dist,
      surfaces: discoverSurfaces(join(root, 'surfaces')),
      logger: false,
      telemetry: false,
    });
    await composed.app.ready();
    await composed.addOnsLoaded;
    await composed.jobs.worker.stop();
    composed.jobs.scheduler.stop();
  }, 240_000);

  afterAll(async () => {
    if (!available) return;
    await composed?.app.close();
    await h?.close();
    await rm(root, { recursive: true, force: true });
  });

  it.skipIf(!available)('serves a live form: its page, and what a stranger is shown of it, with the public API never opened', async () => {
    const page = await get('/x/forms/showroom-visit', NAVIGATE);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('<div id="x-root"></div>');
    expect(page.body).toContain('This form needs JavaScript.');
    expect(page.body).toContain('hello@meridian.example');
    expect(page.body).not.toContain('data-app=');

    const shown = await get('/x/forms/api/showroom-visit');
    expect(shown.statusCode).toBe(200);
    const body = shown.json() as Doc;
    expect(body.state).toBe('live');
    expect(body.business).toEqual({ name: 'Meridian', legalName: 'Meridian Workplace Ltd', email: 'hello@meridian.example', privacyNotice: 'https://www.meridian.example/privacy', hasLogo: false });
    expect(body.accent).toBe('teal');
    expect(body.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.form.kind).toBe('form');
    expect(body.form.languages).toEqual(['en-US', 'de-DE', 'ar-EG']);
    expect(body.form.anonymous).toBe(false);
    // The definition comes in one language, and still parses as one: the page checks answers with it.
    expect(formDefinitionSchema.safeParse(body.form.definition).success).toBe(true);
    expect(body.form.definition.title).toEqual({ 'en-US': 'Book a showroom visit' });
    // Not a frame: no website list.
    expect(body).not.toHaveProperty('frameOrigins');
  });

  it.skipIf(!available)('never shows a stranger what an answer becomes, who is told, or the hourly cap', async () => {
    const text = (await get('/x/forms/api/showroom-visit')).body;
    for (const secret of ['becomes', 'enquiries', 'Showroom form', 'tell', 'sales', 'perHour', '57', 'settings']) expect(text, secret).not.toContain(secret);
  });

  it.skipIf(!available)('draws the form in the language asked, else the browser’s, else its own', async () => {
    const asked = (await get('/x/forms/api/showroom-visit?lang=ar-EG', { 'accept-language': 'de-DE' })).json() as Doc;
    expect(asked.form.language).toBe('ar-EG');
    expect(asked.form.definition.title).toEqual({ 'ar-EG': 'Book a showroom visit (AR)' });
    expect(asked.form.definition.languages).toEqual(['ar-EG']);
    const browser = (await get('/x/forms/api/showroom-visit', { 'accept-language': 'fr-FR, de;q=0.8' })).json() as Doc;
    expect(browser.form.language).toBe('de-DE');
    // A language the form is not written in is never picked.
    const unlisted = (await get('/x/forms/api/showroom-visit?lang=zh-CN', { 'accept-language': 'zh-CN' })).json() as Doc;
    expect(unlisted.form.language).toBe('en-US');
  });

  it.skipIf(!available)('a draft, a slug nobody has, a form that no longer parses and a named survey answer one same "not available"', async () => {
    const want = await get('/x/forms/api/no-such-form');
    expect(want.statusCode).toBe(404);
    expect(want.json()).toEqual({ state: 'unavailable', business: (want.json() as Doc).business, accent: 'teal' });
    for (const slug of ['spring-draft', 'broken', 'aftercare', 'Not_A_Slug']) {
      const api = await get(`/x/forms/api/${slug}`);
      expect([api.statusCode, api.body], slug).toEqual([want.statusCode, want.body]);
    }
    const unknownPage = await get('/x/forms/no-such-form', NAVIGATE);
    expect(unknownPage.statusCode).toBe(404);
    expect(unknownPage.body).toContain('This page isn’t available.');
    for (const slug of ['spring-draft', 'broken', 'aftercare']) {
      const page = await get(`/x/forms/${slug}`, NAVIGATE);
      expect([page.statusCode, page.body], slug).toEqual([unknownPage.statusCode, unknownPage.body]);
    }
  });

  it.skipIf(!available)('a closed form says it is closed, with the business to write to', async () => {
    const api = await get('/x/forms/api/old-offer');
    expect(api.statusCode).toBe(200);
    expect(api.json()).toMatchObject({ state: 'closed', business: { email: 'hello@meridian.example' } });
    expect(api.body).not.toContain('Book a showroom visit');
    const page = await get('/x/forms/old-offer', NAVIGATE);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('This form is closed.');
  });

  it.skipIf(!available)('an anonymous survey says it keeps no names; its harder check asks for more work', async () => {
    const shown = (await get('/x/forms/api/fit-out')).json() as Doc;
    expect(shown.form).toMatchObject({ kind: 'survey', anonymous: true, languages: ['en-US'] });
    const harder = (await get('/x/forms/api/fit-out/challenge')).json() as Doc;
    expect(harder.difficulty).toBe(20);
    expect((await get('/x/forms/api/showroom-visit/challenge')).json()).toMatchObject({ difficulty: 16 });
  });

  it.skipIf(!available)('a form of an add-on switched off everywhere is "not available"', async () => {
    const want = await get('/x/forms/api/no-such-form');
    expect((await switchOff(false)).statusCode).toBe(200);
    try {
      // A lookup is kept a few seconds: the server's catalog is asked again past that.
      await new Promise((resolve) => setTimeout(resolve, 5_200));
      const off = await get('/x/forms/api/showroom-visit');
      expect([off.statusCode, off.body]).toEqual([want.statusCode, want.body]);
    } finally {
      expect((await switchOff(true)).statusCode).toBe(200);
    }
    await new Promise((resolve) => setTimeout(resolve, 5_200));
    expect((await get('/x/forms/api/showroom-visit')).statusCode).toBe(200);
  }, 30_000);

  it.skipIf(!available)('while the outside cannot reach the server, every page and call is "not available"', async () => {
    const want = await get('/x/forms/api/no-such-form');
    const settings = settingsRepo(h.meta);
    // A proxy forwards the request and is not trusted: every stranger would look like the proxy.
    const proxied = await get('/x/forms/api/showroom-visit', { 'x-forwarded-for': '203.0.113.9' });
    expect([proxied.statusCode, proxied.body]).toEqual([want.statusCode, want.body]);
    expect((await get('/x/forms/api/showroom-visit/challenge', { 'x-forwarded-for': '203.0.113.9' })).statusCode).toBe(404);
    expect((await get('/x/forms/showroom-visit', { ...NAVIGATE, 'x-forwarded-for': '203.0.113.9' })).statusCode).toBe(404);
    // No public address at all.
    await settings.set('system.publicOrigin', null, { updatedBy: null });
    try {
      const unset = await get('/x/forms/api/showroom-visit');
      expect([unset.statusCode, unset.body]).toEqual([want.statusCode, want.body]);
      expect((await get('/x/forms/api/old-offer')).statusCode).toBe(404);
      const page = await get('/x/forms/showroom-visit', NAVIGATE);
      expect(page.statusCode).toBe(404);
      expect(page.body).toContain('This page isn’t available.');
      expect((await get('/x/api/logo')).statusCode).toBe(404);
      // And nothing is taken: the answer door is kept, and writes nothing.
      const sent = await composed.app.inject({ method: 'POST', url: '/x/forms/api/showroom-visit/answers', headers: { host: 'forms.meridian.example', origin: 'https://forms.meridian.example' }, payload: { qname: 'Marta' } });
      expect(sent.statusCode).toBe(404);
    } finally {
      await settings.set('system.publicOrigin', 'https://forms.meridian.example', { updatedBy: null });
    }
    const answers = (await h.meta.db.selectFrom('adminium_app_tables').select('tableName').where('appKey', '=', 'forms').where('ref', '=', 'answers').executeTakeFirstOrThrow()).tableName;
    expect(Number((await h.rows(`SELECT COUNT(*) AS n FROM ${answers}`))[0]!['n'])).toBe(0);
  });

  it.skipIf(!available)('works on a host mapped to an app’s customer side, and no app surface answers for its loader or files', async () => {
    for (const host of [CUSTOMER_HOST, STAFF_HOST]) {
      const page = await get('/x/forms/showroom-visit', { host, ...NAVIGATE });
      expect(page.statusCode, host).toBe(200);
      expect(page.body, host).toContain('x-root');
      expect((await get('/x/forms/api/showroom-visit', { host })).statusCode, host).toBe(200);
      const loader = await get('/x/embed.js', { host });
      expect([loader.statusCode, loader.body], host).toEqual([200, EMBED]);
      expect((await get('/x/assets/x-abc123.js', { host })).body, host).toBe('console.log(1);');
      const missing = await get('/x/assets/x-missing.js', { host, ...NAVIGATE });
      expect(missing.statusCode, host).toBe(404);
      expect(missing.body, host).not.toContain('data-app=');
      const elsewhere = await get('/x/anything/else', { host, ...NAVIGATE });
      expect(elsewhere.statusCode, host).toBe(404);
      expect(elsewhere.body, host).not.toContain('data-app=');
    }
    // The app's own pages are still the app's.
    expect((await get('/mine', { host: CUSTOMER_HOST, ...NAVIGATE })).body).toContain('clients-customer');
  });

  it.skipIf(!available)('the dashboard still refuses frames from elsewhere; /x/ says it in its own policy, and lets the loader be fetched by any site', async () => {
    const dashboard = await get('/', NAVIGATE);
    expect(dashboard.headers['x-frame-options']).toBe('SAMEORIGIN');
    const page = await get('/x/forms/showroom-visit?frame=1', NAVIGATE);
    expect(page.headers['x-frame-options']).toBeUndefined();
    expect(String(page.headers['content-security-policy'])).toContain("frame-ancestors 'none'");
    const loader = await get('/x/embed.js');
    expect(loader.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(loader.headers['cache-control']).toBe('public, max-age=300');
    expect(loader.headers['content-type']).toBe('text/javascript; charset=utf-8');
  });

  it.skipIf(!available)('no /api/v1/ route, and no call of the door, lets a website read it with the visitor’s credentials', async () => {
    // A website is never an allowed origin: the frame's calls go to its own host. (The CORS plugin says "credentials"
    // on every answer once any origin is configured; without the website's origin beside it, a browser reads nothing.)
    for (const url of ['/api/v1/healthz', '/api/v1/auth/me', '/api/v1/public/challenge?purpose=write', '/x/forms/api/showroom-visit']) {
      const res = await composed.app.inject({ method: 'GET', url, headers: { host: 'forms.meridian.example', origin: 'https://shop.example' } });
      expect(res.headers['access-control-allow-origin'], url).toBeUndefined();
    }
    const allowed = await composed.app.inject({ method: 'GET', url: '/api/v1/healthz', headers: { origin: 'https://studio.meridian.example' } });
    expect(allowed.headers['access-control-allow-origin']).toBe('https://studio.meridian.example');
  });

  it.skipIf(!available)('a frame of a form asks which websites it may answer, and is told none until the owner lists one', async () => {
    const shown = (await get('/x/forms/api/showroom-visit?frame=1')).json() as Doc;
    expect(shown.frameOrigins).toEqual([]);
  });
});
