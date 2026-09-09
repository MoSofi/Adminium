// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `dataio` message namespace is DEFERRED (`DEFERRED_NAMESPACES`): the
 * import wizard, the exports manager and the export builder render only after
 * it is in the store, so a `dataio:` key never falls back to English for a
 * translated locale. The three route bodies `use()` this promise under the
 * Suspense boundary they already had for their chunk (./routes.tsx).
 *
 * The two keys the route FACTORY itself reads are deliberately not here: the
 * page titles are `common:nav.imports`/`nav.exports`, because routes.tsx is
 * statically imported by the router and so is in the entry chunk, where a
 * deferred key would paint English on every first visit.
 */
import { deferredMessagesReady } from '../i18n/deferredMessages.js';

export function dataIoMessagesReady(): Promise<void> {
  return deferredMessagesReady('dataio');
}
