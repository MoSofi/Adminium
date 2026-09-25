// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The public document routes against a caller trying to see more than their
 * own, on every engine: two resources on one table that must not cross, a
 * found (unconfirmed) session reaching confirmed-only rows through a
 * statement, one row made into many numbered documents by changing the
 * language, keys a column cannot hold, and the limit on drawing from values.
 */
import { documentProfilesRepo, documentsRepo, manifestsRepo, type DocumentProfile } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { renderDocument } from '../src/documents/render.js';
import { hostileManifest, installStudio, type StudioHarness } from './app-documents.helpers.js';
import { LEGS } from './invoicing-install.helpers.js';

type Served = Awaited<ReturnType<StudioHarness['serve']>>;
type Doc = { id: string; kind: string; number: string | null; locale: string };
const ids = (res: { json: () => unknown }) => (res.json() as { data: Doc[] }).data.map((d) => d.id);
const yesNo = (dialect: string) => (dialect === 'postgres' ? ['true', 'false'] : ['1', '0']);

describe.each(LEGS)('two entries on one table, and a caller who varies what they ask, on %s', (dialect, reachable) => {
  let h: StudioHarness;
  let served: Served;
  let profiles: DocumentProfile[];
  const sessions: Record<string, string> = {};
  const profile = (kind: string) => profiles.find((p) => p.kind === kind)!;

  beforeAll(async () => {
    if (!reachable) return;
    h = await installStudio(dialect, hostileManifest('referrer'));
    const t = (ref: string) => h.real(ref);
    const [, no] = yesNo(dialect);
    await h.sql(`insert into ${t('clients')} (id, email, name, company) values (1, 'ann@x.test', 'Ann', 'Ann Ltd'), (2, 'ben@x.test', 'Ben', 'Ben Co')`);
    // Ben's invoice, which Ann referred; Ann's own invoice.
    await h.sql(
      `insert into ${t('invoices')} (id, client_id, referrer_id, number, status, issued_on, total, currency) values ` +
        "(7, 2, 1, 'INV-BEN-7', 'sent', '2026-01-15', '999.00', 'EUR'), (8, 1, null, 'INV-ANN-8', 'sent', '2026-01-16', '10.00', 'EUR'), " +
        "(9, 1, null, 'INV-ANN-USD-9', 'sent', '2026-01-17', '55.00', 'USD')",
    );
    await h.sql(`insert into ${t('payments')} (id, invoice_id, client_id, amount, voided, paid_on) values (1, 8, 1, '6', ${no}, '2026-02-01'), (2, 9, 1, '5', ${no}, '2026-02-02')`);
    profiles = await documentProfilesRepo(h.meta).listOwnedBy(h.connectionId, 'studio');
    served = await h.serve();
    sessions['ann'] = await served.claim('ann@x.test', '198.51.100.1');
    sessions['ben'] = await served.claim('ben@x.test', '198.51.100.2');
  }, 180_000);

  afterAll(async () => {
    if (!reachable) return;
    await served.close();
    await h.close();
  });

  it.skipIf(!reachable)('never lists or opens another client\'s invoice through an entry that reaches it for another reason', async () => {
    const bens = await renderDocument(h.pipeline, { profileId: profile('invoice').id, pk: { id: 7 } });
    const anns = await renderDocument(h.pipeline, { profileId: profile('invoice').id, pk: { id: 8 } });
    if (bens.status !== 'rendered' || anns.status !== 'rendered') throw new Error('not drawn');

    // Ann reaches invoice 7 as its referrer — an entry that declares statements, not invoices.
    const list = await served.call('GET', '/documents', { session: sessions['ann'] });
    expect(list.statusCode).toBe(200);
    expect(ids(list)).toEqual([anns.document.id]);
    expect((await served.call('GET', `/documents/${bens.document.id}`, { session: sessions['ann'] })).statusCode).toBe(404);
    // Ben lists his own.
    expect(ids(await served.call('GET', '/documents', { session: sessions['ben'] }))).toEqual([bens.document.id]);
  });

  it.skipIf(!reachable)('reads what a statement and a linked slot show only through her own entries\' filters', async () => {
    const res = await served.call('POST', '/documents/render', { session: sessions['ann'], payload: { ref: 'studio_clients_claimed', id: 1, kind: 'statement', period: 'all' } });
    expect(res.statusCode, res.body).toBe(201);
    const content = await served.call('GET', `/documents/${(res.json() as { data: Doc }).data.id}/content`, { session: sessions['ann'] });
    const sheet = JSON.parse(content.body) as { collections: { entries: { number: string; kind: string }[] } };
    // Her euro invoice and both payments; not the dollar invoice her entry does not show.
    expect(sheet.collections.entries.filter((e) => e.kind === 'document').map((e) => e.number)).toEqual(['INV-ANN-8']);
    // A receipt's linked invoice number, likewise: shown for the euro invoice, empty for the other.
    const receipt = async (id: number) => {
      const drawn = await served.call('POST', '/documents/render', { session: sessions['ann'], payload: { ref: 'studio_payments_claimed', id, kind: 'receipt', locale: 'en-US' } });
      const body = await served.call('GET', `/documents/${(drawn.json() as { data: Doc }).data.id}/content`, { session: sessions['ann'] });
      return (JSON.parse(body.body) as { fields: Record<string, unknown> }).fields['invoiceNumber'];
    };
    expect(await receipt(1)).toBe('INV-ANN-8');
    expect(await receipt(2)).toBe('');
  });

  it.skipIf(!reachable)('gives one row one number however many languages it is asked in', async () => {
    const numbers = new Set<string | null>();
    const locales = new Set<string>();
    for (const locale of ['en-US', 'en-GB', 'fr-FR', 'de', 'zz', 'qq-QQ', 'xx', 'FR-fr']) {
      const res = await served.call('POST', '/documents/render', { session: sessions['ann'], payload: { ref: 'studio_payments_claimed', id: 1, kind: 'receipt', locale } });
      expect([200, 201], res.body).toContain(res.statusCode);
      const doc = (res.json() as { data: Doc }).data;
      numbers.add(doc.number);
      locales.add(doc.locale);
    }
    expect(numbers.size).toBe(1);
    // Only languages documents are written in; unknown tags draw the default.
    expect([...locales].sort()).toEqual(['de-DE', 'en-US', 'fr-FR']);
    const register = await documentsRepo(h.meta).list({ profileId: profile('receipt').id });
    // One file per language for this payment, all with its one number.
    expect(register.filter((d) => d.status === 'rendered' && String(d.entity?.pk['id']) === '1')).toHaveLength(3);
  });

  it.skipIf(!reachable)('draws nothing for a client while the add-on is detached from the app', async () => {
    const repo = manifestsRepo(h.meta, { encrypt: (v) => v, decrypt: (v) => v });
    const addOn = (await repo.findByKey('invoices'))!;
    await repo.setAttachmentEnabled(addOn.row.id, 'studio', false);
    try {
      const res = await served.call('POST', '/documents/render', { session: sessions['ann'], payload: { ref: 'studio_invoices_claimed', id: 8, kind: 'invoice', locale: 'da-DK' } });
      expect(res.statusCode).toBe(404);
    } finally {
      await repo.setAttachmentEnabled(addOn.row.id, 'studio', true);
    }
  });

  it.skipIf(!reachable)('answers a key the column cannot hold exactly as an unknown row', async () => {
    const unknownList = await served.call('GET', '/documents?ref=studio_invoices_claimed&id=424242', { session: sessions['ann'] });
    expect(unknownList.statusCode).toBe(200);
    for (const id of ['abc', '1.5', '99999999999999999999', '1e400', '-0x10']) {
      const res = await served.call('GET', `/documents?ref=studio_invoices_claimed&id=${encodeURIComponent(id)}`, { session: sessions['ann'] });
      expect([res.statusCode, res.body], id).toEqual([unknownList.statusCode, unknownList.body]);
    }
    const unknownRender = await served.call('POST', '/documents/render', { session: sessions['ann'], payload: { ref: 'studio_invoices_claimed', id: 424242, kind: 'invoice' } });
    expect(unknownRender.statusCode).toBe(404);
    for (const id of ['abc', '99999999999999999999', '1e400', 1.5]) {
      const res = await served.call('POST', '/documents/render', { session: sessions['ann'], payload: { ref: 'studio_invoices_claimed', id, kind: 'invoice' } });
      expect([res.statusCode, res.body], String(id)).toEqual([404, unknownRender.body]);
    }
  });

  it.skipIf(!reachable)('keeps drawing from values on the write class: twenty a minute from one address', async () => {
    const fresh = await h.serve();
    try {
      const inline = { kind: 'invoice', fields: {}, collections: {} };
      const codes: number[] = [];
      for (let n = 0; n < 21; n += 1) codes.push((await fresh.call('POST', '/documents/render', { payload: inline, ip: '192.0.2.77' })).statusCode);
      // Refused (the door is shut on this key) twenty times, then over the limit.
      expect(codes.slice(0, 20).every((code) => code === 404)).toBe(true);
      expect(codes[20]).toBe(429);
    } finally {
      await fresh.close();
    }
  });
});

describe.each(LEGS)('a found session and rows that ask a confirmed one, on %s', (dialect, reachable) => {
  let h: StudioHarness;
  let served: Served;
  let profiles: DocumentProfile[];
  let cara: string;

  beforeAll(async () => {
    if (!reachable) return;
    h = await installStudio(dialect, hostileManifest('verified'));
    const t = (ref: string) => h.real(ref);
    await h.sql(`insert into ${t('clients')} (id, email, name, company) values (3, 'cara@x.test', 'Cara', 'Cara Makes')`);
    await h.sql(`insert into ${t('invoices')} (id, client_id, number, status, issued_on, total, currency) values (201, 3, 'INV-SECRET-201', 'sent', '2026-03-10', '4321.00', 'EUR')`);
    profiles = await documentProfilesRepo(h.meta).listOwnedBy(h.connectionId, 'studio');
    served = await h.serve();
    cara = await served.claim('cara@x.test', '198.51.100.3');
  }, 180_000);

  afterAll(async () => {
    if (!reachable) return;
    await served.close();
    await h.close();
  });

  it.skipIf(!reachable)('refuses a statement that would list confirmed-only invoices to a found session', async () => {
    // The record read says so first.
    const records = await served.call('GET', '/records/studio_invoices_verified', { session: cara });
    expect(records.statusCode).toBe(403);
    const res = await served.call('POST', '/documents/render', { session: cara, payload: { ref: 'studio_clients_claimed', id: 3, kind: 'statement', period: 'all' } });
    expect(res.statusCode, res.body).toBe(403);
    expect((res.json() as { error: { code: string } }).error.code).toBe('PUBLIC_CLAIM_LEVEL');

    // Nor may one drawn for her by the studio be listed or opened by a found session.
    const drawn = await renderDocument(h.pipeline, { profileId: profiles.find((p) => p.kind === 'statement')!.id, pk: { id: 3 } });
    if (drawn.status !== 'rendered') throw new Error('not drawn');
    expect((await served.call('GET', `/documents/${drawn.document.id}`, { session: cara })).statusCode).toBe(404);
    expect(ids(await served.call('GET', '/documents', { session: cara }))).toEqual([]);
  });
});
