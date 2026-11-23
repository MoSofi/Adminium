// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The inbound core, put together once for `compose.ts`, with no channel of its
 * own. Each channel adds itself before the routes are registered.
 *
 * Building it does nothing outward: no timer starts, and the sweep queues no
 * job while no channel has a source and nothing is stored.
 */
import { jobsRepo, type EnqueueJobInput, type MetaDb } from '@adminium/meta';
import type { FastifyPluginAsync } from 'fastify';

import type { JobRegistry } from '../jobs/registry.js';
import { createInboundCore, INBOUND_SWEEP_JOB, registerInboundJobs, type InboundCore } from './core.js';
import { inboundRoutes } from './door.js';
import type { InboundChannel } from './types.js';

export const INBOUND_SWEEP_SCHEDULE = 'inbound-sweep';
/** Often enough for an event whose job could not be queued. Each channel limits how often it asks its provider. */
export const INBOUND_SWEEP_CRON = '*/10 * * * *';

export interface InboundWiringDeps {
  meta: MetaDb;
  /** `ADMINIUM_SECRET`. */
  secret: string;
  now?: (() => number) | undefined;
}

export interface InboundWiring {
  core: InboundCore;
  /** Adds a channel. Call before {@link InboundWiring.doorRoutes}, which gives each channel its route. */
  addChannel(channel: InboundChannel): void;
  doorRoutes(): FastifyPluginAsync;
  registerJobs(registry: JobRegistry): void;
  /** Queues the sweep when there is something for it to do. */
  enqueueSweep(enqueue?: (input: EnqueueJobInput) => Promise<{ id: string }>): Promise<{ id: string } | null>;
}

export function createInboundWiring(deps: InboundWiringDeps): InboundWiring {
  const { meta, secret } = deps;
  const now = deps.now ?? Date.now;
  const channels: InboundChannel[] = [];
  const core = createInboundCore({ meta, secret, channels, now });

  async function sweepWanted(): Promise<boolean> {
    for (const channel of channels) {
      try {
        if (channel.hasSource === undefined || (await channel.hasSource())) return true;
      } catch {
        // It cannot say, so it is not told there is nothing to do.
        return true;
      }
    }
    return (await meta.db.selectFrom('adminium_inbound_events').select('id').limit(1).executeTakeFirst()) !== undefined;
  }

  return {
    core,

    addChannel(channel) {
      if (channels.some((one) => one.channel === channel.channel)) throw new Error(`The inbound channel ${channel.channel} is already added.`);
      channels.push(channel);
    },

    doorRoutes: () => inboundRoutes({ core, channels, secret, now }),

    registerJobs: (registry) => registerInboundJobs(registry, core),

    async enqueueSweep(enqueue) {
      if (!(await sweepWanted())) return null;
      const input: EnqueueJobInput = { kind: INBOUND_SWEEP_JOB, payload: {}, dedupeKey: INBOUND_SWEEP_SCHEDULE, maxAttempts: 1 };
      return enqueue === undefined ? jobsRepo(meta).enqueue(input, now()) : enqueue(input);
    },
  };
}
