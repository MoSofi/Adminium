// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Meta-placement resource: `GET /api/v1/meta/placement`,
 * `POST /api/v1/meta/relocate` (01-architecture.md §3.1, §7.2).
 *
 * ── WHAT THIS FIXES ─────────────────────────────────────────────────────────
 * The Studio connect wizard has always had a meta step, and it has never done
 * anything: it validated that same-database placement was POSSIBLE and then
 * dropped the answer on the floor, because by the time the Studio is on screen
 * a meta store already exists and nothing could move it. The terminal wizard
 * has no such problem — it asks at step 0, before the store is opened — so the
 * two front doors gave different answers to the same question, and the browser
 * one was silently wrong. This is the half that was missing.
 *
 * ── REGISTERED ONLY WHERE A RESTART IS POSSIBLE ─────────────────────────────
 * `compose` registers this plugin only when it is given an `onMetaRelocated`
 * host (`cli/relocation-host.ts` supplies one; embedded topologies and tests
 * do not). Relocation ends in a process that must rebuild its service graph
 * against a different database, and an instance with no way to do that must not
 * expose a button that copies the store, repoints the setup file, and then
 * keeps serving the old one. No host ⇒ no route, rather than a route that
 * half-works.
 *
 * ── WHY THE REPLY GOES OUT BEFORE THE RESTART ───────────────────────────────
 * The restart closes the very connection this response travels on. Firing the
 * host from `reply.raw`'s `finish` event means the client always receives the
 * "restarting, poll healthz" payload BEFORE its socket is torn down — without
 * it the browser sees a connection reset and cannot tell a successful
 * relocation from a crashed one, which are the two cases it most needs to
 * distinguish.
 *
 * ── WHY THE AUDIT ROW IS WRITTEN BEFORE THE MOVE, NOT AFTER ─────────────────
 * Moving the entire meta store is one of the most consequential things an
 * operator can do here, and it used to write no audit row at all. The row
 * cannot be appended AFTER the relocation, though: `app.rbac.audit` writes
 * through the handle this server booted with — the SOURCE store — and by then
 * `copyMetaStore` has already finished, so an "it moved" row would be appended
 * to the database nobody will ever open again. Written first, it is inside the
 * copy, and therefore inside the destination.
 *
 * That ordering also means the row records the ATTEMPT. It survives in exactly
 * the right place either way: on failure the source store is still the live one
 * and keeps it; on success the destination store's audit log opens with the
 * entry explaining how that store came to hold this instance's data — which,
 * being present there at all, is itself the evidence the move completed.
 *
 * The row deliberately carries no DSN. The target's credentials are in it, and
 * `adminium_audit_log` is readable by anyone with `system:audit:read`.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { audited } from '../../audit/coverage.js';
import type { Env } from '../../config/env.js';
import { AppError } from '../../errors.js';
import {
  MetaAlreadyThereError,
  MetaRelocateError,
  MetaStoreNotEmptyError,
  MetaTargetNotWritableError,
  MetaUrlPinnedError,
  relocateMetaStore,
  type OnMetaRelocated,
} from '../../meta/relocate.js';
import {
  metaEngineFromUrl,
  MetaUrlError,
  type MetaEngine,
  type MetaStoreHandle,
} from '../../meta/store.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import {
  metaPlacementReply,
  metaRelocateBody,
  metaRelocateReply,
  type MetaPlacementReply,
  type MetaRelocateReply,
} from './schema.js';

/** Where the client waits for the server to come back. */
export const HEALTH_PATH = '/api/v1/healthz';

export interface MetaRoutesDeps {
  metaStore: MetaStoreHandle;
  env: Env;
  /** The host that rebuilds the server. Its presence is what enables the route. */
  onMetaRelocated: OnMetaRelocated;
}

/**
 * Translate the service's refusals into the API's vocabulary.
 *
 * `META_PLACEMENT_INVALID` is deliberately reused for an unwritable target: it
 * is the code `connections/manager.ts` already throws for the same underlying
 * condition (a role that cannot host the meta store), and the Studio already
 * renders it.
 */
function asAppError(error: unknown): AppError {
  if (error instanceof MetaUrlError) {
    return new AppError(400, 'META_DSN_INVALID', error.message);
  }
  if (error instanceof MetaTargetNotWritableError) {
    return new AppError(422, 'META_PLACEMENT_INVALID', error.message);
  }
  if (error instanceof MetaStoreNotEmptyError) {
    return new AppError(409, 'META_TARGET_NOT_EMPTY', error.message);
  }
  if (error instanceof MetaAlreadyThereError) {
    return new AppError(409, 'META_ALREADY_THERE', error.message);
  }
  if (error instanceof MetaUrlPinnedError) {
    return new AppError(409, 'META_URL_PINNED', error.message);
  }
  if (error instanceof MetaRelocateError) {
    return new AppError(400, 'META_RELOCATE_FAILED', error.message);
  }
  throw error;
}

/**
 * The engine a submitted DSN names, or `null` when it names none.
 *
 * Non-throwing on purpose: the audit row is written before the relocation
 * validates anything, and a malformed DSN must still leave a trace of who
 * submitted it rather than replacing the 400 with a 500 from the audit path.
 */
function engineOf(dsn: string): MetaEngine | null {
  try {
    return metaEngineFromUrl(dsn);
  } catch {
    return null;
  }
}

export function metaRoutes(deps: MetaRoutesDeps): FastifyPluginAsyncZod {
  const { metaStore, env, onMetaRelocated } = deps;
  const pinned = env.ADMINIUM_META_URL !== undefined && env.ADMINIUM_META_URL !== '';

  return async (app) => {
    app.get(
      '/meta/placement',
      {
        preHandler: app.rbac.require(PERMISSIONS.settingsManage),
        schema: { response: { 200: metaPlacementReply } },
      },
      async (): Promise<MetaPlacementReply> => ({
        data: {
          source: metaStore.source,
          engine: metaStore.engine,
          embedded: metaStore.source === 'embedded',
          canRelocate: !pinned,
          reason: pinned
            ? 'ADMINIUM_META_URL pins this instance’s meta store; a move would not survive a restart.'
            : null,
        },
      }),
    );

    app.post(
      '/meta/relocate',
      {
        preHandler: app.rbac.require(PERMISSIONS.settingsManage),
        config: { audit: audited('rbac') },
        schema: { body: metaRelocateBody, response: { 200: metaRelocateReply } },
      },
      async (request, reply): Promise<MetaRelocateReply> => {
        // Before the copy — see the module header. `after` names only the
        // engine the DSN asks for; the DSN itself never enters the trail.
        await app.rbac.audit(request, {
          category: 'system',
          action: 'meta.relocate',
          changes: {
            before: { engine: metaStore.engine, source: metaStore.source },
            after: { engine: engineOf(request.body.dsn) },
          },
        });

        let result;
        try {
          result = await relocateMetaStore({
            from: metaStore,
            toUrl: request.body.dsn,
            secret: env.ADMINIUM_SECRET,
            dataDir: env.ADMINIUM_DATA_DIR,
            envMetaUrl: env.ADMINIUM_META_URL,
          });
        } catch (error) {
          throw asAppError(error);
        }

        // Past this line the relocation has COMMITTED — the bootstrap file now
        // names the new store — so the restart must happen even if something
        // below were to go wrong. It is armed before the reply is returned and
        // fires on `finish`, i.e. once the payload is on the wire.
        request.log.info(
          { engine: result.engine, rows: result.totalRows },
          'meta store relocated; restarting',
        );
        reply.raw.once('finish', () => {
          onMetaRelocated({
            url: result.url,
            engine: result.engine,
            retiredSqlitePath: result.retiredSqlitePath,
          });
        });

        return {
          data: {
            engine: result.engine,
            rowsCopied: result.totalRows,
            restarting: true,
            healthPath: HEALTH_PATH,
          },
        };
      },
    );
  };
}
