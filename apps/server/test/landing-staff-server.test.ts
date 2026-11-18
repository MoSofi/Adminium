// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT A LANDING PAGES ADD-ON'S SCREENS ASK THE ENGINE, ON THE REAL SERVER: a
 * forms add-on and a landing pages add-on installed beside the dashboard, on
 * SQLite, Postgres and MySQL, each read as the person a rule limits.
 *
 *  - Milo's draft: refused to someone who may not use Milo, and to someone
 *    who may not change the pages; the model is told the description, the
 *    business and the live forms by name and key, never a row; quotes and
 *    links to other websites are left out, every block is marked, a state or
 *    a published copy is never answered; a broken answer is asked once more,
 *    then refused; the person's allowance is spent, and refused once used;
 *    audited without the description.
 *  - A draft written into a page and copied to its published copy is refused
 *    by the publish seal until its marks are gone.
 *  - The live forms: only forms the person may read, only live ones, with
 *    their languages, and a landing ending that says whether its page is live.
 *  - A funnel's rule: its name and chips for a reader of funnels with no
 *    system permission, `canOpen` only for a rule manager; a rule gone says
 *    `removed`, none `none`.
 *  - The forms door serves a `landing` ending as its live page's address on
 *    the host asked, and the default thanks for a page that is off.
 */
import { automationsRepo, auditRepo, permissionsRepo, rolesRepo, settingsRepo, usersRepo, paymentSettingsRepo } from '@adminium/meta';
import type { ProviderClient } from '@adminium/llm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { formsAddOn } from '../../../packages/manifest/test/forms-fixture.js';
import { landingAddOn } from '../../../packages/manifest/test/landing-fixture.js';
import { recordDeciderTrust } from '../src/add-ons/decider-trust.js';
import { composeServer, type ComposedServer } from '../src/compose.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import { createPublicViews } from '../src/public-api/runtime.js';
import { PAY_PAGE_DOC, payPageSchema } from '../src/routes/payments/ways.js';
import { matrixRowsFromGrants } from '../src/rbac/permissions.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { adminPasswordHash, ADMIN_PASSWORD, sessionCookie } from './auth-helpers.js';
import { published, SHOWROOM, SHOWROOM_SETTINGS, words } from './forms-door.helpers.js';
import { makeEnv, TEST_SECRET } from './helpers.js';
import { LEGS } from './invoicing-install.helpers.js';

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- a reply read freely

const CLEAN = { v: 1, title: 'Open day', description: 'Sit in the new booths and try the desks.', blocks: [{ id: 'hero', kind: 'hero', heading: 'Open day at our Leeds showroom', text: 'Thursday 18 September, 10:00 to 19:00.' }] };
const ORIGIN_HOST = 'forms.meridian.example';
const CONNECTION = { id: 'database', provider: 'anthropic', source: 'database', model: 'claude-test', baseUrl: null } as never;

describe.each(LEGS)('a landing pages add-on\'s staff reads — %s', (dialect, available) => {
  let h: Harness;
  let composed: ComposedServer;
  const tables: Record<string, string> = {};
  const tableIds: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const keys: Record<string, string> = {};
  const cookies: Record<string, string> = {};
  let signIns = 0;
  let ruleId = '';

  /** What the model is asked, and what it answers next (a queue; the last answer repeats). */
  const asked: Parameters<ProviderClient['complete']>[0][] = [];
  let answers: string[] = [];
  const model: ProviderClient = {
    id: 'anthropic',
    listModels: async () => [],
    test: async () => ({ ok: true, model: 'claude-test', latencyMs: 1 }),
    async complete(request) {
      asked.push(structuredClone(request));
      const text = answers.length > 1 ? answers.shift()! : (answers[0] ?? '');
      return { text, usage: { inputTokens: 900, outputTokens: 300 } };
    },
  };

  const as = (who: string, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) =>
    composed.app.inject({ method, url, headers: { cookie: cookies[who]! }, ...(payload === undefined ? {} : { payload: payload as Doc }) });
  const draft = (who: string, body: Doc) => as(who, 'POST', '/api/v1/landing/landing-pages/draft', body);
  const reason = (res: { body: string }): unknown => (JSON.parse(res.body) as Doc).error?.details?.reason;

  /** Someone with these grants (or, with `superAdmin`, the Super Admin role), signed in. */
  async function person(key: string, grants: string[], superAdmin = false): Promise<void> {
    const user = await usersRepo(h.meta).create({ email: `${key}@meridian.example`, name: key, passwordHash: await adminPasswordHash() });
    ids[key] = user.id;
    const role = superAdmin ? (await rolesRepo(h.meta).findBySlug('super-admin'))! : await rolesRepo(h.meta).create({ slug: `lp-${key}`, name: `Landing ${key}` });
    for (const one of matrixRowsFromGrants(grants).rows) await permissionsRepo(h.meta).grant(role.id, one.resourceKind, one.resourceRef, one.actions as never);
    await rolesRepo(h.meta).assignToUser(user.id, role.id);
    signIns += 1;
    const res = await composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: `10.8.${String(Math.floor(signIns / 250))}.${String(signIns % 250)}`, payload: { email: `${key}@meridian.example`, password: ADMIN_PASSWORD } });
    expect(res.statusCode, res.body).toBe(200);
    cookies[key] = sessionCookie(res.headers['set-cookie']);
  }

  /** A row put straight into a table (no seal, no rule): answers its key, as text. */
  async function insert(ref: string, values: Doc, key: string): Promise<string> {
    const { db } = await h.manager.data(h.connectionId);
    await db.insertInto(tables[ref]!).values(values as never).execute();
    const found = (await h.rows(`SELECT ${key} AS k FROM ${tables[ref]!} ORDER BY ${key}`)).map((row) => String(row['k']));
    return found[found.length - 1]!;
  }
  const page = async (slug: string, state: string, document: unknown) =>
    insert('landing-pages:pages', { name: `Page ${slug}`, slug, state, language: 'en-US', draft: JSON.stringify(document), published: state === 'draft' ? null : JSON.stringify(document), updated_at: '2026-11-18 09:00:00' }, 'id');
  const form = async (id: string, slug: string, state: string, definition: unknown): Promise<string> => {
    const { db } = await h.manager.data(h.connectionId);
    await db.insertInto(tables['forms:forms']!).values({ id, title: slug, slug, kind: 'form', state, definition: '{}', settings: '{}', published: published(definition, SHOWROOM_SETTINGS) } as never).execute();
    return id;
  };

  beforeAll(async () => {
    if (!available) return;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageAddOn(formsAddOn(), { bundled: true });
    await h.stageAddOn(landingAddOn(), { bundled: true });
    for (const key of ['forms', 'landing-pages']) {
      const installed = await h.inject({ method: 'POST', url: '/add-ons', payload: { key, version: '1.0.0', attachTo: ['dashboard'] } });
      expect(installed.statusCode, installed.body).toBe(200);
      await recordDeciderTrust(h.meta, { key, version: '1.0.0', integrity: (await h.addOnStore.verifyTree(key, '1.0.0')).integrity });
    }
    for (const record of await h.meta.db.selectFrom('adminium_app_tables').select(['appKey', 'ref', 'tableName']).execute()) tables[`${record.appKey}:${record.ref}`] = record.tableName;

    const settings = settingsRepo(h.meta);
    await settings.set('system.publicOrigin', `https://${ORIGIN_HOST}`, { updatedBy: null });
    await settings.set('privacy.businessName', 'Meridian Workplace Ltd', { updatedBy: null });
    await settings.set('privacy.noticeUrl', 'https://www.meridian.example/privacy', { updatedBy: null });
    await settings.set('assistant.dailyTokens', 500_000, { updatedBy: null });
    await paymentSettingsRepo(h.meta).set(PAY_PAGE_DOC, payPageSchema, { shopName: 'Meridian', logoFileId: null, contactEmail: 'hello@meridian.example', contactPhone: null, shopCountry: 'GB', showLines: false });

    // Pages: one live, one off, one a draft (never published).
    keys['open-day'] = await page('open-day', 'live', CLEAN);
    keys['old-offer'] = await page('old-offer', 'off', CLEAN);
    keys['spring'] = await page('spring', 'draft', CLEAN);
    // Live, but with a published copy that still carries the assistant's mark (put there by hand, past the seal): never a page to send anyone to.
    keys['marked'] = await page('marked-live', 'live', { ...CLEAN, blocks: [{ ...CLEAN.blocks[0], milo: true }] });
    // Forms: live, a draft, a closed one, one that no longer parses, and two that end on a landing page.
    keys['showroom'] = await form('frm_showroom', 'showroom-visit', 'live', SHOWROOM);
    await form('frm_draft', 'spring-draft', 'draft', SHOWROOM);
    await form('frm_closed', 'old-form', 'closed', SHOWROOM);
    await form('frm_broken', 'broken', 'live', { v: 1 });
    await form('frm_to_live', 'to-open-day', 'live', { ...SHOWROOM, title: words('Come to the open day'), ending: { kind: 'landing', page: keys['open-day'], addOn: 'landing-pages' } });
    await form('frm_to_off', 'to-old-offer', 'live', { ...SHOWROOM, title: words('The old offer'), ending: { kind: 'landing', page: keys['old-offer'], addOn: 'landing-pages' } });

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
      landingSeams: {
        drafts: {
          default: async () => ({ connection: CONNECTION, model: 'claude-test' }),
          refusal: () => null,
          client: async () => ({ client: model, provider: 'anthropic', model: 'claude-test', baseUrl: null, maxOutputTokens: 8000 }) as never,
        },
      },
    });
    await composed.app.ready();
    await composed.addOnsLoaded;
    await composed.jobs.worker.stop();
    composed.jobs.scheduler.stop();

    const view = (await createPublicViews(h.meta).viewFor(h.connectionId))!;
    for (const ref of ['landing-pages:pages', 'landing-pages:funnels', 'forms:forms']) tableIds[ref] = view.table(tables[ref]!).id;
    const t = (ref: string, ...actions: string[]) => actions.map((action) => `table:${h.connectionId}:${tableIds[ref]!}:${action}`);

    // A rule a funnel names, with an address and a template only its managers read.
    const rule = await automationsRepo(h.meta).create({
      connectionId: h.connectionId,
      name: 'Brochure follow-up',
      trigger: { kind: 'record', event: 'created', connectionId: h.connectionId, table: tableIds['forms:forms']!, watch: false },
      graph: {
        version: 1,
        nodes: [
          { id: 't', kind: 'trigger', title: 'Form sent', sub: null },
          { id: 'a', kind: 'action', title: 'E-mail the brochure', sub: 'to secret@meridian.example', onError: false, action: { kind: 'email', templateKey: 'brochure-pack', to: { kind: 'fixed', addresses: ['secret@meridian.example'] }, vars: {} } },
          { id: 'w', kind: 'wait', title: 'Wait 2 days', sub: null, amount: 2, unit: 'days' },
        ],
      } as never,
    });
    ruleId = rule.id;
    keys['linked'] = await insert('landing-pages:funnels', { name: 'Open day', steps: JSON.stringify([{ kind: 'page', key: keys['open-day'] }]), rule_id: rule.id }, 'id');
    keys['unruled'] = await insert('landing-pages:funnels', { name: 'No rule', steps: '[]', rule_id: null }, 'id');
    keys['ruleless'] = await insert('landing-pages:funnels', { name: 'Rule gone', steps: '[]', rule_id: 'auto_gone000000000000000000' }, 'id');

    // Mara is the marketer: she reads and writes pages and funnels, reads the forms, uses Milo, and holds no system permission but that.
    await person('mara', [...t('landing-pages:pages', 'read', 'create', 'update'), ...t('landing-pages:funnels', 'read'), ...t('forms:forms', 'read'), 'system:assistant:use']);
    // Rex reads pages only: no Milo, no forms.
    await person('rex', t('landing-pages:pages', 'read'));
    // Uma may use Milo and read the pages, never change them.
    await person('uma', [...t('landing-pages:pages', 'read'), ...t('forms:forms', 'read'), 'system:assistant:use']);
    // Nik reads the forms only: not the pages, not the funnels.
    await person('nik', t('forms:forms', 'read'));
    // Ada manages rules, and reads funnels.
    await person('ada', [...t('landing-pages:funnels', 'read'), 'system:automations:manage']);
    // The admin.
    await person('root', [], true);
    // Lena reads the pages, and only the live forms and the funnels named "Open day" (row limits): told of no form and no funnel's rule here.
    await person('lena', t('landing-pages:pages', 'read'));
    const lenaRole = (await rolesRepo(h.meta).findBySlug('lp-lena'))!;
    const limited = (ref: string, column: string, values: string[]) =>
      permissionsRepo(h.meta).grant(lenaRole.id, 'table', matrixRowsFromGrants(t(ref, 'read')).rows[0]!.resourceRef, { read: true, create: false, update: false, delete: false, export: false, import: false, rowLimit: { read: { reach: 'all', while: { column, in: values } } } } as never);
    await limited('forms:forms', 'state', ['live']);
    await limited('landing-pages:funnels', 'name', ['Open day']);
  }, 300_000);

  afterAll(async () => {
    if (!available) return;
    await composed?.app.close();
    await h?.close();
  });

  const MODEL_PAGE = () => ({
    v: 1,
    title: 'Open day',
    description: 'Come and try the booths.',
    state: 'live',
    published: CLEAN,
    blocks: [
      { id: 'hero', kind: 'hero', heading: 'Open day', text: 'Thursday 18 September.', button: { label: 'Our shop', link: { kind: 'url', href: 'https://shop.example/' } } },
      { id: 'said', kind: 'quote', text: 'Best booths in Leeds.', who: 'A customer' },
      { id: 'book', kind: 'button', label: 'Book a visit', link: { kind: 'form' } },
      { id: 'more', kind: 'button', label: 'The open day', link: { kind: 'page', key: keys['open-day'] } },
      { id: 'form', kind: 'form', form: keys['showroom'], addOn: 'forms' },
    ],
  });

  it.skipIf(!available)('refuses a draft to someone who may not use Milo, or may not change the pages; nothing is asked', async () => {
    asked.length = 0;
    answers = [JSON.stringify(MODEL_PAGE())];
    const noMilo = await draft('rex', { description: 'An open day page', language: 'en-US' });
    expect(noMilo.statusCode).toBe(403);
    expect(reason(noMilo)).toBe('assistant-use');
    const noChange = await draft('uma', { description: 'An open day page', language: 'en-US' });
    expect(noChange.statusCode).toBe(403);
    expect(reason(noChange)).toBe('landing-pages-update');
    expect(asked).toHaveLength(0);
    // An add-on that is not a landing pages add-on has no drafts.
    expect((await as('mara', 'POST', '/api/v1/landing/forms/draft', { description: 'x', language: 'en-US' })).statusCode).toBe(404);
  });

  it.skipIf(!available)('drafts a page: told no row, quotes and links to other websites left out, every block marked, never a state', async () => {
    asked.length = 0;
    answers = [JSON.stringify(MODEL_PAGE())];
    const res = await draft('mara', { description: 'An open day page for the Leeds showroom', language: 'en-US', pageKey: keys['spring'] });
    expect(res.statusCode, res.body).toBe(200);
    const data = (res.json() as Doc).data;
    expect(Object.keys(data.page).sort()).toEqual(['blocks', 'description', 'title', 'v']);
    expect(data.page.blocks.map((block: Doc) => block.id)).toEqual(['hero', 'book', 'more', 'form']);
    expect(data.page.blocks.every((block: Doc) => block.milo === true)).toBe(true);
    expect(data.page.blocks[0]).not.toHaveProperty('button');
    expect(JSON.stringify(data.page)).not.toContain('"url"');
    expect(data.left).toEqual(expect.arrayContaining([{ what: 'quote', block: 'said' }, { what: 'link', block: 'hero', label: 'Our shop' }]));
    expect(data.tokens).toBe(1200);

    // What the model was told: the description, the business, the live forms by name and key. No row of any table.
    expect(asked).toHaveLength(1);
    const sent = JSON.stringify(asked[0]);
    expect(asked[0]!).not.toHaveProperty('tools');
    expect(asked[0]!.messages).toHaveLength(1);
    expect(sent).toContain('An open day page for the Leeds showroom');
    expect(sent).toContain('Meridian');
    expect(sent).toContain(`\\"key\\":\\"${keys['showroom']!}\\",\\"name\\":\\"Book a showroom visit\\"`);
    expect(sent).not.toContain('Thursday 18 September, 10:00 to 19:00');
    expect(sent).not.toContain('Page open-day');
    expect(sent).not.toContain('Brochure follow-up');
    expect(sent).not.toContain('frm_draft');
    expect(sent).not.toContain('frm_broken');

    // Audited as Milo's work, without what was asked for.
    const entries = (await auditRepo(h.meta).list({ limit: 50 })).filter((entry) => entry.action === 'landing.draft');
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]).toMatchObject({ category: 'llm' });
    expect(JSON.stringify(entries[0])).toContain('drafted');
    expect(JSON.stringify(entries[0])).not.toContain('Leeds showroom');
  });

  it.skipIf(!available)('asks once more with the issues of a broken answer, then refuses', async () => {
    asked.length = 0;
    answers = ['{"v":1,"title":"Open day"', JSON.stringify(MODEL_PAGE())];
    const fixed = await draft('mara', { description: 'An open day page', language: 'en-US' });
    expect(fixed.statusCode, fixed.body).toBe(200);
    expect(asked).toHaveLength(2);
    expect(asked[1]!.messages).toHaveLength(3);
    expect(asked[1]!.messages[2]!.content).toContain('not-json');

    asked.length = 0;
    answers = ['{"v":1,"title":"Open day","blocks":[{"id":"x","kind":"footer"}]}'];
    const refused = await draft('mara', { description: 'An open day page', language: 'en-US' });
    expect(refused.statusCode).toBe(502);
    expect((refused.json() as Doc).error.code).toBe('LANDING_DRAFT_FAILED');
    expect(reason(refused)).toBe('draft-failed');
    expect(asked).toHaveLength(2);
  });

  it.skipIf(!available)('spends the person\'s own allowance, and refuses once it is used', async () => {
    answers = [JSON.stringify(MODEL_PAGE())];
    await settingsRepo(h.meta).set('assistant.dailyTokens', 1000, { updatedBy: null });
    try {
      asked.length = 0;
      const spent = await draft('mara', { description: 'An open day page', language: 'en-US' });
      expect(spent.statusCode).toBe(429);
      expect(reason(spent)).toBe('allowance');
      expect(asked).toHaveLength(0);
    } finally {
      await settingsRepo(h.meta).set('assistant.dailyTokens', 500_000, { updatedBy: null });
    }
  });

  it.skipIf(!available)('a drafted page cannot be published until its marks are gone', async () => {
    answers = [JSON.stringify(MODEL_PAGE())];
    const drafted = ((await draft('mara', { description: 'An open day page', language: 'en-US' })).json() as Doc).data.page as Doc;
    const base = `/api/v1/data/${h.connectionId}/${tableIds['landing-pages:pages']!}`;
    const made = await as('mara', 'POST', base, { values: { name: 'Drafted', slug: 'drafted', state: 'draft', language: 'en-US', draft: drafted, updated_at: '2026-11-18T09:00:00.000Z' } });
    expect(made.statusCode, made.body).toBeLessThan(300);
    const key = (made.json() as Doc).data.id as unknown;
    const marked = await as('mara', 'PATCH', `${base}/${String(key)}`, { values: { state: 'live', published: drafted } });
    expect(marked.statusCode, marked.body).toBe(422);
    expect(reason(marked)).toBe('landing-marked');
    const looked = { ...drafted, blocks: (drafted.blocks as Doc[]).map(({ milo: _milo, ...block }) => block) };
    const live = await as('mara', 'PATCH', `${base}/${String(key)}`, { values: { state: 'live', published: looked } });
    expect(live.statusCode, live.body).toBe(200);
  });

  it.skipIf(!available)('lists only the live forms the person may read, with their languages and endings', async () => {
    const res = await as('mara', 'GET', '/api/v1/landing/landing-pages/forms');
    expect(res.statusCode, res.body).toBe(200);
    const forms = (res.json() as Doc).data.forms as Doc[];
    expect(forms.map((one) => one.slug).sort()).toEqual(['showroom-visit', 'to-old-offer', 'to-open-day']);
    const install = await h.meta.db.selectFrom('adminium_manifests').select('id').where('manifestKey', '=', 'forms').executeTakeFirstOrThrow();
    expect(forms.find((one) => one.slug === 'showroom-visit')).toEqual({
      addOn: 'forms',
      installId: install.id,
      key: keys['showroom'],
      name: 'Book a showroom visit',
      slug: 'showroom-visit',
      languages: ['en-US', 'de-DE', 'ar-EG'],
      ending: { kind: 'words', words: words("We'll confirm your visit within one working day.") },
    });
    expect(forms.find((one) => one.slug === 'to-open-day')!.ending).toEqual({ kind: 'landing', page: keys['open-day'], addOn: 'landing-pages', broken: false });
    expect(forms.find((one) => one.slug === 'to-old-offer')!.ending).toEqual({ kind: 'landing', page: keys['old-offer'], addOn: 'landing-pages', broken: true });
    // Rex reads the pages and no form: none listed. Nik reads forms, not pages: refused.
    expect(((await as('rex', 'GET', '/api/v1/landing/landing-pages/forms')).json() as Doc).data.forms).toEqual([]);
    expect((await as('nik', 'GET', '/api/v1/landing/landing-pages/forms')).statusCode).toBe(403);
    // Lena is held to some forms: she is told of none.
    expect(((await as('lena', 'GET', '/api/v1/landing/landing-pages/forms')).json() as Doc).data.forms).toEqual([]);
  });

  it.skipIf(!available)('lists the live pages of every landing pages add-on whose pages the person may read', async () => {
    const res = await as('mara', 'GET', '/api/v1/landing/live-pages');
    expect(res.statusCode, res.body).toBe(200);
    const pages = (res.json() as Doc).data.pages as Doc[];
    const install = await h.meta.db.selectFrom('adminium_manifests').select('id').where('manifestKey', '=', 'landing-pages').executeTakeFirstOrThrow();
    expect(pages).toContainEqual({ addOn: 'landing-pages', installId: install.id, key: keys['open-day'], name: 'Page open-day', slug: 'open-day', language: 'en-US' });
    // Never an off page, a draft, or a live one still marked; never a page's content.
    for (const slug of ['old-offer', 'spring', 'marked-live']) expect(pages.map((one) => one.slug)).not.toContain(slug);
    expect(res.body).not.toContain('Thursday 18 September');
    // Nik may read no add-on's pages: none listed.
    expect(((await as('nik', 'GET', '/api/v1/landing/live-pages')).json() as Doc).data.pages).toEqual([]);
  });

  it.skipIf(!available)('reads a funnel\'s rule as its name and chips; only a rule manager may open it', async () => {
    const url = (key: string) => `/api/v1/landing/landing-pages/funnels/${key}/rule`;
    const marketer = await as('mara', 'GET', url(keys['linked']!));
    expect(marketer.statusCode, marketer.body).toBe(200);
    expect((marketer.json() as Doc).data).toEqual({
      state: 'linked',
      name: 'Brochure follow-up',
      enabled: false,
      chips: [
        { kind: 'trigger', title: 'Form sent', on: 'record', event: 'created' },
        { kind: 'action', title: 'E-mail the brochure', action: 'email' },
        { kind: 'wait', title: 'Wait 2 days', amount: 2, unit: 'days' },
      ],
      canOpen: false,
    });
    expect(marketer.body).not.toContain('secret@meridian.example');
    expect(marketer.body).not.toContain('brochure-pack');
    // The marketer cannot read the rule itself.
    expect((await as('mara', 'GET', `/api/v1/automations/${ruleId}`)).statusCode).toBe(403);
    const manager = (await as('ada', 'GET', url(keys['linked']!))).json() as Doc;
    expect(manager.data).toMatchObject({ state: 'linked', canOpen: true, ruleId });
    const admin = (await as('root', 'GET', url(keys['linked']!))).json() as Doc;
    expect(admin.data).toMatchObject({ canOpen: true, ruleId });

    expect(((await as('mara', 'GET', url(keys['unruled']!))).json() as Doc).data).toEqual({ state: 'none' });
    expect(((await as('mara', 'GET', url(keys['ruleless']!))).json() as Doc).data).toEqual({ state: 'removed' });
    expect((await as('mara', 'GET', url('424242'))).statusCode).toBe(404);
    expect((await as('mara', 'GET', url(`${keys['linked']!}abc`))).statusCode).toBe(404);
    expect((await as('nik', 'GET', url(keys['linked']!))).statusCode).toBe(403);
    // Lena is held to some funnels: refused, even for one she reaches.
    const held = await as('lena', 'GET', url(keys['linked']!));
    expect(held.statusCode).toBe(403);
    expect(reason(held)).toBe('landing-funnels-rows');
  });

  it.skipIf(!available)('serves a landing ending as its live page\'s address on the host asked, else the default thanks', async () => {
    const read = async (slug: string, host: string) => {
      const res = await composed.app.inject({ method: 'GET', url: `/x/forms/api/${slug}`, headers: { host } });
      expect(res.statusCode, res.body).toBe(200);
      return ((res.json() as Doc).form as Doc).definition.ending as Doc;
    };
    const ending = await read('to-open-day', ORIGIN_HOST);
    expect(ending).toEqual({ kind: 'page', url: expect.stringMatching(new RegExp(`^https?://${ORIGIN_HOST.replaceAll('.', '\\.')}/x/pages/open-day$`)) });
    expect(await read('to-old-offer', ORIGIN_HOST)).toEqual({ kind: 'words', words: {} });
    // A form with an ending of its own words is served as it always was.
    expect(await read('showroom-visit', ORIGIN_HOST)).toEqual({ kind: 'words', words: { 'en-US': "We'll confirm your visit within one working day." } });
  });
});
