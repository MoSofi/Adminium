// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `roles` message namespace is DEFERRED (`DEFERRED_NAMESPACES`): the Roles
 * & permissions editor renders only after it is in the store, so a `roles:`
 * key never falls back to English for a translated locale. The route body
 * `use()`s this promise under the Suspense boundary it already had for its
 * chunk (`app/router.tsx`), exactly as `/files` does.
 *
 * `RolesPage.tsx` is the only reader. The Team page next door links to it but
 * says nothing from this namespace, and must not start: it does not await it.
 */
import { deferredMessagesReady } from '../i18n/deferredMessages.js';

export function rolesMessagesReady(): Promise<void> {
  return deferredMessagesReady('roles');
}
