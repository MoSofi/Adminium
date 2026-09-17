// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `invoices` message namespace is DEFERRED (`DEFERRED_NAMESPACES`): the
 * manager and the editor render only after it is in the store, so an
 * `invoices:` key never falls back to English for a translated locale. The
 * two routes `use()` this promise under a Suspense boundary
 * (`app/router.tsx`) — the email surface's choreography.
 */
import { deferredMessagesReady } from '../i18n/deferredMessages.js';

export function invoicesMessagesReady(): Promise<void> {
  return deferredMessagesReady('invoices');
}
