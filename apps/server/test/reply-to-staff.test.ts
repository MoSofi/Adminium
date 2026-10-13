// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A REPLY THAT GOES TO THE REP, against the whole server on SQLite, Postgres
 * and MySQL, through an app installed by the real installer:
 *
 *  - a message of the outbox about a quote (`replyTo: {staff}` on its
 *    producer) carries the sign-in address of the quote's owner, as it is
 *    when the message goes;
 *  - a rule's email does the same, sent at once (to an address of the
 *    record) and through the queue (to a person), by a column of the record
 *    or of the row a link of it names;
 *  - nobody on the row, somebody removed, suspended, only invited or a
 *    sample person, an address that is no plain address, a value that is
 *    not a person at all: the house's Reply-To when the outbox has one, else
 *    none — and the message goes all the same;
 *  - nothing but a staff column names where a reply goes: not a text column
 *    that holds an address, not a typed address, for an app and for a rule
 *    saved in the dashboard alike.
 */
import { automationsRepo, usersRepo, type Automation, type AutomationTriggerEvent } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { staffReplyTo as ruleReplyTo } from '../src/automations/staff-recipient.js';
import { walkRule } from '../src/automations/runner.js';
import { loadSnapshotView } from '../src/data-io/snapshot-view.js';
import type { EmailTransport, OutboundEmail } from '../src/email/types.js';
import { staffReplyTo } from '../src/outbox/staff-reply-to.js';
import { TEST_SECRET } from './helpers.js';
import { LEGS, said, wholeServer, type QueuedEmail, type WholeServer } from './whole-server.helpers.js';

// The server says the version it was built at; the words tried here are read from the release to come.
vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.28' }));

const en = (text: string) => ({ 'en-US': text });
const id = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength = 120, more: Record<string, unknown> = {}) => ({ ref, type: 'text', maxLength, nullable: true, ...more });
const staff = (ref: string) => text(ref, 36, { rules: { staff: true } });
const node = (key: string, action: Record<string, unknown>) => ({ id: key, kind: 'action', title: key, action });
const flow = (...nodes: Record<string, unknown>[]) => ({ version: 1, nodes: [{ id: 't', kind: 'trigger', title: 'When' }, ...nodes] });
const template = (key: string, subject: string) => ({ key, name: key, locales: { 'en-US': { subject, blocks: [{ block: 'email.text', data: { text: 'About your quote.' } }] } } });

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
        { ref: 'settings', columns: [id, text('name', 80), text('house_email', 254)] },
        { ref: 'contacts', columns: [id, text('email', 254), text('name', 80)] },
        { ref: 'deals', columns: [id, text('name', 80), staff('owner_id')] },
        {
          ref: 'quotes',
          columns: [
            id,
            { ref: 'contact_id', type: 'fk', references: 'contacts', nullable: true },
            { ref: 'deal_id', type: 'fk', references: 'deals', nullable: true },
            staff('owner_id'),
            staff('approver_id'),
            { ref: 'stage', type: 'enum', enum: ['draft', 'asked', 'sent'], default: 'draft' },
            text('sent_to_email', 254),
            text('note', 200),
          ],
        },
        {
          ref: 'messages',
          columns: [
            id,
            { ref: 'kind', type: 'enum', enum: ['quote-sent', 'quote-asked'] },
            { ref: 'status', type: 'enum', enum: ['queued', 'sent', 'failed', 'skipped'], default: 'queued' },
            text('to_address', 254),
            { ref: 'contact_id', type: 'fk', references: 'contacts', nullable: true },
            { ref: 'quote_id', type: 'fk', references: 'quotes', nullable: true },
            text('error', 200),
            { ref: 'sent_at', type: 'timestamptz', nullable: true },
          ],
        },
      ],
    },
    roles: [{ key: 'rep', name: 'Rep', permissions: ['table:@quotes:read', 'table:@quotes:update', 'page:@crm-quotes:view'] }],
    pages: [{ ref: 'crm-quotes', template: 'page-crud', title: { key: 't.quotes', fallback: 'Quotes' }, nav: { group: 'sales', icon: 'list', order: 1 }, bindings: { rows: 'quotes' } }],
    outbox: {
      table: 'messages',
      columns: { kind: 'kind', status: 'status', to: 'to_address', error: 'error', sentAt: 'sent_at' },
      links: { quote: 'quote_id' },
      recipient: { via: 'contact_id', table: 'contacts', email: 'email', name: 'name' },
      settings: { table: 'settings', name: 'name', replyTo: 'house_email' },
      kinds: { 'quote-sent': 'crm-quote-sent', 'quote-asked': 'crm-quote-asked' },
      producers: [
        { kind: 'quote-sent', link: 'quote_id', recipient: { column: 'sent_to_email' }, replyTo: { staff: 'owner_id' }, onChange: { table: 'quotes', column: 'stage', to: 'sent' } },
        // One link further: a reply to the owner of the quote's deal.
        { kind: 'quote-asked', link: 'quote_id', recipient: { column: 'sent_to_email' }, replyTo: { staff: 'deal_id.owner_id' }, onChange: { table: 'quotes', column: 'stage', to: 'asked' } },
      ],
    },
    emailTemplates: [template('crm-quote-sent', 'Your quote'), template('crm-quote-asked', 'Your quote is with us'), template('crm-approve', 'A quote to approve'), template('crm-note', 'A note on your quote')],
    automations: [
      {
        // Through the queue: to the approver, a reply to the rep.
        key: 'ask-approval',
        name: en('A quote is asked for: write to its approver'),
        enabled: true,
        trigger: { kind: 'record', event: 'updated', table: 'quotes', changedColumn: 'stage', when: [{ left: { field: 'stage' }, op: 'is', right: 'asked' }] },
        graph: flow(node('mail', { kind: 'email', templateKey: 'crm-approve', to: { kind: 'staff', column: 'approver_id' }, replyTo: { staff: 'owner_id' } })),
      },
      {
        // At once: to the address on the quote, a reply to the owner of the quote's deal.
        key: 'note-mail',
        name: en('A note on a quote: write to the customer'),
        enabled: false,
        trigger: { kind: 'record', event: 'updated', table: 'quotes', changedColumn: 'note' },
        graph: flow(node('mail', { kind: 'email', templateKey: 'crm-note', to: { kind: 'field', column: 'sent_to_email' }, replyTo: { staff: 'deal_id.owner_id' } })),
      },
    ],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } }],
  };
}

type Mail = QueuedEmail & { replyTo?: string };

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`a reply that goes to the rep, on ${dialect}`, () => {
    let s: WholeServer;
    let quotes = 0;
    const address = (who: string, email: string) => s.meta.db.updateTable('adminium_users').set({ email }).where('id', '=', s.ids[who]!).execute();
    const status = (who: string, to: string) => s.meta.db.updateTable('adminium_users').set({ status: to } as never).where('id', '=', s.ids[who]!).execute();
    const house = (value: string | null) => s.rows(`UPDATE crm_settings SET house_email = ${value === null ? 'NULL' : `'${value}'`}`);
    /** A quote as SQL writes it: whatever its staff column is made to hold. */
    const quote = async (owner: string | null, more: { deal?: number; approver?: string } = {}): Promise<number> => {
      quotes += 1;
      const q = (value: string | null | undefined) => (value === null || value === undefined ? 'NULL' : `'${value}'`);
      await s.rows(`INSERT INTO crm_quotes (id, contact_id, deal_id, owner_id, approver_id, stage, sent_to_email) VALUES (${String(quotes)}, 1, ${more.deal === undefined ? 'NULL' : String(more.deal)}, ${q(owner)}, ${q(more.approver)}, 'draft', 'buyer${String(quotes)}@harbour.dev')`);
      return quotes;
    };
    /** Mark a quote sent, send what the outbox holds, and hand back the one message it made. */
    const sentFor = async (key: number): Promise<Mail> => {
      await s.emails();
      expect(said(await s.change('owner', 'quotes', key, { stage: 'sent' }))).toBe('ok');
      await s.app.outboxSender.sendApp('crm', Date.now());
      const mail = (await s.emails()).filter((one) => one.templateKey === 'crm-quote-sent') as Mail[];
      expect(mail, `quote ${String(key)}`).toHaveLength(1);
      expect(mail[0]!.to).toBe(`buyer${String(key)}@harbour.dev`);
      const [row] = await s.rows(`SELECT status, error FROM crm_messages WHERE quote_id = ${String(key)}`);
      expect(row, JSON.stringify(row)).toMatchObject({ status: 'sent' });
      return mail[0]!;
    };

    beforeAll(async () => {
      s = await wholeServer(dialect, crm(), { people: { dana: ['rep'], omar: ['rep'], ivy: ['rep'] }, smtp: true });
      await s.rows(`INSERT INTO crm_settings (id, name, house_email) VALUES (1, 'Harbour Sales', 'sales@harbour.dev')`);
      await s.rows(`INSERT INTO crm_contacts (id, email, name) VALUES (1, 'buyer@harbour.dev', 'Bo Buyer')`);
      await s.rows(`INSERT INTO crm_deals (id, name, owner_id) VALUES (1, 'Atrium', '${s.ids['omar']!}'), (2, 'Nobody’s', NULL)`);
    }, 180_000);
    afterAll(async () => {
      await s?.close();
    });

    describe('a message of the outbox', () => {
      it('carries the sign-in address of the quote’s owner, as it is when the message goes', async () => {
        expect((await sentFor(await quote(s.ids['dana']!))).replyTo).toBe('dana@crm.test');
        // The address is not kept on the quote or the message: changed since, the new one is the one a reply reaches.
        const key = await quote(s.ids['dana']!);
        await address('dana', 'dana.reyes@crm.test');
        expect((await sentFor(key)).replyTo).toBe('dana.reyes@crm.test');
        await address('dana', 'dana@crm.test');
      });

      it('carries the address of the owner of the quote’s deal, one link further', async () => {
        const asked = async (key: number): Promise<Mail> => {
          await s.emails();
          expect(said(await s.change('owner', 'quotes', key, { stage: 'asked' }))).toBe('ok');
          await s.app.outboxSender.sendApp('crm', Date.now());
          await s.jobs();
          const mail = (await s.emails()).filter((one) => one.templateKey === 'crm-quote-asked') as Mail[];
          expect(mail, `quote ${String(key)}`).toHaveLength(1);
          return mail[0]!;
        };
        expect((await asked(await quote(null, { deal: 1 }))).replyTo).toBe('omar@crm.test');
        // A deal nobody owns, and a quote with no deal: the house.
        expect((await asked(await quote(s.ids['dana']!, { deal: 2 }))).replyTo).toBe('sales@harbour.dev');
        expect((await asked(await quote(s.ids['dana']!))).replyTo).toBe('sales@harbour.dev');
      });

      it('falls back to the house’s address for a quote nobody owns, and for an owner who cannot sign in', async () => {
        expect((await sentFor(await quote(null))).replyTo).toBe('sales@harbour.dev');
        for (const away of ['suspended', 'invited', 'sample']) {
          await status('omar', away);
          expect((await sentFor(await quote(s.ids['omar']!))).replyTo, away).toBe('sales@harbour.dev');
        }
        await status('omar', 'active');
        expect((await sentFor(await quote(s.ids['omar']!))).replyTo).toBe('omar@crm.test');
        // Somebody removed since: their id names nobody.
        expect((await sentFor(await quote('00000000-0000-4000-8000-000000000000'))).replyTo).toBe('sales@harbour.dev');
      });

      it('sends with no Reply-To when there is nobody and the house keeps no address', async () => {
        await house(null);
        expect((await sentFor(await quote(null))).replyTo).toBeUndefined();
        await status('omar', 'suspended');
        expect((await sentFor(await quote(s.ids['omar']!))).replyTo).toBeUndefined();
        await status('omar', 'active');
        await house('sales@harbour.dev');
      });

      it('takes no address the staff column was made to hold, and no second header from a person’s own', async () => {
        // An address written where a person's id belongs (in SQL: no door of Adminium's writes one) names nobody.
        for (const planted of ['mallory@evil.dev', 'dana@crm.test', "x@y.dev' OR '1'='1".replace(/'/g, "''")]) {
          expect((await sentFor(await quote(planted))).replyTo, planted).toBe('sales@harbour.dev');
        }
        // A sign-in address that is more than one plain address is left out, never cut into shape.
        for (const odd of ['ivy@crm.test\r\nBcc: mallory@evil.dev', 'ivy@crm.test, mallory@evil.dev', 'Ivy <ivy@crm.test>', 'not an address']) {
          await address('ivy', odd);
          const mail = await sentFor(await quote(s.ids['ivy']!));
          expect(mail.replyTo, odd).toBe('sales@harbour.dev');
          expect(JSON.stringify(mail)).not.toContain('mallory');
        }
        await address('ivy', 'ivy@crm.test');
      });

      it('reads a staff column and no other, whatever a stored producer names', async () => {
        const view = await loadSnapshotView(s.meta, s.connectionId);
        const { db } = await s.manager.data(s.connectionId);
        const ctx = { meta: s.meta, db, view, outboxId: s.t('messages') };
        const key = await quote(s.ids['dana']!);
        // A text column of the quote that holds a person's id: it is not a staff column, so it names nobody.
        await s.rows(`UPDATE crm_quotes SET note = '${s.ids['dana']!}' WHERE id = ${String(key)}`);
        const producer = (column: string) => ({ kind: 'quote-sent', link: 'quote_id', replyTo: { staff: column }, onChange: { table: 'quotes', column: 'stage', to: 'sent' } }) as never;
        expect(await staffReplyTo(ctx, producer('owner_id'), { quote_id: key })).toBe('dana@crm.test');
        for (const column of ['note', 'sent_to_email', 'no_such_column', 'id']) expect(await staffReplyTo(ctx, producer(column), { quote_id: key }), column).toBeNull();
        // A message that links no quote, or one that is gone.
        expect(await staffReplyTo(ctx, producer('owner_id'), { quote_id: null })).toBeNull();
        expect(await staffReplyTo(ctx, producer('owner_id'), { quote_id: 999_999 })).toBeNull();
        // One link further: the owner of the quote's deal; a deal nobody owns, a quote with no deal, a link that is none.
        const ofDeal = await quote(null, { deal: 1 });
        expect(await staffReplyTo(ctx, producer('deal_id.owner_id'), { quote_id: ofDeal })).toBe('omar@crm.test');
        expect(await staffReplyTo(ctx, producer('deal_id.owner_id'), { quote_id: await quote(null, { deal: 2 }) })).toBeNull();
        expect(await staffReplyTo(ctx, producer('deal_id.owner_id'), { quote_id: key })).toBeNull();
        for (const column of ['deal_id.name', 'contact_id.email', 'note.owner_id', 'deal_id.no_such_column']) expect(await staffReplyTo(ctx, producer(column), { quote_id: ofDeal }), column).toBeNull();
        // A producer that asks for none.
        expect(await staffReplyTo(ctx, { kind: 'quote-sent', link: 'quote_id', onChange: { table: 'quotes', column: 'stage', to: 'sent' } } as never, { quote_id: key })).toBeNull();
      });
    });

    describe('a rule’s email', () => {
      const sent: OutboundEmail[] = [];
      const transport: EmailTransport = {
        async send(message) {
          sent.push(message);
          return { response: '250 2.0.0 Ok' };
        },
      };
      const ruleOf = async (key: string): Promise<Automation> => (await automationsRepo(s.meta).listManagedBy('crm', s.connectionId)).find((one) => one.templateKey === key)!;
      const walk = async (rule: Automation, key: number) => {
        const event: AutomationTriggerEvent = { event: 'record.updated', origin: 'dashboard', ruleId: null, hops: 0, record: { connectionId: s.connectionId, table: s.t('quotes'), pk: { id: key }, label: String(key) }, snapshot: { id: key }, occurredAt: Date.now() };
        const outcome = await walkRule({ meta: s.meta, manager: s.manager, app: s.app as never, secret: TEST_SECRET, now: () => Date.now(), createTransport: () => transport }, { rule, runId: `arun_${String(key)}_${String(sent.length)}`, event });
        return outcome.kind === 'finished' ? outcome.status : `${outcome.kind} ${JSON.stringify(outcome.trace.steps.at(-1))}`;
      };

      it('sent at once, replies to the owner of the quote’s deal, and goes with no Reply-To when nobody is there', async () => {
        const rule = await ruleOf('note-mail');
        sent.length = 0;
        expect(await walk(rule, await quote(null, { deal: 1 }))).toBe('succeeded');
        expect(sent).toHaveLength(1);
        expect(sent[0]).toMatchObject({ to: `buyer${String(quotes)}@harbour.dev`, replyTo: 'omar@crm.test' });
        // A deal nobody owns, a quote with no deal, an owner who is suspended: the mail goes, and has no Reply-To (a rule has no house).
        await status('omar', 'suspended');
        for (const deal of [1, 2, undefined]) {
          sent.length = 0;
          expect(await walk(rule, await quote(null, deal === undefined ? {} : { deal }))).toBe('succeeded');
          expect(sent).toHaveLength(1);
          expect(Object.hasOwn(sent[0]!, 'replyTo'), String(deal)).toBe(false);
        }
        await status('omar', 'active');
      });

      it('sent through the queue to a person, replies to the quote’s owner', async () => {
        await s.emails();
        const key = await quote(s.ids['dana']!, { approver: s.ids['ivy']! });
        expect(said(await s.change('owner', 'quotes', key, { stage: 'asked' }))).toBe('ok');
        await s.jobs();
        const mail = (await s.emails()).filter((one) => one.templateKey === 'crm-approve') as Mail[];
        expect(mail).toHaveLength(1);
        expect(mail[0]).toMatchObject({ to: 'ivy@crm.test', replyTo: 'dana@crm.test' });
        // Nobody owns the quote: the approver is written to all the same.
        const orphan = await quote(null, { approver: s.ids['ivy']! });
        expect(said(await s.change('owner', 'quotes', orphan, { stage: 'asked' }))).toBe('ok');
        await s.jobs();
        const plain = (await s.emails()).filter((one) => one.templateKey === 'crm-approve') as Mail[];
        expect(plain).toHaveLength(1);
        expect(plain[0]!.to).toBe('ivy@crm.test');
        expect(plain[0]!.replyTo).toBeUndefined();
      });

      it('never fails for want of a person: a column that is no staff column, or a link that is gone, is no Reply-To', async () => {
        const view = await loadSnapshotView(s.meta, s.connectionId);
        const table = view.table(s.t('quotes'));
        const key = await quote(s.ids['dana']!);
        const source = { table, row: { id: key, owner_id: s.ids['dana']!, note: s.ids['dana']!, sent_to_email: 'dana@crm.test' }, related: new Map() } as never;
        expect(await ruleReplyTo(s.meta, { source }, 'owner_id')).toBe('dana@crm.test');
        for (const path of ['note', 'sent_to_email', 'no_such_column', 'deal_id.owner_id', 'contact_id.email']) expect(await ruleReplyTo(s.meta, { source }, path), path).toBeNull();
        expect(await ruleReplyTo(s.meta, { source }, undefined)).toBeNull();
        expect(await ruleReplyTo(s.meta, { source: null }, 'owner_id')).toBeNull();
      });

      it('is refused at the save in the dashboard when it names anything but a staff column', async () => {
        const save = (replyTo: unknown) =>
          s.send('owner', 'POST', '/api/v1/automations', {
            name: 'Write to the customer',
            connectionId: s.connectionId,
            enabled: false,
            trigger: { kind: 'record', connectionId: s.connectionId, table: s.t('quotes'), event: 'updated', watch: false, when: [] },
            graph: { version: 1, nodes: [{ id: 'n1', kind: 'trigger', title: 'Trigger' }, { id: 'n2', kind: 'action', title: 'Mail', onError: false, action: { kind: 'email', templateKey: 'crm-note', to: { kind: 'field', column: 'sent_to_email' }, vars: {}, ...(replyTo === undefined ? {} : { replyTo }) } }] },
          });
        // A column that holds an address, a column that is not there, a typed address, an address beside the column.
        for (const wrong of [{ staff: 'sent_to_email' }, { staff: 'no_such_column' }, { staff: 'contact_id.email' }, 'mallory@evil.dev', { address: 'mallory@evil.dev' }, { staff: 'owner_id', address: 'mallory@evil.dev' }]) {
          const res = await save(wrong);
          expect(res.statusCode, `${JSON.stringify(wrong)} ${res.body}`).toBeGreaterThanOrEqual(400);
          expect(res.statusCode).toBeLessThan(500);
        }
        for (const right of [{ staff: 'owner_id' }, { staff: 'deal_id.owner_id' }, undefined]) {
          const res = await save(right);
          expect(res.statusCode, `${JSON.stringify(right)} ${res.body}`).toBeLessThan(300);
          const stored = (res.json() as { graph: { nodes: { action?: { replyTo?: unknown } }[] } }).graph.nodes[1]!.action!;
          // Kept as written, and absent on a step that says none.
          expect(stored.replyTo).toEqual(right);
        }
      });
    });
  });
}
