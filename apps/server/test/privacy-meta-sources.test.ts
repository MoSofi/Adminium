// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHERE ADMINIUM KEEPS A PERSON ITSELF, found on SQLite, Postgres and MySQL
 * meta stores (Postgres and MySQL hand JSON back parsed, and cast it to text
 * their own way): the send ledger by address and by the person's row, a
 * campaign's failure list, rendered documents of their row or naming them,
 * designer invoices, payments of their row and of their document, the
 * payment services' messages, the rules' runs started by their row or
 * holding their address, staff notifications, and files on their row.
 *
 * Another person is never found: not one whose address merely contains
 * theirs (`xmarta@…`, `marta@….org`), not one in another case of the same
 * table, not a row of another table with the same key.
 */
import {
  connectionsRepo,
  emailRunsRepo,
  emailSendsRepo,
  emailTemplatesRepo,
  filesRepo,
  keptPaymentsRepo,
  newId,
  notificationsRepo,
  packJson,
  usersRepo,
  writeBool,
  type MetaDb,
} from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { findInMeta } from '../src/privacy/meta-sources.js';
import { holdsAddress } from '../src/privacy/values.js';
import { TEST_SECRET } from './helpers.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';

const MARTA = 'marta.kovac@cobaltlegal.example';

describe('an address inside a text', () => {
  it('is found whole, in any case, and never inside another address', () => {
    expect(holdsAddress(`Marta <${MARTA.toUpperCase()}>`, MARTA)).toBe(true);
    expect(holdsAddress(`wrote to ${MARTA}.`, MARTA)).toBe(true);
    expect(holdsAddress(`x${MARTA}`, MARTA)).toBe(false);
    expect(holdsAddress(`${MARTA}.org`, MARTA)).toBe(false);
    expect(holdsAddress(`${MARTA}-old`, MARTA)).toBe(false);
    expect(holdsAddress(`first x${MARTA} then ${MARTA}`, MARTA)).toBe(true);
  });
});

for (const engine of META_ENGINES) {
  describe.skipIf(!engine.available)(`what Adminium keeps of a person [${engine.name}]`, () => {
    let handle: MetaHandle;
    let meta: MetaDb;
    const ids: Record<string, string> = {};
    let conn = '';

    beforeAll(async () => {
      handle = await engine.make();
      meta = handle.meta;
      const { db } = meta;
      const staff = (await usersRepo(meta).create({ email: 'dana@meridian.example', name: 'Dana' })).id;
      conn = (await connectionsRepo(meta, dsnCryptoFromSecret(TEST_SECRET)).create({ name: 'crm', engine: 'postgres', introspectDsn: 'postgres://ro:s@db/crm' })).id;

      // The send ledger: by address (another case, spaces kept), by the person's row under an old address, and two others.
      const template = await emailTemplatesRepo(meta).create({ kind: 'campaign', key: 'july', locale: 'en_US', name: 'July', subject: 'July', blocks: [] });
      const run = await emailRunsRepo(meta).create({ templateId: template.id, audience: { kind: 'users' }, scheduledAt: 1 });
      ids['run'] = run.id;
      await emailSendsRepo(meta).write(
        run.id,
        [
          { address: `  ${MARTA.toUpperCase()} `, name: 'Marta Kovac' },
          { address: 'marta.old@cobaltlegal.example', name: 'Marta Kovac', connectionId: conn, personTable: 'public.crm_contacts', personKey: '7' },
          { address: `x${MARTA}`, name: 'Xavier' },
          { address: 'ben@other.example', name: 'Ben', connectionId: conn, personTable: 'public.crm_contacts', personKey: '8' },
          // Same key, another table: not her.
          { address: 'quote@other.example', name: 'Quote', connectionId: conn, personTable: 'public.crm_quotes', personKey: '7' },
          // Her contact's key on the invoices table, whose found row is another: not her either.
          { address: 'cross@other.example', name: 'Cross', connectionId: conn, personTable: 'public.crm_invoices', personKey: '7' },
        ],
        1,
      );
      await db.updateTable('adminium_email_runs').set({ failures: packJson([{ to: MARTA, error: '550 no such user' }, { to: `x${MARTA}`, error: 'other' }]) }).where('id', '=', run.id).execute();

      // Rendered documents: one of her invoice row, one naming her in what was rendered, one of another row.
      const doc = (entityTable: string | null, entityId: string | null, fields: Record<string, unknown>) => ({
        id: newId('doc'),
        profileId: null,
        addOnKey: 'invoices',
        kind: 'invoice',
        connectionId: entityTable === null ? null : conn,
        entity: null,
        entityTable,
        entityId,
        subject: packJson({ now: { iso: '2026-10-01T00:00:00Z', timezone: 'UTC' }, locale: 'en-US', currency: 'GBP', business: { name: 'Meridian', lines: [] }, entity: null, number: null, fields }),
        number: 'INV-1',
        fileId: null,
        htmlFileId: null,
        locale: 'en-US',
        format: 'pdf',
        status: 'rendered',
        error: null,
        delivery: 'sent',
        sentAt: 5,
        jobId: null,
        requestedBy: null,
        actorKind: 'system',
        claim: null,
        renderedAt: 5,
        voidedAt: null,
        voidReason: null,
        createdAt: 5,
        reuseKey: null,
      });
      const ofRow = doc('public.crm_invoices', '3', { total: 100 });
      const naming = doc(null, null, { customer: { email: MARTA.toUpperCase(), name: 'Marta' } });
      const other = doc('public.crm_invoices', '4', { customer: { email: 'ben@other.example' } });
      await db.insertInto('adminium_documents').values([ofRow, naming, other]).execute();
      Object.assign(ids, { docOfRow: ofRow.id, docNaming: naming.id, docOther: other.id });

      // A designer invoice naming her, and one naming somebody whose address holds hers.
      const invoice = (body: unknown) => ({ id: newId('inv'), kind: 'invoice', name: 'Invoice', status: 'sent', topic: 'services', lang: 'en', number: 'D-1', starter: null, originId: null, position: 0, body: packJson(body), summary: packJson({}), createdBy: null, createdAt: 1, updatedAt: 1 });
      const hers = invoice({ customer: ['Marta Kovac', MARTA], customerName: 'Marta Kovac' });
      await db.insertInto('adminium_invoice_documents').values([hers, invoice({ customer: [`x${MARTA}`] })]).execute();
      ids['invoice'] = hers.id;

      // Payments: of her invoice row, of her rendered document, of another row.
      const pay = (payable: { kind: 'shape' | 'document'; tableName: string | null; rowKey: string }) =>
        keptPaymentsRepo(meta).insert({ payable: { ...payable, connectionId: payable.kind === 'document' ? null : conn }, number: null, amount: '100.00', currency: 'GBP', method: 'card', methodNote: null, provider: 'demo', mode: 'live', attemptId: null, approvalCode: null, cardLast4: '4242', note: null, paidOn: 10, recordedBy: 'system', recordedByUser: null });
      ids['payRow'] = (await pay({ kind: 'shape', tableName: 'public.crm_invoices', rowKey: '3' }))!.id;
      ids['payDoc'] = (await pay({ kind: 'document', tableName: null, rowKey: ofRow.id }))!.id;
      await pay({ kind: 'shape', tableName: 'public.crm_invoices', rowKey: '4' });

      // A payment service's message holding her address.
      const event = (body: unknown) => ({ id: newId('pev'), provider: 'demo', mode: 'live', eventId: newId('pev'), type: 'checkout.completed', kind: 'paid', checkoutRef: null, paymentRef: null, refundRef: null, attemptId: null, source: 'webhook', body: packJson(body), receivedAt: 1, processedAt: 1 });
      const hersEvent = event({ customer_details: { email: MARTA, name: 'Marta' } });
      await db.insertInto('adminium_payment_events').values([hersEvent, event({ customer_details: { email: `${MARTA}.org` } })]).execute();
      ids['event'] = hersEvent.id;

      // The rules' runs: one started by her row (its snapshot masked, no address), one holding her address, one of another row.
      const automation = newId('auto');
      await db.insertInto('adminium_automations').values({ id: automation, connectionId: conn, name: 'Tell the rep', description: null, enabled: writeBool(meta, true), trigger: packJson({}), graph: packJson({}), lastRunAt: null, nextRunAt: null, watchCursor: null, timeSavedMinutes: null, createdBy: null, managedBy: null, templateKey: null, module: null, contentHash: null, createdAt: 1, updatedAt: 1 }).execute();
      const runRow = (record: unknown, snapshot: unknown) => ({ id: newId('arun'), automationId: automation, jobId: null, status: 'succeeded', triggerEvent: packJson({ event: 'record.updated', origin: 'dashboard', hops: 0, record, snapshot, occurredAt: 1 }), trace: null, error: null, dedupeKey: null, wakeAt: null, durationMs: 1, origin: 'dashboard', startedAt: 1, finishedAt: 2 });
      const byRow = runRow({ connectionId: conn, table: 'public.crm_contacts', pk: { id: 7 }, label: 'Marta Kovac' }, { id: 7, name: 'Marta Kovac', email: null });
      const byAddress = runRow({ connectionId: conn, table: 'public.crm_enquiries', pk: { id: 2 }, label: 'Enquiry 2' }, { id: 2, email: MARTA });
      await db.insertInto('adminium_automation_runs').values([byRow, byAddress, runRow({ connectionId: conn, table: 'public.crm_contacts', pk: { id: 8 }, label: 'Ben' }, { id: 8, email: 'ben@other.example' })]).execute();
      Object.assign(ids, { runByRow: byRow.id, runByAddress: byAddress.id });

      // Staff notifications: about her row, naming her, about another row.
      const notices = notificationsRepo(meta);
      ids['noticeRow'] = (await notices.create({ userId: staff, kind: 'automation', title: 'Contact changed', entity: { connectionId: conn, table: 'public.crm_contacts', pk: { id: 7 }, label: 'Marta' } })).id;
      ids['noticeText'] = (await notices.create({ userId: staff, kind: 'automation', title: 'New enquiry', body: `From Marta <${MARTA}>` })).id;
      await notices.create({ userId: staff, kind: 'automation', title: 'Contact changed', entity: { connectionId: conn, table: 'public.crm_contacts', pk: { id: 8 }, label: 'Ben' } });

      // Files: on her row, on another row.
      const file = (recordId: string) => filesRepo(meta).create({ filename: `${recordId}.pdf`, mime: 'application/pdf', sizeBytes: 1, sha256: 'a'.repeat(64), kind: 'upload', uploadedBy: staff, entity: { connectionId: conn, table: 'public.crm_contacts', pk: { id: Number(recordId) }, label: recordId } });
      ids['file'] = (await file('7')).id;
      await file('8');
    }, 120_000);
    afterAll(async () => {
      await handle?.destroy();
    });

    it('finds each store of hers, and nobody else’s', async () => {
      const found = await findInMeta(meta, MARTA, [
        { connectionId: conn, table: 'public.crm_contacts', tableName: 'crm_contacts', key: '7' },
        { connectionId: conn, table: 'public.crm_invoices', tableName: 'crm_invoices', key: '3' },
      ]);
      const byKind = Object.fromEntries(found.map((one) => [one.kind, one]));
      expect(found.map((one) => one.kind).sort()).toEqual(['automation-runs', 'campaign-failures', 'campaign-mail', 'documents', 'files', 'invoices', 'notifications', 'payment-events', 'payments'].sort());
      expect(byKind['campaign-mail']!.rows.map((row) => row['address']).sort()).toEqual([MARTA.toUpperCase(), 'marta.old@cobaltlegal.example'].sort());
      expect(byKind['campaign-failures']!.rows).toEqual([{ runId: ids['run'], startedAt: null, to: MARTA, error: '550 no such user' }]);
      expect(byKind['documents']!.keys.sort()).toEqual([ids['docOfRow'], ids['docNaming']].sort());
      expect(byKind['invoices']!.keys).toEqual([ids['invoice']]);
      expect(byKind['payments']!.keys.sort()).toEqual([ids['payRow'], ids['payDoc']].sort());
      expect(byKind['payment-events']!.keys).toEqual([ids['event']]);
      expect(byKind['automation-runs']!.keys.sort()).toEqual([ids['runByRow'], ids['runByAddress']].sort());
      expect(byKind['notifications']!.keys.sort()).toEqual([ids['noticeRow'], ids['noticeText']].sort());
      expect(byKind['files']!.keys).toEqual([ids['file']]);

      // Nothing of another person anywhere in what would be downloaded.
      const written = JSON.stringify(found.map((one) => one.rows));
      for (const other of ['ben@other.example', `x${MARTA}`, `${MARTA}.org`, 'quote@other.example', 'cross@other.example', 'Xavier']) expect(written).not.toContain(other);
    });

    it('finds nothing for an address nobody has', async () => {
      expect(await findInMeta(meta, 'nobody@nowhere.example', [])).toEqual([]);
    });
  });
}
