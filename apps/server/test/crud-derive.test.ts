// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Derived fields end to end — the `compute=` param's arithmetic half
 * (WS-C /).
 *
 * The five numbers the feature exists for, computed on a real read, plus the
 * two properties that are not about arithmetic at all:
 *
 * - **list/record parity.** The same row must answer the same values and the
 *   same markers through `GET /data/:c/:table` and `GET /data/:c/:table/:id`.
 *   They are different code paths (a projection-widened SELECT versus
 *   `selectAll` + per-record fetches) and the plan puts the evaluator in the
 *   same position on both so they cannot diverge.
 * - **poisoning.** A refused operand refuses its whole field — INCLUDING
 *   through a `cases` predicate, because a conditional evaluated over an
 *   unreadable input leaks one bit per row (D11). An unmarked null is a
 *   different state with a different rule: it absorbs, and the cell renders an
 *   em-dash rather than masked dots.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  asUser,
  buildDataTestApp,
  createConnectionViaApi,
  introspectViaApi,
  type DataTestContext,
} from './connections-helpers.js';
import { makeFakeRegistry, seedSqlite } from './crud-measures-fixture.js';

type Json = Record<string, unknown>;

const ITEMS = { table: 'main.invoice_items', fkColumn: 'invoice_id' } as const;

/** The plan's worked example, verbatim — all five asks against this schema. */
const OWNERS_BLOCK: Json = {
  measures: [
    {
      id: 'subtotal',
      ...ITEMS,
      fn: 'sum',
      of: { terms: [{ sign: 'plus', factors: ['line_total'] }] },
    },
    { id: 'gross', ...ITEMS, fn: 'sum', of: { terms: [{ sign: 'plus', factors: ['qty', 'rate'] }] } },
  ],
  fields: [
    {
      id: 'discount_total',
      scale: 2,
      expr: { op: 'sub', args: [{ measure: 'gross' }, { measure: 'subtotal' }] },
    },
    {
      id: 'tax_amount',
      scale: 2,
      expr: {
        op: 'mul',
        args: [{ measure: 'subtotal' }, { op: 'div', args: [{ col: 'tax_rate' }, { lit: '100' }] }],
      },
    },
    {
      id: 'total',
      scale: 2,
      expr: { op: 'add', args: [{ measure: 'subtotal' }, { field: 'tax_amount' }] },
    },
    {
      id: 'shipping',
      scale: 2,
      expr: {
        cases: [
          { when: { left: { field: 'total' }, cmp: 'gte', right: { lit: '500' } }, then: { lit: '0' } },
        ],
        else: { lit: '12.50' },
      },
    },
  ],
};

describe('CRUD derived fields (fake adapter)', () => {
  let t: DataTestContext;
  let connId: string;

  beforeAll(async () => {
    t = await buildDataTestApp({ registry: makeFakeRegistry(seedSqlite()) });
    connId = await createConnectionViaApi(t, 'postgres://fake@fake-host:5432/invdb');
    await introspectViaApi(t, connId);
    await t.grantTable(t.roles.admin, connId, '*', {
      read: true,
      create: true,
      update: true,
      delete: true,
    });
    await t.grantTable(t.roles.viewer, connId, '*', { read: true });
    // The editor may read invoices but NOT invoice_items — the degrade case.
    await t.grantTable(t.roles.editor, connId, 'main.invoices', { read: true });
  });

  afterAll(async () => {
    await t.app.close();
  });

  const compute = (block: Json): string => encodeURIComponent(JSON.stringify(block));

  interface ListBody {
    data: Record<string, unknown>[];
  }

  const list = async (
    query: string,
    user = t.users.admin,
  ): Promise<{ status: number; body: ListBody }> => {
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/v1/data/${connId}/main.invoices?${query}`,
      headers: asUser(user),
    });
    return { status: res.statusCode, body: res.json() as ListBody };
  };

  const record = async (
    id: number,
    query: string,
    user = t.users.admin,
  ): Promise<{ status: number; data: Record<string, unknown> }> => {
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/v1/data/${connId}/main.invoices/${String(id)}?${query}`,
      headers: asUser(user),
    });
    return { status: res.statusCode, data: (res.json() as { data: Record<string, unknown> }).data };
  };

  const invoice = (body: ListBody, id: number): Record<string, unknown> => {
    const row = body.data.find((entry) => entry['invoice_id'] === id);
    expect(row, `invoice ${String(id)}`).toBeDefined();
    return row as Record<string, unknown>;
  };

  // --- the five numbers -----------------------------------------------------

  describe("the owner's five numbers, on a real read", () => {
    it('computes all of them, and the conditional takes each branch', async () => {
      const { status, body } = await list(
        `compute=${compute(OWNERS_BLOCK)}&select=invoice_id&order=invoice_id.asc`,
      );
      expect(status).toBe(200);

      // Invoice 7: gross 1300, net 1266, tax_rate 8.00.
      expect(invoice(body, 7)).toMatchObject({
        subtotal: '1266',
        gross: '1300',
        discount_total: '34.00',
        tax_amount: '101.28',
        total: '1367.28',
        shipping: '0.00', // over the threshold
      });
      // Invoice 8: one line, no discount, under the threshold.
      expect(invoice(body, 8)).toMatchObject({
        discount_total: '0.00',
        tax_amount: '9.60',
        total: '129.60',
        shipping: '12.50',
      });
    });

    it('reads the UNROUNDED earlier field, not its displayed value (D7)', async () => {
      // total = subtotal + tax_amount, where tax_amount's own working value
      // carries six digits. Rounding at every hop is how `1.0049 x 3` becomes
      // 3.00 instead of 3.01; here it would move the cent on 1367.28.
      const { data } = await record(7, `compute=${compute(OWNERS_BLOCK)}`);
      expect(data['tax_amount']).toBe('101.28');
      expect(data['total']).toBe('1367.28');
    });

    it('answers the empty-fold lattice without calling any of it a refusal', async () => {
      const block: Json = {
        measures: [
          ...(OWNERS_BLOCK['measures'] as Json[]),
          { id: 'avg_rate', ...ITEMS, fn: 'avg', of: { terms: [{ sign: 'plus', factors: ['rate'] }] } },
        ],
        fields: [
          ...(OWNERS_BLOCK['fields'] as Json[]),
          { id: 'avg_plus_one', scale: 2, expr: { op: 'add', args: [{ measure: 'avg_rate' }, { lit: '1' }] } },
        ],
      };
      const { body } = await list(`compute=${compute(block)}&select=invoice_id`);
      const empty = invoice(body, 9); // no line items at all
      expect(empty['subtotal']).toBe('0'); // sum defaults to zero...
      expect(empty['total']).toBe('0.00'); // ...so the chain is a real number
      expect(empty['shipping']).toBe('12.50');
      // ...while an unmarked null ABSORBS: the average of nothing is not zero,
      // and a field reading it is absent, not refused.
      expect(empty['avg_rate']).toBeNull();
      expect(empty['avg_plus_one']).toBeNull();
      expect(empty['_masked']).toBeUndefined();
    });
  });

  // --- parity ---------------------------------------------------------------

  it('answers identically on the list and the single-record GET', async () => {
    const query = `compute=${compute(OWNERS_BLOCK)}`;
    const { body } = await list(`${query}&select=invoice_id`);
    const { data } = await record(7, query);
    const ids = ['subtotal', 'gross', 'discount_total', 'tax_amount', 'total', 'shipping'];
    const fromList = Object.fromEntries(ids.map((id) => [id, invoice(body, 7)[id]]));
    const fromRecord = Object.fromEntries(ids.map((id) => [id, data[id]]));
    expect(fromRecord).toEqual(fromList);
  });

  it('answers identically for a caller whose measures are refused', async () => {
    // No `select=` here, deliberately: the record GET reads every column, so a
    // narrowed list would carry a SHORTER marker for a reason that has nothing
    // to do with derived fields (a base column that was never projected cannot
    // be masked). Comparing the full projections keeps the assertion about the
    // thing it names.
    const query = `compute=${compute(OWNERS_BLOCK)}`;
    const { body } = await list(query, t.users.editor);
    const { data } = await record(7, query, t.users.editor);
    expect(data['total']).toBe(invoice(body, 7)['total']);
    expect(data['_masked']).toEqual(invoice(body, 7)['_masked']);
  });

  // --- poisoning ------------------------------------------------------------

  describe('a refusal poisons the whole expression', () => {
    it('refuses every field downstream of a refused measure, and marks each', async () => {
      const { status, body } = await list(
        `compute=${compute(OWNERS_BLOCK)}&select=invoice_id`,
        t.users.editor,
      );
      expect(status).toBe(200); // the base table still serves
      const row = invoice(body, 7);
      expect(row['subtotal']).toBeNull();
      expect(row['discount_total']).toBeNull();
      expect(row['tax_amount']).toBeNull();
      expect(row['total']).toBeNull();
      // The one that matters: `shipping` branches on `total`. A `12.50` here
      // would be a readable answer computed from an unreadable input.
      expect(row['shipping']).toBeNull();
      expect(row['_masked']).toEqual(
        expect.arrayContaining(['subtotal', 'gross', 'discount_total', 'tax_amount', 'total', 'shipping']),
      );
    });

    it('separates a masked operand from an absent one on the same expression', async () => {
      // A rule pointed at a text column. The arithmetic is nonsense on purpose
      // — what is being tested is which of the three states each caller sees.
      const block: Json = {
        measures: [],
        fields: [
          {
            id: 'flag',
            scale: 0,
            expr: {
              cases: [
                { when: { left: { col: 'contact_email' }, cmp: 'gt', right: { lit: '0' } }, then: { lit: '1' } },
              ],
              else: { lit: '0' },
            },
          },
        ],
      };
      // A viewer has no unmask grant: `contact_email` arrives null + marked,
      // so the predicate is REFUSED and the field joins the marker.
      const masked = await list(`compute=${compute(block)}&select=invoice_id`, t.users.viewer);
      expect(invoice(masked.body, 7)['flag']).toBeNull();
      expect(invoice(masked.body, 7)['_masked']).toContain('flag');
      // An admin reads the value; it simply is not a number, so the operand is
      // ABSENT — the predicate is not true and the chain falls to `else`.
      const readable = await list(`compute=${compute(block)}&select=invoice_id`, t.users.admin);
      expect(invoice(readable.body, 7)['flag']).toBe('0');
      expect(invoice(readable.body, 7)['_masked']).toBeUndefined();
    });
  });

  // --- projection and refusals ---------------------------------------------

  describe('the columns a field reads', () => {
    it('rides along in the projection, the way the primary key already does', async () => {
      // `tax_rate` is not in `select=`, but `tax_amount` cannot be computed
      // without it. Merged into the SELECT list rather than pushed through
      // `select=`, which would 403 on a masked column instead of degrading.
      const { body } = await list(`compute=${compute(OWNERS_BLOCK)}&select=invoice_id`);
      const row = invoice(body, 7);
      expect(row['tax_amount']).toBe('101.28');
      expect(row['tax_rate']).toBeDefined();
      expect(row['number']).toBeUndefined(); // nothing else widened
    });

    it('refuses a derived alias in `order=` — projections are not sortable', async () => {
      const { status } = await list(`compute=${compute(OWNERS_BLOCK)}&order=total.desc`);
      expect(status).toBe(422);
    });

    it('refuses an id that would claim the refusal marker itself', async () => {
      const { status } = await list(
        `compute=${compute({ measures: [], fields: [{ id: '_masked', scale: 2, expr: { lit: '1' } }] })}`,
      );
      expect(status).toBe(422);
    });

    it('refuses the same alias on the two older projection families', async () => {
      // Same hole, same age: the shared alias grammar has admitted a leading
      // underscore since `agg=` shipped, and an alias of `_masked` overwrites
      // the marker rather than shadowing a column, so the existing
      // `table.columns.has(alias)` check never saw it.
      const agg = await list(
        `agg=${encodeURIComponent('_masked:main.invoice_items.invoice_id:count')}`,
      );
      expect(agg.status).toBe(422);
      const lookup = await list(`lookup=${encodeURIComponent('_masked:invoice_id.number')}`);
      expect(lookup.status).toBe(422);
    });
  });
});
