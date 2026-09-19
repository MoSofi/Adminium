// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `@tanstack/react-router` shim a page bundle's build aliases that specifier to
 * (see `./index.ts`), so the page uses the HOST's copy of
 * the host's router.
 *
 * A second router is a second history: `useNavigate` would push onto a tree the page is not mounted in, and nothing would move.
 *
 * The names are `ADD_ON_ROUTER_EXPORTS` and nothing else: an ES module cannot export a
 * name it does not spell, which is what makes this list the API rather than a
 * description of one. `add-on-host.test.ts` holds the two equal.
 */

import { requireAddOnHost } from './index.js';

const router = requireAddOnHost().router;

export const useBlocker = router['useBlocker'] as never;
export const useNavigate = router['useNavigate'] as never;
export const useParams = router['useParams'] as never;
export const useSearch = router['useSearch'] as never;

export default router;
