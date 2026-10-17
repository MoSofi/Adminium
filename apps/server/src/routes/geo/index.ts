// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Places and routes (`/api/v1/geo/*`), for anybody signed in or holding an
 * API key. No table is read: the place list is a public gazetteer that ships
 * with the server, and a route is worked out from the positions it is given.
 *
 *   GET  /geo/places?q=&country=&limit=   towns by the start of a name
 *   GET  /geo/places/:id                  one town by its id
 *   POST /geo/places/match                the towns of up to 200 addresses
 *   POST /geo/route                       the legs between 2 to 50 stops
 *
 * The first three ask nobody: they answer with maps switched off too. The
 * last asks the routing server only while routing is switched on
 * (`geo/route.ts`); otherwise, and on any failure, its legs are straight
 * lines marked as estimates.
 */
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { userPrefsRepo, type MetaDb } from '@adminium/meta';

import { NotFoundError, UnauthorizedError } from '../../errors.js';
import { MAPS_OFF } from '../../geo/map-policy.js';
import { defaultPlaces, type Places } from '../../geo/places.js';
import { createRouter, type Router } from '../../geo/route.js';
import { placeMatchBody, placeMatchReply, placeParams, placeQuery, placeReply, placeSearchQuery, placeSearchReply, routeBody, routeReply } from './schema.js';

export interface GeoRoutesDeps {
  meta: MetaDb;
  /** The place list; the one this server ships unless a test says otherwise. */
  places?: Places | undefined;
  /** The way between stops; made from the server's own map policy unless a test says otherwise. */
  router?: Router | undefined;
}

export function geoRoutes(deps: GeoRoutesDeps): FastifyPluginAsyncZod {
  const places = deps.places ?? defaultPlaces();

  return async (app) => {
    const router =
      deps.router ??
      createRouter({
        state: async () => (app.hasDecorator('maps') ? app.maps.read() : MAPS_OFF),
        blockLoopback: process.env['NODE_ENV'] === 'production',
      });

    /** Session or API key (401, the rule the search route has). */
    function signedIn(request: FastifyRequest): void {
      if ((request.user ?? null) === null && (request.apiKeyPrincipal ?? null) === null) throw new UnauthorizedError('UNAUTHENTICATED');
    }

    /** The language names are answered in: the one asked for, else the signed-in person's own. */
    async function languageOf(request: FastifyRequest, asked: string | undefined): Promise<string | undefined> {
      if (asked !== undefined) return asked;
      const userId = (request.user as { id?: string } | null | undefined)?.id;
      return userId === undefined ? undefined : (await userPrefsRepo(deps.meta).resolve(userId)).locale;
    }

    app.get(
      '/geo/places',
      {
        // Typed into a field a letter at a time: a search's budget, not the general one.
        config: { rateLimitBucket: 'search' },
        schema: { querystring: placeSearchQuery, response: { 200: placeSearchReply } },
      },
      async (request) => {
        signedIn(request);
        const { q, country, limit, language } = request.query;
        return { data: await places.search(q, { country, limit, language: await languageOf(request, language) }) };
      },
    );

    app.get('/geo/places/:id', { schema: { params: placeParams, querystring: placeQuery, response: { 200: placeReply } } }, async (request) => {
      signedIn(request);
      const place = await places.byId(request.params.id, await languageOf(request, request.query.language));
      if (place === null) throw new NotFoundError('The list has no place with this id.');
      return { data: place };
    });

    app.post(
      '/geo/places/match',
      {
        config: { rateLimitBucket: 'geo-match' },
        schema: { body: placeMatchBody, response: { 200: placeMatchReply } },
      },
      async (request) => {
        signedIn(request);
        const language = await languageOf(request, request.body.language);
        const data = [];
        for (const [at, item] of request.body.items.entries()) {
          // Each look walks the list: every so often the turn is given back, so a long batch holds nobody else up.
          if (at > 0 && at % 10 === 0) await new Promise<void>((done) => setImmediate(done));
          data.push(await places.match(item, language));
        }
        return { data };
      },
    );

    app.post(
      '/geo/route',
      {
        config: { rateLimitBucket: 'geo-route' },
        schema: { body: routeBody, response: { 200: routeReply } },
      },
      async (request) => {
        signedIn(request);
        // Who asks: one person's asks never hold every turn at the routing server.
        const by = (request.user as { id?: string } | null | undefined)?.id ?? request.apiKeyPrincipal?.id;
        return { data: await router.route(request.body.stops, by) };
      },
    );
  };
}
