// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A business's SMS provider keys: read from a paste, sealed, opened, and kept
 * out of everything else.
 *
 * Keys are sealed with the engine's own encryption under a key derived for
 * this purpose alone. Opened, a secret is an {@link SmsSecret}: it prints,
 * serialises and inspects as `[secret]`, so a stray log line or a reply built
 * from the wrong object shows nothing. Only the request to the provider asks
 * for the value.
 *
 * Twilio is held as Account SID + Auth Token, not an API key: the Auth Token is
 * what signs Twilio's webhooks, so it must be held anyway, and an API key
 * beside it would narrow nothing.
 *
 * Telnyx is held as API key + webhook public key + messaging profile. The
 * profile is required: it is what the check can name, and the stable identity
 * of the account.
 *
 * Identifiers that go into a provider's URL are matched exactly here, on the
 * paste AND on opening, so nothing stored can reshape a request path.
 */
import { createHash } from 'node:crypto';
import { inspect } from 'node:util';

import { z } from 'zod';

import { decryptSecret, deriveKey, encryptSecret } from '../config/secrets.js';
import { parsePhone } from '../phone/index.js';
import type { SmsProviderKey, SmsSender } from './types.js';

/** The purpose this key is derived for: its own. */
export const SMS_KEY_SALT = 'adminium:sms-credential:v1';

const HIDDEN = '[secret]';

/** A secret value that does not print. */
export class SmsSecret {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  /** The value, for the one request that needs it. */
  reveal(): string {
    return this.#value;
  }

  toString(): string {
    return HIDDEN;
  }

  toJSON(): string {
    return HIDDEN;
  }

  [inspect.custom](): string {
    return HIDDEN;
  }
}

export interface TwilioCredentials {
  provider: 'twilio';
  accountSid: string;
  authToken: SmsSecret;
}

export interface TelnyxCredentials {
  provider: 'telnyx';
  apiKey: SmsSecret;
  /** Telnyx's Ed25519 webhook key, base64. Public, and what an inbound webhook is verified against. */
  publicKey: string;
  messagingProfileId: string;
}

export type SmsCredentials = TwilioCredentials | TelnyxCredentials;

const ACCOUNT_SID = /^AC[0-9a-fA-F]{32}$/;
const KEY_SID = /^SK[0-9a-fA-F]{32}$/;
const SERVICE_SID = /^MG[0-9a-fA-F]{32}$/;
const PROFILE_ID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
/** Printable ASCII with no space: what can travel in an Authorization header. */
const KEY_TEXT = /^[\x21-\x7e]+$/;
/** 32 bytes of Ed25519 key in base64: 43 characters decode to exactly that. */
const PUBLIC_KEY = /^[A-Za-z0-9+/]{43}=?$/;
/** Up to 11 letters, digits and spaces, with at least one letter: the sender name both providers document. */
const SENDER_NAME = /^(?=.*[A-Za-z])[A-Za-z0-9 ]{1,11}$/;

const sealedSchema = z.discriminatedUnion('provider', [
  z.object({ provider: z.literal('twilio'), accountSid: z.string().regex(ACCOUNT_SID), authToken: z.string().regex(KEY_TEXT) }).strict(),
  z.object({ provider: z.literal('telnyx'), apiKey: z.string().regex(KEY_TEXT), publicKey: z.string().regex(PUBLIC_KEY), messagingProfileId: z.string().regex(PROFILE_ID) }).strict(),
]);

export function smsSecretKey(secret: string): Buffer {
  return deriveKey(secret, SMS_KEY_SALT);
}

export function sealCredentials(credentials: SmsCredentials, key: Uint8Array): string {
  const plain =
    credentials.provider === 'twilio'
      ? { provider: credentials.provider, accountSid: credentials.accountSid, authToken: credentials.authToken.reveal() }
      : { provider: credentials.provider, apiKey: credentials.apiKey.reveal(), publicKey: credentials.publicKey, messagingProfileId: credentials.messagingProfileId };
  return encryptSecret(JSON.stringify(plain), key);
}

/**
 * The keys in a sealed value, or null when it does not open (the server's
 * secret changed), holds anything unexpected, or is another provider's.
 */
export function openCredentials(sealed: string, provider: SmsProviderKey, key: Uint8Array): SmsCredentials | null {
  let parsed: z.infer<typeof sealedSchema>;
  try {
    parsed = sealedSchema.parse(JSON.parse(decryptSecret(sealed, key)));
  } catch {
    return null;
  }
  if (parsed.provider !== provider) return null;
  return parsed.provider === 'twilio'
    ? { provider: 'twilio', accountSid: parsed.accountSid, authToken: new SmsSecret(parsed.authToken) }
    : { provider: 'telnyx', apiKey: new SmsSecret(parsed.apiKey), publicKey: parsed.publicKey, messagingProfileId: parsed.messagingProfileId };
}

/** The commonest wrong pastes, each with its own code for the card to word. */
export const SMS_PASTE_REFUSALS = [
  'EMPTY',
  'HAS_SPACES',
  'NOT_AN_ACCOUNT_SID',
  /** A Twilio API key SID (`SK…`) where the Account SID goes. */
  'KEY_SID_IN_ACCOUNT_FIELD',
  /** The Account SID pasted into the token field too. */
  'SID_IN_TOKEN_FIELD',
  'NOT_A_KEY',
  'NOT_A_PROFILE_ID',
  'NOT_A_PUBLIC_KEY',
] as const;
export type SmsPasteRefusal = (typeof SMS_PASTE_REFUSALS)[number];

export type SmsCredentialInput =
  | { provider: 'twilio'; accountSid: string; authToken: string }
  | { provider: 'telnyx'; apiKey: string; publicKey: string; messagingProfileId: string };

export type SmsPasteVerdict = { ok: true; credentials: SmsCredentials } | { ok: false; field: string; code: SmsPasteRefusal };

function plainField(raw: string): { ok: true; value: string } | { ok: false; code: SmsPasteRefusal } {
  const value = raw.trim();
  if (value === '') return { ok: false, code: 'EMPTY' };
  if (/\s/.test(value)) return { ok: false, code: 'HAS_SPACES' };
  return { ok: true, value };
}

export function readCredentialInput(input: SmsCredentialInput): SmsPasteVerdict {
  const refuse = (field: string, code: SmsPasteRefusal): SmsPasteVerdict => ({ ok: false, field, code });
  if (input.provider === 'twilio') {
    const sid = plainField(input.accountSid);
    if (!sid.ok) return refuse('accountSid', sid.code);
    if (KEY_SID.test(sid.value)) return refuse('accountSid', 'KEY_SID_IN_ACCOUNT_FIELD');
    if (!ACCOUNT_SID.test(sid.value)) return refuse('accountSid', 'NOT_AN_ACCOUNT_SID');
    const token = plainField(input.authToken);
    if (!token.ok) return refuse('authToken', token.code);
    if (ACCOUNT_SID.test(token.value)) return refuse('authToken', 'SID_IN_TOKEN_FIELD');
    if (!KEY_TEXT.test(token.value) || token.value.length < 16 || token.value.length > 128) return refuse('authToken', 'NOT_A_KEY');
    return { ok: true, credentials: { provider: 'twilio', accountSid: sid.value, authToken: new SmsSecret(token.value) } };
  }
  const apiKey = plainField(input.apiKey);
  if (!apiKey.ok) return refuse('apiKey', apiKey.code);
  if (!KEY_TEXT.test(apiKey.value) || apiKey.value.length < 16 || apiKey.value.length > 512) return refuse('apiKey', 'NOT_A_KEY');
  const publicKey = plainField(input.publicKey);
  if (!publicKey.ok) return refuse('publicKey', publicKey.code);
  if (!PUBLIC_KEY.test(publicKey.value)) return refuse('publicKey', 'NOT_A_PUBLIC_KEY');
  const profile = plainField(input.messagingProfileId);
  if (!profile.ok) return refuse('messagingProfileId', profile.code);
  if (!PROFILE_ID.test(profile.value)) return refuse('messagingProfileId', 'NOT_A_PROFILE_ID');
  return {
    ok: true,
    credentials: {
      provider: 'telnyx',
      apiKey: new SmsSecret(apiKey.value),
      publicKey: Buffer.from(publicKey.value, 'base64').toString('base64'),
      messagingProfileId: profile.value.toLowerCase(),
    },
  };
}

/** The account these keys belong to, as an opaque reference: equal for the same account, and no identifier in it. */
export function accountRefOf(credentials: SmsCredentials): string {
  const identity = credentials.provider === 'twilio' ? `twilio:${credentials.accountSid}` : `telnyx:${credentials.messagingProfileId}`;
  return createHash('sha256').update(identity).digest('hex').slice(0, 32);
}

/** The last four characters of the account's identifier, for the card. */
export function accountHintOf(credentials: SmsCredentials): string {
  const id = credentials.provider === 'twilio' ? credentials.accountSid : credentials.messagingProfileId;
  return `…${id.slice(-4)}`;
}

/**
 * An account's name, masked. Twilio's name defaults to the owner's e-mail
 * address, so the plain name is never kept or shown.
 */
export function maskAccountName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const letters = Array.from(raw.replace(/\p{C}/gu, '').trim());
  if (letters.length === 0) return null;
  const first = letters[0] as string;
  if (letters.length <= 4) return `${first}•••`;
  if (letters.length < 8) return `${first}•••${letters.at(-1) as string}`;
  return `${letters.slice(0, 2).join('')}•••${letters.slice(-2).join('')}`;
}

export type SmsSenderRefusal = 'NOT_A_NUMBER' | 'NOT_A_NAME' | 'NOT_A_POOL';

/** A sender as typed, checked for this account. */
export function readSender(raw: SmsSender, credentials: SmsCredentials): { ok: true; sender: SmsSender } | { ok: false; code: SmsSenderRefusal } {
  const value = raw.value.trim();
  if (raw.kind === 'number') {
    const phone = parsePhone(value, null);
    if (!phone.ok || phone.extension !== null) return { ok: false, code: 'NOT_A_NUMBER' };
    return { ok: true, sender: { kind: 'number', value: phone.e164 } };
  }
  if (raw.kind === 'name') {
    if (!SENDER_NAME.test(value)) return { ok: false, code: 'NOT_A_NAME' };
    return { ok: true, sender: { kind: 'name', value } };
  }
  const pool = credentials.provider === 'twilio' ? SERVICE_SID.test(value) : value.toLowerCase() === credentials.messagingProfileId;
  if (!pool) return { ok: false, code: 'NOT_A_POOL' };
  return { ok: true, sender: { kind: 'pool', value: credentials.provider === 'twilio' ? value : credentials.messagingProfileId } };
}

/**
 * Whether a reply can reach this sender. A name never can, so it may not
 * say "Reply STOP" and may not send marketing. A pool can hold names as well as
 * numbers, and only the provider knows which: `depends` is not a yes.
 */
export function senderTakesReplies(sender: SmsSender): 'yes' | 'no' | 'depends' {
  if (sender.kind === 'number') return 'yes';
  return sender.kind === 'name' ? 'no' : 'depends';
}
