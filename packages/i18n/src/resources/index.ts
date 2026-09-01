// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The complete en-US catalogue, for the surfaces that need every namespace at
 * once: the key index behind the Translations editor (../keys.ts), the
 * cross-locale parity gate (./parity.test.ts) and the override merge
 * (../overrides.ts, which reaches this module through a dynamic import).
 *
 * NOT the runtime set. The dashboard's boot path imports {@link EN_US_EAGER}
 * from ./eager.js and the namespace axis from ./namespaces.js; `studio` is
 * fetched on demand for every locale, en-US included (./lazy.ts). Importing
 * THIS module from anything on the boot path puts the whole console's English
 * back in the entry chunk, which is what `apps/dashboard`'s
 * check-entry-budget ratchet exists to catch.
 */
import studio from './en-us/studio.js';

import { EN_US_EAGER } from './eager.js';
import type { Namespace, ResourceBundle } from './namespaces.js';

export {
  DEFERRED_NAMESPACES,
  EAGER_NAMESPACES,
  NAMESPACES,
  type DeferredNamespace,
  type EagerNamespace,
  type Namespace,
  type ResourceBundle,
} from './namespaces.js';
export { EN_US_EAGER } from './eager.js';

export const EN_US_RESOURCES: Record<Namespace, ResourceBundle> = {
  ...EN_US_EAGER,
  studio,
};
