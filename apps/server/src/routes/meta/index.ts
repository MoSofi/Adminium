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
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

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
import { MetaUrlError, type MetaStoreHandle } from '../../meta/store.js';
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
        schema: { body: metaRelocateBody, response: { 200: metaRelocateReply } },
      },
      async (request, reply): Promise<MetaRelocateReply> => {
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
