// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The commonest wrong pastes into a payment service's fields, caught before
 * anything is saved or sent.
 *
 * A shop owner copying keys out of a provider's dashboard pastes the wrong
 * one more often than a mistyped one: the secret key instead of the
 * restricted one, the publishable key, the webhook secret into the key field,
 * a live key into the test slot. Each gets one sentence of its own (the
 * dashboard words them by `code`, in every language), so the person knows
 * which key to fetch instead of reading "the key was refused".
 *
 * The rules are per field of the two first-party payment add-ons. Any other
 * provider's fields are only trimmed: its own Check says what is wrong.
 * Nothing here calls anyone and nothing here keeps the value.
 */
import type { PaymentMode } from '@adminium/add-on-contracts';

export const PASTE_REFUSALS = [
  /** A Stripe secret key (`sk_`): opens the whole account. */
  'SECRET_KEY',
  /** A Stripe publishable key (`pk_`): the commonest wrong paste. */
  'PUBLISHABLE_KEY',
  /** A webhook signing secret (`whsec_`) pasted where the key goes. */
  'WEBHOOK_SECRET_IN_KEY_FIELD',
  /** A key pasted where the webhook signing secret goes. */
  'KEY_IN_SECRET_FIELD',
  /** A live key in the test field. */
  'LIVE_KEY_IN_TEST_FIELD',
  /** A test key in the live field. */
  'TEST_KEY_IN_LIVE_FIELD',
  /** Not a restricted key at all. */
  'NOT_A_RESTRICTED_KEY',
  /** Not a webhook signing secret at all. */
  'NOT_A_SIGNING_SECRET',
  /** Spaces or line breaks inside the value (a pasted sentence, two keys). */
  'HAS_SPACES',
  /** Empty after trimming. */
  'EMPTY',
] as const;
export type PasteRefusal = (typeof PASTE_REFUSALS)[number];

export type PasteVerdict = { ok: true; value: string } | { ok: false; code: PasteRefusal };

const STRIPE = 'payments-stripe';

function stripeKey(value: string, mode: PaymentMode): PasteVerdict {
  if (value.startsWith('sk_')) return { ok: false, code: 'SECRET_KEY' };
  if (value.startsWith('pk_')) return { ok: false, code: 'PUBLISHABLE_KEY' };
  if (value.startsWith('whsec_')) return { ok: false, code: 'WEBHOOK_SECRET_IN_KEY_FIELD' };
  const match = /^rk_(test|live)_[A-Za-z0-9]{10,}$/.exec(value);
  if (match === null) return { ok: false, code: 'NOT_A_RESTRICTED_KEY' };
  if (match[1] === 'live' && mode === 'test') return { ok: false, code: 'LIVE_KEY_IN_TEST_FIELD' };
  if (match[1] === 'test' && mode === 'live') return { ok: false, code: 'TEST_KEY_IN_LIVE_FIELD' };
  return { ok: true, value };
}

function stripeSigningSecret(value: string): PasteVerdict {
  if (/^(?:sk|rk|pk)_(?:test|live)_/.test(value)) return { ok: false, code: 'KEY_IN_SECRET_FIELD' };
  if (!/^whsec_[A-Za-z0-9+/=]{10,}$/.test(value)) return { ok: false, code: 'NOT_A_SIGNING_SECRET' };
  return { ok: true, value };
}

/**
 * The value to save, trimmed, or the one reason it is refused.
 * `addOnKey` is the payment add-on's key; `field` its manifest setting key.
 */
export function checkPaste(addOnKey: string, field: string, mode: PaymentMode, raw: string): PasteVerdict {
  const value = raw.trim();
  if (value === '') return { ok: false, code: 'EMPTY' };
  if (/\s/.test(value)) return { ok: false, code: 'HAS_SPACES' };
  if (addOnKey === STRIPE && field === 'secret_key') return stripeKey(value, mode);
  if (addOnKey === STRIPE && field === 'webhook_secret') return stripeSigningSecret(value);
  return { ok: true, value };
}
