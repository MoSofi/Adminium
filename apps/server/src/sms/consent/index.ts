// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Text consent: the stop list for phones, service and marketing consent,
 * people known only by phone, their erasure, and redaction. The send path and
 * the inbound route reach it through `createTextConsentService`.
 */
export * from './types.js';
export { createTextConsentService, textSubject, type TextConsentDeps } from './service.js';
export { createTextConsentStore, type TextConsentStore } from './store.js';
export { DOUBLE_OPT_IN_COUNTRIES, NO_REPLY_COUNTRIES, NO_TEXT_CALLING_CODES } from './rules.js';
export { maskPhone, redactPhones } from './redact.js';
export { findRowsByPhone, type PhoneRowsQuery } from './find-rows.js';
