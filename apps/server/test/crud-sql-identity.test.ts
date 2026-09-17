// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE BYTE-IDENTITY CONTRACT.
 *
 * Derived columns arrive as a NEW query parameter, and the promise that buys
 * is that a read which does not carry it is unchanged. Not "behaves the
 * same": emits the same SQL, byte for byte. `crud/aggregates.ts` was reduced
 * to a wire parser and its compiler moved into `crud/measures.ts` in the same
 * wave (D15), so the claim needs an assertion and not a reading of the diff.
 *
 * The strings below were captured from the pre-wave build (`git worktree` at
 * the wave's base commit, same fixture, same requests) and pinned here. If a
 * later change moves one, that is the review conversation this file exists to
 * force.
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
import { createSqlSink, lastSelectFrom, type SqlSink } from './sql-recorder.js';

describe('emitted SQL is unchanged when no compute= is present', () => {
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
  });

  afterAll(async () => {
    await t.app.close();
  });

  const read = async (url: string): Promise<string> => {
    sink.queries.length = 0;
    const res = await t.app.inject({ method: 'GET', url, headers: asUser(t.users.admin) });
    expect(res.statusCode).toBe(200);
    return lastSelectFrom(sink, 'main.invoices');
  };

  it('a plain list', async () => {
    expect(await read(`/api/v1/data/${connId}/main.invoices`)).toBe(
      'select "invoice_id", "number", "tax_rate", "contact_email" from "main"."invoices" order by "invoice_id" asc limit ? offset ?',
    );
  });

  it('a list with a filter, an order and an offset', async () => {
    const where = encodeURIComponent(JSON.stringify({ column: 'tax_rate', op: 'gt', value: 0 }));
    expect(
      await read(
        `/api/v1/data/${connId}/main.invoices?where=${where}&order=number.desc&offset=1&select=invoice_id,number`,
      ),
    ).toBe(
      'select "invoice_id", "number" from "main"."invoices" where "tax_rate" > ? order by "number" desc, "invoice_id" asc limit ? offset ?',
    );
  });

  it('a list carrying agg=count', async () => {
    const agg = encodeURIComponent('item_count:main.invoice_items.invoice_id:count');
    expect(await read(`/api/v1/data/${connId}/main.invoices?agg=${agg}&select=invoice_id`)).toBe(
      'select "invoice_id", (select count(*) as "n" from "main"."invoice_items" as "ag0" where "ag0"."invoice_id" = "invoices"."invoice_id") as "item_count" from "main"."invoices" order by "invoice_id" asc limit ? offset ?',
    );
  });

  it('the exact-count twin is still a bare projection-free COUNT(*)', async () => {
    sink.queries.length = 0;
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/v1/data/${connId}/main.invoices`,
      headers: asUser(t.users.admin),
    });
    expect(res.statusCode).toBe(200);
    const counts = sink.queries.filter((sql) => sql.startsWith('select count'));
    expect(counts).toEqual(['select count(*) as "total" from "main"."invoices"']);
  });
});
