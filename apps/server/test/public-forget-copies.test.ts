// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `forget.copies`: "delete my details" also blanks the person's copies on the
 * rows linked to them, on every engine, as the person themselves.
 *
 *  - their linked rows lose the declared copies, in one transaction with their
 *    own row, and nothing else on the row moves;
 *  - a row that holds the same typed address with no link, and another
 *    customer's row, stay as they are;
 *  - a table the law keeps stays whole;
 *  - no rule, mail or hook runs for the rows blanked;
 *  - an app without the word behaves as before.
 */
import { validateManifest } from '@adminium/manifest';
import { auditRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { loadSnapshotView } from '../src/data-io/snapshot-view.js';

import { installInvoicing, LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';
import { guest, mailReady, shopManifest } from './person-fixture.js';
import { servePublic } from './public-lane.helpers.js';

type Doc = Record<string, unknown>;

function shop(word: boolean): Doc {
  const manifest = shopManifest({
    entries: (entries) =>
      entries.map((entry) => (entry['table'] === 'customers' && entry['forget'] !== undefined ? { ...entry, forget: { columns: ['email', 'name', 'phone'], stamp: 'forgotten_at', ...(word ? { copies: true } : {}) } } : entry)),
  });
  const tables = (manifest['requiredSchema'] as { tables: Doc[] }).tables;
  tables.push({
    ref: 'receipts',
    keep: { law: 'tax' },
    columns: [
      { ref: 'id', type: 'int', role: 'pk' },
      { ref: 'customer_id', type: 'fk', references: 'customers', nullable: true },
      { ref: 'buyer_email', type: 'text', maxLength: 254, nullable: true },
      { ref: 'buyer_phone', type: 'text', maxLength: 32, nullable: true },
    ],
  });
  (manifest['compatibility'] as Doc)['minAdminiumVersion'] = word ? '0.3.74' : '0.3.71';
  (manifest['outbox'] as Doc)['classes'] = { 'order-placed': 'service' };
  manifest['people'] = [
    {
      table: 'customers',
      kind: 'people',
      email: 'email',
      name: 'name',
      copies: [
        { table: 'orders', column: 'email', holds: 'email', via: 'customer_id' },
        { table: 'orders', column: 'name', holds: 'name', via: 'customer_id' },
        { table: 'orders', column: 'note', holds: 'details', via: 'customer_id' },
        { table: 'receipts', column: 'buyer_email', holds: 'email', via: 'customer_id' },
        ...(word ? [{ table: 'receipts', column: 'buyer_phone', holds: 'details', via: 'customer_id', evenIfKept: true }] : []),
      ],
    },
  ];
  return manifest;
}

describe('the word', () => {
  it('is taken where a copy is kept through a link', () => {
    const checked = validateManifest(shop(true));
    expect(checked.ok, JSON.stringify(checked).slice(0, 600)).toBe(true);
  });

  it('is refused where no copy is kept through a link', () => {
    const manifest = shop(true);
    manifest['people'] = [{ table: 'customers', kind: 'people', email: 'email', name: 'name', copies: [{ table: 'orders', column: 'email', holds: 'email' }] }];
    const checked = validateManifest(manifest);
    expect(checked.ok).toBe(false);
    expect(JSON.stringify(checked)).toContain('forget');
  });

  it('needs the release that reads it', () => {
    const manifest = shop(true);
    (manifest['compatibility'] as Doc)['minAdminiumVersion'] = '0.3.70';
    const checked = validateManifest(manifest);
    expect(checked.ok).toBe(false);
    expect(JSON.stringify(checked)).toContain('publicAccess.forget.copies');
  });
});

describe.each(LEGS)('"delete my details" with its copies — %s', (dialect, available) => {
  const stand = async (word: boolean) => {
    const h = await installInvoicing(dialect, shop(word));
    await mailReady(h.meta);
    const keys = (h.reply['publicAccess'] as { keys: Record<string, string> }).keys;
    const customer = await servePublic(h, keys['customer']!);
    return { h, customer, g: guest(customer, h) };
  };
  let on: Awaited<ReturnType<typeof stand>>;
  let off: Awaited<ReturnType<typeof stand>>;
  const ids = {} as Record<string, number>;

  const order = async (s: { h: InvoicingHarness; g: ReturnType<typeof guest> }, email: string, name: string, note: string) => {
    const res = await s.g.request('POST', `/records/${s.h.real('orders')}_verified_2`, { payload: { values: { email, name, note }, children: { order_items: [{ values: { dish: 'Soup', qty: 1 } }] } }, proof: 'write' });
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { data: { id: number } }).data.id;
  };
  const orderRow = async (s: { h: InvoicingHarness }, id: number) => (await s.h.rows(`select * from ${s.h.real('orders')} where id = ${String(id)}`))[0]!;

  beforeAll(async () => {
    if (!available) return;
    on = await stand(true);
    off = await stand(false);
    ids['mine'] = await order(on, 'lea@fieldmail.io', 'Lea Stone', 'Nut allergy');
    ids['other'] = await order(on, 'max@fieldmail.io', 'Max Bell', 'Window seat');
    const [lea] = await on.h.rows(`select id from ${on.h.real('customers')} where email = 'lea@fieldmail.io'`);
    ids['lea'] = Number(lea!['id']);
    // Her address, typed on a row with no link to her.
    await on.h.rows(`insert into ${on.h.real('orders')} (email, name, note, status) values ('lea@fieldmail.io', 'Someone Else', 'Not hers', 'placed')`);
    const [unlinked] = await on.h.rows(`select id from ${on.h.real('orders')} where name = 'Someone Else'`);
    ids['unlinked'] = Number(unlinked!['id']);
    await on.h.rows(`insert into ${on.h.real('receipts')} (customer_id, buyer_email, buyer_phone) values (${String(ids['lea'])}, 'lea@fieldmail.io', '+49 30 1234567')`);
    const session = await on.g.signIn('lea@fieldmail.io');
    const gone = await on.g.request('DELETE', '/account', { session });
    expect(gone.statusCode, gone.body).toBe(200);
    // Sent again, with the session it ended: refused, and nothing further changes.
    const before = await orderRow(on, ids['mine']!);
    const again = await on.g.request('DELETE', '/account', { session });
    expect(again.statusCode, again.body).toBeGreaterThanOrEqual(400);
    expect(await orderRow(on, ids['mine']!)).toEqual(before);
  }, 240_000);

  afterAll(async () => {
    if (!available) return;
    await on.customer.close();
    await on.h.close();
    await off.customer.close();
    await off.h.close();
  });

  it.skipIf(!available)('blanks their linked row, and leaves its link, state and the rest', async () => {
    const row = await orderRow(on, ids['mine']!);
    expect(row['email']).not.toBe('lea@fieldmail.io');
    expect(row['name']).not.toBe('Lea Stone');
    expect(row['note']).toBeNull();
    expect(Number(row['customer_id'])).toBe(ids['lea']);
    expect(row['status']).toBe('placed');
    expect(Number(row['item_count'])).toBe(1);
  });

  it.skipIf(!available)("leaves another customer's row", async () => {
    const row = await orderRow(on, ids['other']!);
    expect([row['email'], row['name'], row['note']]).toEqual(['max@fieldmail.io', 'Max Bell', 'Window seat']);
  });

  it.skipIf(!available)('leaves a row that only holds the same typed address', async () => {
    const row = await orderRow(on, ids['unlinked']!);
    expect([row['email'], row['name'], row['note']]).toEqual(['lea@fieldmail.io', 'Someone Else', 'Not hers']);
  });

  it.skipIf(!available)('leaves a table the law keeps, but for a detail the record does not need', async () => {
    const [row] = await on.h.rows(`select buyer_email, buyer_phone from ${on.h.real('receipts')} where customer_id = ${String(ids['lea'])}`);
    expect(row!['buyer_email']).toBe('lea@fieldmail.io');
    expect(row!['buyer_phone']).toBeNull();
  });

  it.skipIf(!available)('empties their own row as before', async () => {
    const [row] = await on.h.rows(`select email, name, forgotten_at from ${on.h.real('customers')} where id = ${String(ids['lea'])}`);
    expect([row!['email'], row!['name']]).toEqual([null, null]);
    expect(row!['forgotten_at']).not.toBeNull();
  });

  it.skipIf(!available)('tells the calendar sync which rows lost a name, so a staff calendar loses it too', async () => {
    const id = await order(on, 'zoe@fieldmail.io', 'Zoe Hart', 'Corner table');
    const session = await on.g.signIn('zoe@fieldmail.io');
    const told = vi.spyOn(on.customer.composed.calendarSync, 'onErased');
    try {
      const gone = await on.g.request('DELETE', '/account', { session });
      expect(gone.statusCode, gone.body).toBe(200);
      expect(told).toHaveBeenCalledTimes(1);
      expect(told.mock.calls[0]![0].rows.some((row) => row.key === String(id))).toBe(true);
    } finally {
      told.mockRestore();
    }
  });

  it.skipIf(!available)('takes their words out of the audit log and the removed-row history', async () => {
    const id = await order(on, 'yan@fieldmail.io', 'Yan Cole', 'Peanut allergy');
    const orders = (await loadSnapshotView(on.h.meta, on.h.connectionId)).model.tables.find((table) => table.name === on.h.real('orders'))!.id;
    const entity = { connectionId: on.h.connectionId, table: orders, pk: { id }, label: String(id) };
    await auditRepo(on.h.meta).append({ actorKind: 'user', actorId: null, actorLabel: 'The desk', category: 'data', action: 'data.update', entity, changes: { before: { name: 'Yan Cole', note: 'Peanut allergy' }, after: { note: 'Peanut allergy, severe' } } });
    await on.h.meta.db
      .insertInto('adminium_removed_rows')
      .values({ id: `rmv_${String(id)}`, connectionId: on.h.connectionId, entityTable: orders, entityId: String(id), pk: JSON.stringify({ id }), via: '', parentTable: '', parentValue: '', removedAt: Date.now(), actorKind: 'user', actorId: null, actorLabel: 'The desk', reason: null, image: JSON.stringify({ id, name: 'Yan Cole', note: 'Peanut allergy' }) })
      .execute();
    const session = await on.g.signIn('yan@fieldmail.io');
    const gone = await on.g.request('DELETE', '/account', { session });
    expect(gone.statusCode, gone.body).toBe(200);
    const logged = await on.h.meta.db.selectFrom('adminium_audit_log').select('changes').where('action', '=', 'data.update').where('entityId', '=', String(id)).execute();
    expect(logged).toHaveLength(1);
    expect(JSON.stringify(logged[0]!.changes)).not.toMatch(/Yan Cole|Peanut/);
    const kept = await on.h.meta.db.selectFrom('adminium_removed_rows').select('image').where('id', '=', `rmv_${String(id)}`).executeTakeFirstOrThrow();
    expect(JSON.stringify(kept.image)).not.toMatch(/Yan Cole|Peanut/);
  });

  it.skipIf(!available)('without the word, the rows linked to them stay as they were', async () => {
    const id = await order(off, 'nia@fieldmail.io', 'Nia Holt', 'Quiet table');
    const session = await off.g.signIn('nia@fieldmail.io');
    const gone = await off.g.request('DELETE', '/account', { session });
    expect(gone.statusCode, gone.body).toBe(200);
    const row = await orderRow(off, id);
    expect([row['email'], row['name'], row['note']]).toEqual(['nia@fieldmail.io', 'Nia Holt', 'Quiet table']);
  });
});
