// SPDX-License-Identifier: AGPL-3.0-only
/**
 * SSE fallback `GET /api/v1/events?channels=a,b` (08-server-api.md §3,
 * M2-T07) for proxies/environments without WebSocket. Same channel model and
 * subscribe-time authorization as `/ws`; events are framed as
 *
 *   event: <type>
 *   data: {"channel":…,"type":…,"data":…,"ts":…}
 *
 * with an initial `retry:` hint and `: keep-alive` comments every 25 s.
 * `?topics=` is accepted as an alias (§3 sketch uses "topics").
 *
 * Register inside the `/api/v1` prefix scope — `registerJobsAndRealtime`
 * (jobs/register.ts) does.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { ForbiddenError, UnauthorizedError, ValidationFailedError } from '../errors.js';
import { authorizeChannel } from './hub.js';
import type { RealtimeGatewayDeps } from './ws.js';

/** Keep-alive comment interval. */
export const SSE_KEEPALIVE_MS = 25_000;

/** Client reconnect hint (`retry:` field). */
export const SSE_RETRY_MS = 5_000;

/** Max channels per stream (matches the WS per-socket cap). */
export const SSE_MAX_CHANNELS = 64;

export const eventsQuery = z.object({
  /** Comma-separated channel list. */
  channels: z.string().max(4096).optional(),
  /** Alias per the §3 protocol sketch. */
  topics: z.string().max(4096).optional(),
});
export type EventsQuery = z.infer<typeof eventsQuery>;

export interface SseRouteOptions {
  /** Keep-alive override for tests. */
  keepAliveMs?: number | undefined;
}

/** Registers `GET /events` on the given (already `/api/v1`-prefixed) scope. */
export function registerSseRoute(
  app: FastifyInstance,
  deps: RealtimeGatewayDeps,
  opts: SseRouteOptions = {},
): void {
  const keepAliveMs = opts.keepAliveMs ?? SSE_KEEPALIVE_MS;

  app.get<{ Querystring: EventsQuery }>(
    '/events',
    { schema: { querystring: eventsQuery } },
    async (request, reply) => {
      const user = await deps.resolveUser(request);
      if (user === null) throw new UnauthorizedError();

      const raw = [request.query.channels, request.query.topics]
        .filter((v): v is string => typeof v === 'string' && v.length > 0)
        .join(',');
      const channels = [...new Set(raw.split(',').map((c) => c.trim()).filter((c) => c.length > 0))];
      if (channels.length === 0) {
        throw new ValidationFailedError('at least one channel is required (?channels=a,b)');
      }
      if (channels.length > SSE_MAX_CHANNELS) {
        throw new ValidationFailedError(`at most ${SSE_MAX_CHANNELS} channels per stream`, {
          requested: channels.length,
        });
      }
      for (const channel of channels) {
        if (!(await authorizeChannel(user, channel, deps))) {
          throw new ForbiddenError(`You cannot subscribe to "${channel}".`, 'FORBIDDEN', {
            channel,
          });
        }
      }

      // Long-lived stream: take the raw socket over from Fastify.
      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
        'x-request-id': String(request.id),
      });
      res.write(`retry: ${SSE_RETRY_MS}\n\n`);

      const unsubscribes = channels.map((channel) =>
        deps.hub.subscribe(channel, (event) => {
          res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        }),
      );

      const keepAlive = setInterval(() => {
        res.write(`: keep-alive ${new Date().toISOString()}\n\n`);
      }, keepAliveMs);
      keepAlive.unref?.();

      let closed = false;
      const close = (): void => {
        if (closed) return;
        closed = true;
        clearInterval(keepAlive);
        for (const unsubscribe of unsubscribes) unsubscribe();
        res.end();
      };
      request.raw.on('close', close);
      res.on('close', close);
    },
  );
}
