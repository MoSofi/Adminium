// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `automations` message namespace is DEFERRED (42-T25;
 * `DEFERRED_NAMESPACES`): both pages render only after it is in the store, so
 * an `automations:` key never falls back to English for a translated locale.
 * The two routes `use()` this promise under the same Suspense boundary that
 * waits for their chunk — the email surface's choreography, unchanged.
 */
import { deferredMessagesReady } from '../i18n/deferredMessages.js';

export function automationsMessagesReady(): Promise<void> {
  return deferredMessagesReady('automations');
}
