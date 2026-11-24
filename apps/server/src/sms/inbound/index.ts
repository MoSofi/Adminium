// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The SMS channel on the inbound core: signatures, the STOP parser, delivery
 * status, the catch-up after downtime, and whether this server can hear a STOP.
 */
export {
  SMS_CONTROL_RETAIN_MS,
  SMS_INBOUND_BODY_LIMIT,
  SMS_INBOUND_CHANNEL,
  SMS_SWEEP_CATCH_UP_EVERY_MS,
  SMS_SWEEP_CATCH_UP_LOOKBACK_MS,
  SMS_SWEEP_CATCH_UP_MAX_PAGES,
  TWILIO_RETRY_OVERRIDE,
  createSmsInboundChannel,
  type SmsInboundChannel,
  type SmsInboundDeps,
  type SmsReplyReach,
  type SmsReplyReceived,
  type SmsReplyState,
} from './channel.js';
export { SMS_CATCH_UP_LOOKBACK_MS, SMS_CATCH_UP_MAX_PAGES, createSmsCatchUp, type SmsCatchUp, type SmsCatchUpDeps, type SmsCatchUpResult } from './catch-up.js';
export { foldMessage, listedWords, readControlWord, type ControlKind, type ControlWord } from './control-words.js';
export {
  SMS_DELIVERY_STATUSES,
  deliveryMoves,
  deliveryStatusOf,
  isFinalStatus,
  type SmsDeliveryStatus,
} from './delivery.js';
export { SMS_STOP_EVENT_KINDS } from './payload.js';
export { TELNYX_WINDOW_SECONDS, twilioAddressForms, twilioSignedText, verifyTelnyx, verifyTwilio } from './signature.js';
export { SMS_STOP_CONFIRMATION, SMS_STOP_CONFIRM_WINDOW_MS, decideStopConfirmation, stopConfirmationIn, type SmsStopConfirmation, type StopConfirmationDecision } from './stop-reply.js';
