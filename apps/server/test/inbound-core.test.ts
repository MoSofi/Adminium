// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The shared inbound core, on every engine, through a made-up channel that is
 * deliberately not SMS: if the core assumed texts, these would not run.
 */
import { createHash } from 'node:crypto';

import { jobsRepo } from '@adminium/meta';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { sql, type Kysely } from 'kysely';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createJobRegistry } from '../src/jobs/registry.js';
import { REDACTED } from '../src/log-scrub.js';
import { addressKeyRing, renewAddressKey } from '../src/consent/keys.js';
import {
  INBOUND_DEFAULT_RETAIN_MS,
  INBOUND_FAILED_BODY_MS,
  INBOUND_FAILED_ROW_MS,
  INBOUND_PARSE_JOB,
  INBOUND_REQUEUE_AFTER_MS,
  INBOUND_STALE_MS,
  InboundFailedError,
  InboundJobError,
  InboundRetryError,
  createInboundCore,
  createInboundEventStore,
  inboundRoutes,
  inboundToken,
  INBOUND_ID_PURPOSE,
  providerIdKey,
  registerInboundJobs,
  safeReason,
  scrubInboundPath,
  type InboundCandidate,
  type InboundChannel,
  type InboundCore,
  type InboundEventStore,
  type InboundHandled,
  type InboundOpened,
  type InboundProof,
} from '../src/inbound/index.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';

const SECRET = 'an-inbound-core-test-secret-of-length';
const T0 = 1_800_000_000_000;
const ONE = { attempt: 1, maxAttempts: 5 };
const LAST = { attempt: 5, maxAttempts: 5 };
const PRIVATE_TEXT = 'my private message about a rash';
const SUBJECT = 'mailto:marta@lumen.example';

const candidate = (id: string, extra: Partial<InboundCandidate> = {}): InboundCandidate => ({ providerId: id, kind: 'message', subject: SUBJECT, body: PRIVATE_TEXT, occurredAt: T0 - 1000, ...extra });

type FakeChannel = InboundChannel & { handled: InboundOpened[]; next: (event: InboundOpened) => Promise<InboundHandled> };

function fakeChannel(name: string, over: Partial<InboundChannel> = {}): FakeChannel {
  const channel: FakeChannel = {
    channel: name,
    bodyLimit: 1024,
    handled: [],
    next: async () => ({ outcome: 'processed' }),
    reach: async () => ({ open: true, origin: 'https://door.lumen.example' }),
    account: async (source: string) => (source === 'known' ? ({ state: 'ready', account: 'acct1' } as const) : source === 'down' ? ({ state: 'unavailable' } as const) : ({ state: 'unknown' } as const)),
    prove: async (): Promise<InboundProof> => ({ genuine: true, events: [candidate('door-1')] }),
    async handle(event: InboundOpened) {
      channel.handled.push(event);
      return channel.next(event);
    },
    ...over,
  };
  return channel;
}

describe.each(META_ENGINES)('inbound core — $name', (engine) => {
  let handle: MetaHandle;
  let store: InboundEventStore;
  let clock: number;
  let queued: string[];
  let channel: ReturnType<typeof fakeChannel>;
  let core: InboundCore;

  const db = (): Kysely<Record<string, Record<string, unknown>>> => handle.meta.db as unknown as Kysely<Record<string, Record<string, unknown>>>;
  const accept = (events: InboundCandidate[], account = 'acct1') => core.accept({ channel: 'notes', account, source: 'known', events });

  beforeAll(async () => {
    if (!engine.available) return;
    handle = await engine.make();
  });
  afterAll(async () => {
    if (engine.available) await handle.destroy();
  });
  beforeEach(async () => {
    if (!engine.available) return;
    await sql`delete from adminium_inbound_events`.execute(handle.meta.db);
    await sql`delete from adminium_jobs`.execute(handle.meta.db);
    clock = T0;
    queued = [];
    channel = fakeChannel('notes');
    store = createInboundEventStore(handle.meta);
    core = createInboundCore({ meta: handle.meta, secret: SECRET, channels: [channel], store, now: () => clock, enqueue: async (id) => queued.push(id) });
  });

  const only = engine.available ? it : it.skip;

  async function theOne() {
    const rows = await db().selectFrom('adminium_inbound_events').selectAll().execute();
    expect(rows).toHaveLength(1);
    return rows[0] as Record<string, unknown>;
  }

  only('stores an event once, however often it comes', async () => {
    expect(await accept([candidate('a')])).toEqual({ stored: 1, duplicates: 0 });
    expect(await accept([candidate('a')])).toEqual({ stored: 0, duplicates: 1 });
    await theOne();
  });

  only('keeps ids that differ only in case apart, on a case-blind collation too', async () => {
    expect(await accept([candidate('Abc'), candidate('aBC')])).toEqual({ stored: 2, duplicates: 0 });
  });

  only('keys on channel and account as well as the id', async () => {
    const other = fakeChannel('other');
    const both = createInboundCore({ meta: handle.meta, secret: SECRET, channels: [channel, other], store, now: () => clock, enqueue: async () => undefined });
    await both.accept({ channel: 'notes', account: 'acct1', source: 'known', events: [candidate('same')] });
    expect((await both.accept({ channel: 'other', account: 'acct1', source: 'known', events: [candidate('same')] })).stored).toBe(1);
    expect((await both.accept({ channel: 'notes', account: 'acct2', source: 'known', events: [candidate('same')] })).stored).toBe(1);
  });

  only('never holds the body or the sender in clear', async () => {
    await accept([candidate('a')]);
    const row = await theOne();
    const flat = JSON.stringify(row);
    expect(flat).not.toContain('rash');
    expect(flat).not.toContain('marta');
    expect(flat).not.toContain('"a"');
    expect(row['providerId']).toBe(providerIdKey('a', await addressKeyRing(handle.meta, SECRET).derivedForWrite(INBOUND_ID_PURPOSE)));
    expect(String(row['sealedBody'])).toMatch(/^enc:/);
  });

  only('keeps no digest of a provider id that a list of numbers could be walked back from', async () => {
    const phoneId = 'optout:+4915123456789:2026-06-15T12:00:00.000Z';
    await accept([candidate(phoneId)]);
    const row = await theOne();
    expect(row['providerId']).not.toBe(createHash('sha256').update(phoneId, 'utf8').digest('hex'));
  });

  only('a re-delivery after a new address key is still a repeat', async () => {
    await accept([candidate('kept')]);
    await renewAddressKey(handle.meta, SECRET);
    expect(await core.accept({ channel: 'notes', account: 'acct1', source: 'known', events: [candidate('kept')] })).toEqual({ stored: 0, duplicates: 1 });
    expect(await db().selectFrom('adminium_inbound_events').select('id').execute()).toHaveLength(1);
  });

  only('a job reclaimed while the dead worker\'s claim still reads live asks to run again, and then does the work', async () => {
    await accept([candidate('a')]);
    const id = queued[0]!;
    expect(await store.claim(id, clock, clock - INBOUND_STALE_MS)).not.toBeNull();
    let ran = 0;
    channel.next = async () => {
      ran += 1;
      return { outcome: 'processed' };
    };
    clock += 5 * 60_000 + 1;
    await expect(core.run(id, { attempt: 2, maxAttempts: 5 })).rejects.toBeInstanceOf(InboundJobError);
    expect(ran).toBe(0);
    expect((await store.byId(id))?.state).toBe('working');
    clock += INBOUND_STALE_MS;
    expect(await core.run(id, { attempt: 3, maxAttempts: 5 })).toEqual({ state: 'processed' });
    expect(ran).toBe(1);
  });

  only('a channel that fails to catch up does not fail the sweep', async () => {
    let asked = 0;
    const catching = { ...channel, catchUp: async () => {
      asked += 1;
      throw new Error('provider away');
    } };
    const withCatchUp = createInboundCore({ meta: handle.meta, secret: SECRET, channels: [catching], store, now: () => clock, enqueue: async () => undefined });
    await expect(withCatchUp.sweep()).resolves.toMatchObject({ requeued: 0 });
    expect(asked).toBe(1);
  });

  only('says whether a person has an event of a kind still waiting', async () => {
    await accept([candidate('a')]);
    expect(await core.waitingFrom(SUBJECT, [candidate('a').kind])).toBe(true);
    expect(await core.waitingFrom(SUBJECT, ['some-other-kind'])).toBe(false);
    expect(await core.waitingFrom('tel:+4915100000000', [candidate('a').kind])).toBe(false);
    await core.run(queued[0]!, ONE);
    expect(await core.waitingFrom(SUBJECT, [candidate('a').kind])).toBe(false);
  });

  only('queues the job, and a queue that fails does not lose the stored event', async () => {
    await accept([candidate('a')]);
    expect(queued).toHaveLength(1);
    const failing = createInboundCore({ meta: handle.meta, secret: SECRET, channels: [channel], store, now: () => clock, enqueue: async () => { throw new Error('queue down'); } });
    expect(await failing.accept({ channel: 'notes', account: 'acct1', source: 'known', events: [candidate('b')] })).toEqual({ stored: 1, duplicates: 0 });
    clock += INBOUND_REQUEUE_AFTER_MS + 1;
    queued = [];
    const swept = await core.sweep();
    expect(swept.requeued).toBe(2);
    expect(queued).toHaveLength(2);
  });

  only('a repeat of an event still waiting nudges its job; one already done does not', async () => {
    await accept([candidate('a')]);
    await accept([candidate('a')]);
    expect(queued).toHaveLength(2);
    await core.run(queued[0]!, ONE);
    queued = [];
    await accept([candidate('a')]);
    expect(queued).toHaveLength(0);
  });

  only('opens the body for its channel, then drops it', async () => {
    await accept([candidate('a')]);
    expect(await core.run(queued[0]!, ONE)).toEqual({ state: 'processed' });
    expect(channel.handled[0]?.body).toBe(PRIVATE_TEXT);
    const row = await theOne();
    expect(row['state']).toBe('processed');
    expect(row['sealedBody']).toBeNull();
    expect(Number(row['retainUntil'])).toBe(T0 + INBOUND_DEFAULT_RETAIN_MS);
  });

  only('honours a channel asking to keep the row longer', async () => {
    channel.next = async () => ({ outcome: 'ignored', retainMs: 5, reason: 'nothing-here' });
    await accept([candidate('a')]);
    expect(await core.run(queued[0]!, ONE)).toEqual({ state: 'ignored' });
    const row = await theOne();
    expect(Number(row['retainUntil'])).toBe(T0 + 5);
    expect(row['reason']).toBe('nothing-here');
  });

  only('runs an event once: a second job finds nothing to do', async () => {
    await accept([candidate('a')]);
    await core.run(queued[0]!, ONE);
    expect(await core.run(queued[0]!, ONE)).toEqual({ state: 'skipped' });
    expect(channel.handled).toHaveLength(1);
  });

  only('a throw gives the claim back and asks for a retry, with a message that quotes nothing', async () => {
    channel.next = async () => { throw new Error(`could not read ${PRIVATE_TEXT} from +4915123456789`); };
    await accept([candidate('a')]);
    const error = await core.run(queued[0]!, ONE).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(InboundJobError);
    expect((error as Error).message).not.toContain('rash');
    expect((error as Error).message).not.toContain('+49');
    const row = await theOne();
    expect(row['state']).toBe('pending');
    expect(row['reason']).toBe('handler-error');
    expect(row['sealedBody']).not.toBeNull();
  });

  only('the last failed try lands on the failed list with its body kept', async () => {
    channel.next = async () => { throw new Error('nope'); };
    await accept([candidate('a')]);
    expect(await core.run(queued[0]!, LAST)).toEqual({ state: 'failed' });
    const row = await theOne();
    expect(row['state']).toBe('failed');
    expect(row['sealedBody']).not.toBeNull();
    expect(Number(row['retainUntil'])).toBe(T0 + INBOUND_FAILED_ROW_MS);
  });

  only('a permanent failure goes to the list on its first try', async () => {
    channel.next = async () => { throw new InboundFailedError('unreadable-number'); };
    await accept([candidate('a')]);
    expect(await core.run(queued[0]!, ONE)).toEqual({ state: 'failed' });
    expect((await theOne())['reason']).toBe('unreadable-number');
  });

  only('a retry error can end as ignored instead of failed', async () => {
    channel.next = async () => { throw new InboundRetryError('no-such-message', { finally: 'ignored' }); };
    await accept([candidate('a')]);
    await expect(core.run(queued[0]!, ONE)).rejects.toBeInstanceOf(InboundJobError);
    expect(await core.run(queued[0]!, LAST)).toEqual({ state: 'ignored' });
    expect((await theOne())['sealedBody']).toBeNull();
  });

  only('a worker that lost its claim cannot finish over the one that took over', async () => {
    await accept([candidate('a')]);
    const id = queued[0]!;
    const first = await store.claim(id, clock, clock - INBOUND_STALE_MS);
    expect(first).not.toBeNull();
    expect(await store.claim(id, clock + 1, clock + 1 - INBOUND_STALE_MS)).toBeNull();
    clock += INBOUND_STALE_MS + 1;
    const second = await store.claim(id, clock, clock - INBOUND_STALE_MS);
    expect(second?.attempts).toBe(2);
    expect(await store.finish(id, first!.claimedAt!, { state: 'processed', reason: null, at: clock, retainUntil: clock })).toBe(false);
    expect(await store.release(id, first!.claimedAt!, 'late')).toBe(false);
    expect(await store.finish(id, second!.claimedAt!, { state: 'processed', reason: null, at: clock, retainUntil: clock })).toBe(true);
  });

  only('lists failed events without their body, pages them, retries and dismisses', async () => {
    channel.next = async () => { throw new InboundFailedError('bad-thing'); };
    await accept([candidate('a')]);
    clock += 1;
    await accept([candidate('b')]);
    clock += 1;
    await accept([candidate('c')]);
    for (const id of queued) await core.run(id, ONE);

    const first = await core.failed.list({ limit: 2 });
    expect(first.events.map((one) => one.reason)).toEqual(['bad-thing', 'bad-thing']);
    expect(JSON.stringify(first)).not.toContain('sealed');
    expect(first.events[0]?.retryable).toBe(true);
    const second = await core.failed.list({ limit: 2, cursor: first.next });
    expect(second.events).toHaveLength(1);
    expect(second.next).toBeNull();
    await expect(core.failed.list({ limit: 2, cursor: 'not-a-cursor' })).rejects.toThrow();

    channel.next = async () => ({ outcome: 'processed' });
    queued = [];
    const target = second.events[0]!.id;
    expect(await core.failed.retry(target)).toBe(true);
    expect(queued).toEqual([target]);
    expect(await core.run(target, ONE)).toEqual({ state: 'processed' });
    expect(await core.failed.retry(target)).toBe(false);

    const closing = first.events[0]!.id;
    expect(await core.failed.dismiss(closing)).toBe(true);
    expect((await store.byId(closing))?.sealedBody).toBeNull();
    expect(await core.failed.dismiss(closing)).toBe(false);
    expect((await core.failed.list({ limit: 10 })).events).toHaveLength(1);
  });

  only('the sweep wipes an old failed body, keeps the row, and then cannot retry it', async () => {
    channel.next = async () => { throw new InboundFailedError('bad-thing'); };
    await accept([candidate('a')]);
    const id = queued[0]!;
    await core.run(id, ONE);
    clock += INBOUND_FAILED_BODY_MS + 1;
    expect((await core.sweep()).bodiesWiped).toBe(1);
    const row = await store.byId(id);
    expect(row?.state).toBe('failed');
    expect(row?.sealedBody).toBeNull();
    expect((await core.failed.list({ limit: 5 })).events[0]?.retryable).toBe(false);
    expect(await core.failed.retry(id)).toBe(false);
  });

  only('the sweep deletes finished rows past their time and nothing still to do', async () => {
    await accept([candidate('done')]);
    await core.run(queued[0]!, ONE);
    await accept([candidate('waiting')]);
    clock += INBOUND_DEFAULT_RETAIN_MS;
    expect((await core.sweep()).deleted).toBe(1);
    const left = await db().selectFrom('adminium_inbound_events').select('providerId').execute();
    expect(left.map((row) => row['providerId'])).toEqual([providerIdKey('waiting', await addressKeyRing(handle.meta, SECRET).derivedForWrite(INBOUND_ID_PURPOSE))]);
  });

  only('the sweep re-queues a job whose worker died', async () => {
    await accept([candidate('a')]);
    const id = queued[0]!;
    await store.claim(id, clock, clock - INBOUND_STALE_MS);
    queued = [];
    clock += INBOUND_REQUEUE_AFTER_MS + 1;
    await core.sweep();
    expect(queued).toEqual([id]);
    clock += INBOUND_STALE_MS;
    expect(await core.run(id, ONE)).toEqual({ state: 'processed' });
  });

  only('erasure keeps only the mark, so a re-delivery stays a duplicate', async () => {
    await accept([candidate('a'), candidate('b', { subject: 'tel:+4915123456789' })]);
    expect(await core.erase({ subject: SUBJECT })).toEqual({ events: 1 });
    const erased = await store.byId(queued[0]!);
    expect(erased?.state).toBe('erased');
    expect(erased?.sealedBody).toBeNull();
    expect(erased?.subject).toBeNull();
    const kept = await store.byId(queued[1]!);
    expect(kept?.state).toBe('pending');
    expect(kept?.sealedBody).not.toBeNull();

    queued = [];
    expect(await accept([candidate('a')])).toEqual({ stored: 0, duplicates: 1 });
    expect(queued).toEqual([]);
    expect((await store.byId(erased!.id))?.sealedBody).toBeNull();
  });

  only('an event erased while its job runs stays erased', async () => {
    await accept([candidate('a')]);
    const id = queued[0]!;
    channel.next = async () => {
      await core.erase({ subject: SUBJECT });
      return { outcome: 'processed' };
    };
    expect(await core.run(id, ONE)).toEqual({ state: 'skipped' });
    expect((await store.byId(id))?.state).toBe('erased');
  });

  only('queues a real job with a key, and the registered kind runs the event', async () => {
    const real = createInboundCore({ meta: handle.meta, secret: SECRET, channels: [channel], store, now: () => clock });
    await real.accept({ channel: 'notes', account: 'acct1', source: 'known', events: [candidate('a')] });
    const event = (await theOne()) as { id: string };
    const job = await jobsRepo(handle.meta).active(`inbound:${event.id}`);
    expect(job?.kind).toBe(INBOUND_PARSE_JOB);
    expect(job?.maxAttempts).toBe(5);
    expect(JSON.stringify(job?.payload)).not.toContain('rash');

    const registry = createJobRegistry();
    registerInboundJobs(registry, real);
    expect(registry.get(INBOUND_PARSE_JOB)?.internal).toBe(true);
    await registry.get(INBOUND_PARSE_JOB)!.run({ eventId: event.id }, { attempt: 1, maxAttempts: 5 } as never);
    expect(channel.handled).toHaveLength(1);
  });
});

describe('the job kind', () => {
  it('turns any other error into a reason, because the worker stores its message', async () => {
    const registry = createJobRegistry();
    const core = { run: async () => { throw new Error('connect failed for +4915123456789'); } } as unknown as InboundCore;
    registerInboundJobs(registry, core);
    const error = await registry.get(INBOUND_PARSE_JOB)!.run({ eventId: 'x' }, { attempt: 1, maxAttempts: 5 } as never).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(InboundJobError);
    expect((error as Error).message).not.toContain('+49');
  });

  it('reduces an odd reason to a fixed word', () => {
    expect(safeReason('fine-word')).toBe('fine-word');
    expect(safeReason('+4915123456789')).toBe('handler-error');
    expect(safeReason('Has Spaces')).toBe('handler-error');
    expect(safeReason(undefined)).toBe('handler-error');
    expect(new InboundFailedError('text of a message').reason).toBe('handler-error');
  });
});

describe('the door', () => {
  let handle: MetaHandle;
  let app: FastifyInstance;
  let order: string[];
  let channel: ReturnType<typeof fakeChannel>;
  let large: ReturnType<typeof fakeChannel>;
  let core: InboundCore;
  let logs: string[];

  const token = (name = 'notes', source = 'known', account = 'acct1'): string => inboundToken(SECRET, name, source, account);
  const post = (url: string, body = 'exact bytes', headers: Record<string, string> = { 'content-type': 'text/plain' }) => app.inject({ method: 'POST', url, payload: body, headers });
  const rows = async () => (await sql<{ n: number }>`select count(*) as n from adminium_inbound_events`.execute(handle.meta.db)).rows[0]!.n;

  beforeAll(async () => {
    handle = await META_ENGINES[0]!.make();
  });
  afterAll(async () => {
    await handle.destroy();
  });

  async function serve(over: Partial<InboundChannel> = {}, wrap?: (real: InboundCore) => InboundCore): Promise<void> {
    order = [];
    logs = [];
    channel = fakeChannel('notes', {
      reach: async () => { order.push('reach'); return { open: true, origin: 'https://door.lumen.example' }; },
      prove: async (delivery) => {
        order.push(`prove:${delivery.body.toString('utf8')}:${delivery.publicUrl}`);
        return { genuine: true, events: [candidate('door-1')] };
      },
      ...over,
    });
    large = fakeChannel('bulky', { bodyLimit: 8192 });
    const real = createInboundCore({ meta: handle.meta, secret: SECRET, channels: [channel, large], enqueue: async () => { order.push('queued'); } });
    core = wrap === undefined ? real : wrap(real);
    app = Fastify({ logger: { level: 'error', stream: { write: (line: string) => logs.push(line) } } });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await app.register(async (api) => api.register(inboundRoutes({ core, channels: [channel, large], secret: SECRET })), { prefix: '/api/v1' });
    await app.ready();
  }

  beforeEach(async () => {
    await sql`delete from adminium_inbound_events`.execute(handle.meta.db);
  });
  afterEach(async () => {
    await app.close();
  });

  it('proves the exact bytes against the stored address, stores, then answers', async () => {
    await serve();
    const reply = await post(`/api/v1/inbound/notes/known/${token()}`, 'exact  bytes\r\n');
    expect(reply.statusCode).toBe(200);
    expect(reply.json()).toEqual({ received: true });
    expect(reply.headers['cache-control']).toBe('no-store');
    expect(order).toEqual(['reach', `prove:exact  bytes\r\n:https://door.lumen.example/api/v1/inbound/notes/known/${token()}`, 'queued']);
    expect(await rows()).toBe(1);
  });

  it('never builds the address from what the request says about itself', async () => {
    await serve();
    await post(`/api/v1/inbound/notes/known/${token()}`, 'x', { 'content-type': 'text/plain', host: 'evil.example', 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'http' });
    expect(order.join()).not.toContain('evil');
    expect(order.join()).toContain('https://door.lumen.example/');
  });

  it('takes any content type as bytes', async () => {
    await serve();
    for (const type of ['application/x-www-form-urlencoded', 'application/json', 'application/weird']) {
      expect((await post(`/api/v1/inbound/notes/known/${token()}`, '{not json', { 'content-type': type })).statusCode).toBe(200);
    }
  });

  it('a closed door answers 503 and reads nothing', async () => {
    await serve({ reach: async () => ({ open: false, origin: null }) });
    expect((await post(`/api/v1/inbound/notes/known/${token()}`)).statusCode).toBe(503);
    expect(order).toEqual([]);
    expect(await rows()).toBe(0);
  });

  it('an open door with no address still answers 503', async () => {
    await serve({ reach: async () => ({ open: true, origin: null }) });
    expect((await post(`/api/v1/inbound/notes/known/${token()}`)).statusCode).toBe(503);
  });

  it('an unknown source is 404, and one that cannot check a proof is 503', async () => {
    await serve();
    expect((await post(`/api/v1/inbound/notes/nope/${token()}`)).statusCode).toBe(404);
    expect((await post(`/api/v1/inbound/notes/down/${token()}`)).statusCode).toBe(503);
  });

  it('a wrong token is 401 and no proof is tried', async () => {
    await serve();
    expect((await post(`/api/v1/inbound/notes/known/${token('notes', 'known', 'other-account')}`)).statusCode).toBe(401);
    expect((await post(`/api/v1/inbound/notes/known/${token('bulky')}`)).statusCode).toBe(401);
    expect((await post('/api/v1/inbound/notes/known/x')).statusCode).toBe(401);
    expect(order.filter((step) => step.startsWith('prove'))).toEqual([]);
    expect(await rows()).toBe(0);
  });

  it('a refused proof writes nothing and answers as the channel says', async () => {
    for (const answer of [400, 401, 403, 503] as const) {
      await serve({ prove: async () => ({ genuine: false, answer, reason: 'bad-signature' }) });
      expect((await post(`/api/v1/inbound/notes/known/${token()}`)).statusCode).toBe(answer);
      expect(await rows()).toBe(0);
      await app.close();
    }
    await serve();
  });

  it('answers 503, never 200, when the event cannot be stored', async () => {
    await serve({}, (real) => ({ ...real, accept: async () => { throw new Error(`insert failed for ${PRIVATE_TEXT}`); } }));
    const reply = await post(`/api/v1/inbound/notes/known/${token()}`);
    expect(reply.statusCode).toBe(503);
    expect(reply.body).not.toContain('rash');
    expect(logs.join()).not.toContain('rash');
  });

  it('answers 503 when the proof itself throws', async () => {
    await serve({ prove: async () => { throw new Error('keys locked'); } });
    expect((await post(`/api/v1/inbound/notes/known/${token()}`)).statusCode).toBe(503);
  });

  it('answers 503 when reach or the account cannot be read', async () => {
    await serve({ reach: async () => { throw new Error('db'); } });
    expect((await post(`/api/v1/inbound/notes/known/${token()}`)).statusCode).toBe(503);
    await app.close();
    await serve({ account: async () => { throw new Error('db'); } });
    expect((await post(`/api/v1/inbound/notes/known/${token()}`)).statusCode).toBe(503);
  });

  it('holds each channel to its own body limit', async () => {
    await serve();
    const big = 'x'.repeat(4096);
    expect((await post(`/api/v1/inbound/notes/known/${token()}`, big)).statusCode).toBe(413);
    expect((await post(`/api/v1/inbound/bulky/known/${token('bulky')}`, big)).statusCode).toBe(200);
    expect((await post(`/api/v1/inbound/bulky/known/${token('bulky')}`, 'x'.repeat(9000))).statusCode).toBe(413);
  });

  it('uses the answer a provider expects when the channel names one', async () => {
    await serve({ prove: async () => ({ genuine: true, events: [], reply: { contentType: 'text/xml', body: '<Response></Response>' } }) });
    const reply = await post(`/api/v1/inbound/notes/known/${token()}`);
    expect(reply.statusCode).toBe(200);
    expect(reply.headers['content-type']).toContain('text/xml');
    expect(reply.body).toBe('<Response></Response>');
  });

  it('the token changes with the channel, the source, the account and the secret', async () => {
    await serve();
    const base = inboundToken(SECRET, 'a', 'b', 'c');
    expect(new Set([base, inboundToken(SECRET, 'x', 'b', 'c'), inboundToken(SECRET, 'a', 'x', 'c'), inboundToken(SECRET, 'a', 'b', 'x'), inboundToken(`${SECRET}2`, 'a', 'b', 'c')]).size).toBe(5);
    expect(base).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe('the token in the log', () => {
  const known = { sms: ['twilio', 'telnyx'] };
  const scrub = (path: string) => scrubInboundPath(path.split('/'), known);

  it('replaces the token and keeps what is known, with the log scrubber\'s own censor', () => {
    expect(scrub('/api/v1/inbound/sms/twilio/SECRETTOKEN')).toBe(`/api/v1/inbound/sms/twilio/${REDACTED}`);
  });

  it('catches an encoded path and a stray slash', () => {
    expect(scrub('/api/v1/%69nbound/sms/twilio/SECRETTOKEN')).not.toContain('SECRETTOKEN');
    expect(scrub('/api/v1/inbound/sms/twilio/x/SECRETTOKEN')).not.toContain('SECRETTOKEN');
  });

  it('treats an unknown channel or source as a token pasted early', () => {
    expect(scrub('/api/v1/inbound/SECRETTOKEN')).toBe('/api/v1/inbound/[REDACTED]');
    expect(scrub('/api/v1/inbound/sms/SECRETTOKEN')).toBe('/api/v1/inbound/sms/[REDACTED]');
    expect(scrub('/api/v1/inbound/__proto__/x')).toBe('/api/v1/inbound/[REDACTED]');
  });

  it('leaves another path alone', () => {
    expect(scrub('/api/v1/sms/setup')).toBeNull();
    expect(scrub('/api/v1/inbound')).toBeNull();
    expect(scrub('/api/v1/inbound/sms')).toBeNull();
    expect(scrub('/api/v1/inbound/sms/twilio')).toBeNull();
  });
});
