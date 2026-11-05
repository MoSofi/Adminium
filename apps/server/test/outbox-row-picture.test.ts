// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A PICTURE FROM A ROW'S FILE COLUMN IN AN APP'S EMAIL: a repair's photo in
 * the message about it (`email.image` with `fileId: "{{job.photo}}"`).
 *
 * The outbox's sender checks each picture against the row the message reads
 * it through, and only a picture that passes goes with the message, by its
 * id: shown as an inline part (`cid:`), the way a library image is, and
 * weighed again at delivery. A file another row holds, one in the bin, one
 * that is no picture or weighs more than 2 MiB, and one on a row the message
 * does not read are never sent: the picture is left out, or the message is
 * not sent when its image is `required`. A personal file column is refused
 * where the manifest is written.
 *
 * On every engine this run reaches, through the real installer, the outbox's
 * sender and the mail job.
 */
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

import { validateManifest } from '@adminium/manifest';
import { documentSequencesRepo, filesRepo, settingsRepo, type MetaDb } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createWriteService } from '../src/crud/write-service.js';
import { renderEmail } from '../src/email/render.js';
import type { EmailTransport, OutboundEmail } from '../src/email/types.js';
import { registerEmailSendHandler } from '../src/jobs/email-send.js';
import { createJobRegistry } from '../src/jobs/registry.js';
import { JobWorker } from '../src/jobs/worker.js';
import { createOutboxProducers } from '../src/outbox/producers.js';
import { rowPictures } from '../src/outbox/row-pictures.js';
import { createOutboxSender, type OutboxSender } from '../src/outbox/sender.js';
import { createPublicViews } from '../src/public-api/runtime.js';
import { RealtimeHub } from '../src/realtime/hub.js';
import { TEST_SECRET } from './helpers.js';
import { LEGS, installInvoicing, invoicingManifest, type InvoicingHarness } from './invoicing-install.helpers.js';
import { until } from './jobs-helpers.js';
import { SMTP } from './outbox-rows-fixture.js';

const id = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength = 120, more: Record<string, unknown> = {}) => ({ ref, type: 'text', maxLength, nullable: true, ...more });
const photo = (ref: string, more: Record<string, unknown> = {}) => text(ref, 64, { rules: { file: { accept: ['png', 'jpeg', 'gif', 'webp'], maxBytes: 8388608 }, ...more } });
const KINDS = ['photo', 'photo-required'] as const;

function manifest(personal = false): Record<string, unknown> {
  const image = (more: Record<string, unknown> = {}) => ({ block: 'email.image', data: { fileId: '{{job.photo}}', alt: 'Your repair', ...more } });
  return {
    ...invoicingManifest([
      { ref: 'customers', columns: [id, { ref: 'email', type: 'text', maxLength: 254, unique: true }, text('name')] },
      { ref: 'jobs', columns: [id, { ref: 'customer_id', type: 'fk', references: 'customers', nullable: true }, text('title'), photo('photo', personal ? { personal: true } : {})] },
      {
        ref: 'messages',
        columns: [
          id,
          { ref: 'kind', type: 'enum', enum: [...KINDS] },
          { ref: 'status', type: 'enum', enum: ['queued', 'sent', 'failed', 'skipped'], default: 'queued' },
          text('to_address', 254),
          { ref: 'customer_id', type: 'fk', references: 'customers', nullable: true },
          { ref: 'job_id', type: 'fk', references: 'jobs', nullable: true },
          text('error', 200),
          { ref: 'sent_at', type: 'timestamptz', nullable: true },
        ],
      },
    ]),
    key: 'repairs',
    compatibility: { minAdminiumVersion: '0.3.45' },
    outbox: {
      table: 'messages',
      columns: { kind: 'kind', status: 'status', to: 'to_address', error: 'error', sentAt: 'sent_at' },
      links: { job: 'job_id' },
      recipient: { via: 'customer_id', table: 'customers', email: 'email', name: 'name' },
      kinds: Object.fromEntries(KINDS.map((kind) => [kind, `repairs-${kind}`])),
      classes: Object.fromEntries(KINDS.map((kind) => [kind, 'service'])),
    },
    emailTemplates: [
      { key: 'repairs-photo', name: 'Photo', locales: { 'en-US': { subject: 'Your repair {{job.title}}', blocks: [{ block: 'email.text', data: { text: 'Here it is.' } }, image()] } } },
      { key: 'repairs-photo-required', name: 'Photo, required', locales: { 'en-US': { subject: 'Your repair, required {{job.title}}', blocks: [{ block: 'email.text', data: { text: 'Here it is.' } }, image({ required: true })] } } },
    ],
  };
}

/** A transport that keeps each message as delivery hands it over. */
function recordingTransport(): { sent: OutboundEmail[]; make: () => EmailTransport } {
  const sent: OutboundEmail[] = [];
  return { sent, make: () => ({ send: async (msg: OutboundEmail) => void sent.push(msg) }) };
}

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4b90000000049454e44ae426082', 'hex');

describe.each(LEGS)('a picture from a row in an app email — %s', (dialect, available) => {
  let h: InvoicingHarness;
  let meta: MetaDb;
  let sender: OutboxSender;
  let jobsTable = '';
  const now = Date.parse('2026-11-05T12:00:00Z');
  const transport = recordingTransport();
  /** The bytes of each stored file, by its storage key: what delivery reads. */
  const bytes = new Map<string, Buffer>();
  const files: Record<string, string> = {};
  /** Each message's row after the send, by the job it is about (null: none). */
  const status = async () =>
    (await h.rows(`SELECT id, kind, job_id, status, error FROM ${h.real('messages')} ORDER BY id`)).map((row) => ({ id: Number(row['id']), kind: row['kind'], job: row['job_id'] === null ? null : Number(row['job_id']), status: row['status'], error: row['error'] }));

  /** A file stored for a job's row (or none), as a column upload claimed by that row. */
  const store = async (name: string, opts: { job: number | null; mime?: string; size?: number; deleted?: boolean; claimed?: boolean }) => {
    const content = opts.mime === undefined || opts.mime === 'image/png' ? PNG : Buffer.from('%PDF-1.4\n');
    const row = await filesRepo(meta).create({
      filename: `${name}.${opts.mime === 'application/pdf' ? 'pdf' : 'png'}`,
      mime: opts.mime ?? 'image/png',
      sizeBytes: opts.size ?? content.length,
      sha256: createHash('sha256').update(content).digest('hex'),
      kind: 'upload',
      ...(opts.job === null ? { entityConnectionId: h.connectionId } : { entity: { connectionId: h.connectionId, table: jobsTable, pk: { id: opts.job }, label: String(opts.job) } }),
      ...(opts.claimed === false ? {} : { attachedAt: now }),
    });
    bytes.set(row.storageKey, content);
    if (opts.deleted === true) await meta.db.updateTable('adminium_files').set({ deletedAt: now }).where('id', '=', row.id).execute();
    files[name] = row.id;
    return row.id;
  };

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, manifest());
    meta = h.meta;
    await settingsRepo(meta).set('email.smtp', SMTP as never);
    const views = createPublicViews(meta);
    const writes = createWriteService({ sequences: documentSequencesRepo(meta) });
    const producers = createOutboxProducers({ meta, manager: h.manager, viewFor: views.viewFor, writes });
    sender = createOutboxSender({ meta, manager: h.manager, viewFor: views.viewFor, writes, live: () => producers.live(), secret: TEST_SECRET });
    jobsTable = (await views.viewFor(h.connectionId))!.model.tables.find((table) => table.name === h.real('jobs'))!.id;

    await h.rows(`INSERT INTO ${h.real('customers')} (email, name) VALUES ('ana@repairs.dev', 'Ana')`);
    // Job 1: its own photo. 2: job 1's photo in its column. 3: its photo in the bin. 4: a PDF. 5: too heavy. 6: no photo.
    // 7: an upload no row has claimed yet.
    for (let job = 1; job <= 7; job += 1) await h.rows(`INSERT INTO ${h.real('jobs')} (id, customer_id, title) VALUES (${String(job)}, 1, 'J${String(job)}')`);
    const own = await store('own', { job: 1 });
    const gone = await store('gone', { job: 3, deleted: true });
    const pdf = await store('pdf', { job: 4, mime: 'application/pdf' });
    const heavy = await store('heavy', { job: 5, size: 3 * 1024 * 1024 });
    const unclaimed = await store('unclaimed', { job: 7, claimed: false });
    for (const [job, file] of [[1, own], [2, own], [3, gone], [4, pdf], [5, heavy], [7, unclaimed]] as const) {
      await h.rows(`UPDATE ${h.real('jobs')} SET photo = '${file}' WHERE id = ${String(job)}`);
    }
    // One message of each kind about each job, and one about no job at all.
    for (const kind of KINDS) {
      for (let job = 1; job <= 7; job += 1) {
        await h.rows(`INSERT INTO ${h.real('messages')} (kind, status, to_address, customer_id, job_id) VALUES ('${kind}', 'queued', 'ana@repairs.dev', 1, ${String(job)})`);
      }
      await h.rows(`INSERT INTO ${h.real('messages')} (kind, status, to_address, customer_id, job_id) VALUES ('${kind}', 'queued', 'ana@repairs.dev', 1, NULL)`);
    }
    await sender.sendApp('repairs', now);

    // The mail job, delivering what the sender queued, with the files' bytes as the store keeps them.
    const registry = createJobRegistry();
    const storage = { open: async ({ storageKey }: { storageKey: string }) => ({ stream: Readable.from([bytes.get(storageKey) ?? Buffer.alloc(0)]) }) };
    registerEmailSendHandler(registry, { meta, secret: TEST_SECRET, createTransport: transport.make, storage: storage as never });
    const hub = new RealtimeHub();
    const worker = new JobWorker({ meta, registry, hub, workerId: `row-picture:${dialect}` });
    const sentCount = (await status()).filter((row) => row.status === 'sent').length;
    worker.start();
    try {
      await until(() => transport.sent.length === sentCount, 30_000);
    } finally {
      await worker.stop();
      hub.close();
    }
  }, 240_000);

  afterAll(async () => {
    if (!available) return;
    await h.close();
  });

  const delivered = (subject: string) => transport.sent.find((msg) => msg.subject === subject);
  const pictureParts = (msg: OutboundEmail | undefined) => (msg?.attachments ?? []).filter((part) => part.cid?.startsWith('img-') === true);

  it.skipIf(!available)('shows the row\'s own photo, inline by its cid, with its bytes', () => {
    const msg = delivered('Your repair J1')!;
    expect(msg).toBeDefined();
    expect(msg.html).toContain(`src="cid:img-${files['own']!}"`);
    const parts = pictureParts(msg);
    expect(parts.map((part) => [part.cid, part.contentType])).toEqual([[`img-${files['own']!}`, 'image/png']]);
    expect(Buffer.compare(parts[0]!.content as Buffer, PNG)).toBe(0);
    // The required one goes too.
    expect(pictureParts(delivered('Your repair, required J1'))).toHaveLength(1);
  });

  it.skipIf(!available)('leaves the picture out for another row\'s file, one in the bin, a PDF, one too heavy, an unclaimed upload and an empty column', async () => {
    for (const job of ['J2', 'J3', 'J4', 'J5', 'J6', 'J7']) {
      const msg = delivered(`Your repair ${job}`);
      expect(msg, job).toBeDefined();
      expect(pictureParts(msg), job).toEqual([]);
      expect(msg!.html, job).not.toContain('cid:img-');
    }
    // About no job at all: nothing fills what the template reads of it, the picture with the rest, as for any placeholder.
    const none = (await status()).find((row) => row.kind === 'photo' && row.job === null)!;
    expect([none.status, none.error]).toEqual(['failed', 'Not sent: nothing fills {{job.title}}, {{job.photo}}']);
  });

  it.skipIf(!available)('does not send a required picture it cannot show, and says why', async () => {
    const required = (await status()).filter((row) => row.kind === 'photo-required');
    const why = Object.fromEntries(required.map((row) => [row.job === null ? 'none' : `J${String(row.job)}`, [row.status, row.error]]));
    expect(why).toEqual({
      J1: ['sent', null],
      J2: ['failed', 'Not sent: the picture {{job.photo}} is not a file of this row'],
      J3: ['failed', 'Not sent: the picture {{job.photo}} is a file that is gone'],
      J4: ['failed', 'Not sent: the picture {{job.photo}} is not a picture (png, jpeg, gif or webp)'],
      J5: ['failed', 'Not sent: the picture {{job.photo}} is larger than 2 MB'],
      J6: ['failed', 'Not sent: the picture {{job.photo}} holds no picture'],
      J7: ['failed', 'Not sent: the picture {{job.photo}} is not a file of this row'],
      none: ['failed', 'Not sent: nothing fills {{job.title}}, {{job.photo}}'],
    });
  });

  it.skipIf(!available)('carries only the checked picture on the queued message, weighed again at delivery', async () => {
    const queued = await meta.db.selectFrom('adminium_jobs').select(['payload']).where('kind', '=', 'email.send').execute();
    const inline = queued.flatMap((row) => ((typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload) as { inline?: { kind: string; fileId?: string; maxBytes?: number }[] }).inline ?? []);
    const pictures = inline.filter((ref) => ref.kind === 'file');
    expect(new Set(pictures.map((ref) => ref.fileId))).toEqual(new Set([files['own']]));
    expect(pictures.every((ref) => ref.maxBytes === 2 * 1024 * 1024)).toBe(true);
  });

  it.skipIf(!available)('refuses to deliver a queued picture that has grown past 2 MB since', async () => {
    const before = transport.sent.length;
    await h.rows(`INSERT INTO ${h.real('messages')} (kind, status, to_address, customer_id, job_id) VALUES ('photo', 'queued', 'ana@repairs.dev', 1, 1)`);
    await sender.sendApp('repairs', now + 60_000);
    // The photo is replaced on disk by a heavier one after the message was queued.
    await meta.db.updateTable('adminium_files').set({ sizeBytes: 3 * 1024 * 1024 }).where('id', '=', files['own']!).execute();
    const registry = createJobRegistry();
    registerEmailSendHandler(registry, { meta, secret: TEST_SECRET, createTransport: transport.make, storage: { open: async () => ({ stream: Readable.from([PNG]) }) } as never });
    const hub = new RealtimeHub();
    const worker = new JobWorker({ meta, registry, hub, workerId: `row-picture-grown:${dialect}` });
    const lastError = async () =>
      (await meta.db.selectFrom('adminium_jobs').select(['lastError']).where('kind', '=', 'email.send').where('lastError', 'is not', null).execute()).map((row) => String(row.lastError));
    let errors: string[] = [];
    worker.start();
    try {
      const deadline = Date.now() + 30_000;
      while ((errors = await lastError()).length === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
    } finally {
      await worker.stop();
      hub.close();
      await meta.db.updateTable('adminium_files').set({ sizeBytes: PNG.length }).where('id', '=', files['own']!).execute();
    }
    expect(transport.sent.length).toBe(before);
    expect(errors[0]).toMatch(/larger than 2097152 bytes/);
  });

  it.skipIf(!available)('shows no picture from a column the reader may not see, and stops a required one', async () => {
    const view = (await createPublicViews(meta).viewFor(h.connectionId))!;
    const table = view.table(jobsTable);
    const record = (await h.rows(`SELECT * FROM ${h.real('jobs')} WHERE id = 1`))[0]!;
    const blocks = (required: boolean) => [{ block: 'email.image', data: { fileId: '{{job.photo}}', ...(required ? { required: true } : {}) } }];
    const ask = (required: boolean, withheld: ReadonlySet<string> = new Set()) =>
      rowPictures({ meta, connectionId: h.connectionId, view, blocks: blocks(required), vars: { 'job.photo': files['own']! }, withheld, rows: new Map([['job', { table, record }]]) });
    // As the outbox reads it: the row's own file is shown.
    expect(await ask(true)).toEqual({ pictures: new Set([files['own']]), refused: null });
    // Held back from this reader: left out, and a required one stops the message.
    expect(await ask(false, new Set(['job.photo']))).toEqual({ pictures: new Set(), refused: null });
    expect((await ask(true, new Set(['job.photo']))).refused).toBe('Not sent: the picture {{job.photo}} is not shown to this reader');
    // Personal data the outbox masks (an operator marked the column personal after the install): the same.
    const column = table.columns.get('photo')! as { masked: boolean };
    const was = column.masked;
    column.masked = true;
    try {
      expect(await ask(false)).toEqual({ pictures: new Set(), refused: null });
      expect((await ask(true)).refused).toBe('Not sent: the picture {{job.photo}} is not shown to this reader');
    } finally {
      column.masked = was;
    }
  });
});

describe('a picture from a row, as the email is drawn', () => {
  const draw = (pictures?: ReadonlySet<string>, imageFiles?: ReadonlySet<string>) =>
    renderEmail({
      template: { subject: 'Your repair', blocks: [{ block: 'email.image', data: { fileId: '{{job.photo}}', alt: 'Your repair' } }] },
      locale: 'en_US',
      vars: { 'job.photo': 'file_01JOBPHOTO000000000000000' },
      dir: 'ltr',
      ...(pictures === undefined ? {} : { pictures }),
      ...(imageFiles === undefined ? {} : { imageFiles }),
    });

  it('shows the file the row holds only when the sender checked it for this message', () => {
    const shown = draw(new Set(['file_01JOBPHOTO000000000000000']));
    expect(shown.html).toContain('<img src="cid:img-file_01JOBPHOTO000000000000000" alt="Your repair"');
    expect(shown.inline).toEqual([{ cid: 'img-file_01JOBPHOTO000000000000000', kind: 'file', fileId: 'file_01JOBPHOTO000000000000000', maxBytes: 2 * 1024 * 1024 }]);
    // Not checked: no picture, nothing to attach — even when the id is a library image the document could show by its id.
    for (const out of [draw(), draw(new Set(['file_01OTHER0000000000000000000'])), draw(undefined, new Set(['file_01JOBPHOTO000000000000000']))]) {
      expect(out.html).not.toContain('cid:img-');
      expect(out.inline.filter((ref) => ref.kind === 'file')).toEqual([]);
    }
  });
});

describe.each(LEGS)('a personal file column in an app email — %s', (dialect, available) => {
  it.skipIf(!available)('is refused when the app is installed', async () => {
    const checked = validateManifest(manifest(true));
    expect(checked.ok).toBe(false);
    expect(checked.ok ? [] : checked.issues.map((issue) => issue.message)).toContain('"jobs.photo" is personal data, which an email never shows');
    await expect(installInvoicing(dialect, manifest(true))).rejects.toThrow(/422/);
  }, 120_000);
});
