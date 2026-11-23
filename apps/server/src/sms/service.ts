// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The SMS layer: the connected account, and the one way a text leaves.
 *
 * The send path calls {@link SmsService.send}, the inbound route reads
 * {@link SmsService.credentials}, and the settings routes call the rest.
 *
 * ─── THE RESEND RULE LIVES HERE, NOT IN THE CALLER ─────────────────────────
 *
 * A caller retrying a message passes its marker (`earlier`, see
 * {@link afterAttempt}). When an earlier try may have gone, this refuses to call
 * a provider unless the provider can de-duplicate it: same provider account,
 * inside the replay window. So a retry loop that keeps its marker cannot send a
 * text twice.
 *
 * ─── WHAT IS NEVER KEPT ─────────────────────────────────────────────────────
 *
 * The body is handed to the provider and appears in no result, row or error.
 * Nothing in this folder logs.
 */
import { randomUUID } from 'node:crypto';

import { ConflictError, RateLimitedError, ValidationFailedError } from '../errors.js';
import { parsePhone } from '../phone/index.js';
import {
  accountHintOf,
  accountRefOf,
  openCredentials,
  readCredentialInput,
  readSender,
  sealCredentials,
  senderTakesReplies,
  smsSecretKey,
  type SmsCredentialInput,
  type SmsCredentials,
} from './credentials.js';
import { checkDestination } from './destination.js';
import { SMS_CALL_TIMEOUT_MS, type SmsCallContext } from './http.js';
import type { SmsProvider } from './provider.js';
import type { SmsAccountFields, SmsAccountRow, SmsAccountStore, SmsCheckRecord } from './store.js';
import { telnyxProvider } from './telnyx.js';
import { twilioProvider } from './twilio.js';
import type { SmsProviderKey, SmsProviderResult, SmsRefusalReason, SmsSender, SmsSendResult, SmsUnknownReason, TimeoutRetry } from './types.js';

export const SMS_PROVIDER_ADAPTERS: Readonly<Record<SmsProviderKey, SmsProvider>> = { twilio: twilioProvider, telnyx: telnyxProvider };

/** Twilio's limit on a body, and so this layer's for both. */
export const SMS_MAX_BODY = 1600;
/** Telnyx replays for 24 hours. An hour is kept in hand for clocks that disagree. */
export const SMS_SAME_KEY_WINDOW_MS = 23 * 60 * 60 * 1000;
/** Each test text costs the business money. */
export const SMS_TEST_LIMIT = 5;
export const SMS_TEST_WINDOW_MS = 10 * 60 * 1000;
/** Fixed, so the test route cannot be used to send anything else. */
export const SMS_TEST_BODY = 'Test text from Adminium. Your text message connection works.';

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{1,255}$/;

/** The stop list, as this layer needs it. Required: a test text must never reach someone who said STOP. */
export interface SmsStopList {
  isStopped(e164: string): Promise<boolean>;
  /** The provider said this person opted out. */
  recordProviderOptOut(entry: { e164: string; provider: SmsProviderKey }): Promise<void>;
}

/**
 * What a send job's hand-over marker keeps between tries at one message. Build it with
 * {@link afterAttempt}: once a try may have gone, that stays true through any
 * later answer, and the replay window keeps counting from that first try.
 */
export interface SmsEarlierAttempt {
  /** When the first try that may have gone was handed over. */
  mayHaveGoneAt: number;
  /** `account` from that try's result: a key means nothing at another account. */
  account: string | null;
}

/**
 * The marker after a try. `at` is the time just BEFORE that try was handed
 * over, so the replay window is never measured short. A try that certainly was
 * not taken leaves no mark: Telnyx does not replay failures.
 */
export function afterAttempt(earlier: SmsEarlierAttempt | null, result: Pick<SmsServiceResult, 'outcome' | 'account'>, at: number): SmsEarlierAttempt | null {
  if (earlier !== null) return earlier;
  return result.outcome === 'unknown' ? { mayHaveGoneAt: at, account: result.account } : null;
}

export interface SmsSendRequest {
  /** As stored or typed. It is read here, and only the exact number goes on. */
  to: unknown;
  body: string;
  /** Stable across retries of one message (the send job's hand-over marker). Holds nothing personal. */
  idempotencyKey: string;
  /** A workspace's own sender; the account's when absent. */
  sender?: SmsSender | undefined;
  /** Where delivery reports go, https. */
  callbackUrl?: string | null | undefined;
  earlier?: SmsEarlierAttempt | null | undefined;
  signal?: AbortSignal | undefined;
}

/** A send's answer, and which account it was tried at. */
export type SmsServiceResult = SmsSendResult & { account: string | null };

export interface SmsAccountView {
  provider: SmsProviderKey;
  accountName: string | null;
  accountHint: string;
  accountType: 'full' | 'trial' | null;
  /** False when the server's secret changed: the key must be pasted again. */
  keyReadable: boolean;
  sender: SmsSender | null;
  senderTakesReplies: 'yes' | 'no' | 'depends' | null;
  defaultCountry: string | null;
  check: SmsCheckRecord;
  savedAt: number;
  timeoutRetry: TimeoutRetry;
}

export interface SmsConnectResult {
  view: SmsAccountView;
  /** An account was here before. */
  replaced: boolean;
  /** The new key belongs to another account, so texts bill somewhere else. */
  accountChanged: boolean;
}

export interface SmsServiceDeps {
  store: SmsAccountStore;
  /** `ADMINIUM_SECRET`. */
  secret: string;
  stopList: SmsStopList;
  /** The server's own default country, for an account that has not chosen one. */
  defaultCountry?: (() => Promise<string | null>) | undefined;
  fetch?: typeof globalThis.fetch | undefined;
  now?: (() => number) | undefined;
  timeoutMs?: number | undefined;
}

export interface SmsService {
  view(): Promise<SmsAccountView | null>;
  connect(input: SmsCredentialInput, by: string | null): Promise<SmsConnectResult>;
  setSending(input: { sender: SmsSender; defaultCountry: string | null }, by: string | null): Promise<SmsAccountView>;
  recheck(): Promise<SmsAccountView>;
  disconnect(): Promise<boolean>;
  send(request: SmsSendRequest): Promise<SmsServiceResult>;
  sendTest(to: unknown): Promise<SmsServiceResult>;
  /** The opened keys, for checking inbound signatures; null when none are connected or they do not open. */
  credentials(): Promise<SmsCredentials | null>;
}

function validCallback(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.username === '' && parsed.password === '' && !parsed.hostname.includes('_');
  } catch {
    return false;
  }
}

function validCountry(country: string): boolean {
  // Any valid number: only the country argument is being asked about.
  const answer = parsePhone('+14155552671', country);
  return /^[A-Z]{2}$/.test(country) && (answer.ok || answer.reason !== 'bad-country');
}

export function createSmsService(deps: SmsServiceDeps): SmsService {
  const key = smsSecretKey(deps.secret);
  const now = deps.now ?? Date.now;
  const fetchImpl = (): typeof globalThis.fetch => deps.fetch ?? globalThis.fetch;
  const context = (signal?: AbortSignal): SmsCallContext => ({ fetch: fetchImpl(), timeoutMs: deps.timeoutMs ?? SMS_CALL_TIMEOUT_MS, signal });
  let testSends: number[] = [];

  const opened = (row: SmsAccountRow): SmsCredentials | null => openCredentials(row.sealedCredentials, row.provider, key);

  /** The account's own choice, then the server's. */
  const countryOf = async (row: SmsAccountRow | null): Promise<string | null> => row?.defaultCountry ?? (await deps.defaultCountry?.()) ?? null;

  async function viewOf(row: SmsAccountRow): Promise<SmsAccountView> {
    return {
      provider: row.provider,
      accountName: row.accountName,
      accountHint: row.accountHint,
      accountType: row.accountType,
      keyReadable: opened(row) !== null,
      sender: row.sender,
      senderTakesReplies: row.sender === null ? null : senderTakesReplies(row.sender),
      defaultCountry: await countryOf(row),
      check: row.check,
      savedAt: row.savedAt,
      timeoutRetry: SMS_PROVIDER_ADAPTERS[row.provider].timeoutRetry,
    };
  }

  const fieldsOf = (row: SmsAccountRow): SmsAccountFields => {
    const { revision: _revision, ...fields } = row;
    return fields;
  };

  function changedWhileChecking(): ConflictError {
    return new ConflictError('The text message settings changed while this was being checked. Look again and retry.');
  }

  const refusedResult = (reason: SmsRefusalReason, to: string | null, extra: { provider?: SmsProviderKey | null; detail?: string | null; account?: string | null } = {}): SmsServiceResult => ({
    outcome: 'refused',
    provider: extra.provider ?? null,
    reason,
    detail: extra.detail ?? null,
    providerCode: null,
    to,
    account: extra.account ?? null,
  });

  /** Why a retry may not reach the provider; null when it may. */
  function blockedResend(provider: SmsProvider, account: string, earlier: SmsEarlierAttempt | null | undefined): SmsUnknownReason | null {
    if (earlier === null || earlier === undefined) return null;
    if (provider.timeoutRetry !== 'same-key' || earlier.account !== account) return 'earlier-attempt-unknown';
    const age = now() - earlier.mayHaveGoneAt;
    return age < 0 || age >= SMS_SAME_KEY_WINDOW_MS ? 'replay-window-passed' : null;
  }

  async function send(request: SmsSendRequest): Promise<SmsServiceResult> {
    if (typeof request.body !== 'string' || request.body.trim() === '') return refusedResult('body-empty', null);
    if (request.body.length > SMS_MAX_BODY) return refusedResult('body-too-long', null);
    if (!IDEMPOTENCY_KEY.test(request.idempotencyKey)) return refusedResult('bad-request', null);
    const callbackUrl = request.callbackUrl ?? null;
    if (callbackUrl !== null && !validCallback(callbackUrl)) return refusedResult('bad-request', null);

    const row = await deps.store.read();
    const destination = checkDestination(request.to, await countryOf(row));
    if (!destination.ok) return refusedResult(destination.reason, destination.e164, { detail: destination.detail });
    const to = destination.phone.e164;

    if (row === null) return refusedResult('not-connected', to);
    const credentials = opened(row);
    if (credentials === null) return refusedResult('not-connected', to, { provider: row.provider });
    const provider = SMS_PROVIDER_ADAPTERS[row.provider];
    const account = accountRefOf(credentials);

    let sender = row.sender;
    if (request.sender !== undefined) {
      const read = readSender(request.sender, credentials);
      if (!read.ok) return refusedResult('invalid-sender', to, { provider: row.provider, account });
      sender = read.sender;
    }
    if (sender === null) return refusedResult('no-sender', to, { provider: row.provider, account });

    const blocked = blockedResend(provider, account, request.earlier);
    if (blocked !== null) {
      return { outcome: 'unknown', provider: provider.key, reason: blocked, resend: 'check-first', providerCode: null, to, account };
    }

    const result: SmsProviderResult = await provider.send(
      credentials,
      { to, sender, body: request.body, idempotencyKey: request.idempotencyKey, callbackUrl },
      { ...context(request.signal), now: now() },
    );
    return { ...result, to, account };
  }

  return {
    async view() {
      const row = await deps.store.read();
      return row === null ? null : await viewOf(row);
    },

    async connect(input, by) {
      const pasted = readCredentialInput(input);
      if (!pasted.ok) throw new ValidationFailedError('That value cannot be saved in this field.', { reason: pasted.code, field: pasted.field });
      const before = await deps.store.read();
      const checked = await SMS_PROVIDER_ADAPTERS[pasted.credentials.provider].check(pasted.credentials, context());
      // A key the provider did not vouch for is never saved, and the one already here stays.
      if (!checked.ok) throw new ValidationFailedError('The provider did not accept these keys.', { reason: checked.reason, providerCode: checked.providerCode });

      const previous = before === null ? null : opened(before);
      const sameAccount = previous !== null && accountRefOf(previous) === accountRefOf(pasted.credentials);
      const at = now();
      const row = await deps.store.write(
        {
          provider: pasted.credentials.provider,
          sealedCredentials: sealCredentials(pasted.credentials, key),
          accountName: checked.accountName,
          accountHint: accountHintOf(pasted.credentials),
          accountType: checked.accountType,
          // A sender belongs to its account: it does not follow the key to another one.
          sender: sameAccount ? (before?.sender ?? null) : null,
          defaultCountry: before?.defaultCountry ?? null,
          check: { ok: true, reason: null, at },
          savedAt: at,
          savedBy: by,
        },
        before?.revision ?? null,
      );
      if (row === null) throw changedWhileChecking();
      return { view: await viewOf(row), replaced: before !== null, accountChanged: before !== null && !sameAccount };
    },

    async setSending(input, by) {
      const row = await deps.store.read();
      const credentials = row === null ? null : opened(row);
      if (row === null || credentials === null) throw new ValidationFailedError('Connect a text message provider first.', { reason: 'not-connected' });
      const sender = readSender(input.sender, credentials);
      if (!sender.ok) throw new ValidationFailedError('That sender cannot be used.', { reason: sender.code });
      if (input.defaultCountry !== null && !validCountry(input.defaultCountry)) throw new ValidationFailedError('That is not a country code.', { reason: 'BAD_COUNTRY' });
      if (credentials.provider === 'telnyx' && sender.sender.kind === 'number') {
        // Its replies would carry another profile's id. Refused only when the provider says so: it may not be able to.
        const held = (await SMS_PROVIDER_ADAPTERS.telnyx.senderProfile?.(credentials, sender.sender.value, context())) ?? null;
        if (held !== null && held !== credentials.messagingProfileId) throw new ValidationFailedError('That number is on another messaging profile. Move it to this profile, or connect that one.', { reason: 'SENDER_OTHER_PROFILE' });
      }
      const next = await deps.store.write({ ...fieldsOf(row), sender: sender.sender, defaultCountry: input.defaultCountry, savedAt: now(), savedBy: by }, row.revision);
      if (next === null) throw changedWhileChecking();
      return await viewOf(next);
    },

    async recheck() {
      const row = await deps.store.read();
      const credentials = row === null ? null : opened(row);
      if (row === null || credentials === null) throw new ValidationFailedError('Connect a text message provider first.', { reason: 'not-connected' });
      const checked = await SMS_PROVIDER_ADAPTERS[row.provider].check(credentials, context());
      const at = now();
      const fields: SmsAccountFields = checked.ok
        ? { ...fieldsOf(row), accountName: checked.accountName, accountType: checked.accountType, check: { ok: true, reason: null, at } }
        : { ...fieldsOf(row), check: { ok: false, reason: checked.reason, at } };
      const next = await deps.store.write(fields, row.revision);
      if (next === null) throw changedWhileChecking();
      return await viewOf(next);
    },

    async disconnect() {
      const row = await deps.store.read();
      if (row === null) return false;
      if (!(await deps.store.remove(row.revision))) throw changedWhileChecking();
      return true;
    },

    send,

    async sendTest(to) {
      const row = await deps.store.read();
      const destination = checkDestination(to, await countryOf(row));
      if (!destination.ok) return refusedResult(destination.reason, destination.e164, { detail: destination.detail });
      const e164 = destination.phone.e164;
      if (row === null) return refusedResult('not-connected', e164);
      if (await deps.stopList.isStopped(e164)) return refusedResult('opted-out', e164, { provider: row.provider });

      const at = now();
      testSends = testSends.filter((one) => at - one < SMS_TEST_WINDOW_MS);
      if (testSends.length >= SMS_TEST_LIMIT) throw new RateLimitedError('Too many test texts. Try again in a few minutes.', { reason: 'test-limit' });
      testSends.push(at);

      const result = await send({ to: e164, body: SMS_TEST_BODY, idempotencyKey: randomUUID() });
      if (result.outcome === 'refused' && result.reason === 'opted-out' && result.provider !== null) {
        await deps.stopList.recordProviderOptOut({ e164, provider: result.provider });
      }
      return result;
    },

    async credentials() {
      const row = await deps.store.read();
      return row === null ? null : opened(row);
    },
  };
}
