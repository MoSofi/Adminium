// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A link whose named row must hold what the row written holds
 * (`linkable.same`): a site visit's contact works for the company of the
 * visit's deal. On SQLite, Postgres and MySQL, through an app installed by
 * the real installer, for everybody and on every door.
 *
 *  - A new visit naming a contact of another company is refused `422`, the
 *    field's code `not-allowed`, naming nothing of the contact or the deal;
 *    the owner is held to it as a rep is. A contact of the deal's company is
 *    taken, and so is no contact.
 *  - A change that moves the contact is judged; so is a change that moves the
 *    deal, the contact staying: the visit would no longer be the deal's
 *    company's. A change of another column is not, so a visit whose contact
 *    has moved company since keeps them while its note changes.
 *  - A deal with no company matches no contact.
 *  - A deal out of a rep's reach is answered as a deal that is not there,
 *    before the rule is asked, whichever contact the visit names.
 *  - A rule's write and an import are held to it; Studio checks the pairs.
 */
import { parseDatabaseModel } from '@adminium/engine';
import { automationsRepo, snapshotsRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { columnRuleIssue } from '../src/connections/column-rules-validation.js';
import { LEGS, said, wholeServer, type Reply, type WholeServer } from './whole-server.helpers.js';

vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.28' }));

const id = { ref: 'id', type: 'int', role: 'pk' };
const en = (text: string) => ({ 'en-US': text });
const OWN = { reach: 'own' } as const;

function crm(): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'crm',
    name: 'CRM',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
    license: 'AGPL-3.0-only',
    description: { key: 'mft.crm.desc', fallback: 'A CRM.' },
    categories: ['crm'],
    compatibility: { minAdminiumVersion: '0.3.28', engines: ['postgres', 'mysql', 'sqlite'] },
    navGroups: [{ key: 'sales', label: en('Sales'), order: 1 }],
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'companies', columns: [id, { ref: 'name', type: 'text', maxLength: 80 }] },
        { ref: 'contacts', columns: [id, { ref: 'company_id', type: 'fk', references: 'companies' }, { ref: 'name', type: 'text', maxLength: 80 }] },
        {
          ref: 'deals',
          belongs: [{ column: 'owner_id', set: 'anyone' }],
          columns: [
            id,
            { ref: 'name', type: 'text', maxLength: 80 },
            { ref: 'company_id', type: 'fk', references: 'companies', nullable: true },
            { ref: 'owner_id', type: 'text', maxLength: 36, nullable: true, rules: { staff: true } },
            { ref: 'stage', type: 'enum', enum: ['lead', 'visit'], default: 'lead' },
            { ref: 'next_contact_id', type: 'int', nullable: true },
          ],
        },
        {
          ref: 'site_visits',
          belongs: [{ via: 'deal_id' }],
          columns: [
            id,
            { ref: 'deal_id', type: 'fk', references: 'deals' },
            { ref: 'contact_id', type: 'fk', references: 'contacts', nullable: true, rules: { linkable: { same: [{ column: 'company_id', as: 'deal_id.company_id' }] } } },
            { ref: 'note', type: 'text', maxLength: 80, nullable: true },
          ],
        },
      ],
    },
    roles: [
      {
        key: 'rep',
        name: 'Rep',
        permissions: ['table:@companies:read', 'table:@contacts:read', 'table:@deals:read', 'table:@site_visits:read', 'table:@site_visits:create', 'table:@site_visits:update', 'page:@crm-visits:view'],
        limits: { deals: { rows: { read: OWN } }, site_visits: { rows: { read: OWN, update: OWN } } },
      },
    ],
    pages: [{ ref: 'crm-visits', template: 'page-crud', title: { key: 't.visits', fallback: 'Visits' }, nav: { group: 'sales', icon: 'list', order: 1 }, bindings: { rows: 'site_visits' } }],
    automations: [
      {
        key: 'book-visit',
        name: en('A deal moves to visit: book one with its next contact'),
        enabled: true,
        trigger: { kind: 'record', event: 'updated', table: 'deals', changedColumn: 'stage' },
        graph: {
          version: 1,
          nodes: [
            { id: 't', kind: 'trigger', title: 'When' },
            { id: 'book', kind: 'action', title: 'Book', action: { kind: 'record.create', table: 'site_visits', values: { deal_id: '{{record.id}}', contact_id: '{{record.next_contact_id}}', note: 'booked by a rule' } } },
          ],
        },
      },
    ],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } }],
  };
}

const refused = { code: 'VALIDATION_FAILED', details: { fields: { contact_id: { code: 'not-allowed' } } } };
const errorOf = (res: Reply): unknown => (res.json() as { error: unknown }).error;

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`a visit's contact works for the visit's deal's company, on ${dialect}`, () => {
    let s: WholeServer;
    const visits = async (): Promise<number[][]> =>
      (await s.rows('SELECT id, deal_id, contact_id FROM crm_site_visits ORDER BY id')).map((row) => [Number(row['id']), Number(row['deal_id']), row['contact_id'] === null ? 0 : Number(row['contact_id'])]);

    beforeAll(async () => {
      s = await wholeServer(dialect, crm(), { people: { dana: ['rep'], omar: ['rep'] } });
      await s.rows(`INSERT INTO crm_companies (id, name) VALUES (1, 'Acme'), (2, 'Bolt')`);
      // Ada and Cy work for Acme, Ben for Bolt.
      await s.rows(`INSERT INTO crm_contacts (id, company_id, name) VALUES (1, 1, 'Ada'), (2, 2, 'Ben'), (3, 1, 'Cy')`);
      // Dana's deals: 1 with Acme, 2 with Bolt, 4 with nobody yet. Omar's: 3 with Acme.
      await s.rows(`INSERT INTO crm_deals (id, name, company_id, owner_id) VALUES (1, 'Acme roof', 1, '${s.ids['dana']!}'), (2, 'Bolt shed', 2, '${s.ids['dana']!}'), (3, 'Acme porch', 1, '${s.ids['omar']!}'), (4, 'Unknown', NULL, '${s.ids['dana']!}')`);
    }, 180_000);
    afterAll(async () => {
      await s?.close();
    });

    it('takes a contact of the deal’s company, or none, and refuses another company’s to everybody, naming nothing of either', async () => {
      expect(said(await s.make('dana', 'site_visits', { id: 101, deal_id: 1, contact_id: 1 }))).toBe('ok');
      expect(said(await s.make('dana', 'site_visits', { id: 102, deal_id: 2 }))).toBe('ok');
      const ben = await s.make('dana', 'site_visits', { id: 103, deal_id: 1, contact_id: 2 });
      expect(ben.statusCode, ben.body).toBe(422);
      expect(errorOf(ben)).toMatchObject(refused);
      expect(ben.body).not.toMatch(/Acme|Bolt|Ben|Ada|company/);
      const owner = await s.make('owner', 'site_visits', { id: 104, deal_id: 3, contact_id: 2 });
      expect(owner.statusCode, owner.body).toBe(422);
      expect(errorOf(owner)).toMatchObject(refused);
      expect(said(await s.make('owner', 'site_visits', { id: 105, deal_id: 3, contact_id: 3 }))).toBe('ok');
      expect(await visits()).toEqual([
        [101, 1, 1],
        [102, 2, 0],
        [105, 3, 3],
      ]);
    });

    it('judges a change that moves the contact, and one that moves the deal under it', async () => {
      expect(errorOf(await s.change('dana', 'site_visits', 101, { contact_id: 2 }))).toMatchObject(refused);
      expect(said(await s.change('dana', 'site_visits', 101, { contact_id: 3 }))).toBe('ok');
      // Visit 101 (Cy, of Acme) moved to Bolt's deal: Cy does not work for Bolt, sent back as it stands or not sent at all.
      expect(errorOf(await s.change('dana', 'site_visits', 101, { deal_id: 2 }))).toMatchObject(refused);
      expect(errorOf(await s.change('dana', 'site_visits', 101, { deal_id: 2, contact_id: 3 }))).toMatchObject(refused);
      expect(errorOf(await s.change('owner', 'site_visits', 101, { deal_id: 2 }))).toMatchObject(refused);
      // With Bolt's own contact, it may move.
      expect(said(await s.change('dana', 'site_visits', 101, { deal_id: 2, contact_id: 2 }))).toBe('ok');
      // A visit with no contact moves anywhere.
      expect(said(await s.change('dana', 'site_visits', 102, { deal_id: 1 }))).toBe('ok');
      expect(await visits()).toEqual([
        [101, 2, 2],
        [102, 1, 0],
        [105, 3, 3],
      ]);
    });

    it('matches no contact to a deal with no company', async () => {
      expect(errorOf(await s.make('dana', 'site_visits', { id: 106, deal_id: 4, contact_id: 1 }))).toMatchObject(refused);
      expect(said(await s.make('dana', 'site_visits', { id: 106, deal_id: 4 }))).toBe('ok');
      expect(errorOf(await s.change('dana', 'site_visits', 106, { contact_id: 2 }))).toMatchObject(refused);
    });

    it('keeps a visit whose contact has moved company since while its other columns change', async () => {
      await s.rows('UPDATE crm_contacts SET company_id = 1 WHERE id = 2');
      try {
        // Visit 101 is on Bolt's deal with Ben, who is now Acme's.
        expect(said(await s.change('dana', 'site_visits', 101, { note: 'moved on' }))).toBe('ok');
        expect(said(await s.change('dana', 'site_visits', 101, { note: 'again', contact_id: 2 }))).toBe('ok');
      } finally {
        await s.rows('UPDATE crm_contacts SET company_id = 2 WHERE id = 2');
      }
    });

    it('answers a deal out of the rep’s reach as one that is not there, whichever contact is named', async () => {
      const told = (res: Reply) => ({ status: res.statusCode, body: res.body.replace(/"requestId":"[^"]*",?/, '') });
      const matching = await s.make('dana', 'site_visits', { id: 107, deal_id: 3, contact_id: 1 });
      const other = await s.make('dana', 'site_visits', { id: 107, deal_id: 3, contact_id: 2 });
      const missing = await s.make('dana', 'site_visits', { id: 107, deal_id: 999, contact_id: 2 });
      expect(matching.statusCode, matching.body).toBe(409);
      expect(told(other)).toEqual(told(matching));
      expect(told(missing)).toEqual(told(matching));
      expect((await visits()).some(([key]) => key === 107)).toBe(false);
    });

    it('holds a rule’s write to it', async () => {
      const rule = (await automationsRepo(s.meta).listManagedBy('crm', s.connectionId)).find((one) => one.templateKey === 'book-visit')!;
      // Deal 1 is Acme's: Ben (Bolt) is refused, and the run says so; Cy is booked.
      await s.rows('UPDATE crm_deals SET next_contact_id = 2 WHERE id = 1');
      expect(said(await s.change('owner', 'deals', 1, { stage: 'visit' }))).toBe('ok');
      await s.jobs();
      await s.rows('UPDATE crm_deals SET next_contact_id = 3 WHERE id = 1');
      expect(said(await s.change('owner', 'deals', 1, { stage: 'lead' }))).toBe('ok');
      await s.jobs();
      const runs = await s.meta.db.selectFrom('adminium_automation_runs').select(['status', 'trace']).where('automationId', '=', rule.id).execute();
      expect(runs.map((run) => run.status).sort()).toEqual(['failed', 'succeeded']);
      // The refusal is the step's, by the field's code: nothing of the contact or the deal.
      const trace = runs.find((run) => run.status === 'failed')!.trace;
      const step = (typeof trace === 'string' ? (JSON.parse(trace) as { steps: { nodeId: string; log: string | null }[] }) : (trace as { steps: { nodeId: string; log: string | null }[] })).steps.find((one) => one.nodeId === 'book')!;
      expect(step.log).toBe('Some values were refused.');
      expect((await s.rows(`SELECT contact_id FROM crm_site_visits WHERE note = 'booked by a rule'`)).map((row) => Number(row['contact_id']))).toEqual([3]);
    });

    it('holds an import to it, and Studio checks the pairs an operator writes', async () => {
      const call = (method: 'GET' | 'POST', url: string, payload?: unknown, headers: Record<string, string> = {}) =>
        s.app.inject({ method, url: `/api/v1/${url}`, headers: { cookie: s.cookie['owner']!, ...headers }, ...(payload === undefined ? {} : { payload: payload as never }) });
      const csv = 'id,deal_id,contact_id\n301,1,1\n302,1,2\n303,2,2\n';
      const uploaded = await call('POST', 'imports/upload?filename=visits.csv', csv, { 'content-type': 'text/csv' });
      expect(uploaded.statusCode, uploaded.body).toBe(201);
      const made = await call('POST', 'imports', {
        fileId: (uploaded.json() as { data: { fileId: string } }).data.fileId,
        connectionId: s.connectionId,
        table: s.t('site_visits'),
        mapping: { columns: ['id', 'deal_id', 'contact_id'].map((name) => ({ from: name, to: name })) },
        options: { skipInvalid: true, mode: 'insert' },
      });
      expect(made.statusCode, made.body).toBe(201);
      const importId = (made.json() as { data: { import: { id: string } } }).data.import.id;
      const preview = (await call('GET', `imports/${importId}/preview`)).json() as { data: { lines: { row: number; status: string; column?: string }[] } };
      expect(preview.data.lines.map((line) => [line.row, line.status, line.column ?? null])).toEqual([
        [1, 'new', null],
        [2, 'refused', 'contact_id'],
        [3, 'new', null],
      ]);
      expect((await call('POST', `imports/${importId}/run`)).statusCode).toBe(202);
      await s.jobs();
      expect((await visits()).filter(([key]) => key! > 300).map(([key]) => key)).toEqual([301, 303]);

      const model = parseDatabaseModel((await snapshotsRepo(s.meta).latest(s.connectionId))!.schema);
      const table = model.tables.find((one) => one.name === 'crm_site_visits')!;
      const column = (name: string) => table.columns.find((one) => one.name === name)!;
      const issue = (value: unknown, on = 'contact_id') => columnRuleIssue('column.linkable', value, column(on), model);
      expect(issue({ same: [{ column: 'company_id', as: 'deal_id.company_id' }] })).toBeNull();
      expect(issue({ same: [{ column: 'nope', as: 'deal_id.company_id' }] })).toBe('crm_contacts has no column "nope".');
      expect(issue({ same: [{ column: 'company_id', as: 'deal_id.nope' }] })).toBe('crm_deals has no column "nope".');
      expect(issue({ same: [{ column: 'company_id', as: 'note.company_id' }] })).toBe('"note" is not a foreign key, so it names no row to read "company_id" of.');
      expect(issue({ same: [{ column: 'company_id', as: 'contact_id' }] })).toBe('crm_site_visits has no other column "contact_id" to compare with.');
      expect(issue({})).toBe('Say which rows "contact_id" may name.');
    });
  });
}
