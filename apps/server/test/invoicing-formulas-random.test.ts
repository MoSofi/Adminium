// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A thousand random invoices, written through the write path into the real
 * installed tables, agree with an independent reference to the minor unit on
 * every engine: each line's amount, the subtotal, tax, total, what is paid
 * and the balance.
 *
 * The reference (`invoicing-writes.helpers.ts`) counts in integer minor units
 * with big integers and rounds half away from zero — it shares no code with
 * the manifest's evaluator the server uses. The documents mix currencies with
 * 0, 2 and 3 decimals (JPY, EUR, KWD), quantities with 3 decimals, rates with
 * more places than the currency keeps (the write rounds them), discounts as an
 * amount or a percentage, tax rates from 0 to 25 % (or none on the client, so
 * the settings' rate), and payments up to what is left to pay.
 */
import { currencyScale } from '@adminium/manifest';
import { afterAll, describe, expect, it } from 'vitest';

import { LEGS, installInvoicing, type InvoicingHarness } from './invoicing-install.helpers.js';
import {
  refDocument,
  roundText,
  seedSettings,
  setConnectionCurrency,
  settledWriter,
  text,
  units,
  writeManifest,
  type RefLine,
} from './invoicing-writes.helpers.js';

const DOCUMENTS = Number(process.env.INVOICING_RANDOM_DOCUMENTS ?? 1000);
const CURRENCIES = ['JPY', 'EUR', 'KWD'] as const;

/** A small seeded generator, so a failure names a document that can be written again. */
function generator(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  /** A decimal between 0 and max with exactly `places` digits after the point. */
  const decimal = (max: number, places: number) => {
    const n = int(0, max * 10 ** places);
    return places === 0 ? String(n) : `${String(Math.floor(n / 10 ** places))}.${String(n % 10 ** places).padStart(places, '0')}`;
  };
  return { next, int, decimal, pick: <T>(list: readonly T[]) => list[int(0, list.length - 1)]! };
}

interface Planned {
  currency: (typeof CURRENCIES)[number];
  client: number;
  lines: RefLine[];
  /** Each payment as a share of what is left, 0–1. */
  payments: number[];
}

const opened: InvoicingHarness[] = [];
afterAll(async () => {
  for (const h of opened) await h.close();
});

for (const [dialect, available] of LEGS) {
  describe.skipIf(!available)(`${String(DOCUMENTS)} random invoices on ${dialect}`, () => {
    it('agree with the reference to the minor unit', { timeout: 600_000 }, async () => {
      const h = await installInvoicing(dialect, writeManifest());
      opened.push(h);
      await seedSettings(h, { taxRate: 20 });
      await setConnectionCurrency(h, 'EUR');
      const w = await settledWriter(h);
      const g = generator(57_2026);

      // Clients with a tax rate of their own (0–25 %, three places), and two with none: the settings' 20 %.
      const clients: { id: unknown; taxRate: string }[] = [];
      for (let i = 0; i < 12; i += 1) {
        const own = i < 10 ? g.decimal(25, 3) : null;
        const row = await w.create('clients', { email: `c${String(i)}@example.test`, tax_rate: own });
        clients.push({ id: row['id'], taxRate: own ?? '20' });
      }

      const plans: Planned[] = [];
      for (let i = 0; i < DOCUMENTS; i += 1) {
        const lines: RefLine[] = [];
        for (let n = g.int(1, 4); n > 0; n -= 1) {
          const kind = g.next() < 0.5 ? 'amount' : 'percent';
          const discount = g.next() < 0.3 ? null : kind === 'percent' ? g.decimal(100, 3) : g.decimal(g.pick([5, 50, 5000]), 3);
          lines.push({ qty: g.decimal(20, 3), rate: g.decimal(g.pick([1, 50, 500, 20000]), 4), kind, discount });
        }
        const payments = Array.from({ length: g.int(0, 2) }, () => g.next());
        plans.push({ currency: g.pick(CURRENCIES), client: g.int(0, clients.length - 1), lines, payments });
      }

      /** One document, written as the dashboard writes it; returns what the reference says it must hold. */
      const write = async (plan: Planned) => {
        const places = currencyScale(plan.currency);
        const client = clients[plan.client]!;
        const invoice = await w.create('invoices', { client_id: client.id, currency: plan.currency });
        const lineIds: unknown[] = [];
        for (const line of plan.lines) {
          const row = await w.create('invoice_lines', {
            invoice_id: invoice['id'],
            qty: line.qty,
            rate: line.rate,
            discount_kind: line.kind,
            discount: line.discount,
          });
          lineIds.push(row['id']);
        }
        const paid: bigint[] = [];
        let left = refDocument(plan.lines, client.taxRate, places, []).total;
        for (const share of plan.payments) {
          const amount = BigInt(Math.floor(Number(left) * share));
          if (amount <= 0n) continue;
          await w.create('payments', { invoice_id: invoice['id'], amount: text(amount, places) });
          paid.push(amount);
          left -= amount;
        }
        return { id: invoice['id'], lineIds, places, expected: refDocument(plan.lines, client.taxRate, places, paid) };
      };

      // Eight documents at a time: the engines see real concurrent writers.
      const written: Awaited<ReturnType<typeof write>>[] = [];
      for (let i = 0; i < plans.length; i += 8) written.push(...(await Promise.all(plans.slice(i, i + 8).map(write))));

      const invoices = new Map((await h.rows(`select * from ${h.real('invoices')}`)).map((row) => [String(row['id']), row]));
      const lines = new Map((await h.rows(`select * from ${h.real('invoice_lines')}`)).map((row) => [String(row['id']), row]));
      const mismatches: string[] = [];
      for (const [index, doc] of written.entries()) {
        const row = invoices.get(String(doc.id))!;
        const got = (column: string) => units(row[column], doc.places);
        const want = doc.expected;
        for (const [column, value] of Object.entries({ subtotal: want.subtotal, tax: want.tax, total: want.total, paid: want.paid, balance: want.balance })) {
          if (got(column) !== value) mismatches.push(`document ${String(index)} ${column}: ${text(got(column), doc.places)} ≠ ${text(value, doc.places)}`);
        }
        for (const [n, id] of doc.lineIds.entries()) {
          const amount = units(lines.get(String(id))!['amount'], doc.places);
          if (amount !== want.lines[n]) mismatches.push(`document ${String(index)} line ${String(n)}: ${text(amount, doc.places)} ≠ ${text(want.lines[n]!, doc.places)}`);
        }
        // A rate is kept at the currency's places.
        const firstLine = lines.get(String(doc.lineIds[0]))!;
        if (units(firstLine['rate'], doc.places) !== roundText(plans[index]!.lines[0]!.rate, doc.places)) mismatches.push(`document ${String(index)} rate`);
      }
      expect(mismatches.slice(0, 20)).toEqual([]);
      expect(written).toHaveLength(DOCUMENTS);
    });
  });
}
