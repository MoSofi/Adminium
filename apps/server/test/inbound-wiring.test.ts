// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The inbound parts stand on their own: a server with no SMS account and some
 * other channel still sweeps, and SMS joins them as one channel among others.
 */
import { jobsRepo } from '@adminium/meta';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { INBOUND_PARSE_JOB, INBOUND_SWEEP_JOB, createInboundWiring, inboundToken, type InboundChannel } from '../src/inbound/index.js';
import { createJobRegistry } from '../src/jobs/registry.js';
import { createSmsWiring } from '../src/sms/wiring.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';

const SECRET = 'an-inbound-wiring-test-secret-of-length';

function channelOf(name: string, hasSource: () => Promise<boolean>): InboundChannel {
  return {
    channel: name,
    bodyLimit: 1024,
    hasSource,
    reach: async () => ({ open: true, origin: 'https://door.lumen.example' }),
    account: async () => ({ state: 'ready', account: 'acct1' }),
    prove: async () => ({ genuine: true, events: [{ providerId: 'one', kind: 'message', subject: null, body: 'x', occurredAt: null }] }),
    handle: async () => ({ outcome: 'processed' }),
  };
}

describe.each(META_ENGINES)('the inbound wiring — $name', (engine) => {
  let handle: MetaHandle;
  const only = engine.available ? it : it.skip;

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
  });

  only('queues no sweep while no channel has a source and nothing is stored', async () => {
    const wiring = createInboundWiring({ meta: handle.meta, secret: SECRET });
    wiring.addChannel(channelOf('notes', async () => false));
    expect(await wiring.enqueueSweep()).toBeNull();
    expect(await handle.meta.db.selectFrom('adminium_jobs').select('id').execute()).toEqual([]);
  });

  only('sweeps for a channel with a source, with no SMS account anywhere', async () => {
    const wiring = createInboundWiring({ meta: handle.meta, secret: SECRET });
    wiring.addChannel(channelOf('quiet', async () => false));
    wiring.addChannel(channelOf('notes', async () => true));
    const sweep = await wiring.enqueueSweep();
    expect((await jobsRepo(handle.meta).findById(sweep!.id))?.kind).toBe(INBOUND_SWEEP_JOB);
  });

  only('sweeps for a stored event after its channel lost its source', async () => {
    const wiring = createInboundWiring({ meta: handle.meta, secret: SECRET });
    wiring.addChannel(channelOf('notes', async () => false));
    await wiring.core.accept({ channel: 'notes', account: 'acct1', source: 'known', events: [{ providerId: 'kept', kind: 'message', subject: null, body: 'x', occurredAt: null }] });
    expect(await wiring.enqueueSweep()).not.toBeNull();
  });

  only('a channel that cannot say still gets its sweep', async () => {
    const wiring = createInboundWiring({ meta: handle.meta, secret: SECRET });
    wiring.addChannel(channelOf('notes', async () => { throw new Error('store away'); }));
    expect(await wiring.enqueueSweep()).not.toBeNull();
  });

  only('takes a channel added after it was built: door, job and core all know it', async () => {
    const wiring = createInboundWiring({ meta: handle.meta, secret: SECRET });
    wiring.addChannel(channelOf('notes', async () => true));
    const registry = createJobRegistry();
    wiring.registerJobs(registry);
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await app.register(async (api) => api.register(wiring.doorRoutes()), { prefix: '/api/v1' });
    await app.ready();
    const reply = await app.inject({ method: 'POST', url: `/api/v1/inbound/notes/known/${inboundToken(SECRET, 'notes', 'known', 'acct1')}`, payload: 'x', headers: { 'content-type': 'text/plain' } });
    await app.close();
    expect(reply.statusCode).toBe(200);
    const job = await jobsRepo(handle.meta).claim('w');
    expect(job?.kind).toBe(INBOUND_PARSE_JOB);
    expect(await registry.get(INBOUND_PARSE_JOB)!.run(job!.payload as never, { attempt: 1, maxAttempts: 5 } as never)).toEqual({ state: 'processed' });
  });

  only('refuses two channels of one name', () => {
    const wiring = createInboundWiring({ meta: handle.meta, secret: SECRET });
    wiring.addChannel(channelOf('notes', async () => true));
    expect(() => wiring.addChannel(channelOf('notes', async () => true))).toThrow();
  });

  only('SMS joins as a channel and shares the one core', async () => {
    const inbound = createInboundWiring({ meta: handle.meta, secret: SECRET });
    inbound.addChannel(channelOf('notes', async () => false));
    const sms = createSmsWiring({ meta: handle.meta, secret: SECRET, inbound, networkFeatures: false, desktop: false, trustProxy: false, operator: () => ({ allowed: true, reason: null }), log: { info: () => undefined } });
    expect(sms.inbound).toBe(inbound.core);
    // No SMS account and nothing stored: SMS asks for no sweep either.
    expect(await inbound.enqueueSweep()).toBeNull();
    await inbound.core.accept({ channel: 'sms', account: 'acct', source: 'twilio', events: [{ providerId: 'sms-1', kind: 'reply', subject: null, body: '{}', occurredAt: null }] });
    expect(await inbound.enqueueSweep()).not.toBeNull();
  });
});
