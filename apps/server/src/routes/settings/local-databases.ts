// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `GET` / `PUT /api/v1/settings/local-databases` — "Allow databases on this
 * server" (`connections/local-databases.ts`).
 *
 * A Super Admin's, both ways: reading it names the operator's database hosts,
 * and switching it lets every signed-in person with `connections.manage` point
 * a source at any port on this server's own loopback. So holding
 * `settings.manage` is not enough, and switching it ON asks for the caller's
 * password again, as the live Designer's switch does (`routes/designer/live.ts`):
 * a session left open on a shared machine must not be enough.
 *
 * Every change is audited (`connections.allowLocalDatabases.on` / `.off`), and
 * so is every refusal (`.refused`, with the reason): a wrong password is
 * someone trying a session that is not theirs, and a refusal by the operator is
 * someone trying a door the operator closed.
 */
import { auditRepo, usersRepo, type MetaDb } from '@adminium/meta';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

import { auditExempt } from '../../audit/coverage.js';
import { verifyPassword } from '../../auth/passwords.js';
import type { LocalDatabases } from '../../connections/local-databases.js';
import { AppError, ConflictError } from '../../errors.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import { RATE_LIMIT_BUCKETS } from '../auth/index.js';

export const localDatabasesReply = z.object({
  allowed: z.boolean(),
  on: z.boolean(),
  reason: z.enum(['not-allowed']).nullable(),
  hosts: z.array(z.string()),
  turnedOn: z.object({ by: z.string(), at: z.number() }).nullable(),
  loopbackAllowed: z.boolean(),
});
const localDatabasesBody = z.object({ on: z.boolean(), password: z.string().max(1000).optional() });

const AUDIT = 'connections.allowLocalDatabases';

export interface LocalDatabasesRoutesDeps {
  meta: MetaDb;
  localDatabases: LocalDatabases;
}

export function localDatabasesRoutes(deps: LocalDatabasesRoutesDeps): FastifyPluginAsyncZod {
  return async (app) => {
    const guard = app.rbac.require(PERMISSIONS.settingsManage);
    const superAdminOnly = async (request: FastifyRequest): Promise<void> => {
      if (!(await app.rbac.resolve(request)).superAdmin) {
        throw new AppError(403, 'FORBIDDEN', 'Only a Super Admin allows databases on this server.', { reason: 'SUPER_ADMIN' });
      }
    };

    app.get(
      '/settings/local-databases',
      { preHandler: guard, schema: { response: { 200: localDatabasesReply } } },
      async (request) => {
        await superAdminOnly(request);
        return deps.localDatabases.state();
      },
    );

    app.put(
      '/settings/local-databases',
      {
        preHandler: guard,
        // The password is tried here, so a guess costs what a sign-in costs.
        config: { rateLimitBucket: RATE_LIMIT_BUCKETS.login, audit: auditExempt('the switch is audited here, with who switched it, which way, and every refusal') },
        schema: { body: localDatabasesBody, response: { 200: localDatabasesReply } },
      },
      async (request) => {
        await superAdminOnly(request);
        const user = request.user;
        if (user === null) throw new AppError(401, 'UNAUTHENTICATED', 'Sign in first.');
        const audit = (action: 'on' | 'off' | 'refused', after: Record<string, unknown>) =>
          auditRepo(deps.meta).append({
            actorKind: 'user',
            actorId: user.id,
            actorLabel: user.email,
            category: 'settings',
            action: `${AUDIT}.${action}`,
            changes: { after },
          });
        if (request.body.on) {
          // The operator's word first: no password is asked for a switch that cannot move.
          if (!(await deps.localDatabases.state()).allowed) {
            await audit('refused', { reason: 'not-allowed' });
            throw new ConflictError(
              'The server’s operator has locked this off (ADMINIUM_LOCAL_DATABASES=off): only the hosts in ADMINIUM_DATABASE_HOSTS are allowed.',
              'CONFLICT',
              { reason: 'not-allowed' },
            );
          }
          const stored = await usersRepo(deps.meta).findById(user.id);
          const given = request.body.password ?? '';
          if (stored === null || stored.passwordHash === null || given === '' || !(await verifyPassword(stored.passwordHash, given))) {
            await audit('refused', { reason: 'password' });
            throw new AppError(403, 'FORBIDDEN', 'That is not your password.', { reason: 'PASSWORD' });
          }
        }
        const refused = await deps.localDatabases.set(request.body.on, user.id);
        if (refused !== null) {
          await audit('refused', { reason: refused });
          throw new ConflictError('The server’s operator has locked this off.', 'CONFLICT', { reason: refused });
        }
        await audit(request.body.on ? 'on' : 'off', { on: request.body.on });
        return deps.localDatabases.state();
      },
    );
  };
}
