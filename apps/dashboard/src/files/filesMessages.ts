// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `files` message namespace is DEFERRED (`DEFERRED_NAMESPACES`): the Files
 * library and its upload dialog render only after it is in the store, so a
 * `files:` key never falls back to English for a translated locale. The route
 * body `use()`s this promise under the Suspense boundary it already had for
 * its chunk (`app/router.tsx`).
 *
 * The `page-files` TEMPLATE is NOT a consumer: it renders inside a user-built
 * page that never awaits this namespace, so its one label resolves through the
 * widget's own `ui:templates.files.*` fallback instead.
 */
import { deferredMessagesReady } from '../i18n/deferredMessages.js';

export function filesMessagesReady(): Promise<void> {
  return deferredMessagesReady('files');
}
