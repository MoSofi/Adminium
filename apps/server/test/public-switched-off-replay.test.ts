// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An order that went through replays its retry even when online orders were
 * switched off since — the reply that was lost was for an order that exists —
 * while a new order, a quote, or a create with no retry key is refused as
 * switched off, and nothing is written. Retries racing each other across the
 * switch make one order, on every engine.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { SWITCH_TTL_MS } from '../src/public-api/switches.js';
import { installInvoicing, LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';
import { guest, mailReady, shopManifest } from './person-fixture.js';
import { servePublic, type Served } from './public-lane.helpers.js';

type Doc = Record<string, unknown>;

function switchedShop(): Doc {
  const manifest = shopManifest({
    entries: (entries) =>
      entries.map((entry) => ((entry['methods'] as string[]).includes('POST') && entry['table'] === 'orders' ? { ...entry, requireSetting: [{ table: 'settings', column: 'online' }] } : entry)),
  });
  const settings = (manifest['requiredSchema'] as { tables: Doc[] }).tables.find((t) => t['ref'] === 'settings')!;
  (settings['columns'] as Doc[]).push({ ref: 'online', type: 'bool', default: true });
  return manifest;
}

describe.each(LEGS)('a retry across the online-orders switch — %s', (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let shop: Served;
  let g: ReturnType<typeof guest>;
  let orders: string;
  let clock = Date.parse('2026-07-28T09:00:00.000Z');

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, switchedShop());
    await mailReady(h.meta);
    await h.rows(`insert into ${h.real('settings')} (bank_name, account_number, online) values ('Town Bank', '1', ${dialect === 'postgres' ? 'true' : '1'})`);
    const keys = (h.reply['publicAccess'] as { keys: Record<string, string> }).keys;
    shop = await servePublic(h, keys['customer']!);
    g = guest(shop, h);
    orders = h.real('orders');
  }, 180_000);
  afterAll(async () => {
    if (!available) return;
    await shop.close();
    await h.close();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** The switch set, and time moved past how long its answer is trusted. */
  const turn = async (on: boolean) => {
    await h.rows(`update ${h.real('settings')} set online = ${on ? (dialect === 'postgres' ? 'true' : '1') : dialect === 'postgres' ? 'false' : '0'}`);
    clock += SWITCH_TTL_MS + 1_000;
    if (vi.isFakeTimers()) vi.setSystemTime(clock);
    else vi.useFakeTimers({ now: clock, toFake: ['Date'] });
  };
  const create = (key: string | undefined, name: string) =>
    g.request('POST', `/records/${orders}_verified_2`, {
      payload: { values: { email: `${name.toLowerCase()}@mail.test`, name, ...(key === undefined ? {} : { client_key: key }) }, children: { order_items: [{ values: { dish: `${name} soup`, qty: 1 } }] } },
      proof: 'write',
    });
  const count = async (name: string) => Number((await h.rows(`select count(*) as n from ${orders} where name = '${name}'`))[0]!['n']);
  const key = (n: number) => `ck_${String(n).padStart(2, '0')}_${'k'.repeat(24)}`;

  it.skipIf(!available)('replays an order that exists; refuses a new one, a quote and a keyless create', async () => {
    await turn(true);
    const made = await create(key(1), 'Ada');
    expect(made.statusCode, made.body).toBe(201);
    const id = (made.json() as { data: { id: unknown } }).data.id;

    await turn(false);
    const retry = await create(key(1), 'Ada');
    expect(retry.statusCode, retry.body).toBe(200);
    expect(retry.json()).toMatchObject({ data: { id }, replayed: true });
    expect(retry.body).not.toContain('"link"');

    for (const refused of [await create(key(2), 'Bea'), await create(undefined, 'Cy')]) {
      expect(refused.statusCode, refused.body).toBe(403);
      expect(refused.json()).toMatchObject({ error: { code: 'PUBLIC_SWITCHED_OFF' } });
    }
    const quote = await g.request('POST', `/records/${orders}_verified_2/dry-run`, { payload: { values: { email: 'dee@mail.test', name: 'Dee', client_key: key(3) } } });
    expect(quote.statusCode, quote.body).toBe(403);
    expect([await count('Ada'), await count('Bea'), await count('Cy'), await count('Dee')]).toEqual([1, 0, 0, 0]);
    // The people a refused create would have made are not made either.
    expect(Number((await h.rows(`select count(*) as n from ${h.real('customers')} where email in ('bea@mail.test', 'cy@mail.test')`))[0]!['n'])).toBe(0);

    await turn(true);
    const back = await create(key(2), 'Bea');
    expect(back.statusCode, back.body).toBe(201);
  });

  it.skipIf(!available)('makes one order when retries race each other and the switch', async () => {
    await turn(true);
    const first = await Promise.all([create(key(10), 'Eve'), create(key(10), 'Eve'), create(key(10), 'Eve')]);
    expect(first.map((r) => r.statusCode).sort()).toEqual([200, 200, 201]);
    const ids = new Set(first.map((r) => String((r.json() as { data: { id: unknown } }).data.id)));
    expect(ids.size).toBe(1);

    await turn(false);
    const later = await Promise.all([create(key(10), 'Eve'), create(key(10), 'Eve'), create(key(11), 'Fay'), create(key(11), 'Fay')]);
    expect(later.slice(0, 2).map((r) => r.statusCode)).toEqual([200, 200]);
    for (const r of later.slice(0, 2)) expect(ids.has(String((r.json() as { data: { id: unknown } }).data.id))).toBe(true);
    expect(later.slice(2).map((r) => r.statusCode)).toEqual([403, 403]);
    expect([await count('Eve'), await count('Fay')]).toEqual([1, 0]);
  });
});
