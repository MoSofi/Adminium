// SPDX-License-Identifier: AGPL-3.0-only
/**
 * MARKETING OR SERVICE, as an installed app sends: against the whole server
 * with the app's database on SQLite, Postgres and MySQL, through the real
 * installer.
 *
 *  - the day the engine ships, an app built for an older Adminium (no
 *    classes) still sends its receipts, and its rule's mail, to an address on
 *    the do-not-email list;
 *  - an app that says its classes sends its service kind to that address and
 *    skips its marketing kind for it; skips its marketing kind for a person
 *    who has not agreed; and while the sender is not ready (no postal
 *    address) records the kind as skipped with the reason, tells the people
 *    who manage e-mail once, and never tries it again;
 *  - with the sender ready, the marketing kind goes with both list headers
 *    and the locked footer, the service kind with neither;
 *  - a rule's e-mail to staff (a `listed` step) and a summary (a digest)
 *    reach a staff member whose own address is on the list;
 *  - a sequence: unsubscribe between its first and second marketing mail and
 *    the second is not sent; press "Replied" between them, likewise; with
 *    neither, it goes, signed and carrying its unsubscribe.
 */
import { automationRunsRepo, automationsRepo, settingsRepo, type Automation, type AutomationTriggerEvent } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { walkRule, type RunOutcome } from '../src/automations/runner.js';
import { createConsentService } from '../src/consent/index.js';
import { createMarketingMail, type MarketingMail } from '../src/email/marketing.js';
import { createDkimKeys, createTxtLookup } from '../src/email/sender/index.js';
import type { EmailTransport, OutboundEmail } from '../src/email/types.js';
import { TEST_SECRET } from './helpers.js';
import { LEGS, said, wholeServer, type QueuedEmail, type WholeServer } from './whole-server.helpers.js';

// The engine that reads the classes; an app built for 0.3.28 is installed on it unchanged.
vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.37' }));

const POSTAL = 'Meridian Workplace Ltd, 4 Wharf Lane, Leeds LS1 4BR, United Kingdom';
const ORIGIN = 'https://crm.meridian.example';
const DAY = 86_400_000;

const en = (text: string) => ({ 'en-US': text });
const id = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength = 120, more: Record<string, unknown> = {}) => ({ ref, type: 'text', maxLength, nullable: true, ...more });
const staff = (ref: string, nullable = false) => ({ ref, type: 'text', maxLength: 36, ...(nullable ? { nullable: true } : {}), rules: { staff: true } });
const fk = (ref: string, references: string) => ({ ref, type: 'fk', references, nullable: true });
const template = (key: string, subject: string, body = 'Hello {{recipient.name}}.') => ({ key, name: key, locales: { 'en-US': { subject, blocks: [{ block: 'email.text', data: { text: body } }] } } });
const flow = (...nodes: Record<string, unknown>[]) => ({ version: 1, nodes: [{ id: 't', kind: 'trigger', title: 'When' }, ...nodes] });

/** A shop: receipts (service) and offers (marketing), a welcome sequence, a deal team and a weekly summary. */
function shop(opts: { classed: boolean }): Record<string, unknown> {
  const classed = opts.classed;
  const mail = (key: string, templateKey: string, more: Record<string, unknown> = {}) => ({ id: key, kind: 'action', title: key, action: { kind: 'email', templateKey, to: { kind: 'field', column: 'email' }, ...(classed ? { class: 'marketing' } : {}), ...more } });
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'shop',
    name: 'Shop',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
    license: 'AGPL-3.0-only',
    description: { key: 'mft.shop.desc', fallback: 'A shop.' },
    categories: ['crm'],
    compatibility: { minAdminiumVersion: classed ? '0.3.37' : '0.3.28', engines: ['postgres', 'mysql', 'sqlite'] },
    navGroups: [{ key: 'sales', label: en('Sales'), order: 1 }],
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'settings', columns: [id, text('name', 80), text('house_email', 254)] },
        { ref: 'customers', columns: [id, text('email', 254), text('name', 80)] },
        { ref: 'orders', columns: [id, fk('customer_id', 'customers'), text('item', 80)] },
        {
          ref: 'messages',
          columns: [
            id,
            { ref: 'kind', type: 'enum', enum: ['receipt', 'offer'] },
            { ref: 'status', type: 'enum', enum: ['queued', 'sent', 'failed', 'skipped'], default: 'queued' },
            text('to_address', 254),
            fk('customer_id', 'customers'),
            fk('order_id', 'orders'),
            text('error', 200),
            { ref: 'sent_at', type: 'timestamptz', nullable: true },
          ],
        },
        {
          ref: 'deals',
          belongs: [{ column: 'owner_id' }, { through: { table: 'deal_members', link: 'deal_id', user: 'user_id' } }],
          indexes: [['owner_id']],
          columns: [id, { ref: 'name', type: 'text', maxLength: 80 }, staff('owner_id', true), { ref: 'state', type: 'enum', enum: ['open', 'won'], default: 'open' }],
        },
        {
          ref: 'deal_members',
          belongs: [{ via: 'deal_id' }],
          indexes: [['deal_id'], ['user_id']],
          columns: [id, { ref: 'deal_id', type: 'fk', references: 'deals' }, staff('user_id')],
        },
      ],
    },
    roles: [{ key: 'rep', name: 'Rep', permissions: ['table:@deals:read', 'table:@deal_members:read', 'table:@customers:read', 'page:@shop-deals:view'] }],
    pages: [{ ref: 'shop-deals', template: 'page-crud', title: { key: 't.deals', fallback: 'Deals' }, nav: { group: 'sales', icon: 'list', order: 1 }, bindings: { rows: 'deals' } }],
    outbox: {
      table: 'messages',
      columns: { kind: 'kind', status: 'status', to: 'to_address', error: 'error', sentAt: 'sent_at' },
      links: { order: 'order_id' },
      recipient: { via: 'customer_id', table: 'customers', email: 'email', name: 'name' },
      settings: { table: 'settings', name: 'name', replyTo: 'house_email' },
      kinds: { receipt: 'shop-receipt', ...(classed ? { offer: 'shop-offer' } : {}) },
      ...(classed ? { classes: { receipt: 'service', offer: 'marketing' } } : {}),
      producers: [
        { kind: 'receipt', link: 'order_id', onCreate: { table: 'orders' } },
        ...(classed ? [{ kind: 'offer', link: 'order_id', onCreate: { table: 'orders' } }] : []),
      ],
    },
    emailTemplates: [
      template('shop-receipt', 'Your receipt: {{order.item}}'),
      template('shop-offer', 'A code for your next order'),
      template('shop-news', 'Welcome to our news', 'Hello {{record.name}}.'),
      template('shop-news-2', 'More of our news', 'Hello again {{record.name}}.'),
      template('shop-deal-people', 'A deal you are on: {{record.name}}', 'Open it: {{recordUrl}}'),
      {
        key: 'shop-week',
        name: 'shop-week',
        locales: { 'en-US': { subject: 'Your open deals, {{name}}', blocks: [{ block: 'email.rows', id: 'rows-open', data: { section: 'open', row: { title: '{{row.name}}' }, empty: 'Nothing is open.' } }] } },
      },
    ],
    automations: [
      {
        // Walked by hand below, with a recording mail server: send, wait three days, send again.
        key: 'welcome',
        name: en('A new customer: our news, twice'),
        enabled: false,
        trigger: { kind: 'record', event: 'created', table: 'customers' },
        graph: flow(mail('first', 'shop-news'), { id: 'wait', kind: 'wait', title: 'Wait 3 days', amount: 3, unit: 'days' }, mail('second', 'shop-news-2')),
      },
      {
        key: 'deal-people',
        name: en('A deal is renamed: write to its team'),
        enabled: true,
        trigger: { kind: 'record', event: 'updated', table: 'deals', changedColumn: 'name' },
        graph: flow({ id: 'mail', kind: 'action', title: 'mail', action: { kind: 'email', templateKey: 'shop-deal-people', to: { kind: 'listed', table: 'deal_members' } } }),
      },
      {
        key: 'weekly',
        name: en('Each rep’s open deals'),
        enabled: true,
        trigger: { kind: 'schedule', schedule: { kind: 'interval', everyMinutes: '60' } },
        graph: flow({ id: 'sum', kind: 'action', title: 'sum', action: { kind: 'digest', templateKey: 'shop-week', to: { roles: ['rep'] }, sections: [{ key: 'open', table: 'deals', owner: 'owner_id', where: [{ left: { field: 'state' }, op: 'is', right: 'open' }] }] } }),
      },
    ],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } }],
  };
}

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`an app built before the classes, on ${dialect}`, () => {
    let s: WholeServer;
    beforeAll(async () => {
      s = await wholeServer(dialect, shop({ classed: false }), { smtp: true, compose: { marketingSeams: { lookup: createTxtLookup({ resolve: async () => [] }), postalAddress: async () => null } } });
      await s.rows(`INSERT INTO shop_settings (id, name) VALUES (1, 'Meridian')`);
      await s.rows(`INSERT INTO shop_customers (id, email, name) VALUES (1, 'stopped@harbour.dev', 'Sam Stopped')`);
      await createConsentService({ meta: s.meta, secret: TEST_SECRET }).stop.add({ address: 'stopped@harbour.dev', reason: 'link' });
      await s.emails();
    }, 180_000);
    afterAll(async () => {
      await s?.close();
    });

    it('still sends its receipt, as service mail, to an address on the do-not-email list', async () => {
      expect(said(await s.make('owner', 'orders', { id: 1, customer_id: 1, item: 'Desk lamp' }))).toBe('ok');
      await s.app.outboxSender.sendApp('shop', Date.now());
      const mail = (await s.emails()).filter((one) => one.templateKey === 'shop-receipt') as (QueuedEmail & { mailClass?: string; headers?: unknown })[];
      expect(mail).toHaveLength(1);
      expect(mail[0]).toMatchObject({ to: 'stopped@harbour.dev', subject: 'Your receipt: Desk lamp', mailClass: 'service' });
      expect(mail[0]!.headers).toBeUndefined();
      expect(await s.rows(`SELECT status, error FROM shop_messages`)).toEqual([{ status: 'sent', error: null }]);
    });

    it('its rule’s mail to the record’s own address (no class) goes to that address as well', async () => {
      const rule = (await automationsRepo(s.meta).listManagedBy('shop', s.connectionId)).find((one) => one.templateKey === 'welcome')!;
      const sent: OutboundEmail[] = [];
      const event: AutomationTriggerEvent = { event: 'record.created', origin: 'dashboard', ruleId: null, hops: 0, record: { connectionId: s.connectionId, table: s.t('customers'), pk: { id: 1 }, label: '1' }, snapshot: { id: 1 }, occurredAt: Date.now() };
      const outcome = await walkRule({ meta: s.meta, manager: s.manager, app: s.app as never, secret: TEST_SECRET, now: () => Date.now(), createTransport: () => ({ send: async (msg) => void sent.push(msg) }) }, { rule, runId: 'arun_old', event });
      expect(outcome.kind).toBe('waiting');
      expect(sent.map((one) => one.to)).toEqual(['stopped@harbour.dev']);
      expect(sent[0]!.headers).toBeUndefined();
    });
  });

  describe.skipIf(!reachable)(`an app that says its classes, on ${dialect}`, () => {
    let s: WholeServer;
    let postal: string | null = null;
    let dns: Map<string, string[]>;
    let kit: MarketingMail;
    const consent = () => createConsentService({ meta: s.meta, secret: TEST_SECRET });
    const messages = async (order: number) => s.rows(`SELECT kind, status, error FROM shop_messages WHERE order_id = ${String(order)} ORDER BY kind`);
    const order = async (key: number, customer: number) => {
      expect(said(await s.make('owner', 'orders', { id: key, customer_id: customer, item: `Item ${String(key)}` }))).toBe('ok');
      await s.app.outboxSender.sendApp('shop', Date.now());
      return (await s.emails()) as (QueuedEmail & { mailClass?: string; headers?: Record<string, string> })[];
    };

    beforeAll(async () => {
      dns = new Map();
      const lookup = createTxtLookup({ cacheMs: 0, resolve: async (name) => (dns.get(name) ?? []).map((record) => [record]) });
      s = await wholeServer(dialect, shop({ classed: true }), { people: { dana: ['rep'], ivy: ['rep'] }, smtp: true, compose: { marketingSeams: { lookup, postalAddress: async () => postal } } });
      kit = createMarketingMail({ meta: s.meta, secret: TEST_SECRET, lookup, postalAddress: async () => postal });
      await s.rows(`INSERT INTO shop_settings (id, name, house_email) VALUES (1, 'Meridian', 'hello@meridian.example')`);
      for (const [key, email, name] of [
        [1, 'stopped@harbour.dev', 'Sam Stopped'],
        [2, 'agreed@harbour.dev', 'Ana Agreed'],
        [3, 'silent@harbour.dev', 'Sid Silent'],
        [4, 'seq-stop@harbour.dev', 'Una Unsubscribes'],
        [5, 'seq-replied@harbour.dev', 'Rae Replies'],
        [6, 'seq-ok@harbour.dev', 'Oli Reads'],
      ] as const) {
        await s.rows(`INSERT INTO shop_customers (id, email, name) VALUES (${String(key)}, '${email}', '${name}')`);
      }
      const log = consent();
      for (const key of [1, 2, 4, 5, 6]) await log.record({ person: { connectionId: s.connectionId, table: s.t('customers'), key: String(key) }, purpose: 'newsletter', source: 'import', state: 'yes' });
      await log.stop.add({ address: 'stopped@harbour.dev', reason: 'link' });
      // Sender ready but for the postal address: a public address, DMARC, and Adminium's key published.
      await settingsRepo(s.meta).set('system.publicOrigin', ORIGIN, { updatedBy: null });
      await settingsRepo(s.meta).set('system.instanceId', 'install-1', { updatedBy: null });
      await settingsRepo(s.meta).set('email.smtp', { ...(await settingsRepo(s.meta).get('email.smtp'))!, from: 'Meridian <news@meridian.example>' }, { updatedBy: null });
      const key = await createDkimKeys({ meta: s.meta, secret: TEST_SECRET }).make('meridian.example');
      dns.set('_dmarc.meridian.example', ['v=DMARC1; p=quarantine']);
      dns.set(key.record.name, [key.record.value]);
      await s.emails();
    }, 180_000);
    afterAll(async () => {
      await s?.close();
    });

    it('sends its service kind to an address on the do-not-email list, and skips its marketing kind for it', async () => {
      postal = POSTAL;
      const mails = await order(1, 1);
      expect(mails.map((one) => `${one.templateKey} ${one.to}`)).toEqual(['shop-receipt stopped@harbour.dev']);
      expect(mails[0]).toMatchObject({ mailClass: 'service' });
      expect(await messages(1)).toEqual([
        { kind: 'offer', status: 'skipped', error: 'Not sent: on the do-not-email list (marketing mail)' },
        { kind: 'receipt', status: 'sent', error: null },
      ]);
    });

    it('skips its marketing kind for a person who has not agreed', async () => {
      const mails = await order(2, 3);
      expect(mails.map((one) => one.templateKey)).toEqual(['shop-receipt']);
      expect((await messages(2))[0]).toEqual({ kind: 'offer', status: 'skipped', error: 'Not sent: has not agreed to marketing mail' });
    });

    it('while the sender has no postal address: skipped with the reason, never tried again, and the owner told once', async () => {
      postal = null;
      await order(3, 2);
      await order(4, 2);
      for (const key of [3, 4]) expect((await messages(key))[0]).toEqual({ kind: 'offer', status: 'skipped', error: 'Marketing mail refused: add your postal address to the sender first' });
      // Never tried again: a later pass sends nothing more for them.
      await s.app.outboxSender.sendApp('shop', Date.now());
      expect(await s.emails()).toEqual([]);
      const told = await s.meta.db.selectFrom('adminium_notifications').select(['userId', 'title', 'body']).where('kind', '=', 'email.marketing-refused').execute();
      expect(told).toHaveLength(1);
      expect(told[0]).toMatchObject({ userId: s.ids['owner'], title: 'Marketing mail is being skipped' });
      expect(told[0]!.body).toContain('postal address');
    });

    it('with the sender ready, its marketing kind goes with both list headers and the locked footer; the service kind with neither', async () => {
      postal = POSTAL;
      const mails = await order(5, 2);
      const offer = mails.find((one) => one.templateKey === 'shop-offer')!;
      const receipt = mails.find((one) => one.templateKey === 'shop-receipt')!;
      expect(offer).toMatchObject({ to: 'agreed@harbour.dev', mailClass: 'marketing' });
      expect(offer.headers?.['List-Unsubscribe']).toMatch(/^<https:\/\/crm\.meridian\.example\/m\/u\/[^>]+>, <mailto:hello@meridian\.example\?subject=unsubscribe>$/);
      expect(offer.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
      expect(offer.text).toContain(POSTAL);
      expect(offer.text).toContain('Unsubscribe from Meridian’s newsletter');
      expect(offer.html).toContain(`href="${ORIGIN}/m/u/`);
      expect(receipt.headers).toBeUndefined();
      expect(receipt.text).not.toContain(POSTAL);
      const queued = await s.meta.db.selectFrom('adminium_jobs').select(['payload']).where('kind', '=', 'email.send').execute();
      const versions = queued.map((row) => (typeof row.payload === 'string' ? (JSON.parse(row.payload) as { v: number }) : (row.payload as { v: number })).v);
      expect(versions).toContain(4);
    });

    it('a rule’s mail to the people listed on a deal, and a summary, reach a staff member whose own address is on the list', async () => {
      const ivy = (await s.meta.db.selectFrom('adminium_users').select(['email']).where('id', '=', s.ids['ivy']!).executeTakeFirst())!.email;
      await consent().stop.add({ address: ivy, reason: 'link' });
      await s.rows(`INSERT INTO shop_deals (id, name, owner_id, state) VALUES (1, 'Harbour fit-out', '${s.ids['ivy']!}', 'open')`);
      await s.rows(`INSERT INTO shop_deal_members (id, deal_id, user_id) VALUES (1, 1, '${s.ids['ivy']!}')`);
      expect(said(await s.change('owner', 'deals', 1, { name: 'Harbour fit-out, phase 2' }))).toBe('ok');
      await s.jobs();
      expect(await s.tick()).toBeGreaterThanOrEqual(1);
      await s.jobs({ all: true });
      const mails = await s.emails();
      expect(mails.filter((one) => one.templateKey === 'shop-deal-people').map((one) => one.to)).toEqual([ivy]);
      expect(mails.filter((one) => one.templateKey === 'shop-week').map((one) => one.to)).toContain(ivy);
    });

    describe('a sequence of two marketing mails, three days apart', () => {
      let now: number;
      let sent: OutboundEmail[];
      const transport: EmailTransport = { send: async (msg) => void sent.push(msg) };

      async function start(customer: number): Promise<{ rule: Automation; runId: string; event: AutomationTriggerEvent; first: RunOutcome }> {
        const rule = (await automationsRepo(s.meta).listManagedBy('shop', s.connectionId)).find((one) => one.templateKey === 'welcome')!;
        const event: AutomationTriggerEvent = { event: 'record.created', origin: 'dashboard', ruleId: null, hops: 0, record: { connectionId: s.connectionId, table: s.t('customers'), pk: { id: customer }, label: String(customer) }, snapshot: { id: customer }, occurredAt: now };
        const run = (await automationRunsRepo(s.meta).begin({ automationId: rule.id, dedupeKey: null, origin: 'dashboard', triggerEvent: event }, now))!;
        const first = await walkRule(deps(), { rule, runId: run.id, event });
        return { rule, runId: run.id, event, first };
      }
      const deps = () => ({ meta: s.meta, manager: s.manager, app: s.app as never, secret: TEST_SECRET, now: () => now, createTransport: () => transport, marketing: kit });
      async function second(begun: Awaited<ReturnType<typeof start>>): Promise<RunOutcome> {
        expect(begun.first.kind).toBe('waiting');
        now += 3 * DAY + 60_000;
        if (begun.first.kind !== 'waiting') throw new Error('the first mail did not wait');
        return walkRule(deps(), { rule: begun.rule, runId: begun.runId, event: begun.event, resume: begun.first.trace.resume as number[], trace: begun.first.trace });
      }

      beforeAll(() => {
        postal = POSTAL;
      });

      it('unsubscribe between the first and the second, and the second is not sent', async () => {
        now = Date.now();
        sent = [];
        const begun = await start(4);
        expect(sent.map((one) => one.subject)).toEqual(['Welcome to our news']);
        await consent().stop.add({ address: 'seq-stop@harbour.dev', reason: 'link', at: now + DAY });
        const after = await second(begun);
        expect(after).toMatchObject({ kind: 'finished', status: 'succeeded' });
        expect(sent.map((one) => one.subject)).toEqual(['Welcome to our news']);
        expect(after.trace.steps.at(-1)?.log).toBe('Not sent: on the do-not-email list (marketing mail) · seq-stop@harbour.dev');
      });

      it('"Replied" between them stops the second as well', async () => {
        now = Date.now() + 10 * DAY;
        sent = [];
        const begun = await start(5);
        expect(sent).toHaveLength(1);
        await consent().markReplied({ person: { connectionId: s.connectionId, table: s.t('customers'), key: '5' }, staff: { id: s.ids['dana']!, label: 'Dana' }, at: now + DAY });
        const after = await second(begun);
        expect(sent).toHaveLength(1);
        expect(after.trace.steps.at(-1)?.log).toBe('Not sent: they replied, which stops their e-mail sequences · seq-replied@harbour.dev');
      });

      it('with neither, the second goes, signed and carrying its unsubscribe', async () => {
        now = Date.now() + 20 * DAY;
        sent = [];
        // The step names no reply address: replies go where the marketing mail settings say.
        await settingsRepo(s.meta).set('email.marketingReplyTo', 'hello@meridian.example', { updatedBy: null });
        const begun = await start(6);
        await second(begun);
        await settingsRepo(s.meta).set('email.marketingReplyTo', null, { updatedBy: null });
        expect(sent.map((one) => one.subject)).toEqual(['Welcome to our news', 'More of our news']);
        for (const one of sent) {
          expect(one.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
          expect(one.headers?.['List-Unsubscribe']).toMatch(/^<https:\/\/crm\.meridian\.example\/m\/u\//);
          expect(one.dkim?.domainName).toBe('meridian.example');
          expect(one.text).toContain(POSTAL);
          expect(one.replyTo).toBe('hello@meridian.example');
        }
      });

      it('a step written about surveys asks their answer for surveys, not the newsletter\'s', async () => {
        now = Date.now() + 25 * DAY;
        sent = [];
        const saved = (await automationsRepo(s.meta).listManagedBy('shop', s.connectionId)).find((one) => one.templateKey === 'welcome')!;
        // As the step editor saves it: "Why you're writing" is Surveys.
        const surveys = { ...saved, graph: { ...saved.graph, nodes: saved.graph.nodes.map((node) => (node.kind === 'action' && node.action.kind === 'email' ? { ...node, action: { ...node.action, purpose: 'surveys' as const } } : node)) } } as Automation;
        const event: AutomationTriggerEvent = { event: 'record.created', origin: 'dashboard', ruleId: null, hops: 0, record: { connectionId: s.connectionId, table: s.t('customers'), pk: { id: 6 }, label: '6' }, snapshot: { id: 6 }, occurredAt: now };
        const begin = async () => (await automationRunsRepo(s.meta).begin({ automationId: saved.id, dedupeKey: null, origin: 'dashboard', triggerEvent: event }, now))!;
        // Oli agreed to the newsletter only.
        const first = await walkRule(deps(), { rule: surveys, runId: (await begin()).id, event });
        expect(sent).toEqual([]);
        expect(first.trace.steps.find((step) => step.nodeId === 'first')?.log).toBe('Not sent: has not agreed to marketing mail · seq-ok@harbour.dev');
        await consent().record({ person: { connectionId: s.connectionId, table: s.t('customers'), key: '6' }, purpose: 'surveys', source: 'import', state: 'yes' });
        now += 60_000;
        await walkRule(deps(), { rule: surveys, runId: (await begin()).id, event: { ...event, occurredAt: now } });
        expect(sent.map((one) => one.subject)).toEqual(['Welcome to our news']);
      });

      it('a value that is not one plain address is skipped as such, never judged against the list by its own spelling', async () => {
        // Pat agreed, and her address is on the do-not-email list; a mail server would deliver each of these to it.
        const rows = [
          [7, 'pat@harbour.dev;'],
          [8, '"pat@harbour.dev"'],
          [9, 'x,pat@harbour.dev'],
        ] as const;
        for (const [key, email] of rows) {
          await s.rows(`INSERT INTO shop_customers (id, email, name) VALUES (${String(key)}, '${email}', 'Pat Punct')`);
          await consent().record({ person: { connectionId: s.connectionId, table: s.t('customers'), key: String(key) }, purpose: 'newsletter', source: 'import', state: 'yes' });
        }
        await consent().stop.add({ address: 'pat@harbour.dev', reason: 'link' });
        for (const [key, email] of rows) {
          now = Date.now() + (40 + key) * DAY;
          sent = [];
          const begun = await start(key);
          expect(sent, email).toEqual([]);
          expect(begun.first.trace.steps.find((step) => step.nodeId === 'first')?.log, email).toBe(`Not sent: the recipient is not one plain e-mail address · ${email}`);
        }
      });

      it('a sender that is not ready fails the step by its reason, and nothing goes', async () => {
        postal = null;
        now = Date.now() + 30 * DAY;
        sent = [];
        const begun = await start(6);
        expect(begun.first).toMatchObject({ kind: 'finished', status: 'failed' });
        expect(sent).toEqual([]);
        if (begun.first.kind === 'finished') expect(begun.first.error).toContain('add your postal address');
        postal = POSTAL;
      });
    });
  });
}
