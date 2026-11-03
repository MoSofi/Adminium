// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT A FORMS ADD-ON'S PAGES READ OF THE ENGINE, on SQLite, Postgres and
 * MySQL, over the real server:
 *
 *  - a form's results, counted over every answer (more than one page of
 *    them: no cap), across its languages, with how many were invited and how
 *    many of them answered: the very counts the forms vocabulary gives for
 *    all the answers at once; for a reader who may read the answers, and
 *    refused to one who may not;
 *  - the builder's table list: exactly the tables an app on the add-on's
 *    database opens to forms (never one opened under another key), each with
 *    its app's name and the columns an answer may fill, the link columns
 *    marked; never readable from the add-on's page as a host table.
 */
import { summarise, parseForm } from '@adminium/add-on-contracts/forms';
import { permissionsRepo, rolesRepo, snapshotsRepo, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { formsWithInvitations } from '../../../packages/manifest/test/forms-invitations-fixture.js';
import { bindWriteValue } from '../src/crud/write-values.js';
import { SUMMARY_PAGE } from '../src/forms/summary.js';
import { createPublicViews } from '../src/public-api/runtime.js';
import { ADMIN_PASSWORD, adminPasswordHash, sessionCookie } from './auth-helpers.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { shopManifest } from './fixtures/cards-kit/index.js';
import { FIT_OUT, NAMED, published } from './forms-door.helpers.js';
import { LEGS } from './invoicing-install.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- a reply read freely

const pk = { ref: 'id', type: 'int', role: 'pk' };
const NOW = Date.parse('2026-11-02T12:00:00Z');
/** More answers than one page reads. */
const ANSWERS = SUMMARY_PAGE * 2 + 37;

/** The shop, opening its enquiries and its feedback to forms beside its public product list. */
function shopWithForms(): Doc {
  const base = shopManifest() as Doc;
  return {
    ...base,
    compatibility: { minAdminiumVersion: '0.3.40', engines: ['postgres', 'mysql', 'sqlite'] },
    requiredSchema: {
      ...base['requiredSchema'],
      tables: [
        ...base['requiredSchema'].tables,
        { ref: 'jobs', columns: [pk, { ref: 'title', type: 'text', maxLength: 80 }] },
        {
          ref: 'enquiries',
          label: 'Enquiries',
          columns: [pk, { ref: 'name', type: 'text', maxLength: 80, label: 'Name' }, { ref: 'email', type: 'text', maxLength: 254, nullable: true, label: 'E-mail' }, { ref: 'source', type: 'text', maxLength: 80, nullable: true }],
        },
        {
          ref: 'feedback',
          label: 'Customer feedback',
          columns: [
            pk,
            { ref: 'job_id', type: 'fk', references: 'jobs', unique: true, label: 'Job' },
            { ref: 'score', type: 'int', label: 'Score' },
            { ref: 'text', type: 'text', maxLength: 1000, nullable: true, label: 'What they said' },
          ],
        },
      ],
    },
    publicAccess: [
      { table: 'products', methods: ['GET'], select: ['id', 'name', 'price'] },
      { table: 'enquiries', methods: ['POST'], key: 'forms', writable: ['name', 'email', 'source'], anonymous: { perKeyHour: 100, plainText: ['name'] } },
      { table: 'feedback', methods: ['POST'], key: 'forms', writable: ['job_id', 'score', 'text'], anonymous: { perKeyHour: 100 } },
    ],
  };
}

describe.each(LEGS)('what a forms add-on\'s pages read of the engine — %s', (dialect, available) => {
  let h: Harness;
  let served: Served;
  let views: ReturnType<typeof createPublicViews>;
  const cookies = new Map<string, string>();
  const ids = new Map<string, string>();
  const names: Record<string, string> = {};
  const given: { values: Record<string, unknown>; language: string }[] = [];

  const get = (url: string, as: string) => served.composed.app.inject({ method: 'GET', url, headers: { cookie: cookies.get(as)! } });

  async function insertMany(ref: string, rows: Record<string, unknown>[]): Promise<void> {
    const view = (await views.viewFor(h.connectionId))!;
    const table = view.table(names[ref]!);
    const { db } = await h.manager.data(h.connectionId);
    const bound = rows.map((values) => Object.fromEntries(Object.entries(values).map(([column, value]) => [column, value === null ? null : bindWriteValue(table.columns.get(column)!, value, dialect)])));
    for (let at = 0; at < bound.length; at += 200) await db.insertInto(table.id as never).values(bound.slice(at, at + 200) as never).execute();
  }

  async function person(name: string, grants: 'super-admin' | Record<string, Doc>): Promise<void> {
    const user = await usersRepo(h.meta).create({ email: `${name}@forms.dev`, name, passwordHash: await adminPasswordHash() });
    const login = await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: `10.3.0.${String(cookies.size + 1)}`, payload: { email: `${name}@forms.dev`, password: ADMIN_PASSWORD } });
    cookies.set(name, sessionCookie(login.headers['set-cookie']));
    const roles = rolesRepo(h.meta);
    if (grants === 'super-admin') {
      await roles.assignToUser(user.id, (await roles.findBySlug('super-admin'))!.id);
      return;
    }
    const role = await roles.create({ slug: `${name}-role`, name } as never);
    for (const [ref, actions] of Object.entries(grants)) {
      await permissionsRepo(h.meta).grant(role.id, 'table', `${h.connectionId}/${ids.get(ref)!}`, { read: false, create: false, update: false, delete: false, export: false, import: false, ...actions } as never);
    }
    await roles.assignToUser(user.id, role.id);
  }

  beforeAll(async () => {
    if (!available) return;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageApp(shopWithForms());
    const shop = await h.install('shop', '1.0.0');
    expect(shop.statusCode, shop.body).toBe(200);
    await h.stageAddOn(formsWithInvitations(), { bundled: true });
    const added = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'forms', version: '1.0.0', attachTo: ['shop'] } });
    expect(added.statusCode, added.body).toBe(200);
    const model = (await snapshotsRepo(h.meta).latest(h.connectionId))!.schema as { tables: { id: string; name: string }[] };
    for (const row of await h.meta.db.selectFrom('adminium_app_tables').select(['appKey', 'ref', 'tableName']).execute()) {
      ids.set(row.ref, model.tables.find((table) => table.name === row.tableName)!.id);
      if (row.appKey === 'forms') names[row.ref] = row.tableName;
    }
    views = createPublicViews(h.meta);
    served = await servePublic(h as never, null, { ADMINIUM_DATA_DIR: h.dataDir });

    await insertMany('forms', [{ id: 'frm_named', title: 'Aftercare', slug: 'aftercare', kind: 'survey', state: 'live', definition: '{}', settings: '{}', published: published(FIT_OUT, NAMED) }]);
    // Answers in a spread every count can be checked against: scores 0–10 round and round, stars on two of three, words on some.
    const rows: Record<string, unknown>[] = [];
    for (let n = 0; n < ANSWERS; n += 1) {
      const values: Record<string, unknown> = { qnps: n % 11 };
      if (n % 3 !== 0) values['qday'] = (n % 5) + 1;
      if (n % 7 === 0) values['qdiff'] = `Note ${String(n)}`;
      const language = n % 4 === 0 ? 'de-DE' : 'en-US';
      given.push({ values, language });
      rows.push({ id: `ans_${String(n).padStart(5, '0')}`, form_id: 'frm_named', submitted_at: new Date(NOW - n * 60_000).toISOString(), language, values: JSON.stringify(values), confirm: 'none' });
    }
    await insertMany('answers', rows);
    await insertMany(
      'invitations',
      ['a', 'b', 'c', 'd'].map((who, n) => ({
        id: `inv_${who}`,
        form_id: 'frm_named',
        email: `${who}@harbour.dev`,
        language: 'en-US',
        person_table: 'public.crm_contacts',
        person_key: who,
        class: 'service',
        invited_at: new Date(NOW - 2 * 86_400_000).toISOString(),
        answered_at: n < 2 ? new Date(NOW).toISOString() : null,
      })),
    );

    await person('boss', 'super-admin');
    await person('marketer', { answers: { read: true }, forms: { read: true } });
    await person('clerk', { forms: { read: true } });
  }, 240_000);

  afterAll(async () => {
    if (!available) return;
    await served?.close();
    await h?.close();
  });

  it.skipIf(!available)('counts every answer of a form, across its languages, with its invitations: the vocabulary\'s own counts of them all', async () => {
    const res = await get('/api/v1/add-ons/forms/forms/frm_named/summary', 'marketer');
    expect(res.statusCode, res.body).toBe(200);
    const { data } = res.json() as { data: Doc };
    const parsed = parseForm(FIT_OUT, NAMED);
    if (!parsed.ok) throw new Error('the fixture does not parse');
    expect(data).toEqual({ ...summarise(parsed.form, given), invited: 4, answered: 2 });
    expect(data['total']).toBe(ANSWERS);
    expect(data['byLanguage']).toEqual({ 'en-US': ANSWERS - Math.ceil(ANSWERS / 4), 'de-DE': Math.ceil(ANSWERS / 4) });
    expect(data['questions']['qnps'].counts.reduce((sum: number, n: number) => sum + n, 0)).toBe(ANSWERS);
  });

  it.skipIf(!available)('is refused to a reader who may not read the answers, and a form nobody has is not there', async () => {
    expect((await get('/api/v1/add-ons/forms/forms/frm_named/summary', 'clerk')).statusCode).toBe(403);
    expect((await get('/api/v1/add-ons/forms/forms/frm_nothing/summary', 'boss')).statusCode).toBe(404);
    expect((await get('/api/v1/add-ons/shop/forms/frm_named/summary', 'boss')).statusCode).toBe(404);
  });

  it.skipIf(!available)('the kit lists exactly the tables opened to forms, with their app, and the columns an answer may fill; a link marked', async () => {
    const res = await get('/api/v1/add-ons/forms/kit', 'marketer');
    expect(res.statusCode, res.body).toBe(200);
    const hosts = (res.json() as { hosts: Doc[] }).hosts;
    const forms = hosts.filter((host) => host.via === 'forms');
    expect(forms.map((host) => host.id).sort()).toEqual([ids.get('enquiries'), ids.get('feedback')].sort());
    // The product list is opened under another key: never a form's.
    expect(hosts.some((host) => host.id === ids.get('products'))).toBe(false);
    const feedback = forms.find((host) => host.id === ids.get('feedback'))!;
    expect(feedback).toMatchObject({ label: 'Customer feedback', app: 'Shop' });
    // The longest each text holds is the next read's (`forms-staff-reads.test.ts`).
    expect(feedback.columns.map(({ maxLength: _longest, ...column }: Doc) => column)).toEqual([
      { name: 'job_id', label: 'Job', kind: expect.any(String), required: true, link: true },
      { name: 'score', label: 'Score', kind: expect.any(String), required: true, link: false },
      { name: 'text', label: 'What they said', kind: 'varchar', required: false, link: false },
    ]);
    const enquiries = forms.find((host) => host.id === ids.get('enquiries'))!;
    expect(enquiries.columns.map((column: Doc) => [column.name, column.required, column.link])).toEqual([
      ['name', true, false],
      ['email', false, false],
      ['source', false, false],
    ]);
  });
});
