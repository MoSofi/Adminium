// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Edit-time surface of `@adminium/i18n` — the key index, the write validator
 * and the generated a11y-critical key list (23-runtime-translations.md §6.3).
 *
 * A SEPARATE ENTRY POINT on purpose. These modules exist to serve the
 * translation routes and the editor; nothing on the dashboard's boot path
 * needs them, and the a11y list in particular is a 458-entry `Set` literal
 * that Rollup will not drop from the entry chunk just because no reachable
 * code references it. Keeping them off the main barrel is what stops the
 * dashboard's entry budget (`check-entry-budget.mjs`) from paying for
 * server-side machinery.
 */

export {
  flattenBundle,
  keyGroup,
  nestBundle,
  sourceIndex,
  sourceKeyCount,
  sourceMessage,
} from './keys.js';

export { A11Y_CRITICAL_KEYS, isA11yCriticalKey } from './a11y-keys.js';

export { validateMessage } from './validate-message.js';
export type {
  MessageValidation,
  MessageValidationCode,
  MessageValidationError,
  ValidateMessageOptions,
} from './validate-message.js';
