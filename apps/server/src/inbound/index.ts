// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The inbound core, shared by every channel that receives: the door, the
 * store-once table, the queued job, the failed list, retention and erasure.
 * A channel implements `InboundChannel`; see `sms/inbound/` for the first one.
 */
export * from './types.js';
export {
  INBOUND_DEFAULT_RETAIN_MS,
  INBOUND_FAILED_BODY_MS,
  INBOUND_FAILED_ROW_MS,
  INBOUND_ID_PURPOSE,
  INBOUND_MAX_ATTEMPTS,
  INBOUND_PARSE_JOB,
  INBOUND_REQUEUE_AFTER_MS,
  INBOUND_STALE_MS,
  INBOUND_SWEEP_BATCH,
  INBOUND_SWEEP_JOB,
  createInboundCore,
  providerIdKey,
  registerInboundJobs,
  type InboundCore,
  type InboundCoreDeps,
  type InboundFailedView,
  type InboundSweepResult,
} from './core.js';
export { INBOUND_API_PREFIX, INBOUND_PATH, inboundAddress, inboundRoutes, inboundToken, type InboundRoutesDeps } from './door.js';
export { scrubInboundPath } from './log.js';
export { createInboundEventStore, type InboundEventStore, type InboundFinish, type InboundPut } from './store.js';
