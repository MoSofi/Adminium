// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The en-US bundles that ship SYNCHRONOUSLY (10-i18n-theming.md §2.3).
 *
 * Separate from ./index.ts because that module also exports the complete
 * catalogue for edit-time consumers (the key index, the parity gate, the
 * translation routes), and the complete catalogue includes the deferred
 * `studio` namespace. Importing the runtime set from here is what keeps
 * `en-us/studio.js` out of the dashboard's entry chunk — structurally, rather
 * than by hoping the bundler drops an unreferenced binding.
 *
 * TS mirrors of the canonical JSON — see ./en-us/*.ts headers and
 * parity.test.ts.
 */
import common from './en-us/common.js';
import errors from './en-us/errors.js';
import generated from './en-us/generated.js';
import ui from './en-us/ui.js';

import type { EagerNamespace, ResourceBundle } from './namespaces.js';

export const EN_US_EAGER: Record<EagerNamespace, ResourceBundle> = {
  common,
  ui,
  generated,
  errors,
};
