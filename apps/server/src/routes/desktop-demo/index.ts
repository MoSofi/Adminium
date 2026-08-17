// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `POST /api/v1/desktop/demo-database` — 11-electron.md §6 step 2 card 4
 * ("Explore the demo database"), task 11-T08.
 *
 * ─── THE DESKTOP GATE ────────────────────────────────────────────────────────
 *
 * Same shape as §5's `auth/desktop-session.ts`, and for the same reason:
 * EXISTENCE is the gate. `compose.ts` registers this factory only when
 * `ADMINIUM_RUNTIME=desktop` AND `ADMINIUM_DEMO_SEED_SCRIPT` names a script, so
 * a self-host or Docker instance does not have the route at all — it 404s there,
 * which no runtime check inside a handler could improve on. Both halves of the
 * AND are load-bearing, exactly as they are for the boot-token route: a desktop
 * boot with no seed script has nothing to run, so the route would be an
 * unreachable surface, and the wizard hides the card instead.
 *
 * Where this route deliberately DIFFERS from the §5 route: no loopback check.
 * §2.4 makes loopback unconditional for the boot-token exchange because that
 * route mints a super-admin session with no password — it is a credential door,
 * and §8.3 puts a LAN on the other side of it. This one creates a database and
 * registers a connection: the same act `POST /connections` performs, from the
 * same authenticated principal, under the same grant. An admin who may connect a
 * production Postgres over the LAN may certainly seed a demo SQLite file, and
 * refusing them would be security theatre — the authorization that matters is
 * `system:connections:manage`, which is what guards it.
 */

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import type { ConnectionManager } from '../../connections/manager.js';
import { maskDsn } from '../../connections/dsn.js';
import { CONNECTIONS_MANAGE } from '../connections/index.js';
import { createDemoDatabaseHandler, demoDsn, type DemoSeeder } from './handlers.js';
import { desktopDemoBody, desktopDemoReply, type DesktopDemoReply } from './schema.js';

export interface DesktopDemoRoutesDeps {
  manager: ConnectionManager;
  /** `ADMINIUM_DATA_DIR`. */
  dataDir: string;
  /** Absolute path to `apps/desktop/resources/demo/demo-seed.mjs`. */
  seedScriptPath: string;
  /** Test seam — see `handlers.ts`. */
  loadSeeder?: ((scriptPath: string) => Promise<DemoSeeder>) | undefined;
}

export function desktopDemoRoutes(deps: DesktopDemoRoutesDeps): FastifyPluginAsyncZod {
  return async (app) => {
    app.post(
      '/desktop/demo-database',
      {
        // The grant that governs "add a database to this workspace" everywhere
        // else. Reusing it rather than inventing `desktop:demo:create` is the
        // point: the demo IS a connection, and an operator who has revoked
        // connection management has already answered this question.
        preHandler: app.rbac.require(CONNECTIONS_MANAGE),
        schema: { body: desktopDemoBody, response: { 201: desktopDemoReply } },
      },
      async (request, reply): Promise<DesktopDemoReply> => {
        const actorId =
          request.apiKeyPrincipal === null
            ? ((request as unknown as { user?: { id?: string } }).user?.id ?? null)
            : null;

        const result = await createDemoDatabaseHandler(
          {
            manager: deps.manager,
            dataDir: deps.dataDir,
            seedScriptPath: deps.seedScriptPath,
            ...(deps.loadSeeder === undefined ? {} : { loadSeeder: deps.loadSeeder }),
          },
          { name: request.body.name, actorId },
        );

        // `connection.create`, not a bespoke `demo.create`: the audit reader's
        // question is "where did this connection come from?", and the answer
        // belongs in the same action every other connection writes. The demo-ness
        // rides in `changes` — the same way §5's route records that a login used
        // a boot token rather than inventing a second kind of login.
        await app.rbac.audit(request, {
          category: 'connection',
          action: 'connection.create',
          connectionId: result.connectionId,
          changes: {
            after: {
              name: result.name,
              engine: 'sqlite',
              dsnMasked: maskDsn(demoDsn(result.file)),
              source: 'desktop-demo',
              seeded: result.seeded,
            },
          },
        });

        reply.status(201);
        return { data: result };
      },
    );
  };
}
