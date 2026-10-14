// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT A RULE TELLS EACH PERSON IS WHAT THAT PERSON READS, against the whole
 * server on SQLite, Postgres and MySQL, through an app installed by the real
 * installer.
 *
 *  - A notice to a role, or to a lead, is written for each reader: a column
 *    their role is not shown is empty in theirs (the record's, as it was, and
 *    the name of the person a staff column names), as it is on their screen.
 *  - The person a staff column names is told, and mailed, only when they can
 *    open the record: else the step's other roles are told, or nobody, and
 *    the run says so. A mail to a person never carries a personal column they
 *    are not shown, and a step's own `recordUrl` is never the record's address.
 *  - A co-lead of the person's own team is not their lead.
 *  - An amount read from a setting is no way to read a table: its author must
 *    read the table, a secret or personal column and a private table are
 *    refused, and a run reads it as a rule reads the connection (a private
 *    table not at all, a secret column never), from the row with the lowest key.
 *  - A run keeps of the record as it was only the columns its rule reads, never
 *    a secret one, and lets go of it when its job gives up.
 */
import { automationRunsRepo, automationsRepo, createSqliteMetaDb, firstRun, permissionsRepo, rolesRepo, teamsRepo } from '@adminium/meta';
import BetterSqlite3 from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { registerAutomationRunHandler } from '../src/jobs/automation-run.js';
import { matrixRowsFromGrants } from '../src/rbac/permissions.js';
import { LEGS, said, wholeServer, type WholeServer } from './whole-server.helpers.js';

vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.28' }));

const id = { ref: 'id', type: 'int', role: 'pk' };
const en = (text: string) => ({ 'en-US': text });
const flow = (...nodes: Record<string, unknown>[]) => ({ version: 1, nodes: [{ id: 't', kind: 'trigger', title: 'When' }, ...nodes] });
const action = (key: string, body: Record<string, unknown>) => ({ id: key, kind: 'action', title: key, action: body });
const moved = { kind: 'record', event: 'updated', table: 'deals', changedColumn: 'stage' };

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
        {
          ref: 'deals',
          belongs: [{ column: 'owner_id', set: 'anyone' }],
          columns: [
            id,
            { ref: 'name', type: 'text', maxLength: 80 },
            { ref: 'stage', type: 'enum', enum: ['lead', 'quote', 'won'], default: 'lead' },
            { ref: 'cost', type: 'int', default: 0 },
            { ref: 'at', type: 'timestamptz', nullable: true },
            { ref: 'owner_id', type: 'text', maxLength: 36, nullable: true, rules: { staff: true } },
            { ref: 'approver_id', type: 'text', maxLength: 36, nullable: true, rules: { staff: true } },
            { ref: 'phone', type: 'text', maxLength: 40, nullable: true, rules: { personal: true } },
            { ref: 'age', type: 'int', nullable: true, rules: { personal: true } },
            { ref: 'token', type: 'text', maxLength: 40, nullable: true, rules: { secret: true } },
          ],
        },
        { ref: 'diary', private: true, belongs: [{ column: 'owner_id', set: 'anyone' }], columns: [id, { ref: 'owner_id', type: 'text', maxLength: 36, nullable: true, rules: { staff: true } }, { ref: 'mood', type: 'int', default: 0 }] },
        { ref: 'vault', columns: [id, { ref: 'pin', type: 'int', default: 0, rules: { secret: true } }, { ref: 'days', type: 'int', default: 0 }] },
        { ref: 'settings', columns: [id, { ref: 'quiet_days', type: 'int', nullable: true }] },
      ],
    },
    roles: [
      // A clerk reads every deal, but never its cost nor whose it is.
      { key: 'clerk', name: 'Clerk', permissions: ['table:@deals:read', 'page:@crm-deals:view'], limits: { deals: { readable: ['id', 'name', 'stage'] } } },
      // A rep reads only his own deals.
      { key: 'rep', name: 'Rep', permissions: ['table:@deals:read', 'table:@deals:update', 'page:@crm-deals:view'], limits: { deals: { rows: { read: { reach: 'own' }, update: { reach: 'own' } } } } },
      { key: 'reader', name: 'Reader', permissions: ['table:@deals:read', 'page:@crm-deals:view'] },
    ],
    pages: [{ ref: 'crm-deals', template: 'page-crud', title: { key: 't.deals', fallback: 'Deals' }, nav: { group: 'sales', icon: 'list', order: 1 }, bindings: { rows: 'deals' } }],
    automations: [
      {
        key: 'cost-moved',
        name: en('Stage moved: tell the clerks and readers the cost'),
        enabled: true,
        trigger: moved,
        graph: flow(action('tell', { kind: 'notification', to: { roles: ['clerk', 'reader'] }, title: en('C {{record.name}} cost was {{was.cost|?}} now {{record.cost|?}} by {{owner_id.name|?}}') })),
      },
      {
        key: 'lead-notice',
        name: en('Stage moved: tell the owner’s lead'),
        enabled: true,
        trigger: moved,
        graph: flow(action('tell', { kind: 'notification', to: { column: 'owner_id', lead: true, else: { roles: ['reader'] } }, title: en('L {{record.name}} {{was.cost|?}}') })),
      },
      {
        key: 'approver-notice',
        name: en('Stage moved: tell the approver'),
        enabled: true,
        trigger: moved,
        graph: flow(action('tell', { kind: 'notification', to: { column: 'approver_id' }, title: en('A {{record.name}} cost {{was.cost}}') })),
      },
      {
        key: 'approver-else',
        name: en('Stage moved: tell the approver, else the readers'),
        enabled: true,
        trigger: moved,
        graph: flow(action('tell', { kind: 'notification', to: { column: 'approver_id', else: { roles: ['reader'] } }, title: en('AE {{record.name}}') })),
      },
      {
        key: 'approver-mail',
        name: en('Stage moved: mail the approver'),
        enabled: true,
        trigger: moved,
        graph: flow(action('mail', { kind: 'email', templateKey: 'crm-approve', to: { kind: 'staff', column: 'approver_id' } })),
      },
      {
        key: 'owner-mail',
        name: en('Stage moved: mail the owner'),
        enabled: true,
        trigger: moved,
        graph: flow(action('mail', { kind: 'email', templateKey: 'crm-approve', to: { kind: 'staff', column: 'owner_id' }, vars: { recordUrl: 'https://evil.example/' } })),
      },
      {
        key: 'quiet',
        name: en('A quiet deal, by the settings row'),
        enabled: true,
        trigger: { kind: 'schedule', schedule: { kind: 'interval', everyMinutes: '60' }, forEach: { table: 'deals', once: false, where: [{ left: { field: 'at' }, op: 'more_than_ago', right: { amount: 1, unit: 'days', setting: { table: 'settings', column: 'quiet_days' } } }] } },
        graph: flow(action('tell', { kind: 'notification', to: { roles: ['reader'] }, title: en('Q {{record.name}}') })),
      },
    ],
    emailTemplates: [
      {
        key: 'crm-approve',
        name: 'Approve',
        locales: { 'en-US': { subject: 'M {{record.name}}', blocks: [{ block: 'email.text', data: { text: 'phone was {{was.phone|-}}; cost was {{was.cost|-}}; url {{recordUrl|none}}' } }] } },
      },
    ],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } }],
  };
}

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`what a rule tells each person is what they read, on ${dialect}`, () => {
    let s: WholeServer;
    const notices = async (who: string, prefix: string): Promise<string[]> =>
      ((await s.get(who, '/api/v1/me/notifications?limit=100')).json() as { data: { items: { kind: string; title: string }[] } }).data.items
        .filter((item) => item.kind === 'automation.notice' && item.title.startsWith(prefix))
        .map((item) => item.title)
        .sort();
    const ruleOf = async (key: string) => (await automationsRepo(s.meta).listManagedBy('crm', s.connectionId)).find((rule) => rule.templateKey === key)!;
    const logOf = async (key: string): Promise<string> => {
      const rule = await ruleOf(key);
      const runs = await s.meta.db.selectFrom('adminium_automation_runs').select(['trace', 'status']).where('automationId', '=', rule.id).execute();
      return JSON.stringify(runs);
    };
    /** An author who manages rules and reads these tables, with no row or column limit. */
    const author = async (who: string, slug: string, tables: string[]): Promise<void> => {
      const grants = [...tables.map((table) => `table:${s.connectionId}:${s.t(table)}:read`), 'system:automations:manage'];
      const own = await rolesRepo(s.meta).create({ slug, name: slug });
      for (const row of matrixRowsFromGrants(grants).rows) await permissionsRepo(s.meta).grant(own.id, row.resourceKind, row.resourceRef, row.actions as never);
      await rolesRepo(s.meta).assignToUser(s.ids[who]!, own.id);
    };
    const recordTrigger = () => ({ kind: 'record', connectionId: s.connectionId, table: s.t('deals'), event: 'updated', watch: false, when: [] });
    const older = (setting: { table: string; column: string }) => ({ left: { field: 'at' }, op: 'more_than_ago', right: { amount: 1, unit: 'days', setting } });
    /** Save a rule whose branch reads its amount from this setting. */
    const saveBranch = (who: string, condition: Record<string, unknown>) =>
      s.send(who, 'POST', '/api/v1/automations', {
        name: `probe ${who}`,
        connectionId: s.connectionId,
        trigger: recordTrigger(),
        graph: { version: 1, nodes: [{ id: 't', kind: 'trigger', title: 'T' }, { id: 'c', kind: 'branch', title: 'Older?', condition, branches: [{ id: 'b1', label: 'older', nodes: [] }, { id: 'b2', label: 'younger', nodes: [] }] }] },
        enabled: false,
      });

    beforeAll(async () => {
      s = await wholeServer(dialect, crm(), { people: { cleo: ['clerk'], ron: ['rep'], ann: ['rep'], reed: ['reader'] }, smtp: true });
      // Deal 1 is Ann's; Ron (a rep, his own deals only) is named its approver.
      await s.rows(`INSERT INTO crm_deals (id, name, stage, cost, owner_id, approver_id, phone, token, at) VALUES (1, 'Atrium', 'lead', 4242, '${s.ids['ann']!}', '${s.ids['ron']!}', '+44 20 7946 0001', 'tok-1', '2020-01-01 00:00:00')`);
      await s.rows(`INSERT INTO crm_deals (id, name, stage, cost, owner_id, at) VALUES (2, 'Old', 'lead', 1, '${s.ids['ann']!}', '2010-01-01 00:00:00')`);
      await s.rows(`INSERT INTO crm_deals (id, name, stage, cost, owner_id, at) VALUES (3, 'Mid', 'lead', 1, '${s.ids['ann']!}', '2024-01-01 00:00:00')`);
      await s.rows(`INSERT INTO crm_vault (id, pin, days) VALUES (1, 1234, 1234)`);
      await s.rows(`INSERT INTO crm_diary (id, owner_id, mood) VALUES (1, '${s.ids['ann']!}', 1500)`);
      // North: Cleo leads Ann. Pair: Ann and Reed lead it together (Reed is not Ann's lead).
      const teams = teamsRepo(s.meta);
      const north = await teams.create('North');
      await teams.setMember(north.id, s.ids['cleo']!, true);
      await teams.setMember(north.id, s.ids['ann']!, false);
      const pair = await teams.create('Pair');
      await teams.setMember(pair.id, s.ids['ann']!, true);
      await teams.setMember(pair.id, s.ids['reed']!, true);
    }, 180_000);
    afterAll(async () => {
      await s?.close();
    });

    it('keeps of the record as it was only what its rule reads, and never a secret', async () => {
      await s.emails();
      expect(said(await s.change('owner', 'deals', 1, { stage: 'quote', cost: 5000, phone: '+44 20 7946 0002' }))).toBe('ok');
      // Before the jobs: the runs wait out the undo, holding the row as it was.
      const before = async (key: string): Promise<Record<string, unknown> | undefined> => {
        const rule = await ruleOf(key);
        const [run] = await s.meta.db.selectFrom('adminium_automation_runs').select('triggerEvent').where('automationId', '=', rule.id).execute();
        const event = (typeof run!.triggerEvent === 'string' ? JSON.parse(run!.triggerEvent) : run!.triggerEvent) as { before?: Record<string, unknown> };
        return event.before;
      };
      // A notice that reads {{was.cost}}: that column, and no other.
      expect(Object.keys((await before('cost-moved')) ?? {})).toEqual(['cost']);
      // A mail whose template reads the phone and the cost as they were: those two, never the secret token.
      expect(Object.keys((await before('approver-mail')) ?? {}).sort()).toEqual(['cost', 'phone']);
      // A rule that reads nothing as it was keeps nothing.
      expect(await before('approver-else')).toBeUndefined();
      await s.jobs();
    });

    it('writes a role’s notice for each reader: a column their role is not shown is empty in theirs', async () => {
      // The clerk reads the deal, never its cost nor its owner.
      const read = await s.get('cleo', `/api/v1/data/${s.connectionId}/${s.t('deals')}/1`);
      expect(read.statusCode, read.body).toBe(200);
      expect(read.body).not.toContain('4242');
      expect(await notices('cleo', 'C ')).toEqual(['C Atrium cost was ? now ? by ?']);
      expect(await notices('reed', 'C ')).toEqual(['C Atrium cost was 4242 now 5000 by Ann']);
    });

    it('writes a lead’s notice as the lead reads the record, and a co-lead of the person’s own team is not their lead', async () => {
      expect(await notices('cleo', 'L ')).toEqual(['L Atrium ?']);
      expect(await notices('reed', 'L ')).toEqual([]);
    });

    it('tells and mails the person a staff column names only when they can open the record', async () => {
      // Ron reaches only his own deals: he cannot open Ann's.
      expect((await s.get('ron', `/api/v1/data/${s.connectionId}/${s.t('deals')}/1`)).statusCode).not.toBe(200);
      expect(await notices('ron', 'A')).toEqual([]);
      expect(await logOf('approver-notice')).toContain('cannot open this record');
      // With other roles to tell, they are told instead.
      expect(await notices('reed', 'AE ')).toEqual(['AE Atrium']);
      const mails = (await s.emails()).filter((mail) => mail.templateKey === 'crm-approve');
      expect(mails.map((mail) => mail.to)).toEqual(['ann@crm.test']);
      expect(await logOf('approver-mail')).toContain('cannot open this record');
      // Ann opens her deal: the cost as it was, never the phone her role is not shown, and the record's own address
      // whatever the step's vars say.
      const ann = mails[0]!;
      // (A cost is money: a mail writes it as one.)
      expect(ann.text).toContain('cost was 4,242.00');
      expect(ann.text).toContain('phone was -;');
      expect(`${ann.text} ${ann.html}`).not.toContain('0001');
      expect(`${ann.text} ${ann.html}`).not.toContain('evil.example');
      expect(ann.text).toContain('/p/crm-deals/r/1');
    });

    it('refuses an amount read from a table its author does not read, a secret or personal column, a hidden one, or a private table', async () => {
      await author('reed', 'deal-author', ['deals']);
      // Reed does not read the vault: neither its days nor how many of its rows match are his to read.
      expect((await s.get('reed', `/api/v1/data/${s.connectionId}/${s.t('vault')}`)).statusCode).toBe(403);
      expect(said(await saveBranch('reed', older({ table: s.t('vault'), column: 'days' })))).toMatch(/^403/);
      expect(said(await saveBranch('reed', { left: { count: { table: s.t('vault'), matchColumn: 'days', equalsField: 'cost' } }, op: 'gt', right: 0 }))).toMatch(/^403/);
      // Even the owner: a secret column, a personal one, a private table.
      expect(said(await saveBranch('owner', older({ table: s.t('vault'), column: 'pin' })))).toMatch(/^422/);
      expect(said(await saveBranch('owner', older({ table: s.t('deals'), column: 'age' })))).toMatch(/^422/);
      expect(said(await saveBranch('owner', older({ table: s.t('diary'), column: 'mood' })))).toMatch(/^403/);
      // A column the author's role is not shown: the clerk who may write rules, and reads deals only as a clerk.
      await author('cleo', 'clerk-author', []);
      expect(said(await saveBranch('cleo', older({ table: s.t('deals'), column: 'cost' })))).toMatch(/^4/);
      // What may be read still is.
      expect(said(await saveBranch('owner', older({ table: s.t('vault'), column: 'days' })))).toBe('ok');
    });

    it('reads a setting as a rule reads the connection: a private table not at all, a secret column never', async () => {
      // A rule older than these refusals, or one written to the store by hand: its scan's amount is in the private
      // diary (1,500 days), its branch's in the vault's secret pin (1,234 days). Both read nothing: one day each.
      const deals = s.t('deals');
      await automationsRepo(s.meta).create({
        connectionId: s.connectionId,
        name: 'stored by hand',
        enabled: true,
        nextRunAt: 1,
        trigger: { kind: 'schedule', connectionId: s.connectionId, schedule: { kind: 'interval', everyMinutes: '60' }, forEach: { table: deals, once: false, where: [older({ table: s.t('diary'), column: 'mood' })] } } as never,
        graph: {
          version: 1,
          nodes: [
            { id: 't', kind: 'trigger', title: 'T' },
            {
              id: 'c',
              kind: 'branch',
              title: 'Older than the pin?',
              condition: older({ table: s.t('vault'), column: 'pin' }),
              branches: [
                { id: 'b1', label: 'older', nodes: [action('o', { kind: 'notification', to: { roles: [(await rolesRepo(s.meta).findBySlug('crm-reader'))!.id] }, title: 'S {{record.name}} older', body: null })] },
                { id: 'b2', label: 'younger', nodes: [action('y', { kind: 'notification', to: { roles: [(await rolesRepo(s.meta).findBySlug('crm-reader'))!.id] }, title: 'S {{record.name}} younger', body: null })] },
              ],
            },
          ],
        } as never,
      });
      await s.meta.db.deleteFrom('adminium_notifications').execute();
      await s.rows('INSERT INTO crm_settings (id, quiet_days) VALUES (2, 3000)');
      await s.rows('INSERT INTO crm_settings (id, quiet_days) VALUES (1, 2000)');
      await s.tick();
      await s.jobs();
      // Mid is 1,000-odd days old: older than one day, younger than the diary's or the pin's number.
      expect(await notices('reed', 'S ')).toEqual(['S Atrium older', 'S Mid older', 'S Old older']);
      // The settings row is the one with the lowest key (2,000 days), whichever was written first: Atrium (2,400-odd
      // days) and Old; not Mid.
      expect(await notices('reed', 'Q ')).toEqual(['Q Atrium', 'Q Old']);
    });
  });
}

describe('a run whose job gives up', () => {
  it('lets go of the record as it was', async () => {
    const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    const rule = await automationsRepo(meta).create({ connectionId: null, name: 'Mail on a change', enabled: true, trigger: { kind: 'record', connectionId: 'conn_none', table: 'public.deals', event: 'updated', watch: false, when: [] } as never, graph: { version: 1, nodes: [{ id: 't', kind: 'trigger', title: 'T' }] } as never });
    const runs = automationRunsRepo(meta);
    const run = (await runs.begin({
      automationId: rule.id,
      dedupeKey: null,
      origin: 'dashboard',
      triggerEvent: { event: 'record.updated', origin: 'dashboard', ruleId: null, hops: 0, record: { connectionId: 'conn_none', table: 'public.deals', pk: { id: 1 }, label: 'Deal 1' }, snapshot: { id: 1 }, before: { id: 1, cost: 4242 }, occurredAt: 1 } as never,
    }))!;
    let handler: ((payload: unknown, ctx: unknown) => Promise<unknown>) | undefined;
    registerAutomationRunHandler({ registerJobHandler: (_kind: string, _schema: unknown, fn: never) => (handler = fn) } as never, { meta, manager: { data: () => Promise.reject(new Error('no connection')) }, enqueue: () => Promise.reject(new Error('none')), secret: 'x'.repeat(32) } as never);
    await expect(handler!({ runId: run.id }, { progress: () => undefined, jobId: 'job_1', attempt: 1 })).rejects.toThrow();
    const kept = (await runs.findById(run.id))!;
    expect((kept.triggerEvent as { before?: unknown }).before).toBeUndefined();
    await meta.db.destroy();
  });
});
