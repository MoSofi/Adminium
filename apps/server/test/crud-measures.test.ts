// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Measures on the CRUD read endpoints — the `compute=` param's fold half
 * (WS-B).
 *
 * What is actually being pinned here, beyond "the numbers are right":
 *
 * - the EMITTED fold fragment is parenthesized and carries no division, and
 *   `of.factor` appears nowhere in the SQL (D5/D6, criterion 4);
 * - every column that reaches the subquery joins the refusal check, and a
 *   SECRET base-side correlate refuses where it used to disclose (D16);
 * - a refused projection writes an audit row, closing the gap where the
 *   refusals that DEGRADE were the ones invisible to the trail;
 * - the envelope bounds CPU, not just bytes — the case the byte cap cannot
 *   see is a deep payload well under it.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { parseCrudDerived } from '@adminium/engine/config';

import { MAX_COMPUTE_BYTES, MAX_COMPUTE_DEPTH } from '../src/crud/compute.js';
import {
  asUser,
  buildDataTestApp,
  createConnectionViaApi,
  introspectViaApi,
  type DataTestContext,
} from './connections-helpers.js';
import { makeFakeRegistry, seedSqlite } from './crud-measures-fixture.js';
import { createSqlSink, lastSelectFrom, type SqlSink } from './sql-recorder.js';

type Json = Record<string, unknown>;

const ITEMS = { table: 'main.invoice_items', fkColumn: 'invoice_id' } as const;

/** `sum(line_total)` — ask 1. */
const SUBTOTAL = {
  id: 'subtotal',
  ...ITEMS,
  fn: 'sum',
  of: { terms: [{ sign: 'plus', factors: ['line_total'] }] },
};
/** `sum(qty * rate)` — the gross the schema never stores. */
const GROSS = {
  id: 'gross',
  ...ITEMS,
  fn: 'sum',
  of: { terms: [{ sign: 'plus', factors: ['qty', 'rate'] }] },
};

describe('CRUD measures (fake adapter)', () => {
  let t: DataTestContext;
  let connId: string;
  let sink: SqlSink;

  beforeAll(async () => {
    sink = createSqlSink();
    t = await buildDataTestApp({ registry: makeFakeRegistry(seedSqlite(), sink) });
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
    sink.queries.length = 0;
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/v1/data/${connId}/main.invoices?${query}`,
      headers: asUser(user),
    });
    return { status: res.statusCode, body: res.json() as ListBody };
  };

  const invoice = (body: ListBody, id: number): Record<string, unknown> => {
    const row = body.data.find((entry) => entry['invoice_id'] === id);
    expect(row, `invoice ${String(id)}`).toBeDefined();
    return row as Record<string, unknown>;
  };

  // ---: what actually reaches the database ---------------------------

  describe('the emitted fold', () => {
    it('parenthesizes every term and qualifies every column', async () => {
      const { status } = await list(
        `compute=${compute({
          measures: [
            {
              id: 'discount',
              ...ITEMS,
              fn: 'sum',
              of: {
                terms: [
                  { sign: 'plus', factors: ['qty', 'rate'] },
                  { sign: 'minus', factors: ['line_total'] },
                ],
              },
            },
          ],
        })}&select=invoice_id`,
      );
      expect(status).toBe(200);
      // The defect this guards is not a wrong query shape, it is a wrong
      // NUMBER: kysely's `eb(ref, op, ref)` binds the right-hand REFERENCE as
      // a parameter and nested `eb()` drops the parentheses (D5).
      expect(lastSelectFrom(sink, 'main.invoices')).toContain(
        'sum(("ag0"."qty" * "ag0"."rate") - ("ag0"."line_total"))',
      );
    });

    it('sends no division and no factor — both are applied in BigInt afterwards', async () => {
      const { status } = await list(
        `compute=${compute({
          measures: [
            {
              id: 'discount',
              ...ITEMS,
              fn: 'sum',
              of: { terms: [{ sign: 'plus', factors: ['qty', 'rate', 'discount_pct'] }], factor: '0.01' },
            },
          ],
        })}&select=invoice_id`,
      );
      expect(status).toBe(200);
      const sql = lastSelectFrom(sink, 'main.invoices');
      const fragment = sql.slice(sql.indexOf('sum('), sql.indexOf(' as "n"'));
      // Asserted on the measure's own fragment: a schema-qualified name makes
      // a naked grep over the whole statement meaningless (criterion 4).
      expect(fragment).toBe('sum(("ag0"."qty" * "ag0"."rate" * "ag0"."discount_pct"))');
      expect(fragment).not.toContain('/');
      expect(sql).not.toContain('0.01');
    });

    it('keeps count on the expression the wire has always emitted', async () => {
      const { status } = await list(
        `compute=${compute({ measures: [{ id: 'items', ...ITEMS, fn: 'count' }] })}&select=invoice_id`,
      );
      expect(status).toBe(200);
      expect(lastSelectFrom(sink, 'main.invoices')).toContain('select count(*) as "n"');
    });
  });

  // --- values ---------------------------------------------------------------

  describe('the numbers', () => {
    it('folds sum, avg, min, max and count over one relation', async () => {
      const { status, body } = await list(
        `compute=${compute({
          measures: [
            SUBTOTAL,
            GROSS,
            { id: 'avg_rate', ...ITEMS, fn: 'avg', of: { terms: [{ sign: 'plus', factors: ['rate'] }] } },
            { id: 'cheapest', ...ITEMS, fn: 'min', of: { terms: [{ sign: 'plus', factors: ['rate'] }] } },
            { id: 'dearest', ...ITEMS, fn: 'max', of: { terms: [{ sign: 'plus', factors: ['rate'] }] } },
            { id: 'items', ...ITEMS, fn: 'count' },
          ],
        })}&select=invoice_id`,
      );
      expect(status).toBe(200);
      const row = invoice(body, 7);
      expect(row['subtotal']).toBe('1266');
      expect(row['gross']).toBe('1300');
      expect(row['avg_rate']).toBe('400');
      expect(row['cheapest']).toBe('300');
      expect(row['dearest']).toBe('500');
      // count stays a NUMBER — the shape `agg=` has always returned.
      expect(row['items']).toBe(2);
    });

    it('applies of.factor after the fetch, and the two discount formulas differ', async () => {
      const { status, body } = await list(
        `compute=${compute({
          measures: [
            SUBTOTAL,
            GROSS,
            {
              id: 'discount_fold',
              ...ITEMS,
              fn: 'sum',
              of: { terms: [{ sign: 'plus', factors: ['qty', 'rate', 'discount_pct'] }], factor: '0.01' },
            },
          ],
        })}&select=invoice_id`,
      );
      expect(status).toBe(200);
      const row = invoice(body, 7);
      // `sum(qty*rate*discount_pct) x 0.01` against `sum(qty*rate) - sum(line_total)`.
      // They are NOT the same number: a stored line_total rounds per line. The
      // plan refuses to claim they are interchangeable (D19) — here is the gap.
      expect(row['discount_fold']).toBe('33.9999');
      expect(row['gross']).toBe('1300');
      expect(row['subtotal']).toBe('1266');
    });

    it('reads an empty fold per the declared policy, not as a refusal', async () => {
      const { status, body } = await list(
        `compute=${compute({
          measures: [
            SUBTOTAL,
            { id: 'avg_rate', ...ITEMS, fn: 'avg', of: { terms: [{ sign: 'plus', factors: ['rate'] }] } },
            {
              id: 'strict_subtotal',
              ...ITEMS,
              fn: 'sum',
              of: { terms: [{ sign: 'plus', factors: ['line_total'] }] },
              emptyAs: 'null',
            },
          ],
        })}&select=invoice_id`,
      );
      expect(status).toBe(200);
      const empty = invoice(body, 9); // invoice 9 has no line items
      expect(empty['subtotal']).toBe('0'); // sum defaults to zero
      expect(empty['avg_rate']).toBeNull(); // the average of nothing is not zero
      expect(empty['strict_subtotal']).toBeNull(); // authorable per measure
      // Neither is a refusal: nothing joins the masked marker.
      expect(empty['_masked']).toBeUndefined();
    });

    it('answers the same numbers on the single-record GET', async () => {
      const res = await t.app.inject({
        method: 'GET',
        url: `/api/v1/data/${connId}/main.invoices/7?compute=${compute({ measures: [SUBTOTAL, GROSS] })}`,
        headers: asUser(t.users.admin),
      });
      expect(res.statusCode).toBe(200);
      const { data } = res.json() as { data: Record<string, unknown> };
      expect(data['subtotal']).toBe('1266');
      expect(data['gross']).toBe('1300');
    });
  });

  // ---: the masking fixes -------------------------------------------

  describe('refusals degrade, and now cover every column that reaches the subquery', () => {
    it('refuses a measure over a table the caller cannot read', async () => {
      const { status, body } = await list(
        `compute=${compute({ measures: [SUBTOTAL] })}&select=invoice_id`,
        t.users.editor,
      );
      expect(status).toBe(200); // the base table still serves
      const row = invoice(body, 7);
      expect(row['subtotal']).toBeNull();
      expect(row['_masked']).toContain('subtotal');
    });

    it('refuses a measure whose FACTOR column is masked for this caller', async () => {
      const block = {
        measures: [
          {
            id: 'cost',
            ...ITEMS,
            fn: 'sum',
            of: { terms: [{ sign: 'plus', factors: ['payer_account_number'] }] },
          },
        ],
      };
      // A viewer has read on both tables but no unmask grant: the aggregated
      // column is exactly what the number discloses, so it joins the check.
      const viewer = await list(`compute=${compute(block)}&select=invoice_id`, t.users.viewer);
      expect(viewer.status).toBe(200);
      expect(invoice(viewer.body, 7)['cost']).toBeNull();
      expect(invoice(viewer.body, 7)['_masked']).toContain('cost');
      // An admin holds the unmask grant and gets the number.
      const admin = await list(`compute=${compute(block)}&select=invoice_id`, t.users.admin);
      expect(invoice(admin.body, 7)['cost']).toBe('550');
    });

    it('refuses when the BASE-SIDE correlate is secret, even for an admin', async () => {
      // The D16 defect, stated where it is actually reachable: a secret column
      // on the REFERENCING table is invisible (422 below), so the only way a
      // secret column reaches a refusal check is as the column an inbound FK
      // points AT — and `columnPolicyFor` files it as secret, never masked, so
      // the old `masked === true` check saw nothing. Secret means nobody: the
      // unmask grant does not open it.
      const { status, body } = await list(
        `agg=${encodeURIComponent('legacy_count:main.invoice_items.legacy_ref:count')}&select=invoice_id`,
        t.users.admin,
      );
      expect(status).toBe(200);
      expect(invoice(body, 7)['legacy_count']).toBeNull();
      expect(invoice(body, 7)['_masked']).toContain('legacy_count');
    });

    it('422s when a secret column is named as a factor — invisible, not masked', async () => {
      const { status } = await list(
        `compute=${compute({
          measures: [
            {
              id: 'x',
              table: 'main.invoices',
              fkColumn: 'api_secret',
              fn: 'sum',
              of: { terms: [{ sign: 'plus', factors: ['api_secret'] }] },
            },
          ],
        })}`,
      );
      expect(status).toBe(422);
    });
  });

  // ---: the audit gap -----------------------------------------------

  it('writes one audit row per refused projection', async () => {
    const before = await t.meta.db
      .selectFrom('adminium_audit_log')
      .select('id')
      .where('action', '=', 'projection.denied')
      .execute();
    const { status } = await list(
      `compute=${compute({ measures: [SUBTOTAL, GROSS] })}&select=invoice_id`,
      t.users.editor,
    );
    expect(status).toBe(200);
    const after = await t.meta.db
      .selectFrom('adminium_audit_log')
      .selectAll()
      .where('action', '=', 'projection.denied')
      .execute();
    expect(after.length - before.length).toBe(2);
    const changes = String(after.at(-1)?.changes ?? '');
    expect(changes).toContain('main.invoice_items');
    expect(changes).toContain('table-read');
  });

  // ---: the envelope ------------------------------------------------

  describe('the compute envelope', () => {
    const field = (expr: Json): Json => ({ measures: [], fields: [{ id: 'f', scale: 2, expr }] });

    /** A `{"else": …}` chain: the deepest structure zod actually walks. */
    const elseChain = (depth: number): Json => {
      let expr: Json = { lit: '1' };
      for (let i = 0; i < depth; i += 1) expr = { else: expr };
      return field(expr);
    };

    it('accepts the deepest payload the grammar can express', async () => {
      // MAX_FIELD_DEPTH nested `cases` through `when.left` — 12 levels of JSON.
      const leaf = { lit: '1' };
      const nest = (inner: Json): Json => ({
        cases: [{ when: { left: inner, cmp: 'gte', right: leaf }, then: leaf }],
        else: leaf,
      });
      const { status } = await list(
        `compute=${compute(field(nest(nest(leaf))))}&select=invoice_id`,
      );
      expect(status).toBe(200);
    });

    it('refuses one level deeper', async () => {
      const leaf = { lit: '1' };
      const nest = (inner: Json): Json => ({
        cases: [{ when: { left: inner, cmp: 'gte', right: leaf }, then: leaf }],
        else: leaf,
      });
      const { status } = await list(`compute=${compute(field(nest(nest(nest(leaf)))))}`);
      expect(status).toBe(422);
    });

    it('refuses a payload over the byte cap', async () => {
      const measures = Array.from({ length: 8 }, (_, i) => ({
        ...SUBTOTAL,
        id: `m${String(i)}`,
        table: `main.${'x'.repeat(200)}`,
        fkColumn: 'y'.repeat(200),
        of: { terms: [{ sign: 'plus', factors: Array.from({ length: 4 }, () => 'z'.repeat(200)) }] },
      }));
      const raw = JSON.stringify({ measures, fields: [] });
      expect(raw.length).toBeGreaterThan(MAX_COMPUTE_BYTES);
      const { status } = await list(`compute=${encodeURIComponent(raw)}`);
      expect(status).toBe(422);
    });

    it('bounds CPU, which the byte cap cannot: a deep chain UNDER the cap', async () => {
      const payload = JSON.stringify(elseChain(800));
      expect(payload.length).toBeLessThan(MAX_COMPUTE_BYTES);
      expect(MAX_COMPUTE_DEPTH).toBeLessThan(800);

      const scannedStart = performance.now();
      const { status } = await list(`compute=${encodeURIComponent(payload)}`);
      const scannedMs = performance.now() - scannedStart;
      expect(status).toBe(422);

      // What the same payload costs the parser the scan protects: zod's
      // recursive union re-descends on failure, so a rejecting chain is
      // quadratic in depth (measured here: ~620 ms at 800 levels, ~160 at
      // 400, ~12 at 100). A relative assertion rather than an absolute one,
      // so a faster machine cannot make this vacuous.
      const unscannedStart = performance.now();
      expect(parseCrudDerived(JSON.parse(payload)).ok).toBe(false);
      const unscannedMs = performance.now() - unscannedStart;
      expect(unscannedMs / Math.max(scannedMs, 0.001)).toBeGreaterThan(10);
    });
  });

  // ---: the shared budget and the shared namespace -------------------

  describe('one budget and one namespace across all four projection families', () => {
    it('refuses 7 aggregates plus 6 measures', async () => {
      const aggs = Array.from(
        { length: 7 },
        (_, i) => `agg=${encodeURIComponent(`a${String(i)}:main.invoice_items.invoice_id:count`)}`,
      ).join('&');
      const measures = Array.from({ length: 6 }, (_, i) => ({ ...SUBTOTAL, id: `m${String(i)}` }));
      const { status } = await list(`${aggs}&compute=${compute({ measures })}`);
      expect(status).toBe(422);
    });

    it('accepts exactly twelve across both params', async () => {
      const aggs = Array.from(
        { length: 7 },
        (_, i) => `agg=${encodeURIComponent(`a${String(i)}:main.invoice_items.invoice_id:count`)}`,
      ).join('&');
      const measures = Array.from({ length: 5 }, (_, i) => ({ ...SUBTOTAL, id: `m${String(i)}` }));
      const { status } = await list(`${aggs}&compute=${compute({ measures })}&select=invoice_id`);
      expect(status).toBe(200);
    });

    it('refuses a measure id already claimed by an agg alias or a base column', async () => {
      const clash = await list(
        `agg=${encodeURIComponent('subtotal:main.invoice_items.invoice_id:count')}&compute=${compute({ measures: [SUBTOTAL] })}`,
      );
      expect(clash.status).toBe(422);
      const shadow = await list(
        `compute=${compute({ measures: [{ ...SUBTOTAL, id: 'tax_rate' }] })}`,
      );
      expect(shadow.status).toBe(422);
    });

    it('refuses a field naming a column this table does not have', async () => {
      const { status } = await list(
        `compute=${compute({
          measures: [],
          fields: [{ id: 'f', scale: 2, expr: { col: 'nope' } }],
        })}`,
      );
      expect(status).toBe(422);
    });

    it('refuses the compute param given twice', async () => {
      const one = compute({ measures: [SUBTOTAL] });
      const { status } = await list(`compute=${one}&compute=${one}`);
      expect(status).toBe(422);
    });
  });
});
