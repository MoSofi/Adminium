// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A document of a row whose lines can change hands draws each line as the
 * reader it is drawn for may read it: a line another client now holds is
 * printed without the columns kept for its holder — through a guest's own
 * render, and through a document the profile emails out (drawn for nobody).
 * A document drawn for one reader is that reader's: the desk's (drawn with
 * everything) and another reader's are never listed to, or opened by, a
 * guest; one drawn for nobody is anyone's who reaches its row.
 */
import { documentProfilesRepo, documentsRepo, type DocumentProfile } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { renderDocument } from '../src/documents/render.js';
import { LEGS } from './invoicing-install.helpers.js';
import { installStudio, studioManifest, type StudioHarness } from './app-documents.helpers.js';

type Served = Awaited<ReturnType<StudioHarness['serve']>>;
type Printed = { collections: Record<string, Record<string, unknown>[]> };

/** The studio, with lines another client may hold: their description is theirs alone. */
function heldLines(): Record<string, unknown> {
  const manifest = studioManifest();
  const tables = (manifest['requiredSchema'] as { tables: Record<string, unknown>[] }).tables;
  (tables.find((table) => table['ref'] === 'invoice_lines')!['columns'] as Record<string, unknown>[]).push({ ref: 'holder_id', type: 'fk', references: 'clients', nullable: true });
  (manifest['publicAccess'] as Record<string, unknown>[]).push({
    table: 'invoice_lines',
    methods: ['GET'],
    select: ['id', 'description', 'amount'],
    visibleWith: { table: 'invoices', via: 'invoice_id' },
    withhold: { columns: ['description'], unlessHolder: 'holder_id' },
  });
  return manifest;
}

describe.each(LEGS)('a document draws a line someone else holds without what is theirs — %s', (dialect, reachable) => {
  let h: StudioHarness;
  let served: Served;
  let invoice: DocumentProfile;
  const sessions: Record<string, string> = {};
  const lines = (sheet: Printed) => sheet.collections['lines']!.map((line) => line['description'] ?? '');
  const printed = async (id: string, session: string): Promise<{ status: number; sheet: Printed | null }> => {
    const res = await served.call('GET', `/documents/${id}/content`, { session });
    return { status: res.statusCode, sheet: res.statusCode === 200 ? (JSON.parse(res.body) as Printed) : null };
  };
  const listed = async (session: string) => ((await served.call('GET', '/documents?ref=studio_invoices_claimed&id=1', { session })).json() as { data: { id: string }[] }).data.map((d) => d.id);

  beforeAll(async () => {
    if (!reachable) return;
    h = await installStudio(dialect, heldLines());
    const t = (ref: string) => h.real(ref);
    await h.sql(`insert into ${t('clients')} (id, email, name, company) values (1, 'ann@x.test', 'Ann', 'Ann Studio Ltd'), (2, 'ben@x.test', 'Ben', 'Ben & Co')`);
    await h.sql(`insert into ${t('invoices')} (id, client_id, number, status, issued_on, total, currency) values (1, 1, 'INV-1001', 'sent', '2026-01-15', '20.00', 'EUR')`);
    await h.sql(`insert into ${t('invoice_lines')} (id, invoice_id, position, description, amount, holder_id) values (1, 1, 1, 'Seat A', '10', null), (2, 1, 2, 'Seat B for Ben', '10', 2)`);
    invoice = (await documentProfilesRepo(h.meta).listOwnedBy(h.connectionId, 'studio')).find((p) => p.kind === 'invoice')!;
    served = await h.serve();
    sessions['ann'] = await served.claim('ann@x.test', '198.51.100.1');
  }, 120_000);
  afterAll(async () => {
    if (!reachable) return;
    await served.close();
    await h.close();
  });

  it.skipIf(!reachable)("draws the guest's own render without the line another client holds", async () => {
    const res = await served.call('POST', '/documents/render', { session: sessions['ann'], payload: { ref: 'studio_invoices_claimed', id: 1, kind: 'invoice' } });
    expect(res.statusCode, res.body).toBe(201);
    const id = (res.json() as { data: { id: string } }).data.id;
    const { sheet } = await printed(id, sessions['ann']!);
    expect(lines(sheet!)).toEqual(['Seat A', '']);
    expect(JSON.stringify(sheet)).not.toContain('Seat B for Ben');
    // Hers: listed to her, and the same document again while nothing changed.
    expect(await listed(sessions['ann']!)).toEqual([id]);
    const again = await served.call('POST', '/documents/render', { session: sessions['ann'], payload: { ref: 'studio_invoices_claimed', id: 1, kind: 'invoice' } });
    expect((again.json() as { data: { id: string } }).data.id).toBe(id);
  });

  it.skipIf(!reachable)("never lists or opens to the guest a document the desk drew with everything in it", async () => {
    const staff = await renderDocument(h.pipeline, { profileId: invoice.id, pk: { id: 1 }, actorKind: 'user' });
    expect(staff.status).toBe('rendered');
    const doc = (staff as { document: { id: string } }).document;
    expect(JSON.stringify(h.drawn.at(-1)!.subject)).toContain('Seat B for Ben');
    expect(await listed(sessions['ann']!)).not.toContain(doc.id);
    expect((await printed(doc.id, sessions['ann']!)).status).toBe(404);
    expect((await served.call('GET', `/documents/${doc.id}`, { session: sessions['ann'] })).statusCode).toBe(404);
  });

  it.skipIf(!reachable)('draws a document the profile emails out for nobody: no held line, and anyone who reaches the row may open it', async () => {
    await documentProfilesRepo(h.meta).patch(invoice.id, { deliver: { emailSlot: 'clientEmail' } } as never);
    const mailed = await renderDocument(h.pipeline, { profileId: invoice.id, pk: { id: 1 }, actorKind: 'system' });
    expect(mailed.status).toBe('rendered');
    const doc = (mailed as { document: { id: string } }).document;
    expect(JSON.stringify(h.drawn.at(-1)!.subject)).not.toContain('Seat B for Ben');
    expect((await documentsRepo(h.meta).findById(doc.id))!.claim).toMatchObject({ value: '' });
    const { sheet } = await printed(doc.id, sessions['ann']!);
    expect(lines(sheet!)).toEqual(['Seat A', '']);
    await documentProfilesRepo(h.meta).patch(invoice.id, { deliver: {} } as never);
  });
});
