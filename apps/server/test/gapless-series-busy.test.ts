// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A NUMBER TAKEN WHILE ANOTHER WRITER HOLDS ITS SERIES waits as long as any
 * named lock waits, then is told `NUMBER_BUSY` — never parked, with a pooled
 * connection, until the other writer commits (a long import, a stuck
 * transaction). The write service's own transaction is how the dashboard's
 * create and a public create take a number: on Postgres the series' lock is
 * taken inside it, at the INSERT; on MySQL by name before it opens. SQLite
 * has one writer per process, so nothing there waits on another.
 */
import { createHash } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { insertRow } from '../src/crud/write-service.js';
import { installInvoicing, LEGS, MYSQL_URL, POSTGRES_URL, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';

/** Another writer, on a connection of its own, holding the series' lock until `release`. */
async function holdSeries(dialect: 'postgres' | 'mysql', database: string, name: string): Promise<{ release: () => Promise<void> }> {
  if (dialect === 'postgres') {
    const { Client } = await import('pg');
    const url = new URL(POSTGRES_URL as string);
    url.pathname = `/${database}`;
    const client = new Client({ connectionString: url.toString() });
    await client.connect();
    await client.query('begin');
    await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [name]);
    return {
      release: async () => {
        await client.query('rollback');
        await client.end();
      },
    };
  }
  const mysql = await import('mysql2/promise');
  const conn = await mysql.createConnection(MYSQL_URL as string);
  const key = `adm:${createHash('sha1').update(name).digest('hex')}`;
  const [rows] = await conn.query('select get_lock(?, 0) as got', [key]);
  expect(Number((rows as { got: unknown }[])[0]!.got)).toBe(1);
  return {
    release: async () => {
      await conn.query('select release_lock(?)', [key]);
      await conn.end();
    },
  };
}

describe.each(LEGS.filter(([dialect]) => dialect !== 'sqlite'))('a number whose series another writer holds — %s', (dialect, available) => {
  let h: InvoicingHarness | undefined;
  let w: Awaited<ReturnType<typeof writerFor>>;
  let database: string;

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect);
    await h.rows(`insert into ${h.real('settings')} (singleton) values ('studio')`);
    await h.rows(`insert into ${h.real('clients')} (id, email, name) values (1, 'ada@example.com', 'Ada')`);
    w = await writerFor(h);
    database = String((await h.rows(dialect === 'postgres' ? 'select current_database() as db' : 'select database() as db'))[0]!['db']);
  }, 180_000);
  afterAll(async () => h?.close());

  /** A new invoice, as the dashboard's create writes one: prepared, then inserted in the service's own transaction. */
  const create = async () => {
    const target = w.targetOf('invoices');
    const [prepared] = await w.writes.beforeEach('create', target, w.desk, [{ values: { client_id: 1 } }]);
    expect(prepared?.issues ?? null).toBeNull();
    return w.writes.transaction(target, [prepared!.values], (trx) => insertRow(trx, dialect, target.table, prepared!.values));
  };

  it.skipIf(!available)('is told NUMBER_BUSY after the named locks’ wait, then numbers once the series is free', { timeout: 60_000 }, async () => {
    const name = `gapless:${w.targetOf('invoices').table.id}.number_seq`;
    const other = await holdSeries(dialect as 'postgres' | 'mysql', database, name);
    const started = Date.now();
    try {
      await expect(create()).rejects.toMatchObject({ code: 'NUMBER_BUSY', statusCode: 409 });
      // The named locks' own wait (10 s), not until the other writer is done.
      expect(Date.now() - started).toBeLessThan(20_000);
    } finally {
      await other.release();
    }
    const made = await create();
    expect(made['number']).toBe('INV-2040');
    // Nothing taken by the refused write: the series has no gap.
    expect((await h!.rows(`select number from ${h!.real('invoices')}`)).map((row) => row['number'])).toEqual(['INV-2040']);
  });
});
