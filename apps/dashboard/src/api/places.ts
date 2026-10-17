// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The server's list of towns, for a record's place field
 * (`GET /api/v1/geo/places`): names by the start of what was typed, in the
 * signed-in person's own language. The list ships with the server and asks
 * nobody outside, so it answers with maps switched off too.
 *
 * Apart from `api/crud.ts` on purpose: that module is in everybody's first
 * load, and only a form with a place column ever asks this.
 */
import type { CrudApi } from '@adminium/widgets';

import { api } from '../app/api.js';

type PlaceSuggestions = Awaited<ReturnType<NonNullable<CrudApi['places']>>>;

/** How many towns one look offers: a short list a person can read. */
const PLACE_LIMIT = 8;

export async function searchPlaces(query: string): Promise<PlaceSuggestions> {
  const reply = await api.get<{ data: PlaceSuggestions }>(`/api/v1/geo/places?q=${encodeURIComponent(query)}&limit=${String(PLACE_LIMIT)}`);
  return reply.data;
}

/** The same CRUD surface, with the place list on it (over it, as the bindings' own wrappers are: its methods stay its own). */
export function withPlaces<T extends CrudApi>(crud: T): T {
  const out = Object.create(crud) as T;
  out.places = searchPlaces;
  return out;
}
