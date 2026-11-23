// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE HAND-OVER: one run of the `sms.send` job.
 *
 * ─── NEVER TWICE ────────────────────────────────────────────────────────────
 *
 * Before each call to the provider the marker is SAVED. So a worker that dies
 * mid-call leaves a row that says "this may have gone", and whoever picks the
 * job up next passes that as `earlier`. The SMS layer then refuses the call
 * unless the provider can de-duplicate it, under the same key and inside its
 * replay window. Twilio cannot, so a row that may have gone is never resent.
 *
 * Only a compare-and-set gets past the marker, so of two workers holding one
 * job, one calls the provider.
 *
 * Once a try may have gone, nothing later can prove it did not. A refusal or a
 * "not taken" on a retry says what happened to the RETRY, so such a message
 * ends `unknown`, never `refused`.
 *
 * ─── THE DAILY SLOT ─────────────────────────────────────────────────────────
 *
 * A message takes one slot, before its first try, and keeps it across retries.
 * The slot goes back only when the message CERTAINLY did not go: a rule stopped
 * it, the provider refused it, or every try was certainly not taken. It stays
 * used after `accepted`, after a provider's own `failed` (the provider had it,
 * and may bill it), and always after `unknown`.
 *
 * ─── WHAT IT WRITES WHERE ───────────────────────────────────────────────────
 *
 * Its result and every error it throws hold stable words only. The number and
 * the body stay in the sealed envelope.
 */
import type { EnqueueJobInput } from '@adminium/meta';

import type { TextConsentService } from '../consent/types.js';
import { accountRefOf } from '../credentials.js';
import { afterAttempt, type SmsEarlierAttempt, type SmsService } from '../service.js';
import type { SmsProviderKey } from '../types.js';
import { openText, SMS_SEND_ATTEMPTS, SMS_SEND_JOB_KIND, type SmsSendPayload } from './job.js';
import { dayKey, readTextPolicy, type TextSendPolicy } from './policy.js';
import { isFailedStatus, type TextSendStore } from './store.js';
import { TEXT_OPEN_STATES, type SealedText, type SmsSendOutcome, type TextDelivery, type TextDeliveryReason, type TextSendReport } from './types.js';
import { judgeWindow } from './window.js';

export interface TextLimitWarning {
  day: string;
  used: number;
  limit: number;
}

export interface HandOverDeps {
  sms: Pick<SmsService, 'send' | 'credentials'>;
  consent: Pick<TextConsentService, 'decide' | 'stop'>;
  store: TextSendStore;
  secret: string;
  /** The stored settings, as they are now. */
  policy: () => Promise<unknown>;
  /** Whether a STOP reply can reach this server. */
  repliesReachUs: () => boolean | Promise<boolean>;
  /** False on a trial or an operator's server where texts are off. */
  operatorAllows: () => boolean;
  enqueue: (job: EnqueueJobInput) => Promise<unknown>;
  /** Where delivery reports go. May read the stored public address. */
  callbackUrl?: (() => string | null | Promise<string | null>) | undefined;
  /**
   * Whether a reply or opt-out from this number is stored and not yet acted on.
   * It may be a STOP, so the text waits for it. The other half of "a STOP is
   * obeyed up to the last moment".
   */
  inboundWaiting?: ((e164: string) => Promise<boolean>) | undefined;
  /**
   * Whether the source row still wants this text, asked at the last moment: a
   * job can wait overnight for its window, and the visit may be called off or
   * the person erased meanwhile. Only for a delivery with a source row.
   */
  stillWanted?: ((report: TextSendReport, e164: string) => Promise<boolean>) | undefined;
  /** Tells the source row how its message ended, and of a later change. Must be safe to call twice. */
  onSettled?: ((report: TextSendReport, delivery: TextDelivery) => Promise<void>) | undefined;
  onLimitWarning?: ((warning: TextLimitWarning) => Promise<void> | void) | undefined;
  now?: (() => number) | undefined;
}

/** Thrown so the worker tries again later. Its message goes to the job row, so it holds a stable word and nothing else. */
export class TextRetryLater extends Error {
  override readonly name = 'TextRetryLater';
  constructor(reason: string) {
    super(`Text not sent yet: ${reason}`);
  }
}

/** The saved answer to "may an earlier try have gone?". A marker with no result is a yes. */
export function earlierOf(row: Pick<TextDelivery, 'state' | 'attemptStartedAt' | 'attemptAccount' | 'mayHaveGoneAt' | 'mayHaveGoneAccount'>): SmsEarlierAttempt | null {
  if (row.mayHaveGoneAt !== null) return { mayHaveGoneAt: row.mayHaveGoneAt, account: row.mayHaveGoneAccount };
  if (row.state === 'handing-over' && row.attemptStartedAt !== null) return { mayHaveGoneAt: row.attemptStartedAt, account: row.attemptAccount };
  return null;
}

/** Tells the source row what it is owed. A failure leaves it owed, for the sweep to try again. */
export async function tellSource(deps: Pick<HandOverDeps, 'store' | 'onSettled'>, row: TextDelivery): Promise<void> {
  if (row.settleOwedAt === null || row.reportTarget === null || deps.onSettled === undefined) return;
  try {
    await deps.onSettled(row.reportTarget, row);
    await deps.store.settlementWritten(row.id, row.settleOwedAt);
  } catch {
    // Still owed.
  }
}

export function createHandOver(deps: HandOverDeps) {
  const now = deps.now ?? Date.now;
  const { store } = deps;

  async function writeStop(row: TextDelivery, to: string): Promise<void> {
    await deps.consent.stop.add({ phone: to, reason: 'provider-opt-out', origin: row.provider });
    await store.stopWritten(row.id, now());
  }

  /** What is still owed once a row has ended: the stop list, then the source row. */
  async function afterEnd(row: TextDelivery, text: SealedText | null): Promise<SmsSendOutcome> {
    // Thrown on purpose when it fails: the job runs again, and this is all that run does.
    if (row.stopOwedAt !== null && text !== null) await writeStop(row, text.to);
    await tellSource(deps, row);
    // Nothing is left to do with the number and the words, so the job stops holding them. A failure here is the sweep's to mend.
    if (row.stopOwedAt === null || text !== null) await store.forgetSealed([row.id]).catch(() => 0);
    return { outcome: row.state as Extract<SmsSendOutcome, { reason: unknown }>['outcome'], reason: row.reason };
  }

  return async function handOver(payload: SmsSendPayload, ctx: { attempt: number; maxAttempts: number; signal: AbortSignal }): Promise<SmsSendOutcome> {
    const found = await store.byId(payload.deliveryId);
    if (found === null) {
      // Erased, perhaps while this job was being queued: it holds the number no longer than this.
      await store.forgetSealed([payload.deliveryId]).catch(() => 0);
      return { outcome: 'missing' };
    }
    let row: TextDelivery = found;
    const text = openText(payload.envelope, deps.secret);
    if (!TEXT_OPEN_STATES.includes(row.state)) return afterEnd(row, text);
    const earlier = earlierOf(row);

    /** It did not go on this run. If an earlier try may have, it ends unknown and keeps its slot. */
    const close = async (state: 'skipped' | 'refused' | 'not-sent', reason: TextDeliveryReason, more: { provider?: SmsProviderKey | null; stopOwed?: boolean } = {}): Promise<SmsSendOutcome> => {
      const at = now();
      const done = await store.settle(
        row.id,
        row.version,
        earlier === null
          ? { state, reason, at, clearMarker: true, releaseSlot: true, ...more }
          : { state: 'unknown', reason: 'earlier-attempt-unknown', at, clearMarker: true, mayHaveGone: { at: earlier.mayHaveGoneAt, account: earlier.account }, ...more },
      );
      return done === null ? { outcome: 'busy' } : afterEnd(done, text);
    };
    const cannotCheck = (): Promise<SmsSendOutcome> => {
      if (ctx.attempt < ctx.maxAttempts) throw new TextRetryLater('could-not-check');
      return close('not-sent', 'could-not-check');
    };

    if (text === null) return close('not-sent', 'envelope-unreadable');
    if (!deps.operatorAllows()) return close('skipped', 'off-by-operator');

    let policy: TextSendPolicy;
    try {
      policy = readTextPolicy(await deps.policy());
    } catch {
      return cannotCheck();
    }
    const checkedAt = now();
    const verdict = judgeWindow({ timing: text.timing, at: checkedAt, zone: text.zone, country: text.country, serviceHours: policy.serviceHours, notAfter: text.notAfter });
    if (!verdict.go) {
      if ('skip' in verdict) return close('skipped', verdict.skip);
      // A key of its own: this running job still holds the plain one.
      await deps.enqueue({ kind: SMS_SEND_JOB_KIND, payload, runAt: verdict.until, maxAttempts: SMS_SEND_ATTEMPTS, dedupeKey: `${SMS_SEND_JOB_KIND}:${row.id}:${String(verdict.until)}` });
      return { outcome: 'waiting', until: verdict.until };
    }

    if (row.slotDay === null) {
      const day = dayKey(checkedAt, policy.dayZone);
      const slot = await store.reserve(row.id, row.version, day, policy.dailyLimit, checkedAt);
      if (slot.outcome === 'lost') return { outcome: 'busy' };
      if (slot.outcome === 'full') return close('skipped', 'daily-limit');
      row = slot.row;
      if (slot.crossedWarning) {
        try {
          await deps.onLimitWarning?.({ day, used: slot.used, limit: policy.dailyLimit });
        } catch {
          // A warning that cannot be shown never stops a text.
        }
      }
    }

    // Asked again as late as it can be: a STOP may have come in since the text was prepared.
    let decision;
    try {
      decision = await deps.consent.decide({
        phone: text.to,
        country: text.country,
        class: text.textClass,
        // A pool can hold names, and only a number certainly takes a reply.
        sender: { kind: text.sender.kind === 'number' ? 'number' : 'name' },
        repliesReachUs: await deps.repliesReachUs(),
        person: text.person,
      });
    } catch {
      return cannotCheck();
    }
    if (!decision.send) return close('skipped', decision.reason);
    if (decision.optOut !== text.optOut) return close('skipped', 'opt-out-changed');
    if (row.reportTarget !== null && deps.stillWanted !== undefined) {
      let wanted: boolean;
      try {
        wanted = await deps.stillWanted(row.reportTarget, decision.e164);
      } catch {
        return cannotCheck();
      }
      if (!wanted) return close('skipped', 'no-longer-needed');
    }

    // A reply already stored and not yet read may be their STOP. It is read within moments, so this waits for it.
    let callbackUrl: string | null;
    try {
      if ((await deps.inboundWaiting?.(decision.e164)) === true) return await cannotCheck();
      callbackUrl = (await deps.callbackUrl?.()) ?? null;
    } catch (error) {
      if (error instanceof TextRetryLater) throw error;
      return cannotCheck();
    }

    const credentials = await deps.sms.credentials();
    const handedAt = now();
    const marked = await store.begin(row.id, row.version, { at: handedAt, account: credentials === null ? null : accountRefOf(credentials), earlier });
    if (marked === null) return { outcome: 'busy' };
    row = marked;

    // A throw here leaves the marker standing, which is right: nobody can say it did not go.
    const result = await deps.sms.send({
      to: decision.e164,
      body: text.body,
      idempotencyKey: row.id,
      sender: text.sender,
      callbackUrl,
      earlier,
      signal: ctx.signal,
    });

    // A job stopped by a person or a shutdown is not run again, so this run has to end it.
    const lastTry = ctx.attempt >= ctx.maxAttempts || ctx.signal.aborted;
    switch (result.outcome) {
      case 'accepted': {
        const done = await store.accept(row.id, {
          // A provider can answer 2xx and say in the body that it failed.
          state: isFailedStatus(result.status) ? 'provider-failed' : 'accepted',
          provider: result.provider,
          messageId: result.messageId,
          status: result.status,
          segments: result.segments,
          price: result.price,
          at: now(),
        });
        return done === null ? { outcome: 'busy' } : afterEnd(done, text);
      }
      case 'refused':
        return close('refused', result.reason, { provider: result.provider, stopOwed: result.reason === 'opted-out' && result.provider !== null });
      case 'not-taken': {
        if (lastTry) return close('not-sent', result.reason, { provider: result.provider });
        // Any earlier "may have gone" was saved with the marker, and stays.
        const saved = await store.settle(row.id, row.version, { state: 'retrying', reason: result.reason, at: now(), clearMarker: true, provider: result.provider });
        if (saved === null) return { outcome: 'busy' };
        throw new TextRetryLater(result.reason);
      }
      case 'unknown': {
        const mark = afterAttempt(earlier, result, handedAt) as SmsEarlierAttempt;
        const mayHaveGone = { at: mark.mayHaveGoneAt, account: mark.account };
        if (result.resend === 'same-key' && !lastTry) {
          const saved = await store.settle(row.id, row.version, { state: 'retrying', reason: result.reason, at: now(), clearMarker: true, provider: result.provider, mayHaveGone });
          if (saved === null) return { outcome: 'busy' };
          throw new TextRetryLater(result.reason);
        }
        const done = await store.settle(row.id, row.version, { state: 'unknown', reason: result.reason, at: now(), clearMarker: true, provider: result.provider, mayHaveGone });
        return done === null ? { outcome: 'busy' } : afterEnd(done, text);
      }
    }
  };
}
