// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `GET /api/v1/api-docs` — what the public `/api-docs` page lists.
 * No key and no session: the page is for strangers.
 *
 * ── A 404, NOT A REFUSAL ───────────────────────────────────────────────────
 * With `publicApi.docsEnabled` off — or when the switch cannot be read — the
 * route answers the router's own 404, so a deployment that turned the page off
 * is indistinguishable from one that never had it. The same 404 answers on a
 * host mapped to a hosted app's customer surface: that address space belongs
 * to the app.
 *
 * What the reply may contain, and why it is only what live keys can call, is
 * `public-api/catalogue.ts`'s header.
 */
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { MetaDb } from '@adminium/meta';

import { NotFoundError } from '../../errors.js';
import type { ApiCatalogue } from '../../public-api/catalogue.js';
import { linkOrigin } from '../../security/public-origin.js';
import { apiDocsReply } from './schema.js';

export interface ApiDocsRoutesDeps {
  meta: MetaDb;
  catalogue: ApiCatalogue;
  /** `publicApi.docsEnabled`, through a fail-closed gate. */
  docsEnabled: () => Promise<boolean>;
  /** `publicApi.enabled`, through the public surface's own gate. */
  apiEnabled: () => Promise<boolean>;
  /** Level 1: `ADMINIUM_PUBLIC_API_ORIGINS` is set. */
  registered: boolean;
  /** Non-null on a host mapped to a hosted app. */
  surfaceForHost?: ((request: FastifyRequest) => Promise<unknown>) | undefined;
}

export function apiDocsRoutes(deps: ApiDocsRoutesDeps): FastifyPluginAsyncZod {
  return async (app) => {
    app.get(
      '/api-docs',
      {
        config: { rateLimitBucket: 'public' },
        schema: { response: { 200: apiDocsReply } },
      },
      async (request) => {
        // Word for word the router's own 404 (`app.ts`), so "off" and "never
        // had one" read the same.
        const absent = () => new NotFoundError(`Route ${request.method}:${request.url} not found.`);
        if (!(await deps.docsEnabled())) throw absent();
        if (deps.surfaceForHost !== undefined && (await deps.surfaceForHost(request)) !== null) throw absent();
        const [connections, apiEnabled, origin] = await Promise.all([
          deps.catalogue.read(),
          deps.apiEnabled(),
          linkOrigin(deps.meta, request),
        ]);
        return {
          apiEnabled,
          registered: deps.registered,
          baseUrl: origin,
          connections,
        };
      },
    );
  };
}
