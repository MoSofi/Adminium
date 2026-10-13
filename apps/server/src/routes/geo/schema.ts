// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The shapes of `/api/v1/geo/*`: the place list and the way between stops.
 */
import { z } from 'zod';

import { PLACE_SEARCH_MAX } from '../../geo/places.js';
import { ROUTE_STOPS_MAX } from '../../geo/route.js';

export const PLACE_MATCH_MAX = 200;

/** One place of the list, named for the asker. */
export const placeSchema = z.object({
  /** The GeoNames id: what a place column takes as `{ "placeId": id }`. */
  id: z.number().int(),
  /** The name in the asker's language where the list has one, else `plainName`. */
  name: z.string(),
  /** The name as the list has it, usually the local one in Latin letters. */
  plainName: z.string(),
  /** Two letters, upper case. */
  country: z.string(),
  countryName: z.string(),
  /** The state, province or governorate; null where the list has none. */
  region: z.string().nullable(),
  lat: z.number(),
  lng: z.number(),
  population: z.number().int(),
});

/** A language in either spelling (`ar_EG`, `ar-EG`, `ar`); the signed-in person's own when absent. */
const language = z
  .string()
  .regex(/^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*$/)
  .optional();

export const placeSearchQuery = z.object({
  q: z.string().max(120),
  /** Two letters, or a country's name. */
  country: z.string().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(PLACE_SEARCH_MAX).optional(),
  language,
});
export const placeSearchReply = z.object({ data: z.array(placeSchema) });

export const placeParams = z.object({ id: z.coerce.number().int().min(1) });
export const placeQuery = z.object({ language });
export const placeReply = z.object({ data: placeSchema });

export const placeMatchBody = z
  .object({
    items: z
      .array(
        z
          .object({
            town: z.string().max(200),
            region: z.string().max(200).nullable().optional(),
            country: z.string().max(80).nullable().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(PLACE_MATCH_MAX),
    language,
  })
  .strict();
/** As many answers as items, in their order: the place, or null where the list has no such town. */
export const placeMatchReply = z.object({ data: z.array(placeSchema.nullable()) });

export const routeBody = z
  .object({
    stops: z
      .array(
        z
          .object({
            lat: z.number().min(-90).max(90),
            lng: z.number().min(-180).max(180),
            by: z.enum(['town', 'exact']).optional(),
            placeId: z.number().int().min(1).optional(),
          })
          .strict(),
      )
      .min(2)
      .max(ROUTE_STOPS_MAX),
  })
  .strict();

export const routeReply = z.object({
  data: z.object({
    /** `straight`: lines over the globe. `server`: the routing server's roads. */
    source: z.enum(['straight', 'server']),
    /** The routing server was to be asked and could not be. */
    fellBack: z.literal(true).optional(),
    legs: z.array(
      z.object({
        distanceM: z.number().int().nullable(),
        durationS: z.number().int().nullable(),
        estimate: z.boolean(),
        /** Both ends are known only as the same town: no length can be given. */
        unknown: z.literal(true).optional(),
      }),
    ),
    line: z.object({ type: z.literal('LineString'), coordinates: z.array(z.tuple([z.number(), z.number()])) }).optional(),
  }),
});
