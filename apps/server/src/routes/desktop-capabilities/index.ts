// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The desktop capability grant table over REST (11-electron.md §12, §1 principle 2).
 *
 * `GET` / `POST` / `DELETE /api/v1/desktop/capability-grants` — the server half of
 * the capability pipeline (manifest → consent → grant → IPC → provider). The
 * grant lives in `adminium_settings`, which is the server's to touch, so both the
 * dashboard consent/revoke UI and the main-process `CapabilityHost` reach it
 * here rather than opening the meta store from the renderer or main.
 *
 * ─── The gates, mirroring `routes/desktop/index.ts` (§9's backup) ────────────
 *
 *  1. EXISTENCE. `compose.ts` registers this factory only when
 *     `ADMINIUM_RUNTIME=desktop`. Off-desktop there is no capability host to
 *     grant to, so an absent route is the honest answer — self-host and Cloud
 *     report every capability `unavailable` (§12), which is the SPA's job, not a
 *     grant table's.
 *  2. PEER. The SOCKET peer must be loopback. §8.3 binds `0.0.0.0` when LAN share
 *     is on, and a capability grant authorizes reaching THIS machine's hardware —
 *     a decision that belongs to the person sitting at it, never to a LAN peer,
 *     however privileged their account.
 *  3. SESSION + RBAC. All three verbs require `system:settings:manage` — the same
 *     grant §9 puts on the backup route, and for the same reading: which apps may
 *     reach this machine's hardware is administrative state, whether you are
 *     reading it or changing it. The host reads grants on every invoke carrying
 *     the WINDOW'S session cookie (§4), which in single-user desktop — the default
 *     — is the super admin's, so the gate is transparent there.
 *
 *     A future non-admin POS operator (13-marketplace.md §10) invoking a consented
 *     capability would need `GET` relaxed to plain authentication so the host can
 *     read grants AS them; that is a deliberate v1 deferral, not an oversight —
 *     the invoke path is loopback-only (§4), so only the local operator is ever
 *     affected, and v1 ships a stub provider nobody prints through yet.
 */
import type { Socket } from 'node:net';

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { MetaDb } from '@adminium/meta';

import { isLoopbackPeer } from '../../auth/desktop-session.js';
import { addGrant, listGrants, removeGrant } from '../../capabilities/grants.js';
import { AppError } from '../../errors.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import {
  capabilityGrantRefBody,
  capabilityGrantReply,
  capabilityGrantsListReply,
  capabilityRevokeReply,
  type CapabilityGrantReply,
  type CapabilityGrantsListReply,
  type CapabilityRevokeReply,
} from './schema.js';

export interface DesktopCapabilityRoutesDeps {
  meta: MetaDb;
  /** Injectable clock for a deterministic `grantedAt` in tests. */
  now?: (() => number) | undefined;
}

/** Gate 2. A non-loopback caller learns nothing about this machine's grants. */
function assertLoopback(socket: Socket): void {
  if (!isLoopbackPeer(socket)) {
    throw new AppError(
      403,
      'FORBIDDEN',
      'Capability access can only be changed from the computer Adminium is running on.',
    );
  }
}

export function desktopCapabilityRoutes(
  deps: DesktopCapabilityRoutesDeps,
): FastifyPluginAsyncZod {
  return async (app) => {
    app.get(
      '/desktop/capability-grants',
      {
        preHandler: [app.requireMeta, app.rbac.require(PERMISSIONS.settingsManage)],
        schema: { response: { 200: capabilityGrantsListReply } },
      },
      async (request): Promise<CapabilityGrantsListReply> => {
        assertLoopback(request.raw.socket);
        return { data: { grants: await listGrants(deps.meta) } };
      },
    );

    app.post(
      '/desktop/capability-grants',
      {
        preHandler: [app.requireMeta, app.rbac.require(PERMISSIONS.settingsManage)],
        schema: { body: capabilityGrantRefBody, response: { 200: capabilityGrantReply } },
      },
      async (request): Promise<CapabilityGrantReply> => {
        assertLoopback(request.raw.socket);
        const { manifestId, capabilityId } = request.body;
        const grant = await addGrant(
          deps.meta,
          { manifestId, capabilityId },
          {
            ...(deps.now === undefined ? {} : { now: deps.now() }),
            updatedBy: request.user?.id ?? null,
          },
        );
        // A grant is a `settings`-category act, gated on `settings:manage`, so it
        // is audited like one: who consented which app to which capability, from
        // where. The grant IS the change — there is nothing else to record.
        await app.rbac.audit(request, {
          action: 'desktop_capability_granted',
          category: 'settings',
          changes: { after: { manifestId, capabilityId } },
        });
        return { data: { grant } };
      },
    );

    app.delete(
      '/desktop/capability-grants',
      {
        preHandler: [app.requireMeta, app.rbac.require(PERMISSIONS.settingsManage)],
        schema: { body: capabilityGrantRefBody, response: { 200: capabilityRevokeReply } },
      },
      async (request): Promise<CapabilityRevokeReply> => {
        assertLoopback(request.raw.socket);
        const { manifestId, capabilityId } = request.body;
        const removed = await removeGrant(
          deps.meta,
          { manifestId, capabilityId },
          { updatedBy: request.user?.id ?? null },
        );
        // Only audit a real revocation. A no-op DELETE (nothing was granted) is
        // not an event; auditing it would fill the log with the consequences of
        // a double-click.
        if (removed) {
          await app.rbac.audit(request, {
            action: 'desktop_capability_revoked',
            category: 'settings',
            changes: { before: { manifestId, capabilityId } },
          });
        }
        return { data: { removed } };
      },
    );
  };
}
