// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Saved-views routes (M5-T06, 07-meta-store.md §3.18, 08-server-api.md):
 *
 *   GET    /api/v1/pages/:pageId/views            → list (own + shared)
 *   POST   /api/v1/pages/:pageId/views            → create a personal view
 *   PATCH  /api/v1/pages/:pageId/views/:viewId    → rename / re-save / default
 *   DELETE /api/v1/pages/:pageId/views/:viewId    → delete (client confirms)
 *
 * Auth: a live session (`requireAuth`). Ownership: a user sees and mutates
 * only their own views plus shared (`user_id = NULL`) workspace views; a
 * shared view can only be changed by a settings admin
 * (`system:settings:manage`). Someone else's private view is invisible (404).
 * Every mutation is audited (category `data`), matching the sibling resources.
 */

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyRequest } from 'fastify';
import { pagesRepo, viewsRepo, type MetaDb, type SavedView } from '@adminium/meta';

import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError } from '../../errors.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import {
  viewCreateBody,
  viewIdParams,
  viewListReply,
  viewOkReply,
  viewPageParams,
  viewPatchBody,
  viewReply,
  type ViewView,
} from './schema.js';

export interface ViewsRoutesDeps {
  meta: MetaDb;
}

function sessionUserId(request: FastifyRequest): string | null {
  if (request.apiKeyPrincipal !== null) return null;
  return (request as unknown as { user?: { id?: string } }).user?.id ?? null;
}

function toView(view: SavedView): ViewView {
  return {
    id: view.id,
    pageId: view.pageId,
    userId: view.userId,
    name: view.name,
    config: view.config,
    isDefault: view.isDefault,
    createdAt: view.createdAt,
    updatedAt: view.updatedAt,
  };
}

export function viewsRoutes(deps: ViewsRoutesDeps): FastifyPluginAsyncZod {
  const { meta } = deps;
  const views = viewsRepo(meta);
  const pages = pagesRepo(meta);

  return async (app) => {
    /** The acting session user, or 401 for keyless/API-key principals. */
    function requireUserId(request: FastifyRequest): string {
      const userId = sessionUserId(request);
      if (userId === null) {
        throw new UnauthorizedError('UNAUTHENTICATED', 'Saved views require a user session.');
      }
      return userId;
    }

    /** Load a view scoped to (pageId, caller-visible); 404 otherwise. */
    async function loadVisible(pageId: string, viewId: string, userId: string): Promise<SavedView> {
      const view = await views.findById(viewId);
      if (view === null || view.pageId !== pageId || (view.userId !== null && view.userId !== userId)) {
        throw new NotFoundError(`view ${viewId} does not exist`);
      }
      return view;
    }

    /** Owner may mutate their own view; a shared view needs settings:manage. */
    async function assertCanMutate(request: FastifyRequest, view: SavedView, userId: string): Promise<void> {
      if (view.userId === userId) return;
      if (view.userId === null && (await request.can(PERMISSIONS.settingsManage))) return;
      throw new ForbiddenError('You cannot modify this view.', 'FORBIDDEN', { viewId: view.id });
    }

    app.get(
      '/pages/:pageId/views',
      {
        preHandler: app.requireAuth,
        schema: { params: viewPageParams, response: { 200: viewListReply } },
      },
      async (request) => {
        const userId = sessionUserId(request);
        if (userId === null) return { data: { views: [] } };
        const list = await views.listForPageUser(request.params.pageId, userId);
        return { data: { views: list.map(toView) } };
      },
    );

    app.post(
      '/pages/:pageId/views',
      {
        preHandler: app.requireAuth,
        schema: { params: viewPageParams, body: viewCreateBody, response: { 201: viewReply } },
      },
      async (request, reply) => {
        const userId = requireUserId(request);
        const { pageId } = request.params;
        const page = await pages.findById(pageId);
        if (page === null) throw new NotFoundError(`page ${pageId} does not exist`);

        const clash = await views.findByName(pageId, userId, request.body.name);
        if (clash !== null) {
          throw new ConflictError('A view with that name already exists.', 'UNIQUE_VIOLATION', {
            name: request.body.name,
          });
        }

        const created = await views.create({
          pageId,
          userId,
          name: request.body.name,
          config: request.body.config,
          isDefault: request.body.isDefault ?? false,
        });
        await app.rbac.audit(request, {
          category: 'data',
          action: 'view.create',
          changes: { after: { pageId, name: created.name, isDefault: created.isDefault } },
        });
        return reply.status(201).send({ data: toView(created) });
      },
    );

    app.patch(
      '/pages/:pageId/views/:viewId',
      {
        preHandler: app.requireAuth,
        schema: { params: viewIdParams, body: viewPatchBody, response: { 200: viewReply } },
      },
      async (request) => {
        const userId = requireUserId(request);
        const { pageId, viewId } = request.params;
        const view = await loadVisible(pageId, viewId, userId);
        await assertCanMutate(request, view, userId);

        if (request.body.name !== undefined && request.body.name !== view.name) {
          const clash = await views.findByName(pageId, view.userId, request.body.name);
          if (clash !== null && clash.id !== view.id) {
            throw new ConflictError('A view with that name already exists.', 'UNIQUE_VIOLATION', {
              name: request.body.name,
            });
          }
        }

        const updated = await views.update(viewId, {
          ...(request.body.name !== undefined ? { name: request.body.name } : {}),
          ...(request.body.config !== undefined ? { config: request.body.config } : {}),
          ...(request.body.isDefault !== undefined ? { isDefault: request.body.isDefault } : {}),
        });
        if (updated === null) throw new NotFoundError(`view ${viewId} does not exist`);
        await app.rbac.audit(request, {
          category: 'data',
          action: 'view.update',
          changes: {
            before: { name: view.name, isDefault: view.isDefault },
            after: { name: updated.name, isDefault: updated.isDefault },
          },
        });
        return { data: toView(updated) };
      },
    );

    app.delete(
      '/pages/:pageId/views/:viewId',
      {
        preHandler: app.requireAuth,
        schema: { params: viewIdParams, response: { 200: viewOkReply } },
      },
      async (request) => {
        const userId = requireUserId(request);
        const { pageId, viewId } = request.params;
        const view = await loadVisible(pageId, viewId, userId);
        await assertCanMutate(request, view, userId);
        await views.delete(viewId);
        await app.rbac.audit(request, {
          category: 'data',
          action: 'view.delete',
          changes: { before: { pageId, name: view.name } },
        });
        return { data: { ok: true as const } };
      },
    );
  };
}
