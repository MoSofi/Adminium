// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN APP'S EMAIL THAT CARRIES A DOCUMENT, on every engine.
 *
 * A studio app built on the invoices add-on's shape, installed through the
 * real installer, whose "your invoice" email says `attach: { kind: invoice,
 * link: invoice }`. The sender draws the invoice through the app's own
 * profile (or hands back the one already drawn while the invoice is
 * unchanged) and attaches it: the PDF where the add-on made one, the HTML
 * print copy where it could not (Arabic). A refusal, or the add-on switched
 * off for the app, fails the message — it is never sent without its document.
 *
 * The add-on stands in for the real one (another repository): it answers as
 * the real one does — PDF and HTML for Latin text, the HTML alone with a
 * warning for text a PDF cannot set — and can be told to refuse.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { documentSequencesRepo, documentsRepo, filesRepo, manifestsRepo, settingsRepo, type MetaDb } from '@adminium/meta';

import type { AddOnRuntimeState } from '../src/add-ons/runtime.js';
import { encryptSecret } from '../src/config/secrets.js';
import { createWriteService } from '../src/crud/write-service.js';
import { createDocumentPipeline } from '../src/documents/compose.js';
import type { RenderDeps } from '../src/documents/render.js';
import { emailSecretKey } from '../src/email/config.js';
import { createOutboxProducers } from '../src/outbox/producers.js';
import { createOutboxSender, type OutboxSender } from '../src/outbox/sender.js';
import { createPublicViews } from '../src/public-api/runtime.js';
import { NOON, installStudio, memoryStorage, studioManifest, type StudioHarness } from './app-documents.helpers.js';
import { TEST_SECRET } from './helpers.js';
import { LEGS } from './invoicing-install.helpers.js';

/** The studio, with a messages table and an outbox whose invoice email carries the invoice. */
function manifestWithOutbox(): Record<string, unknown> {
  const manifest = studioManifest();
  const schema = manifest['requiredSchema'] as { tables: Record<string, unknown>[] };
  const clients = schema.tables.find((t) => t['ref'] === 'clients')!;
  (clients['columns'] as Record<string, unknown>[]).push({ ref: 'language', type: 'text', maxLength: 35, nullable: true });
  schema.tables.push({
    ref: 'messages',
    columns: [
      { ref: 'id', type: 'int', role: 'pk' },
      { ref: 'kind', type: 'enum', enum: ['invoice-sent', 'note'] },
      { ref: 'status', type: 'enum', enum: ['queued', 'sent', 'failed', 'skipped'], default: 'queued' },
      { ref: 'to_address', type: 'text', maxLength: 254, nullable: true },
      { ref: 'language', type: 'text', maxLength: 35, nullable: true },
      { ref: 'client_id', type: 'fk', references: 'clients', nullable: true },
      { ref: 'invoice_id', type: 'fk', references: 'invoices', nullable: true },
      { ref: 'error', type: 'text', maxLength: 200, nullable: true },
      { ref: 'sent_at', type: 'timestamptz', nullable: true },
    ],
  });
  const template = (key: string, subject: string, text: string, attach?: Record<string, unknown>) => ({
    key: `studio-${key}`,
    name: key,
    ...(attach === undefined ? {} : { attach }),
    locales: { 'en-US': { subject, blocks: [{ block: 'email.text', data: { text } }] } },
  });
  return {
    ...manifest,
    outbox: {
      table: 'messages',
      columns: { kind: 'kind', status: 'status', to: 'to_address', language: 'language', error: 'error', sentAt: 'sent_at' },
      links: { client: 'client_id', invoice: 'invoice_id' },
      recipient: { via: 'client_id', table: 'clients', email: 'email', name: 'name', language: 'language' },
      kinds: { 'invoice-sent': 'studio-invoice-sent', note: 'studio-note' },
    },
    emailTemplates: [
      template('invoice-sent', 'Invoice {{invoice.number}}', 'Your invoice {{invoice.number}} is attached.', { kind: 'invoice', link: 'invoice' }),
      template('note', 'A note', 'A note, with nothing attached.'),
    ],
  };
}

/** The invoices add-on as the real one answers: PDF and HTML for Latin text, the HTML alone for text a PDF cannot set. */
function drawingAddOn() {
  const state = { refuse: false, draws: 0 };
  const slots = [
    { id: 'number', type: 'text', required: false },
    { id: 'clientName', type: 'text', required: true },
    { id: 'total', type: 'money', required: false },
    { id: 'lines', type: 'collection', required: false, columns: [{ id: 'description', type: 'text' }, { id: 'amount', type: 'money' }] },
  ];
  const module = {
    key: 'invoices',
    kinds: () => ['invoice', 'receipt', 'statement'].map((id) => ({ id, formats: ['pdf', 'html'] as const, paper: ['a4'] })),
    describe: () => ({ slots }),
    render: (input: { kind: string; subject: { locale?: string; number?: string | null }; formats: string[] }) => {
      if (state.refuse) return Promise.resolve({ code: 'INVALID_SUBJECT', detail: 'the total is not a number' });
      state.draws += 1;
      const latin = !/^(ar|zh|ja|ko|he|fa)\b/.test(input.subject.locale ?? 'en');
      const html = {
        format: 'html' as const,
        filename: `${input.kind}.html`,
        mediaType: 'text/html; charset=utf-8',
        bytes: new TextEncoder().encode(`<p>${String(input.subject.number)}</p>`),
        locale: input.subject.locale ?? 'en-US',
        warnings: latin ? [] : ['PDF_SCRIPT_UNSUPPORTED'],
      };
      const pdf = { ...html, format: 'pdf' as const, filename: `${input.kind}.pdf`, mediaType: 'application/pdf', bytes: new TextEncoder().encode('%PDF-1.7'), warnings: [] };
      return Promise.resolve(latin && input.formats.includes('pdf') ? [pdf, html] : [html]);
    },
  };
  const runtime = {
    providers: new Map([['document-render@1', [{ addOnKey: 'invoices', contract: 'document-render', version: 1, module }]]]),
    slots: new Map(),
    conflicts: [],
    problems: [],
  } as unknown as AddOnRuntimeState;
  return { state, runtime };
}

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`an app email carrying a document on ${dialect}`, () => {
    let h: StudioHarness;
    let meta: MetaDb;
    let sender: OutboxSender;
    let pipeline: RenderDeps;
    const addOn = drawingAddOn();
    const clock = Date.parse('2026-10-02T12:00:00Z');
    const t = (ref: string) => h.real(ref);

    /** Queue one invoice email, send, and read back the row and the email job. */
    const sendFor = async (invoice: number, client: number) => {
      await h.sql(`insert into ${t('messages')} (kind, status, client_id, invoice_id) values ('invoice-sent', 'queued', ${String(client)}, ${String(invoice)})`);
      const id = Number((await h.rows(`select max(id) as id from ${t('messages')}`))[0]!['id']);
      const jobsBefore = (await emailJobs()).length;
      await sender.sendApp('studio', clock);
      const [row] = await h.rows(`select status, error, sent_at from ${t('messages')} where id = ${String(id)}`);
      const jobs = (await emailJobs()).slice(jobsBefore);
      return { status: row!['status'], error: row!['error'] ?? null, sent: row!['sent_at'] !== null, jobs };
    };
    const emailJobs = async () =>
      (await meta.db.selectFrom('adminium_jobs').selectAll().where('kind', '=', 'email.send').orderBy('createdAt').orderBy('id').execute()).map((job) => {
        const payload = (typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload) as { attachments?: { fileId: string; filename: string }[] };
        return payload.attachments ?? [];
      });
    const mimeOf = async (fileId: string) => (await filesRepo(meta).findById(fileId))?.mime;

    beforeAll(async () => {
      h = await installStudio(dialect, manifestWithOutbox());
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
      let tick = NOON;
      pipeline = { ...createDocumentPipeline({ meta, manager: h.manager, storage: memoryStorage(), runtime: () => addOn.runtime }), now: () => (tick += 1000) };
      const views = createPublicViews(meta);
      const writes = createWriteService({ sequences: documentSequencesRepo(meta) });
      const producers = createOutboxProducers({ meta, manager: h.manager, viewFor: views.viewFor, writes });
      sender = createOutboxSender({ meta, manager: h.manager, viewFor: views.viewFor, writes, live: () => producers.live(), secret: TEST_SECRET, documents: () => pipeline });
      await h.sql(
        `insert into ${t('clients')} (id, email, name, company, language) values ` +
          "(1, 'ann@client.studio.dev', 'Ann Lee', 'Ann Studio Ltd', 'en-GB'), (2, 'rana@client.studio.dev', 'Rana Aziz', 'شركة رنا', 'ar')",
      );
      await h.sql(
        `insert into ${t('invoices')} (id, client_id, number, status, issued_on, total, currency) values ` +
          "(1, 1, 'INV-1001', 'sent', '2026-10-01', '100.00', 'GBP'), (2, 2, 'INV-1002', 'sent', '2026-10-01', '250.00', 'GBP'), (3, 1, 'INV-1003', 'sent', '2026-10-01', '75.00', 'GBP')",
      );
    }, 120_000);

    afterAll(async () => {
      await h?.close();
    });

    it("sends a sent invoice's email with its PDF", async () => {
      const sent = await sendFor(1, 1);
      expect([sent.status, sent.error, sent.sent]).toEqual(['sent', null, true]);
      expect(sent.jobs).toHaveLength(1);
      const [attachment] = sent.jobs[0]!;
      expect(attachment!.filename).toBe('invoice.pdf');
      expect(await mimeOf(attachment!.fileId)).toBe('application/pdf');
      // The document is the invoice's own, with its own number.
      const document = (await documentsRepo(meta).list({ addOnKey: 'invoices' })).find((d) => d.fileId === attachment!.fileId);
      expect(document?.number).toBe('INV-1001');
    });

    it("attaches the HTML print copy to an Arabic client's email", async () => {
      const sent = await sendFor(2, 2);
      expect([sent.status, sent.error]).toEqual(['sent', null]);
      const [attachment] = sent.jobs[0]!;
      expect(attachment!.filename).toBe('invoice.html');
      expect(await mimeOf(attachment!.fileId)).toBe('text/html; charset=utf-8');
    });

    it('reuses the document of an unchanged invoice: the same file, no second draw, no new document', async () => {
      const draws = addOn.state.draws;
      const first = await sendFor(1, 1);
      const again = await sendFor(1, 1);
      expect([first.status, again.status]).toEqual(['sent', 'sent']);
      const earlier = (await emailJobs())[0]![0]!;
      expect(first.jobs[0]![0]!.fileId).toBe(earlier.fileId);
      expect(again.jobs[0]![0]!.fileId).toBe(earlier.fileId);
      expect(addOn.state.draws).toBe(draws);
      const numbers = (await documentsRepo(meta).list({ addOnKey: 'invoices' })).filter((d) => d.number === 'INV-1001' && d.status === 'rendered');
      expect(numbers).toHaveLength(1);
    });

    it('fails the message, unsent, when the add-on refuses to draw', async () => {
      addOn.state.refuse = true;
      try {
        const sent = await sendFor(3, 1);
        expect([sent.status, sent.sent, sent.jobs]).toEqual(['failed', false, []]);
        expect(sent.error).toBe('The invoice could not be drawn: INVALID_SUBJECT: the total is not a number');
      } finally {
        addOn.state.refuse = false;
      }
    });

    it('fails the message, unsent, when the add-on is switched off for the app', async () => {
      const invoices = (await manifestsRepo(meta, { encrypt: (v) => v, decrypt: (v) => v }).findByKey('invoices'))!;
      await manifestsRepo(meta, { encrypt: (v) => v, decrypt: (v) => v }).setAttachmentEnabled(invoices.row.id, 'studio', false);
      try {
        const sent = await sendFor(3, 1);
        expect([sent.status, sent.sent, sent.jobs]).toEqual(['failed', false, []]);
        expect(String(sent.error)).toMatch(/^The invoice is not available: /);
        // An email that carries nothing still goes.
        await h.sql(`insert into ${t('messages')} (kind, status, client_id) values ('note', 'queued', 1)`);
        const before = (await emailJobs()).length;
        await sender.sendApp('studio', clock);
        expect((await emailJobs()).slice(before)).toEqual([[]]);
      } finally {
        await manifestsRepo(meta, { encrypt: (v) => v, decrypt: (v) => v }).setAttachmentEnabled(invoices.row.id, 'studio', true);
      }
      // Back on: the same email goes, with its document.
      const sent = await sendFor(3, 1);
      expect([sent.status, sent.jobs[0]![0]!.filename]).toEqual(['sent', 'invoice.pdf']);
    });
  });
}
