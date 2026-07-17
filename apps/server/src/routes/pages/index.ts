/**
 * Page-document routes (08-server-api.md §2.6, 04-widget-registry.md §6.3):
 *
 *   GET   /api/v1/pages/:pageId         → { data: <page envelope> }
 *   PATCH /api/v1/pages/:pageId/layout  → write the SHARED default layout
 *
 * The dashboard's PageRenderer fetches the stored envelope by the id it got
 * from the bootstrap nav tree and runs client-side config migrations
 * (09-generated-app.md §2.3/§3). On read the server resolves `config.layout`:
 * a per-user override (an `adminium_views` row, `kind: 'layout'`) wins over the
 * shared `adminium_pages` default; otherwise the envelope is returned verbatim.
 *
 * The PATCH writes the shared default (the layout every viewer sees) and is
 * gated on page-EDIT permission (`page:<pageId>:edit`; super-admins bypass) and
 * audited. Per-user overrides live on the sibling `me/views` route — any user
 * with page-view access may save their own without the edit grant.
 */

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyRequest } from 'fastify';
import { pagesRepo, viewsRepo, type MetaDb } from '@adminium/meta';

import { ForbiddenError, NotFoundError } from '../../errors.js';
import { pageLayoutSchema } from './layout-schema.js';
import { pageLayoutPatchBody, pageLayoutReply, pageParams, pageReply } from './schema.js';

export interface PagesRoutesDeps {
  meta: MetaDb;
}

/** The acting session user id, or null for keyless/API-key principals. */
function sessionUserId(request: FastifyRequest): string | null {
  if (request.apiKeyPrincipal !== null && request.apiKeyPrincipal !== undefined) return null;
  return (request as unknown as { user?: { id?: string } }).user?.id ?? null;
}

export function pagesRoutes(deps: PagesRoutesDeps): FastifyPluginAsyncZod {
  const pages = pagesRepo(deps.meta);
  const views = viewsRepo(deps.meta);

  return async (app) => {
    app.get(
      '/pages/:pageId',
      {
        preHandler: app.requireAuth,
        schema: {
          params: pageParams,
          response: { 200: pageReply },
        },
      },
      async (request) => {
        const page = await pages.findById(request.params.pageId);
        if (page === null || !page.isEnabled) {
          throw new NotFoundError(`page ${request.params.pageId} does not exist`);
        }

        // Per-page edit capability (§6.3): the SAME `page:<id>:edit` grant the
        // PATCH is gated on (super-admins bypass). The dashboard builder uses
        // this — never role slugs — to route edits to the shared default vs. a
        // personal override, so it matches the server exactly. Guarded for the
        // minimal read-only harness that mounts this route without rbacPlugin.
        const canEditLayout =
          typeof request.can === 'function' ? await request.can(`page:${page.id}:edit`) : false;

        // Layout resolution (§6.3): a per-user override wins over the shared
        // default baked into the envelope's `config.layout`. Only applies when
        // the caller is a session user and their override parses as a valid
        // layout document; anything else falls back to the stored default.
        const userId = sessionUserId(request);
        if (userId !== null && typeof page.config === 'object' && page.config !== null) {
          const override = await views.findLayoutOverride(page.id, userId);
          if (override !== null) {
            const parsed = pageLayoutSchema.safeParse(override.config);
            if (parsed.success) {
              const envelope = page.config as Record<string, unknown>;
              const templateConfig =
                typeof envelope['config'] === 'object' && envelope['config'] !== null
                  ? (envelope['config'] as Record<string, unknown>)
                  : {};
              // Staleness signal: the PUT stamped the shared document's
              // revision into the override; the default moving past it —
              // regeneration or a shared PATCH — means this caller keeps a
              // pre-change layout (after a schema-driven regeneration that is
              // per-widget WIDGET_DATA errors with no hint). Flag it so the
              // client can offer "Reset layout". Pre-stamp rows read as fresh.
              const authoredAt = (override.config as Record<string, unknown>)['pageRevision'];
              const layoutStale = typeof authoredAt === 'number' && authoredAt < page.revision;
              return {
                data: { ...envelope, config: { ...templateConfig, layout: parsed.data } },
                canEditLayout,
                ...(layoutStale ? { layoutStale: true } : {}),
              };
            }
          }
        }
        return { data: page.config, canEditLayout };
      },
    );

    app.patch(
      '/pages/:pageId/layout',
      {
        preHandler: app.requireAuth,
        schema: {
          params: pageParams,
          body: pageLayoutPatchBody,
          response: { 200: pageLayoutReply },
        },
      },
      async (request) => {
        const { pageId } = request.params;
        const page = await pages.findById(pageId);
        if (page === null || !page.isEnabled) {
          throw new NotFoundError(`page ${pageId} does not exist`);
        }

        // Shared-default writes need page-EDIT (Admin+); super-admins bypass.
        if (!(await request.can(`page:${pageId}:edit`))) {
          throw new ForbiddenError(
            'You do not have permission to edit this page.',
            'PAGE_FORBIDDEN',
            { pageId },
          );
        }

        const updated = await pages.setLayout(pageId, request.body, app.rbac.now());
        if (updated === null) {
          throw new NotFoundError(`page ${pageId} does not exist`);
        }

        await app.rbac.audit(request, {
          category: 'data',
          action: 'page.layout.update',
          changes: { after: { pageId, items: request.body.items.length } },
        });

        return { data: { layout: request.body } };
      },
    );
  };
}
