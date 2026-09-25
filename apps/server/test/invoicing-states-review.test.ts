// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A document's states against the writers that could walk around them, on
 * every engine: an import updating rows already there, the outbox's own
 * context used on another table, a link table tied to a locked document, a
 * JSON column, a date sent back as another spelling, a stamp or a
 * fingerprint a writer sends, a moment that moves earlier within its day or
 * lies about its offset, a payment moved to another invoice, two writers on
 * one document at once, and sample rows the operator changed.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { rolesRepo, usersRepo } from '@adminium/meta';

import { outboxContext } from '../src/outbox/context.js';
import { createAppStore } from '../src/apps/store.js';
import { createSampleDataService, findSampleApp } from '../src/apps/sample-data.js';
import type { FileStore } from '../src/files/store.js';
import { updateRows, type WriteContext } from '../src/crud/write-service.js';
import { venueClock } from '../src/crud/venue-time.js';
import { LEGS, installInvoicing, invoicingManifest, type InvoicingHarness } from './invoicing-install.helpers.js';
import { dataRoutesOver, type DataRoutes } from './invoicing-routes.helpers.js';
import { seedSettings, setConnectionCurrency, settledWriter } from './invoicing-writes.helpers.js';
import { statesTables } from './invoicing-states.helpers.js';

type Table = { ref: string; columns: Record<string, unknown>[] } & Record<string, unknown>;

/** The states app, with JSON columns, a moment that only moves later, one never after today, and tags on invoices. */
function reviewManifest(): Record<string, unknown> {
  const tables = (statesTables() as Table[]).map((t): Table => {
    if (t.ref === 'invoices') {
      const states = t['states'] as Record<string, unknown>;
      return {
        ...t,
        columns: [...t.columns, { ref: 'meta', type: 'json', nullable: true }, { ref: 'service_on', type: 'date', nullable: true }],
        states: { ...states, children: { ...(states['children'] as object), invoice_tags: { via: 'invoice_id', lock: true } } },
      };
    }
    if (t.ref === 'invoice_lines') return { ...t, columns: [...t.columns, { ref: 'extra', type: 'json', nullable: true }] };
    if (t.ref === 'payments') return { ...t, columns: [...t.columns, { ref: 'received_at', type: 'timestamptz', nullable: true, rules: { notAfter: 'today' } }] };
    if (t.ref === 'proposals') {
      const states = t['states'] as Record<string, unknown>;
      const columns = t.columns.map((column) => {
        if (column['ref'] !== 'fingerprint') return column;
        const stamp = (column['rules'] as { stamp: { set: { hashOf: { columns: string[] } } } }).stamp;
        return { ...column, rules: { stamp: { ...stamp, set: { hashOf: { ...stamp.set.hashOf, columns: [...stamp.set.hashOf.columns, 'expires_at'] } } } } };
      });
      return { ...t, columns: [...columns, { ref: 'expires_at', type: 'timestamptz', nullable: true }], states: { ...states, onlyLater: ['valid_until', 'expires_at'] } };
    }
    return t;
  });
  const tags: Table = { ref: 'tags', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'name', type: 'text', maxLength: 40 }] };
  const join: Table = {
    ref: 'invoice_tags',
    columns: [
      { ref: 'id', type: 'int', role: 'pk' },
      { ref: 'invoice_id', type: 'fk', references: 'invoices' },
      { ref: 'tag_id', type: 'fk', references: 'tags' },
    ],
  };
  return { ...invoicingManifest([...tables, tags, join]), roles: [{ key: 'manager', name: 'Studio manager' }] };
}

let open: InvoicingHarness | null = null;
let routes: DataRoutes | null = null;
afterEach(async () => {
  await routes?.close();
  routes = null;
  await open?.close();
  open = null;
});

const importer = (): WriteContext => ({ origin: 'import', hops: 0, actor: { kind: 'user', id: 'usr_imp', label: 'Importer' }, request: null });
const HISTORY = { capacity: 'unchecked' } as const;

const day = (offset = 0) => {
  const today = venueClock(new Date(), 'Europe/London').day;
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + offset)).toISOString().slice(0, 10);
};

async function harness(dialect: (typeof LEGS)[number][0], manifest = reviewManifest(), files?: Record<string, string>) {
  const h = await installInvoicing(dialect, manifest, undefined, files);
  open = h;
  await seedSettings(h);
  await setConnectionCurrency(h, 'EUR');
  const w = await settledWriter(h);
  const client = await w.create('clients', { email: 'ann@example.test', name: 'Ann' });
  const row = async (ref: string, id: unknown) => (await h.rows(`select * from ${h.real(ref)} where id = ${String(id)}`))[0]!;
  const sent = async () => {
    const invoice = await w.create('invoices', { client_id: client['id'] });
    const line = await w.create('invoice_lines', { invoice_id: invoice['id'], qty: '1', rate: '100' });
    await w.update('invoices', invoice['id'], { status: 'sent' });
    return { invoice, line };
  };
  /** What the import's upsert does for a row already there: prepared against it, then its statement. */
  const importUpdate = async (ref: string, id: unknown, values: Record<string, unknown>, context = importer()) => {
    const target = w.targetOf(ref);
    const existing = await row(ref, id);
    const [prepared] = await w.writes.beforeEach('update', target, context, [{ values: w.prepared(ref, values), record: existing }], HISTORY);
    if (prepared!.issues !== null) throw Object.assign(new Error('refused'), { code: 'VALIDATION_FAILED', issues: prepared!.issues });
    await updateRows(w.db, w.dialect, target.table, prepared!.values, { id });
  };
  const manager = async (): Promise<WriteContext> => {
    const user = await usersRepo(h.meta).create({ email: `manager-${String(Math.random()).slice(2, 8)}@test`, name: 'Mo Manager' });
    const role = await rolesRepo(h.meta).findBySlug('studio-manager');
    await rolesRepo(h.meta).assignToUser(user.id, role!.id);
    return { origin: 'dashboard', hops: 0, actor: { kind: 'user', id: user.id, label: 'Mo Manager' }, request: null };
  };
  return { h, w, client, row, sent, importUpdate, manager };
}

/** A fingerprint of the same proposal, per engine. */
const sealed = new Map<string, string>();

for (const [dialect, available] of LEGS) {
  describe.skipIf(!available)(`states against every writer on ${dialect}`, () => {
    it("judges an import's update of a row already there: its moves, its lock, its dates, its parent", async () => {
      const { w, client, row, sent, importUpdate, manager } = await harness(dialect);
      const { invoice, line } = await sent();
      await expect(importUpdate('invoices', invoice['id'], { status: 'draft' })).rejects.toMatchObject({ code: 'STATE_MOVE_REFUSED' });
      await expect(importUpdate('invoice_lines', line['id'], { rate: '999' })).rejects.toMatchObject({ code: 'RECORD_LOCKED' });
      expect([(await row('invoices', invoice['id']))['status'], Number((await row('invoices', invoice['id']))['subtotal'])]).toEqual(['sent', 100]);
      // The void of a sent invoice is kept for managers: an import without the role is refused it.
      const unpaid = await sent();
      await expect(importUpdate('invoices', unpaid.invoice['id'], { status: 'void' })).rejects.toMatchObject({ code: 'STATE_MOVE_REFUSED', details: { roles: ['studio-manager'] } });
      // An import run by a manager may make it.
      const managed = await manager();
      await importUpdate('invoices', unpaid.invoice['id'], { status: 'void' }, { ...managed, origin: 'import' });
      expect((await row('invoices', unpaid.invoice['id']))['status']).toBe('void');
      // A paid invoice is not voided by an import, nor by anyone without the role.
      const paid = await sent();
      await w.create('payments', { invoice_id: paid.invoice['id'], amount: '10' });
      await expect(importUpdate('invoices', paid.invoice['id'], { status: 'void' })).rejects.toMatchObject({ code: 'STATE_MOVE_REFUSED' });
      // A payment on a void invoice: refused to an import too.
      const boss = await manager();
      const gone = await sent();
      await w.update('invoices', gone.invoice['id'], { status: 'void' }, boss);
      await expect(w.create('payments', { invoice_id: gone.invoice['id'], amount: '5' }, importer())).rejects.toMatchObject({ code: 'RECORD_LOCKED' });
      // A date that only moves later.
      const proposal = await w.create('proposals', { client_id: client['id'], valid_until: day(20) });
      await expect(importUpdate('proposals', proposal['id'], { valid_until: day(5) })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      // History as a whole: a sent invoice brought in with its line and its payment, in one import.
      const run = importer();
      const past = await w.create('invoices', { client_id: client['id'], status: 'sent', number: 'OLD-1' }, run);
      await w.create('invoice_lines', { invoice_id: past['id'], qty: '1', rate: '40' }, run);
      await w.create('payments', { invoice_id: past['id'], amount: '40' }, run);
      // Another import adding to that sent invoice: refused.
      await expect(w.create('invoice_lines', { invoice_id: past['id'], qty: '1', rate: '1' }, importer())).rejects.toMatchObject({ code: 'RECORD_LOCKED' });
    });

    it("judges a write with the outbox's context on any table but the outbox's own", async () => {
      const { w, row, sent } = await harness(dialect);
      const { invoice } = await sent();
      // The context the outbox writes its own rows with: its table is another.
      const box = outboxContext('studio', 'main.studio_messages');
      await expect(w.update('invoices', invoice['id'], { status: 'draft', tax_rate: '0' }, box)).rejects.toMatchObject({ code: 'STATE_MOVE_REFUSED' });
      expect((await row('invoices', invoice['id']))['status']).toBe('sent');
    });

    it('holds a link table tied to a locked document: no link added or taken away, and no undo of links', async () => {
      const { h, w, client } = await harness(dialect);
      const a = await w.create('tags', { name: 'a' });
      const b = await w.create('tags', { name: 'b' });
      // Tagged as a draft, then sent.
      const invoice = await w.create('invoices', { client_id: client['id'] });
      await w.create('invoice_lines', { invoice_id: invoice['id'], qty: '1', rate: '100' });
      await w.create('invoice_tags', { invoice_id: invoice['id'], tag_id: a['id'] });
      await w.update('invoices', invoice['id'], { status: 'sent' });
      routes = await dataRoutesOver(h, dialect);
      const r = routes;
      const model = (await r.t.app.inject({ method: 'GET', url: `/api/v1/connections/${r.connectionId}/schema`, headers: { 'x-test-user-id': r.t.users.admin.id } })).json<{
        model: { relations: { id: string; from: { tableId: string }; through: { tableId: string } | null }[] };
      }>().model;
      const onInvoices = model.relations.find((x) => x.through?.tableId === r.table('invoice_tags') && x.from.tableId === r.table('invoices'))!;
      const open = { client_paid_at: new Date().toISOString() };
      const dropped = await r.patch('invoices', invoice['id'], { values: open, links: { [onInvoices.id]: [] } });
      expect(dropped.statusCode, dropped.body).toBe(409);
      const added = await r.patch('invoices', invoice['id'], { values: open, links: { [onInvoices.id]: [String(a['id']), String(b['id'])] } });
      expect(added.statusCode, added.body).toBe(409);
      expect((await h.rows(`select tag_id from ${h.real('invoice_tags')} where invoice_id = ${String(invoice['id'])}`)).length).toBe(1);
      // A tag's links reach a draft invoice's tags: allowed, and never undone (an undo writes links with no rules).
      const draft = await w.create('invoices', { client_id: client['id'] });
      // The same relation, from the tag's side.
      const linked = await r.patch('tags', b['id'], { values: { name: 'b2' }, links: { [onInvoices.id]: [String(draft['id'])] } });
      expect(linked.statusCode, linked.body).toBe(200);
      expect(linked.json<{ undoToken: string | null }>().undoToken).toBeNull();
    });

    it('sees a changed JSON value as a change, and a date sent back in another spelling as none', async () => {
      const { w, client, row } = await harness(dialect);
      const invoice = await w.create('invoices', { client_id: client['id'], meta: { po: 'A-1' }, service_on: '2026-09-01' });
      const line = await w.create('invoice_lines', { invoice_id: invoice['id'], qty: '1', rate: '100', extra: { note: 'x' } });
      await w.update('invoices', invoice['id'], { status: 'sent' });
      await expect(w.update('invoices', invoice['id'], { meta: { po: 'CHANGED' } })).rejects.toMatchObject({ code: 'RECORD_LOCKED' });
      await expect(w.update('invoice_lines', line['id'], { extra: { note: 'CHANGED' } })).rejects.toMatchObject({ code: 'RECORD_LOCKED' });
      // The same JSON, and a locked date as the engine hands it back or as a form spells it: nothing changes, nothing is refused.
      const stored = await row('invoices', invoice['id']);
      await w.update('invoices', invoice['id'], { meta: { po: 'A-1' }, service_on: stored['service_on'] });
      await w.update('invoices', invoice['id'], { service_on: '2026-09-01' });
      await expect(w.update('invoices', invoice['id'], { service_on: '2026-09-02' })).rejects.toMatchObject({ code: 'RECORD_LOCKED' });
    });

    it('keeps stamps and fingerprints to Adminium, but for an import', async () => {
      const { w, client, row, sent, manager } = await harness(dialect);
      const proposal = await w.create('proposals', { client_id: client['id'] });
      await w.update('proposals', proposal['id'], { status: 'sent' });
      await w.update('proposals', proposal['id'], { status: 'accepted', signed_name: 'Ann' });
      const seal = (await row('proposals', proposal['id']))['fingerprint'];
      await w.update('proposals', proposal['id'], { fingerprint: 'f'.repeat(64), first_signed_name: 'Someone' });
      const after = await row('proposals', proposal['id']);
      expect([after['fingerprint'], after['first_signed_name']]).toEqual([seal, 'Ann']);
      // A void's own stamps: written by Adminium, never by the writer.
      const { invoice } = await sent();
      await w.update('invoices', invoice['id'], { status: 'void', voided_by: 'Nobody' }, await manager());
      expect((await row('invoices', invoice['id']))['voided_by']).toBe('Mo Manager');
      // An import keeps what it brings.
      const past = await w.create('proposals', { client_id: client['id'], status: 'accepted', signed_name: 'Old', fingerprint: 'a'.repeat(64) }, importer());
      expect((await row('proposals', past['id']))['fingerprint']).toBe('a'.repeat(64));
    });

    it('compares moments as moments: earlier within a day, and today by its offset', async () => {
      const { w, client, sent } = await harness(dialect);
      const proposal = await w.create('proposals', { client_id: client['id'], expires_at: '2030-06-15T20:00:00Z' });
      await expect(w.update('proposals', proposal['id'], { expires_at: '2030-06-15T01:00:00Z' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      await w.update('proposals', proposal['id'], { expires_at: '2030-06-16T01:00:00Z' });
      const { invoice } = await sent();
      // Today, late, at UTC−12: tomorrow where the venue is.
      await expect(w.create('payments', { invoice_id: invoice['id'], amount: '1', received_at: `${day(0)}T23:30:00-12:00` })).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
      await w.create('payments', { invoice_id: invoice['id'], amount: '1', received_at: new Date(Date.now() - 60_000).toISOString() });
    });

    it('keeps a payment moved to another invoice within that invoice’s dates', async () => {
      const { w, client, sent } = await harness(dialect);
      const { invoice } = await sent();
      const payment = await w.create('payments', { invoice_id: invoice['id'], amount: '1', paid_on: day(0) });
      // An invoice brought in as issued in five days.
      const run = importer();
      const later = await w.create('invoices', { client_id: client['id'], status: 'sent', issued_on: day(5), number: 'OLD-2' }, run);
      await w.create('invoice_lines', { invoice_id: later['id'], qty: '1', rate: '10' }, run);
      await expect(w.update('payments', payment['id'], { invoice_id: later['id'] })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('seals a moment the same on every engine', async () => {
      const { w, client, row } = await harness(dialect);
      const proposal = await w.create('proposals', { client_id: client['id'], expires_at: '2030-06-15T01:00:00Z', valid_until: '2030-06-30' });
      await w.create('proposal_lines', { proposal_id: proposal['id'], position: 1, amount: '12.5' });
      await w.update('proposals', proposal['id'], { status: 'sent' });
      await w.update('proposals', proposal['id'], { status: 'accepted', signed_name: 'Ann Lee' });
      sealed.set(dialect, String((await row('proposals', proposal['id']))['fingerprint']));
    });
  });

  describe.skipIf(!available || dialect === 'sqlite')(`two writers on one document on ${dialect}`, () => {
    it('never deadlocks a line written while the invoice is sent: the parent is always held first', async () => {
      const { h, w, client } = await harness(dialect);
      const seen = new Set<string>();
      for (let round = 0; round < 15; round += 1) {
        const invoice = await w.create('invoices', { client_id: client['id'] });
        const line = await w.create('invoice_lines', { invoice_id: invoice['id'], qty: '1', rate: '100' });
        const extra = await w.create('invoice_lines', { invoice_id: invoice['id'], qty: '1', rate: '5' });
        const outcomes = await Promise.allSettled([
          w.update('invoices', invoice['id'], { status: 'sent' }),
          w.update('invoice_lines', line['id'], { rate: '90' }),
          w.remove('invoice_lines', extra['id']),
        ]);
        for (const outcome of outcomes) seen.add(outcome.status === 'fulfilled' ? 'ok' : String((outcome.reason as { code?: string }).code));
        const [stored] = await h.rows(`select subtotal from ${h.real('invoices')} where id = ${String(invoice['id'])}`);
        const lines = await h.rows(`select rate from ${h.real('invoice_lines')} where invoice_id = ${String(invoice['id'])}`);
        expect(Number(stored!['subtotal'])).toBe(lines.reduce((sum, l) => sum + Number(l['rate']), 0));
      }
      expect([...seen].filter((code) => !['ok', 'RECORD_LOCKED', 'STATE_MOVE_REFUSED'].includes(code))).toEqual([]);
    });
  });
}

describe('a moment sealed on every engine', () => {
  afterAll(() => sealed.clear());
  it('gives one fingerprint', () => {
    expect(sealed.size).toBeGreaterThan(0);
    expect(new Set(sealed.values()).size).toBe(1);
  });
});

// ── sample rows the operator changed ──────────────────────────────────────

const memoryFiles = {
  write: async () => ({ storageKey: 'x', sizeBytes: 0, sha256: '', destinationId: null, storage: 'memory' }),
} as unknown as FileStore;

const BUNDLE = {
  format: 'adminium.sample/1',
  app: 'studio',
  tables: [
    { ref: 'clients', rows: [{ '@label': 'sam', email: 'sam@sample.example', name: 'Sam' }] },
    {
      ref: 'invoices',
      rows: [
        { '@label': 'kept', client_id: { '@ref': 'sam' }, number_seq: null, number: 'INV-S1', status: 'sent', tax_rate: 0 },
        { '@label': 'plain', client_id: { '@ref': 'sam' }, number_seq: null, number: 'INV-S2', status: 'sent', tax_rate: 0 },
      ],
    },
    {
      ref: 'invoice_lines',
      rows: [
        { invoice_id: { '@ref': 'kept' }, qty: 1, rate: 10 },
        { invoice_id: { '@ref': 'plain' }, qty: 1, rate: 20 },
      ],
    },
  ],
};

for (const [dialect, available] of LEGS) {
  describe.skipIf(!available)(`removing sample rows on ${dialect}`, () => {
    it('removes the sample’s own sent documents, and judges one the operator changed', async () => {
      const manifest = { ...reviewManifest(), sampleData: { file: 'seeds/studio.sample.json' } };
      const { h, w } = await harness(dialect, manifest, { 'seeds/studio.sample.json': JSON.stringify(BUNDLE) });
      const service = createSampleDataService({ meta: h.meta, manager: h.manager, store: createAppStore({ dataDir: h.dataDir }), files: memoryFiles });
      const app = (await findSampleApp(h.meta, 'studio'))!;
      await service.add(app, { locale: 'en-US', userId: null, userLabel: 'test', now: Date.now() });
      const [kept] = await h.rows(`select id from ${h.real('invoices')} where number = 'INV-S1'`);
      // The operator moves the due date of one sent sample invoice: it is theirs now.
      await w.update('invoices', kept!['id'], { due_on: day(3) });
      await expect(service.remove(app, { keepChanged: false, userId: null, userLabel: 'test' })).rejects.toMatchObject({ code: 'DELETE_REFUSED' });
      expect((await h.rows(`select number from ${h.real('invoices')} order by number`)).map((r) => r['number'])).toEqual(['INV-S1', 'INV-S2']);
      // Kept as changed: the rest of the sample goes, sent as it was.
      await service.remove(app, { keepChanged: true, userId: null, userLabel: 'test' });
      expect((await h.rows(`select number from ${h.real('invoices')} order by number`)).map((r) => r['number'])).toEqual(['INV-S1']);
    });
  });
}
