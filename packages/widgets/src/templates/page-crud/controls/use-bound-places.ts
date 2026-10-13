// SPDX-License-Identifier: AGPL-3.0-only
import { useMemo } from 'react';

import type { CrudApi } from '../crud-api.js';

/**
 * The page's search of the town list, as ONE function for as long as the
 * page's table is the same. `api.places?.bind(api)` written in the render
 * makes a new function every time the page is drawn, and anything keyed on it
 * (a field's search) then starts again with each draw.
 */
export function useBoundPlaces(api: Pick<CrudApi, 'places'>): CrudApi['places'] {
  return useMemo(() => api.places?.bind(api), [api]);
}
