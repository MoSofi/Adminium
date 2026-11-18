// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE PAGES DOOR ON THE REAL SERVER: a landing pages add-on and a forms
 * add-on installed beside the dashboard, on SQLite, Postgres and MySQL, their
 * pages written by a person who may change them (never the admin alone),
 * through the routes the add-on's kit uses.
 *
 *  - A live page is served with the head the server writes (its language,
 *    title, description, sharing tags and canonical address); its data read
 *    says what the bundle draws, its forms in the page's language, and counts
 *    one view. On its canonical host it may be indexed; on any other it is not.
 *  - A draft, a page switched off, an unknown slug, a reserved one, a copy that
 *    no longer parses or carries a mark, a package nobody vouches for, an
 *    add-on switched off, an unset privacy notice and an unreachable server
 *    all answer one same "not available".
 *  - A preview draws the draft, marks and all, for someone who reads the
 *    pages; it is never indexed, and counts nothing.
 *  - A picture is served only while the live page that owns it names it.
 *  - The staff routes: a picture kept as the page's cleaned copy, the
 *    refusals in words; the status read; the home picker lists live pages.
 */
import { filesRepo, permissionsRepo, rolesRepo, settingsRepo, usersRepo, viewDaysRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { formsAddOn } from '../../../packages/manifest/test/forms-fixture.js';
import { landingAddOn } from '../../../packages/manifest/test/landing-fixture.js';
import { recordDeciderTrust } from '../src/add-ons/decider-trust.js';
import { composeServer, type ComposedServer } from '../src/compose.js';
import { PAGE_CACHE_MS } from '../src/landing/catalog.js';
import { PICTURE_REFUSED_WORDS } from '../src/landing/pictures.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import { createPublicViews } from '../src/public-api/runtime.js';
import { matrixRowsFromGrants } from '../src/rbac/permissions.js';
import { PAY_PAGE_DOC, payPageSchema } from '../src/routes/payments/ways.js';
import { paymentSettingsRepo } from '@adminium/meta';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { adminPasswordHash, ADMIN_PASSWORD, sessionCookie } from './auth-helpers.js';
import { ANONYMOUS, FIT_OUT, NAMED, published, SHOWROOM, SHOWROOM_SETTINGS } from './forms-door.helpers.js';
import { makeEnv, TEST_SECRET } from './helpers.js';
import { LEGS } from './invoicing-install.helpers.js';
import { png } from './picture-images.js';
import { VIEW_COUNTS_FLUSH_NAME } from '../src/views/wiring.js';

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- a reply read freely

const PUBLIC = 'forms.meridian.example';
const PAGES = 'pages.meridian.example';
const EVENTS = 'events.meridian.example';
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const PAGE_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="robots" content="noindex, nofollow" />
    <title>Form</title>
  </head>
  <body>
    <noscript><p><strong>This form needs JavaScript.</strong></p></noscript>
    <div id="x-root"></div>
  </body>
</html>
`;

/** A clean page document, with the file ids its pictures name. */
function doc(title: string, more: Doc = {}): Doc {
  return { v: 1, title, description: `${title}: come and see.`, blocks: [{ id: 'hero', kind: 'hero', heading: title, text: 'Thursday 18 September, 10:00 to 19:00.' }], ...more };
}

describe.each(LEGS)('the pages door on the real server — %s', (dialect, available) => {
  let h: Harness;
  let composed: ComposedServer;
  let root: string;
  let pagesId = '';
  let pagesTable = '';
  let formsTable = '';
  const keys: Record<string, number> = {};
  const files: Record<string, string> = {};
  const cookies: Record<string, string> = {};
  let signIns = 0;

  let seq = 0;
  let installId = '';
  /** A stranger's request, from a browser, each from an address of its own (a view is counted once per address and page). */
  const get = (url: string, host = PUBLIC, headers: Record<string, string> = {}) => {
    seq += 1;
    return composed.app.inject({ method: 'GET', url, remoteAddress: `198.51.100.${String(seq % 250)}`, headers: { host, 'user-agent': CHROME, ...headers } });
  };
  /** The views a page has, once what was counted is written. */
  const viewsOf = async (slug: string): Promise<number> => {
    await composed.jobs.scheduler.trigger(VIEW_COUNTS_FLUSH_NAME);
    return (await viewDaysRepo(h.meta).read({ installId, kind: 'page', things: [String(keys[slug])], from: '2000-01-01', to: '2099-12-31' })).reduce((sum, row) => sum + row.views, 0);
  };
  const as = (who: string, method: 'GET' | 'POST' | 'PATCH' | 'PUT', url: string, payload?: unknown, headers: Record<string, string> = {}) =>
    composed.app.inject({ method, url, headers: { host: PUBLIC, cookie: cookies[who]!, ...headers }, ...(payload === undefined ? {} : { payload: payload as Doc }) });
  const data = (who: string, method: 'POST' | 'PATCH', key: number | null, values: Doc) => as(who, method, `/api/v1/data/${h.connectionId}/${pagesId}${key === null ? '' : `/${String(key)}`}`, { values });
  /** A picture for a page, kept by the staff route: its bytes as the body. */
  const picture = (who: string, page: string, bytes: Buffer, type = 'image/png') =>
    composed.app.inject({ method: 'POST', url: `/api/v1/landing/landing-pages/pictures?page=${String(keys[page])}&filename=photo.png`, headers: { host: PUBLIC, cookie: cookies[who]!, 'content-type': type }, payload: bytes });
  /** Write a page row past the seal, as a hand edit of the database would. */
  const byHand = async (key: number, values: Doc) => {
    const { db } = await h.manager.data(h.connectionId);
    await db.updateTable(pagesTable).set(values as never).where('id' as never, '=', key as never).execute();
  };

  /** Someone with these grants, signed in. */
  async function person(key: string, grants: string[]): Promise<void> {
    const user = await usersRepo(h.meta).create({ email: `${key}@meridian.example`, name: key, passwordHash: await adminPasswordHash() });
    const role = await rolesRepo(h.meta).create({ slug: `pages-${key}`, name: `Pages ${key}` });
    for (const one of matrixRowsFromGrants(grants).rows) await permissionsRepo(h.meta).grant(role.id, one.resourceKind, one.resourceRef, one.actions as never);
    await rolesRepo(h.meta).assignToUser(user.id, role.id);
    signIns += 1;
    const res = await composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: `10.8.${String(Math.floor(signIns / 250))}.${String(signIns % 250)}`, payload: { email: `${key}@meridian.example`, password: ADMIN_PASSWORD } });
    expect(res.statusCode, res.body).toBe(200);
    cookies[key] = sessionCookie(res.headers['set-cookie']);
  }

  /** A new page, as a draft, through the data routes; answers its key. */
  async function draft(slug: string, values: Doc = {}): Promise<number> {
    const made = await data('pat', 'POST', null, { name: `Page ${slug}`, slug, state: 'draft', language: 'en-US', draft: doc(slug), updated_at: '2026-11-18T09:00:00.000Z', ...values });
    expect(made.statusCode, made.body).toBeLessThan(300);
    keys[slug] = Number((made.json() as Doc).data.id);
    return keys[slug]!;
  }

  /** Put a page live, through the seal. */
  async function publish(slug: string, document: Doc): Promise<void> {
    const res = await data('pat', 'PATCH', keys[slug]!, { state: 'live', published: document });
    expect(res.statusCode, res.body).toBe(200);
  }

  beforeAll(async () => {
    if (!available) return;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageAddOn(formsAddOn(), { bundled: true });
    await h.stageAddOn(landingAddOn(), { bundled: true });
    // A second landing add-on uploaded by hand: installed, never vouched for.
    await h.stageAddOn({ ...landingAddOn(), key: 'hand-pages', name: 'Hand pages' }, { bundled: true });
    for (const key of ['forms', 'landing-pages', 'hand-pages']) {
      const added = await h.inject({ method: 'POST', url: '/add-ons', payload: { key, version: '1.0.0', attachTo: ['dashboard'] } });
      expect(added.statusCode, added.body).toBe(200);
    }
    for (const key of ['forms', 'landing-pages']) await recordDeciderTrust(h.meta, { key, version: '1.0.0', integrity: (await h.addOnStore.verifyTree(key, '1.0.0')).integrity });
    for (const record of await h.meta.db.selectFrom('adminium_app_tables').select(['appKey', 'ref', 'tableName']).execute()) {
      if (record.appKey === 'landing-pages' && record.ref === 'pages') pagesTable = record.tableName;
      if (record.appKey === 'forms' && record.ref === 'forms') formsTable = record.tableName;
    }
    const { db } = await h.manager.data(h.connectionId);
    for (const [id, slug, kind, definition, settings] of [
      ['frm_showroom', 'showroom-visit', 'form', SHOWROOM, SHOWROOM_SETTINGS],
      ['frm_fitout', 'fit-out', 'survey', FIT_OUT, ANONYMOUS],
      ['frm_named', 'aftercare', 'survey', FIT_OUT, NAMED],
    ] as const) {
      await db.insertInto(formsTable).values({ id, title: slug, slug, kind, state: 'live', definition: '{}', settings: '{}', published: published(definition, settings) } as never).execute();
    }

    const settings = settingsRepo(h.meta);
    await settings.set('system.publicOrigin', `https://${PUBLIC}`, { updatedBy: null });
    await settings.set('privacy.businessName', 'Meridian Workplace Ltd', { updatedBy: null });
    await settings.set('privacy.noticeUrl', 'https://www.meridian.example/privacy', { updatedBy: null });
    // Saved pages first: by name, events comes first all the same.
    await settings.set('surfaces.pageHosts', { [PAGES]: { home: '/x/pages/open-day' }, [EVENTS]: { home: '/x/forms/showroom-visit' } }, { updatedBy: null });
    await paymentSettingsRepo(h.meta).set(PAY_PAGE_DOC, payPageSchema, { shopName: 'Meridian', logoFileId: null, contactEmail: 'hello@meridian.example', contactPhone: null, shopCountry: 'GB', showLines: false });

    root = await mkdtemp(join(tmpdir(), 'pages-door-'));
    await mkdir(join(root, 'dist', 'x', 'assets'), { recursive: true });
    await writeFile(join(root, 'dist', 'index.html'), '<!doctype html><html><body data-app="dashboard"></body></html>');
    await writeFile(join(root, 'dist', 'x', 'index.html'), PAGE_HTML);

    const runService = createRunService({ meta: h.meta });
    composed = await composeServer({
      env: makeEnv({ ADMINIUM_DATA_DIR: h.dataDir, HOST: '127.0.0.1', ADMINIUM_SECRET: TEST_SECRET }),
      metaStore: { meta: h.meta, url: 'sqlite::memory:', engine: 'sqlite', source: 'embedded', close: async () => Promise.resolve() },
      manager: h.manager,
      runService,
      applyService: createApplyService({ meta: h.meta, runService }),
      allowed: null,
      staticRoot: join(root, 'dist'),
      logger: false,
      telemetry: false,
    });
    await composed.app.ready();
    await composed.addOnsLoaded;
    await composed.jobs.worker.stop();
    composed.jobs.scheduler.stop();
    pagesId = (await createPublicViews(h.meta).viewFor(h.connectionId))!.table(pagesTable).id;
    installId = (await h.meta.db.selectFrom('adminium_manifests').select(['id']).where('manifestKey', '=', 'landing-pages').executeTakeFirstOrThrow()).id;
    const t = (...actions: string[]) => actions.map((action) => `table:${h.connectionId}:${pagesId}:${action}`);
    // Pat writes pages, as the add-on's page editor does; Rae only reads them; Lib also keeps the Files library; Ops maps hosts.
    await person('pat', t('read', 'create', 'update'));
    await person('rae', t('read'));
    await person('lib', [...t('read', 'update'), 'system:files:manage']);
    await person('ops', ['system:settings:manage', 'system:privacy:manage']);
    await person('sam', []);

    for (const slug of ['open-day', 'thanks', 'yawm', 'spring-draft', 'switched-off', 'broken', 'marked', 'login']) await draft(slug, slug === 'yawm' ? { language: 'ar-EG' } : {});
    // The pictures, kept as each page's own copies.
    for (const [name, page] of [['hero', 'open-day'], ['share', 'open-day'], ['spare', 'open-day'], ['thanks', 'thanks']] as const) {
      const kept = await picture('pat', page, png({ exif: true }).bytes);
      expect(kept.statusCode, kept.body).toBe(201);
      files[name] = (kept.json() as Doc).data.id;
    }
    await publish('thanks', doc('Thank you', { picture: { file: files['thanks'], alt: 'Our showroom' } }));
    await publish('open-day', {
      ...doc('Open day at our Leeds showroom'),
      picture: { file: files['share'], decorative: true },
      blocks: [
        { id: 'hero', kind: 'hero', heading: 'Open day', text: 'Thursday 18 September.', picture: { file: files['hero'], alt: 'The showroom' }, button: { label: 'Book', link: { kind: 'form' } } },
        // Another page's own picture, named here: never served for this page.
        { id: 'other', kind: 'picture', picture: { file: files['thanks'], alt: 'Theirs' } },
        { id: 'book', kind: 'form', form: 'frm_showroom', addOn: 'forms' },
        { id: 'survey', kind: 'form', form: 'frm_named', addOn: 'forms' },
        { id: 'next', kind: 'button', label: 'After', link: { kind: 'page', key: String(keys['thanks']) } },
        { id: 'later', kind: 'button', label: 'Later', link: { kind: 'page', key: String(keys['spring-draft']) } },
      ],
    });
    await publish('yawm', { ...doc('يوم مفتوح'), blocks: [{ id: 'book', kind: 'form', form: 'frm_showroom', addOn: 'forms' }, { id: 'fit', kind: 'form', form: 'frm_fitout', addOn: 'forms' }] });
    await publish('switched-off', doc('Old offer'));
    expect((await data('pat', 'PATCH', keys['switched-off']!, { state: 'off' })).statusCode).toBe(200);
    await data('pat', 'PATCH', keys['spring-draft']!, { draft: { ...doc('Spring draft'), blocks: [{ id: 'h', kind: 'heading', text: 'Spring', milo: true }] } });
    // Past the seal, by hand: a copy that does not parse, and one that carries a mark.
    await byHand(keys['broken']!, { state: 'live', published: JSON.stringify({ v: 1, title: 'Broken' }) });
    await byHand(keys['marked']!, { state: 'live', published: JSON.stringify({ ...doc('Marked'), blocks: [{ id: 'h', kind: 'heading', text: 'Mine', milo: true }] }) });
    // A sign-in-like address, live by hand: a page there is never drawn.
    await byHand(keys['login']!, { state: 'live', published: JSON.stringify(doc('Sign in')) });
  }, 300_000);

  afterAll(async () => {
    if (!available) return;
    await composed?.app.close();
    await h?.close();
    await rm(root, { recursive: true, force: true });
  });

  it.skipIf(!available)('serves a live page with the head the server writes, indexable on its canonical host alone', async () => {
    const before = await viewsOf('open-day');
    const page = await get('/x/pages/open-day', PAGES);
    expect(page.statusCode, page.body).toBe(200);
    expect(page.body).toContain('<html lang="en-US" dir="ltr">');
    expect(page.body).toContain('<title>Open day at our Leeds showroom</title>');
    expect(page.body).toContain('<meta name="description" content="Open day at our Leeds showroom: come and see." />');
    expect(page.body).toContain('<meta property="og:url" content="https://pages.meridian.example/x/pages/open-day" />');
    expect(page.body).toContain(`<meta property="og:image" content="https://pages.meridian.example/x/pages/api/open-day/pictures/${files['share']!}" />`);
    expect(page.body).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(page.body).toContain('<link rel="canonical" href="https://pages.meridian.example/x/pages/open-day" />');
    expect(page.body).toContain('This page needs JavaScript.');
    // On its canonical host (the pages host whose home it is): no noindex, in the header or the page.
    expect(page.headers['x-robots-tag']).toBeUndefined();
    expect(page.body).not.toContain('name="robots"');
    expect(page.headers['content-security-policy']).toContain("trusted-types 'none'");
    expect(page.headers['cross-origin-opener-policy']).toBe('same-origin');
    // The HTML is no view: a link preview fetches it too.
    expect(await viewsOf('open-day')).toBe(before);

    // The same page on the public address, and on another pages host: noindex, naming the canonical address.
    for (const host of [PUBLIC, EVENTS]) {
      const elsewhere = await get('/x/pages/open-day', host);
      expect(elsewhere.statusCode, host).toBe(200);
      expect(elsewhere.headers['x-robots-tag'], host).toBe('noindex');
      expect(elsewhere.body, host).toContain('<meta name="robots" content="noindex, nofollow" />');
      expect(elsewhere.body, host).toContain('<link rel="canonical" href="https://pages.meridian.example/x/pages/open-day" />');
    }
    // A page that is no host's home is canonical on the first pages host by name, whatever order the hosts were saved in.
    const thanks = await get('/x/pages/thanks', EVENTS);
    expect(thanks.body).toContain('<link rel="canonical" href="https://events.meridian.example/x/pages/thanks" />');
    expect(thanks.body).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(thanks.headers['x-robots-tag']).toBeUndefined();
    // Right to left, for a page in Arabic.
    expect((await get('/x/pages/yawm', EVENTS)).body).toContain('<html lang="ar-EG" dir="rtl">');
    // The pages host's `/` goes to its home.
    const home = await get('/', PAGES, { accept: 'text/html' });
    expect(home.statusCode).toBe(302);
    expect(home.headers.location).toBe('/x/pages/open-day');
  });

  it.skipIf(!available)('answers the page\'s data: its document, its forms in its language, its pictures and links; and counts one view', async () => {
    const before = await viewsOf('open-day');
    const res = await get('/x/pages/api/open-day');
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as Doc;
    expect(body).toMatchObject({ state: 'live', key: String(keys['open-day']), language: 'en-US', dir: 'ltr', business: { legalName: 'Meridian Workplace Ltd' } });
    expect(body.page.title).toBe('Open day at our Leeds showroom');
    expect(body.forms.forms.frm_showroom).toMatchObject({ slug: 'showroom-visit', form: { language: 'en-US' } });
    expect(body.forms.forms.frm_showroom.form.definition.title).toEqual({ 'en-US': 'Book a showroom visit' });
    expect(body.forms.forms.frm_showroom.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // A named survey opens by invitation alone: never on a page.
    expect(body.forms.forms.frm_named).toBeNull();
    // What an answer becomes is never shown.
    expect(JSON.stringify(body)).not.toContain('enquiries');
    expect(body.pictures).toEqual({
      [files['share']!]: `/x/pages/api/open-day/pictures/${files['share']!}`,
      [files['hero']!]: `/x/pages/api/open-day/pictures/${files['hero']!}`,
      [files['thanks']!]: `/x/pages/api/open-day/pictures/${files['thanks']!}`,
    });
    expect(body.links).toEqual({ [String(keys['thanks'])]: '/x/pages/thanks', [String(keys['spring-draft'])]: null });
    expect(await viewsOf('open-day')).toBe(before + 1);
    // At "Counts only" the data says nothing of a visitor: no banner.
    expect(body).not.toHaveProperty('visitor');
    // Read back by whoever reads the pages; refused to who does not.
    const views = await as('rae', 'GET', `/api/v1/views?installId=${installId}&kind=page&things=${String(keys['open-day'])}&from=2000-01-01&to=2000-12-31`);
    expect(views.statusCode, views.body).toBe(200);
    expect((await as('sam', 'GET', `/api/v1/views?installId=${installId}&kind=page&things=${String(keys['open-day'])}&from=2000-01-01&to=2000-12-31`)).statusCode).toBe(403);

    // In Arabic: the form's Arabic version; a form not written in Arabic is left out.
    const yawm = (await get('/x/pages/api/yawm')).json() as Doc;
    expect(yawm).toMatchObject({ language: 'ar-EG', dir: 'rtl' });
    expect(yawm.forms.forms.frm_showroom.form).toMatchObject({ language: 'ar-EG' });
    expect(yawm.forms.forms.frm_fitout).toBeNull();
  });

  it.skipIf(!available)('answers one same "not available" for a draft, a page switched off, an unknown or reserved slug, a copy that does not parse or carries a mark', async () => {
    const unavailable = (await get('/x/pages/api/nobody-has-this')).body;
    expect(JSON.parse(unavailable)).toMatchObject({ state: 'unavailable', business: { legalName: 'Meridian Workplace Ltd' } });
    for (const slug of ['nobody-has-this', 'spring-draft', 'switched-off', 'broken', 'marked', 'api', 'login', 'Open-Day']) {
      const api = await get(`/x/pages/api/${slug}`);
      expect(api.statusCode, slug).toBe(404);
      expect(api.body, slug).toBe(unavailable);
      const page = await get(`/x/pages/${slug}`, PAGES);
      expect(page.statusCode, slug).toBe(404);
      expect(page.headers['x-robots-tag'], slug).toBe('noindex');
      expect(page.body, slug).toContain('This page isn’t available.');
      expect(page.body, slug).not.toContain('og:');
    }
    // Deeper than a page: the forms door's "not available".
    expect((await get('/x/pages/open-day/more')).statusCode).toBe(404);
    for (const slug of ['spring-draft', 'switched-off', 'broken', 'marked', 'login']) expect(await viewsOf(slug), slug).toBe(0);
  });

  it.skipIf(!available)('never serves a page of a package nobody vouches for', async () => {
    const handTable = (await h.meta.db.selectFrom('adminium_app_tables').select(['tableName']).where('appKey', '=', 'hand-pages').where('ref', '=', 'pages').executeTakeFirstOrThrow()).tableName;
    const { db } = await h.manager.data(h.connectionId);
    await db
      .insertInto(handTable)
      .values({ id: 1, name: 'Hand', slug: 'hand-made', state: 'live', language: 'en-US', draft: JSON.stringify(doc('Hand')), published: JSON.stringify(doc('Hand')), updated_at: '2026-11-18 09:00:00' } as never)
      .execute();
    expect((await get('/x/pages/api/hand-made')).statusCode).toBe(404);
    expect((await get('/x/pages/hand-made')).statusCode).toBe(404);
    // The vouched add-on's own pages still answer.
    expect((await get('/x/pages/api/thanks')).statusCode).toBe(200);
  });

  it.skipIf(!available)('draws a preview of the draft, marks and all, for someone who reads the pages; never indexed, counting nothing', async () => {
    const before = await viewsOf('thanks');
    for (const who of ['rae', 'pat']) {
      const page = await as(who, 'GET', '/x/pages/spring-draft?preview=1', undefined, { host: PAGES });
      expect(page.statusCode, page.body).toBe(200);
      expect(page.body).toContain('<title>Spring draft</title>');
      expect(page.headers['x-robots-tag']).toBe('noindex');
      expect(page.body).toContain('name="robots"');
      expect(page.body).not.toContain('og:url');
      expect(page.headers['content-security-policy']).toContain("frame-ancestors 'self'");
      const read = await as(who, 'GET', '/x/pages/api/spring-draft?preview=1');
      expect(read.statusCode, read.body).toBe(200);
      expect(read.json()).toMatchObject({ preview: true, page: { title: 'Spring draft', blocks: [{ id: 'h', milo: true }] } });
    }
    // The draft of a live page, not its published copy.
    await data('pat', 'PATCH', keys['thanks']!, { draft: doc('Thanks, rewritten') });
    expect(((await as('rae', 'GET', '/x/pages/api/thanks?preview=1')).json() as Doc).page.title).toBe('Thanks, rewritten');
    // Nobody else: not signed in, or without a read of the pages.
    expect((await get('/x/pages/api/spring-draft?preview=1')).statusCode).toBe(404);
    expect((await as('sam', 'GET', '/x/pages/api/spring-draft?preview=1')).statusCode).toBe(404);
    expect((await as('sam', 'GET', '/x/pages/spring-draft?preview=1')).statusCode).toBe(404);
    expect(await viewsOf('spring-draft')).toBe(0);
    expect(await viewsOf('thanks')).toBe(before);
  });

  it.skipIf(!available)('serves a picture only while the live page that owns it names it', async () => {
    const served = await get(`/x/pages/api/open-day/pictures/${files['hero']!}`);
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('image/png');
    expect(served.headers['content-security-policy']).toBe("default-src 'none'; sandbox");
    expect(served.headers['cache-control']).toBe('public, max-age=300, must-revalidate');
    expect(served.headers['content-disposition']).toBe('inline; filename="picture.png"');
    expect(served.headers['x-robots-tag']).toBe('noindex');
    // The cleaned copy: what the camera wrote beside the picture is gone.
    expect(served.rawPayload.equals(png({ exif: true }).clean)).toBe(true);
    const again = await get(`/x/pages/api/open-day/pictures/${files['hero']!}`, PUBLIC, { 'if-none-match': String(served.headers.etag) });
    expect(again.statusCode).toBe(304);
    // On the pages host too (the address `og:image` names).
    expect((await get(`/x/pages/api/open-day/pictures/${files['share']!}`, PAGES)).statusCode).toBe(200);

    // The page's own file its document does not name; another page's file it names; a file of Files; an SVG; a `data:` address.
    const upload = await as('lib', 'POST', `/api/v1/files?filename=plan.png&connectionId=${h.connectionId}`, png().bytes, { 'content-type': 'image/png' });
    expect(upload.statusCode, upload.body).toBe(201);
    const svg = await filesRepo(h.meta).create({ filename: 'x.svg', mime: 'image/svg+xml', sizeBytes: 10, sha256: 'a'.repeat(64), kind: 'landing', entity: { connectionId: h.connectionId, table: pagesId, pk: { id: keys['open-day'] }, label: String(keys['open-day']) }, attachedAt: Date.now() });
    for (const file of [files['spare']!, files['thanks']!, (upload.json() as Doc).data.id as string, svg.id, 'data:image/png;base64,AAAA', 'file_00000000000000000000000000']) {
      expect((await get(`/x/pages/api/open-day/pictures/${encodeURIComponent(file)}`)).statusCode, file).toBe(404);
    }
    // Its own page serves the other page's picture; a draft, or a page switched off, serves none.
    expect((await get(`/x/pages/api/thanks/pictures/${files['thanks']!}`)).statusCode).toBe(200);
    expect((await get(`/x/pages/api/spring-draft/pictures/${files['hero']!}`)).statusCode).toBe(404);
    expect((await get(`/x/pages/api/switched-off/pictures/${files['hero']!}`)).statusCode).toBe(404);
  });

  it.skipIf(!available)('keeps a picture as the page\'s cleaned copy, refusing an SVG and a 6 MB file in words', async () => {
    // A Files picture the person may read: copied, cleaned, the page's own.
    const upload = await as('lib', 'POST', `/api/v1/files?filename=team.png&connectionId=${h.connectionId}`, png({ exif: true }).bytes, { 'content-type': 'image/png' });
    expect(upload.statusCode, upload.body).toBe(201);
    const fileId = (upload.json() as Doc).data.id as string;
    const copied = await as('lib', 'POST', `/api/v1/landing/landing-pages/pictures?page=${String(keys['open-day'])}`, { file: fileId });
    expect(copied.statusCode, copied.body).toBe(201);
    const copy = (copied.json() as Doc).data;
    expect(copy).toMatchObject({ mime: 'image/png' });
    expect(copy.id).not.toBe(fileId);
    const row = (await filesRepo(h.meta).findById(copy.id))!;
    expect(row).toMatchObject({ kind: 'landing', entityConnectionId: h.connectionId, entityTable: pagesId, entityId: String(keys['open-day']) });
    expect(row.attachedAt).not.toBeNull();
    // Someone who may not read that file of Files gets nothing of it, as if it were not there.
    const refusedCopy = await as('pat', 'POST', `/api/v1/landing/landing-pages/pictures?page=${String(keys['open-day'])}`, { file: fileId });
    expect(refusedCopy.statusCode, refusedCopy.body).toBe(404);
    // Who only reads the pages adds no picture; nor to a page that is not there.
    expect((await picture('rae', 'open-day', png().bytes)).statusCode).toBe(403);
    expect((await composed.app.inject({ method: 'POST', url: '/api/v1/landing/landing-pages/pictures?page=99999', headers: { host: PUBLIC, cookie: cookies['pat']!, 'content-type': 'image/png' }, payload: png().bytes })).statusCode).toBe(404);

    // An SVG, and a file past 5 MB: refused, in the editor's words.
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const large = Buffer.concat([png().bytes, Buffer.alloc(6 * 1024 * 1024)]);
    for (const [bytes, type] of [[svg, 'image/svg+xml'], [large, 'image/png'], [Buffer.from('not a picture'), 'application/octet-stream']] as const) {
      const res = await picture('pat', 'open-day', bytes, type);
      expect(res.statusCode, res.body.slice(0, 200)).toBe(422);
      expect((res.json() as Doc).error.message).toBe(PICTURE_REFUSED_WORDS);
      expect((res.json() as Doc).error.details.reason).toBe('picture-refused');
    }
    expect(PICTURE_REFUSED_WORDS).toBe('This file can’t be used. Use a PNG, JPEG, WebP or GIF of up to 5 MB.');

    // The editor's canvas reads a page's own picture; not another page's, and not without a read of the pages.
    const canvas = await as('rae', 'GET', `/api/v1/landing/landing-pages/pictures/${files['hero']!}?page=${String(keys['open-day'])}`);
    expect(canvas.statusCode).toBe(200);
    expect(canvas.headers['content-type']).toBe('image/png');
    expect(canvas.headers['access-control-allow-origin']).toBeUndefined();
    expect((await as('rae', 'GET', `/api/v1/landing/landing-pages/pictures/${files['thanks']!}?page=${String(keys['open-day'])}`)).statusCode).toBe(404);
    expect((await as('sam', 'GET', `/api/v1/landing/landing-pages/pictures/${files['hero']!}?page=${String(keys['open-day'])}`)).statusCode).toBe(403);
  });

  it.skipIf(!available)('says where a page answers, and which host it is home of, to who reads the pages', async () => {
    const res = await as('rae', 'GET', `/api/v1/landing/landing-pages/status?page=${String(keys['open-day'])}`);
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as Doc).data).toEqual({
      reach: { state: 'reachable', proxyUnchecked: true },
      notice: true,
      publicOrigin: `https://${PUBLIC}`,
      hosts: [
        { host: EVENTS, home: '/x/forms/showroom-visit' },
        { host: PAGES, home: '/x/pages/open-day' },
      ],
      page: {
        key: String(keys['open-day']),
        slug: 'open-day',
        state: 'live',
        addresses: [
          { host: EVENTS, url: `https://${EVENTS}/x/pages/open-day`, home: false },
          { host: PAGES, url: `https://${PAGES}/x/pages/open-day`, home: true },
          { host: PUBLIC, url: `https://${PUBLIC}/x/pages/open-day`, home: false },
        ],
        canonical: `https://${PAGES}/x/pages/open-day`,
        homeOf: [PAGES],
      },
    });
    expect(((await as('rae', 'GET', '/api/v1/landing/landing-pages/status')).json() as Doc).data.page).toBeNull();
    expect((await as('sam', 'GET', '/api/v1/landing/landing-pages/status')).statusCode).toBe(403);
    expect((await as('rae', 'GET', '/api/v1/landing/nobody/status')).statusCode).toBe(404);
  });

  it.skipIf(!available)('offers live pages as a pages host\'s home, never a draft', async () => {
    const res = await as('ops', 'GET', '/api/v1/surfaces');
    expect(res.statusCode, res.body).toBe(200);
    const homes = (res.json() as Doc).pageHomes as string[];
    expect(homes).toEqual(expect.arrayContaining(['/x/forms/showroom-visit', '/x/pages/open-day', '/x/pages/thanks', '/x/pages/yawm']));
    for (const slug of ['spring-draft', 'switched-off', 'hand-made']) expect(homes, slug).not.toContain(`/x/pages/${slug}`);
  });

  it.skipIf(!available)('at Per visitor, tells a live page\'s data what the banner reads; a preview is told nothing', async () => {
    expect((await as('ops', 'PUT', '/api/v1/privacy/counting', { level: 'visitor' })).statusCode).toBe(200);
    try {
      const page = await get('/x/pages/api/thanks');
      expect(page.headers['set-cookie']).toBeUndefined();
      expect((page.json() as Doc).visitor).toMatchObject({ said: null, banner: { language: 'en-US', yes: 'Yes', no: 'No' } });
      expect((await as('rae', 'GET', '/x/pages/api/thanks?preview=1')).json()).not.toHaveProperty('visitor');
    } finally {
      expect((await as('ops', 'PUT', '/api/v1/privacy/counting', { level: 'counts' })).statusCode).toBe(200);
    }
  });

  it.skipIf(!available)('answers "not available" while the privacy notice is unset, the add-on is switched off, or the outside cannot reach the server', async () => {
    const settings = settingsRepo(h.meta);
    const wait = () => new Promise((resolve) => setTimeout(resolve, PAGE_CACHE_MS + 200));
    await settings.set('privacy.noticeUrl', null as never, { updatedBy: null });
    await wait();
    expect((await get('/x/pages/api/thanks')).statusCode).toBe(404);
    await settings.set('privacy.noticeUrl', 'https://www.meridian.example/privacy', { updatedBy: null });
    await wait();
    expect((await get('/x/pages/api/thanks')).statusCode).toBe(200);
    // Behind a proxy the server does not trust: every stranger would look like the proxy.
    expect((await get('/x/pages/api/thanks', PUBLIC, { 'x-forwarded-for': '203.0.113.9' })).statusCode).toBe(404);
    expect((await get(`/x/pages/api/thanks/pictures/${files['thanks']!}`, PUBLIC, { 'x-forwarded-for': '203.0.113.9' })).statusCode).toBe(404);
  });

  it.skipIf(!available)('stops serving a page and its pictures once it is switched off', async () => {
    expect((await data('pat', 'PATCH', keys['open-day']!, { state: 'off' })).statusCode).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, PAGE_CACHE_MS + 200));
    expect((await get('/x/pages/open-day', PAGES)).statusCode).toBe(404);
    expect((await get('/x/pages/api/open-day')).statusCode).toBe(404);
    expect((await get(`/x/pages/api/open-day/pictures/${files['hero']!}`)).statusCode).toBe(404);
    // It was a host's home: the status read says so, and the picker no longer offers it.
    expect(((await as('rae', 'GET', `/api/v1/landing/landing-pages/status?page=${String(keys['open-day'])}`)).json() as Doc).data.page).toMatchObject({ state: 'off', homeOf: [PAGES] });
    expect(((await as('ops', 'GET', '/api/v1/surfaces')).json() as Doc).pageHomes).not.toContain('/x/pages/open-day');
  });
});
