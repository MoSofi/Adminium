/**
 * Page-document routes (08-server-api.md §2.6, read surface only for v0.1):
 *
 *   GET /api/v1/pages/:pageId → { data: <page envelope> }
 *
 * The dashboard's PageRenderer fetches the stored envelope by the id it got
 * from the bootstrap nav tree and runs client-side config migrations
 * (09-generated-app.md §2.3/§3) — the server returns the document verbatim.
 * Any authenticated principal may read enabled pages; per-page RBAC rows
 * arrive with the M5 Studio (08 §5.2), matching the bootstrap nav exposure.
 *
 * Write routes (POST/PATCH/layout/duplicate/delete) land with the dashboard
 * builder in M5/M7 per 08 §2.6.
 */

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { pagesRepo, type MetaDb } from '@adminium/meta';

import { NotFoundError } from '../../errors.js';
import { pageParams, pageReply } from './schema.js';

export interface PagesRoutesDeps {
  meta: MetaDb;
}

export function pagesRoutes(deps: PagesRoutesDeps): FastifyPluginAsyncZod {
  const pages = pagesRepo(deps.meta);

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
        return { data: page.config };
      },
    );
  };
}
