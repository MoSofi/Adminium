// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Documents for an app's own rows, on every engine: the profiles its install
 * makes from the shape its tables are built on, what a printed invoice says,
 * and what a signed-in client may list, open and ask for through the app's
 * own key — and what they may not.
 *
 * Nothing is faked below the route but the add-on that draws: the app is
 * installed through the real installer, its rows are real rows, the key is
 * the one its install made, the session is claimed over HTTP.
 */
import { addOnSettingsRepo, documentProfilesRepo, documentsRepo, documentSequencesRepo, type DocumentProfile } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { installedShapes, makeAppProfiles, planAppProfiles, removeAppProfiles } from '../src/documents/app-profiles.js';
import { renderDocument } from '../src/documents/render.js';
import { installStudio, studioManifest, type StudioHarness } from './app-documents.helpers.js';
import { LEGS } from './invoicing-install.helpers.js';

type Served = Awaited<ReturnType<StudioHarness['serve']>>;
type Doc = { id: string; kind: string; number: string | null };
type Printed = {
  number: string | null;
  currency: string;
  business: Record<string, unknown>;
  fields: Record<string, unknown>;
  collections: Record<string, Record<string, unknown>[]>;
};

const ids = (res: { json: () => unknown }) => (res.json() as { data: Doc[] }).data.map((d) => d.id);

describe.each(LEGS)('documents for an app\'s own rows on %s', (dialect, reachable) => {
  let h: StudioHarness;
  let served: Served;
  let profiles: DocumentProfile[];
  const profile = (kind: string) => profiles.find((p) => p.kind === kind)!;
  const yes = dialect === 'postgres' ? 'true' : '1';
  const no = dialect === 'postgres' ? 'false' : '0';
  const sessions: Record<string, string> = {};

  /** The bytes a client downloads: the stand-in prints the subject it was given. */
  const printed = async (id: string, session: string): Promise<Printed> => {
    const res = await served.call('GET', `/documents/${id}/content`, { session });
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as Printed;
  };

  beforeAll(async () => {
    if (!reachable) return;
    h = await installStudio(dialect);
    const t = (ref: string) => h.real(ref);
    await h.sql(
      `insert into ${t('clients')} (id, email, name, company) values ` +
        "(1, 'ann@x.test', 'Ann', 'Ann Studio Ltd'), (2, 'ben@x.test', 'Ben', 'Ben & Co'), (3, 'cara@x.test', 'Cara', 'Cara Makes'), " +
        "(4, 'dan@x.test', 'Dan', 'Dan Ltd'), (5, 'eve@x.test', 'Eve', 'Eve plc')",
    );
    // Ann: sixty sent invoices. Ben: five, drawn after hers, two in currencies with other decimals.
    const annRows = Array.from({ length: 60 }, (_, i) => `(${String(i + 1)}, 1, 'INV-${String(1001 + i)}', 'sent', '2026-01-15', '100.00', 'EUR')`);
    await h.sql(`insert into ${t('invoices')} (id, client_id, number, status, issued_on, total, currency) values ${annRows.join(', ')}`);
    await h.sql(
      `insert into ${t('invoices')} (id, client_id, number, status, issued_on, total, currency) values ` +
        "(101, 2, 'INV-2101', 'sent', '2026-02-01', '1200', 'JPY'), (102, 2, 'INV-2102', 'sent', '2026-02-01', '1.250', 'KWD'), " +
        "(103, 2, 'INV-2103', 'sent', '2026-02-01', '12.34', 'EUR'), (104, 2, 'INV-2104', 'sent', '2026-02-01', '5', 'EUR'), (105, 2, 'INV-2105', 'sent', '2026-02-01', '6', 'EUR')",
    );
    // Invoice 1's lines, written out of order; invoice 2 has more lines than one page.
    await h.sql(
      `insert into ${t('invoice_lines')} (id, invoice_id, position, description, amount) values ` +
        "(1, 1, 3, 'D', '10'), (2, 1, 1, 'A', '10'), (3, 1, 2, 'B', '10'), (4, 1, 2, 'C', '10')",
    );
    const many = Array.from({ length: 450 }, (_, i) => `(${String(100 + i)}, 2, ${String(450 - i)}, 'L${String(450 - i).padStart(3, '0')}', '1')`);
    await h.sql(`insert into ${t('invoice_lines')} (id, invoice_id, position, description, amount) values ${many.join(', ')}`);
    // Cara's ledger, for her statement.
    await h.sql(
      `insert into ${t('invoices')} (id, client_id, number, status, issued_on, total, currency) values ` +
        "(201, 3, 'INV-3201', 'sent', '2025-03-10', '100', 'EUR'), (202, 3, 'INV-3202', 'sent', '2025-11-01', '50', 'EUR'), " +
        "(203, 3, 'INV-3203', 'sent', '2026-02-01', '200', 'EUR'), (204, 3, 'INV-3204', 'sent', '2026-10-01', '999', 'EUR'), " +
        "(205, 3, 'INV-3205', 'draft', '2026-03-01', '70', 'EUR')",
    );
    await h.sql(
      `insert into ${t('payments')} (id, invoice_id, client_id, amount, voided, paid_on) values ` +
        `(1, 201, 3, '60', ${no}, '2025-04-01'), (2, 203, 3, '80', ${no}, '2026-02-01'), (3, 203, 3, '20', ${yes}, '2026-03-05'), (4, 101, 2, '100', ${no}, '2026-02-02')`,
    );
    await h.sql(`insert into ${t('requests')} (id, client_id, note) values (1, 2, null)`);

    profiles = await documentProfilesRepo(h.meta).listOwnedBy(h.connectionId, 'studio');
    served = await h.serve();
    const ips: Record<string, string> = { ann: '198.51.100.1', ben: '198.51.100.2', cara: '198.51.100.3', dan: '198.51.100.4', eve: '198.51.100.5' };
    for (const [who, ip] of Object.entries(ips)) sessions[who] = await served.claim(`${who}@x.test`, ip);
  }, 120_000);

  afterAll(async () => {
    if (!reachable) return;
    await served.close();
    await h.close();
  });

  it.skipIf(!reachable)('makes one profile per shape profile and app entry, owned by the app, in real names', () => {
    expect(profiles.map((p) => [p.kind, p.table]).sort()).toEqual(
      [
        ['invoice', h.realId('invoices')],
        ['receipt', h.realId('payments')],
        ['statement', h.realId('clients')],
      ].sort(),
    );
    // The app's own slot is added to the shape's, and its name replaces the shape's.
    expect(profile('invoice').name).toBe('Studio invoice');
    expect(profile('invoice').mapping).toMatchObject({
      number: { column: 'number' },
      clientName: { ref: 'client_id', column: 'company', table: h.realId('clients') },
      lines: { collection: { table: h.realId('invoice_lines'), fkColumn: 'invoice_id', orderBy: 'position' } },
    });
    expect(profile('invoice').options).toEqual({ numberColumn: 'number' });
    expect(profile('receipt').mapping).toMatchObject({ invoiceNumber: { ref: 'invoice_id', column: 'number', table: h.realId('invoices') } });
    for (const p of profiles) expect(p.ownerApp).toBe('studio');
  });

  it.skipIf(!reachable)('prints its own number, the client\'s company through client_id, the letterhead, and its lines in order', async () => {
    await addOnSettingsRepo(h.meta).patch(
      'invoices',
      { business_name: 'Studio North', tax_number: 'GB 123', payment_instructions: 'Pay by transfer', footer: '   ' },
      [{ key: 'business_name' }, { key: 'tax_number' }, { key: 'payment_instructions' }, { key: 'footer' }] as never,
    );
    const res = await served.call('POST', '/documents/render', { session: sessions['ann'], payload: { ref: 'studio_invoices_claimed', id: 1, kind: 'invoice' } });
    expect(res.statusCode, res.body).toBe(201);
    const doc = (res.json() as { data: Doc }).data;
    expect(doc.number).toBe('INV-1001');
    const sheet = await printed(doc.id, sessions['ann']!);
    expect(sheet.number).toBe('INV-1001');
    expect(sheet.fields['clientName']).toBe('Ann Studio Ltd');
    expect(sheet.collections['lines']!.map((line) => line['description'])).toEqual(['A', 'B', 'C', 'D']);
    // An empty setting is not sent at all.
    expect(sheet.business).toEqual({ name: 'Studio North', lines: [], taxNumber: 'GB 123', paymentInstructions: 'Pay by transfer' });
    // The row's own number is the document's: the register's counter was never used.
    expect(await documentSequencesRepo(h.meta).peek(profile('invoice').id)).toBe(1);
  });

  it.skipIf(!reachable)('reads every line of a long invoice, in order, in pages', async () => {
    const outcome = await renderDocument(h.pipeline, { profileId: profile('invoice').id, pk: { id: 2 } });
    expect(outcome.status).toBe('rendered');
    const lines = h.drawn.at(-1)!.subject['collections'] as Record<string, Record<string, unknown>[]>;
    expect(lines['lines']!.length).toBe(450);
    expect(lines['lines']!.map((line) => line['description'])).toEqual(Array.from({ length: 450 }, (_, i) => `L${String(i + 1).padStart(3, '0')}`));
  });

  it.skipIf(!reachable)('draws money in the minor units of the row\'s own currency', async () => {
    const totals: Record<number, [string, number]> = { 101: ['JPY', 1200], 102: ['KWD', 1250], 103: ['EUR', 1234] };
    for (const [id, [currency, minor]] of Object.entries(totals)) {
      const res = await served.call('POST', '/documents/render', { session: sessions['ben'], payload: { ref: 'studio_invoices_claimed', id: Number(id), kind: 'invoice' } });
      expect(res.statusCode, res.body).toBe(201);
      const sheet = await printed((res.json() as { data: Doc }).data.id, sessions['ben']!);
      expect([sheet.currency, sheet.fields['total']]).toEqual([currency, minor]);
    }
  });

  it.skipIf(!reachable)('lists all sixty of a client\'s older invoices across pages, and nobody else\'s', async () => {
    for (let id = 1; id <= 60; id += 1) {
      const outcome = await renderDocument(h.pipeline, { profileId: profile('invoice').id, pk: { id }, reuse: true });
      expect(outcome.status).toBe('rendered');
    }
    // Newer documents of another client, which the whole install's "newest 50" would have been full of.
    for (const id of [104, 105]) await renderDocument(h.pipeline, { profileId: profile('invoice').id, pk: { id } });

    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const res = await served.call('GET', `/documents?kind=invoice&limit=25${cursor === undefined ? '' : `&cursor=${cursor}`}`, { session: sessions['ann'] });
      expect(res.statusCode, res.body).toBe(200);
      seen.push(...ids(res));
      cursor = res.headers['x-next-cursor'] as string | undefined;
      pages += 1;
    } while (cursor !== undefined && pages < 10);
    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(60);
    const numbers = await Promise.all(seen.map(async (id) => (await documentsRepo(h.meta).findById(id))!.number));
    expect(new Set(numbers)).toEqual(new Set(Array.from({ length: 60 }, (_, i) => `INV-${String(1001 + i)}`)));

    // One row's documents, by its ref and id.
    const one = await served.call('GET', '/documents?ref=studio_invoices_claimed&id=1', { session: sessions['ann'] });
    expect(ids(one)).toHaveLength(1);
    // Ben sees his own and only his own.
    const ben = await served.call('GET', '/documents', { session: sessions['ben'] });
    const benNumbers = await Promise.all(ids(ben).map(async (id) => (await documentsRepo(h.meta).findById(id))!.number));
    expect(new Set(benNumbers)).toEqual(new Set(['INV-2101', 'INV-2102', 'INV-2103', 'INV-2104', 'INV-2105']));
  });

  it.skipIf(!reachable)('answers another client\'s document id exactly as an unknown one', async () => {
    const annDoc = ids(await served.call('GET', '/documents?ref=studio_invoices_claimed&id=1', { session: sessions['ann'] }))[0]!;
    const theirs = await served.call('GET', `/documents/${annDoc}`, { session: sessions['ben'] });
    const unknown = await served.call('GET', '/documents/doc_00000000000000000000000000', { session: sessions['ben'] });
    expect(theirs.statusCode).toBe(404);
    expect(theirs.body).toBe(unknown.body);
    expect((await served.call('GET', `/documents/${annDoc}/content`, { session: sessions['ben'] })).statusCode).toBe(404);
    // And a render of her row by him is the same 404.
    const render = await served.call('POST', '/documents/render', { session: sessions['ben'], payload: { ref: 'studio_invoices_claimed', id: 1, kind: 'invoice' } });
    expect(render.statusCode).toBe(404);
    // No session: nothing at all.
    expect(ids(await served.call('GET', '/documents'))).toEqual([]);
  });

  it.skipIf(!reachable)('never shows a document of a profile the app did not make, of a kind no entry declares, a failed one, or another key\'s', async () => {
    const register = documentsRepo(h.meta);
    const table = h.realId('invoices')!;
    const drawnFor = async (profileId: string | null, kind: string, entity: { table: string; id: number } | null, opts: { failed?: boolean; claim?: Record<string, string> } = {}) => {
      const row = await register.create({
        profileId,
        addOnKey: 'invoices',
        kind,
        connectionId: h.connectionId,
        entity: entity === null ? null : { connectionId: h.connectionId, table: entity.table, pk: { id: entity.id }, label: String(entity.id) },
        subject: {},
        locale: 'en-US',
        format: 'html',
        ...(opts.claim === undefined ? {} : { claim: opts.claim as never }),
      });
      if (opts.failed !== true) await register.markRendered(row.id, { number: 'N-1', fileId: null, htmlFileId: null, format: 'html' });
      return row.id;
    };
    const seen = async (id: string, who = 'ann') => (await served.call('GET', `/documents/${id}`, { session: sessions[who] })).statusCode;

    // An operator's own profile on the app's table: not the app key's to show.
    const operators = await documentProfilesRepo(h.meta).create({ addOnKey: 'invoices', kind: 'invoice', name: 'Operator invoice', connectionId: h.connectionId, table, mapping: {} });
    expect(await seen(await drawnFor(operators.id, 'invoice', { table, id: 1 }))).toBe(404);

    // The app's profile on a table whose entry declares no documents (Ben's requests).
    const undeclared = await documentProfilesRepo(h.meta).create({ addOnKey: 'invoices', kind: 'invoice', name: 'Request sheet', connectionId: h.connectionId, table: h.realId('requests')!, mapping: {}, ownerApp: 'studio' });
    const request = await drawnFor(undeclared.id, 'invoice', { table: h.realId('requests')!, id: 1 });
    expect(await seen(request, 'ben')).toBe(404);
    expect(ids(await served.call('GET', '/documents', { session: sessions['ben'] }))).not.toContain(request);

    // A failed render of her own invoice.
    expect(await seen(await drawnFor(profile('invoice').id, 'invoice', { table, id: 1 }, { failed: true }))).toBe(404);

    // Drawn from values for her claim: on this key it is hers; on another key, or with no key recorded, it is not.
    const own = await drawnFor(null, 'invoice', null, { claim: { column: 'id', value: '1', keyId: h.keyId } });
    expect(await seen(own)).toBe(200);
    expect(await seen(own, 'ben')).toBe(404);
    expect(await seen(await drawnFor(null, 'invoice', null, { claim: { column: 'id', value: '1', keyId: 'pbk_another' } }))).toBe(404);
    expect(await seen(await drawnFor(null, 'invoice', null, { claim: { column: 'id', value: '1' } }))).toBe(404);

    // A render names a kind its entry declares, and a profile of its own app.
    const receipt = await served.call('POST', '/documents/render', { session: sessions['ann'], payload: { ref: 'studio_invoices_claimed', id: 1, kind: 'receipt' } });
    expect(receipt.statusCode).toBe(404);
    const byOperators = await served.call('POST', '/documents/render', { session: sessions['ann'], payload: { ref: 'studio_invoices_claimed', id: 1, profileId: operators.id } });
    expect(byOperators.statusCode).toBe(404);
    const otherKind = await documentProfilesRepo(h.meta).create({ addOnKey: 'invoices', kind: 'receipt', name: 'Invoice receipt', connectionId: h.connectionId, table, mapping: { amount: { column: 'total' } }, ownerApp: 'studio' });
    const byKind = await served.call('POST', '/documents/render', { session: sessions['ann'], payload: { ref: 'studio_invoices_claimed', id: 1, profileId: otherKind.id } });
    expect(byKind.statusCode).toBe(404);
    await documentProfilesRepo(h.meta).remove(otherKind.id);
    // A cursor this list never gave out.
    expect((await served.call('GET', '/documents?cursor=not-a-cursor', { session: sessions['ann'] })).statusCode).toBe(400);
    await documentProfilesRepo(h.meta).remove(operators.id);
    await documentProfilesRepo(h.meta).remove(undeclared.id);
  });

  it.skipIf(!reachable)('never shows a document drawn on another connection for the same row id', async () => {
    const other = await h.manager.connections.create({ name: 'Another business', engine: 'sqlite', introspectDsn: 'sqlite:/nonexistent/other.db', dataDsn: 'sqlite:/nonexistent/other.db' });
    const table = h.realId('invoices')!;
    const theirs = await documentProfilesRepo(h.meta).create({
      addOnKey: 'invoices',
      kind: 'invoice',
      name: 'Invoice',
      connectionId: other.id,
      table,
      mapping: {},
      ownerApp: 'studio',
    });
    const register = documentsRepo(h.meta);
    const drawn = await register.create({
      profileId: theirs.id,
      addOnKey: 'invoices',
      kind: 'invoice',
      connectionId: other.id,
      entity: { connectionId: other.id, table, pk: { id: 1 }, label: '1' },
      subject: {},
      locale: 'en-US',
      format: 'html',
    });
    await register.markRendered(drawn.id, { number: 'X-1', fileId: null, htmlFileId: null, format: 'html' });

    const res = await served.call('GET', `/documents/${drawn.id}`, { session: sessions['ann'] });
    expect(res.statusCode).toBe(404);
    expect(ids(await served.call('GET', '/documents?ref=studio_invoices_claimed&id=1', { session: sessions['ann'] }))).not.toContain(drawn.id);
    // Nor may that connection's profile draw through this key.
    const render = await served.call('POST', '/documents/render', { session: sessions['ann'], payload: { ref: 'studio_invoices_claimed', id: 1, profileId: theirs.id } });
    expect(render.statusCode).toBe(404);
  });

  it.skipIf(!reachable)('reuses the file while the row is unchanged, and draws again when it changes', async () => {
    const ask = () => served.call('POST', '/documents/render', { session: sessions['ann'], payload: { ref: 'studio_invoices_claimed', id: 3, kind: 'invoice' } });
    // Changed since the list above drew it: a new document.
    await h.sql(`update ${h.real('invoices')} set total = '120.00' where id = 3`);
    const first = await ask();
    expect(first.statusCode, first.body).toBe(201);
    const again = await ask();
    expect(again.statusCode).toBe(200);
    expect((again.json() as { data: Doc }).data.id).toBe((first.json() as { data: Doc }).data.id);

    await h.sql(`update ${h.real('invoices')} set total = '150.00' where id = 3`);
    const changed = await ask();
    expect(changed.statusCode).toBe(201);
    expect((changed.json() as { data: Doc }).data.id).not.toBe((first.json() as { data: Doc }).data.id);
    // The list shows the row once: its latest document.
    expect(ids(await served.call('GET', '/documents?ref=studio_invoices_claimed&id=3', { session: sessions['ann'] }))).toEqual([(changed.json() as { data: Doc }).data.id]);
  });

  it.skipIf(!reachable)('reads a statement\'s opening balance and running balance for a period', async () => {
    const statement = async (period: string) => {
      const res = await served.call('POST', '/documents/render', { session: sessions['cara'], payload: { ref: 'studio_clients_claimed', id: 3, kind: 'statement', period } });
      expect(res.statusCode, res.body).toBe(201);
      return await printed((res.json() as { data: Doc }).data.id, sessions['cara']!);
    };
    const year = await statement('year');
    expect(year.fields).toMatchObject({
      clientName: 'Cara Makes',
      periodFrom: '2026-01-01',
      periodTo: '2026-09-25',
      openingBalance: 9000,
      documentsTotal: 20000,
      paymentsTotal: 8000,
      closingBalance: 21000,
    });
    expect(year.collections['entries']).toEqual([
      { date: '2026-02-01', kind: 'document', number: 'INV-3203', amount: 20000, balance: 29000 },
      { date: '2026-02-01', kind: 'payment', number: '', amount: 8000, balance: 21000 },
    ]);
    const twelve = await statement('12m');
    expect(twelve.fields).toMatchObject({ periodFrom: '2025-09-26', openingBalance: 4000, closingBalance: 21000 });
    expect(twelve.collections['entries']!.map((e) => e['balance'])).toEqual([9000, 29000, 21000]);
    const all = await statement('all');
    expect(all.fields).toMatchObject({ openingBalance: 0, closingBalance: 21000 });
    // Everything has no first day: the slot is not sent at all.
    expect(all.fields['periodFrom']).toBeUndefined();
    expect(all.collections['entries']!.map((e) => [e['kind'], e['balance']])).toEqual([
      ['document', 10000],
      ['payment', 4000],
      ['document', 9000],
      ['document', 29000],
      ['payment', 21000],
    ]);
    // A period is one of three words; a date is refused before anything runs.
    const free = await served.call('POST', '/documents/render', { session: sessions['cara'], payload: { ref: 'studio_clients_claimed', id: 3, kind: 'statement', period: '2020-01-01' } });
    expect(free.statusCode).toBe(400);
  });

  it.skipIf(!reachable)('lets twenty statement renders a minute from each of three clients leave another client\'s accept unthrottled', async () => {
    const fresh = await h.serve();
    try {
      const ipOf: Record<string, string> = { cara: '198.51.100.3', dan: '198.51.100.4', eve: '198.51.100.5' };
      for (const who of ['cara', 'dan', 'eve']) {
        for (let n = 0; n < 20; n += 1) {
          const id = { cara: 3, dan: 4, eve: 5 }[who]!;
          const res = await fresh.call('POST', '/documents/render', { session: sessions[who], ip: ipOf[who], payload: { ref: 'studio_clients_claimed', id, kind: 'statement', period: 'year' } });
          expect([200, 201], res.body).toContain(res.statusCode);
        }
      }
      const accept = await fresh.call('PATCH', '/records/studio_requests_claimed/1', { session: sessions['ben'], ip: '198.51.100.2', payload: { values: { note: 'Approved' } } });
      expect(accept.statusCode, accept.body).toBe(200);
      // A render has a limit of its own, per client.
      for (let n = 0; n < 10; n += 1) {
        await fresh.call('POST', '/documents/render', { session: sessions['cara'], ip: ipOf['cara'], payload: { ref: 'studio_clients_claimed', id: 3, kind: 'statement', period: 'year' } });
      }
      const over = await fresh.call('POST', '/documents/render', { session: sessions['cara'], ip: ipOf['cara'], payload: { ref: 'studio_clients_claimed', id: 3, kind: 'statement', period: 'year' } });
      expect(over.statusCode).toBe(429);
    } finally {
      await fresh.close();
    }
  });

  it.skipIf(!reachable)('is idempotent on update, removes what a version drops, and skips what it cannot make', async () => {
    const base = studioManifest() as never;
    const shapes = await installedShapes(h.meta);
    const again = await makeAppProfiles({ meta: h.meta, manifest: base, connectionId: h.connectionId, realId: h.realId, shapes });
    expect(again.made).toEqual([]);
    expect(again.updated.map((u) => u.id).sort()).toEqual(profiles.map((p) => p.id).sort());

    /*
     * An operator's profile of the same name (made while the app's was gone)
     * is never overwritten or taken: the app's is skipped, with the reason.
     */
    await documentProfilesRepo(h.meta).remove(profile('invoice').id);
    const same = await documentProfilesRepo(h.meta).create({ addOnKey: 'invoices', kind: 'invoice', name: 'Studio invoice', connectionId: h.connectionId, table: h.realId('invoices')!, mapping: { total: { column: 'total' } } });
    const clash = await makeAppProfiles({ meta: h.meta, manifest: base, connectionId: h.connectionId, realId: h.realId, shapes });
    expect(clash.skipped).toEqual([{ kind: 'invoice', table: 'invoices', reason: 'a profile named "Studio invoice" that is not the app\'s already draws this document' }]);
    expect(clash.made).toEqual([]);
    expect((await documentProfilesRepo(h.meta).findById(same.id))!.mapping).toEqual({ total: { column: 'total' } });
    await documentProfilesRepo(h.meta).remove(same.id);
    expect((await makeAppProfiles({ meta: h.meta, manifest: base, connectionId: h.connectionId, realId: h.realId, shapes })).made.map((m) => m.kind)).toEqual(['invoice']);

    const dropped = { ...(studioManifest() as Record<string, unknown>) };
    dropped['documents'] = (dropped['documents'] as { kind: string }[]).filter((d) => d.kind !== 'statement');
    const less = await makeAppProfiles({ meta: h.meta, manifest: dropped as never, connectionId: h.connectionId, realId: h.realId, shapes });
    expect(less.removed).toEqual([profile('statement').id]);

    // Without the add-on, nothing is made half: every profile is skipped with its reason.
    const none = planAppProfiles(base, { byKey: new Map(), addOns: new Set() });
    expect(none.planned).toEqual([]);
    expect(none.skipped.map((s) => s.reason)).toContain('the "invoices" add-on is not installed, so the documents of "invoices/invoice@1" are not made');
  });

  it.skipIf(!reachable)('removes the app\'s profiles at uninstall and keeps an operator\'s own', async () => {
    const operators = await documentProfilesRepo(h.meta).create({
      addOnKey: 'invoices',
      kind: 'invoice',
      name: 'Our own invoice',
      connectionId: h.connectionId,
      table: h.realId('invoices')!,
      mapping: { number: { column: 'number' } },
    });
    const removed = await removeAppProfiles(h.meta, h.connectionId, 'studio');
    expect(removed).toBeGreaterThan(0);
    const left = await documentProfilesRepo(h.meta).list({ connectionId: h.connectionId });
    expect(left.map((p) => p.id)).toEqual([operators.id]);
  });
});
