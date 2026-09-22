// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `apiDocs` namespace is DEFERRED (`DEFERRED_NAMESPACES`): everything the
 * public API explorer says, for a page most visitors of a deployment never
 * open. `/api-docs` awaits it before it renders, under the same Suspense
 * boundary that waits for the catalogue — the pattern `/setup` uses for
 * `onboarding`, the other surface drawn with no session.
 */
import { use } from 'react';

import { deferredMessagesReady } from '../i18n/deferredMessages.js';
import { getI18nInstance } from '../i18n/t.js';

/** Resolves once `apiDocs` is in the store for the active language. */
export function apiDocsMessagesReady(): Promise<void> {
  return deferredMessagesReady('apiDocs');
}

/** Suspends until the messages are in the store; a no-op without i18n. */
export function useApiDocsMessages(): void {
  if (getI18nInstance() !== null) use(deferredMessagesReady('apiDocs'));
}
