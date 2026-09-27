// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A child tied to its parent's state apart for a new row and a change of one
 * (`createIn` / `changeIn`), on every engine, through every door that writes
 * a payment: a payment is taken only while its stay is booked or in house,
 * and voided — or deleted — while the stay is booked, in house or cancelled
 * too; never on a departed stay. The staff writes and routes, a bulk change,
 * an import (a payment brought in for a cancelled stay is a new row:
 * refused), and the stored rules the install wrote. A row tied to its
 * parent's state offers no undo, so that door has nothing to judge.
 */
import { Readable } from 'node:stream';

import { filesRepo, importsRepo, overridesRepo, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { FileStore } from '../src/files/store.js';
import { registerImportRunHandler } from '../src/jobs/import-run.js';
import { asUser } from './connections-helpers.js';
import { houseManifest } from './house-moves.fixture.js';
import { installInvoicing, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';
import { dataRoutesOver, type DataRoutes } from './invoicing-routes.helpers.js';

describe.each(LEGS)('payments added in some states of their stay, changed in more — %s', (dialect, available) => {
  let h: InvoicingHarness;
  let w: Awaited<ReturnType<typeof writerFor>>;
  let routes: DataRoutes;
  let n = 0;
  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, houseManifest());
    w = await writerFor(h, 'Europe/London');
    routes = await dataRoutesOver(h, dialect);
    await w.create('settings', {});
  }, 180_000);
  afterAll(async () => {
    if (!available) return;
    await routes.close();
    await h.close();
  });

  const row = async (ref: string, key: unknown) => (await h.rows(`select * from ${h.real(ref)} where id = ${String(key)}`))[0];
  /** A stay moved to `status` (by the database: its own moves are not what is tested here), with one payment taken while booked. */
  async function stayWithPayment(status: string) {
    n += 1;
    const type = await w.create('room_types', { name: `Type ${String(n)}` });
    await w.create('rooms', { number: `R${String(n)}`, room_type_id: type['id'] });
    const stay = await w.create('stays', { guest: `Guest ${String(n)}`, room_type_id: type['id'], arrive: '2026-11-02', depart: '2026-11-04' });
    const payment = await w.create('payments', { stay_id: stay['id'], amount: '500.00' });
    await h.rows(`update ${h.real('stays')} set status = '${status}' where id = ${String(stay['id'])}`);
    return { stay, payment };
  }

  it.runIf(available)('stores createIn and changeIn as the manifest wrote them', async () => {
    const rules = await overridesRepo(h.meta).listForConnection(h.connectionId, { status: 'active' });
    const states = rules.find((r) => r.op === 'table.states' && r.tableName === w.targetOf('stays').table.id)!.value as { children: Record<string, unknown> };
    expect(states.children[w.targetOf('payments').table.id]).toEqual({ via: 'stay_id', createIn: ['booked', 'in_house'], changeIn: ['booked', 'in_house', 'cancelled'] });
  });

  it.runIf(available)('voids a payment of a cancelled stay, and refuses a new one there', async () => {
    const { stay, payment } = await stayWithPayment('cancelled');
    const voided = await w.update('payments', payment['id'], { voided: true });
    expect(voided.count).toBe(1);
    await expect(w.create('payments', { stay_id: stay['id'], amount: '10.00' })).rejects.toMatchObject({
      code: 'RECORD_LOCKED',
      details: { parentIn: ['booked', 'in_house'], on: 'create', state: 'cancelled' },
    });
  });

  it.runIf(available)('refuses a void, a delete and a new payment on a departed stay', async () => {
    const { stay, payment } = await stayWithPayment('departed');
    await expect(w.update('payments', payment['id'], { voided: true })).rejects.toMatchObject({
      code: 'RECORD_LOCKED',
      details: { parentIn: ['booked', 'in_house', 'cancelled'], on: 'change' },
    });
    const del = w.writes.delete({ target: w.targetOf('payments'), pk: { id: payment['id'] }, context: w.desk, announce: async () => {} });
    await expect(del).rejects.toMatchObject({ code: 'RECORD_LOCKED' });
    await expect(w.create('payments', { stay_id: stay['id'], amount: '10.00' })).rejects.toMatchObject({ code: 'RECORD_LOCKED' });
    expect(Boolean((await row('payments', payment['id']))!['voided'])).toBe(false);
  });

  it.runIf(available)('deletes a payment of a cancelled stay, as a change', async () => {
    const { payment } = await stayWithPayment('cancelled');
    await w.writes.delete({ target: w.targetOf('payments'), pk: { id: payment['id'] }, context: w.desk, announce: async () => {} });
    expect(await row('payments', payment['id'])).toBeUndefined();
  });

  it.runIf(available)('moves a payment to a cancelled stay only as a new line of it: refused', async () => {
    const { payment } = await stayWithPayment('booked');
    const { stay: cancelled } = await stayWithPayment('cancelled');
    await expect(w.update('payments', payment['id'], { stay_id: cancelled['id'] })).rejects.toMatchObject({ code: 'RECORD_LOCKED', details: { on: 'create' } });
  });

  it.runIf(available)('holds a bulk change and a change through the record route to the same states', async () => {
    const a = await stayWithPayment('cancelled');
    const b = await stayWithPayment('departed');
    const headers = asUser(routes.t.users.admin);
    const bulk = (ids: unknown[], values: Record<string, unknown>) =>
      routes.t.app.inject({ method: 'POST', url: `/api/v1/data/${routes.connectionId}/${routes.table('payments')}/bulk`, headers, payload: { action: 'update', ids, values } });
    const refused = await bulk([a.payment['id'], b.payment['id']], { voided: true });
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json()).toMatchObject({ error: { code: 'RECORD_LOCKED' } });
    const passed = await bulk([a.payment['id']], { voided: true });
    expect(passed.statusCode, passed.body).toBe(200);
    // A void through the record's route: a change. A row tied to its parent's state offers no undo to take it back.
    const c = await stayWithPayment('cancelled');
    const voided = await routes.patch('payments', c.payment['id'], { values: { voided: true } });
    expect(voided.statusCode, voided.body).toBe(200);
    expect((voided.json() as { undoToken?: string | null }).undoToken ?? null).toBeNull();
    expect(Boolean((await row('payments', c.payment['id']))!['voided'])).toBe(true);
  });

  it.runIf(available)('refuses an imported payment for a cancelled stay: a new row', async () => {
    const { stay } = await stayWithPayment('cancelled');
    const { stay: live } = await stayWithPayment('in_house');
    const csv = `stay_id,amount\n${String(live['id'])},20.00\n${String(stay['id'])},30.00\n`;
    const storage = { read: async () => Promise.resolve(Readable.from([csv])), write: async () => Promise.resolve({ storageKey: 'r', sizeBytes: 0, sha256: '', destinationId: null, storage: 'memory' }) } as unknown as FileStore;
    const file = await filesRepo(h.meta).create({ filename: 'payments.csv', mime: 'text/csv', sizeBytes: csv.length, sha256: 'x', kind: 'upload' });
    const imports = importsRepo(h.meta);
    const user = await usersRepo(h.meta).create({ email: `import-${String(Date.now())}@house.dev`, name: 'Importer', passwordHash: 'x' });
    const job = await imports.create({
      connectionId: h.connectionId,
      tableName: w.targetOf('payments').table.id,
      requestedBy: user.id,
      fileId: file.id,
      mapping: { columns: [{ from: 'stay_id', to: 'stay_id' }, { from: 'amount', to: 'amount' }] },
      options: { mode: 'insert', skipInvalid: true },
    });
    await imports.markReady(job.id, { total: 2 });
    let handler: ((payload: unknown, ctx: unknown) => Promise<unknown>) | null = null;
    registerImportRunHandler({ registerJobHandler: (_kind: string, _schema: unknown, run: typeof handler) => (handler = run) } as never, { meta: h.meta, manager: h.manager, storage });
    await handler!({ importId: job.id }, { jobId: 'job_1', signal: new AbortController().signal, progress: () => {}, log: () => {} });
    const count = async (key: unknown) => Number((await h.rows(`select count(*) as n from ${h.real('payments')} where stay_id = ${String(key)}`))[0]!['n']);
    expect([await count(live['id']), await count(stay['id'])]).toEqual([2, 1]);
  });
});
