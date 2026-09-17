// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `email` message namespace is DEFERRED (39-email-templates-and-
 * campaigns.md; `DEFERRED_NAMESPACES`): the manager and the editor render
 * only after it is in the store, so an `email:` key never falls back to
 * English for a translated locale. The two routes `use()` this promise
 * under a Suspense boundary (`app/router.tsx`).
 */
import { deferredMessagesReady } from '../i18n/deferredMessages.js';

export function emailMessagesReady(): Promise<void> {
  return deferredMessagesReady('email');
}
