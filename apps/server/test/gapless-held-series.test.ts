// SPDX-License-Identifier: AGPL-3.0-only
/**
 * MySQL: a writer that holds a series by name takes its number without also
 * holding the series' first row. Held as well, that row stood in the way of a
 * settle reading its neighbours (the totals of the invoice it belongs to,
 * added up after another form committed) while the settle held the gap the
 * writer inserts into — a deadlock, told as "the number is busy". A writer
 * inside a transaction someone else opened still holds the row: nothing
 * else lines its writers up.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { insertRow } from '../src/crud/write-service.js';
import { LEGS, installInvoicing, type InvoicingHarness } from './invoicing-install.helpers.js';
import { seedSettings, setConnectionCurrency, settledWriter, writeManifest } from './invoicing-writes.helpers.js';

describe.each(LEGS.filter(([dialect]) => dialect === 'mysql'))('a series held by name — %s', (dialect, available) => {
  let h: InvoicingHarness | undefined;
  let w: Awaited<ReturnType<typeof settledWriter>>;
  let client: Record<string, unknown>;
  /** The other connection, from a pool of its own: a pool of one stays the writer's. */
  let other: InvoicingHarness;
  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, writeManifest());
    other = await h.twin();
    await seedSettings(h, { prefix: 'INV-', start: 2040 });
    await setConnectionCurrency(h, 'EUR');
    w = await settledWriter(h);
    client = await w.create('clients', { email: 'ann@example.test', name: 'Ann' });
  }, 180_000);
  afterAll(async () => h?.close());

  const guest = { origin: 'public' as const, hops: 0, actor: { kind: 'public' as const, id: null, label: 'guest' }, request: null };
  /** Whether another connection can hold the invoice right now, without waiting. */
  const free = async (id: unknown): Promise<boolean> => {
    try {
      await other.rows(`select id from ${other.real('invoices')} where id = ${String(id)} for update nowait`);
      return true;
    } catch {
      return false;
    }
  };

  it.runIf(available)("takes its number without holding the series' first row", async () => {
    const first = await w.create('invoices', { client_id: client['id'] });
    const target = w.targetOf('invoices');
    const prepared = await w.writes.beforeEach('create', target, guest, [{ values: { client_id: client['id'] } }]);
    let seen: boolean | undefined;
    await w.writes.transaction(target, prepared.map((row) => row.values), async (trx) => {
      for (const row of prepared) await insertRow(trx, target.dialect, target.table, row.values);
      seen = await free(first['id']);
    });
    expect(seen).toBe(true);
  });

  it.runIf(available)("still holds the first row inside a transaction someone else opened", async () => {
    const [lowest] = await h!.rows(`select id from ${h!.real('invoices')} order by number_seq limit 1`);
    const target = w.targetOf('invoices');
    const prepared = await w.writes.beforeEach('create', target, guest, [{ values: { client_id: client['id'] } }]);
    let seen: boolean | undefined;
    await w.db.transaction().execute(async (trx) => {
      for (const row of prepared) await insertRow(trx, target.dialect, target.table, row.values);
      seen = await free(lowest!['id']);
    });
    expect(seen).toBe(false);
  });
});
