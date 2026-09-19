// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `@tanstack/react-query` shim a page bundle's build aliases that specifier to
 * (see `./index.ts`), so the page uses the HOST's copy of
 * the host's QueryClient and its hooks.
 *
 * A second react-query is a second cache behind an empty `QueryClientProvider`. Hooks do not throw there — they hang, which is a blank screen with no error.
 *
 * The names are `ADD_ON_QUERY_EXPORTS` and nothing else: an ES module cannot export a
 * name it does not spell, which is what makes this list the API rather than a
 * description of one. `add-on-host.test.ts` holds the two equal.
 */

import { requireAddOnHost } from './index.js';

const query = requireAddOnHost().query;

export const QueryClient = query['QueryClient'] as never;
export const queryOptions = query['queryOptions'] as never;
export const useMutation = query['useMutation'] as never;
export const useQuery = query['useQuery'] as never;
export const useQueryClient = query['useQueryClient'] as never;

export default query;
