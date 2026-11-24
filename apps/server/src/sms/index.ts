// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The SMS provider layer. A send path calls `createSmsService(...).send`, the
 * stop list implements `SmsStopList`, an inbound route reads `.credentials()`.
 */
export { SMS_KEY_SALT, SmsSecret, maskAccountName, openCredentials, senderTakesReplies, smsSecretKey, type SmsCredentialInput, type SmsCredentials, type TelnyxCredentials, type TwilioCredentials } from './credentials.js';
export { checkDestination, phoneHint, type SmsDestination } from './destination.js';
export { SMS_MANAGE_ACTION, SMS_MANAGE_LABEL, SMS_MANAGE_PERMISSION } from './permission.js';
export type { SmsProvider } from './provider.js';
export { smsRoutes, type SmsRoutesDeps } from './routes.js';
export {
  SMS_MAX_BODY,
  SMS_PROVIDER_ADAPTERS,
  SMS_SAME_KEY_WINDOW_MS,
  SMS_TEST_BODY,
  SMS_TEST_LIMIT,
  SMS_TEST_WINDOW_MS,
  afterAttempt,
  createSmsService,
  type SmsAccountView,
  type SmsConnectResult,
  type SmsEarlierAttempt,
  type SmsSendRequest,
  type SmsService,
  type SmsServiceDeps,
  type SmsServiceResult,
  type SmsStopList,
} from './service.js';
export type { SmsAccountFields, SmsAccountRow, SmsAccountStore, SmsCheckRecord } from './store.js';
export { TELNYX_CODES, telnyxProvider } from './telnyx.js';
export { TWILIO_CODES, twilioProvider } from './twilio.js';
export * from './types.js';
export { STOP_CONFIRMATIONS, TEXT_LANGUAGES, textLanguageOf, textWordsFor, type TextWords } from './words.js';
