// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What keeps one bad event, or one bad hour, from hurting the whole server:
 * a process-killing event ends, an outage waits, parse jobs yield to everything
 * else, and a list never loads bodies. On every engine, through the real job
 * table, with a channel that is deliberately not SMS.
 */
import { jobsRepo, type Job, type MetaDb } from '@adminium/meta';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { sql, type KyselyPlugin } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { collectKnownSecrets } from '../src/apps/save/gates/secrets.js';
import {
  INBOUND_CRASHED_REASON,
  INBOUND_DEFER_MAX_MS,
  INBOUND_FAILED_BODY_MS,
  INBOUND_PARSE_JOB,
  INBOUND_PARSE_PRIORITY,
  INBOUND_REQUEUE_AFTER_MS,
  INBOUND_SOURCE_MAX,
  InboundDeferError,
  InboundFailedError,
  createInboundCore,
  createInboundEventStore,
  inboundRoutes,
  inboundToken,
  registerInboundJobs,
  type InboundCandidate,
  type InboundChannel,
  type InboundCore,
  type InboundEventStore,
  type InboundHandled,
  type InboundOpened,
} from '../src/inbound/index.js';
import { createJobRegistry, type JobRegistry } from '../src/jobs/registry.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';

const SECRET = 'an-inbound-limits-test-secret-of-length';
const T0 = 1_800_000_000_000;
const MINUTE = 60_000;
const SUBJECT = 'tel:+4915123456789';
const BODY = 'a private message';

const candidate = (id: string, extra: Partial<InboundCandidate> = {}): InboundCandidate => ({ providerId: id, kind: 'message', subject: SUBJECT, body: BODY, occurredAt: T0 - 1000, ...extra });

type Fake = InboundChannel & { entered: number; next: (event: InboundOpened) => Promise<InboundHandled> };

function fakeChannel(name = 'notes', over: Partial<InboundChannel> = {}): Fake {
  const channel: Fake = {
    channel: name,
    bodyLimit: 1024,
    entered: 0,
    next: async () => ({ outcome: 'processed' }),
    reach: async () => ({ open: true, origin: 'https://door.lumen.example' }),
    account: async () => ({ state: 'ready', account: 'acct1' }),
    prove: async () => ({ genuine: true, events: [candidate('door-1')] }),
    async handle(event) {
      channel.entered += 1;
      return channel.next(event);
    },
    ...over,
  };
  return channel;
}

/** Records every column any query brought back, whatever the store asked for. */
function watchColumns(meta: MetaDb): { meta: MetaDb; columns: Set<string>; largestBodyPage: () => number } {
  const columns = new Set<string>();
  let largest = 0;
  const plugin: KyselyPlugin = {
    transformQuery: (args) => args.node,
    transformResult: async (args) => {
      let bodies = 0;
      for (const row of args.result.rows) {
        const keys = Object.keys(row);
        for (const key of keys) columns.add(key.toLowerCase().replaceAll('_', ''));
        if (keys.some((key) => key.toLowerCase().replaceAll('_', '') === 'sealedbody')) bodies += 1;
      }
      largest = Math.max(largest, bodies);
      return args.result;
    },
  };
  return { meta: { ...meta, db: meta.db.withPlugin(plugin) } as MetaDb, columns, largestBodyPage: () => largest };
}

describe.each(META_ENGINES)('inbound limits — $name', (engine) => {
  let handle: MetaHandle;
  let store: InboundEventStore;
  let clock: number;
  let channel: Fake;
  let core: InboundCore;
  let registry: JobRegistry;

  const only = engine.available ? it : it.skip;
  const jobs = () => jobsRepo(handle.meta);
  const accept = (events: InboundCandidate[]) => core.accept({ channel: 'notes', account: 'acct1', source: 'known', events });
  const ctx = (job: Pick<Job, 'id' | 'attempts' | 'maxAttempts'>) => ({ jobId: job.id, kind: INBOUND_PARSE_JOB, attempt: job.attempts, maxAttempts: job.maxAttempts, signal: new AbortController().signal, progress: () => undefined, log: () => undefined });
  /** One run as the worker makes it, on a given try of the job. */
  const runJob = (eventId: string, attempt = 1) => registry.get(INBOUND_PARSE_JOB)!.run({ eventId }, ctx({ id: 'job_x', attempts: attempt, maxAttempts: 5 }) as never) as Promise<{ state: string }>;
  const onlyId = async (): Promise<string> => {
    const rows = await handle.meta.db.selectFrom('adminium_inbound_events').select('id').execute();
    expect(rows).toHaveLength(1);
    return rows[0]!.id;
  };

  beforeAll(async () => {
    if (engine.available) handle = await engine.make();
  }, 120_000);
  afterAll(async () => {
    if (engine.available) await handle.destroy();
  });
  beforeEach(async () => {
    if (!engine.available) return;
    await sql`delete from adminium_inbound_events`.execute(handle.meta.db);
    await sql`delete from adminium_jobs`.execute(handle.meta.db);
    clock = T0;
    channel = fakeChannel();
    store = createInboundEventStore(handle.meta);
    core = createInboundCore({ meta: handle.meta, secret: SECRET, channels: [channel], store, now: () => clock });
    registry = createJobRegistry();
    registerInboundJobs(registry, core);
  });

  /**
   * The real loop, a minute at a time: the sweep, the job table's reclaim of a
   * dead worker's job, and a handler that never comes back, which is what a
   * killed process looks like from the database. Stops once the event has left
   * `pending` and `working`.
   */
  async function liveThrough(id: string, hours: number): Promise<void> {
    for (let minute = 1; minute <= hours * 60; minute += 1) {
      clock += MINUTE;
      if (minute % 10 === 0) await core.sweep();
      const job = await jobs().claim(`life-${String(minute)}`, clock);
      if (job !== null) {
        const before = channel.entered;
        const run = registry.get(job.kind)!.run(job.payload as never, ctx(job) as never);
        const ended = await Promise.race([
          run.then(() => 'done' as const, () => 'threw' as const),
          (async () => {
            while (channel.entered === before) await new Promise((resolve) => setImmediate(resolve));
            return 'died' as const;
          })(),
        ]);
        if (ended === 'done') await jobs().complete(job.id, clock);
        if (ended === 'threw') await jobs().fail(job.id, 'retry', clock);
      }
      const state = (await store.byId(id))?.state;
      if (state !== 'pending' && state !== 'working') return;
    }
  }

  only('an event that kills the process ends on the failed list after 3 claims, and the server still answers', async () => {
    await accept([candidate('poison')]);
    const id = await onlyId();
    channel.next = () => new Promise(() => undefined);

    await liveThrough(id, 6);

    const row = await store.byId(id);
    expect(row?.state).toBe('failed');
    expect(row?.reason).toBe(INBOUND_CRASHED_REASON);
    expect(row?.sealedBody).not.toBeNull();
    expect(channel.entered).toBe(3);

    // The server took the next delivery and did its work.
    channel.next = async () => ({ outcome: 'processed' });
    channel.prove = async () => ({ genuine: true, events: [candidate('after-the-crashes', { subject: 'tel:+4915100000001' })] });
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await app.register(async (api) => api.register(inboundRoutes({ core, channels: [channel], secret: SECRET, now: () => clock })), { prefix: '/api/v1' });
    await app.ready();
    const reply = await app.inject({ method: 'POST', url: `/api/v1/inbound/notes/known/${inboundToken(SECRET, 'notes', 'known', 'acct1')}`, payload: 'x', headers: { 'content-type': 'text/plain' } });
    await app.close();
    expect(reply.statusCode).toBe(200);
    const job = await jobs().claim('after', clock);
    expect(job?.kind).toBe(INBOUND_PARSE_JOB);
    expect(await registry.get(INBOUND_PARSE_JOB)!.run(job!.payload as never, ctx(job!) as never)).toEqual({ state: 'processed' });
  });

  only('a staff retry gives a crashed event a fresh count', async () => {
    await accept([candidate('poison')]);
    const id = await onlyId();
    channel.next = () => new Promise(() => undefined);
    await liveThrough(id, 6);
    expect(await core.failed.retry(id)).toBe(true);
    channel.next = async () => ({ outcome: 'processed' });
    expect(await runJob(id)).toEqual({ state: 'processed' });
  });

  only('an ordinary error still gets all five tries, and is not called a crash', async () => {
    await accept([candidate('flaky')]);
    const id = await onlyId();
    channel.next = async () => { throw new Error('not now'); };
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await expect(runJob(id, attempt)).rejects.toThrow();
      expect((await store.byId(id))?.state).toBe('pending');
    }
    expect(await runJob(id, 5)).toEqual({ state: 'failed' });
    expect(channel.entered).toBe(5);
    expect((await store.byId(id))?.reason).toBe('handler-error');
  });

  only('one restart does not use up the event: it runs again and finishes', async () => {
    await accept([candidate('restarted')]);
    const id = await onlyId();
    expect(await store.claim(id, clock, clock - 1)).not.toBeNull();
    clock += 11 * MINUTE;
    expect(await runJob(id, 2)).toEqual({ state: 'processed' });
  });

  only('a failed event keeps holding texts to its sender until staff close it', async () => {
    await accept([candidate('maybe-a-stop')]);
    const id = await onlyId();
    channel.next = async () => { throw new InboundFailedError('unreadable-event'); };
    expect(await runJob(id)).toEqual({ state: 'failed' });
    expect(await core.waitingFrom(SUBJECT, ['message'])).toBe(true);
    expect(await core.failed.dismiss(id)).toBe(true);
    expect(await core.waitingFrom(SUBJECT, ['message'])).toBe(false);
  });

  only('a database outage waits: no try is used, the job ends cleanly, and the sweep brings it back', async () => {
    await accept([candidate('outage')]);
    const id = await onlyId();
    channel.next = async () => { throw new InboundDeferError('database-away'); };
    for (let round = 0; round < 8; round += 1) {
      expect(await runJob(id, 5)).toEqual({ state: 'pending' });
      clock += INBOUND_REQUEUE_AFTER_MS + 1;
    }
    const row = await store.byId(id);
    expect(row).toMatchObject({ state: 'pending', attempts: 0, reason: 'database-away' });
    expect(row?.sealedBody).not.toBeNull();

    await sql`delete from adminium_jobs`.execute(handle.meta.db);
    expect((await core.sweep()).requeued).toBe(1);
    channel.next = async () => ({ outcome: 'processed' });
    expect(await runJob(id)).toEqual({ state: 'processed' });
  });

  only('a lost connection counts as an outage without the channel naming it', async () => {
    await accept([candidate('refused')]);
    const id = await onlyId();
    channel.next = async () => { throw Object.assign(new Error('connect failed'), { code: 'ECONNREFUSED' }); };
    expect(await runJob(id, 5)).toEqual({ state: 'pending' });
    expect((await store.byId(id))?.attempts).toBe(0);
  });

  only('an outage cannot hold an event for ever: past the limit it goes to the failed list', async () => {
    await accept([candidate('long-outage')]);
    const id = await onlyId();
    channel.next = async () => { throw new InboundDeferError('database-away'); };
    clock += INBOUND_DEFER_MAX_MS + 1;
    for (let attempt = 1; attempt <= 4; attempt += 1) await expect(runJob(id, attempt)).rejects.toThrow();
    expect(await runJob(id, 5)).toEqual({ state: 'failed' });
    expect((await store.byId(id))?.reason).toBe('database-away');
  });

  only('waiting out a dead worker\'s claim uses no try', async () => {
    await accept([candidate('claim-live')]);
    const id = await onlyId();
    await store.claim(id, clock, clock - 1);
    for (let attempt = 2; attempt <= 4; attempt += 1) await expect(runJob(id, attempt)).rejects.toThrow();
    expect((await store.byId(id))?.attempts).toBe(1);

    // One passing error on the job's last attempt is an ordinary retry, not the end.
    clock += 11 * MINUTE;
    channel.next = async () => { throw new Error('a passing error'); };
    await expect(runJob(id, 5)).rejects.toThrow();
    expect((await store.byId(id))?.state).toBe('pending');
  });

  only('Retry all brings back what can work, and leaves an event that crashed the server', async () => {
    await accept([candidate('a'), candidate('b'), candidate('poison')]);
    const rows = await handle.meta.db.selectFrom('adminium_inbound_events').select('id').execute();
    channel.next = async () => { throw new InboundFailedError('bad-thing'); };
    for (const row of rows) await runJob(row.id);
    const poison = rows[2]!.id;
    await handle.meta.db.updateTable('adminium_inbound_events').set({ reason: INBOUND_CRASHED_REASON }).where('id', '=', poison).execute();
    const noBody = rows[1]!.id;
    await handle.meta.db.updateTable('adminium_inbound_events').set({ sealedBody: null }).where('id', '=', noBody).execute();

    expect(await core.failed.retryAll({ limit: 50 })).toEqual({ retried: 1, more: false });
    expect((await store.byId(rows[0]!.id))?.state).toBe('pending');
    expect((await store.byId(noBody))?.state).toBe('failed');
    expect((await store.byId(poison))?.state).toBe('failed');
  });

  only('Retry all works in batches and says when more are left', async () => {
    await accept([candidate('a'), candidate('b'), candidate('c')]);
    channel.next = async () => { throw new InboundFailedError('bad-thing'); };
    for (const row of await handle.meta.db.selectFrom('adminium_inbound_events').select('id').execute()) await runJob(row.id);
    expect(await core.failed.retryAll({ limit: 2 })).toEqual({ retried: 2, more: true });
    expect(await core.failed.retryAll({ limit: 2 })).toEqual({ retried: 1, more: false });
  });

  only('a parse job waits behind a password reset queued after it', async () => {
    await accept([candidate('burst')]);
    const reset = await jobs().enqueue({ kind: 'email.send', payload: {} }, clock + 1);
    clock += MINUTE;
    expect(INBOUND_PARSE_PRIORITY).toBe(-1);
    expect((await jobs().claim('w', clock))?.id).toBe(reset.id);
    expect((await jobs().claim('w', clock))?.kind).toBe(INBOUND_PARSE_JOB);
  });

  only('the failed list, the repeat check and the write never bring a body back', async () => {
    const watched = watchColumns(handle.meta);
    const quiet = createInboundEventStore(watched.meta);
    const lean = createInboundCore({ meta: handle.meta, secret: SECRET, channels: [channel], store: quiet, now: () => clock, enqueue: async () => undefined });
    await lean.accept({ channel: 'notes', account: 'acct1', source: 'known', events: [candidate('a')] });
    await lean.accept({ channel: 'notes', account: 'acct1', source: 'known', events: [candidate('a')] });
    const id = await onlyId();
    await handle.meta.db.updateTable('adminium_inbound_events').set({ state: 'failed', reason: 'bad-thing' }).where('id', '=', id).execute();
    const listed = await lean.failed.list({ limit: 5 });
    expect(listed.events[0]?.retryable).toBe(true);
    expect(watched.columns.has('sealedbody')).toBe(false);

    await handle.meta.db.updateTable('adminium_inbound_events').set({ sealedBody: null }).where('id', '=', id).execute();
    expect((await lean.failed.list({ limit: 5 })).events[0]?.retryable).toBe(false);
  });

  only('refuses a source longer than its column, on every engine alike', async () => {
    const long = 'x'.repeat(INBOUND_SOURCE_MAX + 1);
    expect(INBOUND_SOURCE_MAX).toBe(32);
    await expect(core.accept({ channel: 'notes', account: 'acct1', source: long, events: [candidate('a')] })).rejects.toThrow();
    expect(await handle.meta.db.selectFrom('adminium_inbound_events').select('id').execute()).toEqual([]);
    expect((await core.accept({ channel: 'notes', account: 'acct1', source: 'x'.repeat(INBOUND_SOURCE_MAX), events: [candidate('a')] })).stored).toBe(1);
  });

  only('the door answers 400 for a source longer than the column and asks the channel nothing', async () => {
    let asked = 0;
    const door = fakeChannel('notes', { account: async () => { asked += 1; return { state: 'ready', account: 'acct1' }; } });
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await app.register(async (api) => api.register(inboundRoutes({ core, channels: [door], secret: SECRET })), { prefix: '/api/v1' });
    await app.ready();
    const long = 'x'.repeat(INBOUND_SOURCE_MAX + 1);
    const reply = await app.inject({ method: 'POST', url: `/api/v1/inbound/notes/${long}/${inboundToken(SECRET, 'notes', long, 'acct1')}`, payload: 'x', headers: { 'content-type': 'text/plain' } });
    await app.close();
    expect(reply.statusCode).toBe(400);
    expect(asked).toBe(0);
  });

  only('a channel can keep failed bodies for less time than the rest', async () => {
    const short = fakeChannel('short', { failedBodyMs: 7 * 24 * 60 * MINUTE });
    const both = createInboundCore({ meta: handle.meta, secret: SECRET, channels: [channel, short], store, now: () => clock, enqueue: async () => undefined });
    await both.accept({ channel: 'notes', account: 'acct1', source: 'known', events: [candidate('kept')] });
    await both.accept({ channel: 'short', account: 'acct1', source: 'known', events: [candidate('wiped')] });
    await handle.meta.db.updateTable('adminium_inbound_events').set({ state: 'failed', reason: 'bad-thing' }).execute();

    clock += 7 * 24 * 60 * MINUTE + 1;
    expect((await both.sweep()).bodiesWiped).toBe(1);
    const rows = await handle.meta.db.selectFrom('adminium_inbound_events').select(['channel', 'sealedBody']).execute();
    expect(rows.find((row) => row.channel === 'short')?.sealedBody).toBeNull();
    expect(rows.find((row) => row.channel === 'notes')?.sealedBody).not.toBeNull();

    clock += INBOUND_FAILED_BODY_MS;
    expect((await both.sweep()).bodiesWiped).toBe(1);
  });

  only('the app-save scan reads text bodies in pages and leaves another channel\'s alone', async () => {
    const sms = fakeChannel('sms');
    const other = fakeChannel('other');
    const both = createInboundCore({ meta: handle.meta, secret: SECRET, channels: [sms, other], store, now: () => clock, enqueue: async () => undefined });
    const texts = Array.from({ length: 130 }, (_, index) => candidate(`text-${String(index)}`, { body: JSON.stringify({ text: `stored text number ${String(index)}` }) }));
    await both.accept({ channel: 'sms', account: 'acct1', source: 'twilio', events: texts });
    await both.accept({ channel: 'other', account: 'acct1', source: 'known', events: [candidate('not-a-text', { body: JSON.stringify({ text: 'a body of another channel' }) })] });

    const watched = watchColumns(handle.meta);
    const known = (await collectKnownSecrets(watched.meta, SECRET)).map((one) => one.value);
    expect(known).toEqual(expect.arrayContaining(['stored text number 0', 'stored text number 129']));
    expect(known).not.toContain('a body of another channel');
    expect(watched.largestBodyPage()).toBeLessThanOrEqual(50);
  });
});
