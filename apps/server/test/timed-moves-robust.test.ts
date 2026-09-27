// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The timed moves when a row is not as a writer would leave it, on every
 * engine: a move the database itself refuses (a value kept unique) leaves
 * that row alone and moves the others; the database going away mid-minute
 * keeps the rows left alone so far; a time Postgres keeps finer than a
 * millisecond, one SQLite keeps as text spelled its own way or as this
 * server's wall clock, and one the database stamped itself are all found and
 * moved; and a row re-dated after it was found due is left as it is.
 */
import { jobsRepo, type EnqueueJobInput } from '@adminium/meta';
import { sql } from 'kysely';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createWriteService, type RecordWriteService } from '../src/crud/write-service.js';
import { writeStores } from '../src/crud/write-stores.js';
import { enqueueTimedMoves, runTimedMoves, TIMED_MOVES_JOB_KIND, type LeftAlone, type TimedMovesDeps } from '../src/states/timed-moves.js';
import { installInvoicing, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';
import { venueManifest } from './venue-moves.fixture.js';

type Writer = Awaited<ReturnType<typeof writerFor>>;

/** An instant as this server's wall clock, as SQLite keeps a time written without a zone. */
const wall = (iso: string) => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

describe.each(LEGS)('timed moves over rows as the database keeps them — %s', (dialect, available) => {
  let h: InvoicingHarness;
  let w: Writer;
  let deps: TimedMovesDeps;
  let n = 0;
  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, venueManifest({ uniqueCode: true }));
    await h.meta.db.updateTable('adminium_connections').set({ timezone: 'Europe/London' } as never).where('id', '=', h.connectionId).execute();
    w = await writerFor(h, 'Europe/London');
    await w.create('settings', {});
    deps = { meta: h.meta, manager: h.manager, log: { info: () => undefined, warn: () => undefined, error: () => undefined } };
  }, 180_000);
  afterAll(async () => {
    if (available) await h.close();
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  const clock = (when: string) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(when));
    return new Date(when);
  };
  const statusOf = async (ref: string, id: unknown) => (await h.rows(`select status from ${h.real(ref)} where id = ${String(id)}`))[0]!['status'];
  const set = (ref: string, id: unknown, assignments: string) => h.rows(`update ${h.real(ref)} set ${assignments} where id = ${String(id)}`);
  /** A UTC instant as a literal each engine's time column reads as that instant (MySQL keeps this server's wall clock). */
  const at = (iso: string) => (dialect === 'postgres' ? `'${iso.replace('T', ' ').replace('Z', '')}+00'` : dialect === 'mysql' ? `'${wall(iso)}'` : `'${iso}'`);
  async function order(email: string) {
    n += 1;
    const show = await w.create('events', { name: `Show ${String(n)}`, starts_at: '2027-09-20T19:00:00Z', doors_at: '2027-09-20T18:00:00Z' });
    return w.create('orders', { event_id: show['id'], email });
  }
  /** Real rows everywhere else; `before` runs as a move of the row it names starts. */
  const writesWith = (before: (id: unknown) => Promise<void>): RecordWriteService => {
    const real = createWriteService(writeStores(h.meta));
    return { ...real, update: async (input) => (await before(input.pk['id']), real.update(input)) };
  };

  it.runIf(available)('moves the others when the database refuses one row, and leaves that row alone', async () => {
    const first = await order('first@example.com');
    const second = await order('second@example.com');
    const later = await order('later@example.com');
    // Two overdue transfers: releasing each writes the one code the column keeps unique.
    await set('orders', first['id'], `status = 'overdue', pay_by = ${at('2027-01-10T10:00:00Z')}`);
    await set('orders', second['id'], `status = 'overdue', pay_by = ${at('2027-01-10T11:00:00Z')}`);
    await set('orders', later['id'], `status = 'overdue', pay_by = ${at('2027-01-10T12:00:00Z')}`);
    const tick = await runTimedMoves(deps, h.connectionId, {}, clock('2027-01-11T13:00:00Z'));
    expect(await statusOf('orders', first['id'])).toBe('released');
    expect(await statusOf('orders', second['id'])).toBe('overdue');
    expect(await statusOf('orders', later['id'])).toBe('overdue');
    expect(tick).toMatchObject({ moved: 1, refused: 2 });
    expect(Object.keys(tick.left).sort()).toEqual([second['id'], later['id']].map((id) => `${h.connectionId}|${w.targetOf('orders').table.id}|${String(id)}|2`).sort());
    // Left alone: the next minute does not try them again.
    const next = await runTimedMoves(deps, h.connectionId, tick.left, clock('2027-01-11T13:01:00Z'));
    expect(next).toMatchObject({ moved: 0, refused: 0 });
    await set('orders', second['id'], `status = 'cancelled'`);
    await set('orders', later['id'], `status = 'cancelled'`);
  });

  it.runIf(available)('keeps the rows left alone so far when the database goes away mid-minute', async () => {
    const refused = await order('refused@example.com');
    const gone = await order('gone@example.com');
    await set('orders', refused['id'], `status = 'overdue', pay_by = ${at('2027-02-10T10:00:00Z')}`);
    await set('orders', gone['id'], `status = 'overdue', pay_by = ${at('2027-02-10T11:00:00Z')}`);
    // The code is taken already, so the first release is refused by the database.
    if ((await h.rows(`select id from ${h.real('orders')} where cancel_code = 'unpaid'`)).length === 0) {
      const holder = await order('holder@example.com');
      await set('orders', holder['id'], `cancel_code = 'unpaid', status = 'cancelled'`);
    }
    const writes = writesWith(async (id) => {
      if (id === gone['id'] || String(id) === String(gone['id'])) throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' });
    });
    let saved: LeftAlone | undefined;
    await expect(
      runTimedMoves({ ...deps, writes }, h.connectionId, {}, clock('2027-02-11T13:00:00Z'), async (left) => {
        saved = left;
      }),
    ).rejects.toMatchObject({ code: 'ECONNREFUSED' });
    expect(Object.keys(saved ?? {})).toEqual([`${h.connectionId}|${w.targetOf('orders').table.id}|${String(refused['id'])}|2`]);
    await set('orders', refused['id'], `status = 'cancelled'`);
    await set('orders', gone['id'], `status = 'cancelled'`);
  });

  it.runIf(available)("hands the next minute the rows a failed minute left alone", async () => {
    const jobs = jobsRepo(h.meta);
    const left = { [`${h.connectionId}|orders|1|2`]: Date.now() + 3_000_000 };
    const job = await jobs.enqueue({ kind: TIMED_MOVES_JOB_KIND, payload: { connectionId: h.connectionId }, maxAttempts: 1 });
    await jobs.claim('worker', Date.now() + 1);
    await jobs.setPayload(job.id, { connectionId: h.connectionId, left });
    await jobs.fail(job.id, 'connect ECONNREFUSED');
    const queued: EnqueueJobInput[] = [];
    await enqueueTimedMoves({ ...deps, enqueue: async (input) => void queued.push(input) });
    expect(queued.find((input) => input.payload['connectionId'] === h.connectionId)?.payload['left']).toEqual(left);
  });

  it.runIf(available)('finds and moves a time kept finer than a millisecond, or spelled as the database spells it', async () => {
    const fine = await order('fine@example.com');
    const bare = await order('bare@example.com');
    const local = await order('local@example.com');
    if (dialect === 'postgres') {
      await set('orders', fine['id'], `held_until = '2027-03-01 09:00:00.123456+00'`);
      await set('orders', bare['id'], `held_until = '2027-03-01 09:00:00+00'`);
      await set('orders', local['id'], `held_until = '2027-03-01 09:00:00.999999+00'`);
    } else if (dialect === 'mysql') {
      // A time column Adminium makes on MySQL keeps this server's wall clock.
      await set('orders', fine['id'], `held_until = '${wall('2027-03-01T09:00:00Z')}.123456'`);
      await set('orders', bare['id'], `held_until = '${wall('2027-03-01T09:00:00Z')}'`);
      await set('orders', local['id'], `held_until = '${wall('2027-03-01T09:00:00Z')}.999'`);
    } else {
      await set('orders', fine['id'], `held_until = '2027-03-01T09:00:00.123456Z'`);
      await set('orders', bare['id'], `held_until = '2027-03-01T09:00:00Z'`);
      // This server's wall clock, as a time written without a zone reads.
      await set('orders', local['id'], `held_until = '${wall('2027-03-01T09:00:00Z')}'`);
    }
    const tick = await runTimedMoves(deps, h.connectionId, {}, clock('2027-03-01T09:00:01.500Z'));
    expect(tick.refused).toBe(0);
    expect([await statusOf('orders', fine['id']), await statusOf('orders', bare['id']), await statusOf('orders', local['id'])]).toEqual(['expired', 'expired', 'expired']);
  });

  it.runIf(available && dialect !== 'mysql')('moves a row whose time the database stamped itself', async () => {
    // MySQL gives a time column Adminium makes no database default: nothing stamps it there.
    const stamped = await order('stamped@example.com');
    await set('orders', stamped['id'], dialect === 'postgres' ? `held_until = now() - interval '1 minute'` : `held_until = datetime('now', 'localtime', '-1 minutes')`);
    const tick = await runTimedMoves(deps, h.connectionId, {}, new Date());
    expect(tick.refused).toBe(0);
    expect(await statusOf('orders', stamped['id'])).toBe('expired');
  });

  it.runIf(available)('leaves a row re-dated after it was found due as it is, without refusing it', async () => {
    const redated = await order('redated@example.com');
    await set('orders', redated['id'], `held_until = ${at('2027-04-01T09:00:00.000Z')}`);
    const writes = writesWith(async (id) => {
      if (String(id) !== String(redated['id'])) return;
      const { db } = await h.manager.data(h.connectionId);
      const later = dialect === 'postgres' ? '2027-04-01 12:00:00+00' : dialect === 'mysql' ? wall('2027-04-01T12:00:00Z') : '2027-04-01T12:00:00.000Z';
      await sql`update ${sql.table(h.real('orders'))} set held_until = ${later} where id = ${id}`.execute(db);
    });
    const tick = await runTimedMoves({ ...deps, writes }, h.connectionId, {}, clock('2027-04-01T09:30:00Z'));
    expect(tick).toMatchObject({ moved: 0, refused: 0, left: {} });
    expect(await statusOf('orders', redated['id'])).toBe('held');
    // Once its new moment has passed, it moves.
    expect((await runTimedMoves(deps, h.connectionId, {}, clock('2027-04-01T12:00:30Z'))).moved).toBeGreaterThanOrEqual(1);
    expect(await statusOf('orders', redated['id'])).toBe('expired');
  });
});
