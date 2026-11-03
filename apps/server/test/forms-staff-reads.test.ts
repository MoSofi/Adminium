// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT A FORMS BUILDER READS FOR ITS STAFF, on SQLite, Postgres and MySQL,
 * over the real server, each read as the person it is for:
 *
 *  - the status read (`GET /api/v1/forms/status`): whether mail goes,
 *    whether strangers can reach the pages (the Privacy page's own answer),
 *    whether the privacy notice is set, the public address, the listed
 *    websites and the roles a form may tell, for a person who may read the
 *    add-on's forms (a marketer holds neither the privacy nor the roles
 *    action); refused to a signed-in person who may not, to an API key and to
 *    nobody signed in; and never an address of a person or a member of a role;
 *  - the kit's facts for the map editor: an enum's values, a text's longest,
 *    the column a form's "Source" goes into, and the page a row it became
 *    opens on, only for a reader who may open that page;
 *  - the preview of a draft (`/x/forms/<slug>?preview=1`): drawn for a
 *    reader of the forms, leniently (a word missing in a language is the
 *    default language's, a question that does not read is left out and
 *    named), framed by this host alone, never cached, not held to whether
 *    strangers can reach the pages; for everyone else exactly a stranger's
 *    "not available"; and nothing is ever sent from it;
 *  - a form whose slug is a word the addresses use is never served.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { apiKeysRepo, pagesRepo, paymentSettingsRepo, permissionsRepo, rolesRepo, settingsRepo, snapshotsRepo, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { formsWithInvitations } from '../../../packages/manifest/test/forms-invitations-fixture.js';
import { recordDeciderTrust } from '../src/add-ons/decider-trust.js';
import { composeServer, type ComposedServer } from '../src/compose.js';
import { xContentPolicy } from '../src/routes/forms-door/index.js';
import { addWebsites } from '../src/forms/websites.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import { generateApiKey } from '../src/rbac/api-keys.js';
import { PAY_PAGE_DOC, payPageSchema } from '../src/routes/payments/ways.js';
import { ADMIN_PASSWORD, adminPasswordHash, sessionCookie } from './auth-helpers.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { shopManifest } from './fixtures/cards-kit/index.js';
import { published, SHOWROOM, SHOWROOM_SETTINGS } from './forms-door.helpers.js';
import { makeEnv, TEST_SECRET } from './helpers.js';
import { LEGS } from './invoicing-install.helpers.js';

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- a reply read freely

const pk = { ref: 'id', type: 'int', role: 'pk' };
const HOST = 'forms.meridian.example';
const ORIGIN = `https://${HOST}`;
const PAGE_HTML = '<!doctype html><html><head><title>Form</title></head><body><noscript><p>This form needs JavaScript.</p></noscript><div id="x-root"></div></body></html>';

/** The shop, opening its enquiries to forms with a source column and a brochure choice, and a page of them. */
function shop(): Doc {
  const base = shopManifest() as Doc;
  return {
    ...base,
    compatibility: { minAdminiumVersion: '0.3.41', engines: ['postgres', 'mysql', 'sqlite'] },
    requiredSchema: {
      ...base['requiredSchema'],
      tables: [
        ...base['requiredSchema'].tables,
        { ref: 'jobs', columns: [pk, { ref: 'title', type: 'text', maxLength: 80 }] },
        {
          ref: 'enquiries',
          label: 'Enquiries',
          columns: [
            pk,
            { ref: 'name', type: 'text', maxLength: 80, label: 'Name' },
            { ref: 'email', type: 'text', maxLength: 254, nullable: true, label: 'E-mail' },
            { ref: 'source', type: 'text', maxLength: 40, nullable: true },
            { ref: 'from_form', type: 'text', maxLength: 200, nullable: true, label: 'From form' },
            { ref: 'brochure', type: 'enum', enum: ['yes', 'no'], nullable: true, label: 'Brochure' },
          ],
        },
        { ref: 'feedback', label: 'Customer feedback', columns: [pk, { ref: 'job_id', type: 'fk', references: 'jobs', unique: true, label: 'Job' }, { ref: 'score', type: 'int', label: 'Score' }] },
      ],
    },
    pages: [
      ...(base['pages'] as Doc[]),
      { ref: 'shop-enquiries', template: 'page-crud', title: { key: 'mft.shop.page.enquiries', fallback: 'Enquiries' }, nav: { group: 'manifest:sample', icon: 'list', order: 2 }, bindings: { main: 'enquiries' } },
    ],
    publicAccess: [
      { table: 'products', methods: ['GET'], select: ['id', 'name', 'price'] },
      { table: 'enquiries', methods: ['POST'], key: 'forms', writable: ['name', 'email', 'source', 'from_form', 'brochure'], source: 'from_form', anonymous: { perKeyHour: 100, plainText: ['name'] } },
      { table: 'feedback', methods: ['POST'], key: 'forms', writable: ['job_id', 'score'], anonymous: { perKeyHour: 100 } },
    ],
  };
}

/** A draft half written: German words missing, and one question that does not read yet. */
const DRAFT = {
  ...SHOWROOM,
  sections: undefined,
  intro: undefined,
  title: { 'en-US': 'Book a showroom visit' },
  questions: [
    { id: 'qname', kind: 'short', role: 'name', required: true, label: { 'en-US': 'Your name', 'de-DE': 'Ihr Name' } },
    { id: 'qcount', kind: 'number', min: 20, max: 1, label: { 'en-US': 'How many of you?' } },
    { id: 'qhalf', kind: 'one', label: { 'en-US': 'Not finished' }, choices: [] },
  ],
  ending: { kind: 'words', words: { 'en-US': 'Thanks.' } },
};

describe.each(LEGS)('what a forms builder reads for its staff — %s', (dialect, available) => {
  let h: Harness;
  let composed: ComposedServer;
  let root: string;
  const cookies = new Map<string, string>();
  const tables = new Map<string, string>();
  const roleIds = new Map<string, string>();
  let bearer = '';
  let enquiriesPage = '';

  const call = (method: 'GET' | 'POST', url: string, as?: string, more: { headers?: Record<string, string>; payload?: unknown } = {}) =>
    composed.app.inject({ method, url, headers: { host: HOST, ...(as === undefined ? {} : { cookie: cookies.get(as)! }), ...(more.headers ?? {}) }, ...(more.payload === undefined ? {} : { payload: more.payload as never }) });
  const answersCount = async () => Number((await h.rows(`SELECT COUNT(*) AS n FROM ${tables.get('answers-name')!}`))[0]!['n']);

  async function person(name: string, grants: 'super-admin' | { tables?: Record<string, Doc>; pages?: string[] }): Promise<void> {
    const user = await usersRepo(h.meta).create({ email: `${name}@forms.dev`, name, passwordHash: await adminPasswordHash() });
    const login = await composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: `10.4.0.${String(cookies.size + 1)}`, headers: { host: HOST }, payload: { email: `${name}@forms.dev`, password: ADMIN_PASSWORD } });
    cookies.set(name, sessionCookie(login.headers['set-cookie']));
    const roles = rolesRepo(h.meta);
    if (grants === 'super-admin') {
      await roles.assignToUser(user.id, (await roles.findBySlug('super-admin'))!.id);
      return;
    }
    const role = await roles.create({ slug: `${name}-role`, name: `${name} role` } as never);
    roleIds.set(name, role.id);
    for (const [ref, actions] of Object.entries(grants.tables ?? {})) {
      await permissionsRepo(h.meta).grant(role.id, 'table', `${h.connectionId}/${tables.get(ref)!}`, { read: false, create: false, update: false, delete: false, export: false, import: false, ...actions } as never);
    }
    for (const page of grants.pages ?? []) await permissionsRepo(h.meta).grant(role.id, 'page', page, { view: true, edit: false } as never);
    await roles.assignToUser(user.id, role.id);
  }

  beforeAll(async () => {
    if (!available) return;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageApp(shop());
    const installed = await h.install('shop', '1.0.0');
    expect(installed.statusCode, installed.body).toBe(200);
    await h.stageAddOn(formsWithInvitations(), { bundled: true });
    const added = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'forms', version: '1.0.0', attachTo: ['shop'] } });
    expect(added.statusCode, added.body).toBe(200);
    await recordDeciderTrust(h.meta, { key: 'forms', version: '1.0.0', integrity: (await h.addOnStore.verifyTree('forms', '1.0.0')).integrity });
    const model = (await snapshotsRepo(h.meta).latest(h.connectionId))!.schema as { tables: { id: string; name: string }[] };
    for (const row of await h.meta.db.selectFrom('adminium_app_tables').select(['appKey', 'ref', 'tableName']).execute()) {
      tables.set(row.ref, model.tables.find((table) => table.name === row.tableName)!.id);
      if (row.appKey === 'forms') tables.set(`${row.ref}-name`, row.tableName);
    }
    enquiriesPage = (await pagesRepo(h.meta).listForConnection(h.connectionId)).find((page) => (page.config as { source?: { table?: string } }).source?.table === tables.get('enquiries'))!.id;

    const { db } = await h.manager.data(h.connectionId);
    const insert = (id: string, slug: string, state: string, definition: unknown, publishedAs: string | null) =>
      db.insertInto(tables.get('forms-name')!).values({ id, title: slug, slug, kind: 'form', state, definition: JSON.stringify(definition), settings: JSON.stringify(SHOWROOM_SETTINGS), published: publishedAs } as never).execute();
    await insert('frm_live', 'showroom-visit', 'live', SHOWROOM, published(SHOWROOM, SHOWROOM_SETTINGS));
    await insert('frm_draft', 'spring-draft', 'draft', DRAFT, null);
    await insert('frm_closed', 'old-offer', 'closed', SHOWROOM, published(SHOWROOM, SHOWROOM_SETTINGS));
    // A slug the addresses use: never a form's, live or not.
    await insert('frm_reserved', 'surveys', 'live', SHOWROOM, published(SHOWROOM, SHOWROOM_SETTINGS));

    const settings = settingsRepo(h.meta);
    await settings.set('system.publicOrigin', ORIGIN, { updatedBy: null });
    await settings.set('privacy.businessName', 'Meridian Workplace Ltd', { updatedBy: null });
    await settings.set('privacy.noticeUrl', 'https://www.meridian.example/privacy', { updatedBy: null });
    await paymentSettingsRepo(h.meta).set(PAY_PAGE_DOC, payPageSchema, { shopName: 'Meridian', logoFileId: null, contactEmail: 'hello@meridian.example', contactPhone: null, shopCountry: 'GB', showLines: false });
    expect((await addWebsites(h.meta, ['https://www.meridian.example'], { userId: null, at: Date.now() })).ok).toBe(true);

    root = await mkdtemp(join(tmpdir(), 'forms-staff-'));
    const dist = join(root, 'dist');
    await mkdir(join(dist, 'x', 'assets'), { recursive: true });
    await writeFile(join(dist, 'index.html'), '<!doctype html><html><body data-app="dashboard"></body></html>');
    await writeFile(join(dist, 'x', 'index.html'), PAGE_HTML);
    const runService = createRunService({ meta: h.meta });
    composed = await composeServer({
      env: makeEnv({ ADMINIUM_DATA_DIR: h.dataDir, HOST: '127.0.0.1', ADMINIUM_SECRET: TEST_SECRET }),
      metaStore: { meta: h.meta, url: 'sqlite::memory:', engine: 'sqlite', source: 'embedded', close: async () => Promise.resolve() },
      manager: h.manager,
      runService,
      applyService: createApplyService({ meta: h.meta, runService }),
      allowed: null,
      staticRoot: dist,
      logger: false,
      telemetry: false,
    });
    await composed.app.ready();
    await composed.addOnsLoaded;
    await composed.jobs.worker.stop();
    composed.jobs.scheduler.stop();

    await person('boss', 'super-admin');
    // The marketer: the add-on's forms and answers, and the enquiries' page. Neither the privacy action nor the roles action.
    await person('marketer', { tables: { forms: { read: true, update: true }, answers: { read: true } }, pages: [enquiriesPage] });
    // A writer of forms who may not open the enquiries' page.
    await person('writer', { tables: { forms: { read: true } } });
    // Signed in, and no forms at all.
    await person('clerk', { tables: { enquiries: { read: true } } });
    const generated = generateApiKey();
    await apiKeysRepo(h.meta).create({ name: 'tablet', prefix: generated.prefix, tokenHash: generated.tokenHash, roleId: roleIds.get('marketer')! });
    bearer = generated.key;
  }, 240_000);

  afterAll(async () => {
    if (!available) return;
    await composed?.app.close();
    await h?.close();
    await rm(root, { recursive: true, force: true });
  });

  // ── The status read ───────────────────────────────────────────────────────

  it.skipIf(!available)('tells a reader of the forms everything the builder shows, and the reach the Privacy page reads', async () => {
    const res = await call('GET', '/api/v1/forms/status', 'marketer');
    expect(res.statusCode, res.body).toBe(200);
    const { data } = res.json() as { data: Doc };
    expect(data).toMatchObject({ mail: { sends: false, blocked: 'no-mail-server' }, notice: true, publicOrigin: ORIGIN, websites: ['https://www.meridian.example'] });
    expect(data['roles']).toEqual(expect.arrayContaining([{ id: roleIds.get('marketer'), name: 'marketer role' }]));
    for (const role of data['roles'] as Doc[]) expect(Object.keys(role).sort()).toEqual(['id', 'name']);
    // The same answer the reach card is given, for the same request.
    const reach = await call('GET', '/api/v1/privacy/reach', 'boss');
    expect(reach.statusCode).toBe(200);
    expect(data['reach']).toEqual({ state: (reach.json() as { data: Doc }).data['state'] });
    // Nobody's address, no member of a role, nobody who added a website.
    for (const name of ['boss', 'marketer', 'writer', 'clerk']) expect(res.body).not.toContain(`${name}@forms.dev`);
    expect(Object.keys(data).sort()).toEqual(['mail', 'notice', 'publicOrigin', 'reach', 'roles', 'websites']);
    // What a marketer is still refused: the privacy action's reads and the roles.
    expect((await call('GET', '/api/v1/privacy/reach', 'marketer')).statusCode).toBe(403);
    expect((await call('GET', '/api/v1/roles', 'marketer')).statusCode).toBe(403);
  });

  it.skipIf(!available)('follows what it reads: a notice taken away and an address unset are said', async () => {
    const settings = settingsRepo(h.meta);
    await settings.set('privacy.noticeUrl', null, { updatedBy: null });
    await settings.set('system.publicOrigin', null, { updatedBy: null });
    try {
      const { data } = (await call('GET', '/api/v1/forms/status', 'writer')).json() as { data: Doc };
      expect(data).toMatchObject({ mail: { sends: false, blocked: 'no-public-origin' }, notice: false, publicOrigin: null });
      expect(data['reach']['state']).not.toBe('reachable');
    } finally {
      await settings.set('privacy.noticeUrl', 'https://www.meridian.example/privacy', { updatedBy: null });
      await settings.set('system.publicOrigin', ORIGIN, { updatedBy: null });
    }
  });

  it.skipIf(!available)('is refused to a signed-in person who may read no forms, to an API key, and to nobody signed in', async () => {
    const clerk = await call('GET', '/api/v1/forms/status', 'clerk');
    expect(clerk.statusCode).toBe(403);
    expect(clerk.body).not.toContain(ORIGIN);
    const keyed = await call('GET', '/api/v1/forms/status', undefined, { headers: { authorization: `Bearer ${bearer}` } });
    expect([401, 403]).toContain(keyed.statusCode);
    expect(keyed.body).not.toContain(ORIGIN);
    expect((await call('GET', '/api/v1/forms/status')).statusCode).toBe(401);
  });

  // ── The kit's facts for the map editor ──────────────────────────────────────

  it.skipIf(!available)('gives the map editor an enum\'s values, a text\'s longest, the source column, and the page a row opens on', async () => {
    const hostsOf = async (as: string) => ((await call('GET', '/api/v1/add-ons/forms/kit', as)).json() as { hosts: Doc[] }).hosts.filter((host) => host.via === 'forms');
    const [enquiries, feedback] = ['enquiries', 'feedback'].map((ref) => (hosts: Doc[]) => hosts.find((host) => host.id === tables.get(ref))!);
    const hosts = await hostsOf('marketer');
    const shown = enquiries!(hosts);
    const column = (name: string) => (shown.columns as Doc[]).find((one) => one.name === name)!;
    // The kind is the database's own name for it (an enum is a checked text on some engines); the values are the enum's.
    expect(column('brochure')).toMatchObject({ values: ['yes', 'no'], link: false });
    expect(column('name').maxLength).toBe(80);
    expect(column('from_form').maxLength).toBe(200);
    expect('values' in column('name')).toBe(false);
    expect(shown.sourceColumn).toBe('from_form');
    const page = await pagesRepo(h.meta).findById(enquiriesPage);
    expect(shown.page).toBe(page!.slug);
    // A table whose entry names no source has none; a reader who may not open the page is given none.
    expect('sourceColumn' in feedback!(hosts)).toBe(false);
    expect('page' in feedback!(hosts)).toBe(false);
    expect('page' in enquiries!(await hostsOf('writer'))).toBe(false);
    expect(enquiries!(await hostsOf('writer')).sourceColumn).toBe('from_form');
    // Whether the reader may start a campaign ("Send by e-mail"): the e-mail screens' grant.
    const has = async (as: string) => ((await call('GET', '/api/v1/add-ons/forms/kit', as)).json() as { has: Record<string, boolean> }).has['system:settings:manage'];
    expect(await has('marketer')).toBe(false);
    expect(await has('boss')).toBe(true);
  });

  // ── The preview of a draft ─────────────────────────────────────────────────

  it.skipIf(!available)('draws a reader\'s draft leniently: missing words from the default language, a question that does not read left out and named', async () => {
    const res = await call('GET', '/x/forms/api/spring-draft?preview=1&lang=de-DE', 'writer');
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as Doc;
    expect(body).toMatchObject({ state: 'live', preview: true });
    expect(body['skipped'].sort()).toEqual(['qcount', 'qhalf']);
    expect(body['form']['language']).toBe('de-DE');
    expect(body['form']['definition']['title']).toEqual({ 'de-DE': 'Book a showroom visit' });
    expect(body['form']['definition']['questions'].map((question: Doc) => [question.id, question.label])).toEqual([['qname', { 'de-DE': 'Ihr Name' }]]);
    // A closed form is drawn from its draft too.
    const closed = await call('GET', '/x/forms/api/old-offer?preview=1', 'writer');
    expect(closed.statusCode).toBe(200);
    expect(closed.json()).toMatchObject({ state: 'live', preview: true, skipped: [] });
  });

  it.skipIf(!available)('is framed by this host alone, kept by nobody, and leaves every other answer\'s policy as it was', async () => {
    const page = await call('GET', '/x/forms/spring-draft?preview=1', 'writer');
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('<div id="x-root"></div>');
    for (const res of [page, await call('GET', '/x/forms/api/spring-draft?preview=1', 'writer')]) {
      expect(res.headers['content-security-policy']).toBe(xContentPolicy(`http://${HOST}`, ["'self'"]));
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['x-robots-tag']).toBe('noindex');
    }
    expect(page.headers['content-security-policy']).toContain("frame-ancestors 'self'");
    // Without the preview, a live form is framed by nobody, as before.
    const live = await call('GET', '/x/forms/api/showroom-visit');
    expect(live.statusCode).toBe(200);
    expect(live.headers['content-security-policy']).toBe(xContentPolicy(`http://${HOST}`));
    expect(live.json()).not.toHaveProperty('preview');
  });

  it.skipIf(!available)('is exactly a stranger\'s "not available" for anyone else, and for a slug nobody has', async () => {
    const stranger = await call('GET', '/x/forms/api/spring-draft');
    expect(stranger.statusCode).toBe(404);
    for (const res of [await call('GET', '/x/forms/api/spring-draft?preview=1'), await call('GET', '/x/forms/api/spring-draft?preview=1', 'clerk'), await call('GET', '/x/forms/api/no-such-form?preview=1', 'writer'), await call('GET', '/x/forms/api/spring-draft?preview=1', undefined, { headers: { authorization: `Bearer ${bearer}` } }), await call('GET', '/x/forms/api/spring-draft?preview=yes', 'writer')]) {
      expect(res.statusCode).toBe(404);
      expect(res.body).toBe(stranger.body);
      expect(res.headers['content-security-policy']).toBe(xContentPolicy(`http://${HOST}`));
    }
    const page = await call('GET', '/x/forms/spring-draft?preview=1', 'clerk');
    expect(page.statusCode).toBe(404);
    expect(page.headers['content-security-policy']).toContain("frame-ancestors 'none'");
  });

  it.skipIf(!available)('is not held to whether strangers can reach the pages: staff are on their own host', async () => {
    const settings = settingsRepo(h.meta);
    await settings.set('system.publicOrigin', null, { updatedBy: null });
    try {
      expect((await call('GET', '/x/forms/api/showroom-visit')).statusCode).toBe(404);
      expect((await call('GET', '/x/forms/api/spring-draft?preview=1', 'writer')).statusCode).toBe(200);
    } finally {
      await settings.set('system.publicOrigin', ORIGIN, { updatedBy: null });
    }
  });

  it.skipIf(!available)('sends nothing: its check, its answer and its files are refused, and no answer is written', async () => {
    const before = await answersCount();
    const answer = { language: 'en-US', values: { qname: 'Ann Lee' }, website: '' };
    for (const res of [
      await call('POST', '/x/forms/api/showroom-visit/answers?preview=1', 'writer', { payload: answer, headers: { origin: `http://${HOST}` } }),
      await call('POST', '/x/forms/api/spring-draft/answers?preview=1', 'writer', { payload: answer, headers: { origin: `http://${HOST}` } }),
      await call('GET', '/x/forms/api/showroom-visit/challenge?preview=1', 'writer'),
      await call('POST', '/x/forms/api/showroom-visit/files?q=qfiles&name=a.pdf&preview=1', 'writer', { payload: '%PDF-1.4', headers: { origin: `http://${HOST}`, 'content-type': 'application/pdf' } }),
    ]) {
      expect(res.statusCode, res.body).toBe(404);
      expect((res.json() as Doc)['state']).toBe('unavailable');
    }
    expect(await answersCount()).toBe(before);
  });

  it.skipIf(!available)('never serves a form whose slug is a word the addresses use', async () => {
    const res = await call('GET', '/x/forms/api/surveys');
    expect(res.statusCode).toBe(404);
    expect((res.json() as Doc)['state']).toBe('unavailable');
    expect((await call('GET', '/x/forms/api/surveys?preview=1', 'writer')).statusCode).toBe(404);
  });
});
