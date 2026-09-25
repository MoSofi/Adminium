// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The documents of an entry reached through its parent, on every engine.
 *
 * A payments entry that says `visibleWith` its invoice carries no claim of its
 * own: a payment is a client's because its INVOICE is. The documents it
 * declares (a receipt) are listed and opened for exactly the rows its own
 * record list returns — its filters, and its parent's whole scope by the
 * EXISTS — and for no other row: not a payment under another client's
 * invoice, even one whose copied `client_id` names her, not one under an
 * invoice her entry does not show, not one outside the payment entry's own
 * filter.
 */
import { documentProfilesRepo, type DocumentProfile } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { renderDocument } from '../src/documents/render.js';
import { installStudio, studioManifest, type StudioHarness } from './app-documents.helpers.js';
import { LEGS } from './invoicing-install.helpers.js';

type Served = Awaited<ReturnType<StudioHarness['serve']>>;
type Doc = { id: string; kind: string };
const ids = (res: { json: () => unknown }) => (res.json() as { data: Doc[] }).data.map((d) => d.id);
const yesNo = (dialect: string) => (dialect === 'postgres' ? ['true', 'false'] : ['1', '0']);

/** The studio, its invoices sent-only, its payments visible with their invoice and not voided. */
function visibleWithManifest(): Record<string, unknown> {
  const manifest = studioManifest();
  const entries = manifest['publicAccess'] as Record<string, unknown>[];
  entries[1] = { ...entries[1], filters: [{ column: 'status', op: 'eq', value: 'sent' }] };
  entries[2] = {
    table: 'payments',
    methods: ['GET'],
    select: ['id', 'amount'],
    visibleWith: { table: 'invoices', via: 'invoice_id' },
    filters: [{ column: 'voided', op: 'eq', value: false }],
    documents: ['receipt'],
  };
  return manifest;
}

describe.each(LEGS)('the documents of an entry visible with its parent, on %s', (dialect, reachable) => {
  let h: StudioHarness;
  let served: Served;
  let profiles: DocumentProfile[];
  const sessions: Record<string, string> = {};
  /** Payment id → the id of its receipt in the register. */
  const receipts: Record<number, string> = {};

  beforeAll(async () => {
    if (!reachable) return;
    h = await installStudio(dialect, visibleWithManifest());
    const t = (ref: string) => h.real(ref);
    const [yes, no] = yesNo(dialect);
    await h.sql(`insert into ${t('clients')} (id, email, name, company) values (1, 'ann@x.test', 'Ann', 'Ann Ltd'), (2, 'ben@x.test', 'Ben', 'Ben Co')`);
    await h.sql(
      `insert into ${t('invoices')} (id, client_id, number, status, issued_on, total, currency) values ` +
        "(8, 1, 'INV-ANN-8', 'sent', '2026-01-16', '10.00', 'EUR'), (7, 2, 'INV-BEN-7', 'sent', '2026-01-15', '99.00', 'EUR'), " +
        "(10, 1, 'INV-ANN-DRAFT', 'draft', '2026-01-17', '20.00', 'EUR')",
    );
    /*
     * 1: Ann's, under her sent invoice. 2: under Ben's invoice, its copied
     * client_id naming Ann. 3: under Ann's draft, which her invoices entry
     * does not show. 4: under her sent invoice, but voided.
     */
    await h.sql(
      `insert into ${t('payments')} (id, invoice_id, client_id, amount, voided, paid_on) values ` +
        `(1, 8, 1, '6', ${no}, '2026-02-01'), (2, 7, 1, '5', ${no}, '2026-02-02'), (3, 10, 1, '4', ${no}, '2026-02-03'), (4, 8, 1, '3', ${yes}, '2026-02-04')`,
    );
    profiles = await documentProfilesRepo(h.meta).listOwnedBy(h.connectionId, 'studio');
    const receipt = profiles.find((p) => p.kind === 'receipt')!;
    for (const id of [1, 2, 3, 4]) {
      const drawn = await renderDocument(h.pipeline, { profileId: receipt.id, pk: { id } });
      if (drawn.status !== 'rendered') throw new Error(`receipt ${String(id)} not drawn`);
      receipts[id] = drawn.document.id;
    }
    served = await h.serve();
    sessions['ann'] = await served.claim('ann@x.test', '198.51.100.1');
    sessions['ben'] = await served.claim('ben@x.test', '198.51.100.2');
  }, 180_000);

  afterAll(async () => {
    if (!reachable) return;
    await served.close();
    await h.close();
  });

  it.skipIf(!reachable)('lists and opens the receipts of exactly the payments her records list shows', async () => {
    // What the entry's own list shows her: the one payment, and the ref it is served on.
    const records = await served.call('GET', '/records/studio_payments_claimed', { session: sessions['ann'] });
    expect(records.statusCode, records.body).toBe(200);
    expect((records.json() as { data: { id: number | string }[] }).data.map((r) => String(r.id))).toEqual(['1']);

    const list = await served.call('GET', '/documents', { session: sessions['ann'] });
    expect(list.statusCode, list.body).toBe(200);
    expect(ids(list)).toEqual([receipts[1]]);
    const one = await served.call('GET', '/documents?ref=studio_payments_claimed&id=1', { session: sessions['ann'] });
    expect(ids(one)).toEqual([receipts[1]]);
    expect((await served.call('GET', `/documents/${receipts[1]!}`, { session: sessions['ann'] })).statusCode).toBe(200);
    const content = await served.call('GET', `/documents/${receipts[1]!}/content`, { session: sessions['ann'] });
    expect(content.statusCode).toBe(200);
    expect((JSON.parse(content.body) as { fields: Record<string, unknown> }).fields['invoiceNumber']).toBe('INV-ANN-8');
  });

  it.skipIf(!reachable)('never lists or opens a receipt of a payment outside what she reads', async () => {
    for (const id of [2, 3, 4]) {
      expect((await served.call('GET', `/documents/${receipts[id]!}`, { session: sessions['ann'] })).statusCode, `payment ${String(id)}`).toBe(404);
      expect((await served.call('GET', `/documents/${receipts[id]!}/content`, { session: sessions['ann'] })).statusCode, `payment ${String(id)}`).toBe(404);
      expect(ids(await served.call('GET', `/documents?ref=studio_payments_claimed&id=${String(id)}`, { session: sessions['ann'] })), `payment ${String(id)}`).toEqual([]);
    }
    // Ben reads the payment under his invoice, and none of Ann's.
    expect(ids(await served.call('GET', '/documents', { session: sessions['ben'] }))).toEqual([receipts[2]]);
    expect((await served.call('GET', `/documents/${receipts[1]!}`, { session: sessions['ben'] })).statusCode).toBe(404);
    // Nobody signed in: nothing.
    expect((await served.call('GET', `/documents/${receipts[1]!}`)).statusCode).toBe(404);
  });

  it.skipIf(!reachable)('draws a receipt of her own payment only', async () => {
    const draw = (id: number) => served.call('POST', '/documents/render', { session: sessions['ann'], payload: { ref: 'studio_payments_claimed', id, kind: 'receipt' } });
    expect([200, 201]).toContain((await draw(1)).statusCode);
    for (const id of [2, 3, 4]) expect((await draw(id)).statusCode, `payment ${String(id)}`).toBe(404);
  });
});
