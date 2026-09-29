// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What an app's outbox may say about the language a message is written in —
 * read from the row the message is about (an order placed in German), or
 * from a row's own column beside the address it sends to — about a message
 * sent only while a feature of the app is on, and about the forms a row's
 * number or choice is read in.
 */
import { describe, expect, it } from 'vitest';

import { issuesText, tableOf, venue, type Doc } from './conditioned-moves-fixture.js';

/** The venue with an outbox about orders, each order keeping the language it was placed in. */
function mailing(): Doc {
  const m = venue();
  (tableOf(m, 'orders')['columns'] as Doc[]).push(
    { ref: 'language', type: 'text', maxLength: 16, nullable: true },
    { ref: 'friend_email', type: 'text', maxLength: 254, nullable: true },
    { ref: 'friend_language', type: 'text', maxLength: 16, nullable: true },
    { ref: 'tax_rate', type: 'decimal', scale: 3, nullable: true },
    { ref: 'pickup', type: 'text', maxLength: 5, nullable: true },
  );
  (m['requiredSchema'] as { tables: Doc[] }).tables.push({
    ref: 'messages',
    columns: [
      { ref: 'id', type: 'int', role: 'pk' },
      { ref: 'kind', type: 'enum', enum: ['confirmed', 'receipt', 'gift'] },
      { ref: 'status', type: 'enum', enum: ['queued', 'sent', 'failed', 'skipped'], default: 'queued' },
      { ref: 'to', type: 'text', maxLength: 254, nullable: true },
      { ref: 'language', type: 'text', maxLength: 16, nullable: true },
      { ref: 'order_id', type: 'fk', references: 'orders', nullable: true },
    ],
  });
  m['addOns'] = {
    suggests: [{ key: 'invoices', range: '>=1.0.0', reason: { 'en-US': 'Receipts.' } }],
    features: [{ id: 'receipts', label: { 'en-US': 'Receipts' }, requires: ['invoices'] }],
  };
  m['outbox'] = {
    table: 'messages',
    columns: { kind: 'kind', status: 'status', to: 'to', language: 'language' },
    links: { order: 'order_id' },
    recipient: { via: 'order_id', table: 'orders', email: 'email', language: { column: 'language' } },
    kinds: { confirmed: 'venue-confirmed', receipt: 'venue-receipt', gift: 'venue-gift' },
    producers: [
      { kind: 'confirmed', link: 'order_id', onCreate: { table: 'orders' } },
      { kind: 'receipt', link: 'order_id', gate: { feature: 'receipts' }, onChange: { table: 'orders', column: 'status', to: 'paid' } },
      { kind: 'gift', link: 'order_id', recipient: { column: 'friend_email', language: 'friend_language' }, onChange: { table: 'orders', column: 'status', to: 'paid' } },
    ],
  };
  const template = (kind: string, text: string) => ({ key: `venue-${kind}`, name: kind, locales: { 'en-US': { subject: kind, blocks: [{ block: 'email.text', data: { text } }] } } });
  m['emailTemplates'] = [
    template('confirmed', 'Tax {{order.tax_rate.percent}} ({{order.tax_rate.number}}), {{order.status.label}}, pick up {{order.pickup.time}}'),
    template('receipt', 'Paid.'),
    template('gift', 'A gift.'),
  ];
  return m;
}

const outbox = (m: Doc) => m['outbox'] as Doc;
const producers = (m: Doc) => outbox(m)['producers'] as Doc[];

describe("a message's language, read from the row it is about", () => {
  it("takes the order's own language column, and a gift's beside the address it goes to", () => {
    expect(issuesText(mailing())).toBe('');
  });

  it('refuses a column the row lacks, or one that is not text', () => {
    let m = mailing();
    (outbox(m)['recipient'] as Doc)['language'] = { column: 'nope' };
    expect(issuesText(m)).toContain('"orders" has no column "nope"');
    m = mailing();
    (outbox(m)['recipient'] as Doc)['language'] = { column: 'tax_rate' };
    expect(issuesText(m)).toContain('"orders.tax_rate" must be a text column');
    m = mailing();
    (producers(m)[2]!['recipient'] as Doc)['language'] = 'tax_rate';
    expect(issuesText(m)).toContain('"orders.tax_rate" must be a text column');
  });

  it("needs the outbox's language column to keep it in", () => {
    const m = mailing();
    delete (outbox(m)['columns'] as Doc)['language'];
    expect(issuesText(m)).toContain("a message's language read from the row it is about is kept in the outbox's language column: name it");
    expect(issuesText(m)).toContain("a message's language is kept in the outbox's language column: name it");
  });

  it("still takes the person's own language column, as before", () => {
    const m = mailing();
    (outbox(m)['recipient'] as Doc)['language'] = 'language';
    expect(issuesText(m)).toBe('');
  });
});

describe('a message sent only while a feature is on', () => {
  it("refuses a feature the app does not declare", () => {
    const m = mailing();
    producers(m)[1]!['gate'] = { feature: 'loyalty' };
    expect(issuesText(m)).toContain('"loyalty" is not one of the app\'s addOns.features');
  });

  it('takes a feature and a setting together, each judged as it is alone', () => {
    const m = mailing();
    (tableOf(m, 'settings')['columns'] as Doc[]).push({ ref: 'receipt_on', type: 'bool', default: false });
    producers(m)[1]!['gate'] = { feature: 'receipts', setting: { table: 'settings', column: 'receipt_on' } };
    expect(issuesText(m)).toBe('');
    // The setting must be a bool; the feature one the app declares.
    producers(m)[1]!['gate'] = { feature: 'receipts', setting: { table: 'settings', column: 'refund_days' } };
    expect(issuesText(m)).toContain('"settings.refund_days" must be a bool');
    producers(m)[1]!['gate'] = { feature: 'loyalty', setting: { table: 'settings', column: 'receipt_on' } };
    expect(issuesText(m)).toContain('"loyalty" is not one of the app\'s addOns.features');
    producers(m)[1]!['gate'] = { feature: 'receipts', setting: { table: 'settings', column: 'nope' } };
    expect(issuesText(m)).toContain('"settings" has no column "nope"');
    // A table of many rows is no setting, as for a setting alone.
    producers(m)[1]!['gate'] = { feature: 'receipts', setting: { table: 'orders', column: 'status' } };
    expect(issuesText(m)).toContain('so "orders.status" is no setting');
    // One strict object: nothing else beside the two.
    producers(m)[1]!['gate'] = { feature: 'receipts', setting: { table: 'settings', column: 'receipt_on' }, enabled: true };
    expect(issuesText(m)).not.toBe('');
  });
});

describe("the forms a row's value is read in", () => {
  it('reads a number as a number, a percentage and money, a choice by its label, a time of day kept as text in the clock', () => {
    expect(issuesText(mailing())).toBe('');
  });
});
