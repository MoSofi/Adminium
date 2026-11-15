// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A CHECKOUT THAT MAKES AN ORDER ALREADY WAITING FOR ITS PAYMENT, on SQLite, Postgres and MySQL.
 *
 * An order paid at pickup is made `placed`; one the guest pays for as they
 * check out is made `paying`, which the table names as another start
 * (`states.starts`). Two public entries make them: the second says `paying` by
 * its `defaults`. Which is open follows the shop's payment setting, a choice
 * in its settings row (`requireSetting[].in`): "nothing" opens only the first,
 * "required" only the second, "optional" both. Any other state on a new row is
 * refused, as before, whoever writes it.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createWriteService, type WriteContext, type WriteTarget } from '../src/crud/write-service.js';
import { writeStores } from '../src/crud/write-stores.js';
import { createPublicViews } from '../src/public-api/runtime.js';
import { SWITCH_TTL_MS } from '../src/public-api/switches.js';
import { installInvoicing, invoicingManifest, LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';
import { guest } from './person-fixture.js';
import { servePublic, type Served } from './public-lane.helpers.js';

type Doc = Record<string, unknown>;
const id = { ref: 'id', type: 'int', role: 'pk' };

function counter(): Doc {
  const m = invoicingManifest([
    { ref: 'settings', columns: [id, { ref: 'pay_mode', type: 'enum', enum: ['nothing', 'optional', 'required'], default: 'optional' }] },
    {
      ref: 'orders',
      columns: [id, { ref: 'name', type: 'text', maxLength: 60, nullable: true }, { ref: 'status', type: 'enum', enum: ['placed', 'paying', 'ready', 'cancelled'], default: 'placed' }],
      states: { column: 'status', initial: 'placed', starts: ['paying'], moves: { paying: ['placed', 'cancelled'], placed: ['ready', 'cancelled'] } },
    },
  ]);
  m['key'] = 'counter';
  m['compatibility'] = { minAdminiumVersion: '0.3.59' };
  (m['pages'] as { bindings: Record<string, string> }[])[0]!.bindings = { rows: 'orders' };
  m['frontends'] = [
    { side: 'staff', kind: 'spa', entry: 'index.html' },
    { side: 'customer', kind: 'spa', entry: 'index.html' },
  ];
  const entry = (extra: Doc): Doc => ({ table: 'orders', methods: ['POST'], select: ['id', 'status'], writable: ['name'], humanCheck: true, ...extra });
  m['publicAccess'] = [
    // Paid at pickup: open while the shop asks nothing, or leaves it to the guest.
    entry({ requireSetting: [{ table: 'settings', column: 'pay_mode', in: ['nothing', 'optional'] }] }),
    // Paid as they check out: open while the shop leaves it to the guest, or asks for it.
    entry({ defaults: { status: 'paying' }, requireSetting: [{ table: 'settings', column: 'pay_mode', in: ['optional', 'required'] }] }),
  ];
  return m;
}

describe.each(LEGS)('a new order made waiting for its payment — %s', (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let shop: Served;
  let g: ReturnType<typeof guest>;
  let orders: string;
  let clock = Date.parse('2026-11-15T09:00:00.000Z');

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, counter());
    await h.rows(`insert into ${h.real('settings')} (id, pay_mode) values (1, 'optional')`);
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

  /** The shop's payment setting, and time moved past how long its answer is trusted. */
  const payMode = async (mode: 'nothing' | 'optional' | 'required') => {
    await h.rows(`update ${h.real('settings')} set pay_mode = '${mode}'`);
    clock += SWITCH_TTL_MS + 1_000;
    if (vi.isFakeTimers()) vi.setSystemTime(clock);
    else vi.useFakeTimers({ now: clock, toFake: ['Date'] });
  };
  const checkout = (entry: '' | '_2', name: string) => g.request('POST', `/records/${orders}${entry}`, { payload: { values: { name } }, proof: 'write' });
  const statusOf = async (name: string) => (await h.rows(`select status from ${orders} where name = '${name}'`)).map((row) => row['status']);
  const codeOf = (res: { json: () => unknown }) => (res.json() as { error?: { code?: string } }).error?.code;

  it.skipIf(!available)('makes the order placed or paying, by the entry', async () => {
    await payMode('optional');
    const later = await checkout('', 'Ada');
    expect(later.statusCode, later.body).toBe(201);
    const now = await checkout('_2', 'Bea');
    expect(now.statusCode, now.body).toBe(201);
    expect(await statusOf('Ada')).toEqual(['placed']);
    expect(await statusOf('Bea')).toEqual(['paying']);
  });

  it.skipIf(!available)("opens each entry by the shop's payment setting", async () => {
    await payMode('required');
    const unpaid = await checkout('', 'Cy');
    expect(unpaid.statusCode, unpaid.body).toBe(403);
    expect(codeOf(unpaid)).toBe('PUBLIC_SWITCHED_OFF');
    expect((await checkout('_2', 'Dee')).statusCode).toBe(201);

    await payMode('nothing');
    const paying = await checkout('_2', 'Eve');
    expect(paying.statusCode, paying.body).toBe(403);
    expect(codeOf(paying)).toBe('PUBLIC_SWITCHED_OFF');
    expect((await checkout('', 'Fay')).statusCode).toBe(201);
    expect([await statusOf('Cy'), await statusOf('Dee'), await statusOf('Eve'), await statusOf('Fay')]).toEqual([[], ['paying'], [], ['placed']]);
  });

  it.skipIf(!available)('refuses any other first state, whoever writes; a paying order moves on by its moves', async () => {
    const view = (await createPublicViews(h.meta).viewFor(h.connectionId))!;
    const handle = await h.manager.data(h.connectionId);
    const target: WriteTarget = { connectionId: h.connectionId, view, table: view.table(view.model.tables.find((t) => t.name === orders)!.id), db: handle.db, dialect: handle.dialect, timezone: 'UTC' };
    const writes = createWriteService(writeStores(h.meta));
    const staff: WriteContext = { origin: 'dashboard', hops: 0, actor: { kind: 'user', id: 'usr_owner', label: 'Owner' }, request: null };
    const announce = async () => {};
    await expect(writes.create({ target, values: { id: 100, name: 'Gus', status: 'ready' }, context: staff, announce })).rejects.toThrow(`A new ${orders} row starts as placed.`);
    await writes.create({ target, values: { id: 101, name: 'Hal', status: 'paying' }, context: staff, announce });
    await writes.update({ target, pk: { id: 101 }, values: { status: 'placed' }, context: staff, announce });
    expect(await statusOf('Gus')).toEqual([]);
    expect(await statusOf('Hal')).toEqual(['placed']);
  });
});
