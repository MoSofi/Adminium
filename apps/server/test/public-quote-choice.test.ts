// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A guest's order whose entry requires a CHOICE (a country, a way to collect
 * it) and whose table keeps a column the entry does not list, over the
 * public API of an installed app.
 *
 * Found building a shop from a website template: the page priced the cart
 * before the guest had typed anything, and the quote filled the required
 * names and addresses but not the required country, so it answered "That
 * write was refused." with nothing to say which. A quote fills a required
 * choice as it fills a required name — with one of its own values, shown
 * empty — and a save that leaves it out names it. A column the table cannot
 * store empty that the entry does not ask for is refused by the database,
 * and that is never named to a stranger: the server's log names it, and
 * `app check` says so of the entry. On every engine.
 */
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { solveProof } from '../src/public-api/proof.js';
import { installInvoicing, LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';
import { cents, MENU, orderPublicManifest } from './order-tree-fixture.js';
import { servePublic, type Served } from './public-lane.helpers.js';

type Doc = Record<string, unknown>;

/** The kitchen, its orders asking how the guest collects (a choice) and keeping a table number the entry never writes. */
function manifest(): Doc {
  const m = orderPublicManifest();
  const orders = ((m['requiredSchema'] as Doc)['tables'] as Doc[]).find((table) => table['ref'] === 'orders')!;
  (orders['columns'] as Doc[]).push(
    { ref: 'collect', type: 'enum', enum: ['pickup', 'delivery'] },
    { ref: 'seating', type: 'enum', enum: ['inside', 'terrace'], nullable: true },
  );
  const entry = (m['publicAccess'] as Doc[]).find((access) => access['table'] === 'orders')!;
  entry['writable'] = [...(entry['writable'] as string[]), 'collect', 'seating'];
  entry['requires'] = [...(entry['requires'] as string[]), 'collect'];
  return m;
}

/**
 * The same kitchen with two columns every order must carry that the entry
 * does not ask for: a pager number the guest may type, and a table number
 * the entry neither writes nor fills (`app check` warns of that one).
 */
function unlisted(): Doc {
  const m = manifest();
  const orders = ((m['requiredSchema'] as Doc)['tables'] as Doc[]).find((table) => table['ref'] === 'orders')!;
  (orders['columns'] as Doc[]).push({ ref: 'pager', type: 'text', maxLength: 10 }, { ref: 'table_no', type: 'text', maxLength: 10 });
  const entry = (m['publicAccess'] as Doc[]).find((access) => access['table'] === 'orders')!;
  entry['writable'] = [...(entry['writable'] as string[]), 'pager'];
  return m;
}

/** Two Sodas: $4.00, and $0.33 of tax. */
const lines = { order_items: [{ values: { menu_item_id: 4, qty: 2 } }] };

describe.each(LEGS)('a quote and a save of an order that asks a choice — %s', (dialect, available) => {
  const legs: { h: InvoicingHarness; served: Served }[] = [];
  const log: Doc[] = [];
  let ip = 0;
  beforeAll(async () => {
    if (!available) return;
    for (const made of [manifest(), unlisted()]) {
      const h = await installInvoicing(dialect, made);
      for (const statement of MENU) await h.rows(statement);
      legs.push({ h, served: await servePublic(h, (h.reply['publicAccess'] as { keyId: string }).keyId, {}, { logger: pino({ level: 'info' }, { write: (line: string) => void log.push(JSON.parse(line) as Doc) }) }) });
    }
  }, 240_000);
  afterAll(async () => {
    for (const leg of legs) {
      await leg.served.close();
      await leg.h.close();
    }
  });

  const from = () => {
    ip += 1;
    return `10.8.${String((ip >> 8) & 255)}.${String(ip & 255)}`;
  };
  const quote = (served: Served, values: Doc) =>
    served.composed.app.inject({ method: 'POST', url: '/api/v1/public/records/kitchen_orders/dry-run', remoteAddress: from(), headers: served.headers(), payload: { values, children: lines } });
  const save = async (served: Served, values: Doc) => {
    const address = from();
    const res = await served.composed.app.inject({ method: 'GET', url: '/api/v1/public/challenge?purpose=write', remoteAddress: address, headers: served.headers() });
    const c = (res.json() as { data: { id: string; salt: string; difficulty: number } }).data;
    return served.composed.app.inject({
      method: 'POST',
      url: '/api/v1/public/records/kitchen_orders',
      remoteAddress: address,
      headers: served.headers(undefined, { 'x-adminium-proof': `${c.id}.${solveProof(c.salt, c.difficulty)}` }),
      payload: { values, children: lines },
    });
  };
  const refusal = (res: { json: () => unknown }) => (res.json() as { error: { code: string; params?: Doc } }).error;

  it.runIf(available)('a quote before the details fills the required choice, and shows it empty', async () => {
    const res = await quote(legs[0]!.served, {});
    expect(res.statusCode, res.body).toBe(200);
    const data = (res.json() as { data: Doc }).data;
    expect(cents(data['total'])).toBe('4.33');
    expect(data['collect'] ?? null).toBeNull();
  });

  it.runIf(available)('a quote that names the choice is priced with it', async () => {
    const res = await quote(legs[0]!.served, { collect: 'delivery' });
    expect(res.statusCode, res.body).toBe(200);
  });

  it.runIf(available)('a save that leaves the choice out names it', async () => {
    const res = await save(legs[0]!.served, { email: 'ada@example.com', name: 'Ada' });
    expect(res.statusCode).toBe(400);
    expect(refusal(res)).toMatchObject({ code: 'PUBLIC_WRITE_REFUSED', params: { column: 'collect' } });
  });

  it.runIf(available)('a save with every value it asks for goes through', async () => {
    const res = await save(legs[0]!.served, { email: 'ada@example.com', name: 'Ada', collect: 'pickup' });
    expect(res.statusCode, res.body).toBe(201);
  });

  /*
   * The database refused these, and what the database says is never named to
   * a stranger (`crud/db-errors.ts`, rule 4) — not even of a column the entry
   * lets them write. The person building the app reads it in the server's log.
   */
  const refusedAs = async (values: Doc) => {
    log.length = 0;
    const res = await save(legs[1]!.served, values);
    expect(res.statusCode).toBe(400);
    expect(refusal(res)).toEqual({ code: 'PUBLIC_WRITE_REFUSED', message: 'That write was refused.' });
    const logged = log.find((line) => String(line['msg']).startsWith('a public write was refused'));
    // The column and why, never what was sent.
    expect(JSON.stringify(logged)).not.toContain('ada@example.com');
    return logged;
  };

  it.runIf(available)('a save that leaves out a column the guest may write, which the table cannot store empty, is named in the log', async () => {
    expect(await refusedAs({ email: 'ada@example.com', name: 'Ada', collect: 'pickup' })).toMatchObject({ ref: 'kitchen_orders', column: 'pager', code: 'required' });
  });

  it.runIf(available)('a column the entry neither writes nor fills is named in the log', async () => {
    expect(await refusedAs({ email: 'ada@example.com', name: 'Ada', collect: 'pickup', pager: '7' })).toMatchObject({ ref: 'kitchen_orders', column: 'table_no', code: 'required' });
  });
});
