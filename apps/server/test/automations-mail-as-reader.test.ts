// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT A RULE'S NOTICES AND MAILS CARRY OF THE ROWS ITS STEPS MADE, AND OF
 * ITS RECORD'S SECRETS, against the whole server on SQLite, Postgres and
 * MySQL, through an app installed by the real installer.
 *
 *  - A row an earlier step made (`{{steps.<name>.<column>}}`) reaches each
 *    person told or mailed as that person reads it: nothing of it for
 *    somebody who does not read its table, or whose reach does not take in
 *    that row; a column their role is not shown is empty; the rest as made.
 *  - A mail to an address a column holds (`to: { kind: "field" }`) carries
 *    the record's personal columns (the mail goes to that person) and never a
 *    secret one: not by its name, not under `record.`, not written as a date,
 *    not as it was. A test run's line says no more.
 */
import { automationsRepo, type Automation, type AutomationTriggerEvent } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { walkRule } from '../src/automations/runner.js';
import type { EmailTransport, OutboundEmail } from '../src/email/types.js';
import { TEST_SECRET } from './helpers.js';
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
          belongs: [{ column: 'owner_id', set: 'anyone' }],
          columns: [
            id,
            { ref: 'name', type: 'text', maxLength: 80 },
            { ref: 'stage', type: 'enum', enum: ['lead', 'quote', 'won'], default: 'lead' },
            { ref: 'cost', type: 'int', default: 0 },
            { ref: 'owner_id', type: 'text', maxLength: 36, nullable: true, rules: { staff: true } },
            { ref: 'approver_id', type: 'text', maxLength: 36, nullable: true, rules: { staff: true } },
            { ref: 'email', type: 'text', maxLength: 120, nullable: true, rules: { personal: true } },
            { ref: 'phone', type: 'text', maxLength: 40, nullable: true, rules: { personal: true } },
            { ref: 'token', type: 'text', maxLength: 40, nullable: true, rules: { secret: true } },
            { ref: 'pin_on', type: 'date', nullable: true, rules: { secret: true } },
          ],
        },
        {
          // The costing a rule makes for a deal: whose it is is its own column, not the deal's.
          ref: 'costings',
          belongs: [{ column: 'owner_id', set: 'anyone' }],
          columns: [
            id,
            { ref: 'deal_id', type: 'fk', references: 'deals' },
            { ref: 'owner_id', type: 'text', maxLength: 36, nullable: true, rules: { staff: true } },
            { ref: 'amount', type: 'int', default: 0 },
            { ref: 'note', type: 'text', maxLength: 80, nullable: true },
          ],
        },
      ],
    },
    roles: [
      // A clerk reads every deal, and no costing.
      { key: 'clerk', name: 'Clerk', permissions: ['table:@deals:read', 'page:@crm-deals:view'] },
      // A reader reads every deal and costing, but never a costing's amount.
      { key: 'reader', name: 'Reader', permissions: ['table:@deals:read', 'table:@costings:read', 'page:@crm-deals:view'], limits: { costings: { readable: ['id', 'deal_id', 'owner_id', 'note'] } } },
      // A rep reads only his own deals and costings.
      {
        key: 'rep',
        name: 'Rep',
        permissions: ['table:@deals:read', 'table:@costings:read', 'page:@crm-deals:view'],
        limits: { deals: { rows: { read: { reach: 'own' } } }, costings: { rows: { read: { reach: 'own' } } } },
      },
      { key: 'boss', name: 'Boss', permissions: ['table:@deals:read', 'table:@costings:read', 'page:@crm-deals:view'] },
    ],
    pages: [{ ref: 'crm-deals', template: 'page-crud', title: { key: 't.deals', fallback: 'Deals' }, nav: { group: 'sales', icon: 'list', order: 1 }, bindings: { rows: 'deals' } }],
    automations: [
      {
        key: 'costed',
        name: en('A deal moves: cost it, and say so'),
        enabled: true,
        trigger: { kind: 'record', event: 'updated', table: 'deals', changedColumn: 'stage' },
        graph: flow(
          // The costing is the approver's, not the deal owner's.
          action('make', { kind: 'record.create', table: 'costings', name: 'costing', values: { deal_id: '{{record.id}}', owner_id: '{{record.approver_id}}', amount: '{{record.cost}}', note: 'costed' } }),
          action('roles', { kind: 'notification', to: { roles: ['clerk', 'reader', 'boss'] }, title: en('K {{record.name}} [{{steps.costing.amount}}] [{{steps.costing.note}}]') }),
          action('owner', { kind: 'notification', to: { column: 'owner_id' }, title: en('O {{record.name}} [{{steps.costing.amount}}] [{{steps.costing.note}}]') }),
          action('mail', { kind: 'email', templateKey: 'crm-costed', to: { kind: 'staff', column: 'owner_id' }, vars: { amount: '{{steps.costing.amount}}', note: '{{steps.costing.note}}' } }),
        ),
      },
      {
        // Switched off: the test walks it by hand, with a transport that keeps what it is handed.
        key: 'buyer-mail',
        name: en('Write to the buyer'),
        enabled: false,
        trigger: { kind: 'record', event: 'updated', table: 'deals' },
        graph: flow(action('mail', { kind: 'email', templateKey: 'crm-out', to: { kind: 'field', column: 'email' } })),
      },
    ],
    emailTemplates: [
      { key: 'crm-costed', name: 'Costed', locales: { 'en-US': { subject: 'Costed {{record.name}}', blocks: [{ block: 'email.text', data: { text: 'amount [{{amount}}] note [{{note}}]' } }] } } },
      {
        key: 'crm-out',
        name: 'To the customer',
        locales: {
          'en-US': {
            subject: 'Hello {{record.name}} {{record.token|-}}',
            blocks: [{ block: 'email.text', data: { text: 'token [{{token|-}}] [{{record.token|-}}] pin [{{record.pin_on|-}}] [{{pin_on|-}}] was [{{was.token|-}}] phone [{{record.phone|-}}]' } }],
          },
        },
      },
    ],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } }],
  };
}

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`a rule's notices and mails carry each reader's reading, on ${dialect}`, () => {
    let s: WholeServer;
    const sent: OutboundEmail[] = [];
    const transport: EmailTransport = {
      async send(message) {
        sent.push(message);
        return { response: '250 2.0.0 Ok' };
      },
    };
    const notices = async (who: string, prefix: string): Promise<string[]> =>
      ((await s.get(who, '/api/v1/me/notifications?limit=100')).json() as { data: { items: { kind: string; title: string }[] } }).data.items
        .filter((item) => item.kind === 'automation.notice' && item.title.startsWith(prefix))
        .map((item) => item.title)
        .sort();

    beforeAll(async () => {
      s = await wholeServer(dialect, crm(), { people: { cleo: ['clerk'], reed: ['reader'], ann: ['rep'], ron: ['rep'], bo: ['boss'] }, smtp: true });
      // Deal 1 is Ann's and Ron approves it: its costing is Ron's. Deal 2 is Ann's, and she approves it herself.
      await s.rows(`INSERT INTO crm_deals (id, name, stage, cost, owner_id, approver_id, email, phone, token, pin_on) VALUES (1, 'Atrium', 'lead', 4242, '${s.ids['ann']!}', '${s.ids['ron']!}', 'buyer@atrium.test', '+44 20 7946 0001', 'tok-secret-1', '2031-02-03')`);
      await s.rows(`INSERT INTO crm_deals (id, name, stage, cost, owner_id, approver_id) VALUES (2, 'Bakery', 'lead', 7, '${s.ids['ann']!}', '${s.ids['ann']!}')`);
      await s.emails();
      expect(said(await s.change('owner', 'deals', 1, { stage: 'quote' }))).toBe('ok');
      expect(said(await s.change('owner', 'deals', 2, { stage: 'quote' }))).toBe('ok');
      await s.jobs();
    }, 180_000);
    afterAll(async () => {
      await s?.close();
    });

    it('makes the rows, as the rule reads them', async () => {
      const made = await s.rows('SELECT deal_id, amount, note FROM crm_costings ORDER BY deal_id');
      expect(made.map((row) => [Number(row['deal_id']), Number(row['amount']), row['note']])).toEqual([
        [1, 4242, 'costed'],
        [2, 7, 'costed'],
      ]);
    });

    it('tells nothing of a made row to somebody who does not read its table, and leaves out a column a reader is not shown', async () => {
      expect(await notices('cleo', 'K ')).toEqual(['K Atrium [] []', 'K Bakery [] []']);
      expect(await notices('reed', 'K ')).toEqual(['K Atrium [] [costed]', 'K Bakery [] [costed]']);
      expect(await notices('bo', 'K ')).toEqual(['K Atrium [4242] [costed]', 'K Bakery [7] [costed]']);
    });

    it('tells nothing of a made row outside the reader’s reach, in a notice and in a mail', async () => {
      // Atrium's costing is Ron's: Ann opens the deal, not the costing. Bakery's is her own.
      expect(await notices('ann', 'O ')).toEqual(['O Atrium [] []', 'O Bakery [7] [costed]']);
      const mails = (await s.emails()).filter((mail) => mail.templateKey === 'crm-costed');
      expect(mails.map((mail) => [mail.to, mail.subject]).sort()).toEqual([
        ['ann@crm.test', 'Costed Atrium'],
        ['ann@crm.test', 'Costed Bakery'],
      ]);
      const atrium = mails.find((mail) => mail.subject === 'Costed Atrium')!;
      const bakery = mails.find((mail) => mail.subject === 'Costed Bakery')!;
      expect(atrium.text).toContain('amount [] note []');
      expect(`${atrium.text} ${atrium.html}`).not.toContain('4242');
      expect(bakery.text).toContain('amount [7] note [costed]');
    });

    it('never fills a secret column in a mail to an address a column holds, and a test run says no more', async () => {
      const rule: Automation = (await automationsRepo(s.meta).listManagedBy('crm', s.connectionId)).find((one) => one.templateKey === 'buyer-mail')!;
      const event: AutomationTriggerEvent = {
        event: 'record.updated',
        origin: 'dashboard',
        ruleId: null,
        hops: 0,
        record: { connectionId: s.connectionId, table: s.t('deals'), pk: { id: 1 }, label: 'Atrium' },
        snapshot: { id: 1 },
        before: { id: 1, token: 'tok-was-secret' },
        occurredAt: Date.now(),
      } as AutomationTriggerEvent;
      const deps = { meta: s.meta, manager: s.manager, app: s.app as never, secret: TEST_SECRET, now: () => Date.now(), createTransport: () => transport };
      const ran = await walkRule(deps, { rule, runId: 'arun_field_1', event });
      expect(ran.kind === 'finished' ? ran.status : ran.kind, JSON.stringify(ran)).toBe('succeeded');
      expect(sent).toHaveLength(1);
      const mail = sent[0]!;
      const whole = JSON.stringify(mail);
      expect(whole).not.toContain('tok-secret-1');
      expect(whole).not.toContain('tok-was-secret');
      expect(whole).not.toMatch(/2031|Feb(ruary)? 3/);
      // The mail goes to the buyer, and carries the buyer's own number.
      expect(whole).toContain('buyer@atrium.test');
      expect(whole).toContain('+44 20 7946 0001');
      const tried = await walkRule(deps, { rule, runId: 'arun_field_2', event, dryRun: true });
      expect(JSON.stringify(tried.trace)).not.toContain('tok-secret-1');
      expect(sent).toHaveLength(1);
    });
  });
}
