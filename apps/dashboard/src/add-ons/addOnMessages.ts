// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `addOns` namespace's readiness, the shape `studio` and `email` already
 * use (`i18n/deferredMessages.ts`).
 *
 * Every string in it is drawn by the lazy page host and by nothing else — the
 * states for an add-on that is absent, switched off, or whose module will not
 * load. They lived in `common` first, which is eager, where a measurement put
 * them at 0.85 KiB of an entry chunk that is held to the byte. Moving them here
 * costs one await on a screen that is already loading a bundle.
 */
import { deferredMessagesReady } from '../i18n/deferredMessages.js';

/** Resolves once `addOns` is in the store for the active language. */
export function addOnMessagesReady(): Promise<void> {
  return deferredMessagesReady('addOns');
}
