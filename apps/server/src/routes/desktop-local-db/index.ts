/**
 * `POST /api/v1/desktop/local-database` — 11-electron.md §6 step 2 card 1
 * ("Create a new local database"), task 11-T07.
 *
 * ─── THE DESKTOP GATE ────────────────────────────────────────────────────────
 *
 * EXISTENCE is the gate, exactly as it is for `desktop-demo` and §5's
 * `auth/desktop-session.ts`: `compose.ts` registers this factory only when
 * `ADMINIUM_RUNTIME=desktop`, so self-host and Docker do not have the route at
 * all. That is not a formality here — the route's whole subject is
 * `<dataDir>/databases/`, a directory that exists because the shell created it
 * and passed `ADMINIUM_DATA_DIR` (§2.2). On a Docker deployment `<dataDir>` is a
 * container path nobody can reach with a file dialog, so a "create a local
 * database" button there would create a file the user can neither find, back up,
 * nor delete.
 *
 * No loopback check, for `desktop-demo`'s reason: this creates a database and
 * registers a connection — the same act `POST /connections` performs, from the
 * same principal, under the same `system:connections:manage` grant. The §5 route
 * is loopback-only because it mints a session with no password; this one does
 * not.
 */

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import type { ConnectionManager } from '../../connections/manager.js';
import { maskDsn } from '../../connections/dsn.js';
import { CONNECTIONS_MANAGE } from '../connections/index.js';
import { parseSchemaFileContent } from '../schema-import/index.js';
import { createLocalDatabaseHandler, localDsn, type LocalDatabaseDeps } from './handlers.js';
import { desktopLocalDbBody, desktopLocalDbReply, type DesktopLocalDbReply } from './schema.js';

export interface DesktopLocalDbRoutesDeps {
  manager: ConnectionManager;
  /** `ADMINIUM_DATA_DIR`. */
  dataDir: string;
  /**
   * Test seams. Production omits both: the parser defaults to the one
   * `POST /schema-import/parse` uses (so the eight formats cannot behave
   * differently on the two paths), and the clock to `Date`.
   */
  parseSchema?: LocalDatabaseDeps['parseSchema'] | undefined;
  now?: (() => Date) | undefined;
}

export function desktopLocalDbRoutes(deps: DesktopLocalDbRoutesDeps): FastifyPluginAsyncZod {
  return async (app) => {
    app.post(
      '/desktop/local-database',
      {
        preHandler: app.rbac.require(CONNECTIONS_MANAGE),
        schema: { body: desktopLocalDbBody, response: { 201: desktopLocalDbReply } },
      },
      async (request, reply): Promise<DesktopLocalDbReply> => {
        const actorId =
          request.apiKeyPrincipal === null
            ? ((request as unknown as { user?: { id?: string } }).user?.id ?? null)
            : null;

        const body = request.body;
        const result = await createLocalDatabaseHandler(
          {
            manager: deps.manager,
            dataDir: deps.dataDir,
            parseSchema: deps.parseSchema ?? parseSchemaFileContent,
            ...(deps.now === undefined ? {} : { now: deps.now }),
          },
          {
            name: body.name,
            schemaFile:
              body.schemaFile === undefined
                ? undefined
                : {
                    content: body.schemaFile.content,
                    format: body.schemaFile.format,
                    fileName: body.schemaFile.fileName,
                  },
            placeholderRows: body.placeholderRows,
            actorId,
          },
        );

        // `connection.create`, for `desktop-demo`'s reason: the audit reader asks
        // "where did this connection come from?", and the answer belongs in the
        // action every other connection writes. The creation details ride in
        // `changes`.
        //
        // `placeholderRows` is recorded because it is the one part of this
        // request that WRITES ROWS. An operator looking at a table of sample data
        // six months from now needs the audit log to say the app put it there.
        await app.rbac.audit(request, {
          category: 'connection',
          action: 'connection.create',
          connectionId: result.connectionId,
          changes: {
            after: {
              name: result.name,
              engine: 'sqlite',
              dsnMasked: maskDsn(localDsn(result.file)),
              source: 'desktop-local-database',
              tables: result.tables.length,
              placeholderRows: body.placeholderRows,
            },
          },
        });

        reply.status(201);
        return { data: result };
      },
    );
  };
}
