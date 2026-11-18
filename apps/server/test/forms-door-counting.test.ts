// SPDX-License-Identifier: AGPL-3.0-only
/**
 * VISITOR COUNTING AT THE FORMS DOOR, on the real server over a forms
 * add-on, its tables on each engine.
 *
 * COUNTS
 * - A form's data read counts one `form-page` view, its form block's read
 *   with `?on=<page key>` one `form-opened` on that page; a made-up place, a
 *   form that is not live, an unknown slug, a preview, a bot, a link preview
 *   and a prefetch write nothing; a link scanner fetching only the page's
 *   HTML counts nothing; a second view from the same /64 counts once.
 * - A kept answer counts `form-sent`; a trap and a refused answer do not; an
 *   erasure of the person leaves the count.
 * - Off counts nothing.
 * - `GET /api/v1/views` answers per day with when counting started, for
 *   whoever may read the forms table; a role that reads only the answers is
 *   refused (as that role), and a made-up install is not found.
 *
 * PER VISITOR
 * - Refused while the privacy notice is not set (409), and kept at Counts
 *   only.
 * - At Counts only the read sets no cookie and says nothing of a visitor.
 * - At Per visitor a form's own page is told the banner's words (the owner's
 *   over the default), a frame and a form block are told nothing; nothing is
 *   set before "yes"; "yes" from another site is refused; "yes" sets the
 *   cookie (HttpOnly, Lax, `Path=/x/`, six months at most) and a visitor
 *   with the proof; the next read says "yes" and keeps a visit; a framed read
 *   keeps none.
 * - An answer sent with the cookie joins the address: "Pages they saw" is
 *   found, downloaded and erased by the address, and the erase preview
 *   counts the visits.
 * - Going down from Per visitor deletes every visitor and visit at once, with
 *   one audit entry; "Cookie choice" withdraws and clears the cookie.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { strFromU8, unzipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { FormSettingsInput } from '@adminium/add-on-contracts/forms';
import { permissionsRepo, rolesRepo, settingsRepo, usersRepo, viewDaysRepo, visitorsRepo } from '@adminium/meta';

import { formsWithInvitations } from '../../../packages/manifest/test/forms-invitations-fixture.js';
import { recordDeciderTrust } from '../src/add-ons/decider-trust.js';
import { composeServer, type ComposedServer } from '../src/compose.js';
import { createConsentService } from '../src/consent/index.js';
import { bindWriteValue } from '../src/crud/write-values.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import { personZip } from '../src/privacy/export.js';
import { findPerson } from '../src/privacy/sources.js';
import { solveProof } from '../src/public-api/proof.js';
import { createPublicViews } from '../src/public-api/runtime.js';
import { matrixRowsFromGrants } from '../src/rbac/permissions.js';
import { VIEW_COUNTS_FLUSH_NAME } from '../src/views/wiring.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { adminPasswordHash, ADMIN_PASSWORD, sessionCookie } from './auth-helpers.js';
import { published, SHOWROOM } from './forms-door.helpers.js';
import { makeEnv, TEST_SECRET } from './helpers.js';
import { LEGS } from './invoicing-install.helpers.js';

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- a reply read freely

const HOST = 'forms.meridian.example';
const ORIGIN = `https://${HOST}`;
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const KEEP: FormSettingsInput = { limits: { perHour: 500, harder: false }, tell: [] };
const pk = { ref: 'id', type: 'int', role: 'pk' };

function crm(): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'crm',
    name: 'CRM',
    version: '1.0.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'AGPL-3.0-only',
    description: { key: 'd', fallback: 'A small CRM.' },
    categories: ['crm'],
    compatibility: { minAdminiumVersion: '0.3.40', engines: ['postgres', 'mysql', 'sqlite'] },
    requiredSchema: { prefixed: true, tables: [{ ref: 'contacts', columns: [pk, { ref: 'name', type: 'text', maxLength: 80 }] }] },
    pages: [{ ref: 'crm-contacts', template: 'page-crud', title: { key: 't', fallback: 'Contacts' }, nav: { group: 'crm', icon: 'home', order: 1 }, bindings: { rows: 'contacts' } }],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
  };
}

describe.each(LEGS)('visitor counting at the forms door — %s', (dialect, available) => {
  let h: Harness;
  let composed: ComposedServer;
  let root: string;
  let installId = '';
  const names: Record<string, string> = {};
  const ids: Record<string, string> = {};
  let owner = '';
  let builder = '';
  let answersOnly = '';
  let signIns = 0;
  let seq = 0;

  const nextIp = () => {
    seq += 1;
    return `198.51.100.${String(seq % 250)}`;
  };
  const flush = async () => composed.jobs.scheduler.trigger(VIEW_COUNTS_FLUSH_NAME);
  const total = async (kind: string, thing: string, place?: string) =>
    (await viewDaysRepo(h.meta).read({ installId, kind, things: [thing], from: '2000-01-01', to: '2099-12-31', ...(place === undefined ? {} : { place }) })).reduce((sum, row) => sum + row.views, 0);
  const read = async (url: string, opts: { ip?: string; agent?: string; cookie?: string; headers?: Record<string, string> } = {}) =>
    composed.app.inject({ method: 'GET', url, remoteAddress: opts.ip ?? nextIp(), headers: { host: HOST, 'user-agent': opts.agent ?? CHROME, ...(opts.cookie === undefined ? {} : { cookie: opts.cookie }), ...(opts.headers ?? {}) } });

  async function signIn(email: string): Promise<string> {
    signIns += 1;
    const res = await composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: `10.9.1.${String(signIns)}`, payload: { email, password: ADMIN_PASSWORD } });
    expect(res.statusCode, res.body).toBe(200);
    return sessionCookie(res.headers['set-cookie']);
  }

  async function person(email: string, grants: string[], slug?: string): Promise<string> {
    const user = await usersRepo(h.meta).create({ email, name: email.split('@')[0]!, passwordHash: await adminPasswordHash() });
    const role = slug === undefined ? await rolesRepo(h.meta).create({ slug: `own-${email.split('@')[0]!}`, name: 'Own' }) : (await rolesRepo(h.meta).findBySlug(slug))!;
    for (const row of matrixRowsFromGrants(grants).rows) await permissionsRepo(h.meta).grant(role.id, row.resourceKind, row.resourceRef, row.actions as never);
    await rolesRepo(h.meta).assignToUser(user.id, role.id);
    return signIn(email);
  }

  /** A stranger's send, with a fresh proof; `trap` fills the field no person sees. */
  async function send(slug: string, values: Record<string, unknown>, opts: { ip?: string; cookie?: string; on?: string; trap?: boolean; from?: string } = {}) {
    const ip = opts.ip ?? nextIp();
    const challenge = (await composed.app.inject({ method: 'GET', url: `/x/forms/api/${slug}/challenge`, headers: { host: HOST }, remoteAddress: ip })).json() as Doc;
    const proof = `${challenge.id as string}.${solveProof(challenge.salt as string, challenge.difficulty as number)}`;
    return composed.app.inject({
      method: 'POST',
      url: `/x/forms/api/${slug}/answers${opts.on === undefined ? '' : `?on=${opts.on}`}`,
      remoteAddress: ip,
      headers: { host: HOST, origin: ORIGIN, 'x-adminium-proof': proof, 'user-agent': CHROME, ...(opts.cookie === undefined ? {} : { cookie: opts.cookie }) },
      payload: { language: 'en-US', values, query: {}, website: opts.trap === true ? 'https://spam.example' : '', ...(opts.from === undefined ? {} : { from: opts.from }) },
    });
  }

  async function setLevel(level: string, extra: Record<string, unknown> = {}) {
    return composed.app.inject({ method: 'PUT', url: '/api/v1/privacy/counting', headers: { cookie: owner }, payload: { level, ...extra } });
  }

  beforeAll(async () => {
    if (!available) return;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageApp(crm());
    expect((await h.install('crm', '1.0.0')).statusCode).toBe(200);
    await h.stageAddOn(formsWithInvitations(), { bundled: true });
    const added = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'forms', version: '1.0.0', attachTo: ['crm'] } });
    expect(added.statusCode, added.body).toBe(200);
    await recordDeciderTrust(h.meta, { key: 'forms', version: '1.0.0', integrity: (await h.addOnStore.verifyTree('forms', '1.0.0')).integrity });
    installId = (await h.meta.db.selectFrom('adminium_manifests').select('id').where('manifestKey', '=', 'forms').executeTakeFirstOrThrow()).id;
    for (const record of await h.meta.db.selectFrom('adminium_app_tables').select(['ref', 'tableName']).where('appKey', '=', 'forms').execute()) names[record.ref] = record.tableName;
    const views = createPublicViews(h.meta);
    const view = (await views.viewFor(h.connectionId))!;
    for (const ref of ['answers', 'forms']) ids[ref] = view.table(names[ref]!).id;
    const { db } = await h.manager.data(h.connectionId);
    const formsTable = view.table(names['forms']!);
    for (const [id, slug, state] of [
      ['41', 'showroom-visit', 'live'],
      ['42', 'old-offer', 'closed'],
      ['43', 'next-offer', 'draft'],
    ] as const) {
      const values = { id, title: slug, slug, kind: 'form', state, definition: '{}', settings: '{}', published: published(SHOWROOM, KEEP) };
      await db.insertInto(formsTable.id as never).values(Object.fromEntries(Object.entries(values).map(([column, value]) => [column, bindWriteValue(formsTable.columns.get(column)!, value, dialect)])) as never).execute();
    }

    const settings = settingsRepo(h.meta);
    await settings.set('system.publicOrigin', ORIGIN, { updatedBy: null });
    await settings.set('privacy.businessName', 'Meridian Workplace Ltd', { updatedBy: null });
    await settings.set('privacy.noticeUrl', 'https://www.meridian.example/privacy', { updatedBy: null });

    root = await mkdtemp(join(tmpdir(), 'forms-counting-'));
    await mkdir(join(root, 'x'), { recursive: true });
    await writeFile(join(root, 'index.html'), '<!doctype html><html><body></body></html>');
    await writeFile(join(root, 'x', 'index.html'), '<!doctype html><html><body><noscript>x</noscript></body></html>');
    const runService = createRunService({ meta: h.meta });
    composed = await composeServer({
      env: makeEnv({ ADMINIUM_DATA_DIR: h.dataDir, HOST: '127.0.0.1', ADMINIUM_SECRET: TEST_SECRET }),
      metaStore: { meta: h.meta, url: 'sqlite::memory:', engine: 'sqlite', source: 'embedded', close: async () => Promise.resolve() },
      manager: h.manager,
      runService,
      applyService: createApplyService({ meta: h.meta, runService }),
      allowed: null,
      staticRoot: root,
      logger: false,
      telemetry: false,
    });
    await composed.app.ready();
    await composed.addOnsLoaded;
    await composed.jobs.worker.stop();
    composed.jobs.scheduler.stop();

    owner = await person('boss@meridian.example', [], 'super-admin');
    builder = await person('builder@meridian.example', [`table:${h.connectionId}:${ids['forms']!}:read`]);
    answersOnly = await person('marketer@meridian.example', [`table:${h.connectionId}:${ids['answers']!}:read`]);
  }, 240_000);

  afterAll(async () => {
    if (!available) return;
    await composed?.app.close();
    await h?.close();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });

  it.skipIf(!available)('counts a live form\'s read once per address, and never a bot, a preview, a prefetch, a scanner, a made-up place or a form not live', async () => {
    // Counting started when the server did.
    expect(await settingsRepo(h.meta).get('privacy.countingSince')).toEqual(expect.any(Number));
    const ip = nextIp();
    expect((await read('/x/forms/api/showroom-visit', { ip })).statusCode).toBe(200);
    // The same address again, and its language switched: one view.
    await read('/x/forms/api/showroom-visit?lang=de-DE', { ip });
    // A bot, a link preview, a prefetch: nothing.
    await read('/x/forms/api/showroom-visit', { agent: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' });
    await read('/x/forms/api/showroom-visit', { agent: 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)' });
    await read('/x/forms/api/showroom-visit', { headers: { 'sec-purpose': 'prefetch' } });
    // A link scanner fetching the page's HTML alone: the page, never the read.
    expect((await read('/x/forms/showroom-visit', { agent: 'Mozilla/5.0 (compatible; MSOffice 16) BingPreview/1.0b' })).statusCode).toBe(200);
    expect((await read('/x/forms/showroom-visit')).statusCode).toBe(200);
    // Forged: an unknown slug, a closed form, a draft, a preview, a made-up place.
    expect((await read('/x/forms/api/no-such-form')).statusCode).toBe(404);
    await read('/x/forms/api/old-offer');
    await read('/x/forms/api/next-offer');
    await read('/x/forms/api/showroom-visit?preview=1');
    await read('/x/forms/api/showroom-visit?on=not-a-key');
    // The form block on landing page 7, as it nears the screen.
    await read('/x/forms/api/showroom-visit?on=7', { ip });
    await flush();
    expect(await total('form-page', '41')).toBe(1);
    expect(await total('form-opened', '41', '7')).toBe(1);
    expect(await total('form-opened', '41')).toBe(1);
    const rows = await h.meta.db.selectFrom('adminium_view_days').selectAll().execute();
    expect(rows.map((row) => `${row.kind}:${row.thing}:${row.place}`).sort()).toEqual(['form-opened:41:7', 'form-page:41:']);
  });

  it.skipIf(!available)('counts a sent form after the answer is kept, never a trap or a refusal, and an erasure leaves the count', async () => {
    const before = await total('form-sent', '41');
    expect((await send('showroom-visit', { qname: 'Ines Vaughan', qemail: 'ines@juno.example' }, { on: '7' })).statusCode).toBe(200);
    // The trap is answered as sent, and counted as nothing.
    expect((await send('showroom-visit', { qname: 'Bot', qemail: 'bot@spam.example' }, { trap: true })).statusCode).toBe(200);
    // A refused answer: no e-mail.
    expect((await send('showroom-visit', { qname: 'Ines Vaughan' })).statusCode).toBe(400);
    await flush();
    expect(await total('form-sent', '41')).toBe(before + 1);
    expect(await total('form-sent', '41', '7')).toBe(1);
    const erased = await composed.app.inject({ method: 'POST', url: '/api/v1/privacy/erase', headers: { cookie: owner }, payload: { address: 'ines@juno.example', confirm: 'ines@juno.example' } });
    expect(erased.statusCode, erased.body).toBe(200);
    expect(await total('form-sent', '41')).toBe(before + 1);
  });

  it.skipIf(!available)('the views route answers whoever may read the forms, refuses a role that reads only the answers, and finds no made-up install', async () => {
    const url = (who: string) => `/api/v1/views?installId=${who}&kind=form-page&things=41,99&from=2000-01-01&to=2000-12-31`;
    const today = new Date().toISOString().slice(0, 10);
    const ranged = `/api/v1/views?installId=${installId}&kind=form-page&things=41,99&from=${today.slice(0, 8)}01&to=${today}`;
    const asBuilder = await composed.app.inject({ method: 'GET', url: ranged, headers: { cookie: builder } });
    expect(asBuilder.statusCode, asBuilder.body).toBe(200);
    const data = (asBuilder.json() as Doc).data;
    expect(data.level).toBe('counts');
    expect(data.countingSince).toEqual(expect.any(Number));
    expect(data.things).toEqual([
      { thing: '41', days: [expect.objectContaining({ place: '', views: 1 })] },
      { thing: '99', days: [] },
    ]);
    const refused = await composed.app.inject({ method: 'GET', url: ranged, headers: { cookie: answersOnly } });
    expect(refused.statusCode, refused.body).toBe(403);
    expect((await composed.app.inject({ method: 'GET', url: url('mf_nothing'), headers: { cookie: owner } })).statusCode).toBe(404);
    // A range past 400 days, or more than 50 things: refused.
    expect((await composed.app.inject({ method: 'GET', url: `/api/v1/views?installId=${installId}&kind=form-page&things=41&from=2000-01-01&to=2002-01-01`, headers: { cookie: owner } })).statusCode).toBe(422);
    const many = Array.from({ length: 51 }, (_, n) => String(n)).join(',');
    expect((await composed.app.inject({ method: 'GET', url: `/api/v1/views?installId=${installId}&kind=form-page&things=${many}&from=2000-01-01&to=2000-01-02`, headers: { cookie: owner } })).statusCode).toBe(422);
    // A stranger: nothing.
    expect((await composed.app.inject({ method: 'GET', url: ranged })).statusCode).toBe(401);
  });

  it.skipIf(!available)('the counting rows are kept for the months chosen, from the offered ones, and only the privacy action changes counting', async () => {
    const put = (rows: unknown, cookie = owner) => composed.app.inject({ method: 'PUT', url: '/api/v1/privacy/keeping', headers: { cookie }, payload: { rows } });
    const saved = await put([{ key: 'view-counts', months: 24 }, { key: 'visitor-pages', months: 3 }]);
    expect(saved.statusCode, saved.body).toBe(200);
    const rows = (saved.json() as Doc).data.rows as Doc[];
    expect(rows.filter((row) => ['view-counts', 'visitor-pages'].includes(row.key as string))).toEqual([
      { key: 'view-counts', fixed: false, keptFor: 24, options: [3, 6, 12, 13, 24, 36] },
      { key: 'visitor-pages', fixed: false, keptFor: 3, options: [3, 6, 12, 13, 24, 36] },
    ]);
    expect((await put([{ key: 'view-counts', months: 7 }])).statusCode).toBe(422);
    expect((await put([{ key: 'consent-history', months: 12 }])).statusCode).toBe(422);
    expect((await put([{ key: 'view-counts', months: 13 }], builder)).statusCode).toBe(403);
    expect((await composed.app.inject({ method: 'PUT', url: '/api/v1/privacy/counting', headers: { cookie: builder }, payload: { level: 'off' } })).statusCode).toBe(403);
    expect((await composed.app.inject({ method: 'GET', url: '/api/v1/privacy/counting', headers: { cookie: answersOnly } })).statusCode).toBe(403);
    expect(await put([{ key: 'view-counts', months: 13 }, { key: 'visitor-pages', months: 6 }])).toMatchObject({ statusCode: 200 });
    const counting = (await composed.app.inject({ method: 'GET', url: '/api/v1/privacy/counting', headers: { cookie: owner } })).json() as Doc;
    expect(counting.data).toMatchObject({ level: 'counts', viewCountsMonths: 13, visitsMonths: 6, noticeReady: true, kept: { visitors: 0, visits: 0 } });
    expect(Object.keys(counting.data.defaults as Doc).sort()).toEqual(['ar-EG', 'cs-CZ', 'da-DK', 'de-DE', 'en-US', 'fr-FR', 'zh-CN', 'zh-TW']);
  });

  it.skipIf(!available)('Off counts nothing; Per visitor is refused while the notice is not set', async () => {
    expect((await setLevel('off')).statusCode).toBe(200);
    await read('/x/forms/api/showroom-visit');
    await flush();
    const at = await total('form-page', '41');
    expect(at).toBe(1);
    const settings = settingsRepo(h.meta);
    await settings.set('privacy.noticeUrl', null, { updatedBy: null });
    const refused = await setLevel('visitor');
    expect(refused.statusCode).toBe(409);
    expect((refused.json() as Doc).error.code).toBe('PER_VISITOR_NEEDS_NOTICE');
    expect(await settings.get('privacy.tracking')).toBe('off');
    await settings.set('privacy.noticeUrl', 'https://www.meridian.example/privacy', { updatedBy: null });
    const back = await setLevel('counts');
    expect(back.statusCode).toBe(200);
    // Counting started again, now.
    expect((back.json() as Doc).data.countingSince).toBeGreaterThan(Date.now() - 60_000);
  });

  it.skipIf(!available)('at Counts only a read sets no cookie and says nothing of a visitor', async () => {
    const res = await read('/x/forms/api/showroom-visit');
    expect(res.headers['set-cookie']).toBeUndefined();
    expect((res.json() as Doc).visitor).toBeUndefined();
    // A "yes" at Counts only is not asked for, and sets nothing.
    const yes = await composed.app.inject({ method: 'POST', url: '/x/consent/visit', headers: { host: HOST, origin: `http://${HOST}` }, payload: {} });
    expect(yes.statusCode).toBe(404);
    expect(yes.headers['set-cookie']).toBeUndefined();
  });

  it.skipIf(!available)('at Per visitor: the banner on the form\'s own page only, nothing before yes, a visitor after it, and the join to the address', async () => {
    const owners = { 'en-US': { title: 'May we remember your visit?' } };
    expect((await setLevel('visitor', { banner: owners })).statusCode).toBe(200);
    const page = await read('/x/forms/api/showroom-visit');
    expect(page.headers['set-cookie']).toBeUndefined();
    const visitor = (page.json() as Doc).visitor;
    expect(visitor).toMatchObject({ said: null, banner: { language: 'en-US', title: 'May we remember your visit?', yes: 'Yes', no: 'No', version: expect.stringMatching(/^w-[0-9a-f]{24}$/) } });
    expect(visitor.banner.text).toContain('if you then send us a form');
    // A frame and a landing page's form block are told nothing; nor is a host that is not the install's own.
    expect((await read('/x/forms/api/showroom-visit?frame=1')).json()).not.toHaveProperty('visitor');
    expect((await read('/x/forms/api/showroom-visit?on=7')).json()).not.toHaveProperty('visitor');
    expect((await composed.app.inject({ method: 'GET', url: '/x/forms/api/showroom-visit', remoteAddress: nextIp(), headers: { host: 'shop.meridian.example', 'user-agent': CHROME } })).json()).not.toHaveProperty('visitor');

    // "Yes" from another site, or a script with no browser's marks: refused, nothing written.
    for (const headers of [{ origin: 'https://evil.example' }, {}, { origin: `http://${HOST}`, 'sec-fetch-site': 'cross-site' }]) {
      const refused = await composed.app.inject({ method: 'POST', url: '/x/consent/visit', headers: { host: HOST, ...headers }, payload: {} });
      expect(refused.statusCode).toBe(403);
      expect(refused.headers['set-cookie']).toBeUndefined();
    }
    // Nor on a host that is not the install's own.
    const elsewhere = await composed.app.inject({ method: 'POST', url: '/x/consent/visit', headers: { host: 'shop.meridian.example', origin: 'http://shop.meridian.example' }, payload: {} });
    expect([elsewhere.statusCode, elsewhere.headers['set-cookie']]).toEqual([404, undefined]);
    expect((await visitorsRepo(h.meta).counts()).visitors).toBe(0);

    const yes = await composed.app.inject({ method: 'POST', url: '/x/consent/visit', headers: { host: HOST, origin: `http://${HOST}`, 'sec-fetch-site': 'same-origin' }, payload: { language: 'en-US' } });
    expect(yes.statusCode, yes.body).toBe(200);
    const set = String(yes.headers['set-cookie']);
    // On this plain-http test address the cookie carries no __Secure- prefix; everything else is the same.
    expect(set).toMatch(/^adm_v=[A-Za-z0-9_-]{22}; Path=\/x\/; Max-Age=15552000; HttpOnly; SameSite=Lax$/);
    const cookie = set.split(';')[0]!;
    const kept = (await h.meta.db.selectFrom('adminium_visitors').selectAll().execute())[0]!;
    expect(kept).toMatchObject({ host: HOST, wordingVersion: visitor.banner.version, addressHash: null });
    // The cookie's value is never stored.
    expect(JSON.stringify(kept)).not.toContain(cookie.split('=')[1]!);

    // The next read says "yes" and keeps a visit; a framed read keeps none.
    const again = await read('/x/forms/api/showroom-visit', { cookie });
    expect((again.json() as Doc).visitor.said).toBe('yes');
    await read('/x/forms/api/showroom-visit?frame=1', { cookie });
    await flush();
    expect((await visitorsRepo(h.meta).counts()).visits).toBe(1);

    // A form sent from a frame joins nothing, cookie or not.
    expect((await send('showroom-visit', { qname: 'Tessa Marlow', qemail: 'tessa@meridian.example' }, { cookie, from: 'https://shop.meridian.example' })).statusCode).toBe(200);
    expect((await h.meta.db.selectFrom('adminium_visitors').select('addressHash').executeTakeFirstOrThrow()).addressHash).toBeNull();
    // A form sent with the cookie joins the address: "Pages they saw" by it.
    expect((await send('showroom-visit', { qname: 'Tessa Marlow', qemail: 'Tessa@Meridian.example' }, { cookie })).statusCode).toBe(200);
    await flush();
    const deps = { meta: h.meta, manager: h.manager, consent: createConsentService({ meta: h.meta, secret: TEST_SECRET }), secret: TEST_SECRET };
    const found = await findPerson(deps, 'tessa@meridian.example');
    const seen = found.sources.find((one) => one.kind === 'page-visits');
    expect(seen).toMatchObject({ id: 'page-visits', group: 'held', count: 1 });
    const zip = unzipSync(personZip(found, Date.now()));
    expect(JSON.parse(strFromU8(zip['page-visits.json']!))).toEqual([expect.objectContaining({ kind: 'form-page', page: '41', install: installId, day: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) })]);
    const preview = await composed.app.inject({ method: 'POST', url: '/api/v1/privacy/erase/preview', headers: { cookie: owner }, payload: { address: 'tessa@meridian.example' } });
    expect((preview.json() as Doc).data.goes).toEqual(expect.arrayContaining([{ kind: 'page-visits', count: 1 }]));
    const erased = await composed.app.inject({ method: 'POST', url: '/api/v1/privacy/erase', headers: { cookie: owner }, payload: { address: 'tessa@meridian.example', confirm: 'tessa@meridian.example' } });
    expect((erased.json() as Doc).data.counts).toMatchObject({ 'page-visits': 1, visitors: 1 });
    expect(await visitorsRepo(h.meta).counts()).toEqual({ visitors: 0, visits: 0 });
  });

  it.skipIf(!available)('going down from Per visitor deletes every visitor and visit at once with one audit entry; Cookie choice withdraws', async () => {
    const yes = async () => {
      const res = await composed.app.inject({ method: 'POST', url: '/x/consent/visit', remoteAddress: nextIp(), headers: { host: HOST, origin: `http://${HOST}` }, payload: {} });
      return String(res.headers['set-cookie']).split(';')[0]!;
    };
    const one = await yes();
    const two = await yes();
    await read('/x/forms/api/showroom-visit', { cookie: one });
    await read('/x/forms/api/showroom-visit', { cookie: two });
    await flush();
    expect(await visitorsRepo(h.meta).counts()).toEqual({ visitors: 2, visits: 2 });

    // Cookie choice: the row and its visits go, the cookie is cleared.
    const withdrawn = await composed.app.inject({ method: 'DELETE', url: '/x/consent/visit', headers: { host: HOST, origin: `http://${HOST}`, cookie: one } });
    expect(withdrawn.statusCode).toBe(200);
    expect(String(withdrawn.headers['set-cookie'])).toMatch(/^adm_v=; Path=\/x\/; Max-Age=0;/);
    expect(await visitorsRepo(h.meta).counts()).toEqual({ visitors: 1, visits: 1 });

    const auditBefore = Number((await h.meta.db.selectFrom('adminium_audit_log').select((eb) => eb.fn.countAll().as('n')).where('action', '=', 'privacy.counting.update').executeTakeFirstOrThrow()).n);
    const down = await setLevel('counts');
    expect(down.statusCode).toBe(200);
    expect((down.json() as Doc).data.deleted).toEqual({ visitors: 1, visits: 1 });
    expect(await visitorsRepo(h.meta).counts()).toEqual({ visitors: 0, visits: 0 });
    const entries = await h.meta.db.selectFrom('adminium_audit_log').selectAll().where('action', '=', 'privacy.counting.update').execute();
    expect(entries).toHaveLength(auditBefore + 1);
    const last = entries.at(-1)!;
    expect(JSON.parse(String(last.changes))).toEqual({ before: { level: 'visitor' }, after: { level: 'counts', bannerChanged: false, deleted: { visitors: 1, visits: 1 } } });
    // Counts only, never an id or a host.
    // The cookie left in the browser names nobody now.
    expect((await read('/x/forms/api/showroom-visit', { cookie: two })).json()).not.toHaveProperty('visitor');
  });
});
