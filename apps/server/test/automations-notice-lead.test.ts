// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A NOTICE TO THE LEAD OF THE PERSON ON THE ROW, against the whole server on
 * SQLite, Postgres and MySQL, through an app installed by the real installer.
 *
 * "Approval asked" goes to whoever leads a team the asker is in, and never to
 * the asker: `to: { column: "asked_by_id", lead: true, else: { roles: ["admin"] } }`.
 * Of the leads, only those who can open the quote are told: a lead whose
 * roles do not read quotes, or whose row limit does not reach this one, is
 * passed over. Somebody who leads her own team and is led by nobody else, and
 * somebody in no team, have no lead: the admins are told instead (never the
 * asker, should she be one of them).
 */
import { settingsRepo, teamsRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { LEGS, said, wholeServer, type WholeServer } from './whole-server.helpers.js';

vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.28' }));

const id = { ref: 'id', type: 'int', role: 'pk' };

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
    navGroups: [{ key: 'sales', label: { 'en-US': 'Sales' }, order: 1 }],
    requiredSchema: {
      prefixed: true,
      tables: [
        {
          ref: 'quotes',
          belongs: [{ column: 'asked_by_id', set: 'anyone' }],
          indexes: [['asked_by_id']],
          columns: [
            id,
            { ref: 'name', type: 'text', maxLength: 80 },
            { ref: 'asked_by_id', type: 'text', maxLength: 36, nullable: true, rules: { staff: true } },
            { ref: 'approver_id', type: 'text', maxLength: 36, nullable: true, rules: { staff: true } },
            { ref: 'stage', type: 'enum', enum: ['draft', 'asked'], default: 'draft' },
          ],
        },
        { ref: 'deliveries', columns: [id, { ref: 'name', type: 'text', maxLength: 80 }] },
      ],
    },
    roles: [
      // A rep reads and changes his own quotes only.
      { key: 'rep', name: 'Rep', permissions: ['table:@quotes:read', 'table:@quotes:update', 'page:@crm-quotes:view'], limits: { quotes: { rows: { read: { reach: 'own' }, update: { reach: 'own' } } } } },
      { key: 'manager', name: 'Manager', permissions: ['table:@quotes:read', 'table:@quotes:update', 'page:@crm-quotes:view'] },
      { key: 'admin', name: 'Admin', permissions: ['table:@quotes:read', 'table:@quotes:update', 'page:@crm-quotes:view'] },
      { key: 'driver', name: 'Driver', permissions: ['table:@deliveries:read'] },
      // A sales manager of one team: she reads the quotes of the people she leads, and no others.
      { key: 'team-manager', name: 'Team manager', permissions: ['table:@quotes:read', 'page:@crm-quotes:view'], limits: { quotes: { rows: { read: { reach: 'team' } } } } },
    ],
    pages: [{ ref: 'crm-quotes', template: 'page-crud', title: { key: 't.quotes', fallback: 'Quotes' }, nav: { group: 'sales', icon: 'list', order: 1 }, bindings: { rows: 'quotes' } }],
    automations: [
      {
        key: 'approval-asked',
        name: { 'en-US': 'Approval asked: tell the asker’s lead' },
        enabled: true,
        trigger: { kind: 'record', event: 'updated', table: 'quotes', changedColumn: 'stage', when: [{ left: { field: 'stage' }, op: 'is', right: 'asked' }] },
        graph: {
          version: 1,
          nodes: [
            { id: 't', kind: 'trigger', title: 'Approval asked' },
            { id: 'n', kind: 'action', title: 'Tell the lead', action: { kind: 'notification', to: { column: 'asked_by_id', lead: true, else: { roles: ['admin'] } }, title: { 'en-US': 'Approval asked: {{record.name}}' }, body: { 'en-US': 'Asked by {{asked_by_id.name|nobody}}.' } } },
          ],
        },
      },
      {
        key: 'team-managers',
        name: { 'en-US': 'Approval asked: tell the team managers' },
        enabled: true,
        trigger: { kind: 'record', event: 'updated', table: 'quotes', changedColumn: 'stage', when: [{ left: { field: 'stage' }, op: 'is', right: 'asked' }] },
        graph: {
          version: 1,
          nodes: [
            { id: 't', kind: 'trigger', title: 'Approval asked' },
            { id: 'n', kind: 'action', title: 'Tell the managers', action: { kind: 'notification', to: { roles: ['team-manager'] }, title: { 'en-US': 'Team: {{record.name}}' } } },
          ],
        },
      },
      {
        key: 'approver-mail',
        name: { 'en-US': 'Approval asked: write to the approver' },
        enabled: true,
        trigger: { kind: 'record', event: 'updated', table: 'quotes', changedColumn: 'stage', when: [{ left: { field: 'stage' }, op: 'is', right: 'asked' }] },
        graph: {
          version: 1,
          nodes: [
            { id: 't', kind: 'trigger', title: 'Approval asked' },
            { id: 'm', kind: 'action', title: 'Write to the approver', action: { kind: 'email', templateKey: 'crm-approve', to: { kind: 'staff', column: 'approver_id' } } },
          ],
        },
      },
    ],
    emailTemplates: [
      {
        key: 'crm-approve',
        name: 'Approve a quote',
        locales: { 'en-US': { subject: 'Approve {{record.name}} for {{record.asked_by_id.name}}', blocks: [{ block: 'email.text', data: { text: 'Open it: {{recordUrl|you cannot open it}}' } }] } },
      },
    ],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } }],
  };
}

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`a notice to the asker’s lead, on ${dialect}`, () => {
    let s: WholeServer;
    let quotes = 0;
    let bodies: string[] = [];
    const everybody = ['dana', 'omar', 'noor', 'ivy', 'mia', 'zed', 'lee', 'ada', 'max', 'nina', 'otto', 'pia'];
    /** Who has the team managers' notice of the newest quote. */
    const managersTold = async (): Promise<string[]> => {
      const out: string[] = [];
      for (const who of everybody) {
        const items = ((await s.get(who, '/api/v1/me/notifications?limit=100')).json() as { data: { items: { kind: string; title: string }[] } }).data.items;
        if (items.some((item) => item.kind === 'automation.notice' && item.title === `Team: Quote ${String(quotes)}`)) out.push(who);
      }
      return out;
    };
    const told = async (): Promise<string[]> => {
      const out: string[] = [];
      bodies = [];
      for (const who of everybody) {
        const items = ((await s.get(who, '/api/v1/me/notifications?limit=100')).json() as { data: { items: { kind: string; title: string }[] } }).data.items;
        const found = items.find((item) => item.kind === 'automation.notice' && item.title === `Approval asked: Quote ${String(quotes)}`) as { body?: string | null } | undefined;
        if (found === undefined) continue;
        out.push(who);
        bodies.push(found.body ?? '');
      }
      return out;
    };
    /** A quote asked for by this person; who was told of it. */
    const ask = async (who: string): Promise<string[]> => {
      quotes += 1;
      await s.rows(`INSERT INTO crm_quotes (id, name, asked_by_id, stage) VALUES (${String(quotes)}, 'Quote ${String(quotes)}', '${s.ids[who]!}', 'draft')`);
      expect(said(await s.change('owner', 'quotes', quotes, { stage: 'asked' }))).toBe('ok');
      await s.jobs();
      return told();
    };

    beforeAll(async () => {
      s = await wholeServer(dialect, crm(), {
        people: { dana: ['rep'], omar: ['rep'], noor: ['rep'], ivy: ['rep'], mia: ['manager'], zed: ['driver'], lee: ['rep'], ada: ['admin'], max: ['admin', 'manager'], nina: ['team-manager'], otto: ['team-manager'], pia: ['rep'] },
        smtp: true,
      });
      await settingsRepo(s.meta).set('system.publicOrigin', 'https://desk.crm.example', { updatedBy: null });
      const teams = teamsRepo(s.meta);
      const team = async (name: string, lead: string, members: string[]) => {
        const made = await teams.create(name);
        await teams.setMember(made.id, s.ids[lead]!, true);
        for (const member of members) await teams.setMember(made.id, s.ids[member]!, false);
      };
      // North: Mia leads Dana. East: Zed leads Omar, and cannot open a quote. West: Lee leads Noor, and reaches only his own quotes.
      // South: Max (an admin too) leads himself alone. Ivy is in no team.
      await team('North', 'mia', ['dana']);
      await team('East', 'zed', ['omar']);
      await team('West', 'lee', ['noor']);
      await team('South', 'max', []);
      // Two sales managers of two teams: Nina co-leads North (Dana), Otto leads Far (Pia).
      await team('North managers', 'nina', ['dana']);
      await team('Far', 'otto', ['pia']);
    }, 180_000);
    afterAll(async () => {
      await s?.close();
    });

    it('tells the lead of the asker’s team, and not the asker or the admins; the notice names the asker', async () => {
      expect(await ask('dana')).toEqual(['mia', 'nina']);
      expect(bodies).toEqual(['Asked by Dana.', 'Asked by Dana.']);
    });

    it('tells a role only those of its people who can open the quote: the manager of the asker’s team, not the other team’s', async () => {
      await ask('dana');
      expect(await managersTold()).toEqual(['nina']);
      expect(await ask('pia')).toEqual(['otto']);
      expect(await managersTold()).toEqual(['otto']);
      // A quote neither leads anybody on: no manager is told, and the run says so rather than failing.
      await ask('ivy');
      expect(await managersTold()).toEqual([]);
      const runs = (await s.meta.db.selectFrom('adminium_automation_runs').select(['status', 'trace']).execute()) as { status: string; trace: unknown }[];
      expect(runs.filter((run) => run.status === 'failed')).toEqual([]);
    });

    it('passes over a lead who cannot open the quote, by role or by row, and tells the admins', async () => {
      expect(await ask('omar')).toEqual(['ada', 'max']);
      expect(await ask('noor')).toEqual(['ada', 'max']);
    });

    it('tells the admins for somebody in no team, and for a lead led by nobody else; never the asker among them', async () => {
      expect(await ask('ivy')).toEqual(['ada', 'max']);
      expect(await ask('max')).toEqual(['ada']);
      // A lead who is a member of another team is led by its lead.
      await teamsRepo(s.meta).setMember((await teamsRepo(s.meta).findByName('North'))!.id, s.ids['max']!, false);
      expect(await ask('max')).toEqual(['mia']);
    });

    it('a quote nobody asked for tells the admins, and names nobody', async () => {
      quotes += 1;
      await s.rows(`INSERT INTO crm_quotes (id, name, asked_by_id, stage) VALUES (${String(quotes)}, 'Quote ${String(quotes)}', NULL, 'draft')`);
      expect(said(await s.change('owner', 'quotes', quotes, { stage: 'asked' }))).toBe('ok');
      await s.jobs();
      expect(await told()).toEqual(['ada', 'max']);
      expect(bodies).toEqual(['Asked by nobody.', 'Asked by nobody.']);
    });

    it('a rule’s mail to a person names the asker, and carries the quote’s address only to an approver who can open it', async () => {
      const approve = async (asker: string, approver: string): Promise<{ subject: string; text: string; html: string }> => {
        await s.emails();
        quotes += 1;
        await s.rows(`INSERT INTO crm_quotes (id, name, asked_by_id, approver_id, stage) VALUES (${String(quotes)}, 'Quote ${String(quotes)}', '${s.ids[asker]!}', '${s.ids[approver]!}', 'draft')`);
        expect(said(await s.change('owner', 'quotes', quotes, { stage: 'asked' }))).toBe('ok');
        await s.jobs();
        const mail = (await s.emails()).filter((one) => one.templateKey === 'crm-approve');
        expect(mail.map((one) => one.to)).toEqual([`${approver}@crm.test`]);
        return mail[0]!;
      };
      // Mia reads every quote: the link to its page.
      const mia = await approve('dana', 'mia');
      expect(mia.subject).toBe(`Approve Quote ${String(quotes)} for Dana`);
      expect(mia.text).toContain(`https://desk.crm.example/p/crm-quotes/r/${String(quotes)}`);
      // Lee reaches only his own quotes: no address, the template's own words instead.
      const lee = await approve('dana', 'lee');
      expect(lee.subject).toBe(`Approve Quote ${String(quotes)} for Dana`);
      expect(`${lee.text} ${lee.html}`).not.toContain('/p/crm-quotes/r/');
      expect(lee.text).toContain('you cannot open it');
      // His own quote he can open.
      expect((await approve('lee', 'lee')).text).toContain(`https://desk.crm.example/p/crm-quotes/r/${String(quotes)}`);
    });
  });
}
