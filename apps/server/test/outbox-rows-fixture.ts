// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A box office, a kitchen and a guest house in one app, for the emails that
 * list rows: an order's tickets with a QR code each, an order's dishes with
 * their options, a stay's extras — and the value forms, the language a
 * message is written in, and a message sent only while a feature is on.
 */
import { encryptSecret } from '../src/config/secrets.js';
import { emailSecretKey } from '../src/email/config.js';
import { TEST_SECRET } from './helpers.js';
import { invoicingManifest } from './invoicing-install.helpers.js';

const id = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength = 120, more: Record<string, unknown> = {}) => ({ ref, type: 'text', maxLength, nullable: true, ...more });
const fk = (ref: string, references: string) => ({ ref, type: 'fk', references, nullable: true });
const money = (ref: string) => ({ ref, type: 'decimal', scale: 2, nullable: true, semantic: 'money' });

export const KINDS = ['e1', 'order', 'stay', 'list', 'leak', 'receipt', 'override', 'link'] as const;

const TICKET_ROWS = {
  link: 'order',
  table: 'tickets',
  via: 'order_id',
  orderBy: 'position',
  unless: 'transferred',
};

function template(kind: string, subject: string, blocks: Record<string, unknown>[], de?: { subject: string; blocks: Record<string, unknown>[] }) {
  return { key: `events-${kind}`, name: kind, locales: { 'en-US': { subject, blocks }, ...(de === undefined ? {} : { 'de-DE': de }) } };
}

export function eventsManifest(): Record<string, unknown> {
  const e1Rows = {
    block: 'email.rows',
    data: {
      from: TICKET_ROWS,
      row: { title: '{{row.holder_name}}', meta: '{{row.ticket_type.name}} · {{row.code}}', note: 'Doors {{row.valid_from.time}}', image: '{{row.code.qr}}' },
    },
  };
  const dishes = (amount: string) => ({
    block: 'email.rows',
    data: {
      from: { link: 'order', table: 'order_items', via: 'order_id', orderBy: 'position' },
      joins: { options: { table: 'order_item_options', via: 'order_item_id', column: 'name', orderBy: 'position' } },
      row: { title: '{{row.name}} × {{row.qty}}', meta: '{{row.options}}', amount },
    },
  });
  return {
    ...invoicingManifest([
      { ref: 'customers', columns: [id, { ref: 'email', type: 'text', maxLength: 254, unique: true }, text('name'), text('language', 16)] },
      { ref: 'ticket_types', columns: [id, text('name', 60), money('price')] },
      {
        ref: 'orders',
        columns: [
          id,
          text('ref', 16),
          fk('customer_id', 'customers'),
          // Wider than the outbox's own language column (16).
          text('language', 40),
          { ref: 'paid_method', type: 'enum', enum: ['card', 'cash'], nullable: true, rules: { enumLabels: { labels: { card: { 'en-US': 'Card', 'de-DE': 'Karte' }, cash: 'Cash' } } } },
          { ref: 'tax_rate', type: 'decimal', scale: 3, nullable: true },
          money('total'),
          text('pickup', 5),
        ],
      },
      {
        ref: 'tickets',
        columns: [
          id,
          fk('order_id', 'orders'),
          fk('ticket_type_id', 'ticket_types'),
          fk('holder_customer_id', 'customers'),
          text('holder_name', 80),
          text('holder_email', 254, { rules: { personal: true } }),
          // A ticket's number: printed to whoever the message goes to.
          text('code', 16, { rules: { code: { length: 8 } } }),
          // The link the holder opens the ticket with: it goes only to them.
          text('link_token', 16, { rules: { code: { length: 16 } } }),
          { ref: 'position', type: 'int', default: 0 },
          money('price'),
          { ref: 'status', type: 'enum', enum: ['valid', 'void'], default: 'valid' },
          { ref: 'transferred', type: 'bool', default: false },
          { ref: 'valid_from', type: 'timestamptz', nullable: true },
        ],
      },
      { ref: 'order_items', columns: [id, fk('order_id', 'orders'), text('name', 80), { ref: 'qty', type: 'int', default: 1 }, money('line_total'), { ref: 'position', type: 'int', default: 0 }] },
      { ref: 'order_item_options', columns: [id, fk('order_item_id', 'order_items'), text('name', 60), { ref: 'position', type: 'int', default: 0 }] },
      { ref: 'stays', columns: [id, fk('customer_id', 'customers'), { ref: 'nights', type: 'int', nullable: true }] },
      { ref: 'stay_extras', columns: [id, fk('stay_id', 'stays'), text('label', 60), money('amount')] },
      {
        ref: 'messages',
        columns: [
          id,
          { ref: 'kind', type: 'enum', enum: [...KINDS] },
          { ref: 'status', type: 'enum', enum: ['queued', 'sent', 'failed', 'skipped'], default: 'queued' },
          text('to_address', 254),
          text('language', 16),
          fk('customer_id', 'customers'),
          fk('order_id', 'orders'),
          fk('stay_id', 'stays'),
          text('error', 200),
          { ref: 'sent_at', type: 'timestamptz', nullable: true },
          text('body_override', 1000),
        ],
      },
    ]),
    key: 'events',
    addOns: {
      suggests: [{ key: 'invoices', range: '>=1.0.0', reason: { 'en-US': 'Receipts.' } }],
      features: [{ id: 'receipts', requires: ['invoices'], label: { 'en-US': 'Receipts' } }],
    },
    outbox: {
      table: 'messages',
      columns: { kind: 'kind', status: 'status', to: 'to_address', language: 'language', error: 'error', sentAt: 'sent_at', bodyOverride: 'body_override' },
      links: { order: 'order_id', stay: 'stay_id' },
      recipient: { via: 'customer_id', table: 'customers', email: 'email', name: 'name', language: { column: 'language' } },
      kinds: Object.fromEntries(KINDS.map((kind) => [kind, `events-${kind}`])),
      producers: [
        { kind: 'receipt', link: 'order_id', gate: { feature: 'receipts' }, onChange: { table: 'orders', column: 'paid_method', to: ['card', 'cash'] } },
        { kind: 'order', link: 'order_id', onCreate: { table: 'orders' } },
      ],
    },
    emailTemplates: [
      template('e1', 'Your tickets for {{order.ref}}', [{ block: 'email.text', data: { text: 'Hi {{recipient.first_name}}' } }, e1Rows]),
      template(
        'order',
        'Order {{order.ref}}',
        [dishes('{{row.line_total}}'), { block: 'email.text', data: { text: 'Tax {{order.tax_rate.percent}} ({{order.tax_rate.number}}), paid by {{order.paid_method.label}}, pick up {{order.pickup.time}}' } }],
        { subject: 'Bestellung {{order.ref}}', blocks: [dishes('{{row.line_total}}'), { block: 'email.text', data: { text: 'Steuer {{order.tax_rate.percent}}, bezahlt mit {{order.paid_method.label}}' } }] },
      ),
      template('stay', 'Your stay', [
        { block: 'email.text', data: { text: '{{stay.nights}} nights' } },
        { block: 'email.rows', data: { from: { link: 'stay', table: 'stay_extras', via: 'stay_id' }, row: { title: '{{row.label}}', amount: '{{row.amount}}' } } },
      ]),
      template('list', 'Valid tickets', [
        {
          block: 'email.rows',
          data: { from: { link: 'order', table: 'tickets', via: 'order_id', orderBy: 'position', where: { column: 'status', in: ['valid'] }, limit: 2 }, row: { title: '{{row.holder_name}}' }, empty: 'No tickets' },
        },
      ]),
      template('leak', 'Holders', [{ block: 'email.rows', data: { from: TICKET_ROWS, row: { title: '{{row.holder_email}}' } } }]),
      template('receipt', 'Receipt {{order.ref}}', [{ block: 'email.text', data: { text: 'Paid.' } }]),
      template('override', 'Tickets', [e1Rows]),
      template('link', 'Your links', [{ block: 'email.rows', data: { from: TICKET_ROWS, row: { title: '{{row.holder_name}}', meta: '{{row.link_token}}', image: '{{row.link_token.qr}}' } } }]),
    ],
    // A ticket's link token opens it: it goes only to its holder.
    publicKeys: { door: {} },
    publicAccess: [{ table: 'tickets', methods: ['GET'], select: ['holder_name'], claim: { by: 'token', column: 'link_token' }, key: 'door' }],
  };
}

/** SMTP settings a send needs to queue anything. */
export const SMTP = {
  host: 'localhost',
  port: 587,
  user: 'postmaster',
  passEncrypted: encryptSecret('hunter2', emailSecretKey(TEST_SECRET)),
  from: 'Waveform <no-reply@waveform.dev>',
  secure: false,
};
