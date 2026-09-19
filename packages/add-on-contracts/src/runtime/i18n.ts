// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `@adminium/i18n` shim a page bundle's build aliases that specifier to
 * (see `./index.ts`), so the page uses the HOST's copy of
 * locale helpers.
 *
 * A second catalogue would answer with a different locale than the chrome around it.
 *
 * The names are `ADD_ON_I18N_EXPORTS` and nothing else: an ES module cannot export a
 * name it does not spell, which is what makes this list the API rather than a
 * description of one. `add-on-host.test.ts` holds the two equal.
 */

import { requireAddOnHost } from './index.js';

const i18n = requireAddOnHost().i18n;

export const tagForLocale = i18n['tagForLocale'] as never;

export default i18n;
