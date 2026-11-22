// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The text send path: the text step, the `sms.send` job, the hand-over marker,
 * send windows, the daily limit and the delivery record.
 */
export { composeText, type ComposeInput, type ComposeResult } from './compose.js';
export { createStopConfirmer, type StopConfirmDeps, type StopConfirmOutcome } from './confirm-stop.js';
export { createHandOver, earlierOf, TextRetryLater, type HandOverDeps, type TextLimitWarning } from './handover.js';
export { openText, registerSmsSendHandler, sealText, SMS_SEND_ATTEMPTS, SMS_SEND_JOB_KIND, smsSendPayloadSchema, textEnvelopeKey, type SmsSendPayload } from './job.js';
export { estimateLength, limitsFor, TEXT_MAX_SEGMENTS, type LengthLimits, type TextEstimate } from './length.js';
export { optOutLine, repliesWithStopWord, saysStop, withoutStopSentence, type BusinessContact } from './opt-out.js';
export { createTextSendPath, textPhoneKeys, type TextPhoneKeys, type TextPrepared, type TextPrepareInput, type TextQueued, type TextQueueInput, type TextSendDeps, type TextSendPath, type TextUsage } from './path.js';
export { DEFAULT_SERVICE_HOURS, DEFAULT_TEXT_DAILY_LIMIT, MAX_TEXT_DAILY_LIMIT, TEXT_WARNING_SHARE, dayKey, readTextPolicy, warningAt, type TextSendPolicy } from './policy.js';
export { createTextSendStore, type TextAcceptFields, type TextDeliveryCreated, type TextDeliveryInput, type TextReport, type TextSendStore, type TextSettleFields, type TextSlot } from './store.js';
export { asksForYes, checkTextTemplate, fillText, readsCredential, TEXT_VALUE_MAX } from './template.js';
export * from './types.js';
export { judgeWindow, MARKETING_HOURS, zonesOfCountry, type DailyHours, type WindowQuestion, type WindowVerdict } from './window.js';
