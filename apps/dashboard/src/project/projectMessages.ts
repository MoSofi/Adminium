// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `project` message namespace is DEFERRED (`DEFERRED_NAMESPACES`): what
 * the dashboard says about a project's own code loads with the first project
 * page, cell or card, not with every dashboard. `ProjectPageBinding`,
 * `ProjectCell` and `ProjectCard` call {@link useProjectMessages} under
 * their own Suspense boundaries, so a `project:` key never falls back to
 * English for a translated locale; the UI kit's `DataTable` only renders
 * below one of them.
 */
import { use } from 'react';

import { deferredMessagesReady } from '../i18n/deferredMessages.js';
import { getI18nInstance } from '../i18n/t.js';

/**
 * Suspends until the `project` messages are in the store. Without i18n (unit
 * tests that never boot it) there is nothing to wait for: those render the
 * inline English.
 */
export function useProjectMessages(): void {
  if (getI18nInstance() !== null) use(deferredMessagesReady('project'));
}
