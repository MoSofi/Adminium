// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The consent door: the consent log and the stop list, reached only through
 * `createConsentService`. Its words are in `types.ts`; the keys behind the
 * hashes, and what keeps them through a change of `ADMINIUM_SECRET`, in
 * `keys.ts`.
 */
export * from './types.js';
export { createConsentService, looksLikeAddress, ADDRESS_MAX, type ConsentServiceDeps } from './service.js';
export { applyConsentToColumn, type ConsentTableSource } from './apply-column.js';
export { AddressKeysLockedError, renewAddressKey, resealUnderNewSecret } from './keys.js';
export { consentTableSource } from './tables.js';
