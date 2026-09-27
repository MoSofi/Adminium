// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A TICKET EMAIL AS IT LEAVES: the outbox's sender queues it, the mail job
 * delivers it, and nodemailer composes the message a mail client receives.
 * The stand-in for opening it in Gmail and Outlook: the parts are
 * `multipart/alternative[text, multipart/related[html, image/png…]]`; every
 * `cid:` the HTML shows has exactly one inline PNG; each PNG reads back, by
 * an independent decoder, as its ticket's code; and a long list stays well
 * under the size a mail client clips at. On every engine.
 */
import { createTransport } from 'nodemailer';
import { documentSequencesRepo, settingsRepo, type MetaDb } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createWriteService } from '../src/crud/write-service.js';
import type { EmailTransport, OutboundEmail } from '../src/email/types.js';
import { registerEmailSendHandler } from '../src/jobs/email-send.js';
import { createJobRegistry } from '../src/jobs/registry.js';
import { JobWorker } from '../src/jobs/worker.js';
import { createOutboxProducers } from '../src/outbox/producers.js';
import { createOutboxSender, type OutboxSender } from '../src/outbox/sender.js';
import { createPublicViews } from '../src/public-api/runtime.js';
import { RealtimeHub } from '../src/realtime/hub.js';
import { TEST_SECRET } from './helpers.js';
import { LEGS, installInvoicing, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';
import { until } from './jobs-helpers.js';
import { eventsManifest, SMTP } from './outbox-rows-fixture.js';
import { readQrPng } from './qr-decode.helpers.js';

interface Part {
  headers: Record<string, string>;
  type: string;
  body: string;
  parts: Part[];
}

/** A raw MIME message as a tree of parts (enough of RFC 2045/2046 to read nodemailer's output). */
function parseMime(raw: string): Part {
  const split = raw.indexOf('\r\n\r\n');
  const head = raw.slice(0, split).replaceAll(/\r\n[ \t]+/g, ' ');
  const body = raw.slice(split + 4);
  const headers: Record<string, string> = {};
  for (const line of head.split('\r\n')) {
    const at = line.indexOf(':');
    if (at > 0) headers[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim();
  }
  const type = (headers['content-type'] ?? 'text/plain').split(';')[0]!.trim().toLowerCase();
  const boundary = /boundary="?([^";]+)"?/i.exec(headers['content-type'] ?? '')?.[1];
  const parts: Part[] = [];
  if (type.startsWith('multipart/') && boundary !== undefined) {
    const chunks = body.split(`--${boundary}`);
    for (const chunk of chunks.slice(1)) {
      if (chunk.startsWith('--')) break;
      parts.push(parseMime(chunk.replace(/^\r\n/, '')));
    }
  }
  return { headers, type, body, parts };
}

/** A transport that composes the message as nodemailer would send it, and keeps the raw bytes. */
function composingTransport(): { raw: string[]; make: () => EmailTransport } {
  const raw: string[] = [];
  return {
    raw,
    make: () => ({
      send: async (msg: OutboundEmail) => {
        const composer = createTransport({ streamTransport: true, buffer: true, newline: 'windows' });
        // The attachment mapping `email/config.ts` hands its SMTP transport.
        const info = await composer.sendMail({
          from: 'Waveform <no-reply@waveform.dev>',
          to: msg.to,
          subject: msg.subject,
          text: msg.text,
          html: msg.html,
          attachments: (msg.attachments ?? []).map((a) => ({
            filename: a.filename,
            content: a.content,
            ...(a.contentType === undefined ? {} : { contentType: a.contentType }),
            ...(a.cid === undefined ? {} : { cid: a.cid, contentDisposition: 'inline' as const }),
          })),
        });
        raw.push((info.message as Buffer).toString('utf8'));
        return {};
      },
    }),
  };
}

describe.each(LEGS)('a ticket email as a mail client receives it — %s', (dialect, available) => {
  let h: InvoicingHarness;
  let meta: MetaDb;
  let sender: OutboxSender;
  const now = Date.parse('2026-10-20T12:00:00Z');
  const transport = composingTransport();

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, eventsManifest());
    meta = h.meta;
    await settingsRepo(meta).set('email.smtp', SMTP as never);
    await meta.db.updateTable('adminium_connections').set({ timezone: 'Europe/London', currency: 'USD' }).where('id', '=', h.connectionId).execute();
    const views = createPublicViews(meta);
    const writes = createWriteService({ sequences: documentSequencesRepo(meta) });
    const producers = createOutboxProducers({ meta, manager: h.manager, viewFor: views.viewFor, writes });
    sender = createOutboxSender({ meta, manager: h.manager, viewFor: views.viewFor, writes, live: () => producers.live(), secret: TEST_SECRET });
    const w = await writerFor(h, 'Europe/London');
    const history = { ...w.desk, origin: 'import' as const };
    await h.rows(`INSERT INTO ${h.real('customers')} (email, name, language) VALUES ('mia@waveform.dev', 'Mia Okada', 'en-US')`);
    await h.rows(`INSERT INTO ${h.real('ticket_types')} (name, price) VALUES ('Standard', 42)`);
    await h.rows(`INSERT INTO ${h.real('orders')} (ref, customer_id) VALUES ('WV-8815', 1), ('WV-9000', 1), ('WV-9050', 1)`);
    const ticket = (order: number, position: number, name: string, code: string) =>
      w.create('tickets', { order_id: order, ticket_type_id: 1, holder_customer_id: 1, holder_name: name, code, position, price: 42, valid_from: '2026-10-31T19:30:00Z' }, history);
    await ticket(1, 1, 'Mia Okada', 'K7QX-M2PD');
    await ticket(1, 2, 'Kai Renner', 'R4FN-7HCW');
    const code = (n: number) => `T${String(n).padStart(3, '0')}-${String(9000 + n)}`;
    for (let n = 1; n <= 10; n += 1) await ticket(2, n, `Guest ${String(n)}`, code(n));
    for (let n = 1; n <= 50; n += 1) await ticket(3, n, `Guest number ${String(n)} with a longer name`, code(100 + n));
    // The mail job, delivering what the sender queues.
    const registry = createJobRegistry();
    registerEmailSendHandler(registry, { meta, secret: TEST_SECRET, createTransport: transport.make });
    const hub = new RealtimeHub();
    const worker = new JobWorker({ meta, registry, hub, workerId: `qr-mime:${dialect}` });
    for (const order of [1, 2, 3]) {
      await h.rows(`INSERT INTO ${h.real('messages')} (kind, status, to_address, customer_id, order_id, language) VALUES ('e1', 'queued', 'mia@waveform.dev', 1, ${String(order)}, 'en-US')`);
    }
    expect(await sender.sendApp('events', now)).toBe(3);
    worker.start();
    try {
      await until(() => transport.raw.length === 3, 30_000);
    } finally {
      await worker.stop();
      hub.close();
    }
  }, 240_000);

  afterAll(async () => {
    if (!available) return;
    await h.close();
  });

  /** The message for an order, by its subject. */
  const received = (ref: string) => parseMime(transport.raw.find((raw) => raw.includes(`Subject: Your tickets for ${ref}`))!);

  it.skipIf(!available)('is text and html alternatives, the html with its QR codes related to it', () => {
    const root = received('WV-8815');
    expect(root.type).toBe('multipart/alternative');
    expect(root.parts.map((part) => part.type)).toEqual(['text/plain', 'multipart/related']);
    const related = root.parts[1]!;
    // The html, the brand's mark, and one image per ticket.
    expect(related.parts.map((part) => part.type)).toEqual(['text/html', 'image/png', 'image/png', 'image/png']);
    expect(related.parts.slice(1).map((part) => part.headers['content-id'])).toEqual(['<mark>', '<qr-1>', '<qr-2>']);
  });

  it.skipIf(!available)("shows every cid once, inline, each reading back as its ticket's code", () => {
    const related = received('WV-8815').parts[1]!;
    const html = Buffer.from(related.parts[0]!.body.replaceAll('\r\n', ''), related.parts[0]!.headers['content-transfer-encoding'] === 'base64' ? 'base64' : 'utf8').toString('utf8');
    const decodedHtml = related.parts[0]!.headers['content-transfer-encoding'] === 'quoted-printable' ? related.parts[0]!.body.replaceAll(/=\r\n/g, '').replaceAll(/=([0-9A-F]{2})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16))) : html;
    const cids = [...decodedHtml.matchAll(/src="cid:(qr-[^"]+)"/g)].map((m) => m[1]);
    expect(cids).toEqual(['qr-1', 'qr-2']);
    const byCid = new Map(related.parts.slice(1).map((part) => [part.headers['content-id'], part]));
    const codes: Record<string, string> = { 'qr-1': 'K7QX-M2PD', 'qr-2': 'R4FN-7HCW' };
    for (const cid of cids) {
      const part = byCid.get(`<${cid!}>`)!;
      expect(part.headers['content-disposition']).toMatch(/^inline/);
      expect(part.headers['content-type']).toMatch(/^image\/png/);
      const png = Buffer.from(part.body.replaceAll('\r\n', ''), 'base64');
      expect(readQrPng(png)).toBe(codes[cid!]);
    }
  });

  it.skipIf(!available)('keeps a ten-ticket email under 60 KB of html, and fifty under the 102 KB a mail client clips at', () => {
    const sizeOf = (ref: string) => {
      const html = received(ref).parts[1]!.parts[0]!;
      const encoding = html.headers['content-transfer-encoding'];
      const text = encoding === 'base64' ? Buffer.from(html.body.replaceAll('\r\n', ''), 'base64').toString('utf8') : html.body.replaceAll(/=\r\n/g, '');
      return Buffer.byteLength(text, 'utf8');
    };
    expect(sizeOf('WV-9000')).toBeLessThan(60 * 1024);
    expect(sizeOf('WV-9050')).toBeLessThan(102 * 1024);
    expect(received('WV-9050').parts[1]!.parts.filter((part) => /^<qr-/.test(part.headers['content-id'] ?? ''))).toHaveLength(50);
  });
});
