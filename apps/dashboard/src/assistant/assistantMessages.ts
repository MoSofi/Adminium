// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `assistant` message namespace is DEFERRED (`DEFERRED_NAMESPACES`):
 * everything the assistant says — four pages' worth of greetings, chips,
 * confirms and detail rows — is a chunk that most sessions never fetch,
 * because most sessions never open it.
 *
 * IT IS WAITED ON IN TWO PLACES, for two different reasons.
 *
 * A HOST PAGE waits on {@link assistantMessagesReady} beside its own
 * namespace, because the button that opens the modal is painted with the
 * page and its two strings are in this namespace. A button that renders
 * English for one frame and then re-renders in Czech is worse than a page
 * that paints once.
 *
 * THE MODAL calls {@link useAssistantMessages} under its own boundary, so it
 * is correct when it is mounted by something that did not wait — a story, a
 * test, a host added later.
 *
 * The hook is the GUARDED form on purpose. With no i18n instance there is
 * nothing to wait for and it must not suspend: React 19 never resumes a
 * `use()` that suspends inside a synchronous `act()`, which is every
 * component test that renders this modal.
 */
import { use } from 'react';

import { deferredMessagesReady } from '../i18n/deferredMessages.js';
import { getI18nInstance } from '../i18n/t.js';

/** For a route that waits before it paints. */
export function assistantMessagesReady(): Promise<void> {
  return deferredMessagesReady('assistant');
}

/** Suspends until the messages are in the store; a no-op without i18n. */
export function useAssistantMessages(): void {
  if (getI18nInstance() !== null) use(deferredMessagesReady('assistant'));
}
