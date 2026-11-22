// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Telnyx messaging.
 *
 *   POST /v2/messages                       JSON, with `Idempotency-Key`
 *   GET  /v2/messaging_profiles/{id}        the check
 *   GET  /v2/phone_numbers/messaging        which profile a number is on
 *
 * Telnyx replays a successful send for 24 hours when the same key comes again,
 * so a timeout may be retried with the SAME key. What its key does NOT cover:
 *
 *   409 (10036)   the first request is still running: unknown, same key, later
 *   422           the key was used with another body. The first send may have
 *                 gone, so this is never read as a plain refusal: unless the
 *                 reply names a message error, it is unknown, check first
 *   failures      are not replayed, so a retry after one is a fresh attempt
 *
 * Telnyx's error titles have changed between pages (40300 among them), so only
 * the code is matched.
 */
import { maskAccountName, type SmsCredentials, type TelnyxCredentials } from './credentials.js';
import { MESSAGE_ID, STATUS_WORD, asRecord, callProvider, plainToken, priceOf, retryAfterMs, segmentsOf, type SmsCallContext } from './http.js';
import { fromMeaning, fromNoAnswer, notTaken, refused, unknownResult, type SmsCodeMeaning, type SmsProvider } from './provider.js';
import type { SmsCheckResult, SmsOutgoing, SmsProviderResult } from './types.js';

const API = 'https://api.telnyx.com/v2';

/** Telnyx's error codes, by what they mean for this message. */
export const TELNYX_CODES: Readonly<Record<string, SmsCodeMeaning>> = {
  '40318': notTaken('queue-full'),
  '40320': notTaken('sender-busy'),
  '40300': refused('opted-out'),
  '40001': refused('unreachable'),
  '40010': refused('sender-not-registered'),
  '40012': refused('invalid-number'),
  '40013': refused('invalid-sender'),
  '40100': refused('sender-cannot-text'),
  '40302': refused('body-too-long'),
  '40305': refused('invalid-sender'),
  '40306': refused('sender-name-refused'),
  '40307': refused('sender-name-refused'),
  '40309': refused('country-not-enabled'),
  '40310': refused('invalid-number'),
  '40312': refused('account-disabled'),
  '40314': refused('account-disabled'),
  '40315': refused('sender-cannot-text'),
  '40316': refused('body-empty'),
  '40321': refused('sender-cannot-text'),
  '40322': refused('content-blocked'),
  '40325': refused('sender-name-refused'),
  '40328': refused('body-too-long'),
  '40329': refused('sender-not-registered'),
  '40330': refused('sender-not-registered'),
  '40331': refused('country-not-enabled'),
  '40333': refused('spend-limit'),
};

function asTelnyx(credentials: SmsCredentials): TelnyxCredentials {
  if (credentials.provider !== 'telnyx') throw new TypeError('Telnyx was handed another provider\'s keys.');
  return credentials;
}

/** Every error code in a reply, as text. */
function codesOf(json: unknown): string[] {
  const errors = asRecord(json)?.['errors'];
  if (!Array.isArray(errors)) return [];
  return errors.flatMap((entry) => {
    const code = asRecord(entry)?.['code'];
    return typeof code === 'string' && /^\d{1,8}$/.test(code) ? [code] : typeof code === 'number' && Number.isInteger(code) ? [String(code)] : [];
  });
}

/** The code that decides: an opt-out first, since it must reach the stop list, then the first this layer knows. */
function decidingCode(codes: readonly string[]): { code: string; meaning: SmsCodeMeaning } | null {
  const code = codes.includes('40300') ? '40300' : codes.find((one) => TELNYX_CODES[one] !== undefined);
  const meaning = code === undefined ? undefined : TELNYX_CODES[code];
  return code === undefined || meaning === undefined ? null : { code, meaning };
}

/** The code a report is read by: an opt-out wherever it stands, else the first this layer knows, else the first. */
export function telnyxErrorCode(json: unknown): string | null {
  const codes = codesOf(json);
  return decidingCode(codes)?.code ?? codes[0] ?? null;
}

export const telnyxProvider: SmsProvider = {
  key: 'telnyx',
  timeoutRetry: 'same-key',

  async check(raw: SmsCredentials, context: SmsCallContext): Promise<SmsCheckResult> {
    const credentials = asTelnyx(raw);
    const call = await callProvider(context, {
      url: `${API}/messaging_profiles/${credentials.messagingProfileId}`,
      method: 'GET',
      headers: { authorization: `Bearer ${credentials.apiKey.reveal()}`, accept: 'application/json' },
    });
    if (call.kind !== 'answered') return { ok: false, reason: 'unreachable', providerCode: null };
    const providerCode = codesOf(call.json)[0] ?? null;
    if (call.status === 401 || call.status === 403) return { ok: false, reason: 'credentials-refused', providerCode };
    if (call.status === 404) return { ok: false, reason: 'profile-not-found', providerCode };
    if (call.status < 200 || call.status >= 300) return { ok: false, reason: 'unreachable', providerCode };
    const profile = asRecord(asRecord(call.json)?.['data']);
    if (profile === null || String(profile['id']).toLowerCase() !== credentials.messagingProfileId) return { ok: false, reason: 'unreachable', providerCode: null };
    if (profile['enabled'] === false) return { ok: false, reason: 'account-disabled', providerCode: null };
    return { ok: true, accountName: maskAccountName(profile['name']), accountType: null };
  },

  async senderProfile(raw: SmsCredentials, number: string, context: SmsCallContext): Promise<string | null> {
    const credentials = asTelnyx(raw);
    const query = new URLSearchParams({ 'filter[phone_number]': number, 'page[size]': '1' });
    const call = await callProvider(context, {
      url: `${API}/phone_numbers/messaging?${query.toString()}`,
      method: 'GET',
      headers: { authorization: `Bearer ${credentials.apiKey.reveal()}`, accept: 'application/json' },
    });
    if (call.kind !== 'answered' || call.status < 200 || call.status >= 300) return null;
    const rows: unknown = asRecord(call.json)?.['data'];
    if (!Array.isArray(rows)) return null;
    const row = rows.map((one) => asRecord(one)).find((one) => one?.['phone_number'] === number);
    const profile = row?.['messaging_profile_id'];
    return typeof profile === 'string' && profile !== '' ? profile.toLowerCase() : null;
  },

  async send(raw: SmsCredentials, message: SmsOutgoing, context): Promise<SmsProviderResult> {
    const credentials = asTelnyx(raw);
    const payload: Record<string, unknown> = { to: message.to, text: message.body, type: 'SMS' };
    // A number carries its own profile. A name and a pool are sent through the profile.
    if (message.sender.kind !== 'pool') payload['from'] = message.sender.value;
    if (message.sender.kind !== 'number') payload['messaging_profile_id'] = credentials.messagingProfileId;
    if (message.callbackUrl !== null) payload['webhook_url'] = message.callbackUrl;

    const call = await callProvider(context, {
      url: `${API}/messages`,
      method: 'POST',
      headers: {
        authorization: `Bearer ${credentials.apiKey.reveal()}`,
        accept: 'application/json',
        'content-type': 'application/json',
        'idempotency-key': message.idempotencyKey,
      },
      body: JSON.stringify(payload),
    });
    if (call.kind !== 'answered') return fromNoAnswer(telnyxProvider, call);

    const { status, json, headers } = call;
    if (status >= 200 && status < 300) {
      const data = asRecord(asRecord(json)?.['data']);
      const messageId = plainToken(data?.['id'], MESSAGE_ID);
      if (messageId === null) return unknownResult(telnyxProvider, 'unreadable-reply');
      const first = Array.isArray(data?.['to']) ? asRecord(data['to'][0]) : null;
      const cost = asRecord(data?.['cost']);
      return {
        outcome: 'accepted',
        provider: 'telnyx',
        messageId,
        status: plainToken(first?.['status'], STATUS_WORD),
        segments: segmentsOf(data?.['parts']),
        price: priceOf(cost?.['amount'], cost?.['currency']),
        replayed: headers.get('idempotent-replayed')?.toLowerCase() === 'true',
      };
    }

    const codes = codesOf(json);
    const firstCode = codes[0] ?? null;
    const retryAfter = retryAfterMs(headers, context.now);
    if (status === 409) return unknownResult(telnyxProvider, 'in-progress', firstCode);
    if (status === 429) return { outcome: 'not-taken', provider: 'telnyx', reason: 'rate-limited', retryAfterMs: retryAfter, providerCode: firstCode };
    if (status >= 400 && status < 500) {
      const decided = decidingCode(codes);
      if (decided !== null) return fromMeaning('telnyx', decided.meaning, decided.code, retryAfter);
      if (status === 422) return unknownResult(telnyxProvider, 'key-reused', firstCode, true);
      if (status === 401 || status === 403) return { outcome: 'refused', provider: 'telnyx', reason: 'credentials', detail: null, providerCode: firstCode };
      if (status === 413) return { outcome: 'refused', provider: 'telnyx', reason: 'body-too-long', detail: null, providerCode: firstCode };
      if (status === 400 || status === 404) return { outcome: 'refused', provider: 'telnyx', reason: 'provider-refused', detail: null, providerCode: firstCode };
    }
    return unknownResult(telnyxProvider, 'server-error', firstCode);
  },
};
