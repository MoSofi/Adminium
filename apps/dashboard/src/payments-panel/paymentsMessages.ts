// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `payments` message namespace is DEFERRED (`DEFERRED_NAMESPACES`): the
 * Payment panel's words load with the first record that takes payments,
 * never with every record page. The lazy panel calls
 * {@link usePaymentsMessages} under its own Suspense boundary, so a
 * `payments:` key never falls back to English for a translated locale.
 */
import { use } from 'react';

import { deferredMessagesReady } from '../i18n/deferredMessages.js';
import { getI18nInstance } from '../i18n/t.js';

/** Suspends until the `payments` messages are in the store; without i18n (unit tests) there is nothing to wait for. */
export function usePaymentsMessages(): void {
  if (getI18nInstance() !== null) use(deferredMessagesReady('payments'));
}

/** The reader's language tag, for amounts and dates. */
export function readerLocale(): string {
  return getI18nInstance()?.language ?? 'en-US';
}
