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

  it('says when, through a row\'s own link', () => {
    expect(issuesText(sendAgain({ column: 'confirm_token', kind: 'transfer-confirm' }))).toContain("sent again through a row's own link only while the row holds a when (an order still to confirm)");
  });

  it('judges when by columns the entry shows alone', () => {
    const hidden = sendAgain({ column: 'confirm_token', kind: 'transfer-confirm', when: { where: [{ column: 'phone', isNull: false }] } });
    expect(issuesText(hidden)).toContain('"orders.phone" is not a column this entry shows, so a new link is never asked for by it');
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
    expect(issuesText(nowhere)).toContain('"transfer-confirm" is not addressed from a "orders" row');
  });

  it("sends it where the kind's own producer does, from the row alone", () => {
    const withProducer = (producer: Doc) => {
      const m = sendAgain();
      (m['outbox'] as Doc)['producers'] = [{ kind: 'transfer-confirm', link: 'order_id', onChange: { table: 'orders', column: 'status', to: 'placed' }, ...producer }];
      return m;
    };
    // A column of the row itself: sent there.
    expect(messages(withProducer({ recipient: { column: 'email', name: 'name' } }))).toEqual([]);
    // A setting's address, or a column of another row, is no address of the row.
    const bySetting = withProducer({ recipient: { setting: { table: 'settings', column: 'bank_name' } } });
    expect(issuesText(bySetting)).toContain('"transfer-confirm" is not addressed from a "orders" row');
    const elsewhere = withProducer({ link: 'customer_id', recipient: { column: 'email' } });
    expect(issuesText(elsewhere)).toContain('"transfer-confirm" is not addressed from a "orders" row');
  });

  it("keeps the kind's own rules: never past an approval, never a repeat that would skip it", () => {
    const withProducer = (producer: Doc) => {
      const m = sendAgain();
      (m['outbox'] as Doc)['producers'] = [{ kind: 'transfer-confirm', link: 'order_id', onChange: { table: 'orders', column: 'status', to: 'placed' }, ...producer }];
      return m;
    };
    expect(issuesText(withProducer({ hold: true }))).toContain('"transfer-confirm" waits for a person to approve it, so it is never sent again from a link');
    expect(issuesText(withProducer({ repeatBy: 'status' }))).toContain('"transfer-confirm" is sent once per "status", so one sent again for a new "confirm_token" would be skipped');
    expect(messages(withProducer({ repeatBy: 'confirm_token' }))).toEqual([]);
    // Signed in too: a held kind is never sent from a "Make a new link".
    const m = withProducer({ hold: true });
    delete linkEntry(m)['newLink'];
    entryOf(m, 'orders', 'GET')['newLink'] = { column: 'link_token', kind: 'transfer-confirm' };
    expect(issuesText(m)).toContain('"transfer-confirm" waits for a person to approve it');
  });

  it('is refused while a guest can change where it goes', () => {
    // The order's own address, written through its own link.
    const m = sendAgain();
    linkEntry(m)['writable'] = ['note', 'email'];
    expect(issuesText(m)).toContain('"orders.email" is where it is sent again, and an entry lets a guest change it: nothing a guest writes may say where it goes');
    // The person the order links, their address written by the person.
    const n = sendAgain();
    const person = (n['publicAccess'] as Doc[]).find((e) => e['table'] === 'customers')!;
    person['writable'] = ['name', 'email'];
    expect(issuesText(n)).toContain('"customers.email" is where it is sent again');
    // A column of the row the kind's producer mails.
    const o = sendAgain();
    (o['outbox'] as Doc)['producers'] = [{ kind: 'transfer-confirm', link: 'order_id', recipient: { column: 'phone' }, onChange: { table: 'orders', column: 'status', to: 'placed' } }];
    linkEntry(o)['writable'] = ['note', 'phone'];
    expect(issuesText(o)).toContain('"orders.phone" is where it is sent again');
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
