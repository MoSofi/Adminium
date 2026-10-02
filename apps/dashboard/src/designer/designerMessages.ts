// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `designer` namespace is DEFERRED (`DEFERRED_NAMESPACES`): every word
 * Adminium Designer's pages say, read by those lazy pages and nothing else.
 * Each page awaits it before it renders.
 */
import { use } from 'react';

import { deferredMessagesReady } from '../i18n/deferredMessages.js';
import { getI18nInstance } from '../i18n/t.js';

/** Resolves once `designer` is in the store for the active language. */
export function designerMessagesReady(): Promise<void> {
  return deferredMessagesReady('designer');
}

/** Suspends until the messages are in the store; a no-op without i18n. */
export function useDesignerMessages(): void {
  if (getI18nInstance() !== null) use(deferredMessagesReady('designer'));
}
