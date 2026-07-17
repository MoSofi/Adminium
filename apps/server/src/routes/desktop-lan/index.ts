/**
 * `GET /api/v1/desktop/lan-share` — what §8.3's share panel needs from the side
 * of the boundary that holds the data (11-electron.md §8.3, §1 principle 2).
 *
 * The panel is built from two sources and this is one of them. §4's bridge
 * supplies what only the main process knows — the reachable
 * `http://<LAN-IPv4>:<port>` URLs, which come from `os.networkInterfaces()` in a
 * process that has interfaces to enumerate. This route supplies what only the
 * server knows: who is connected, and whether there is anyone to invite. Neither
 * can answer the other's question, which is why the panel asks both.
 *
 * ─── The gates, in order, mirroring `routes/desktop/index.ts` ────────────────
 *
 *  1. EXISTENCE. `compose.ts` registers this factory only when
 *     `ADMINIUM_RUNTIME=desktop`. Self-host has no LAN-share feature to report
 *     on — it binds `0.0.0.0` as its normal, correct configuration behind a
 *     reverse proxy, and "how many non-loopback sessions do you have" is a
 *     question about EVERY session there. The route would answer a different
 *     question under the same name, which is worse than 404.
 *  2. PEER. The SOCKET's `remoteAddress` must be loopback — `request.raw.socket`,
 *     never `request.ip`; see `auth/desktop-session.ts` for why that distinction
 *     is the difference between a check and a vulnerability. This is the gate
 *     with the most direct reasoning behind it in the whole file: the route
 *     exists ONLY when the server is bound to every interface, so the LAN users
 *     §8.3 invited can reach it by construction. Without this gate, any of them
 *     with a super-admin account — and §8.3's whole point is that LAN users get
 *     real accounts — could enumerate how many other people are on the network
 *     right now. That is a surveillance surface, and it is not one the panel's
 *     owner asked for. The panel is a LOCAL affordance about the local machine;
 *     it belongs to the person sitting at it.
 *  3. SESSION + RBAC. `system:settings:manage`, i.e. Super Admin — the same
 *     grant `routes/desktop/index.ts` requires for a backup, and for the same
 *     reason: `config.lanShare` is a security setting, and the count of who is
 *     connected is the operational half of it. There is no narrower system
 *     action in meta's closed set (`SYSTEM_ACTION_KEYS`) and this route is not
 *     the place to invent one.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { MetaDb } from '@adminium/meta';

import { isLoopbackPeer } from '../../auth/desktop-session.js';
import type { Env } from '../../config/env.js';
import { readLanShareStatus } from '../../desktop/lan-share.js';
import { AppError } from '../../errors.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import { desktopLanShareReply, type DesktopLanShareReply } from './schema.js';

export interface DesktopLanRoutesDeps {
  meta: MetaDb;
  /**
   * The validated boot environment. INJECTED for the reason
   * `routes/system/index.ts` gives at length: `HOST` and `ADMINIUM_RUNTIME`
   * decide what this reply CLAIMS, and a value sampled off `process.env` inside
   * a handler reads as a plausible default instead of failing the boot.
   */
  env: Env;
  /** Test seam for the session-window arithmetic. */
  now?: (() => number) | undefined;
}

export function desktopLanRoutes(deps: DesktopLanRoutesDeps): FastifyPluginAsyncZod {
  return async (app) => {
    app.get(
      '/desktop/lan-share',
      {
        // Gate 3. `rbac.require` carries `requireAuth` semantics: an anonymous
        // request has no principal to resolve and is refused before the handler.
        preHandler: [app.requireMeta, app.rbac.require(PERMISSIONS.settingsManage)],
        schema: { response: { 200: desktopLanShareReply } },
      },
      async (request): Promise<DesktopLanShareReply> => {
        // Gate 2, before any work: a LAN peer learns nothing here, not even
        // whether the question was expensive to answer.
        if (!isLoopbackPeer(request.raw.socket)) {
          throw new AppError(
            403,
            'FORBIDDEN',
            'The network-sharing panel is only available on the computer Adminium is running on.',
          );
        }

        // `deps.now?.()` — an absent clock passes `undefined`, which takes the
        // parameter's `Date.now()` default rather than pinning time to the boot.
        const status = await readLanShareStatus(deps.env, deps.meta, deps.now?.());

        return {
          data: {
            active: status.active,
            host: deps.env.HOST,
            lanSessions: status.lanSessions,
            otherUsers: status.otherUsers,
          },
        };
      },
    );
  };
}
