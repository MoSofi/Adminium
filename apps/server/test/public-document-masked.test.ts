// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A document prints what its author mapped, whoever asks. So a document that
 * prints a column masked as personal data opens only to a session that reads
 * that column on its row, on every engine.
 *
 * Here a client's company is marked personal, and the studio's invoice prints
 * it. A session found by the address the client typed, before any code, reads
 * its row without the company; it used to draw the invoice and read the
 * company on it. It is now told to confirm the code first, as a read of a
 * `verified` entry tells it, and an invoice the desk drew for that row is not
 * listed or opened to it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { documentProfilesRepo } from '@adminium/meta';

import { renderDocument } from '../src/documents/render.js';
import { installStudio, studioManifest, type StudioHarness } from './app-documents.helpers.js';
import { LEGS } from './invoicing-install.helpers.js';

/** The studio, with the client's company personal data and printed on the invoice. */
function manifest(): Record<string, unknown> {
  const m = studioManifest();
  const tables = (m['requiredSchema'] as { tables: Record<string, unknown>[] }).tables;
  const company = (tables.find((t) => t['ref'] === 'clients')!['columns'] as Record<string, unknown>[]).find((c) => c['ref'] === 'company')!;
  company['rules'] = { personal: true };
  // The client's own row shows its address (typed to be found), never the company.
  const entries = m['publicAccess'] as Record<string, unknown>[];
  entries[0] = { ...entries[0], select: ['id', 'email'] };
  return m;
}

describe.each(LEGS)('a document that prints a masked column — %s', (dialect, reachable) => {
  let h: StudioHarness;
  let served: Awaited<ReturnType<StudioHarness['serve']>>;
  let session: string;

  beforeAll(async () => {
    if (!reachable) return;
    h = await installStudio(dialect, manifest());
    const t = (ref: string) => h.real(ref);
    await h.sql(`insert into ${t('clients')} (id, email, name, company) values (1, 'ann@x.test', 'Ann', 'Ann Studio Ltd')`);
    await h.sql(`insert into ${t('invoices')} (id, client_id, number, status, issued_on, total, currency) values (1, 1, 'INV-1001', 'sent', '2026-01-15', '100.00', 'EUR')`);
    served = await h.serve();
    session = await served.claim('ann@x.test', '198.51.100.1');
  }, 120_000);

  afterAll(async () => {
    if (!reachable) return;
    await served.close();
    await h.close();
  });

  it.skipIf(!reachable)('asks a found session for the code before drawing it', async () => {
    const own = await served.call('GET', `/records/${h.real('clients')}_claimed`, { session });
    expect(own.statusCode, own.body).toBe(200);
    expect(own.body).not.toContain('Ann Studio Ltd');
    const res = await served.call('POST', '/documents/render', { session, payload: { ref: `${h.real('invoices')}_claimed`, id: 1, kind: 'invoice' } });
    expect(res.statusCode, res.body).toBe(403);
    expect((res.json() as { error: { code: string } }).error.code).toBe('PUBLIC_CLAIM_LEVEL');
    expect(h.drawn).toEqual([]);
  });

  it.skipIf(!reachable)('neither lists nor opens one the desk drew for the row', async () => {
    const profile = (await documentProfilesRepo(h.meta).listOwnedBy(h.connectionId, 'studio')).find((p) => p.kind === 'invoice')!;
    const outcome = await renderDocument(h.pipeline, { profileId: profile.id, pk: { id: 1 } });
    expect(outcome.status).toBe('rendered');
    const id = outcome.status === 'rendered' ? outcome.document.id : '';
    const listed = await served.call('GET', '/documents', { session });
    expect(listed.statusCode, listed.body).toBe(200);
    expect(listed.body).not.toContain(id);
    const content = await served.call('GET', `/documents/${id}/content`, { session });
    expect(content.statusCode).toBe(404);
    expect(content.body).not.toContain('Ann Studio Ltd');
  });
});
