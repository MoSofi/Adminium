// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a receipt prints, on every engine: the balance left as it stood right
 * after ITS payment — not the invoice's balance when it is drawn — and the
 * days it names on the venue's clock, never the UTC one.
 *
 * The venue is in Los Angeles; the server is wherever the test runs. A
 * payment voided at 05:30 UTC on 20 January was voided on the 19th there.
 */
import { documentProfilesRepo, type DocumentProfile } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { renderDocument } from '../src/documents/render.js';
import { installStudio, type StudioHarness } from './app-documents.helpers.js';
import { LEGS, writerFor } from './invoicing-install.helpers.js';

type Fields = Record<string, unknown>;

describe.each(LEGS)('a receipt\'s balance left and its days, on %s', (dialect, reachable) => {
  let h: StudioHarness;
  let receipt: DocumentProfile;
  const print = async (payment: number): Promise<Fields> => {
    const outcome = await renderDocument(h.pipeline, { profileId: receipt.id, pk: { id: payment }, reuse: true });
    if (outcome.status !== 'rendered') throw new Error(`not drawn: ${JSON.stringify(outcome)}`);
    return (outcome.document.subject as { fields: Fields }).fields;
  };

  beforeAll(async () => {
    if (!reachable) return;
    h = await installStudio(dialect);
    await h.meta.db.updateTable('adminium_connections').set({ timezone: 'America/Los_Angeles' } as never).where('id', '=', h.connectionId).execute();
    const t = (ref: string) => h.real(ref);
    const [yes, no] = dialect === 'postgres' ? ['true', 'false'] : ['1', '0'];
    await h.sql(`insert into ${t('clients')} (id, email, name, company) values (1, 'ann@x.test', 'Ann', 'Ann Ltd')`);
    await h.sql(`insert into ${t('invoices')} (id, client_id, number, status, issued_on, total, balance, currency) values (1, 1, 'INV-1', 'sent', '2026-01-10', '100.00', '50.00', 'EUR')`);
    // Its one line: the total is worked out from the lines on every write that settles it.
    await h.sql(`insert into ${t('invoice_lines')} (id, invoice_id, position, qty, rate, amount) values (1, 1, 1, 1, '100', '100')`);
    // Paid out of order: the second payment recorded was made first; one was voided.
    await h.sql(
      `insert into ${t('payments')} (id, invoice_id, client_id, amount, voided, paid_on) values ` +
        `(1, 1, 1, '30', ${no}, '2026-02-01'), (2, 1, 1, '20', ${no}, '2026-01-15'), (3, 1, 1, '10', ${yes}, '2026-01-20')`,
    );
    // The void's moment, written the way the app writes an instant.
    const writer = await writerFor(h);
    await writer.update('payments', 3, { voided_at: '2026-01-20T05:30:00.000Z' });
    receipt = (await documentProfilesRepo(h.meta).listOwnedBy(h.connectionId, 'studio')).find((p) => p.kind === 'receipt')!;
  }, 180_000);

  afterAll(async () => {
    if (!reachable) return;
    await h.close();
  });

  it.skipIf(!reachable)('prints the balance left right after each payment, in (day, key) order, voided ones left out', async () => {
    expect((await print(2))['balanceAfter']).toBe(8000);
    expect((await print(1))['balanceAfter']).toBe(5000);
    // A voided payment's receipt: the balance its void left, which it no longer touches.
    expect((await print(3))['balanceAfter']).toBe(8000);
  });

  it.skipIf(!reachable)('prints the same balance left when drawn again after a later payment', async () => {
    const [, no] = dialect === 'postgres' ? ['true', 'false'] : ['1', '0'];
    await h.sql(`insert into ${h.real('payments')} (id, invoice_id, client_id, amount, voided, paid_on) values (4, 1, 1, '40', ${no}, '2026-03-01')`);
    await h.sql(`update ${h.real('invoices')} set balance = '10.00' where id = 1`);
    expect((await print(1))['balanceAfter']).toBe(5000);
    expect((await print(4))['balanceAfter']).toBe(1000);
  });

  it.skipIf(!reachable)('prints a day as the day, and a moment on the venue\'s day', async () => {
    const voided = await print(3);
    expect(voided['issuedAt']).toBe('2026-01-20');
    expect(voided['voidedOn']).toBe('2026-01-19');
    expect((await print(2))['issuedAt']).toBe('2026-01-15');
  });
});
