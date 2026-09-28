// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Every sorted read of a row that can carry a large document, over rows larger
 * than MySQL's sort buffer.
 *
 * MySQL sorts a row together with its JSON columns, and one row larger than
 * `sort_buffer_size` (256 KB by default) fails the whole read with "Out of
 * sort memory", even a read of one row. These reads now sort ids alone and
 * fetch the rows after (`inIdOrder`): a drawn document's subject (a
 * statement's rows), a document template's body (its pictures), a public
 * scope's document, an automation run's trigger event (the whole row it
 * fired on) and a queued job's payload. The mysql leg is the one that proves
 * it; the others hold the order.
 */
import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';

import {
  applyMigrations,
  automationRunsRepo,
  automationsRepo,
  connectionsRepo,
  documentProfilesRepo,
  documentsRepo,
  entityKeyOf,
  invoiceDocumentsRepo,
  jobsRepo,
  publicKeysRepo,
  publicScopesRepo,
  reportDocumentsRepo,
  type DsnCrypto,
  type MetaDb,
} from '../src/index.js';
import { TEST_DIALECTS, useMetaDb } from './helpers/db.js';

const T0 = 1_750_000_000_000;
const TABLE = 'public.studio_invoices';
const crypto: DsnCrypto = {
  encrypt: (plaintext) => `enc:test:${Buffer.from(plaintext, 'utf8').toString('base64')}`,
  decrypt: (token) => Buffer.from(token.slice('enc:test:'.length), 'base64').toString('utf8'),
};

/** Text this many bytes past the store's sort buffer (MySQL), or Client Portal's manifest size elsewhere. */
async function padFor(meta: MetaDb): Promise<string> {
  let size = 350_000;
  if (meta.dialect === 'mysql') {
    const buffer = await sql<{ size: number | string }>`select @@sort_buffer_size as size`.execute(meta.db);
    size = Math.max(size, Number(buffer.rows[0]?.size ?? 0) + 100_000);
  }
  return 'x'.repeat(size);
}

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`sorted reads of large rows [${dialect.name}]`, () => {
    const db = useMetaDb(dialect, (meta) => applyMigrations(meta.db, { dialect: meta.dialect }));

    async function connection(meta: MetaDb, name: string): Promise<string> {
      return (await connectionsRepo(meta, crypto).create({ name, engine: 'postgres', introspectDsn: `postgres://ro:s@db/${name}` })).id;
    }

    it('reads drawn documents whose subjects are larger than the sort buffer, newest first', async () => {
      const meta = db();
      const pad = await padFor(meta);
      const a = await connection(meta, 'a');
      const profile = await documentProfilesRepo(meta).create({ addOnKey: 'invoices', kind: 'statement', name: 'Statement', connectionId: a, table: TABLE, mapping: {}, ownerApp: 'studio' }, T0);
      const register = documentsRepo(meta);
      const drawn: string[] = [];
      for (const id of [1, 2]) {
        const row = await register.create(
          {
            profileId: profile.id,
            addOnKey: 'invoices',
            kind: 'statement',
            connectionId: a,
            entity: { connectionId: a, table: TABLE, pk: { id }, label: String(id) },
            subject: { rows: pad },
            locale: 'en-US',
            format: 'html',
            reuseKey: `same`,
          },
          T0 + id,
        );
        await register.markRendered(row.id, { number: `S-${String(id)}`, fileId: null, htmlFileId: null, format: 'html' }, T0 + id);
        drawn.push(row.id);
      }
      const intent = await register.create(
        { profileId: null, addOnKey: 'invoices', kind: 'quote', connectionId: a, entity: null, subject: { rows: pad }, locale: 'en-US', format: 'html', claim: { ref: 'people', column: 'id', value: '7' } },
        T0 + 3,
      );
      await register.markRendered(intent.id, { number: null, fileId: null, htmlFileId: null, format: 'html' }, T0 + 3);

      expect((await register.list()).map((d) => d.id)).toEqual([intent.id, drawn[1], drawn[0]]);
      expect((await register.list())[2]?.subject).toEqual({ rows: pad });
      expect((await register.listForEntity({ table: TABLE, pk: { id: 1 } })).map((d) => d.id)).toEqual([drawn[0]]);
      expect((await register.findReusable(a, 'same'))?.id).toBe(drawn[1]);
      expect((await register.drawnFor(profile.id, { table: TABLE, pk: { id: 2 } }))?.id).toBe(drawn[1]);
      const rows = await register.listForRows({ connectionId: a, entityTable: TABLE, entityIds: [1, 2].map((id) => entityKeyOf({ id })), profileIds: [profile.id], limit: 10 });
      expect(rows.map((d) => d.id)).toEqual([drawn[1], drawn[0]]);
      expect((await register.listClaimedIntents({ connectionId: a, limit: 10 })).map((d) => d.id)).toEqual([intent.id]);
      expect((await register.listExpiredBefore(T0 + 10)).map((d) => d.id)).toEqual([drawn[0], drawn[1], intent.id]);
    });

    it('lists invoice and report documents whose bodies are larger than the sort buffer, in their order', async () => {
      const meta = db();
      const pad = await padFor(meta);
      const summary = { number: 'INV-1', customerName: 'N', title: 'INVOICE', logoText: 'L', logoIcon: 'hexagon', accent: '#4f46e5', currency: '$', cents: true, totalMinor: 1, itemCount: 1 };
      const invoices = invoiceDocumentsRepo(meta);
      const first = await invoices.create({ kind: 'template', name: 'A', body: { logo: pad }, summary }, T0);
      const second = await invoices.create({ kind: 'template', name: 'B', body: { logo: pad }, summary }, T0 + 1);
      const invoice = await invoices.create({ kind: 'invoice', name: 'I', body: { logo: pad }, summary }, T0 + 2);
      // The order the manager has always shown: by place, read without the bodies.
      const placed = async (table: 'adminium_invoice_documents' | 'adminium_report_documents') =>
        (await meta.db.selectFrom(table).select('id').orderBy('position', 'asc').orderBy('id', 'asc').execute()).map((row) => row.id);
      expect((await invoices.list()).map((d) => d.id)).toEqual(await placed('adminium_invoice_documents'));
      expect(new Set((await invoices.list()).map((d) => d.id))).toEqual(new Set([first.id, second.id, invoice.id]));
      expect((await invoices.list({ kind: 'template' })).map((d) => d.id)).toEqual([second.id, first.id]);
      expect((await invoices.list())[0]?.body).toEqual({ logo: pad });

      const reports = reportDocumentsRepo(meta);
      const reportSummary = { reportTitle: 'Q3', kicker: 'Quarterly', accent: '#4f46e5', blockCount: 1, kpiCount: 0, series: [1], starterIcon: 'briefcase' };
      const one = await reports.create({ kind: 'template', name: 'A', body: { bgImage: pad }, summary: reportSummary }, T0);
      const two = await reports.create({ kind: 'template', name: 'B', body: { bgImage: pad }, summary: reportSummary }, T0 + 1);
      const report = await reports.create({ kind: 'report', name: 'R', body: { bgImage: pad }, summary: reportSummary }, T0 + 2);
      expect((await reports.list()).map((d) => d.id)).toEqual(await placed('adminium_report_documents'));
      expect(new Set((await reports.list()).map((d) => d.id))).toEqual(new Set([one.id, two.id, report.id]));
      expect((await reports.list({ kind: 'template' })).map((d) => d.id)).toEqual([two.id, one.id]);
    });

    it('lists public scopes whose documents are larger than the sort buffer, and the keys derived from them', async () => {
      const meta = db();
      const pad = await padFor(meta);
      const connectionId = await connection(meta, 'shop');
      const scopes = publicScopesRepo(meta);
      const keys = publicKeysRepo(meta);
      const made: string[] = [];
      for (const [i, id] of ['pbk_first', 'pbk_second'].entries()) {
        const scope = await scopes.create(
          { connectionId, side: 'customer', name: `app ${String(i)}`, timezone: 'Europe/London', document: JSON.stringify({ version: 1, side: 'customer', timezone: 'Europe/London', resources: [], pad }), derivedForKey: id },
          T0 + i,
        );
        await keys.create({ id, name: `web ${String(i)}`, prefix: `adm_pub_${String(i).repeat(8)}`, tokenHash: String(i).repeat(64), tokenEncrypted: 'sealed', scopeId: scope.id, side: 'customer' }, T0 + i);
        made.push(scope.id);
      }
      expect((await scopes.list()).map((s) => s.id)).toEqual([made[1], made[0]]);
      expect((await scopes.listByConnection(connectionId)).map((s) => s.id)).toEqual([made[1], made[0]]);
      const derived = await keys.listLiveDerived(connectionId, T0 + 10);
      expect(derived.map((k) => k.id)).toEqual(['pbk_first', 'pbk_second']);
      expect(derived[0]?.scopeDocument).toContain(pad);
    });

    it('lists automation runs whose trigger rows are larger than the sort buffer', async () => {
      const meta = db();
      const pad = await padFor(meta);
      const connectionId = await connection(meta, 'northwind');
      const rule = await automationsRepo(meta).create(
        {
          connectionId,
          name: 'Welcome',
          trigger: { kind: 'record', event: 'created', connectionId, table: 'public.users', watch: true },
          graph: { version: 1, nodes: [{ id: 'n1', kind: 'trigger', title: 'When a user signs up' }] },
        },
        T0,
      );
      const runs = automationRunsRepo(meta);
      const begun: string[] = [];
      for (const id of [1, 2]) {
        const run = await runs.begin(
          {
            automationId: rule.id,
            dedupeKey: null,
            origin: 'dashboard',
            triggerEvent: { event: 'record.created', origin: 'dashboard', hops: 0, record: { connectionId, table: 'public.users', pk: { id }, label: 'Jo' }, snapshot: { id, notes: pad }, occurredAt: T0 },
            wakeAt: T0 + 60_000,
          },
          T0 + id,
        );
        begun.push(run!.id);
      }
      expect((await runs.listPending('dashboard')).map((r) => r.id)).toEqual(begun);
      expect((await runs.list({ since: T0 })).map((r) => r.id)).toEqual([begun[1], begun[0]]);
      expect((await runs.list({ since: T0, filter: 'running' })).map((r) => r.id)).toEqual([begun[1], begun[0]]);
    });

    it('claims the next job past a payload larger than the sort buffer', async () => {
      const meta = db();
      const pad = await padFor(meta);
      const jobs = jobsRepo(meta);
      const big = await jobs.enqueue({ kind: 'email-send', payload: { envelope: pad }, runAt: T0 }, T0);
      await jobs.enqueue({ kind: 'email-send', payload: { envelope: pad }, runAt: T0 + 1 }, T0);
      const claimed = await jobs.claim('worker-1', T0 + 10);
      expect(claimed?.id).toBe(big.id);
      expect(claimed?.payload).toEqual({ envelope: pad });
    });
  });
}
