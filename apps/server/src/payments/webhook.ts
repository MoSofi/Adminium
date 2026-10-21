// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Receiving a payment service's webhook, and the settle job it queues.
 *
 * ─── THE RECEIVER ONLY RECEIVES ────────────────────────────────────────────
 *
 * A webhook proves that the provider sent something; it never says how a
 * payment stands. So the receiver:
 *
 *   1. refuses an unknown service or mode before any work (404), and answers
 *      503 for one that cannot check a signature right now (no key, not
 *      loaded), so the provider keeps the event and retries;
 *   2. checks the signature over the exact bytes received, and that the
 *      event's mode is the mode of the secret that verified it;
 *   3. matches the event to an attempt Adminium made (by the checkout, or by
 *      the money itself), and drops everything else with a 2xx (a provider
 *      sends every event on the account: the shop's other software, a
 *      staging install);
 *   4. stores the event once (a provider's retry and the sweep finding it
 *      too are the same row) and queues the settle job, which asks the
 *      provider for the status;
 *   5. answers at once. If the event cannot be stored it answers 5xx, and
 *      the provider tries again.
 *
 * A bad signature is counted (per service and mode, per hour), not audited
 * one row each: a burst of them is what the setup page warns about.
 *
 * ─── HEALTH ────────────────────────────────────────────────────────────────
 *
 * Every verified event, matched or not, proves the webhook reaches this
 * server: the first one ticks the setup checklist's webhook step, and the
 * last one is what "last event 2 minutes ago" reads.
 */
import { PAYMENT_MODES, isProviderError, type PaymentMode } from '@adminium/add-on-contracts';
import { isDuplicateKeyError, paymentAttemptsRepo, paymentCountersRepo, paymentEventsRepo, paymentSettingsRepo, refundsRepo, type MetaDb, type PaymentAttempt } from '@adminium/meta';
import { z } from 'zod';

import type { JobRegistry } from '../jobs/registry.js';
import type { CheckoutService } from './checkout.js';
import type { ProviderLookup } from './providers.js';
import { emptyServiceState, serviceDocName, serviceStateSchema } from './services.js';

export const PAYMENTS_SETTLE_JOB = 'payments.settle';
export const PAYMENTS_SETTLE_MAX_ATTEMPTS = 20;

export interface WebhookDeps {
  meta: MetaDb;
  providerFor: (key: string, mode: PaymentMode) => Promise<ProviderLookup>;
  enqueue: (input: { kind: string; payload: Record<string, unknown>; dedupeKey: string; maxAttempts: number }) => Promise<unknown>;
  now?: () => number;
}

export type WebhookOutcome =
  | { status: 200; matched: boolean }
  | { status: 400; reason: 'signature' | 'mode' | 'malformed' }
  | { status: 404 }
  | { status: 503 };

/** The health document for one service and mode. */
export function webhookDocName(key: string, mode: PaymentMode): string {
  return `webhook:${key}:${mode}`;
}

export const webhookHealthSchema = z
  .object({
    firstAt: z.number().int().nonnegative().nullable(),
    lastAt: z.number().int().nonnegative().nullable(),
    /** The last delivery whose signature did not verify. */
    lastBadAt: z.number().int().nonnegative().nullable(),
  })
  .strict();
export type WebhookHealth = z.infer<typeof webhookHealthSchema>;

const EMPTY_HEALTH: WebhookHealth = { firstAt: null, lastAt: null, lastBadAt: null };

/** Queues a settle for an attempt. A second queue for the same attempt while one waits is "already queued". */
export async function enqueueSettle(enqueue: WebhookDeps['enqueue'], attemptId: string, eventId: string | null): Promise<boolean> {
  try {
    await enqueue({
      kind: PAYMENTS_SETTLE_JOB,
      payload: { attemptId, ...(eventId === null ? {} : { eventId }) },
      dedupeKey: `payments-settle:${attemptId}`,
      maxAttempts: PAYMENTS_SETTLE_MAX_ATTEMPTS,
    });
    return true;
  } catch (error) {
    if (isDuplicateKeyError(error)) return false;
    throw error;
  }
}

async function noteHealth(meta: MetaDb, key: string, mode: PaymentMode, patch: Partial<WebhookHealth>, at: number): Promise<void> {
  // A partial patch over what is there; the whole document is written back.
  const docs = paymentSettingsRepo(meta);
  const current = (await docs.get(webhookDocName(key, mode), webhookHealthSchema)) ?? EMPTY_HEALTH;
  await docs.set(webhookDocName(key, mode), webhookHealthSchema, { ...current, ...patch }, at);
}

/** Receives one delivery. Never throws for something the provider sent. */
export async function receiveWebhook(
  deps: WebhookDeps,
  input: { provider: string; mode: string; rawBody: string; headers: Readonly<Record<string, string | undefined>> },
): Promise<WebhookOutcome> {
  const now = deps.now ?? (() => Date.now());
  if (!(PAYMENT_MODES as readonly string[]).includes(input.mode)) return { status: 404 };
  const mode = input.mode as PaymentMode;
  const lookup = await deps.providerFor(input.provider, mode);
  if (!lookup.ok) return lookup.code === 'NOT_INSTALLED' ? { status: 404 } : { status: 503 };

  const event = await lookup.provider.verifyWebhook({ rawBody: input.rawBody, headers: input.headers });
  if (isProviderError(event)) {
    if (event.code !== 'SIGNATURE_INVALID') return { status: 400, reason: 'malformed' };
    await paymentCountersRepo(deps.meta).hit(`webhook-bad:${input.provider}:${mode}`, now());
    await noteHealth(deps.meta, input.provider, mode, { lastBadAt: now() }, now());
    return { status: 400, reason: 'signature' };
  }
  // A test event verified with a live secret (or the reverse) is not believed.
  if (event.livemode !== (mode === 'live')) {
    await paymentCountersRepo(deps.meta).hit(`webhook-bad:${input.provider}:${mode}`, now());
    return { status: 400, reason: 'mode' };
  }

  // The webhook reaches this server: health first, matched or not.
  const at = now();
  const docs = paymentSettingsRepo(deps.meta);
  const health = (await docs.get(webhookDocName(input.provider, mode), webhookHealthSchema)) ?? EMPTY_HEALTH;
  await docs.set(webhookDocName(input.provider, mode), webhookHealthSchema, { ...health, firstAt: health.firstAt ?? at, lastAt: at }, at);
  const state = (await docs.get(serviceDocName(input.provider), serviceStateSchema)) ?? emptyServiceState();
  if (state[mode].firstEventAt === null) {
    await docs.set(serviceDocName(input.provider), serviceStateSchema, { ...state, [mode]: { ...state[mode], firstEventAt: at } }, at);
  }

  const attempts = paymentAttemptsRepo(deps.meta);
  let attempt: PaymentAttempt | null = null;
  if (event.checkoutRef !== null) attempt = await attempts.byProviderRef(input.provider, mode, event.checkoutRef);
  if (attempt === null && event.paymentRef !== null) attempt = await attempts.byPaymentRef(input.provider, mode, event.paymentRef);
  const refund = event.refundRef === null ? null : await refundsRepo(deps.meta).byProviderId(input.provider, mode, event.refundRef);
  if (attempt === null && refund === null) return { status: 200, matched: false };

  let stored;
  try {
    stored = await paymentEventsRepo(deps.meta).record(
      {
        provider: input.provider,
        mode,
        eventId: event.eventId,
        type: event.type,
        kind: event.kind,
        checkoutRef: event.checkoutRef,
        paymentRef: event.paymentRef,
        refundRef: event.refundRef,
        attemptId: attempt?.id ?? null,
        source: 'webhook',
        // The identity only: a body that never verified a status is not kept.
        body: null,
      },
      at,
    );
  } catch {
    return { status: 503 };
  }
  if (stored.fresh && attempt !== null) await enqueueSettle(deps.enqueue, attempt.id, stored.event.id);
  return { status: 200, matched: true };
}

const settlePayload = z.object({ attemptId: z.string().min(1), eventId: z.string().min(1).optional() });

/** The settle job: asks the provider how the attempt stands, then marks the event that queued it handled. */
export function registerPaymentsSettleHandler(registry: JobRegistry, deps: { meta: MetaDb; checkout: CheckoutService; now?: () => number }): void {
  registry.registerJobHandler(
    PAYMENTS_SETTLE_JOB,
    settlePayload,
    async (payload) => {
      const attempt = await deps.checkout.settle(payload.attemptId);
      if (payload.eventId !== undefined) await paymentEventsRepo(deps.meta).markProcessed(payload.eventId, (deps.now ?? Date.now)());
      return { state: attempt?.state ?? 'gone' };
    },
    { internal: true },
  );
}
