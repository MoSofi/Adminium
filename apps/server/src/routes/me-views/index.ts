/**
 * Per-user dashboard layout override routes (04-widget-registry.md §6.3):
 *
 *   PUT    /api/v1/me/views/:pageId/layout  → save the caller's own layout
 *   DELETE /api/v1/me/views/:pageId/layout  → reset (remove the override)
 *
 * These write a private `adminium_views` row (`{ user_id, page_id,
 * kind: 'layout', config }`). Unlike the shared-default PATCH on the pages
 * route, an override needs no page-EDIT grant: any user who can view the page
 * may rearrange it for themselves, so the guard is a live session plus page
 * visibility (existing + enabled). Overrides are personal and reversible, so
 * they are not audited — only shared-default writes are (see routes/pages).
 *
 * Resolution order (per-user override wins over the shared default) lives in
 * the GET pages read path; "Reset layout" in the page kebab calls DELETE here.
 */

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyRequest } from 'fastify';
import { pagesRepo, viewsRepo, type MetaDb } from '@adminium/meta';

import { NotFoundError, UnauthorizedError } from '../../errors.js';
import { meLayoutOkReply, meLayoutParams, meLayoutPutBody, meLayoutReply } from './schema.js';

export interface MeViewsRoutesDeps {
  meta: MetaDb;
}

/** The acting session user id; API-key/keyless principals have no personal views. */
function sessionUserId(request: FastifyRequest): string | null {
  if (request.apiKeyPrincipal !== null && request.apiKeyPrincipal !== undefined) return null;
  return (request as unknown as { user?: { id?: string } }).user?.id ?? null;
}

export function meViewsRoutes(deps: MeViewsRoutesDeps): FastifyPluginAsyncZod {
  const views = viewsRepo(deps.meta);
  const pages = pagesRepo(deps.meta);

  return async (app) => {
    /** The acting session user, or 401 for keyless/API-key principals. */
    function requireUserId(request: FastifyRequest): string {
      const userId = sessionUserId(request);
      if (userId === null) {
        throw new UnauthorizedError('UNAUTHENTICATED', 'A layout override requires a user session.');
      }
      return userId;
    }

    /** The page must exist and be enabled to hold an override (matches GET). */
    async function requireVisiblePage(pageId: string): Promise<void> {
      const page = await pages.findById(pageId);
      if (page === null || !page.isEnabled) {
        throw new NotFoundError(`page ${pageId} does not exist`);
      }
    }

    app.put(
      '/me/views/:pageId/layout',
      {
        preHandler: app.requireAuth,
        schema: { params: meLayoutParams, body: meLayoutPutBody, response: { 200: meLayoutReply } },
      },
      async (request) => {
        const userId = requireUserId(request);
        const { pageId } = request.params;
        await requireVisiblePage(pageId);
        await views.upsertLayoutOverride(pageId, userId, request.body);
        return { data: { layout: request.body } };
      },
    );

    app.delete(
      '/me/views/:pageId/layout',
      {
        preHandler: app.requireAuth,
        schema: { params: meLayoutParams, response: { 200: meLayoutOkReply } },
      },
      async (request) => {
        const userId = requireUserId(request);
        const { pageId } = request.params;
        await requireVisiblePage(pageId);
        await views.deleteLayoutOverride(pageId, userId);
        return { data: { ok: true as const } };
      },
    );
  };
}
