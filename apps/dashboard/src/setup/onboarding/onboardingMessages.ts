// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `onboarding` message namespace is DEFERRED (`DEFERRED_NAMESPACES`): 107
 * messages, 2.5 KiB gzipped, for the one screen an instance shows once in its
 * life — four times the entry ratchet's remaining headroom if they had gone
 * into `common` with the other `setup.*` keys.
 *
 * It is the only deferred namespace whose surface renders BEFORE anyone signs
 * in, which works because the route it needs is public:
 * `GET /api/v1/i18n/bundle/:locale/:namespace` carries no guard (the login
 * screen needs its overrides too).
 */
import { deferredMessagesReady } from '../../i18n/deferredMessages.js';

export function onboardingMessagesReady(): Promise<void> {
  return deferredMessagesReady('onboarding');
}
