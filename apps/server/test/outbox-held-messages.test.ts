// SPDX-License-Identifier: AGPL-3.0-only
/**
 * MESSAGES HELD FOR APPROVAL — an invoice's reminders, a studio's notices,
 * a batch of new work, on every engine.
 *
 * A studio app installed through the real installer (prefixed tables), with
 * an outbox that holds three reminders per sent invoice, each due some days
 * after the invoice's due date at 09:00 in London; paid or void drops them,
 * a later one overtakes an earlier one, the third pauses the project once
 * sent. The producers, the minute scan, the sender and the moves a person may
 * make run as the server runs them; only the clock is the test's.
 *
 * The project's refusal to pause a finished project stands in for the states
 * the write path will enforce: a before hook that refuses, as those will.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OutboxProducer } from '@adminium/manifest';
import { addOnSettingsRepo, appTablesRepo, documentSequencesRepo, emailTemplatesRepo, manifestsRepo, rolesRepo, settingsRepo, usersRepo, type MetaDb } from '@adminium/meta';

import { encryptSecret, decryptSecret } from '../src/config/secrets.js';
import type { RecordWriteEvent } from '../src/crud/after-record-write.js';
import { slotInstant } from '../src/crud/capacity-guard.js';
import type { ResolvedTable, SnapshotView } from '../src/crud/identifiers.js';
import type { Row } from '../src/crud/mask.js';
import { HookRejectedError, createWriteService, type BeforeWriteEvent, type RecordHooks, type WriteContext } from '../src/crud/write-service.js';
import { emailSecretKey } from '../src/email/config.js';
import { emailEnvelopeKey } from '../src/email/send.js';
import { AppError } from '../src/errors.js';
import { withOutboxMoves } from '../src/outbox/moves.js';
import { createOutboxProducers, type LiveOutbox, type OutboxProducers } from '../src/outbox/producers.js';
import { createOutboxSender, routeFor, type OutboxSender } from '../src/outbox/sender.js';
import type { SignInLinkMinter } from '../src/outbox/sign-in-link.js';
import { createPublicViews } from '../src/public-api/runtime.js';
import { TEST_SECRET } from './helpers.js';
import { LEGS, installInvoicing, invoicingManifest, type InvoicingHarness } from './invoicing-install.helpers.js';
import { addOnManifest } from './app-add-ons.helpers.js';

const id = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength = 120) => ({ ref, type: 'text', maxLength, nullable: true });
const fk = (ref: string, references: string, nullable = true) => ({ ref, type: 'fk', references, nullable });
const money = (ref: string, rules?: Record<string, unknown>) => ({ ref, type: 'decimal', scale: 2, nullable: true, ...(rules === undefined ? {} : { rules }) });
const instant = (ref: string) => ({ ref, type: 'timestamptz', nullable: true });

const KINDS = ['invoice-sent', 'invoice-rung-1', 'invoice-rung-2', 'invoice-rung-3', 'client-says-paid', 'new-work', 'payment-receipt', 'transfer-note', 'late-note'];

function studioTables(): Record<string, unknown>[] {
  return [
    {
      ref: 'settings',
      columns: [id, text('name'), text('reply_to', 254), { ref: 'ladders', type: 'json', nullable: true }, { ref: 'notify_paid', type: 'bool', default: true }],
    },
    { ref: 'clients', columns: [id, { ref: 'email', type: 'text', maxLength: 254, unique: true }, text('name')] },
    { ref: 'projects', columns: [id, text('name'), { ref: 'status', type: 'enum', enum: ['active', 'paused', 'done'], default: 'active' }] },
    {
      ref: 'invoices',
      columns: [
        id,
        fk('client_id', 'clients', false),
        fk('project_id', 'projects'),
        { ref: 'status', type: 'enum', enum: ['draft', 'sent', 'void'], default: 'draft' },
        { ref: 'due_on', type: 'date', nullable: true },
        { ref: 'ladder', type: 'enum', enum: ['gentle', 'standard', 'firm'], default: 'standard' },
        money('total'),
        money('paid', { rollup: { from: 'payments', via: 'invoice_id', sum: 'amount', balance: { column: 'balance', of: 'total' } } }),
        money('balance'),
        { ref: 'client_paid', type: 'bool', default: false },
        { ref: 'nudge', type: 'bool', default: false },
        text('currency', 3),
      ],
    },
    { ref: 'payments', columns: [id, fk('invoice_id', 'invoices', false), { ref: 'amount', type: 'decimal', scale: 2 }] },
    { ref: 'deliverables', columns: [id, fk('project_id', 'projects'), fk('client_id', 'clients'), text('title')] },
    { ref: 'deliverable_versions', columns: [id, fk('deliverable_id', 'deliverables', false), { ref: 'v', type: 'int', nullable: true }] },
    // Built the way an add-on's shape names its keys: a payment's invoice is its `document_id`.
    { ref: 'settlements', columns: [id, fk('document_id', 'invoices', false), { ref: 'amount', type: 'decimal', scale: 2 }] },
    // Two keys to invoices: which one a message is about is not for the outbox to guess.
    { ref: 'transfers', columns: [id, fk('from_invoice_id', 'invoices', false), fk('to_invoice_id', 'invoices', false)] },
    {
      ref: 'messages',
      columns: [
        id,
        { ref: 'kind', type: 'enum', enum: KINDS },
        { ref: 'status', type: 'enum', enum: ['held', 'queued', 'sent', 'failed', 'skipped'], default: 'queued' },
        text('to_address', 254),
        text('language', 35),
        fk('client_id', 'clients'),
        fk('invoice_id', 'invoices'),
        fk('project_id', 'projects'),
        fk('deliverable_id', 'deliverables'),
        fk('settlement_id', 'settlements'),
        fk('transfer_id', 'transfers'),
        text('skip_reason', 24),
        text('subject_override', 200),
        { ref: 'body_override', type: 'text', nullable: true },
        text('approved_by'),
        instant('due'),
        instant('sent_at'),
        text('error', 200),
        instant('effect_at'),
        text('effect_error', 200),
      ],
    },
  ];
}

const rung = (n: number, days: unknown) => ({
  kind: `invoice-rung-${String(n)}`,
  link: 'invoice_id',
  hold: true,
  onChange: { table: 'invoices', column: 'status', to: 'sent' },
  due: { date: 'due_on', days, at: '09:00' },
  supersede: 'chase',
  dropWhen: [
    { column: 'balance', lte: 0, reason: 'paid' },
    { column: 'status', eq: 'void', reason: 'void' },
  ],
});
const LADDERS = { table: 'settings', column: 'ladders' };

const template = (key: string, subject: string, ...paras: (string | Record<string, unknown>)[]) => ({
  key: `studio-${key}`,
  name: key,
  locales: { 'en-US': { subject, blocks: paras.map((p) => (typeof p === 'string' ? { block: 'email.text', data: { text: p } } : p)) } },
});

export function studioManifest(): Record<string, unknown> {
  return {
    ...invoicingManifest(studioTables()),
    // The client side's routes: where a sign-in link opens.
    frontends: [
      { side: 'staff', kind: 'spa', entry: 'index.html' },
      { side: 'customer', kind: 'none', routes: { invoice: '/invoices/:id', deliverable: '//evil.example/:id' } },
    ],
    addOns: { requires: [{ key: 'invoices', range: '>=1.0.0', reason: { 'en-US': 'Invoices.' } }] },
    outbox: {
      table: 'messages',
      columns: {
        kind: 'kind',
        status: 'status',
        to: 'to_address',
        language: 'language',
        due: 'due',
        sentAt: 'sent_at',
        error: 'error',
        skipReason: 'skip_reason',
        subjectOverride: 'subject_override',
        bodyOverride: 'body_override',
        approvedBy: 'approved_by',
        effectAt: 'effect_at',
        effectError: 'effect_error',
      },
      links: { client: 'client_id', invoice: 'invoice_id', project: 'project_id', deliverable: 'deliverable_id', settlement: 'settlement_id', transfer: 'transfer_id' },
      recipient: { via: 'client_id', table: 'clients', email: 'email', name: 'name' },
      settings: { table: 'settings', name: 'name' },
      pages: { manage: '/h' },
      kinds: Object.fromEntries(KINDS.map((kind) => [kind, `studio-${kind}`])),
      producers: [
        { kind: 'invoice-sent', link: 'invoice_id', onChange: { table: 'invoices', column: 'status', to: 'sent' } },
        rung(1, { byColumn: 'ladder', values: { gentle: 7, standard: 3, firm: 1 } }),
        rung(2, { setting: LADDERS, byColumn: 'ladder', index: 1 }),
        { ...rung(3, { setting: LADDERS, byColumn: 'ladder', index: 2 }), onSent: { table: 'projects', via: 'project_id', set: { status: 'paused' } } },
        {
          kind: 'client-says-paid',
          link: 'invoice_id',
          gate: { setting: { table: 'settings', column: 'notify_paid' } },
          onChange: { table: 'invoices', column: 'client_paid', to: true },
          recipient: { setting: { table: 'settings', column: 'reply_to' } },
        },
        { kind: 'new-work', link: 'deliverable_id', onCreate: { table: 'deliverable_versions', via: 'deliverable_id' }, batchMinutes: 10 },
        { kind: 'payment-receipt', link: 'settlement_id', onCreate: { table: 'settlements' } },
        { kind: 'transfer-note', link: 'transfer_id', onCreate: { table: 'transfers' } },
        // Due some days after the due date, the days read from the ladder — the sixth, which it may not have.
        {
          kind: 'late-note',
          link: 'invoice_id',
          onChange: { table: 'invoices', column: 'nudge', to: true },
          due: { date: 'due_on', days: { setting: LADDERS, byColumn: 'ladder', index: 5 } },
        },
      ],
    },
    emailTemplates: [
      template(
        'invoice-sent',
        'Invoice {{invoice.id}}',
        'Hi {{recipient.first_name}}, invoice {{invoice.id}} for {{invoice.total}} is attached.',
        'Open it: {{signInLink}}',
        'How to pay: {{addOn.invoices.payment_instructions}}',
        { block: 'email.button', data: { label: 'See the work', url: '{{manage_url}}#{{invoice.id}}' } },
      ),
      template('invoice-rung-1', 'A gentle nudge', 'Hi {{recipient.first_name}}, invoice {{invoice.id}} is waiting.', 'Open it: {{signInLink}}'),
      template('invoice-rung-2', 'Plainer', 'Invoice {{invoice.id}} is {{invoice.due_on.days_since}} days late.'),
      template('invoice-rung-3', 'Pause the work', 'Invoice {{invoice.id}} is very late; the work pauses.'),
      template('client-says-paid', 'Paid, they say', '{{client.name}} says invoice {{invoice.id}} is paid.', 'Open it: {{signInLink}}', 'At the desk: {{staff_url}}invoices/{{invoice.id}}'),
      template('new-work', 'New work to review', 'New work on {{deliverable.title}}.'),
      template('payment-receipt', 'Payment received', 'We received {{settlement.amount}} for invoice {{invoice.id}}.'),
      template('transfer-note', 'A transfer', 'A transfer between invoices.'),
      template('late-note', 'Your invoice is late', 'Invoice {{invoice.id}} is late.'),
    ],
  };
}

/** A moment, from its UTC spelling. */
const at = (utc: string) => Date.parse(utc);
/** The rungs of an invoice due 1 October on the standard ladder (3, 14, 30 days): 09:00 in London, BST then GMT. */
const STANDARD = ['2026-10-04T08:00:00.000Z', '2026-10-15T08:00:00.000Z', '2026-10-31T09:00:00.000Z'];

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`messages held for approval on ${dialect}`, () => {
    let h: InvoicingHarness;
    let meta: MetaDb;
    let producers: OutboxProducers;
    let sender: OutboxSender;
    let view: SnapshotView;
    let clock = at('2026-10-02T12:00:00Z');
    const minted: { pk: Record<string, unknown>; email: string; to?: string }[] = [];
    let staffHost: string | undefined;
    const emitted: RecordWriteEvent[] = [];
    /** Runs inside a person's write to the messages, before it is judged: another writer landing meanwhile. */
    let probeHook: ((e: BeforeWriteEvent) => Promise<void>) | null = null;
    /** Runs while a sign-in link is made: something happening while an email is being made. */
    let onMint: (() => Promise<void>) | null = null;
    const desk: WriteContext = { origin: 'dashboard', hops: 0, actor: { kind: 'user', id: 'usr_ivy', label: 'Ivy Ferreira' }, request: null };

    const table = (ref: string): ResolvedTable => view.table(view.model.tables.find((t) => t.name === h.real(ref))!.id);
    const rows = (statement: string) => h.rows(statement.replaceAll(/\bstudio\.(settings|clients|projects|invoices|payments|deliverables|deliverable_versions|messages)\b/g, (_, ref: string) => h.real(ref)));

    /** A write as the dashboard makes it: the write service, then the record event. */
    let writes: ReturnType<typeof createWriteService>;
    const target = async (ref: string) => {
      const { db, dialect: d } = await h.manager.data(h.connectionId);
      return { connectionId: h.connectionId, view, table: table(ref), db, dialect: d, timezone: 'Europe/London' };
    };
    const event = (ref: string, action: 'create' | 'update', before: Row | null, after: Row): RecordWriteEvent => ({
      connectionId: h.connectionId,
      table: table(ref),
      action,
      entity: { connectionId: h.connectionId, table: table(ref).id, pk: { id: after['id'] }, label: String(after['id']) },
      before,
      after,
      origin: 'dashboard',
      hops: 0,
    });
    const create = async (ref: string, values: Row, context: WriteContext = desk): Promise<Row> => {
      const row = await writes.create({ target: await target(ref), values, context, announce: async () => {} });
      await producers.onRecordEvent(event(ref, 'create', null, row));
      return row;
    };
    const update = async (ref: string, rowId: unknown, values: Row, context: WriteContext = desk): Promise<Row> => {
      const outcome = await writes.update({ target: await target(ref), pk: { id: rowId }, values, context, announce: async () => {} });
      await producers.onRecordEvent(event(ref, 'update', outcome.before, outcome.after!));
      return outcome.after!;
    };
    const refused = async (write: Promise<unknown>): Promise<AppError> => {
      const error = await write.then(
        () => null,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(AppError);
      return error as AppError;
    };

    const messages = async (invoice: unknown) =>
      (await rows(`SELECT id, kind, status, to_address, skip_reason, approved_by, due, sent_at, error, effect_at, effect_error FROM studio.messages WHERE invoice_id = ${String(invoice)} ORDER BY id`)).map(
        (row) => ({
          id: Number(row['id']),
          kind: String(row['kind']),
          status: String(row['status']),
          to: (row['to_address'] as string | null) ?? null,
          skip: (row['skip_reason'] as string | null) ?? null,
          approvedBy: (row['approved_by'] as string | null) ?? null,
          due: slotInstant(row['due'])?.toISOString() ?? null,
          sent: row['sent_at'] !== null,
          error: (row['error'] as string | null) ?? null,
          effectAt: row['effect_at'] !== null,
          effectError: (row['effect_error'] as string | null) ?? null,
        }),
      );
    const msg = async (mid: unknown) => (await rows(`SELECT * FROM studio.messages WHERE id = ${String(mid)}`))[0]!;
    const rungsOf = async (invoice: unknown) => (await messages(invoice)).filter((m) => m.kind.startsWith('invoice-rung-'));
    const rungOf = async (invoice: unknown, n: number) => (await rungsOf(invoice)).find((m) => m.kind === `invoice-rung-${String(n)}`)!;

    /** Every email queued, oldest first, as the mail job will send it. */
    const mail = async () =>
      (await meta.db.selectFrom('adminium_jobs').selectAll().where('kind', '=', 'email.send').orderBy('createdAt').orderBy('id').execute()).map((job) => {
        const payload = (typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload) as { envelope: string };
        const envelope = JSON.parse(decryptSecret(payload.envelope, emailEnvelopeKey(TEST_SECRET))) as { to: string; subject: string; text: string; html: string };
        return envelope;
      });

    let ann: Row;
    let ben: Row;
    const invoice = async (values: Row): Promise<Row> =>
      create('invoices', { client_id: ann['id'], total: 100, due_on: '2026-10-01', ladder: 'standard', ...values });
    /** Sent, and its "your invoice" email sent at once, so each test counts only its own. */
    const send = async (row: Row) => {
      const sent = await update('invoices', row['id'], { status: 'sent' });
      await sender.sendApp('studio', clock);
      return sent;
    };

    beforeAll(async () => {
      // The add-on first: an app that needs it is refused without it.
      h = await installInvoicing(dialect, studioManifest(), async (store) => {
        await manifestsRepo(store, { encrypt: (v: string) => v, decrypt: (v: string) => v }).install({
          manifestKey: 'invoices',
          version: '1.0.0',
          source: 'file',
          kind: 'add-on',
          document: addOnManifest('invoices', {
            settings: ['payment_instructions', 'bank_note'].map((key) => ({ key, type: 'string', label: { key: `addon.invoices.${key}`, fallback: key } })),
            addOn: { attaches: [{ app: 'studio' }], slots: [], publicSettings: ['payment_instructions'] },
          }),
        } as never);
      });
      meta = h.meta;
      await meta.db.updateTable('adminium_connections').set({ timezone: 'Europe/London', currency: 'GBP' }).where('id', '=', h.connectionId).execute();
      await settingsRepo(meta).set('email.smtp', {
        host: 'localhost',
        port: 587,
        user: 'postmaster',
        passEncrypted: encryptSecret('hunter2', emailSecretKey(TEST_SECRET)),
        from: 'Studio <no-reply@north-studio.dev>',
        secure: false,
      } as never);
      const views = createPublicViews(meta);
      view = (await views.viewFor(h.connectionId))!;
      // The write lane's states stand-in: a finished project is never paused.
      const finished: RecordHooks = {
        wants: async (timing, action, t) =>
          (timing === 'before' && action === 'update' && t.table.name === h.real('projects')) || (probeHook !== null && timing === 'before' && t.table.name === h.real('messages')),
        before: async (e) => {
          if (e.target.table.name === h.real('messages')) {
            if (probeHook !== null) await probeHook(e);
            return;
          }
          if (e.record?.['status'] === 'done' && e.values['status'] !== undefined) throw new HookRejectedError('This project is done, so it cannot be paused.', 'states');
        },
        after: async () => {},
      };
      writes = createWriteService({
        sequences: documentSequencesRepo(meta),
        hooks: () => withOutboxMoves(finished, { meta, outboxes: () => producers.all(), now: () => clock }),
        watched: (connectionId, tableId) => producers.watches(connectionId, tableId),
      });
      producers = createOutboxProducers({ meta, manager: h.manager, viewFor: views.viewFor, writes });
      const links: SignInLinkMinter = {
        mint: async (input) => {
          if (onMint !== null) await onMint();
          minted.push({ pk: input.pk, email: input.email, ...(input.to === undefined ? {} : { to: input.to }) });
          return `${input.base}/c#link-${String(input.pk['id'])}-${String(minted.length)}`;
        },
      };
      sender = createOutboxSender({
        meta,
        manager: h.manager,
        viewFor: views.viewFor,
        writes,
        live: () => producers.live(),
        secret: TEST_SECRET,
        hostFor: async () => 'portal.north-studio.dev',
        staffHostFor: async () => staffHost,
        signInLinks: links,
        emit: async (e) => {
          emitted.push(e);
          await producers.onRecordEvent(e);
        },
      });
      await rows(
        `INSERT INTO studio.settings (name, reply_to, ladders) VALUES ('North Studio', 'studio@north-studio.dev', '{"gentle":[7,21,45],"standard":[3,14,30],"firm":[1,7,21]}')`,
      );
      await settingsRepo(meta).set('system.publicOrigin', 'https://admin.north-studio.dev' as never);
      // A second add-on, one the app does not name (the one it requires is in already).
      const manifests = manifestsRepo(meta, { encrypt: (v: string) => v, decrypt: (v: string) => v });
      const addOn = (key: string, settings: string[], publicSettings: string[]) =>
        manifests.install({
          manifestKey: key,
          version: '1.0.0',
          source: 'file',
          kind: 'add-on',
          document: { kind: 'add-on', key, settings: settings.map((k) => ({ key: k, type: 'text' })), addOn: { publicSettings } },
        } as never);
      await addOn('shipping', ['carrier'], ['carrier']);
      await addOnSettingsRepo(meta).patch('invoices', { payment_instructions: 'Bank 12-34-56', bank_note: 'hush-note' }, [{ key: 'payment_instructions' }, { key: 'bank_note' }]);
      await addOnSettingsRepo(meta).patch('shipping', { carrier: 'Parcel Co' }, [{ key: 'carrier' }]);
      ann = await create('clients', { email: 'ann@client.studio.dev', name: 'Ann Lee' });
      ben = await create('clients', { email: 'ben@client.studio.dev', name: 'Ben Ode' });
    }, 120_000);

    afterAll(async () => {
      await h?.close();
    });

    it('makes the three reminders held when the invoice is sent, each due at 09:00 on its day in London, waking once', async () => {
      const a = await invoice({});
      expect(await rungsOf(a['id'])).toEqual([]);
      await update('invoices', a['id'], { status: 'sent' });
      const made = await messages(a['id']);
      expect(made.map((m) => [m.kind, m.status, m.to])).toEqual([
        ['invoice-sent', 'queued', 'ann@client.studio.dev'],
        ['invoice-rung-1', 'held', 'ann@client.studio.dev'],
        ['invoice-rung-2', 'held', 'ann@client.studio.dev'],
        ['invoice-rung-3', 'held', 'ann@client.studio.dev'],
      ]);
      expect(made.slice(1).map((m) => m.due)).toEqual(STANDARD);

      // The invoice email goes; the held ones do not, before or after their day.
      expect(await sender.sendApp('studio', at('2026-10-02T12:00:00Z'))).toBe(1);
      const invoiceMail = await mail();
      expect(invoiceMail.map((m) => [m.to, m.subject])).toEqual([['ann@client.studio.dev', `Invoice ${String(a['id'])}`]]);
      // Money in the connection's pounds; how to pay from the required add-on's PUBLIC setting only.
      expect(invoiceMail[0]!.text).toContain(`invoice ${String(a['id'])} for £100.00 is attached`);
      expect(invoiceMail[0]!.text).toContain('How to pay: Bank 12-34-56');
      expect(invoiceMail[0]!.text).not.toContain('hush-note');
      expect(invoiceMail[0]!.text).not.toContain('Parcel Co');
      // A button built from the guest side's page and a column.
      expect(invoiceMail[0]!.html).toContain(`href="https://portal.north-studio.dev/h#${String(a['id'])}"`);
      for (const now of ['2026-10-04T07:59:00Z', '2026-10-04T08:00:00Z', '2026-10-04T08:01:00Z']) {
        await producers.scan(at(now));
        expect(await sender.sendApp('studio', at(now))).toBe(0);
      }
      // Woken, not remade: still three, rung 1 ready (held and due), the others waiting.
      const after = await rungsOf(a['id']);
      expect(after.map((m) => [m.status, m.due])).toEqual(STANDARD.map((due) => ['held', due]));
      expect(after.filter((m) => m.status === 'held' && Date.parse(m.due!) <= at('2026-10-04T08:01:00Z')).map((m) => m.kind)).toEqual(['invoice-rung-1']);
      expect(await mail()).toHaveLength(1);
    });

    it('approves a reminder with the wording edited: sent at once, to the address as it is now, with a sign-in link', async () => {
      const a = await invoice({});
      await send(a);
      // Ann's address changed since the reminder was made.
      await update('clients', ann['id'], { email: 'Ann.Lee@Client.Studio.dev' });
      const first = await rungOf(a['id'], 1);
      expect(first.to).toBe('ann@client.studio.dev');
      clock = at('2026-10-04T09:00:00Z');
      const before = (await mail()).length;
      await update('messages', first.id, {
        status: 'queued',
        subject_override: 'About invoice\nthe nudge',
        body_override: `Hi Ann,\n\nJust a nudge on invoice {{invoice.id}}. <b>Thanks</b>\n\nOpen it: {{signInLink}}`,
      });
      const approved = await rungOf(a['id'], 1);
      expect(approved).toMatchObject({ status: 'queued', approvedBy: 'Ivy Ferreira', to: 'Ann.Lee@Client.Studio.dev' });
      expect(await sender.sendApp('studio', clock)).toBe(1);
      expect(await rungOf(a['id'], 1)).toMatchObject({ status: 'sent', sent: true });
      const sent = (await mail()).slice(before);
      expect(sent).toHaveLength(1);
      expect(sent[0]!.to).toBe('Ann.Lee@Client.Studio.dev');
      // The subject on one line; the body as text paragraphs, escaped, filled once.
      expect(sent[0]!.subject).toBe('About invoice the nudge');
      expect(sent[0]!.text).toContain(`Just a nudge on invoice ${String(a['id'])}. <b>Thanks</b>`);
      expect(sent[0]!.html).toContain('&lt;b&gt;Thanks&lt;/b&gt;');
      expect(sent[0]!.html).not.toContain('<b>Thanks');
      expect(sent[0]!.text).not.toContain('is waiting');
      // The link was minted for Ann, at her current address.
      expect(sent[0]!.text).toMatch(new RegExp(`Open it: https://portal\\.north-studio\\.dev/c#link-${String(ann['id'])}-\\d+`));
      // For Ann, at her current address, opening the invoice the reminder is about.
      expect(minted.at(-1)).toEqual({ pk: { id: ann['id'] }, email: 'ann.lee@client.studio.dev', to: `/invoices/${String(a['id'])}` });

      // A message addressed to her OLD mailbox goes without a link.
      const count = minted.length;
      await create('messages', { kind: 'invoice-sent', status: 'queued', to_address: 'ann@client.studio.dev', client_id: ann['id'], invoice_id: a['id'] });
      expect(await sender.sendApp('studio', clock)).toBe(1);
      const old = (await mail()).at(-1)!;
      expect(old.to).toBe('ann@client.studio.dev');
      expect(old.text).not.toContain('c#link');
      expect(minted).toHaveLength(count);
      await update('clients', ann['id'], { email: 'ann@client.studio.dev' });
    });

    it('never sends a skipped reminder, and a person cannot bring it back or mark one sent', async () => {
      const c = await invoice({});
      await send(c);
      const first = await rungOf(c['id'], 1);
      expect((await refused(update('messages', first.id, { status: 'skipped', skip_reason: 'paid' }))).code).toBe('STATE_MOVE_REFUSED');
      await update('messages', first.id, { status: 'skipped' });
      expect(await rungOf(c['id'], 1)).toMatchObject({ status: 'skipped', skip: 'by-hand' });
      expect((await refused(update('messages', first.id, { status: 'queued' }))).code).toBe('STATE_MOVE_REFUSED');
      const second = await rungOf(c['id'], 2);
      const marked = await refused(update('messages', second.id, { status: 'sent' }));
      expect([marked.statusCode, marked.code]).toEqual([409, 'STATE_MOVE_REFUSED']);
      expect((await refused(update('messages', second.id, { sent_at: '2026-10-04T09:00:00Z' }))).code).toBe('STATE_MOVE_REFUSED');
      expect((await refused(create('messages', { kind: 'invoice-rung-1', status: 'sent', invoice_id: c['id'] }))).code).toBe('STATE_MOVE_REFUSED');
      const before = (await mail()).length;
      await producers.scan(at('2026-10-05T09:00:00Z'));
      expect(await sender.sendApp('studio', at('2026-10-05T09:00:00Z'))).toBe(0);
      expect(await mail()).toHaveLength(before);
      expect(await rungOf(c['id'], 1)).toMatchObject({ status: 'skipped', sent: false });
    });

    it('skips the waiting reminders once the balance is paid, or the invoice voided — read by the scan, re-checked by the sender', async () => {
      const d = await invoice({});
      await send(d);
      const e = await invoice({ client_id: ben['id'] });
      await send(e);
      // A payment settles the invoice's balance in a statement that announces nothing on the invoice.
      await create('payments', { invoice_id: d['id'], amount: 100 });
      expect(Number((await rows(`SELECT balance FROM studio.invoices WHERE id = ${String(d['id'])}`))[0]!['balance'])).toBe(0);
      await update('invoices', e['id'], { status: 'void' });
      await producers.scan(at('2026-10-03T09:00:00Z'));
      expect((await rungsOf(d['id'])).map((m) => [m.status, m.skip])).toEqual([
        ['skipped', 'paid'],
        ['skipped', 'paid'],
        ['skipped', 'paid'],
      ]);
      expect((await rungsOf(e['id'])).map((m) => [m.status, m.skip])).toEqual([
        ['skipped', 'void'],
        ['skipped', 'void'],
        ['skipped', 'void'],
      ]);

      // Paid between the scan and the send: the sender looks again.
      const f = await invoice({});
      await send(f);
      clock = at('2026-10-04T10:00:00Z');
      await update('messages', (await rungOf(f['id'], 1)).id, { status: 'queued' });
      await create('payments', { invoice_id: f['id'], amount: 100 });
      const before = (await mail()).length;
      expect(await sender.sendApp('studio', clock)).toBe(1);
      expect(await rungOf(f['id'], 1)).toMatchObject({ status: 'skipped', skip: 'paid', sent: false });
      expect(await mail()).toHaveLength(before);
    });

    it('re-dates the reminders not yet sent when the due date or the ladder changes — never makes new ones', async () => {
      const g = await invoice({});
      await send(g);
      const ids = (await rungsOf(g['id'])).map((m) => m.id);
      await update('invoices', g['id'], { ladder: 'firm' });
      await producers.scan(at('2026-10-01T12:00:00Z'));
      expect((await rungsOf(g['id'])).map((m) => [m.id, m.due])).toEqual([
        [ids[0], '2026-10-02T08:00:00.000Z'],
        [ids[1], '2026-10-08T08:00:00.000Z'],
        [ids[2], '2026-10-22T08:00:00.000Z'],
      ]);
      await update('invoices', g['id'], { due_on: '2026-10-10' });
      await producers.scan(at('2026-10-01T12:00:00Z'));
      expect((await rungsOf(g['id'])).map((m) => [m.id, m.status, m.due])).toEqual([
        [ids[0], 'held', '2026-10-11T08:00:00.000Z'],
        [ids[1], 'held', '2026-10-17T08:00:00.000Z'],
        [ids[2], 'held', '2026-10-31T09:00:00.000Z'],
      ]);
    });

    it('skips an earlier reminder not yet sent once a later one comes due, so "send all ready" sends one per invoice', async () => {
      const k = await invoice({});
      await send(k);
      const m = await invoice({ client_id: ben['id'] });
      await send(m);
      // 15 October: rungs 1 and 2 of both have come due.
      clock = at('2026-10-15T09:00:00Z');
      // The desk approves every ready one before the scan has run: the sender still sends one each.
      const ready = async (inv: unknown) => (await rungsOf(inv)).filter((r) => r.status === 'held' && Date.parse(r.due!) <= clock);
      expect((await ready(m['id'])).map((r) => r.kind)).toEqual(['invoice-rung-1', 'invoice-rung-2']);
      for (const r of await ready(m['id'])) await update('messages', r.id, { status: 'queued' });
      const before = (await mail()).length;
      expect(await sender.sendApp('studio', clock)).toBe(2);
      expect((await rungsOf(m['id'])).map((r) => [r.kind, r.status, r.skip])).toEqual([
        ['invoice-rung-1', 'skipped', 'overtaken'],
        ['invoice-rung-2', 'sent', null],
        ['invoice-rung-3', 'held', null],
      ]);
      const plainer = (await mail()).slice(before);
      expect(plainer.map((e) => [e.to, e.subject])).toEqual([['ben@client.studio.dev', 'Plainer']]);
      // Days from the due date to today, on the venue's calendar.
      expect(plainer[0]!.text).toContain(`Invoice ${String(m['id'])} is 14 days late.`);

      // The scan leaves one ready per invoice.
      await producers.scan(clock);
      expect((await ready(k['id'])).map((r) => r.kind)).toEqual(['invoice-rung-2']);
      expect((await rungOf(k['id'], 1)).skip).toBe('overtaken');
    });

    it('sends a reminder early; the later one pauses the project once sent — after the status is committed, announced, once', async () => {
      const project = await create('projects', { name: 'Vinyl sleeves' });
      const n = await invoice({ project_id: project['id'] });
      await send(n);
      clock = at('2026-10-06T10:00:00Z');
      // Rung 3 is due 31 October: approved now, it goes now.
      await update('messages', (await rungOf(n['id'], 3)).id, { status: 'queued' });
      expect((await rungOf(n['id'], 3)).due).toBe(new Date(clock).toISOString());
      emitted.length = 0;
      expect(await sender.sendApp('studio', clock)).toBe(1);
      expect(await rungOf(n['id'], 3)).toMatchObject({ status: 'sent', effectAt: true, effectError: null });
      expect((await rows(`SELECT status FROM studio.projects WHERE id = ${String(project['id'])}`))[0]!['status']).toBe('paused');
      expect(emitted.map((e) => [e.table.id, e.before?.['status'], e.after?.['status']])).toEqual([[table('projects').id, 'active', 'paused']]);
      // Sending it overtook the earlier two.
      await producers.scan(clock);
      expect((await rungsOf(n['id'])).map((r) => [r.status, r.skip])).toEqual([
        ['skipped', 'overtaken'],
        ['skipped', 'overtaken'],
        ['sent', null],
      ]);
      // Nothing is done twice.
      expect(await sender.sweep(clock + 60_000)).toBe(0);
      expect(emitted).toHaveLength(1);
    });

    it('records a refused change on the message and never sends the reminder twice', async () => {
      const project = await create('projects', { name: 'Letterheads', status: 'done' });
      const p = await invoice({ client_id: ben['id'], project_id: project['id'] });
      await send(p);
      clock = at('2026-10-06T11:00:00Z');
      await update('messages', (await rungOf(p['id'], 3)).id, { status: 'queued' });
      const before = (await mail()).length;
      expect(await sender.sendApp('studio', clock)).toBe(1);
      expect(await rungOf(p['id'], 3)).toMatchObject({ status: 'sent', effectAt: false, effectError: 'This project is done, so it cannot be paused.' });
      expect(await sender.sweep(clock + 60_000)).toBe(0);
      expect(await sender.sweep(clock + 120_000)).toBe(0);
      expect((await mail()).length - before).toBe(1);
      expect((await rows(`SELECT status FROM studio.projects WHERE id = ${String(project['id'])}`))[0]!['status']).toBe('done');
    });

    it('keeps a sent message sent: a person cannot queue it again, and a row queued behind the check is not sent twice', async () => {
      const q = await invoice({});
      await send(q);
      const sentRow = (await messages(q['id'])).find((r) => r.kind === 'invoice-sent')!;
      expect((await messages(q['id'])).find((r) => r.id === sentRow.id)).toMatchObject({ status: 'sent', sent: true });
      const error = await refused(update('messages', sentRow.id, { status: 'queued' }));
      expect([error.statusCode, error.code]).toEqual([409, 'STATE_MOVE_REFUSED']);
      expect((await refused(update('messages', sentRow.id, { to_address: 'else@where.dev' }))).code).toBe('STATE_MOVE_REFUSED');
      // A whole-row form sending the row back as it is — its moment spelled as ISO text — changes nothing, and passes.
      await update('messages', sentRow.id, { status: 'sent', to_address: sentRow.to, sent_at: new Date(clock).toISOString() });
      // A door that skips the write service entirely.
      await rows(`UPDATE studio.messages SET status = 'queued' WHERE id = ${String(sentRow.id)}`);
      const before = (await mail()).length;
      expect(await sender.sendApp('studio', clock)).toBe(1);
      expect((await messages(q['id'])).find((r) => r.id === sentRow.id)).toMatchObject({ status: 'sent' });
      expect(await mail()).toHaveLength(before);

      // Not delivered after all: a person may queue it again, and it goes again, once.
      await sender.markUndelivered({ app: 'studio', connectionId: h.connectionId, table: table('messages').id, pk: { id: sentRow.id }, sentAt: clock }, new Error('550 mailbox unavailable'));
      expect((await messages(q['id'])).find((r) => r.id === sentRow.id)).toMatchObject({ status: 'failed', error: 'Not delivered: 550 mailbox unavailable' });
      await update('messages', sentRow.id, { status: 'queued' });
      expect(await sender.sendApp('studio', clock + 60_000)).toBe(1);
      expect(await sender.sendApp('studio', clock + 120_000)).toBe(0);
      expect((await messages(q['id'])).find((r) => r.id === sentRow.id)).toMatchObject({ status: 'sent', error: null });
      expect(await mail()).toHaveLength(before + 1);
    });

    it('repairs a sent invoice left with no reminders — a crash, an import — held, never a sample one or a paid one', async () => {
      // Sent with no event: what a crash between the write and its producers leaves, or an import.
      const crashed = await invoice({});
      await rows(`UPDATE studio.invoices SET status = 'sent' WHERE id = ${String(crashed['id'])}`);
      await rows(`INSERT INTO studio.invoices (client_id, status, due_on, ladder, total, balance) VALUES (${String(ann['id'])}, 'sent', '2026-10-01', 'gentle', 50, 50)`);
      const imported = Number((await rows(`SELECT max(id) AS id FROM studio.invoices`))[0]!['id']);
      await rows(`INSERT INTO studio.invoices (client_id, status, due_on, ladder, total, balance) VALUES (${String(ann['id'])}, 'sent', '2026-10-01', 'gentle', 50, 0)`);
      const paid = Number((await rows(`SELECT max(id) AS id FROM studio.invoices`))[0]!['id']);
      await rows(`INSERT INTO studio.invoices (client_id, status, due_on, ladder, total, balance) VALUES (${String(ann['id'])}, 'sent', '2026-10-01', 'gentle', 50, 50)`);
      const sample = Number((await rows(`SELECT max(id) AS id FROM studio.invoices`))[0]!['id']);
      // The app's sample ledger lists the last one.
      await rows(`CREATE TABLE studio_sample_rows (seq INTEGER PRIMARY KEY, table_ref VARCHAR(64) NOT NULL, pk VARCHAR(200) NOT NULL)`);
      await rows(`INSERT INTO studio_sample_rows (seq, table_ref, pk) VALUES (1, 'invoices', '{"id":${String(sample)}}')`);
      await appTablesRepo(meta).record({
        appKey: 'studio',
        manifestId: null,
        connectionId: h.connectionId,
        ref: 'sample_data',
        tableName: 'studio_sample_rows',
        owned: true,
        state: 'created',
        role: 'sample-ledger',
      });

      const before = (await mail()).length;
      await producers.scan(at('2026-10-02T12:00:00Z'));
      expect((await messages(crashed['id'])).map((m) => [m.kind, m.status])).toEqual([
        ['invoice-rung-1', 'held'],
        ['invoice-rung-2', 'held'],
        ['invoice-rung-3', 'held'],
      ]);
      expect((await messages(imported)).map((m) => [m.kind, m.status, m.due])).toEqual([
        ['invoice-rung-1', 'held', '2026-10-08T08:00:00.000Z'],
        ['invoice-rung-2', 'held', '2026-10-22T08:00:00.000Z'],
        ['invoice-rung-3', 'held', '2026-11-15T09:00:00.000Z'],
      ]);
      expect(await messages(paid)).toEqual([]);
      expect(await messages(sample)).toEqual([]);
      // Once: a second scan makes nothing more.
      await producers.scan(at('2026-10-02T12:01:00Z'));
      expect(await messages(crashed['id'])).toHaveLength(3);
      expect(await sender.sendApp('studio', at('2026-10-02T12:01:00Z'))).toBe(0);
      expect(await mail()).toHaveLength(before);

      // A sample that brings a message queued, to a real address: sample data like the rest, never sent.
      await rows(`INSERT INTO studio.messages (kind, status, to_address, invoice_id) VALUES ('invoice-sent', 'queued', 'ann.real@north-studio.dev', ${String(sample)})`);
      const brought = Number((await rows(`SELECT max(id) AS id FROM studio.messages`))[0]!['id']);
      await rows(`INSERT INTO studio_sample_rows (seq, table_ref, pk) VALUES (2, 'messages', '{"id":${String(brought)}}')`);
      await sender.sendApp('studio', at('2026-10-02T12:02:00Z'));
      expect(await mail()).toHaveLength(before);
      expect((await rows(`SELECT status, error FROM studio.messages WHERE id = ${String(brought)}`))[0]).toMatchObject({ status: 'skipped', error: 'Sample data (never sent)' });
      await rows(`DELETE FROM studio_sample_rows`);
    });

    it("sends a studio notice to the settings' reply-to address — and never to the client when there is none", async () => {
      const r = await invoice({});
      await update('invoices', r['id'], { client_paid: true });
      const before = (await mail()).length;
      expect(await sender.sendApp('studio', clock)).toBe(1);
      const notice = (await mail()).slice(before);
      expect(notice.map((m) => [m.to, m.subject])).toEqual([['studio@north-studio.dev', 'Paid, they say']]);
      // The studio's own notice: no person's name for it, and no sign-in link; its button opens the desk.
      expect(notice[0]!.text).toContain('Ann Lee says invoice');
      expect(notice[0]!.text).not.toContain('c#link');
      expect(notice[0]!.text).toContain(`At the desk: https://admin.north-studio.dev/apps/studio/staff/invoices/${String(r['id'])}`);

      // The staff side on its own host.
      staffHost = 'desk.north-studio.dev';
      const r2 = await invoice({});
      await update('invoices', r2['id'], { client_paid: true });
      expect(await sender.sendApp('studio', clock)).toBe(1);
      expect((await mail()).at(-1)!.text).toContain(`At the desk: https://desk.north-studio.dev/invoices/${String(r2['id'])}`);
      staffHost = undefined;

      // Its own switch off: no notice at all; on again: the next one comes.
      await rows(`UPDATE studio.settings SET notify_paid = ${dialect === 'postgres' ? 'false' : '0'}`);
      const quiet = await invoice({});
      await update('invoices', quiet['id'], { client_paid: true });
      expect(await messages(quiet['id'])).toEqual([]);
      await rows(`UPDATE studio.settings SET notify_paid = ${dialect === 'postgres' ? 'true' : '1'}`);
      await update('invoices', quiet['id'], { client_paid: false });
      await update('invoices', quiet['id'], { client_paid: true });
      expect((await messages(quiet['id'])).map((m) => [m.kind, m.status])).toEqual([['client-says-paid', 'queued']]);
      // The studio's address as it is when the notice goes, not as it was when it was made.
      await rows(`UPDATE studio.settings SET reply_to = 'desk@north-studio.dev'`);
      expect(await sender.sendApp('studio', clock)).toBe(1);
      expect((await mail()).at(-1)!.to).toBe('desk@north-studio.dev');

      await rows(`UPDATE studio.settings SET reply_to = NULL`);
      const s = await invoice({});
      await update('invoices', s['id'], { client_paid: true });
      expect((await messages(s['id'])).map((m) => [m.kind, m.status, m.to, m.error])).toEqual([['client-says-paid', 'skipped', null, 'No email on file']]);
      // Queued by hand with no address: still the setting, never the client it links.
      await create('messages', { kind: 'client-says-paid', status: 'queued', client_id: ann['id'], invoice_id: s['id'] });
      expect(await sender.sendApp('studio', clock)).toBe(1);
      expect((await messages(s['id'])).at(-1)).toMatchObject({ status: 'skipped', error: 'No email on file' });
      expect(await mail()).toHaveLength(before + 3);
      await rows(`UPDATE studio.settings SET reply_to = 'studio@north-studio.dev'`);
    });

    it("fills a message's links by the table they point at: one key is followed, two are not guessed", async () => {
      const inv = await invoice({ client_id: ben['id'], currency: 'EUR' });
      // A payment whose key to the invoice is `document_id`: the message links the invoice, and through it the client.
      const paid = await create('settlements', { document_id: inv['id'], amount: 40 });
      const [receipt] = await rows(`SELECT settlement_id, invoice_id, client_id, to_address, status FROM studio.messages WHERE settlement_id = ${String(paid['id'])}`);
      expect([Number(receipt!['invoice_id']), Number(receipt!['client_id']), receipt!['to_address'], receipt!['status']]).toEqual([
        Number(inv['id']),
        Number(ben['id']),
        'ben@client.studio.dev',
        'queued',
      ]);
      const before = (await mail()).length;
      expect(await sender.sendApp('studio', clock)).toBe(1);
      // The invoice keeps its own currency: euros, on a pound connection.
      expect((await mail()).slice(before).map((m) => [m.to, m.text.includes(`We received`)])).toEqual([['ben@client.studio.dev', true]]);
      await create('invoices', { client_id: ben['id'], total: 100, currency: 'EUR', status: 'draft' }).then(async (eur) => {
        await update('invoices', eur['id'], { status: 'sent' });
        await sender.sendApp('studio', clock);
        expect((await mail()).at(-1)!.text).toContain(`for €100.00 is attached`);
      });

      // Two keys to invoices: neither is taken for the link, and so nobody to send to.
      const moved = await create('transfers', { from_invoice_id: inv['id'], to_invoice_id: inv['id'] });
      const [note] = await rows(`SELECT invoice_id, client_id, status, error FROM studio.messages WHERE transfer_id = ${String(moved['id'])}`);
      expect([note!['invoice_id'] ?? null, note!['client_id'] ?? null, note!['status'], note!['error']]).toEqual([null, null, 'skipped', 'No email on file']);
    });

    it('sends each row on its own: one that fails takes nobody else back with it, and nothing is mailed twice', async () => {
      const a = await create('messages', { kind: 'transfer-note', status: 'queued', client_id: ann['id'], to_address: 'ann@client.studio.dev' });
      const b = await create('messages', { kind: 'transfer-note', status: 'queued', client_id: ben['id'], to_address: 'ben@client.studio.dev' });
      const before = (await mail()).length;
      // Marking one row sent is refused (a narrow column, a constraint, a project's own hook).
      probeHook = async (e) => {
        if (e.action === 'update' && Number(e.record?.['id']) === Number(b['id']) && e.values['status'] === 'sent') {
          throw new HookRejectedError('refused', 'probe');
        }
      };
      try {
        for (let pass = 0; pass < 3; pass += 1) await sender.sendApp('studio', clock).catch(() => undefined);
      } finally {
        probeHook = null;
      }
      expect((await mail()).slice(before).filter((m) => m.subject === 'A transfer').map((m) => m.to)).toEqual(['ann@client.studio.dev']);
      expect((await msg(a['id']))['status']).toBe('sent');
      expect([(await msg(b['id']))['status'], (await msg(b['id']))['error']]).toEqual(['failed', 'The email could not be prepared']);
      // The mail job knows which message it is: a second queueing of the same send is collapsed.
      const keys = (await meta.db.selectFrom('adminium_jobs').select(['dedupeKey']).where('kind', '=', 'email.send').execute()).map((job) => job.dedupeKey ?? '');
      expect(keys.filter((key) => new RegExp(`^app-outbox:studio:.+:${String(a['id'])}:\\d+$`).test(key))).toHaveLength(1);

      // A column the sender reads is gone (the database answers with an error): that row fails, the other goes, once.
      const c = await create('messages', { kind: 'transfer-note', status: 'queued', client_id: ann['id'], to_address: 'ann@client.studio.dev' });
      const d = await create('messages', { kind: 'client-says-paid', status: 'queued', client_id: ann['id'] });
      const count = (await mail()).length;
      await rows(`ALTER TABLE studio.settings RENAME COLUMN reply_to TO reply_to_gone`);
      try {
        for (let pass = 0; pass < 3; pass += 1) await sender.sendApp('studio', clock).catch(() => undefined);
      } finally {
        await rows(`ALTER TABLE studio.settings RENAME COLUMN reply_to_gone TO reply_to`);
      }
      expect((await mail()).slice(count).filter((m) => m.subject === 'A transfer')).toHaveLength(1);
      expect([(await msg(c['id']))['status'], (await msg(d['id']))['status']]).toEqual(['sent', 'failed']);
    });

    it('keeps a person’s wording to what the template reads, only on a held reminder, and never lets it choose the address', async () => {
      // No wording on a new row, nor on a row a person addresses.
      expect((await refused(create('messages', { kind: 'transfer-note', status: 'queued', client_id: ann['id'], to_address: 'mallory@evil-probe.dev', body_override: '{{client.email}}' }))).code).toBe(
        'STATE_MOVE_REFUSED',
      );
      const typed = await create('messages', { kind: 'transfer-note', status: 'queued', client_id: ann['id'], to_address: 'mallory@evil-probe.dev' });
      expect((await refused(update('messages', typed['id'], { body_override: '{{client.email}}' }))).code).toBe('STATE_MOVE_REFUSED');
      await update('messages', typed['id'], { status: 'skipped' });

      const inv = await invoice({});
      await send(inv);
      const first = await rungOf(inv['id'], 1);
      // A held reminder is addressed by Adminium: a typed address is refused.
      expect((await refused(update('messages', first.id, { to_address: 'mallory@evil-probe.dev' }))).code).toBe('STATE_MOVE_REFUSED');
      const before = (await mail()).length;
      await update('messages', first.id, { status: 'queued', body_override: 'For {{client.email}} / {{client.name}}: invoice {{invoice.id}}.' });
      // Approved and queued: its wording is settled.
      expect((await refused(update('messages', first.id, { body_override: 'changed' }))).code).toBe('STATE_MOVE_REFUSED');
      await sender.sendApp('studio', clock);
      const sent = (await mail()).slice(before).find((m) => m.subject === 'A gentle nudge');
      expect(sent!.to).toBe('ann@client.studio.dev');
      expect(sent!.text).toContain(`For  / : invoice ${String(inv['id'])}.`);
      expect(sent!.text).not.toContain('ann@client.studio.dev');
      expect(sent!.text).not.toContain('Ann Lee');

      // A template that names what no email reads — a masked column of a linked row, an add-on's
      // setting it does not list, an add-on the app does not require — is never sent with `{{…}}` in it.
      await emailTemplatesRepo(meta).upsert('studio-payment-receipt', 'en_US', {
        name: 'payment-receipt',
        subject: 'Payment received',
        blocks: [{ id: 'b1', block: 'email.text', data: { text: 'Receipt for {{client.email}}: {{addOn.invoices.bank_note}} {{addOn.shipping.carrier}} {{invoice.id}}' } }],
        enabled: true,
      });
      const paid = await create('settlements', { document_id: inv['id'], amount: 5 });
      const count = (await mail()).length;
      await sender.sendApp('studio', clock);
      expect((await mail()).slice(count).filter((m) => m.subject === 'Payment received')).toEqual([]);
      expect((await rows(`SELECT status, error FROM studio.messages WHERE settlement_id = ${String(paid['id'])}`))[0]).toMatchObject({
        status: 'failed',
        error: 'Not sent: nothing fills {{client.email}}, {{addOn.invoices.bank_note}}, {{addOn.shipping.carrier}}',
      });
      for (const m of await mail()) for (const hidden of ['hush-note', 'Parcel Co']) expect(m.text).not.toContain(hidden);
    });

    it('lets a message sent meanwhile stay sent: a stale second try or a skip during the send sends nothing twice', async () => {
      // Failed for good, then two people queue it again at once: the second lands after the sender sent it.
      const m = await create('messages', { kind: 'transfer-note', status: 'queued', client_id: ann['id'], to_address: 'ann@client.studio.dev' });
      await sender.sendApp('studio', clock);
      await sender.markUndelivered({ app: 'studio', connectionId: h.connectionId, table: table('messages').id, pk: { id: m['id'] as number }, sentAt: clock }, new Error('550'));
      expect((await msg(m['id']))['status']).toBe('failed');
      const before = (await mail()).length;
      let raced = false;
      probeHook = async (e) => {
        if (!raced && e.context === desk && e.action === 'update') {
          raced = true;
          await rows(`UPDATE studio.messages SET status = 'queued' WHERE id = ${String(m['id'])}`);
          await sender.sendApp('studio', clock + 60_000);
        }
      };
      try {
        // Judged on the row as it was (failed); it is sent by the time the UPDATE runs, so the UPDATE is refused.
        expect((await refused(update('messages', m['id'], { status: 'queued' }))).code).toBe('STATE_MOVE_REFUSED');
      } finally {
        probeHook = null;
      }
      await sender.sendApp('studio', clock + 120_000);
      expect((await mail()).slice(before).filter((x) => x.subject === 'A transfer')).toHaveLength(1);
      expect((await msg(m['id']))['status']).toBe('sent');
      // When it went is Adminium's: a person's value for it is refused, never written.
      const again = await create('messages', { kind: 'transfer-note', status: 'queued', client_id: ann['id'], to_address: 'ann@client.studio.dev' });
      await sender.sendApp('studio', clock);
      await sender.markUndelivered({ app: 'studio', connectionId: h.connectionId, table: table('messages').id, pk: { id: again['id'] as number }, sentAt: clock }, new Error('550'));
      expect((await refused(update('messages', again['id'], { status: 'queued', sent_at: null }))).code).toBe('STATE_MOVE_REFUSED');

      // Approved, then skipped while its email is being made: it does not go.
      const inv = await invoice({});
      await send(inv);
      const first = await rungOf(inv['id'], 1);
      await update('messages', first.id, { status: 'queued' });
      const count = (await mail()).length;
      onMint = async () => {
        await update('messages', first.id, { status: 'skipped' });
      };
      try {
        await sender.sendApp('studio', clock);
      } finally {
        onMint = null;
      }
      expect(await rungOf(inv['id'], 1)).toMatchObject({ status: 'skipped', skip: 'by-hand', sent: false });
      expect(await mail()).toHaveLength(count);
    });

    it('refuses a skip judged on a queued message the sender sent meanwhile: it stays sent, mailed once', async () => {
      const m = await create('messages', { kind: 'transfer-note', status: 'queued', client_id: ann['id'], to_address: 'ann@client.studio.dev' });
      const before = (await mail()).length;
      let raced = false;
      // The sweep claims and sends the message between the person's read of it and their UPDATE.
      probeHook = async (e) => {
        if (!raced && e.context === desk && e.action === 'update') {
          raced = true;
          await sender.sendApp('studio', clock);
        }
      };
      let error: AppError;
      try {
        error = await refused(update('messages', m['id'], { status: 'skipped' }));
      } finally {
        probeHook = null;
      }
      expect(error.code).toBe('STATE_MOVE_REFUSED');
      const row = await msg(m['id']);
      expect(row['status']).toBe('sent');
      expect(row['skip_reason']).toBeNull();
      expect((await mail()).slice(before).filter((x) => x.subject === 'A transfer')).toHaveLength(1);
    });

    it('holds a reminder a person makes, fixes what a message is about, and never acts for a sent row of history', async () => {
      const project = await create('projects', { name: 'Hand made', status: 'active' });
      const inv = await invoice({ project_id: project['id'] });
      const made = await create('messages', { kind: 'invoice-rung-3', status: 'queued', invoice_id: inv['id'], client_id: ann['id'] });
      expect((await msg(made['id']))['status']).toBe('held');
      const before = (await mail()).length;
      await sender.sendApp('studio', clock);
      expect((await mail()).slice(before).filter((m) => m.subject === 'Pause the work')).toEqual([]);
      expect((await rows(`SELECT status FROM studio.projects WHERE id = ${String(project['id'])}`))[0]!['status']).toBe('active');
      // What it is and what it is about stay as made.
      expect((await refused(update('messages', made['id'], { kind: 'transfer-note' }))).code).toBe('STATE_MOVE_REFUSED');
      expect((await refused(update('messages', made['id'], { invoice_id: (await invoice({}))['id'] }))).code).toBe('STATE_MOVE_REFUSED');

      // An import brings a sent third reminder: nothing was sent for it, so nothing is paused.
      const other = await create('projects', { name: 'Imported', status: 'active' });
      const old = await invoice({ project_id: other['id'] });
      // Whoever starts an import may link a message only to rows they may read.
      const importer = await usersRepo(meta).create({ email: 'importer@north-studio.dev', name: 'Importer' });
      await rolesRepo(meta).assignToUser(importer.id, (await rolesRepo(meta).findBySlug('super-admin'))!.id);
      const imported: WriteContext = { origin: 'import', hops: 0, actor: { kind: 'user', id: importer.id, label: 'Importer' }, request: null };
      await writes.create({
        target: await target('messages'),
        values: { kind: 'invoice-rung-3', status: 'sent', sent_at: new Date(clock).toISOString(), invoice_id: old['id'], client_id: ann['id'] },
        context: imported,
        announce: async () => {},
      });
      await sender.sendApp('studio', clock);
      await sender.sweep(clock + 60_000);
      expect((await rows(`SELECT status FROM studio.projects WHERE id = ${String(other['id'])}`))[0]!['status']).toBe('active');

      // The undo of a delete puts a sent message back exactly as it was.
      const undo: WriteContext = { origin: 'undo', hops: 0, actor: { kind: 'user', id: 'usr_ivy', label: 'Ivy Ferreira' }, request: null };
      const back = await writes.create({
        target: await target('messages'),
        values: { kind: 'transfer-note', status: 'sent', sent_at: new Date(clock).toISOString(), client_id: ann['id'], to_address: 'ann@client.studio.dev' },
        context: undo,
        announce: async () => {},
      });
      expect((await msg(back['id']))['status']).toBe('sent');
      await sender.sendApp('studio', clock);
      expect((await mail()).slice(before).filter((m) => m.subject === 'A transfer' || m.subject === 'Pause the work')).toEqual([]);
    });

    it('mints a sign-in link only for the address as stored: never for a look-alike, and an ASCII case change goes to the stored spelling', async () => {
      const kim = await create('clients', { email: 'kim@kpmg-probe.dev', name: 'Kim' });
      const inv = await invoice({ client_id: kim['id'] });
      const minted0 = minted.length;
      const before = (await mail()).length;
      const invoiceMail = async () => (await mail()).slice(before).filter((m) => m.subject === `Invoice ${String(inv['id'])}`);
      // U+212A KELVIN SIGN lower-cases to an ASCII k.
      await create('messages', { kind: 'invoice-sent', status: 'queued', client_id: kim['id'], invoice_id: inv['id'], to_address: 'kim@Kpmg-probe.dev' });
      await sender.sendApp('studio', clock);
      expect(minted).toHaveLength(minted0);
      const lookalike = await invoiceMail();
      expect(lookalike.map((m) => [m.to, m.text.includes('c#link')])).toEqual([['kim@Kpmg-probe.dev', false]]);

      await create('messages', { kind: 'invoice-sent', status: 'queued', client_id: kim['id'], invoice_id: inv['id'], to_address: 'Kim@KPMG-probe.dev' });
      await sender.sendApp('studio', clock);
      expect(minted.slice(minted0).map((m) => m.email)).toEqual(['kim@kpmg-probe.dev']);
      const cased = (await invoiceMail()).at(-1)!;
      expect([cased.to, cased.text.includes('c#link')]).toEqual(['kim@kpmg-probe.dev', true]);
    });

    it('keeps a message whose day cannot be worked out waiting, and sends it once its day is known and has come', async () => {
      const inv = await invoice({ due_on: '2026-10-01' });
      await update('invoices', inv['id'], { nudge: true });
      const note = (await messages(inv['id'])).find((m) => m.kind === 'late-note')!;
      expect([note.status, note.due]).toEqual(['queued', null]);
      const before = (await mail()).length;
      const late = async () => (await mail()).slice(before).filter((m) => m.subject === 'Your invoice is late');
      await producers.scan(clock);
      await sender.sendApp('studio', clock);
      expect(await late()).toEqual([]);
      // The ladder gains a sixth day: the scan works the day out (1 October + 2 days, 09:00 in London).
      await rows(`UPDATE studio.settings SET ladders = '{"gentle":[7,21,45],"standard":[3,14,30,1,1,2],"firm":[1,7,21]}'`);
      try {
        await producers.scan(at('2026-10-02T12:00:00Z'));
        expect((await messages(inv['id'])).find((m) => m.kind === 'late-note')!.due).toBe('2026-10-03T08:00:00.000Z');
        await sender.sendApp('studio', at('2026-10-03T07:00:00Z'));
        expect(await late()).toEqual([]);
        await sender.sendApp('studio', at('2026-10-03T08:00:00Z'));
        expect((await late()).map((m) => m.to)).toEqual(['ann@client.studio.dev']);
      } finally {
        await rows(`UPDATE studio.settings SET ladders = '{"gentle":[7,21,45],"standard":[3,14,30],"firm":[1,7,21]}'`);
      }
    });

    it('makes one "new work" email of five versions posted in ten minutes', async () => {
      const deliverable = await create('deliverables', { client_id: ann['id'], title: 'Sleeve front' });
      for (let v = 1; v <= 5; v += 1) await create('deliverable_versions', { deliverable_id: deliverable['id'], v });
      const made = await rows(`SELECT id, status, due, client_id FROM studio.messages WHERE deliverable_id = ${String(deliverable['id'])}`);
      expect(made).toHaveLength(1);
      expect(Number(made[0]!['client_id'])).toBe(Number(ann['id']));
      const due = slotInstant(made[0]!['due'])!.getTime();
      // Not before the window closes.
      expect(await sender.sendApp('studio', due - 60_000)).toBe(0);
      const before = (await mail()).length;
      expect(await sender.sendApp('studio', due + 1_000)).toBe(1);
      expect((await mail()).slice(before).map((m) => [m.to, m.subject, m.text.includes('New work on Sleeve front.')])).toEqual([
        ['ann@client.studio.dev', 'New work to review', true],
      ]);
      // A version after it went opens the next window.
      await create('deliverable_versions', { deliverable_id: deliverable['id'], v: 6 });
      expect(await rows(`SELECT id FROM studio.messages WHERE deliverable_id = ${String(deliverable['id'])}`)).toHaveLength(2);
    });
  });
}

describe('where a sign-in link opens', () => {
  const box = { definition: { links: { client: 'client_id', invoice: 'invoice_id', deliverable: 'deliverable_id' } } } as unknown as LiveOutbox;
  const invoiceRung = { kind: 'invoice-rung-1', link: 'invoice_id' } as unknown as OutboxProducer;

  it('opens the client-side route named like the link the message is about, filled with its row', () => {
    const routes = { invoice: '/invoices/:id', client: '/me' };
    expect(routeFor(box, routes, { invoice_id: 42, client_id: 7 }, invoiceRung)).toBe('/invoices/42');
    // A desk-made message: the first link with a route.
    expect(routeFor(box, routes, { client_id: 7 }, undefined)).toBe('/me');
    expect(routeFor(box, routes, { invoice_id: 'a/b?c', client_id: null }, invoiceRung)).toBe('/invoices/a%2Fb%3Fc');
  });

  it('never leads anywhere but a path of the app', () => {
    for (const bad of ['//evil.example/:id', 'https://evil.example/:id', 'invoices/:id', '/\\evil.example', '/a/:x/:y']) {
      expect(routeFor(box, { invoice: bad }, { invoice_id: 42 }, invoiceRung)).toBeUndefined();
    }
    expect(routeFor(box, {}, { invoice_id: 42 }, invoiceRung)).toBeUndefined();
  });
});
