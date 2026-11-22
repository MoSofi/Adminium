// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The one shape every SMS provider has, and the parts of an answer that do not
 * depend on which provider gave it.
 */
import type { SmsCredentials } from './credentials.js';
import type { SmsCallContext, SmsCallResult } from './http.js';
import type {
  SmsCheckResult,
  SmsNotTakenReason,
  SmsOutgoing,
  SmsProviderKey,
  SmsProviderResult,
  SmsRefusalReason,
  SmsUnknown,
  SmsUnknownReason,
  TimeoutRetry,
} from './types.js';

export interface SmsProvider {
  readonly key: SmsProviderKey;
  /** What may be done after a timeout. The layer enforces it; a caller cannot widen it. */
  readonly timeoutRetry: TimeoutRetry;
  /** Asks the provider whether these keys work and whose they are. Sends nothing. */
  check(credentials: SmsCredentials, context: SmsCallContext): Promise<SmsCheckResult>;
  /** The profile the provider holds this number on; null when it cannot say. Only a provider with profiles has this. */
  senderProfile?(credentials: SmsCredentials, number: string, context: SmsCallContext): Promise<string | null>;
  send(credentials: SmsCredentials, message: SmsOutgoing, context: SmsCallContext & { now: number }): Promise<SmsProviderResult>;
}

/** What a provider's error code means: still safe to retry, or refused. */
export type SmsCodeMeaning = { kind: 'not-taken'; reason: SmsNotTakenReason } | { kind: 'refused'; reason: SmsRefusalReason };

export const notTaken = (reason: SmsNotTakenReason): SmsCodeMeaning => ({ kind: 'not-taken', reason });
export const refused = (reason: SmsRefusalReason): SmsCodeMeaning => ({ kind: 'refused', reason });

/** An answer of `unknown`, with the only `resend` this provider allows. */
export function unknownResult(provider: SmsProvider, reason: SmsUnknownReason, providerCode: string | null = null, forceCheck = false): SmsUnknown {
  return {
    outcome: 'unknown',
    provider: provider.key,
    reason,
    resend: provider.timeoutRetry === 'same-key' && !forceCheck ? 'same-key' : 'check-first',
    providerCode,
  };
}

/** A code's meaning as a send result. */
export function fromMeaning(provider: SmsProviderKey, meaning: SmsCodeMeaning, providerCode: string | null, retryAfter: number | null): SmsProviderResult {
  return meaning.kind === 'not-taken'
    ? { outcome: 'not-taken', provider, reason: meaning.reason, retryAfterMs: retryAfter, providerCode }
    : { outcome: 'refused', provider, reason: meaning.reason, detail: null, providerCode };
}

/** The three ways a call ends with no answer from the provider. */
export function fromNoAnswer(provider: SmsProvider, call: Exclude<SmsCallResult, { kind: 'answered' }>): SmsProviderResult {
  if (call.kind === 'no-connection') return { outcome: 'not-taken', provider: provider.key, reason: 'no-connection', retryAfterMs: null, providerCode: null };
  if (call.kind === 'cancelled') return { outcome: 'not-taken', provider: provider.key, reason: 'cancelled', retryAfterMs: null, providerCode: null };
  return unknownResult(provider, call.reason);
}
