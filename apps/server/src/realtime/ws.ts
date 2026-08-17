// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WebSocket gateway `GET /ws` (08-server-api.md §3, M2-T07). JSON frames:
 *
 *   client → server: { op: "subscribe" | "unsubscribe", channel } | { op: "ping" }
 *   server → client: { channel, type, data, ts } events,
 *                    { op: "pong" } | { op: "subscribed" | "unsubscribed", channel }
 *                    | { op: "error", code, channel? }
 *
 * (`sub`/`unsub` are accepted as aliases per the §3 protocol sketch.)
 * Unauthenticated upgrades are rejected pre-handshake; channel authorization
 * runs at subscribe time via `authorizeChannel`. Hygiene: protocol-level ping
 * every 30 s (dropped after 2 missed pongs), ≤ 64 channels per socket.
 *
 * The `@fastify/websocket` plugin must be registered before this route —
 * `registerJobsAndRealtime` (jobs/register.ts) does both.
 *
 * ─── Origin check on the upgrade (§7 item 4) ─────────────────────────────────
 *
 * This is the leg where the passive CSRF defences give the least cover, and
 * the one a prefix-scoped defence misses: `/ws` hangs off the ROOT app, not
 * `/api/v1`, and an upgrade is a GET — so the `preValidation` hook in
 * `plugins/core.ts`, which only inspects mutations under a prefix, never sees
 * it. `SameSite=Lax` does not help either: the handshake is a GET, and Lax
 * exists to allow exactly that shape.
 *
 * Left unchecked, any page on any origin could open an authenticated socket in
 * the visitor's browser and subscribe to every channel their session can read
 * — a pure exfiltration channel, no CORS involved, because CORS does not apply
 * to WebSockets at all. The token leg cannot help here: the browser
 * `WebSocket` constructor cannot set headers, and smuggling a token through
 * the query string would put a credential in every access log and referrer.
 * `Origin` is the one signal browsers are REQUIRED to send on a handshake
 * (RFC 6455 §4.1), so it is the right and sufficient control. A handshake with
 * no `Origin` at all is a non-browser client (a CLI, a test, a service) and
 * had to obtain the session cookie some other way.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type {} from '@fastify/websocket'; // route-option `websocket: true` augmentation

import { ForbiddenError, UnauthorizedError } from '../errors.js';
import { classifyOrigin } from '../security/csrf.js';
import {
  authorizeChannel,
  type ChannelAuthDeps,
  type RealtimeHub,
  type RealtimeUser,
} from './hub.js';

/** Max concurrent channel subscriptions per socket. */
export const WS_MAX_CHANNELS = 64;

/** Protocol-level heartbeat interval. */
export const WS_HEARTBEAT_INTERVAL_MS = 30_000;

/** Heartbeats without a pong before the socket is dropped. */
export const WS_MAX_MISSED_PONGS = 2;

/** Everything the realtime gateway needs from the rest of the server. */
export interface RealtimeGatewayDeps extends ChannelAuthDeps {
  hub: RealtimeHub;
  /**
   * Session resolution — wired by the integrator to the auth plugin
   * (e.g. `(req) => req.user ?? null`).
   */
  resolveUser(request: FastifyRequest): Promise<RealtimeUser | null> | RealtimeUser | null;
  /** Heartbeat override for tests. */
  heartbeatIntervalMs?: number | undefined;
}

interface ClientFrame {
  op?: unknown;
  channel?: unknown;
}

/** Registers `GET /ws`. Call after `app.register(websocket)`. */
export function registerWsRoute(app: FastifyInstance, deps: RealtimeGatewayDeps): void {
  const users = new WeakMap<FastifyRequest, RealtimeUser>();
  const heartbeatMs = deps.heartbeatIntervalMs ?? WS_HEARTBEAT_INTERVAL_MS;

  // The CORS allowlist `corePlugin` decorated, so the socket and the HTTP
  // hook agree on one set of trusted origins. Absent in the minimal harnesses
  // that mount this route without core — those have no CORS config either, so
  // an empty set is the same answer.
  const allowedOrigins = app.hasDecorator('csrfOrigins')
    ? app.csrfOrigins
    : new Set<string>();

  app.get(
    '/ws',
    {
      websocket: true,
      // Runs before the upgrade completes — a thrown 401/403 rejects the
      // handshake with the standard error envelope (§3 "pre-handshake").
      preValidation: async (request) => {
        // Order matters: a foreign page learns nothing about whether the
        // visitor even has a session here.
        if (classifyOrigin(request, allowedOrigins) === 'foreign') {
          request.log.warn(
            { origin: request.headers.origin, host: request.headers.host },
            'ws upgrade refused — foreign origin',
          );
          throw new ForbiddenError('This socket may only be opened from Adminium.', 'CSRF_FAILED');
        }
        const user = await deps.resolveUser(request);
        if (user === null) throw new UnauthorizedError();
        users.set(request, user);
      },
    },
    (socket, request) => {
      const user = users.get(request);
      if (user === undefined) {
        socket.close(1011, 'no session');
        return;
      }

      const subscriptions = new Map<string, () => void>();
      const send = (frame: unknown): void => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(frame));
      };

      // --- heartbeat -------------------------------------------------------------
      let missedPongs = 0;
      socket.on('pong', () => {
        missedPongs = 0;
      });
      const heartbeat = setInterval(() => {
        if (missedPongs >= WS_MAX_MISSED_PONGS) {
          socket.terminate();
          return;
        }
        missedPongs += 1;
        socket.ping();
      }, heartbeatMs);
      heartbeat.unref?.();

      // --- protocol --------------------------------------------------------------
      const onFrame = async (raw: unknown): Promise<void> => {
        let frame: ClientFrame;
        try {
          frame = JSON.parse(String(raw)) as ClientFrame;
        } catch {
          send({ op: 'error', code: 'VALIDATION_FAILED', message: 'frames must be JSON objects' });
          return;
        }
        const op = frame.op;

        if (op === 'ping') {
          send({ op: 'pong' });
          return;
        }

        if (op !== 'subscribe' && op !== 'sub' && op !== 'unsubscribe' && op !== 'unsub') {
          send({ op: 'error', code: 'VALIDATION_FAILED', message: 'unknown op' });
          return;
        }

        const channel = frame.channel;
        if (typeof channel !== 'string' || channel.length === 0) {
          send({ op: 'error', code: 'VALIDATION_FAILED', message: 'channel required' });
          return;
        }

        if (op === 'unsubscribe' || op === 'unsub') {
          subscriptions.get(channel)?.();
          subscriptions.delete(channel);
          send({ op: 'unsubscribed', channel });
          return;
        }

        // subscribe
        if (subscriptions.has(channel)) {
          send({ op: 'subscribed', channel });
          return;
        }
        if (subscriptions.size >= WS_MAX_CHANNELS) {
          send({ op: 'error', code: 'LIMIT_EXCEEDED', channel });
          return;
        }
        if (!(await authorizeChannel(user, channel, deps))) {
          send({ op: 'error', code: 'FORBIDDEN', channel });
          return;
        }
        subscriptions.set(
          channel,
          deps.hub.subscribe(channel, (event) => send(event)),
        );
        send({ op: 'subscribed', channel });
      };

      socket.on('message', (raw: unknown) => {
        void onFrame(raw).catch((err: unknown) => {
          request.log.error({ err }, 'ws frame handling failed');
          send({ op: 'error', code: 'INTERNAL' });
        });
      });

      socket.on('close', () => {
        clearInterval(heartbeat);
        for (const unsubscribe of subscriptions.values()) unsubscribe();
        subscriptions.clear();
      });
    },
  );
}
