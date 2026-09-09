// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `reportBuilder` message namespace is DEFERRED (43-report-builder.md
 * D24, 43-T08; `DEFERRED_NAMESPACES`): the manager and the editor render only
 * after it is in the store, so a `reportBuilder:` key never falls back to
 * English for a translated locale. The two routes `use()` this promise under
 * a Suspense boundary (`app/router.tsx`) — the invoice surface's
 * choreography.
 *
 * NOT `reports`: that block lives in `common.json` and belongs to Scheduled
 * Reports (43 §0.3 trap 1).
 */
import { deferredMessagesReady } from '../i18n/deferredMessages.js';

export function reportBuilderMessagesReady(): Promise<void> {
  return deferredMessagesReady('reportBuilder');
}
