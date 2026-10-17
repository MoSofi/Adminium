// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A RULE READS ITS RECORD AS IT WAS BEFORE THE CHANGE (`{{was.<column>}}`),
 * against the whole server on SQLite, Postgres and MySQL, through an app
 * installed by the real installer.
 *
 *  - a rule run by a change of one column writes what the row held before
 *    into another column, and says it in a notice;
 *  - a rule run by any change (no `changedColumn`) has the row as it was too:
 *    the write reads it first because the rule asks for it;
 *  - a rule's e-mail reads it, as a mail reads the record (dates as a person
 *    reads them);
 *  - a personal column is no placeholder of a notice as it was either, and
 *    the row as it was is never served by Workflow Logs and leaves the run
 *    when it ends.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { LEGS, said, wholeServer, type WholeServer } from './whole-server.helpers.js';

vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.28' }));

const id = { ref: 'id', type: 'int', role: 'pk' };
const en = (text: string) => ({ 'en-US': text });
const flow = (...nodes: Record<string, unknown>[]) => ({ version: 1, nodes: [{ id: 't', kind: 'trigger', title: 'When' }, ...nodes] });
const action = (key: string, body: Record<string, unknown>) => ({ id: key, kind: 'action', title: key, action: body });

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
          columns: [
            id,
            { ref: 'name', type: 'text', maxLength: 80 },
            { ref: 'stage', type: 'enum', enum: ['lead', 'quote', 'won'], default: 'lead' },
            { ref: 'came_from', type: 'text', maxLength: 40, nullable: true },
            { ref: 'amount', type: 'int', default: 0 },
            { ref: 'close_on', type: 'timestamptz', nullable: true },
            { ref: 'owner_id', type: 'text', maxLength: 36, nullable: true, rules: { staff: true } },
            { ref: 'phone', type: 'text', maxLength: 40, nullable: true, rules: { personal: true } },
          ],
        },
      ],
    },
    roles: [{ key: 'manager', name: 'Manager', permissions: ['table:@deals:read', 'table:@deals:update', 'page:@crm-deals:view'] }],
    pages: [{ ref: 'crm-deals', template: 'page-crud', title: { key: 't.deals', fallback: 'Deals' }, nav: { group: 'sales', icon: 'list', order: 1 }, bindings: { rows: 'deals' } }],
    automations: [
      {
        key: 'stage-moved',
        name: en('A deal moves: keep where it came from'),
        enabled: true,
        trigger: { kind: 'record', event: 'updated', table: 'deals', changedColumn: 'stage' },
        graph: flow(
          action('keep', { kind: 'record.update', values: { came_from: '{{was.stage}}' } }),
          action('tell', { kind: 'notification', to: { roles: ['manager'] }, title: en('{{record.name}}: {{was.stage}} to {{record.stage}}'), body: en('Phone was {{was.phone}}.') }),
        ),
      },
      {
        key: 'amount-moved',
        name: en('Any change: say the old amount'),
        enabled: true,
        trigger: { kind: 'record', event: 'updated', table: 'deals', when: [{ left: { field: 'stage' }, op: 'is', right: 'won' }] },
        graph: flow(action('mail', { kind: 'email', templateKey: 'crm-moved', to: { kind: 'staff', column: 'owner_id' } })),
      },
    ],
    emailTemplates: [
      {
        key: 'crm-moved',
        name: 'Your deal changed',
        locales: { 'en-US': { subject: '{{record.name}} changed', blocks: [{ block: 'email.text', data: { text: 'It was {{was.amount}}, closing {{was.close_on|some day}}; it is {{record.amount}}.' } }] } },
      },
    ],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } }],
  };
}

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`a rule reads its record as it was, on ${dialect}`, () => {
    let s: WholeServer;
    const notices = async (): Promise<{ title: string; body: string | null }[]> =>
      ((await s.get('mia', '/api/v1/me/notifications?limit=100')).json() as { data: { items: { kind: string; title: string; body: string | null }[] } }).data.items.filter((item) => item.kind === 'automation.notice');

    beforeAll(async () => {
      s = await wholeServer(dialect, crm(), { people: { mia: ['manager'] }, smtp: true });
      await s.rows(`INSERT INTO crm_deals (id, name, stage, amount, owner_id, phone) VALUES (1, 'Atrium', 'lead', 1200, '${s.ids['mia']!}', '+44 20 7946 0001')`);
    }, 180_000);
    afterAll(async () => {
      await s?.close();
    });

    it('writes what the row held before the change, and says it; a personal column stays out of a notice', async () => {
      expect(said(await s.change('owner', 'deals', 1, { stage: 'quote', phone: '+44 20 7946 0002' }))).toBe('ok');
      await s.jobs();
      const [row] = await s.rows('SELECT came_from FROM crm_deals WHERE id = 1');
      expect(row!['came_from']).toBe('lead');
      const told = await notices();
      expect(told).toHaveLength(1);
      expect(told[0]!.title).toBe('Atrium: lead to quote');
      expect(told[0]!.body).not.toContain('0001');
    });

    it('a rule run by any change has the row as it was too, and its e-mail reads it as a mail reads the record', async () => {
      await s.emails();
      expect(said(await s.change('owner', 'deals', 1, { close_on: '2026-11-20T09:00:00.000Z' }))).toBe('ok');
      await s.jobs();
      expect((await s.emails()).filter((one) => one.templateKey === 'crm-moved')).toEqual([]);
      expect(said(await s.change('owner', 'deals', 1, { stage: 'won', amount: 1500, close_on: '2026-12-01T09:00:00.000Z' }))).toBe('ok');
      await s.jobs();
      // The first rule's own write is a change too: the mail of the stage's move is the one that says 1,200 (an amount is money).
      const all = await s.emails();
      const mail = all.filter((one) => one.templateKey === 'crm-moved').find((one) => one.text.includes('It was 1,200.00'));
      const runs = await s.meta.db.selectFrom('adminium_automation_runs').select(['status', 'trace', 'error']).execute();
      expect(mail, JSON.stringify({ mails: all.map((one) => [one.templateKey, one.text]), runs })).toBeDefined();
      expect(mail!.text).toContain('it is 1,500.00');
      expect(mail!.text).toContain('November 20, 2026');
      expect(mail!.text).not.toContain('2026-11-20T');
      expect(mail!.text).not.toContain('some day');
      const [row] = await s.rows('SELECT came_from FROM crm_deals WHERE id = 1');
      expect(row!['came_from']).toBe('quote');
      expect((await notices())[0]!.title).toBe('Atrium: quote to won');
    });

    it('never serves the row as it was, and lets go of it when the run ends', async () => {
      const listed = await s.get('owner', '/api/v1/automation-runs?limit=50');
      expect(listed.statusCode, listed.body).toBe(200);
      expect(listed.body).not.toContain('"before"');
      expect(listed.body).not.toContain('0001');
      const stored = (await s.meta.db.selectFrom('adminium_automation_runs').select(['triggerEvent', 'status']).execute()) as { triggerEvent: unknown; status: string }[];
      expect(stored.length).toBeGreaterThan(0);
      for (const run of stored) {
        const event = (typeof run.triggerEvent === 'string' ? JSON.parse(run.triggerEvent) : run.triggerEvent) as Record<string, unknown>;
        if (run.status !== 'pending' && run.status !== 'running' && run.status !== 'waiting') expect(event['before'], run.status).toBeUndefined();
      }
    });
  });
}
