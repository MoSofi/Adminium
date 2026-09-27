// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A new hold that lets the buyer's old one go holds the old order where a
 * write holds its own rows — after the totals both orders climb into — so it
 * never meets crosswise a writer that holds those totals and then the old
 * order (a hold's timed lapse, the desk changing it). On Postgres and MySQL
 * (SQLite writes one transaction at a time), for the page's own link and for
 * a signed-in buyer alike.
 */
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { installInvoicing, LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';
import { guest, mailReady } from './person-fixture.js';
import { boxOffice } from './hold-replace-fixture.js';
import { servePublic, type Served } from './public-lane.helpers.js';

type Doc = Record<string, unknown>;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The box office, its orders each for an event that keeps a count of them. */
function eventsBoxOffice(): Doc {
  const manifest = boxOffice();
  const tables = (manifest['requiredSchema'] as { tables: Doc[] }).tables;
  tables.splice(1, 0, {
    ref: 'events',
    columns: [
      { ref: 'id', type: 'int', role: 'pk' },
      { ref: 'name', type: 'text', maxLength: 60 },
      { ref: 'order_count', type: 'int', nullable: true, rules: { rollup: { from: 'orders', via: 'event_id', count: true } } },
    ],
  });
  (tables.find((table) => table['ref'] === 'orders')!['columns'] as Doc[]).push({ ref: 'event_id', type: 'fk', references: 'events' });
  const create = (manifest['publicAccess'] as Doc[]).find((entry) => entry['table'] === 'orders' && (entry['methods'] as string[]).includes('POST'))!;
  create['writable'] = [...(create['writable'] as string[]), 'event_id'];
  (manifest['publicAccess'] as Doc[]).push({ table: 'events', methods: ['GET'], select: ['id', 'name'] });
  return manifest;
}

describe.each(LEGS)('a hold let go by a new one is held in the one lock order — %s', (dialect, available) => {
  const servers = available && dialect !== 'sqlite';
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let box: Served;
  let g: ReturnType<typeof guest>;
  let orders: string;
  let type = 0;

  beforeAll(async () => {
    if (!servers) return;
    h = await installInvoicing(dialect, eventsBoxOffice());
    await mailReady(h.meta);
    orders = h.real('orders');
    await h.rows(`insert into ${h.real('settings')} (hold_minutes) values (10)`);
    await h.rows(`insert into ${h.real('events')} (id, name) values (1, 'Night Tide')`);
    await h.rows(`insert into ${h.real('customers')} (email, name) values ('sam@example.com', 'Sam')`);
    box = await servePublic(h, (h.reply['publicAccess'] as { keys: Record<string, string> }).keys['customer']!);
    g = guest(box, h);
  }, 180_000);
  afterAll(async () => {
    if (!servers) return;
    await box.close();
    await h.close();
  });

  const places = async (n: number) => {
    type += 1;
    await h.rows(`insert into ${h.real('ticket_types')} (id, name, capacity) values (${String(type)}, 'Type ${String(type)}', ${String(n)})`);
    return type;
  };
  const hold = (email: string, ticketType: number, more: Doc = {}, session?: string) =>
    g.request('POST', `/records/${orders}_verified`, {
      payload: { values: { email, name: 'Guest', event_id: 1 }, children: { tickets: [{ values: { ticket_type_id: ticketType } }] }, ...more },
      proof: 'write',
      ...(session === undefined ? {} : { session }),
    });

  /** Another writer: it holds the event, then — once `during` has started and waited — the old order. */
  async function crosswise(order: unknown, during: () => Promise<{ statusCode: number; body: string }>): Promise<{ statusCode: number; body: string }> {
    const { db } = await h.manager.data(h.connectionId);
    let started: Promise<{ statusCode: number; body: string }> | undefined;
    await db.transaction().execute(async (trx) => {
      await sql.raw(`select id from ${h.real('events')} where id = 1 for update`).execute(trx);
      started = during();
      await sleep(400);
      await sql.raw(`select id from ${orders} where id = ${String(order)} for update`).execute(trx);
    });
    return started!;
  }

  it.runIf(servers)("lets the page's old hold go while another writer holds the event and then that hold", async () => {
    const first = await hold('ivo@example.com', await places(5));
    expect(first.statusCode, first.body).toBe(201);
    const made = first.json() as { data: { id: number }; link: { session: string } };
    const second = await crosswise(made.data.id, async () => hold('ivo@example.com', await places(5), { replaces: made.link.session }));
    expect(second.statusCode, second.body).toBe(201);
    const [old] = await h.rows(`select held_until from ${orders} where id = ${String(made.data.id)}`);
    expect(new Date(String(old!['held_until'])).getTime()).toBeLessThan(Date.now() + 60_000);
  });

  it.runIf(servers)("lets a signed-in buyer's old hold go while another writer holds the event and then that hold", async () => {
    const session = await g.signIn('sam@example.com');
    const first = await hold('sam@example.com', await places(5), {}, session);
    expect(first.statusCode, first.body).toBe(201);
    const made = first.json() as { data: { id: number } };
    const second = await crosswise(made.data.id, async () => hold('sam@example.com', await places(5), {}, session));
    expect(second.statusCode, second.body).toBe(201);
  });
});
