// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The invoicing app of `invoicing-install.helpers.ts`, with what the write
 * path's tests need beside it: lines and payments that carry their document's
 * currency, a discount that is an amount or a percentage, a write service
 * that reads the meta store's settings (the connection's currency, an
 * add-on's settings), and an INDEPENDENT reference for the money — integer
 * minor units in big integers, written here, never the manifest's evaluator.
 */
import { parseDatabaseModel } from '@adminium/engine';
import { overridesRepo, snapshotsRepo } from '@adminium/meta';

import { applyOverrides } from '../src/connections/effective-schema.js';
import { SnapshotView } from '../src/crud/identifiers.js';
import { createWriteService, type RecordHooks, type WriteContext, type WriteTarget } from '../src/crud/write-service.js';
import { writeStores } from '../src/crud/write-stores.js';
import { normalizeWriteValue } from '../src/crud/write-values.js';
import { invoicingManifest, invoicingTables, type InvoicingHarness } from './invoicing-install.helpers.js';

type Table = { ref: string; columns: Record<string, unknown>[] } & Record<string, unknown>;

const currencyCopy = { ref: 'currency', type: 'text', maxLength: 3, nullable: true, rules: { copy: { via: 'invoice_id', from: 'currency', mode: 'always' } } };

/**
 * The fixture's tables with lines and payments that carry the document's
 * currency (so each is rounded at the document's places), and a line discount
 * that is an amount or a percentage of the line.
 */
export function writeTables(): Record<string, unknown>[] {
  return (invoicingTables() as Table[]).map((table) => {
    if (table.ref === 'invoice_lines') {
      return {
        ...table,
        columns: [
          ...table.columns.filter((c) => !['discount', 'amount'].includes(String(c['ref']))),
          currencyCopy,
          { ref: 'discount_kind', type: 'enum', enum: ['amount', 'percent'], default: 'amount' },
          { ref: 'discount', type: 'decimal', scale: 3, nullable: true },
          {
            ref: 'amount',
            type: 'decimal',
            scale: 'currency',
            nullable: true,
            rules: {
              formula: {
                max: [
                  0,
                  {
                    sub: [
                      { mul: ['qty', 'rate'] },
                      { if: [{ eq: ['discount_kind', 'percent'] }, { div: [{ mul: ['qty', 'rate', { coalesce: ['discount', 0] }] }, 100] }, { coalesce: ['discount', 0] }] },
                    ],
                  },
                ],
              },
            },
          },
        ],
      };
    }
    // A payment carries its document's currency, and a receipt number from a series of its own.
    if (table.ref === 'payments') {
      return {
        ...table,
        columns: [
          ...table.columns,
          currencyCopy,
          { ref: 'receipt_seq', type: 'int', nullable: true, rules: { sequence: { gapless: true } } },
          { ref: 'receipt', type: 'text', maxLength: 24, nullable: true, rules: { format: { from: 'receipt_seq', prefix: 'RCT-', pad: 4 } } },
        ],
      };
    }
    // A proposal keeps totals and no balance: nothing about money makes a write hold it but its totals.
    if (table.ref === 'proposals') {
      return {
        ...table,
        columns: [
          ...table.columns,
          { ref: 'subtotal', type: 'decimal', scale: 2, nullable: true, rules: { rollup: { from: 'proposal_lines', via: 'proposal_id', sum: 'amount' } } },
          { ref: 'total', type: 'decimal', scale: 2, nullable: true, rules: { formula: { mul: ['subtotal', 2] } } },
        ],
      };
    }
    return table;
  });
}

export function writeManifest(): Record<string, unknown> {
  return invoicingManifest(writeTables());
}

/** The write service over the installed tables, reading the meta store's settings as compose wires it. */
export async function settledWriter(h: InvoicingHarness, opts: { hooks?: RecordHooks } = {}) {
  const snapshot = (await snapshotsRepo(h.meta).latest(h.connectionId))!;
  const view = new SnapshotView(
    h.connectionId,
    applyOverrides(parseDatabaseModel(snapshot.schema), await overridesRepo(h.meta).listForConnection(h.connectionId, { status: 'active' })),
    new Map(),
  );
  const { db, dialect } = await h.manager.data(h.connectionId);
  const targetOf = (ref: string): WriteTarget => ({
    connectionId: h.connectionId,
    view,
    table: view.table(view.model.tables.find((t) => t.name === h.real(ref))!.id),
    db,
    dialect,
    timezone: 'Europe/London',
  });
  const writes = createWriteService({ ...writeStores(h.meta), ...(opts.hooks === undefined ? {} : { hooks: () => opts.hooks! }) });
  const desk: WriteContext = { origin: 'dashboard', hops: 0, actor: { kind: 'user', id: 'usr_ivy', label: 'Ivy Ferreira' }, request: null };
  const prepared = (ref: string, values: Record<string, unknown>) => {
    const table = targetOf(ref).table;
    return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, normalizeWriteValue(table.columns.get(k)!, v)]));
  };
  return {
    view,
    db,
    dialect,
    targetOf,
    writes,
    desk,
    prepared,
    create: (ref: string, values: Record<string, unknown>, context: WriteContext = desk) =>
      writes.create({ target: targetOf(ref), values: prepared(ref, values), context, announce: async () => {} }),
    update: (ref: string, id: unknown, values: Record<string, unknown>, context: WriteContext = desk) =>
      writes.update({ target: targetOf(ref), pk: { id }, values: prepared(ref, values), context, announce: async () => {} }),
    remove: (ref: string, id: unknown, context: WriteContext = desk) =>
      writes.delete({ target: targetOf(ref), pk: { id }, context, announce: async () => {} }),
  };
}

/** The connection's currency, as the operator sets it in Connections. */
export async function setConnectionCurrency(h: InvoicingHarness, currency: string | null): Promise<void> {
  await h.meta.db.updateTable('adminium_connections').set({ currency } as never).where('id', '=', h.connectionId).execute();
}

/** The studio's one settings row, written straight into the table. */
export async function seedSettings(h: InvoicingHarness, values: { prefix?: string; start?: number; taxRate?: number } = {}): Promise<void> {
  await h.rows(
    `insert into ${h.real('settings')} (singleton, invoice_prefix, invoice_start, tax_rate) values ('studio', '${values.prefix ?? 'INV-'}', ${String(values.start ?? 2040)}, ${String(values.taxRate ?? 20)})`,
  );
}

// ── the reference: integer minor units, big integers, half away from zero ──

/** A decimal value as it came back from a driver (`"12.3400"`, `12.34`, `12`) in units of 10^-places, exactly. */
export function units(value: unknown, places: number): bigint {
  if (value === null || value === undefined) throw new Error('an empty amount');
  if (typeof value === 'number') {
    // A float read back from SQLite: only binary noise may sit past the places, never a digit.
    const scaled = value * 10 ** places;
    const whole = Math.round(scaled);
    if (Math.abs(scaled - whole) > 1e-6 * Math.max(1, Math.abs(scaled))) throw new Error(`${String(value)} has more than ${String(places)} places`);
    return BigInt(whole);
  }
  const text = String(value).trim();
  const negative = text.startsWith('-');
  const [whole = '0', fraction = ''] = text.replace(/^[-+]/, '').split('.');
  const kept = (fraction + '0'.repeat(places)).slice(0, places);
  if (/[1-9]/.test(fraction.slice(places))) throw new Error(`${text} has more than ${String(places)} places`);
  const n = BigInt(whole || '0') * 10n ** BigInt(places) + BigInt(kept || '0');
  return negative ? -n : n;
}

/** n / d rounded half away from zero. */
export function divRound(n: bigint, d: bigint): bigint {
  if (d < 0n) return divRound(-n, -d);
  const negative = n < 0n;
  const m = negative ? -n : n;
  let q = m / d;
  if ((m % d) * 2n >= d) q += 1n;
  return negative ? -q : q;
}

/** A decimal string rounded to `places` → units of 10^-places. */
export function roundText(text: string, places: number): bigint {
  const [whole = '0', fraction = ''] = text.split('.');
  const scale = fraction.length;
  const n = BigInt(whole + fraction);
  return scale <= places ? n * 10n ** BigInt(places - scale) : divRound(n, 10n ** BigInt(scale - places));
}

export interface RefLine {
  qty: string; // 3 decimals
  rate: string; // up to 4 decimals, rounded to the currency's places on write
  kind: 'amount' | 'percent';
  discount: string | null; // up to 3 decimals
}

/** A line's amount in minor units: max(0, qty × rate − discount), the discount an amount or a percentage of qty × rate. */
export function refLine(line: RefLine, places: number): bigint {
  const qty = roundText(line.qty, 3); // thousandths
  const rate = roundText(line.rate, places); // minor units
  const discount = line.discount === null ? 0n : roundText(line.discount, 3); // thousandths
  // qty × rate in minor units is gross / 1000.
  const gross = qty * rate;
  const amount =
    line.kind === 'percent'
      ? // gross × (1 − discount%), the percentage in thousandths: gross × (100000 − d) / (1000 × 100000)
        divRound(gross * (100_000n - discount), 100_000_000n)
      : // gross − the discount, in thousandths of a unit: (gross − d × 10^places) / 1000
        divRound(gross - discount * 10n ** BigInt(places), 1000n);
  return amount < 0n ? 0n : amount;
}

/** The document's figures in minor units. */
export function refDocument(lines: readonly RefLine[], taxRate: string, places: number, payments: readonly bigint[]) {
  const subtotal = lines.reduce((sum, line) => sum + refLine(line, places), 0n);
  const rate = roundText(taxRate, 3); // thousandths of a percent
  const tax = divRound(subtotal * rate, 100_000n);
  const total = subtotal + tax;
  const paid = payments.reduce((sum, p) => sum + p, 0n);
  return { lines: lines.map((line) => refLine(line, places)), subtotal, tax, total, paid, balance: total - paid };
}

/** Minor units as decimal text at `places`. */
export function text(minor: bigint, places: number): string {
  const negative = minor < 0n;
  const digits = (negative ? -minor : minor).toString().padStart(places + 1, '0');
  return `${negative ? '-' : ''}${places === 0 ? digits : `${digits.slice(0, -places)}.${digits.slice(-places)}`}`;
}
