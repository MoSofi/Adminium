// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE PUBLISH SEAL OF A LANDING PAGE, ON THE REAL SERVER: a landing pages
 * add-on installed beside the dashboard, its pages written by a person who
 * may create and change them (never the admin alone), through the data
 * routes the add-on's kit uses, on SQLite, Postgres and MySQL.
 *
 *  - a clean page goes live, and the engine says when it was published,
 *    whatever the client said;
 *  - a page that still carries the assistant's mark, a published copy that is
 *    not a page, a reserved address and one another page holds are refused,
 *    each by its reason, and nothing is written;
 *  - switching a page off is always let through;
 *  - the same person, through the assistant's door (a proposal tried, and
 *    one confirmed), may write a draft and never publish;
 *  - a bulk change and a file brought in (the write service's many-row
 *    paths) are sealed too;
 *  - every block the assistant adds or changes in a draft is marked, and a
 *    mark is never taken off through its door;
 *  - two pages published at one address at one moment: one goes live.
 */
import { permissionsRepo, rolesRepo, snapshotsRepo, usersRepo } from '@adminium/meta';
import type { FastifyRequest } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { landingAddOn } from '../../../packages/manifest/test/landing-fixture.js';
import { composeServer, type ComposedServer } from '../src/compose.js';
import { createWriteService, type WriteContext, type WriteTarget } from '../src/crud/write-service.js';
import { writeStores } from '../src/crud/write-stores.js';
import { keepAddOnInstalls } from '../src/apps/table-ref.js';
import { landingPagesTable } from '../src/landing/seal.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import { createPublicViews } from '../src/public-api/runtime.js';
import { matrixRowsFromGrants } from '../src/rbac/permissions.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { adminPasswordHash, ADMIN_PASSWORD, sessionCookie } from './auth-helpers.js';
import { makeEnv, TEST_SECRET } from './helpers.js';
import { LEGS } from './invoicing-install.helpers.js';

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- a reply read freely

const CLEAN = { v: 1, title: 'Open day', description: 'Sit in the new booths and try the desks.', blocks: [{ id: 'hero', kind: 'hero', heading: 'Open day at our Leeds showroom', text: 'Thursday 18 September, 10:00 to 19:00.' }] };
const MARKED = { ...CLEAN, blocks: [{ ...CLEAN.blocks[0], milo: true }] };
const page = (slug: string, more: Doc = {}): Doc => ({ name: `Page ${slug}`, slug, state: 'draft', language: 'en-US', draft: MARKED, updated_at: '2026-11-18T09:00:00.000Z', ...more });

describe.each(LEGS)('the publish seal of a landing page — %s', (dialect, available) => {
  let h: Harness;
  let composed: ComposedServer;
  let pages = '';
  let pagesId = '';
  const ids: Record<string, string> = {};
  const cookies: Record<string, string> = {};
  let signIns = 0;

  const as = (who: string, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) =>
    composed.app.inject({ method, url, headers: { cookie: cookies[who]! }, ...(payload === undefined ? {} : { payload: payload as Doc }) });
  const make = (who: string, values: Doc) => as(who, 'POST', `/api/v1/data/${h.connectionId}/${pagesId}`, { values });
  const change = (who: string, key: unknown, values: Doc) => as(who, 'PATCH', `/api/v1/data/${h.connectionId}/${pagesId}/${String(key)}`, { values });
  const row = async (key: unknown): Promise<Doc> => (await h.rows(`SELECT * FROM ${pages} WHERE id = ${String(key)}`))[0] as Doc;
  const json = (value: unknown): unknown => (typeof value === 'string' ? JSON.parse(value) : value);
  const reason = (res: { body: string }): unknown => (JSON.parse(res.body) as Doc).error?.details?.reason;
  /** A new page, as a draft; answers its key. */
  const draft = async (slug: string, more: Doc = {}): Promise<number> => {
    const made = await make('pat', page(slug, more));
    expect(made.statusCode, made.body).toBeLessThan(300);
    return Number((made.json() as Doc).data.id);
  };
  /** One request through the assistant's door, as the person behind `who`'s session. */
  const viaAssistant = (who: string, route: 'row.change' | 'row.change.try' | 'row.create.try', params: Record<string, string>, payload: Doc) =>
    composed.app.assistantDoor.replay({ user: { id: ids[who]!, name: who }, apiKeyPrincipal: null, headers: { cookie: cookies[who]! }, ip: '127.0.0.1', host: 'localhost' } as unknown as FastifyRequest, { route, params: { connectionId: h.connectionId, table: pagesId, ...params }, payload, sessionId: 'ast_seal', turnId: 'atn_seal' });

  /** Someone with these grants, signed in. */
  async function person(key: string, grants: string[]): Promise<void> {
    const user = await usersRepo(h.meta).create({ email: `${key}@meridian.example`, name: key, passwordHash: await adminPasswordHash() });
    ids[key] = user.id;
    const role = await rolesRepo(h.meta).create({ slug: `landing-${key}`, name: `Landing ${key}` });
    for (const one of matrixRowsFromGrants(grants).rows) await permissionsRepo(h.meta).grant(role.id, one.resourceKind, one.resourceRef, one.actions as never);
    await rolesRepo(h.meta).assignToUser(user.id, role.id);
    signIns += 1;
    const res = await composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: `10.9.${String(Math.floor(signIns / 250))}.${String(signIns % 250)}`, payload: { email: `${key}@meridian.example`, password: ADMIN_PASSWORD } });
    expect(res.statusCode, res.body).toBe(200);
    cookies[key] = sessionCookie(res.headers['set-cookie']);
  }

  beforeAll(async () => {
    if (!available) return;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageAddOn(landingAddOn(), { bundled: true });
    const installed = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'landing-pages', version: '1.0.0', attachTo: ['dashboard'] } });
    expect(installed.statusCode, installed.body).toBe(200);
    for (const record of await h.meta.db.selectFrom('adminium_app_tables').select(['appKey', 'ref', 'tableName']).execute()) if (record.appKey === 'landing-pages' && record.ref === 'pages') pages = record.tableName;
    const runService = createRunService({ meta: h.meta });
    composed = await composeServer({
      env: makeEnv({ ADMINIUM_DATA_DIR: h.dataDir, HOST: '127.0.0.1', ADMINIUM_SECRET: TEST_SECRET }),
      metaStore: { meta: h.meta, url: 'sqlite::memory:', engine: 'sqlite', source: 'embedded', close: async () => Promise.resolve() },
      manager: h.manager,
      runService,
      applyService: createApplyService({ meta: h.meta, runService }),
      allowed: null,
      logger: false,
      telemetry: false,
    });
    await composed.app.ready();
    await composed.addOnsLoaded;
    await composed.jobs.worker.stop();
    composed.jobs.scheduler.stop();
    const view = (await createPublicViews(h.meta).viewFor(h.connectionId))!;
    pagesId = view.table(pages).id;
    const t = (...actions: string[]) => actions.map((action) => `table:${h.connectionId}:${pagesId}:${action}`);
    // Pat makes and changes pages, as the add-on's page editor does; the role reaches nothing else.
    await person('pat', t('read', 'create', 'update'));
  }, 300_000);

  afterAll(async () => {
    if (!available) return;
    await composed?.app.close();
    await h?.close();
  });

  /** What is installed, read as the server reads it. */
  const installsNow = () => keepAddOnInstalls(h.meta, async (connectionId) => ((await snapshotsRepo(h.meta).latest(connectionId))?.schema as { tables: { id: string; name: string }[] } | undefined) ?? null).fresh();

  it.skipIf(!available)('seals the pages table of the installed add-on, and no other', async () => {
    const installs = await installsNow();
    expect(landingPagesTable(installs, h.connectionId, pagesId)).toBe(true);
    expect(landingPagesTable(installs, h.connectionId, pagesId.replace(/pages$/, 'funnels'))).toBe(false);
  });

  it.skipIf(!available)('puts a clean page live, and says when it was published, whatever the client said', async () => {
    const key = await draft('open-day');
    expect(await row(key)).toMatchObject({ published: null, published_at: null });
    const before = Date.now();
    const live = await change('pat', key, { state: 'live', published: CLEAN, published_at: '1999-01-01T00:00:00.000Z' });
    expect(live.statusCode, live.body).toBe(200);
    const stored = await row(key);
    expect(stored['state']).toBe('live');
    expect(json(stored['published'])).toEqual(CLEAN);
    // When it was published, as a person reads the row (each engine's own way of keeping a moment, read as the instant it is).
    const read = (await as('pat', 'GET', `/api/v1/data/${h.connectionId}/${pagesId}/${String(key)}`)).json() as Doc;
    const at = new Date(String(read.data.published_at)).getTime();
    expect(at).toBeGreaterThanOrEqual(before - 2000);
    expect(at).toBeLessThanOrEqual(Date.now() + 2000);
    // A page made live in one go, at its creation.
    const made = await make('pat', page('showroom', { state: 'live', published: CLEAN, published_at: '1999-01-01T00:00:00.000Z' }));
    expect(made.statusCode, made.body).toBeLessThan(300);
    expect(String((made.json() as Doc).data.published_at)).not.toContain('1999');
    expect((made.json() as Doc).data.published_at).not.toBeNull();
  });

  it.skipIf(!available)('refuses a page that carries the assistant\'s mark, and writes nothing', async () => {
    const key = await draft('booths');
    const res = await change('pat', key, { state: 'live', published: MARKED });
    expect(res.statusCode, res.body).toBe(422);
    expect(reason(res)).toBe('landing-marked');
    expect(await row(key)).toMatchObject({ state: 'draft', published: null });
    // Nor at its creation.
    const made = await make('pat', page('booths-two', { state: 'live', published: MARKED }));
    expect(reason(made)).toBe('landing-marked');
  });

  it.skipIf(!available)('refuses a published copy that is not a page', async () => {
    const key = await draft('desks');
    for (const published of [{ ...CLEAN, blocks: [{ id: 'f', kind: 'footer' }] }, { ...CLEAN, blocks: [{ id: 'b', kind: 'button', label: 'Go', link: { kind: 'url', href: 'javascript:alert(1)' } }] }]) {
      const res = await change('pat', key, { state: 'live', published });
      expect(res.statusCode, res.body).toBe(422);
      expect(reason(res)).toBe('landing-unparsable');
    }
    // Live with no copy at all.
    expect(reason(await change('pat', key, { state: 'live' }))).toBe('landing-unparsable');
    expect(await row(key)).toMatchObject({ state: 'draft', published: null });
  });

  it.skipIf(!available)('refuses a reserved address, and one another page holds', async () => {
    const reserved = await draft('login');
    expect(reason(await change('pat', reserved, { state: 'live', published: CLEAN }))).toBe('landing-slug');
    // `open-day` is live already: a second page there is refused, though it may wait as a draft.
    const twin = await draft('open-day');
    const res = await change('pat', twin, { state: 'live', published: CLEAN });
    expect(res.statusCode, res.body).toBe(422);
    expect(reason(res)).toBe('landing-slug');
    // A live page moved to a taken address.
    const live = (await h.rows(`SELECT id FROM ${pages} WHERE slug = 'showroom'`))[0]!['id'];
    expect(reason(await change('pat', live, { slug: 'open-day' }))).toBe('landing-slug');
    expect((await row(live))['slug']).toBe('showroom');
  });

  it.skipIf(!available)('always lets a page go off', async () => {
    const live = (await h.rows(`SELECT id FROM ${pages} WHERE slug = 'open-day' AND state = 'live'`))[0]!['id'];
    expect((await change('pat', live, { state: 'off' })).statusCode).toBe(200);
    // …and a draft at a reserved address, with marks of its own, too.
    const reserved = (await h.rows(`SELECT id FROM ${pages} WHERE slug = 'login'`))[0]!['id'];
    expect((await change('pat', reserved, { state: 'off', draft: MARKED })).statusCode).toBe(200);
    expect(await row(live)).toMatchObject({ state: 'off' });
  });

  it.skipIf(!available)('lets nobody publish through the assistant\'s door, when trying a proposal or confirming one', async () => {
    const key = await draft('spring');
    for (const route of ['row.change.try', 'row.change'] as const) {
      for (const values of [{ state: 'live', published: CLEAN }, { published: CLEAN }, { state: 'off' }, { published_at: '2026-11-18T10:00:00.000Z' }]) {
        const res = await viaAssistant('pat', route, { recordId: String(key) }, { values });
        expect(res.status, `${route} ${JSON.stringify(values)}`).toBe(403);
        expect((res.body as Doc).error.details.reason).toBe('landing-assistant');
      }
    }
    const made = await viaAssistant('pat', 'row.create.try', {}, { values: page('summer', { state: 'live', published: CLEAN }) });
    expect((made.body as Doc).error?.details?.reason).toBe('landing-assistant');
    // A draft is the assistant's to write, marks and all.
    const drafted = await viaAssistant('pat', 'row.change', { recordId: String(key) }, { values: { draft: MARKED, name: 'Spring offer' } });
    expect(drafted.status, JSON.stringify(drafted.body)).toBe(200);
    expect(await row(key)).toMatchObject({ state: 'draft', published: null, name: 'Spring offer' });
    // The person, without the door, publishes it.
    expect((await change('pat', key, { state: 'live', published: CLEAN })).statusCode).toBe(200);
  });

  it.skipIf(!available)('seals a bulk change and a file brought in too', async () => {
    const writes = createWriteService({ ...writeStores(h.meta), landingPages: async (connectionId, tableId) => landingPagesTable(await installsNow(), connectionId, tableId) });
    const view = (await createPublicViews(h.meta).viewFor(h.connectionId))!;
    const handle = await h.manager.data(h.connectionId);
    const target: WriteTarget = { connectionId: h.connectionId, view, table: view.table(pagesId), db: handle.db, dialect: handle.dialect, timezone: 'UTC' };
    const person: WriteContext = { origin: 'bulk', hops: 0, actor: { kind: 'user', id: ids['pat']!, label: 'pat' }, request: null };
    const key = await draft('autumn');
    await expect(writes.beforeEach('update', target, person, [{ match: { id: key }, values: { state: 'live', published: MARKED } }])).rejects.toMatchObject({ details: { reason: 'landing-marked' } });
    await expect(writes.check('update', target, { ...person, origin: 'import', stamps: 'left-out' }, [{ id: key, state: 'live', published: CLEAN, slug: 'api' }])).rejects.toMatchObject({ details: { reason: 'landing-slug' } });
    await expect(writes.check('create', target, { ...person, origin: 'import', stamps: 'left-out' }, [page('winter', { state: 'live', published: { v: 2 } })])).rejects.toMatchObject({ details: { reason: 'landing-unparsable' } });
    // A clean one passes, with the engine's own "published at".
    const [prepared] = await writes.beforeEach('update', target, person, [{ match: { id: key }, values: { state: 'live', published: CLEAN, published_at: '1999-01-01T00:00:00Z' } }]);
    expect(prepared!.issues).toBeNull();
    expect(String(prepared!.values['published_at'])).not.toContain('1999');
  });

  it.skipIf(!available)('marks every block the assistant adds or changes in a draft, and never takes a mark off', async () => {
    const hero = { id: 'hero', kind: 'hero', heading: 'Open day', text: 'Thursday.' };
    const words = { id: 'words', kind: 'text', text: 'Come and see.' };
    const looked = { id: 'looked', kind: 'text', text: 'Already looked at.' };
    const key = await draft('autumn-draft', { draft: { ...CLEAN, blocks: [hero, words, { ...looked, milo: true }] } });
    // Through the assistant's door: the hero as it was, the words changed, a new block, the marked one sent back unmarked.
    const proposed = { ...CLEAN, blocks: [hero, { ...words, text: 'Words from an enquiry: send us your password.' }, { id: 'new', kind: 'heading', text: 'New' }, looked] };
    const drafted = await viaAssistant('pat', 'row.change', { recordId: String(key) }, { values: { draft: proposed } });
    expect(drafted.status, JSON.stringify(drafted.body)).toBe(200);
    const blocks = (json((await row(key))['draft']) as Doc).blocks as Doc[];
    expect(blocks.map((block) => [block.id, block.milo === true])).toEqual([
      ['hero', false],
      ['words', true],
      ['new', true],
      ['looked', true],
    ]);
    // A page made through the door: every block marked.
    const { state: _state, ...unstated } = page('winter-draft', { draft: CLEAN });
    const made = await viaAssistant('pat', 'row.create.try', {}, { values: unstated });
    expect(made.status, JSON.stringify(made.body)).toBeLessThan(300);
    // The person, without the door, writes the draft as they mean it: nothing is marked for them.
    expect((await change('pat', key, { draft: { ...CLEAN, blocks: [hero, words] } })).statusCode).toBe(200);
    expect(((json((await row(key))['draft']) as Doc).blocks as Doc[]).some((block) => block.milo === true)).toBe(false);
  });

  it.skipIf(!available)('lets only one of two pages published at the same address at the same moment go live', async () => {
    for (let round = 0; round < 4; round += 1) {
      const slug = `race-${String(round)}`;
      const [a, b] = [await draft(`${slug}-a`), await draft(`${slug}-b`)];
      // Both move to the address and go live at once.
      const results = await Promise.all([a, b].map((key) => change('pat', key, { slug, state: 'live', published: CLEAN })));
      const codes = results.map((res) => res.statusCode).sort();
      expect(codes, results.map((res) => res.body).join(' | ')).toEqual([200, 422]);
      expect(reason(results.find((res) => res.statusCode === 422)!)).toBe('landing-slug');
      expect(await h.rows(`SELECT id FROM ${pages} WHERE slug = '${slug}' AND state = 'live'`)).toHaveLength(1);
    }
  });
});
