// SPDX-License-Identifier: AGPL-3.0-only
/**
 * RULES THAT TELL THE PERSON ON THE ROW, against the whole server on SQLite,
 * Postgres and MySQL, each tried as the people it is about:
 *
 *  - a notice and an email addressed to a staff column of the record, or of
 *    the row one of its links names; a record that names nobody;
 *  - "once per spell": told once while a deal is quiet, and again when it
 *    goes quiet anew;
 *  - quiet hours: the email held to their end, an urgent notice and an
 *    "always tell me" kind not held;
 *  - a summary for each person, of their own rows only, read as they read;
 *  - a row a step makes, read by the steps after it, across a wait.
 */
import { automationsRepo, rolesRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { quietUntil } from '../src/notifications/quiet.js';
import { LEGS, said, wholeServer, type WholeServer } from './whole-server.helpers.js';

// The server says the version it was built at; the words tried here are read from the release to come.
vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.27' }));

const en = (text: string) => ({ 'en-US': text });
const id = { ref: 'id', type: 'int', role: 'pk' };
const node = (key: string, action: Record<string, unknown>) => ({ id: key, kind: 'action', title: key, action });
const flow = (...nodes: Record<string, unknown>[]) => ({ version: 1, nodes: [{ id: 't', kind: 'trigger', title: 'When' }, ...nodes] });
const page = (ref: string, table: string, order: number) => ({ ref, template: 'page-crud', title: { key: `t.${ref}`, fallback: ref }, nav: { group: 'sales', icon: 'list', order }, bindings: { rows: table } });
const template = (key: string, subject: string, blocks: Record<string, unknown>[]) => ({ key, name: key, locales: { 'en-US': { subject, blocks } } });

function sales(): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'sales',
    name: 'Sales',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
    license: 'AGPL-3.0-only',
    description: { key: 'mft.sales.desc', fallback: 'Sales.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: '0.3.27', engines: ['postgres', 'mysql', 'sqlite'] },
    navGroups: [{ key: 'sales', label: en('Sales'), order: 1 }],
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'contacts', columns: [id, { ref: 'name', type: 'text', maxLength: 120 }] },
        {
          ref: 'deals',
          belongs: [{ column: 'owner_id', set: 'anyone' }],
          indexes: [['owner_id']],
          columns: [
            id,
            { ref: 'name', type: 'text', maxLength: 120 },
            { ref: 'contact_id', type: 'fk', references: 'contacts', nullable: true },
            { ref: 'owner_id', type: 'text', maxLength: 36, nullable: true, rules: { staff: true } },
            { ref: 'state', type: 'enum', enum: ['open', 'won'], default: 'open' },
            { ref: 'quiet', type: 'int', default: 0 },
            { ref: 'amount', type: 'int', default: 0 },
          ],
        },
        { ref: 'follow_ups', columns: [id, { ref: 'deal_id', type: 'fk', references: 'deals' }, { ref: 'note', type: 'text', maxLength: 200, nullable: true }] },
        { ref: 'enquiries', columns: [id, { ref: 'name', type: 'text', maxLength: 120 }] },
      ],
    },
    roles: [
      { key: 'rep', name: 'Rep', permissions: ['table:@deals:read', 'table:@deals:create', 'table:@deals:update', 'table:@follow_ups:read', 'page:@sales-deals:view'], limits: { deals: { rows: { read: { reach: 'own' }, update: { reach: 'own' } } } } },
      { key: 'manager', name: 'Manager', permissions: ['table:@deals:read', 'table:@deals:update', 'page:@sales-deals:view'] },
      { key: 'clerk', name: 'Clerk', permissions: ['table:@enquiries:read', 'table:@enquiries:create'] },
    ],
    pages: [page('sales-deals', 'deals', 1), page('sales-enquiries', 'enquiries', 2)],
    emailTemplates: [
      template('sales-week', 'Your open deals, {{name}}', [
        { block: 'email.text', data: { text: '{{count.open}} open.' } },
        { block: 'email.rows', id: 'rows-open', data: { section: 'open', row: { title: '{{row.name}}', amount: '{{row.amount}}' }, empty: 'Nothing is open.' } },
      ]),
      template('sales-won', '{{record.name}} is won', [{ block: 'email.text', data: { text: 'Well done on {{record.name}}.' } }]),
    ],
    automations: [
      {
        key: 'quiet-deal',
        name: en('A quiet deal: tell its owner'),
        enabled: true,
        trigger: { kind: 'schedule', schedule: { kind: 'interval', everyMinutes: '5' }, forEach: { table: 'deals', once: 'per-spell', where: [{ left: { field: 'quiet' }, op: 'is', right: 1 }] } },
        graph: flow(node('tell', { kind: 'notification', to: { column: 'owner_id' }, title: en('Quiet: {{record.name}}') })),
      },
      {
        key: 'follow-up-made',
        name: en('A follow-up is made: tell the deal’s owner'),
        enabled: true,
        trigger: { kind: 'record', event: 'created', table: 'follow_ups' },
        graph: flow(node('tell', { kind: 'notification', to: { column: 'deal_id.owner_id' }, title: en('A follow-up on your deal') })),
      },
      {
        key: 'amount-changed',
        name: en('A deal’s amount changes: tell its owner at once'),
        enabled: true,
        trigger: { kind: 'record', event: 'updated', table: 'deals', changedColumn: 'amount' },
        graph: flow(node('tell', { kind: 'notification', to: { column: 'owner_id' }, title: en('Amount changed: {{record.name}}'), urgent: true })),
      },
      {
        key: 'deal-won',
        name: en('A deal is won: write to its owner'),
        enabled: true,
        trigger: { kind: 'record', event: 'updated', table: 'deals', changedColumn: 'state', when: [{ left: { field: 'state' }, op: 'is', right: 'won' }] },
        graph: flow(node('mail', { kind: 'email', templateKey: 'sales-won', to: { kind: 'staff', column: 'owner_id' } })),
      },
      {
        key: 'weekly',
        name: en('Each person’s open deals'),
        enabled: true,
        trigger: { kind: 'schedule', schedule: { kind: 'interval', everyMinutes: '60' } },
        graph: flow(node('sum', { kind: 'digest', templateKey: 'sales-week', to: { roles: ['rep', 'manager'] }, sections: [{ key: 'open', table: 'deals', owner: 'owner_id', where: [{ left: { field: 'state' }, op: 'is', right: 'open' }], orderBy: { column: 'name' } }] })),
      },
      {
        key: 'enquiry-in',
        name: en('An enquiry: a contact, a deal for them, and a follow-up on it'),
        enabled: true,
        trigger: { kind: 'record', event: 'created', table: 'enquiries' },
        graph: flow(
          node('contact', { kind: 'record.create', table: 'contacts', name: 'contact', values: { name: '{{record.name}}' } }),
          node('deal', { kind: 'record.create', table: 'deals', name: 'deal', values: { name: 'Deal for {{steps.contact.name}}', contact_id: '{{steps.contact.id}}' } }),
          { id: 'w', kind: 'wait', title: 'An hour', amount: 1, unit: 'hours' },
          node('follow', { kind: 'record.create', table: 'follow_ups', values: { deal_id: '{{steps.deal.id}}', note: 'Call {{steps.contact.name}}' } }),
        ),
      },
    ],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } }],
  };
}

describe('quiet hours, on a person’s own clock', () => {
  const evening = { timezone: 'Europe/Berlin', quiet: { '1': { from: '18:00', to: '08:00' }, '2': { from: '12:00', to: '13:00' } } };
  // 12 October 2026 is a Monday; Berlin is two hours ahead of UTC that day.
  const at = (text: string): number => Date.parse(text);

  it('holds a notice of 19:00 to 08:00 the next morning', () => {
    expect(new Date(quietUntil(evening, null, at('2026-10-12T17:00:00Z'))!).toISOString()).toBe('2026-10-13T06:00:00.000Z');
  });

  it('counts the small hours as the evening before’s window', () => {
    expect(new Date(quietUntil(evening, null, at('2026-10-13T01:30:00Z'))!).toISOString()).toBe('2026-10-13T06:00:00.000Z');
  });

  it('holds nothing outside a window, on a day with none, or for a person who set none', () => {
    expect(quietUntil(evening, null, at('2026-10-12T15:00:00Z'))).toBeNull();
    // Tuesday's own window is the lunch hour; the evening has none.
    expect(new Date(quietUntil(evening, null, at('2026-10-13T10:30:00Z'))!).toISOString()).toBe('2026-10-13T11:00:00.000Z');
    expect(quietUntil(evening, null, at('2026-10-13T17:00:00Z'))).toBeNull();
    expect(quietUntil(evening, null, at('2026-10-14T17:00:00Z'))).toBeNull();
    expect(quietUntil(null, 'Europe/Berlin', at('2026-10-12T17:00:00Z'))).toBeNull();
  });

  it('reads the hours on the business’s clock for a person who chose no zone of their own', () => {
    const noZone = { timezone: null, quiet: { '1': { from: '18:00', to: '08:00' } } };
    // 19:00 in Cairo (UTC+2 that day) is 17:00 UTC; the same instant is 13:00 in New York, outside the window.
    expect(quietUntil(noZone, 'Africa/Cairo', at('2026-10-12T17:00:00Z'))).not.toBeNull();
    expect(quietUntil(noZone, 'America/New_York', at('2026-10-12T17:00:00Z'))).toBeNull();
  });
});

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`rules that tell the person on the row, on ${dialect}`, () => {
    let s: WholeServer;
    const notices = async (who: string): Promise<string[]> => ((await s.get(who, '/api/v1/me/notifications?limit=100')).json() as { data: { items: { title: string }[] } }).data.items.map((item) => item.title).sort();
    const dealId = async (name: string): Promise<number> => Number((await s.rows(`select id from sales_deals where name = '${name}'`))[0]!['id']);
    const runsOf = async (key: string) => {
      const rule = (await automationsRepo(s.meta).listManagedBy('sales', s.connectionId)).find((one) => one.templateKey === key)!;
      return (await s.meta.db.selectFrom('adminium_automation_runs').selectAll().where('automationId', '=', rule.id).orderBy('startedAt', 'asc').execute()).map((run) => ({ status: run.status, trace: typeof run.trace === 'string' ? run.trace : JSON.stringify(run.trace) }));
    };

    beforeAll(async () => {
      s = await wholeServer(dialect, sales(), { people: { dana: ['rep'], noor: ['rep'], ivy: ['manager'], cole: ['clerk'] }, smtp: true });
      for (const [name, owner, quiet] of [['Atrium', s.ids['dana'], 1], ['Loft', null, 1], ['Mews', s.ids['dana'], 0], ['Yard', s.ids['ivy'], 0]] as const) {
        expect(said(await s.make('owner', 'deals', { name, owner_id: owner, quiet }))).toBe('ok');
      }
    }, 180_000);
    afterAll(async () => {
      await s?.close();
    });

    it('tells the owner of a quiet deal once for the spell, and says so of a deal nobody owns', async () => {
      expect(await s.tick()).toBeGreaterThanOrEqual(2);
      await s.jobs({ except: ['digest.send'] });
      expect(await notices('dana')).toEqual(['Quiet: Atrium']);
      // The deal with nobody in the column told nobody: its run went through, and its log says why.
      const runs = await runsOf('quiet-deal');
      expect(runs.map((run) => run.status)).toEqual(['succeeded', 'succeeded']);
      expect(runs.some((run) => run.trace.includes('Nobody is named in owner_id on this record'))).toBe(true);
      // Still quiet at the next look: nobody is told a second time.
      await s.tick();
      await s.jobs({ except: ['digest.send'] });
      expect(await notices('dana')).toEqual(['Quiet: Atrium']);
    });

    it('tells them again when the deal, worked on, goes quiet anew', async () => {
      await s.rows("update sales_deals set quiet = 0 where name = 'Atrium'");
      await s.tick();
      await s.jobs({ except: ['digest.send'] });
      expect(await notices('dana')).toEqual(['Quiet: Atrium']);
      await s.rows("update sales_deals set quiet = 1 where name = 'Atrium'");
      await s.tick();
      await s.jobs({ except: ['digest.send'] });
      expect(await notices('dana')).toEqual(['Quiet: Atrium', 'Quiet: Atrium']);
      expect((await runsOf('quiet-deal')).length).toBe(3);
    });

    it('tells the person a linked row names: a follow-up tells its deal’s owner', async () => {
      expect(said(await s.make('owner', 'follow_ups', { deal_id: await dealId('Atrium'), note: 'Ring back' }))).toBe('ok');
      await s.jobs({ except: ['digest.send'] });
      expect(await notices('dana')).toContain('A follow-up on your deal');
      expect(await notices('noor')).toEqual([]);
    });

    it('holds a notice’s email to the end of the reader’s quiet hours, and lets an urgent one through', async () => {
      await s.emails();
      // Quiet all day, every day, on her own clock: from midnight to the next midnight.
      const always = Object.fromEntries(['0', '1', '2', '3', '4', '5', '6'].map((day) => [day, { from: '00:00', to: '00:00' }]));
      const saved = await s.send('dana', 'PUT', '/api/v1/me/notification-schedule', { timezone: 'UTC', quiet: always, digestDay: null, digestTime: null });
      expect(saved.statusCode, saved.body).toBe(200);
      expect((await s.get('dana', '/api/v1/me/notification-schedule')).json().data).toMatchObject({ timezone: 'UTC', quiet: always });
      expect(said(await s.send('dana', 'PUT', '/api/v1/me/notification-schedule', { timezone: 'Mars/Olympus', quiet: null, digestDay: null, digestTime: null }))).toBe('422 VALIDATION_FAILED');

      const before = Date.now();
      expect(said(await s.make('owner', 'follow_ups', { deal_id: await dealId('Atrium'), note: 'Again' }))).toBe('ok');
      await s.jobs({ except: ['digest.send'] });
      const held = (await s.emails()).filter((mail) => mail.to === 'dana@sales.test');
      expect(held).toHaveLength(1);
      // Held to the next midnight on her clock; the notice itself is in the bell already.
      const midnight = new Date(before);
      midnight.setUTCHours(24, 0, 0, 0);
      expect(held[0]!.runAt).toBeGreaterThan(before);
      expect(Math.abs(held[0]!.runAt - midnight.getTime())).toBeLessThan(120_000);
      expect((await notices('dana')).filter((title) => title === 'A follow-up on your deal')).toHaveLength(2);

      // Urgent: at once, quiet hours or not.
      expect(said(await s.change('owner', 'deals', await dealId('Atrium'), { amount: 5200 }))).toBe('ok');
      await s.jobs({ except: ['digest.send'] });
      const urgent = (await s.emails()).filter((mail) => mail.to === 'dana@sales.test');
      expect(urgent).toHaveLength(1);
      expect(urgent[0]!.runAt).toBeLessThanOrEqual(Date.now());
      expect(urgent[0]!.html).toContain('Amount changed: Atrium');

      // "Always tell me" for a rule's notices: hers to say, and then nothing of that kind waits.
      const prefs = await s.send('dana', 'PUT', '/api/v1/me/notification-prefs', { events: [{ key: 'automation.notice', channels: { inApp: true, email: true, push: false, always: true } }] });
      expect(prefs.statusCode, prefs.body).toBe(200);
      expect(said(await s.make('owner', 'follow_ups', { deal_id: await dealId('Atrium'), note: 'Third' }))).toBe('ok');
      await s.jobs({ except: ['digest.send'] });
      const told = (await s.emails()).filter((mail) => mail.to === 'dana@sales.test');
      expect(told).toHaveLength(1);
      expect(told[0]!.runAt).toBeLessThanOrEqual(Date.now());
      await s.send('dana', 'PUT', '/api/v1/me/notification-prefs', { events: [{ key: 'automation.notice', channels: { inApp: true, email: true, push: false, always: false } }] });
    });

    it('writes an email to the person on the row, in the queue, held like a notice', async () => {
      await s.emails();
      const before = Date.now();
      expect(said(await s.change('owner', 'deals', await dealId('Mews'), { state: 'won' }))).toBe('ok');
      await s.jobs({ except: ['digest.send'] });
      const mail = (await s.emails()).filter((one) => one.templateKey === 'sales-won');
      expect(mail).toHaveLength(1);
      expect(mail[0]).toMatchObject({ to: 'dana@sales.test', subject: 'Mews is won' });
      expect(mail[0]!.runAt).toBeGreaterThan(before);
      expect((await runsOf('deal-won')).at(-1)!.trace).toContain('Held for Dana until');
      // A won deal nobody owns writes to nobody, and that is not a failure.
      expect(said(await s.change('owner', 'deals', await dealId('Loft'), { state: 'won' }))).toBe('ok');
      await s.jobs({ except: ['digest.send'] });
      expect((await s.emails()).filter((one) => one.templateKey === 'sales-won')).toEqual([]);
      expect((await runsOf('deal-won')).at(-1)).toMatchObject({ status: 'succeeded' });
      await s.send('dana', 'PUT', '/api/v1/me/notification-schedule', { timezone: null, quiet: null, digestDay: null, digestTime: null });
    });

    it('makes each person a summary of their own rows, read as they read, at the hour they chose', async () => {
      await s.emails();
      // Dana chose Mondays at 08:00 on her own clock; the others chose nothing.
      await s.send('dana', 'PUT', '/api/v1/me/notification-schedule', { timezone: 'Africa/Cairo', quiet: null, digestDay: 1, digestTime: '08:00' });
      await s.rows("update sales_deals set state = 'open' where name = 'Mews'");
      await s.meta.db.deleteFrom('adminium_jobs').where('kind', '=', 'digest.send').execute();
      await s.tick();
      await s.jobs({ except: ['digest.send'] });
      const queued = await s.meta.db.selectFrom('adminium_jobs').select(['payload', 'runAt']).where('kind', '=', 'digest.send').where('status', '=', 'pending').execute();
      const whose = (row: { payload: unknown }) => (typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload).userId as string;
      // One a person who holds one of the step's roles: two reps and a manager, never the clerk or the owner.
      expect(queued.map(whose).sort()).toEqual([s.ids['dana'], s.ids['noor'], s.ids['ivy']].sort());
      const danas = queued.find((row) => whose(row) === s.ids['dana'])!;
      expect(danas.runAt).toBeGreaterThan(Date.now());
      expect(danas.runAt - Date.now()).toBeLessThanOrEqual(7 * 24 * 3_600_000 + 60_000);
      expect(new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Cairo', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(danas.runAt))).toBe('Mon 08:00');
      expect(queued.find((row) => whose(row) === s.ids['ivy'])!.runAt).toBeLessThanOrEqual(Date.now());

      await s.jobs({ all: true });
      const mails = (await s.emails()).filter((mail) => mail.templateKey === 'sales-week');
      // Dana: her two open deals and nobody else's. Ivy reads every deal, and is still sent only her own.
      const dana = mails.find((mail) => mail.to === 'dana@sales.test')!;
      expect(dana.subject).toBe('Your open deals, Dana');
      expect(dana.text).toContain('2 open.');
      expect(dana.text).toContain('Atrium');
      expect(dana.text).toContain('Mews');
      expect(dana.text).not.toContain('Yard');
      const ivy = mails.find((mail) => mail.to === 'ivy@sales.test')!;
      expect(ivy.text).toContain('1 open.');
      expect(ivy.text).toContain('Yard');
      expect(ivy.text).not.toContain('Atrium');
      // Noor has none: no email is made for nothing.
      expect(mails.find((mail) => mail.to === 'noor@sales.test')).toBeUndefined();
      expect(mails).toHaveLength(2);
    });

    it('sends no summary to somebody who lost the role between the rule’s run and the send', async () => {
      await s.emails();
      await s.send('dana', 'PUT', '/api/v1/me/notification-schedule', { timezone: null, quiet: null, digestDay: null, digestTime: null });
      await s.tick();
      await s.jobs({ except: ['digest.send'] });
      await rolesRepo(s.meta).removeFromUser(s.ids['ivy']!, (await rolesRepo(s.meta).findBySlug('sales-manager'))!.id);
      await s.jobs({ all: true });
      const mails = (await s.emails()).filter((mail) => mail.templateKey === 'sales-week');
      expect(mails.map((mail) => mail.to)).toEqual(['dana@sales.test']);
      await rolesRepo(s.meta).assignToUser(s.ids['ivy']!, (await rolesRepo(s.meta).findBySlug('sales-manager'))!.id);
    });

    it('makes a contact, a deal for them and, after a wait, a follow-up on that deal, in one rule', async () => {
      expect(said(await s.make('cole', 'enquiries', { name: 'Nordwind' }))).toBe('ok');
      await s.jobs({ except: ['digest.send'] });
      const contact = (await s.rows("select id, name from sales_contacts where name = 'Nordwind'"))[0]!;
      const deal = (await s.rows("select id, name, contact_id from sales_deals where name = 'Deal for Nordwind'"))[0]!;
      expect(Number(deal['contact_id'])).toBe(Number(contact['id']));
      // Before the wait is over: no follow-up yet, and the run is waiting with what it made in its trace.
      const waiting = (await runsOf('enquiry-in')).at(-1)!;
      expect(waiting.status).toBe('waiting');
      expect(waiting.trace).toContain('"name":"contact"');
      expect(waiting.trace).toContain('"name":"deal"');
      expect(await s.rows(`select id from sales_follow_ups where deal_id = ${String(deal['id'])}`)).toEqual([]);
      // It comes back as a new job, with nothing but its trace to remember by.
      await s.jobs({ all: true, except: ['digest.send'] });
      const follow = await s.rows(`select note from sales_follow_ups where deal_id = ${String(deal['id'])}`);
      expect(follow.map((row) => row['note'])).toEqual(['Call Nordwind']);
      expect((await runsOf('enquiry-in')).at(-1)!.status).toBe('succeeded');
    });

    it('refuses a rule that reads a row no step before it makes, and stops a run whose row was not made', async () => {
      const trigger = { kind: 'record', event: 'created', connectionId: s.connectionId, table: s.t('enquiries'), watch: false };
      const create = (key: string, table: string, values: Record<string, string>, name?: string) => ({ id: key, kind: 'action', title: key, onError: false, action: { kind: 'record.create', table: s.t(table), values, ...(name === undefined ? {} : { name }) } });
      const refused = await s.send('owner', 'POST', '/api/v1/automations', {
        name: 'Reads a ghost',
        connectionId: s.connectionId,
        trigger,
        graph: { version: 1, nodes: [{ id: 't', kind: 'trigger', title: 'When' }, create('a', 'contacts', { name: '{{steps.ghost.name}}' })] },
      });
      expect(said(refused)).toBe('422 VALIDATION_FAILED');
      expect(refused.body).toContain('no step before this one makes a row called \\"ghost\\"');

      // Made only on one side of a fork: saved, and a run that took the other side stops at the step that reads it.
      const forked = await s.send('owner', 'POST', '/api/v1/automations', {
        name: 'Forked',
        connectionId: s.connectionId,
        enabled: true,
        trigger,
        graph: {
          version: 1,
          nodes: [
            { id: 't', kind: 'trigger', title: 'When' },
            {
              id: 'b',
              kind: 'branch',
              title: 'Is it Halden?',
              condition: { left: { field: 'name' }, op: 'is', right: 'Halden' },
              branches: [
                { id: 'yes', label: 'Yes', nodes: [create('c', 'contacts', { name: '{{record.name}}' }, 'maybe')] },
                { id: 'no', label: 'No', nodes: [] },
              ],
            },
            create('d', 'deals', { name: 'For {{steps.maybe.name}}' }),
          ],
        },
      });
      expect(forked.statusCode, forked.body).toBe(201);
      const ruleId = (forked.json() as { id: string }).id;
      expect(said(await s.make('cole', 'enquiries', { name: 'Someone else' }))).toBe('ok');
      await s.jobs({ except: ['digest.send'] });
      const run = (await s.meta.db.selectFrom('adminium_automation_runs').selectAll().where('automationId', '=', ruleId).execute())[0]!;
      expect(run.status).toBe('failed');
      expect(String(run.error)).toContain('no earlier step of this run made a row called "maybe"');
      expect(await s.rows("select id from sales_deals where name like 'For %'")).toEqual([]);

      // A test run makes nothing: the step after reads a stand-in, and the log says so.
      const contactsBefore = (await s.rows('select id from sales_contacts')).length;
      const tried = await s.send('owner', 'POST', `/api/v1/automations/${ruleId}/test`, {
        trigger,
        graph: { version: 1, nodes: [{ id: 't', kind: 'trigger', title: 'When' }, create('c', 'contacts', { name: '{{record.name}}' }, 'made'), create('d', 'deals', { name: 'For {{steps.made.name}}' })] },
      });
      expect(tried.statusCode, tried.body).toBe(200);
      const trace = JSON.stringify((tried.json() as { trace: unknown }).trace);
      expect(trace).toContain('stand-in for the row \\"made\\"');
      expect(trace).toContain('For Someone else');
      expect((await s.rows('select id from sales_contacts')).length).toBe(contactsBefore);
      expect(await s.rows("select id from sales_deals where name = 'For Someone else'")).toEqual([]);
      await s.send('owner', 'DELETE', `/api/v1/automations/${ruleId}`);
    });
  });
}
