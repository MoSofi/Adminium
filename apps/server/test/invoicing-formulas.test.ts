// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Stored formulas on an installed invoicing app, on every engine: a line's
 * amount, a document's subtotal, tax, total and balance, worked out by the
 * write path whoever writes — and never taken from the writer.
 *
 * What each case holds:
 *  - a line's amount is worked out from its own qty, rate and discount, and a
 *    PATCH of one input alone works it out again from the stored others;
 *  - a writer's value for a worked-out column is dropped, not refused, and a
 *    before hook's value for one does not survive either;
 *  - a document's tax and total follow its subtotal inside the settle, before
 *    its balance: the balance is never taken from the total before;
 *  - a PATCH of the document's own tax rate settles tax, total and balance;
 *  - the cap follows the formulas: a line change that takes the total below
 *    what is paid is refused, as is a tax rate that does;
 *  - a document's places are its own currency's (JPY 0, KWD 3), and a later
 *    change of the connection's currency never re-rounds it;
 *  - a copied tax rate that came back empty falls back to the settings row.
 */
import { afterEach, describe, expect, it } from 'vitest';

import type { RecordHooks } from '../src/crud/write-service.js';
import { LEGS, installInvoicing, type InvoicingHarness } from './invoicing-install.helpers.js';
import { seedSettings, setConnectionCurrency, settledWriter, units, writeManifest } from './invoicing-writes.helpers.js';

let open: InvoicingHarness | null = null;
afterEach(async () => {
  await open?.close();
  open = null;
});

async function harness(dialect: (typeof LEGS)[number][0]) {
  const h = await installInvoicing(dialect, writeManifest());
  open = h;
  await seedSettings(h);
  await setConnectionCurrency(h, 'EUR');
  const w = await settledWriter(h);
  const client = await w.create('clients', { email: 'ann@example.test', name: 'Ann' });
  return { h, w, client };
}

async function row(h: InvoicingHarness, ref: string, id: unknown): Promise<Record<string, unknown>> {
  const [found] = await h.rows(`select * from ${h.real(ref)} where id = ${String(id)}`);
  return found!;
}

/** A decimal as the database handed it back, compared at `places`. */
const at = (value: unknown, places: number) => units(value, places).toString();

for (const [dialect, available] of LEGS) {
  describe.skipIf(!available)(`stored formulas on ${dialect}`, () => {
    it('create each decimal with the places it keeps, and a currency amount with room for any currency', async () => {
      const h = await installInvoicing(dialect, writeManifest());
      open = h;
      const scaleOf = async (table: string, column: string) => {
        if (dialect === 'sqlite') {
          const info = await h.rows(`select type from pragma_table_info('${h.real(table)}') where name = '${column}'`);
          return String(info[0]!['type']).toLowerCase();
        }
        const schema = dialect === 'mysql' ? 'table_schema = database()' : "table_schema = 'public'";
        const info = await h.rows(
          `select numeric_precision as p, numeric_scale as s from information_schema.columns where ${schema} and table_name = '${h.real(table)}' and column_name = '${column}'`,
        );
        return `decimal(${String(info[0]!['p'])},${String(info[0]!['s'])})`;
      };
      if (dialect === 'sqlite') {
        expect(await scaleOf('invoice_lines', 'qty')).toBe('real');
      } else {
        expect(await scaleOf('invoice_lines', 'qty')).toBe('decimal(19,3)');
        expect(await scaleOf('clients', 'tax_rate')).toBe('decimal(19,3)');
        expect(await scaleOf('invoices', 'total')).toBe('decimal(19,4)');
        expect(await scaleOf('payments', 'amount')).toBe('decimal(19,4)');
      }
    });

    it('work a line out, drop a writer value for it, and work it out again from the stored inputs', async () => {
      const { h, w, client } = await harness(dialect);
      const invoice = await w.create('invoices', { client_id: client['id'] });
      const line = await w.create('invoice_lines', { invoice_id: invoice['id'], qty: '2.5', rate: '10.005', amount: '999' });
      let stored = await row(h, 'invoice_lines', line['id']);
      // EUR: the rate keeps 2 places (10.01), the amount is 2.5 × 10.01 = 25.025 → 25.03, not the 999 sent.
      expect(at(stored['rate'], 2)).toBe('1001');
      expect(at(stored['amount'], 2)).toBe('2503');

      // A PATCH of qty alone reads the stored rate.
      await w.update('invoice_lines', line['id'], { qty: '3' });
      stored = await row(h, 'invoice_lines', line['id']);
      expect(at(stored['amount'], 2)).toBe('3003');

      // A PATCH of the worked-out column alone changes nothing.
      await w.update('invoice_lines', line['id'], { amount: '1' });
      stored = await row(h, 'invoice_lines', line['id']);
      expect(at(stored['amount'], 2)).toBe('3003');

      // A percentage discount, then an amount.
      await w.update('invoice_lines', line['id'], { discount_kind: 'percent', discount: '10' });
      expect(at((await row(h, 'invoice_lines', line['id']))['amount'], 2)).toBe('2703');
      // 30.03 − 0.035 = 29.995: rounded once, half away from zero.
      await w.update('invoice_lines', line['id'], { discount_kind: 'amount', discount: '0.035' });
      expect(at((await row(h, 'invoice_lines', line['id']))['amount'], 2)).toBe('3000');
    });

    it('settle the document: subtotal, then tax and total, then the balance from the NEW total', async () => {
      const { h, w, client } = await harness(dialect);
      const invoice = await w.create('invoices', { client_id: client['id'], total: '5', balance: '5' });
      let doc = await row(h, 'invoices', invoice['id']);
      // No lines: the writer's total and balance are dropped, and everything is zero.
      expect([doc['subtotal'], doc['tax'], doc['total'], doc['balance']].map((v) => at(v, 2))).toEqual(['0', '0', '0', '0']);
      // The copied tax rate came back empty (the client has none): the settings' 20 %.
      expect(at(doc['tax_rate'], 3)).toBe('20000');
      expect(doc['currency']).toBe('EUR');

      await w.create('invoice_lines', { invoice_id: invoice['id'], qty: '1', rate: '100' });
      await w.create('invoice_lines', { invoice_id: invoice['id'], qty: '2', rate: '12.34' });
      doc = await row(h, 'invoices', invoice['id']);
      // 100 + 24.68 = 124.68; tax 24.936 → 24.94; total 149.62; balance = total − paid.
      expect(at(doc['subtotal'], 2)).toBe('12468');
      expect(at(doc['tax'], 2)).toBe('2494');
      expect(at(doc['total'], 2)).toBe('14962');
      expect(at(doc['balance'], 2)).toBe('14962');

      await w.create('payments', { invoice_id: invoice['id'], amount: '50' });
      doc = await row(h, 'invoices', invoice['id']);
      expect(at(doc['paid'], 2)).toBe('5000');
      expect(at(doc['balance'], 2)).toBe('9962');

      // The document's own tax rate: tax, total and balance follow.
      await w.update('invoices', invoice['id'], { tax_rate: '10' });
      doc = await row(h, 'invoices', invoice['id']);
      expect(at(doc['tax'], 2)).toBe('1247');
      expect(at(doc['total'], 2)).toBe('13715');
      expect(at(doc['balance'], 2)).toBe('8715');

      // A staff PATCH of a worked-out column is dropped.
      await w.update('invoices', invoice['id'], { total: '1', tax: '1', subtotal: '1', balance: '1' });
      doc = await row(h, 'invoices', invoice['id']);
      expect(at(doc['total'], 2)).toBe('13715');
      expect(at(doc['balance'], 2)).toBe('8715');
    });

    it('refuse a line change, or a tax rate, that takes the total below what is paid', async () => {
      const { h, w, client } = await harness(dialect);
      const invoice = await w.create('invoices', { client_id: client['id'] });
      const line = await w.create('invoice_lines', { invoice_id: invoice['id'], qty: '1', rate: '100' });
      await w.create('payments', { invoice_id: invoice['id'], amount: '110' });
      // total 120, paid 110: a rate of 50 makes the total 60.
      await expect(w.update('invoice_lines', line['id'], { rate: '50' })).rejects.toMatchObject({ code: 'BALANCE_EXCEEDED' });
      await expect(w.remove('invoice_lines', line['id'])).rejects.toMatchObject({ code: 'BALANCE_EXCEEDED' });
      // No tax: 100 < 110.
      await expect(w.update('invoices', invoice['id'], { tax_rate: '0' })).rejects.toMatchObject({ code: 'BALANCE_EXCEEDED' });
      const doc = await row(h, 'invoices', invoice['id']);
      expect(at(doc['total'], 2)).toBe('12000');
      expect(at(doc['balance'], 2)).toBe('1000');
      // A change that leaves room goes through.
      await w.update('invoice_lines', line['id'], { rate: '95' });
      expect(at((await row(h, 'invoices', invoice['id']))['balance'], 2)).toBe('400');
    });

    it('add up lines written at once on separate connections, with or without a balance on the parent', async () => {
      const { h, w, client } = await harness(dialect);
      const proposal = await w.create('proposals', { client_id: client['id'] });
      const invoice = await w.create('invoices', { client_id: client['id'] });
      const rounds = 4;
      const each = 12;
      for (let round = 0; round < rounds; round += 1) {
        await Promise.all(
          Array.from({ length: each }, (_, i) => [
            w.create('proposal_lines', { proposal_id: proposal['id'], position: i, amount: '1.25' }),
            w.create('invoice_lines', { invoice_id: invoice['id'], qty: '1', rate: '2.5' }),
          ]).flat(),
        );
      }
      const p = await row(h, 'proposals', proposal['id']);
      // 48 × 1.25 = 60; the total a formula works out from it, 120.
      expect(at(p['subtotal'], 2)).toBe('6000');
      expect(at(p['total'], 2)).toBe('12000');
      const d = await row(h, 'invoices', invoice['id']);
      // 48 × 2.5 = 120; tax 24; total 144 — all of it still to pay.
      expect([d['subtotal'], d['tax'], d['total'], d['balance']].map((v) => at(v, 2))).toEqual(['12000', '2400', '14400', '14400']);
    });

    it("keep a document's own currency's places, whatever the connection says later", async () => {
      const { h, w, client } = await harness(dialect);
      const yen = await w.create('invoices', { client_id: client['id'], currency: 'JPY' });
      await w.create('invoice_lines', { invoice_id: yen['id'], qty: '1.5', rate: '1001' });
      const dinar = await w.create('invoices', { client_id: client['id'], currency: 'KWD' });
      await w.create('invoice_lines', { invoice_id: dinar['id'], qty: '1', rate: '10.12345' });
      const euro = await w.create('invoices', { client_id: client['id'] });
      // The operator moves the connection to yen: the euro document keeps cents.
      await setConnectionCurrency(h, 'JPY');
      await w.create('invoice_lines', { invoice_id: euro['id'], qty: '1', rate: '10.555' });

      const y = await row(h, 'invoices', yen['id']);
      // 1.5 × 1001 = 1501.5 → 1502; tax 20 % = 300.4 → 300; total 1802.
      expect([y['subtotal'], y['tax'], y['total']].map((v) => at(v, 0))).toEqual(['1502', '300', '1802']);
      expect(Number(y['total'])).toBe(1802);
      const k = await row(h, 'invoices', dinar['id']);
      // 10.123 (3 places); tax 2.0246 → 2.025; total 12.148.
      expect([k['subtotal'], k['tax'], k['total']].map((v) => at(v, 3))).toEqual(['10123', '2025', '12148']);
      expect(Number(k['total'])).toBe(12.148);
      const e = await row(h, 'invoices', euro['id']);
      // 10.56 (2 places, not rounded to yen); tax 2.112 → 2.11; total 12.67.
      expect([e['subtotal'], e['tax'], e['total']].map((v) => at(v, 2))).toEqual(['1056', '211', '1267']);
      expect(Number(e['total'])).toBe(12.67);
    });

    it("fall back to the settings' tax rate only when the client's is empty", async () => {
      const { h, w } = await harness(dialect);
      const bob = await w.create('clients', { email: 'bob@example.test', tax_rate: '7.5' });
      const own = await w.create('invoices', { client_id: bob['id'] });
      expect(at((await row(h, 'invoices', own['id']))['tax_rate'], 3)).toBe('7500');
      const cleared = await w.create('clients', { email: 'cy@example.test', tax_rate: null });
      const fallback = await w.create('invoices', { client_id: cleared['id'] });
      expect(at((await row(h, 'invoices', fallback['id']))['tax_rate'], 3)).toBe('20000');
    });

    it("never keep what a before hook put in a worked-out column", async () => {
      const { h } = await harness(dialect);
      const hooks: RecordHooks = {
        wants: async (timing) => timing === 'before',
        before: async (event) => {
          if (event.values['qty'] !== undefined) event.values['amount'] = '999';
        },
        after: async () => {},
      };
      const w = await settledWriter(h, { hooks });
      const client = await w.create('clients', { email: 'dee@example.test' });
      const invoice = await w.create('invoices', { client_id: client['id'] });
      const line = await w.create('invoice_lines', { invoice_id: invoice['id'], qty: '2', rate: '3' });
      expect(at((await row(h, 'invoice_lines', line['id']))['amount'], 2)).toBe('600');
      await w.update('invoice_lines', line['id'], { qty: '4' });
      expect(at((await row(h, 'invoice_lines', line['id']))['amount'], 2)).toBe('1200');
      // And a multi-row path (a hook runs per row, inside the form's transaction): the same.
      const [prepared] = await w.db.transaction().execute((trx) =>
        w.writes.beforeEach('update', { ...w.targetOf('invoice_lines'), db: trx }, w.desk, [
          { match: { id: line['id'] }, values: w.prepared('invoice_lines', { qty: '5' }) },
        ]),
      );
      expect(at(prepared!.values['amount'], 2)).toBe('1500');
      // Outside one, a change that moves the document's total is refused (the balance could not be judged);
      // one that moves no total goes through.
      await expect(
        w.writes.beforeEach('update', w.targetOf('invoice_lines'), w.desk, [{ match: { id: line['id'] }, values: w.prepared('invoice_lines', { qty: '5' }) }]),
      ).rejects.toMatchObject({ details: { reason: 'BALANCE_ONE_AT_A_TIME' } });
      const [moved] = await w.writes.beforeEach('update', w.targetOf('invoice_lines'), w.desk, [
        { match: { id: line['id'] }, values: w.prepared('invoice_lines', { position: 2 }) },
      ]);
      expect(moved!.issues).toBeNull();
    });
  });
}
