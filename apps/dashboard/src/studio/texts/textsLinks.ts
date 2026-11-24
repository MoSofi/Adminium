// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Every address outside Adminium that the Texts page links to.
 *
 * None carries a query string, so no referral or tracking tag leaves with a
 * click, and each opens with `rel="noopener noreferrer"`.
 *
 * WHAT IS PROVED. Nothing yet: no real provider account has been opened for
 * this work. These are the providers' documented console addresses, and stay
 * unconfirmed until the owner's signed-in walk records the final ones here.
 */
export const TEXTS_LINKS = {
  twilio: {
    signUp: 'https://www.twilio.com/try-twilio',
    keys: 'https://console.twilio.com/',
    registration: 'https://console.twilio.com/us1/develop/sms/regulatory-compliance',
    log: 'https://console.twilio.com/us1/monitor/logs/sms',
    senders: 'https://console.twilio.com/us1/develop/phone-numbers/manage/incoming',
  },
  telnyx: {
    signUp: 'https://telnyx.com/sign-up',
    keys: 'https://portal.telnyx.com/#/api-keys',
    registration: 'https://portal.telnyx.com/#/messaging/10dlc',
    log: 'https://portal.telnyx.com/#/reporting/message-detail-records',
    senders: 'https://portal.telnyx.com/#/messaging',
  },
} as const;
