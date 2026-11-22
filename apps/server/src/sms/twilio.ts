// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Twilio Programmable Messaging.
 *
 *   POST /2010-04-01/Accounts/{sid}/Messages.json   form-encoded
 *   GET  /2010-04-01/Accounts/{sid}.json            the check
 *
 * Twilio documents no idempotency key on message create. So a timeout, a lost
 * connection, a 5xx or a reply that cannot be read is `unknown`, and the only
 * thing allowed next is `check-first`: this adapter never resends.
 *
 * Twilio's account reply carries the Auth Token (`auth_token`) and its name
 * defaults to the owner's e-mail address. Only `sid`, `status`, `type` and a
 * masked name are read from it.
 */
import { maskAccountName, type SmsCredentials, type TwilioCredentials } from './credentials.js';
import { MESSAGE_ID, STATUS_WORD, asRecord, callProvider, plainToken, priceOf, retryAfterMs, segmentsOf, type SmsCallContext } from './http.js';
import { fromMeaning, fromNoAnswer, notTaken, refused, unknownResult, type SmsCodeMeaning, type SmsProvider } from './provider.js';
import type { SmsCheckResult, SmsOutgoing, SmsProviderResult } from './types.js';

const API = 'https://api.twilio.com/2010-04-01';

/** Twilio's error codes, by what they mean for this message. */
export const TWILIO_CODES: Readonly<Record<string, SmsCodeMeaning>> = {
  '20429': notTaken('rate-limited'),
  // Refused at creation because the sender's queue is full: nothing was queued.
  '21611': notTaken('queue-full'),
  '20003': refused('credentials'),
  '21211': refused('invalid-number'),
  '21212': refused('invalid-sender'),
  '21408': refused('country-not-enabled'),
  '21602': refused('body-empty'),
  '21606': refused('sender-cannot-text'),
  '21610': refused('opted-out'),
  '21612': refused('unreachable'),
  '21614': refused('not-mobile'),
  '21617': refused('body-too-long'),
  '30034': refused('sender-not-registered'),
};

function asTwilio(credentials: SmsCredentials): TwilioCredentials {
  if (credentials.provider !== 'twilio') throw new TypeError('Twilio was handed another provider\'s keys.');
  return credentials;
}

const basicAuth = (credentials: TwilioCredentials): string =>
  `Basic ${Buffer.from(`${credentials.accountSid}:${credentials.authToken.reveal()}`).toString('base64')}`;

function codeOf(json: unknown): string | null {
  const code = asRecord(json)?.['code'];
  return typeof code === 'number' && Number.isInteger(code) ? String(code) : typeof code === 'string' && /^\d{1,8}$/.test(code) ? code : null;
}

export const twilioProvider: SmsProvider = {
  key: 'twilio',
  timeoutRetry: 'never',

  async check(raw: SmsCredentials, context: SmsCallContext): Promise<SmsCheckResult> {
    const credentials = asTwilio(raw);
    const call = await callProvider(context, {
      url: `${API}/Accounts/${credentials.accountSid}.json`,
      method: 'GET',
      headers: { authorization: basicAuth(credentials), accept: 'application/json' },
    });
    if (call.kind !== 'answered') return { ok: false, reason: 'unreachable', providerCode: null };
    const providerCode = codeOf(call.json);
    if (call.status === 401 || call.status === 403 || call.status === 404) return { ok: false, reason: 'credentials-refused', providerCode };
    if (call.status < 200 || call.status >= 300) return { ok: false, reason: 'unreachable', providerCode };
    const account = asRecord(call.json);
    if (account === null || account['sid'] !== credentials.accountSid) return { ok: false, reason: 'unreachable', providerCode: null };
    if (account['status'] === 'suspended') return { ok: false, reason: 'account-suspended', providerCode: null };
    if (account['status'] === 'closed') return { ok: false, reason: 'account-closed', providerCode: null };
    if (account['status'] !== 'active') return { ok: false, reason: 'unreachable', providerCode: null };
    const type = account['type'];
    return { ok: true, accountName: maskAccountName(account['friendly_name']), accountType: type === 'Trial' ? 'trial' : type === 'Full' ? 'full' : null };
  },

  async send(raw: SmsCredentials, message: SmsOutgoing, context): Promise<SmsProviderResult> {
    const credentials = asTwilio(raw);
    const form = new URLSearchParams({ To: message.to, Body: message.body });
    if (message.sender.kind === 'pool') form.set('MessagingServiceSid', message.sender.value);
    else form.set('From', message.sender.value);
    if (message.callbackUrl !== null) form.set('StatusCallback', message.callbackUrl);

    const call = await callProvider(context, {
      url: `${API}/Accounts/${credentials.accountSid}/Messages.json`,
      method: 'POST',
      headers: { authorization: basicAuth(credentials), accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    if (call.kind !== 'answered') return fromNoAnswer(twilioProvider, call);

    const { status, json, headers } = call;
    if (status >= 200 && status < 300) {
      const reply = asRecord(json);
      const messageId = plainToken(reply?.['sid'], MESSAGE_ID);
      if (messageId === null) return unknownResult(twilioProvider, 'unreadable-reply');
      return {
        outcome: 'accepted',
        provider: 'twilio',
        messageId,
        status: plainToken(reply?.['status'], STATUS_WORD),
        segments: segmentsOf(reply?.['num_segments']),
        price: priceOf(reply?.['price'], reply?.['price_unit']),
        replayed: false,
      };
    }

    const providerCode = codeOf(json);
    const retryAfter = retryAfterMs(headers, context.now);
    if (status === 429) return { outcome: 'not-taken', provider: 'twilio', reason: 'rate-limited', retryAfterMs: retryAfter, providerCode };
    // Only the statuses that mean "this request was turned away" are read as a refusal.
    if (status === 400 || status === 401 || status === 403 || status === 404) {
      const meaning = providerCode === null ? undefined : TWILIO_CODES[providerCode];
      if (meaning !== undefined) return fromMeaning('twilio', meaning, providerCode, retryAfter);
      const reason = status === 400 ? 'provider-refused' : 'credentials';
      return { outcome: 'refused', provider: 'twilio', reason, detail: null, providerCode };
    }
    return unknownResult(twilioProvider, 'server-error', providerCode);
  },
};
