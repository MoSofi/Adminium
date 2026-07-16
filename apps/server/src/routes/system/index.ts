/**
 * System routes: `GET /healthz`, `GET /readyz` and `GET /system/info` (mounted
 * under /api/v1).
 *
 * TWO PROBES, TWO QUESTIONS (01-architecture.md §4.1 lists both):
 *  - `/healthz` — LIVENESS. Is the process up and serving? Never fails on a
 *    dependency, because a restart cannot fix a dependency. This is what the
 *    Dockerfile HEALTHCHECK and docker-compose.yml run.
 *  - `/readyz` — READINESS. Can it serve a real request, i.e. is the meta store
 *    reachable? Answers 503 when not, so a load balancer stops routing to an
 *    instance that would 500 every request.
 * Point orchestration at whichever question you are actually asking; see
 * `./handlers.ts` for why conflating the two is a trap.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { healthz, readyz, systemInfo } from './handlers.js';
import { systemHealthzReply, systemInfoReply, systemReadyzReply } from './schema.js';

export const systemRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/healthz', { schema: { response: { 200: systemHealthzReply } } }, async () => healthz());

  app.get(
    '/readyz',
    { schema: { response: { 200: systemReadyzReply, 503: systemReadyzReply } } },
    async (_request, reply) => {
      // The meta handle rides on `authContext`, null when the server booted
      // without a meta store — which `readyz` reports as not-ready too.
      const result = await readyz(app.authContext?.meta ?? null);
      void reply.status(result.ok ? 200 : 503);
      return result;
    },
  );

  app.get(
    '/system/info',
    { schema: { response: { 200: systemInfoReply } } },
    // The meta handle rides on `authContext`, which is null when the server
    // boots without a meta store — then `dialect` is honestly null.
    async () => systemInfo(app.authContext?.meta.dialect ?? null),
  );
};
