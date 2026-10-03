// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `GET` / `PUT /api/v1/designer/live` — the live Designer's switch.
 *
 * Always registered, so the Settings card has one thing to ask on every
 * server: a `design` server answers "local", and a server whose operator has
 * not allowed the Designer answers "not allowed". The Designer's own routes
 * are another plugin, registered only where it can run.
 *
 * Switching it ON asks for the caller's password again: it turns a session
 * into the ability to have a model write code on this server, and a session
 * left open on a shared machine must not be enough.
 */
import { auditRepo, usersRepo, type MetaDb } from '@adminium/meta';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { auditExempt } from '../../audit/coverage.js';
import { verifyPassword } from '../../auth/passwords.js';
import type { Live, LiveReason } from '../../designer/live.js';
import { AppError, ConflictError } from '../../errors.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import { RATE_LIMIT_BUCKETS } from '../auth/index.js';

const liveReply = z.object({
  mode: z.enum(['local', 'live']),
  allowed: z.boolean(),
  on: z.boolean(),
  project: z.boolean(),
  reason: z.enum(['not-allowed', 'no-project', 'disk-not-kept', 'no-bundler', 'not-writable']).nullable(),
});
const liveBody = z.object({ on: z.boolean(), password: z.string().max(1000).optional() });

const WHY: Record<LiveReason, string> = {
  'not-allowed': 'The server’s operator has not allowed Adminium Designer here (ADMINIUM_DESIGNER=live).',
  'no-project': 'Adminium Designer builds apps into a project folder, and this server runs without one.',
  'disk-not-kept': 'The project folder is not on a disk that is kept across restarts.',
  'no-bundler': 'The project has no esbuild, which the Designer builds screens with. Install it: npm install --save-dev esbuild',
  'not-writable': 'The project folder cannot be written to.',
};

export interface DesignerLiveRoutesDeps {
  meta: MetaDb;
  /** Null on a `design` server, which is local and has no switch. */
  live: Live | null;
  /** Stop the turn that is running, if one is: switching off ends what the Designer is doing. */
  stopRunning?: () => void;
}

export function designerLiveRoutes(deps: DesignerLiveRoutesDeps): FastifyPluginAsyncZod {
  return async (app) => {
    const guard = app.rbac.require(PERMISSIONS.designerUse);
    const local = { mode: 'local' as const, allowed: true, on: true, project: true, reason: null };

    app.get('/designer/live', { preHandler: guard, config: { rateLimitBucket: 'designer' }, schema: { response: { 200: liveReply } } }, async () =>
      deps.live === null ? local : deps.live.state(),
    );

    app.put(
      '/designer/live',
      {
        preHandler: guard,
        config: { rateLimitBucket: RATE_LIMIT_BUCKETS.login, audit: auditExempt('the switch is audited here, with who switched it and which way') },
        schema: { body: liveBody, response: { 200: liveReply } },
      },
      async (request) => {
        if (deps.live === null) throw new ConflictError('This is `adminium design`: the Designer is running on this machine and has no switch.', 'CONFLICT', { reason: 'LOCAL' });
        const user = request.user;
        if (user === null) throw new AppError(401, 'UNAUTHENTICATED', 'Sign in first.');
        if (request.body.on) {
          // The second of three hands: holding the permission to use the Designer is not enough to switch it on.
          if (!(await app.rbac.resolve(request)).superAdmin) {
            throw new AppError(403, 'FORBIDDEN', 'Only a Super Admin switches Adminium Designer on.', { reason: 'SUPER_ADMIN' });
          }
          const stored = await usersRepo(deps.meta).findById(user.id);
          const given = request.body.password ?? '';
          if (stored === null || stored.passwordHash === null || given === '' || !(await verifyPassword(stored.passwordHash, given))) {
            // A wrong password here is someone trying a session that is not theirs: it is kept.
            await auditRepo(deps.meta).append({
              actorKind: 'user',
              actorId: user.id,
              actorLabel: user.email,
              category: 'settings',
              action: 'designer.live.refused',
              changes: { after: { reason: 'password' } },
            });
            throw new AppError(403, 'FORBIDDEN', 'That is not your password.', { reason: 'PASSWORD' });
          }
        }
        const refused = await deps.live.set(request.body.on);
        if (refused !== null) throw new ConflictError(WHY[refused], 'CONFLICT', { reason: refused });
        // Off is off now: a turn left running could no longer be stopped by anyone.
        if (!request.body.on) deps.stopRunning?.();
        await auditRepo(deps.meta).append({
          actorKind: 'user',
          actorId: user.id,
          actorLabel: user.email,
          category: 'settings',
          action: request.body.on ? 'designer.live.on' : 'designer.live.off',
          changes: { after: { on: request.body.on } },
        });
        return deps.live.state();
      },
    );
  };
}
