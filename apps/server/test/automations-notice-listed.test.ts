// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE PEOPLE LISTED ON THE ROW, as somebody a rule tells: against the whole
 * server on SQLite, Postgres and MySQL, through an app installed by the real
 * installer.
 *
 * `to: { listed: "deal_members" }` on a notice, `to: { kind: "listed",
 * table: "deal_members" }` on an e-mail: the people a table that lists people
 * against the record names for it, read when the step runs. Being listed is
 * no right to be told. A listed person is told only when their own roles
 * reach the row for a read at that moment; a suspended or a sample person is
 * never told; a dated listing (a cover) counts on the business's day only.
 *
 * ── THE FIRM ───────────────────────────────────────────────────────────────
 * North is led by Mia (a sales manager: her team's deals), with Dana (a rep:
 * her own). South has Sam (a rep). Ada is an admin no row limit holds. Hugo
 * is an account manager: deals while they are won. Zed is a marketer, who
 * reads no deal. Sue is a rep who is suspended, Sal a sample rep. Kim and Ken
 * are fitters: a delivery while they are on its crew.
 */
import { usersRepo, settingsRepo, teamsRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { requiredGrants } from '../src/automations/validate.js';
import { loadSnapshotView } from '../src/data-io/snapshot-view.js';
import { LEGS, said, wholeServer, type WholeServer } from './whole-server.helpers.js';

vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.28' }));

const id = { ref: 'id', type: 'int', role: 'pk' };
const staff = (ref: string, nullable = false) => ({ ref, type: 'text', maxLength: 36, ...(nullable ? { nullable: true } : {}), rules: { staff: true } });
const changed = (table: string, column: string) => ({ kind: 'record', event: 'updated', table, changedColumn: column });

function crm(): Record<string, unknown> {
  const rule = (key: string, table: string, column: string, action: Record<string, unknown>) => ({
    key,
    name: { 'en-US': key },
    enabled: true,
    trigger: changed(table, column),
    graph: { version: 1, nodes: [{ id: 't', kind: 'trigger', title: 'Changed' }, { id: 'n', kind: 'action', title: 'Tell them', action }] },
  });
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
    navGroups: [{ key: 'sales', label: { 'en-US': 'Sales' }, order: 1 }],
    requiredSchema: {
      prefixed: true,
      tables: [
        {
          ref: 'deals',
          belongs: [
            { column: 'owner_id', set: 'team' },
            { through: { table: 'deal_members', link: 'deal_id', user: 'user_id', while: { column: 'ended_on', isNull: true } } },
            { through: { table: 'covers', link: 'owner_id', on: 'owner_id', user: 'cover_id', from: 'starts_on', to: 'ends_on' } },
          ],
          indexes: [['owner_id']],
          columns: [id, { ref: 'name', type: 'text', maxLength: 80 }, staff('owner_id', true), { ref: 'state', type: 'enum', enum: ['open', 'won'], default: 'open' }, { ref: 'note', type: 'text', maxLength: 80, nullable: true }],
        },
        {
          ref: 'deal_members',
          belongs: [{ via: 'deal_id' }],
          indexes: [['deal_id'], ['user_id']],
          columns: [id, { ref: 'deal_id', type: 'fk', references: 'deals' }, staff('user_id'), { ref: 'ended_on', type: 'date', nullable: true }],
        },
        {
          ref: 'covers',
          belongs: [{ column: 'owner_id' }, { column: 'cover_id' }],
          indexes: [['owner_id'], ['cover_id']],
          columns: [id, staff('owner_id'), staff('cover_id'), { ref: 'starts_on', type: 'date' }, { ref: 'ends_on', type: 'date', nullable: true }],
        },
        { ref: 'crews', columns: [id, { ref: 'name', type: 'text', maxLength: 40 }] },
        {
          ref: 'crew_members',
          indexes: [['crew_id'], ['user_id']],
          columns: [id, { ref: 'crew_id', type: 'fk', references: 'crews' }, staff('user_id')],
        },
        {
          ref: 'deliveries',
          belongs: [{ through: { table: 'crew_members', link: 'crew_id', on: 'crew_id', user: 'user_id' } }],
          indexes: [['crew_id']],
          columns: [id, { ref: 'place', type: 'text', maxLength: 80 }, { ref: 'crew_id', type: 'fk', references: 'crews', nullable: true }, { ref: 'start', type: 'text', maxLength: 5, nullable: true }],
        },
      ],
    },
    roles: [
      { key: 'rep', name: 'Rep', permissions: ['table:@deals:read', 'table:@deal_members:read', 'page:@crm-deals:view'], limits: { deals: { rows: { read: { reach: 'own' } } } } },
      { key: 'manager', name: 'Manager', permissions: ['table:@deals:read', 'table:@deal_members:read', 'page:@crm-deals:view'], limits: { deals: { rows: { read: { reach: 'team' } } } } },
      { key: 'admin', name: 'Admin', permissions: ['table:@deals:read', 'table:@deal_members:read', 'table:@deliveries:read', 'page:@crm-deals:view'] },
      { key: 'account', name: 'Account manager', permissions: ['table:@deals:read', 'page:@crm-deals:view'], limits: { deals: { rows: { read: { reach: 'all', while: { column: 'state', in: ['won'] } } } } } },
      { key: 'marketer', name: 'Marketer', permissions: ['table:@crews:read'] },
      { key: 'fitter', name: 'Fitter', permissions: ['table:@deliveries:read'], limits: { deliveries: { rows: { read: { reach: 'own' } } } } },
    ],
    pages: [{ ref: 'crm-deals', template: 'page-crud', title: { key: 't.deals', fallback: 'Deals' }, nav: { group: 'sales', icon: 'list', order: 1 }, bindings: { rows: 'deals' } }],
    automations: [
      rule('deal-people', 'deals', 'note', { kind: 'notification', to: { listed: 'deal_members' }, title: { 'en-US': 'Note on {{record.name}}' }, body: { 'en-US': '{{record.note}}' } }),
      rule('deal-cover', 'deals', 'state', { kind: 'notification', to: { listed: 'covers' }, title: { 'en-US': 'Covered deal {{record.name}} is {{record.state}}' } }),
      rule('deal-people-mail', 'deals', 'name', { kind: 'email', templateKey: 'crm-deal-people', to: { kind: 'listed', table: 'deal_members' } }),
      rule('day-sheet', 'deliveries', 'start', { kind: 'notification', to: { listed: 'crew_members' }, title: { 'en-US': 'Day sheet: {{record.place}} at {{record.start}}' }, urgent: true }),
    ],
    emailTemplates: [
      {
        key: 'crm-deal-people',
        name: 'A deal you are on',
        locales: { 'en-US': { subject: 'Now called {{record.name}}', blocks: [{ block: 'email.text', data: { text: 'Open it: {{recordUrl}}' } }] } },
      },
    ],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } }],
  };
}

/** A day `days` from today, where the business is (UTC here). */
const day = (days: number): string => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`the people listed on the row, on ${dialect}`, () => {
    let s: WholeServer;
    let deals = 0;
    /** Who holds a notice with this title, by name. */
    const told = async (title: string): Promise<string[]> => {
      const rows = await s.meta.db.selectFrom('adminium_notifications').select(['userId']).where('kind', '=', 'automation.notice').where('title', '=', title).execute();
      const names = Object.entries(s.ids);
      return rows.map((row) => names.find(([, value]) => value === row.userId)?.[0] ?? row.userId).sort();
    };
    const runs = async (): Promise<{ status: string; trace: unknown }[]> => (await s.meta.db.selectFrom('adminium_automation_runs').select(['status', 'trace']).execute()) as { status: string; trace: unknown }[];
    /** A deal of `owner` with these people listed on it; its key. */
    const deal = async (owner: string | null, listed: readonly string[], state = 'open'): Promise<number> => {
      deals += 1;
      await s.rows(`INSERT INTO crm_deals (id, name, owner_id, state) VALUES (${String(deals)}, 'Deal ${String(deals)}', ${owner === null ? 'NULL' : `'${s.ids[owner]!}'`}, '${state}')`);
      for (const [n, who] of listed.entries()) await s.rows(`INSERT INTO crm_deal_members (id, deal_id, user_id) VALUES (${String(deals * 100 + n)}, ${String(deals)}, '${s.ids[who]!}')`);
      return deals;
    };
    /** A note written on a deal, as the owner of the workspace; who was told of it. */
    const note = async (key: number): Promise<string[]> => {
      expect(said(await s.change('owner', 'deals', key, { note: `Note ${String(key)}` }))).toBe('ok');
      await s.jobs();
      return told(`Note on Deal ${String(key)}`);
    };

    beforeAll(async () => {
      s = await wholeServer(dialect, crm(), {
        people: { mia: ['manager'], dana: ['rep'], sam: ['rep'], ada: ['admin'], hugo: ['account'], zed: ['marketer'], sue: ['rep'], sal: ['rep'], kim: ['fitter'], ken: ['fitter'], nell: [] },
        smtp: true,
      });
      await settingsRepo(s.meta).set('system.publicOrigin', 'https://desk.crm.example', { updatedBy: null });
      const teams = teamsRepo(s.meta);
      const north = await teams.create('North');
      await teams.setMember(north.id, s.ids['mia']!, true);
      await teams.setMember(north.id, s.ids['dana']!, false);
      const south = await teams.create('South');
      await teams.setMember(south.id, s.ids['sam']!, false);
      await usersRepo(s.meta).updateStatus(s.ids['sue']!, 'suspended');
      await usersRepo(s.meta).updateStatus(s.ids['sal']!, 'sample');
    }, 180_000);
    afterAll(async () => {
      await s?.close();
    });

    it('tells each listed person who can open the deal, and nobody else: not the owner, not a manager of another team, not who reads no deal', async () => {
      // Dana's deal (North); Sam of South and the others are listed on it.
      const key = await deal('dana', ['sam', 'ada', 'hugo', 'zed', 'sue', 'sal']);
      // Sam reaches it by being listed; Ada reads every deal. Hugo reads won deals only, Zed none;
      // Sue cannot sign in; Sal is a sample person. Dana and Mia are not listed, so they are not told.
      expect(await note(key)).toEqual(['ada', 'sam']);
      expect((await runs()).filter((run) => run.status === 'failed')).toEqual([]);
    });

    it('a listing that counts only while its member row is open: somebody whose row has ended is not listed, whatever else they read', async () => {
      // Ada reads every deal, Sam reaches it by being listed: both rows ended, nobody is told.
      const key = await deal('dana', ['ada', 'sam']);
      await s.rows(`UPDATE crm_deal_members SET ended_on = '${day(-1)}' WHERE deal_id = ${String(key)}`);
      expect(await note(key)).toEqual([]);
    });

    it('a manager listed on another team’s deal is told: being listed is her reach to it', async () => {
      const key = await deal('sam', ['mia']);
      expect(await note(key)).toEqual(['mia']);
    });

    it('asks again at send time: a won deal reaches the account manager; a role taken away reaches nobody', async () => {
      const key = await deal('dana', ['hugo', 'sam'], 'won');
      expect(await note(key)).toEqual(['hugo', 'sam']);
      // Sam loses his role between being listed and the note: he reads no deal now, and is not told.
      const roles = (await import('@adminium/meta')).rolesRepo(s.meta);
      const rep = (await roles.findBySlug('crm-rep'))!;
      await roles.removeFromUser(s.ids['sam']!, rep.id);
      try {
        const again = await deal('dana', ['hugo', 'sam'], 'won');
        expect(await note(again)).toEqual(['hugo']);
      } finally {
        await roles.assignToUser(s.ids['sam']!, rep.id);
      }
    });

    it('somebody with no role at all, listed by hand in the database, is never told', async () => {
      const key = await deal('dana', ['nell', 'zed']);
      expect(await note(key)).toEqual([]);
      // Nobody left to tell is said in the run, never a failure.
      expect((await runs()).filter((run) => run.status === 'failed')).toEqual([]);
    });

    it('a deal that lists nobody tells nobody, and the run says so', async () => {
      const key = await deal('dana', []);
      expect(await note(key)).toEqual([]);
      const traces = JSON.stringify((await runs()).map((run) => run.trace));
      expect(traces).toContain('Nobody is listed in');
    });

    it('a dated listing counts on the business’s day: the cover running today, not one that ended or one to come', async () => {
      const key = await deal('sam', []);
      await s.rows(`INSERT INTO crm_covers (id, owner_id, cover_id, starts_on, ends_on) VALUES (1, '${s.ids['sam']!}', '${s.ids['dana']!}', '${day(-2)}', '${day(2)}'), (2, '${s.ids['sam']!}', '${s.ids['mia']!}', '${day(-30)}', '${day(-10)}'), (3, '${s.ids['sam']!}', '${s.ids['ada']!}', '${day(5)}', NULL)`);
      expect(said(await s.change('owner', 'deals', key, { state: 'won' }))).toBe('ok');
      await s.jobs();
      expect(await told(`Covered deal Deal ${String(key)} is won`)).toEqual(['dana']);
    });

    it('an e-mail goes to each listed person who can open the deal, with its address; to nobody else', async () => {
      await s.emails();
      const key = await deal('dana', ['sam', 'zed', 'sue', 'sal', 'hugo']);
      expect(said(await s.change('owner', 'deals', key, { name: 'Renamed deal' }))).toBe('ok');
      await s.jobs();
      const mail = (await s.emails()).filter((one) => one.templateKey === 'crm-deal-people');
      expect(mail.map((one) => one.to)).toEqual(['sam@crm.test']);
      expect(mail[0]!.subject).toBe('Now called Renamed deal');
      expect(mail[0]!.text).toContain(`https://desk.crm.example/p/crm-deals/r/${String(key)}`);
    });

    it('is refused at the save in the dashboard when the table lists nobody against the rule’s record', async () => {
      const save = (to: unknown, mail = false) =>
        s.send('owner', 'POST', '/api/v1/automations', {
          name: 'Tell the people on it',
          connectionId: s.connectionId,
          enabled: false,
          trigger: { kind: 'record', connectionId: s.connectionId, table: s.t('deals'), event: 'updated', watch: false, when: [] },
          graph: {
            version: 1,
            nodes: [
              { id: 'n1', kind: 'trigger', title: 'Trigger' },
              { id: 'n2', kind: 'action', title: 'Tell', onError: false, action: mail ? { kind: 'email', templateKey: 'crm-deal-people', to, vars: {} } : { kind: 'notification', to, title: 'Hello', body: null } },
            ],
          },
        });
      // A table of people that is not one of the deal's listings, a listing of another table, a table not there.
      for (const wrong of [s.t('covers').replace('covers', 'crew_members'), s.t('deliveries'), 'main.nope']) {
        const res = await save({ listed: wrong });
        expect(res.statusCode, `${wrong} ${res.body}`).toBe(422);
        expect((await save({ kind: 'listed', table: wrong }, true)).statusCode).toBe(422);
      }
      for (const right of [s.t('deal_members'), s.t('covers')]) {
        const res = await save({ listed: right });
        expect(res.statusCode, `${right} ${res.body}`).toBeLessThan(300);
        expect((res.json() as { graph: { nodes: { action?: { to?: unknown } }[] } }).graph.nodes[1]!.action!.to).toEqual({ listed: right });
        expect((await save({ kind: 'listed', table: right }, true)).statusCode).toBeLessThan(300);
      }
    });

    it('asks the rule’s author to read the listing, and to read all of it, as any table a rule reads', async () => {
      const view = await loadSnapshotView(s.meta, s.connectionId);
      const trigger = { kind: 'record', connectionId: s.connectionId, table: s.t('deals'), event: 'updated', watch: false, when: [] } as never;
      const step = (action: unknown) => ({ version: 1, nodes: [{ id: 'n1', kind: 'trigger', title: 'Trigger' }, { id: 'n2', kind: 'action', title: 'Tell', onError: false, action }] }) as never;
      const read = (table: string) => `table:${s.connectionId}:${table}:read`;
      expect(requiredGrants(trigger, step({ kind: 'notification', to: { listed: s.t('deal_members') }, title: 'Hi', body: null }), s.connectionId, view).map((row) => row.permission).sort()).toEqual([read(s.t('deals')), read(s.t('deal_members'))].sort());
      expect(requiredGrants(trigger, step({ kind: 'email', templateKey: 'crm-deal-people', to: { kind: 'listed', table: s.t('covers') }, vars: {} }), s.connectionId, view).map((row) => row.permission).sort()).toEqual([read(s.t('deals')), read(s.t('covers'))].sort());
    });

    it('the crew of a delivery, through its crew: only who is on that crew now, urgent', async () => {
      await s.rows(`INSERT INTO crm_crews (id, name) VALUES (1, 'Blue'), (2, 'Red')`);
      await s.rows(`INSERT INTO crm_crew_members (id, crew_id, user_id) VALUES (1, 1, '${s.ids['kim']!}'), (2, 1, '${s.ids['zed']!}'), (3, 2, '${s.ids['ken']!}')`);
      await s.rows(`INSERT INTO crm_deliveries (id, place, crew_id) VALUES (1, 'Harbour', 1), (2, 'Nowhere', NULL)`);
      expect(said(await s.change('owner', 'deliveries', 1, { start: '07:30' }))).toBe('ok');
      expect(said(await s.change('owner', 'deliveries', 2, { start: '09:00' }))).toBe('ok');
      await s.jobs();
      // Kim is on the Blue crew and reads deliveries; Zed is on it too but reads none; Ken is on the Red crew.
      expect(await told('Day sheet: Harbour at 07:30')).toEqual(['kim']);
      expect(await told('Day sheet: Nowhere at 09:00')).toEqual([]);
      // Kim moved to the Red crew: the next change tells Ken and him, of the Red crew's delivery only.
      await s.rows(`UPDATE crm_crew_members SET crew_id = 2 WHERE id = 1`);
      expect(said(await s.change('owner', 'deliveries', 1, { start: '08:00' }))).toBe('ok');
      await s.jobs();
      expect(await told('Day sheet: Harbour at 08:00')).toEqual([]);
      expect(said(await s.change('owner', 'deliveries', 1, { crew_id: 2 }))).toBe('ok');
      expect(said(await s.change('owner', 'deliveries', 1, { start: '08:30' }))).toBe('ok');
      await s.jobs();
      expect(await told('Day sheet: Harbour at 08:30')).toEqual(['ken', 'kim']);
    });
  });
}
