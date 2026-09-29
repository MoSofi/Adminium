// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Send it again" through a row's own link: `newLink` on an own-link entry
 * makes another link of the row again (the one a confirmation email carries)
 * and mails it to the row's own address, only while the row holds `when`.
 * Each rule broken once on a manifest that otherwise validates, and read back
 * as the sentence it gives.
 */
import { describe, expect, it } from 'vitest';

import { validateManifest } from '../src/index.js';
import { entryOf, issuesText, kitchen, messages, type Doc } from './orders-stays-fixture.js';

const confirmToken = { ref: 'confirm_token', type: 'text', maxLength: 16, nullable: true, rules: { code: { length: 16 } } };

/** The kitchen with a confirm code opened by its own key, an outbox to mail it, and "send it again" on the order's own link. */
function sendAgain(newLink: Doc = { column: 'confirm_token', kind: 'transfer-confirm', when: { where: [{ column: 'status', eq: 'placed' }] } }): Doc {
  const m = kitchen();
  const tables = (m['requiredSchema'] as { tables: Doc[] }).tables;
  (tables.find((t) => t['ref'] === 'orders')!['columns'] as Doc[]).push(confirmToken);
  tables.push({
    ref: 'messages',
    columns: [
      { ref: 'id', type: 'int', role: 'pk' },
      { ref: 'kind', type: 'enum', enum: ['transfer-confirm'] },
      { ref: 'status', type: 'enum', enum: ['queued', 'sent', 'failed', 'skipped'], default: 'queued' },
      { ref: 'to', type: 'text', maxLength: 254, nullable: true },
      { ref: 'repeat_key', type: 'text', maxLength: 64, nullable: true },
      { ref: 'customer_id', type: 'fk', references: 'customers', nullable: true },
      { ref: 'order_id', type: 'fk', references: 'orders', nullable: true },
    ],
  });
  m['outbox'] = {
    table: 'messages',
    columns: { kind: 'kind', status: 'status', to: 'to', repeatKey: 'repeat_key' },
    links: { customer: 'customer_id', order: 'order_id' },
    recipient: { via: 'customer_id', table: 'customers', email: 'email', fallback: { via: 'order_id', email: 'email' } },
    kinds: { 'transfer-confirm': 'kitchen-transfer-confirm' },
  };
  m['emailTemplates'] = [
    { key: 'kitchen-transfer-confirm', name: 'Confirm', locales: { 'en-US': { subject: 'Confirm', blocks: [{ block: 'email.text', data: { text: '{{manage_url}}#{{order.confirm_token}}' } }] } } },
  ];
  m['publicKeys'] = { link: {}, confirm: {} };
  (m['publicAccess'] as Doc[]).push({
    table: 'orders',
    key: 'confirm',
    methods: ['GET'],
    select: ['id', 'status'],
    claim: { by: 'token', column: 'confirm_token', own: true },
  });
  linkEntry(m)['newLink'] = newLink;
  return m;
}

const linkEntry = (m: Doc): Doc => (m['publicAccess'] as Doc[]).find((e) => e['table'] === 'orders' && e['key'] === 'link')!;

describe('"send it again" through a row\'s own link', () => {
  it('validates, and keeps its when', () => {
    const m = sendAgain();
    expect(messages(m)).toEqual([]);
    const result = validateManifest(m);
    if (!result.ok || result.manifest.kind !== 'app') throw new Error('invalid');
    const kept = result.manifest.publicAccess!.find((e) => e.table === 'orders' && e.key === 'link')!.newLink;
    expect(kept).toEqual({ column: 'confirm_token', kind: 'transfer-confirm', when: { where: [{ column: 'status', eq: 'placed' }] } });
  });

  it('validates with no when', () => {
    expect(messages(sendAgain({ column: 'confirm_token', kind: 'transfer-confirm' }))).toEqual([]);
  });

  it('never renews the code the asking link opens its row by', () => {
    expect(issuesText(sendAgain({ column: 'link_token', kind: 'transfer-confirm' }))).toContain(
      '"orders.link_token" is the code this link opens the row by: the session asking would be closed by its own new link',
    );
  });

  it('renews only an own link another key opens the row by', () => {
    // A column no key opens anything by.
    expect(issuesText(sendAgain({ column: 'note', kind: 'transfer-confirm' }))).toContain('"orders.note" is no own link another key opens "orders" by (a token claim with own: true)');
    // A link another key opens, but not as the row's own.
    const shared = sendAgain();
    const confirm = (shared['publicAccess'] as Doc[]).find((e) => e['key'] === 'confirm')!;
    confirm['claim'] = { by: 'token', column: 'confirm_token' };
    expect(issuesText(shared)).toContain('"orders.confirm_token" is no own link another key opens "orders" by (a token claim with own: true)');
  });

  it('names a kind the outbox has, an outbox that keeps a repeat key, and one that finds an address from the row', () => {
    expect(issuesText(sendAgain({ column: 'confirm_token', kind: 'nope' }))).toContain('"nope" is not one of the outbox\'s kinds');
    const noRepeat = sendAgain();
    delete ((noRepeat['outbox'] as Doc)['columns'] as Doc)['repeatKey'];
    expect(issuesText(noRepeat)).toContain('each new link is its own message, so the outbox keeps a repeatKey column');
    // An outbox that writes to a table the order never points at, with no fallback through the order.
    const nowhere = sendAgain();
    const tables = (nowhere['requiredSchema'] as { tables: Doc[] }).tables;
    tables.push({ ref: 'staff', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'email', type: 'text', maxLength: 254, nullable: true }] });
    (tables.find((t) => t['ref'] === 'messages')!['columns'] as Doc[]).push({ ref: 'staff_id', type: 'fk', references: 'staff', nullable: true });
    const box = nowhere['outbox'] as Doc;
    box['links'] = { ...(box['links'] as Doc), staff: 'staff_id' };
    box['recipient'] = { via: 'staff_id', table: 'staff', email: 'email' };
    expect(issuesText(nowhere)).toContain('the outbox finds no address from a "orders" row (no link to "staff", no fallback through "orders")');
  });

  it('judges its when as any condition on the row', () => {
    expect(issuesText(sendAgain({ column: 'confirm_token', kind: 'transfer-confirm', when: { where: [{ column: 'nope', eq: 'placed' }] } }))).toContain('"orders" has no column "nope"');
    expect(issuesText(sendAgain({ column: 'confirm_token', kind: 'transfer-confirm', when: { where: [{ column: 'status', eq: 'lost' }] } }))).toContain('"lost" is not a value of "orders.status"');
    expect(issuesText(sendAgain({ column: 'confirm_token', kind: 'transfer-confirm', when: { where: [] } }))).toContain('newLink');
    expect(issuesText(sendAgain({ column: 'confirm_token', kind: 'transfer-confirm', when: {} }))).toContain('newLink');
  });

  it('is refused on an entry that is neither a signed-in person\'s rows nor a row\'s own link', () => {
    const m = sendAgain();
    delete linkEntry(m)['newLink'];
    entryOf(m, 'orders', 'POST')['newLink'] = { column: 'confirm_token', kind: 'transfer-confirm' };
    expect(issuesText(m)).toContain('a new link is made for a row a person reads signed in by email (claimedBy), or through a row\'s own link, and nowhere else');
  });

  it('may carry a when on a signed-in person\'s rows too', () => {
    const m = sendAgain();
    delete linkEntry(m)['newLink'];
    entryOf(m, 'orders', 'GET')['newLink'] = { column: 'link_token', kind: 'transfer-confirm', when: { where: [{ column: 'status', in: ['placed', 'ready'] }] } };
    expect(messages(m)).toEqual([]);
  });
});
