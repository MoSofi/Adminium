// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Watching payments for what a person must hear about, and checking that
 * recorded payments are still there.
 *
 * ─── THE WATCH (every five minutes) ────────────────────────────────────────
 *
 * Reads what happened and tells every payment manager once (`notices.ts`):
 *   - a live payment recorded in the last two hours: "Payment received";
 *   - a live payment that needs a look (not recorded, not the amount asked,
 *     after a void, twice, in the other mode, its recorded row missing), not
 *     checked yet, from the last week;
 *   - a live payment taken more than 30 minutes ago and still not recorded;
 *   - a service whose key was refused, in the mode it takes payments in;
 *   - a live service that made payments in the last day while no webhook
 *     reached the server for a day ("silent"), once a day;
 *   - a service and mode whose sweep slowed this month (half the provider's
 *     read allowance used), once a month.
 * Test and demo payments tell nobody: staff made them, and are looking.
 *
 * ─── THE INTEGRITY CHECK (daily) ───────────────────────────────────────────
 *
 * Every live payment recorded in the last 30 days: is its row still there,
 * for the amount taken (kept by Adminium: still there and not voided)? A
 * shop's database restored to an older point loses rows Adminium recorded;
 * each one missing is flagged for Activity (`RECORD_MISSING`) and told. It
 * only reads the shop's tables. A table it cannot read now is skipped, never
 * flagged.
 */
import { DEMO_PAYMENT_KEY, sameAmount, type PaymentMode } from '@adminium/add-on-contracts';
import { currencyScale } from '@adminium/manifest';
import { keptPaymentsRepo, paymentAttemptsRepo, paymentSettingsRepo, type MetaDb, type PaymentAttempt } from '@adminium/meta';

import type { Row } from '../crud/mask.js';
import type { NotificationPublisher } from '../notifications/notify.js';
import { noticeDay, noticeMoney, providerName, tellPaymentManagers, type NoticeWords } from './notices.js';
import { exactAmount, fromMinorUnits, resolvePayable, type PayableSources } from './payables.js';
import { sweepDocName, sweepStateSchema } from './sweep.js';
import { serviceDocName, serviceStateSchema, emptyServiceState } from './services.js';
import { webhookDocName, webhookHealthSchema } from './webhook.js';

export const PAYMENTS_WATCH_NAME = 'payments-watch';
export const PAYMENTS_WATCH_CRON = '*/5 * * * *';
export const PAYMENTS_INTEGRITY_NAME = 'payments-integrity';
/** Daily, at a quiet minute. */
export const PAYMENTS_INTEGRITY_CRON = '17 4 * * *';

/** A taken payment not recorded after this long is told. */
export const UNRECORDED_AFTER_MS = 30 * 60_000;
/** A live service with payments but no webhook for this long is "silent". */
export const SILENT_AFTER_MS = 24 * 3_600_000;
/** How far back the integrity check looks. */
export const INTEGRITY_DAYS = 30;

const DAY_MS = 86_400_000;

export interface WatchDeps {
  meta: MetaDb;
  sources: PayableSources;
  /** The installed payment add-ons' keys. */
  serviceKeys: () => Promise<string[]>;
  hub?: NotificationPublisher;
  now?: () => number;
}

export interface WatchResult {
  landed: number;
  looks: number;
  unrecorded: number;
  keys: number;
  silent: number;
  reads: number;
}

function told(count: number): number {
  return count > 0 ? 1 : 0;
}

/** The words of a "needs a look" notice, by what went wrong. */
export function lookWords(attempt: PaymentAttempt): (locale: string) => NoticeWords {
  const code = attempt.problem?.code ?? '';
  const kind =
    code === 'AMOUNT_DIFFERS' || code === 'CURRENCY_DIFFERS' || code === 'MORE_THAN_DUE'
      ? { key: 'look.amount', fallback: 'Paid at {provider}, not the amount asked: {label}' }
      : code === 'VOIDED' || code === 'GONE'
        ? { key: 'look.voided', fallback: 'Paid at {provider} after it was voided: {label}' }
        : code === 'MODE_MISMATCH'
          ? { key: 'look.mode', fallback: 'Paid at {provider} in the other mode, not believed: {label}' }
          : code === 'TWO_AT_ONCE'
            ? { key: 'look.twice', fallback: 'Paid twice at {provider}: {label}' }
            : code === 'RECORD_MISSING'
              ? { key: 'look.missing', fallback: 'Its recorded payment is no longer there: {label}' }
              : { key: 'look.notRecorded', fallback: 'Paid at {provider}, not recorded: {label}' };
  return () => ({ title: { key: 'look.title', fallback: 'A payment needs a look' }, body: kind, values: { provider: providerName(attempt.provider), label: attempt.payableLabel } });
}

async function recentlyRecorded(meta: MetaDb, since: number): Promise<PaymentAttempt[]> {
  const ids = await meta.db
    .selectFrom('adminium_payment_attempts')
    .select('id')
    .where('state', '=', 'recorded')
    .where('mode', '=', 'live')
    .where('recordedAt', '>=', since)
    .orderBy('recordedAt', 'desc')
    .limit(500)
    .execute();
  const out: PaymentAttempt[] = [];
  for (const { id } of ids) {
    const attempt = await paymentAttemptsRepo(meta).byId(id);
    if (attempt !== null) out.push(attempt);
  }
  return out;
}

/** One watch run. Never throws for one thing it could not tell; the next run tries again. */
export async function runPaymentWatch(deps: WatchDeps): Promise<WatchResult> {
  const at = (deps.now ?? Date.now)();
  const notices = { meta: deps.meta, now: () => at, ...(deps.hub === undefined ? {} : { hub: deps.hub }) };
  const attempts = paymentAttemptsRepo(deps.meta);
  const result: WatchResult = { landed: 0, looks: 0, unrecorded: 0, keys: 0, silent: 0, reads: 0 };

  // A payment received.
  for (const attempt of await recentlyRecorded(deps.meta, at - 2 * 3_600_000)) {
    if (attempt.provider === DEMO_PAYMENT_KEY) continue;
    const paidWith = (attempt.paidWith as { label?: string } | null)?.label ?? null;
    result.landed += told(
      await tellPaymentManagers(notices, {
        kind: 'payments.landed',
        about: `landed:${attempt.id}`,
        words: (locale) => ({
          title: { key: 'landed.title', fallback: 'Payment received' },
          body: paidWith === null ? { key: 'landed.body', fallback: '{amount} for {label}' } : { key: 'landed.bodyWith', fallback: '{amount} for {label} by {paidWith}' },
          values: { amount: noticeMoney(attempt.takenAmount ?? attempt.amount, attempt.takenCurrency ?? attempt.currency, locale), label: attempt.payableLabel, paidWith: paidWith ?? '' },
        }),
      }),
    );
  }

  // A payment that needs a look.
  for (const attempt of await attempts.needingLook({ mode: 'live', limit: 200 })) {
    if (attempt.provider === DEMO_PAYMENT_KEY || attempt.updatedAt < at - 7 * DAY_MS) continue;
    result.looks += told(await tellPaymentManagers(notices, { kind: 'payments.needs-look', about: `look:${attempt.id}:${attempt.problem?.code ?? 'flag'}`, urgent: true, words: lookWords(attempt) }));
  }

  // Taken, and still not recorded.
  for (const attempt of await attempts.stale(['succeeded', 'recording'], at - UNRECORDED_AFTER_MS, 200)) {
    if (attempt.mode !== 'live' || attempt.provider === DEMO_PAYMENT_KEY) continue;
    result.unrecorded += told(
      await tellPaymentManagers(notices, {
        kind: 'payments.needs-look',
        about: `unrecorded:${attempt.id}`,
        words: () => ({ title: { key: 'look.title', fallback: 'A payment needs a look' }, body: { key: 'look.notYet', fallback: 'Paid at {provider}, not recorded yet: {label}' }, values: { provider: providerName(attempt.provider), label: attempt.payableLabel } }),
      }),
    );
  }

  const docs = paymentSettingsRepo(deps.meta);
  for (const key of await deps.serviceKeys()) {
    const state = (await docs.get(serviceDocName(key), serviceStateSchema)) ?? emptyServiceState();
    const mode: PaymentMode = state.liveOn ? 'live' : 'test';
    const check = state[mode].check;
    const name = providerName(key);

    // A refused key: payments are paused.
    if (check !== null && !check.ok && (check.code === 'CREDENTIALS_REFUSED' || check.code === 'PERMISSION_MISSING')) {
      result.keys += told(
        await tellPaymentManagers(notices, {
          kind: 'payments.key-refused',
          about: `key:${key}:${mode}:${String(check.at)}`,
          urgent: true,
          words: () => ({ title: { key: 'key.title', fallback: '{provider} refused the key' }, body: { key: 'key.body', fallback: 'Payments are paused until a working key is saved.' }, values: { provider: name } }),
        }),
      );
    }

    // A silent webhook: live payments in the last day, and no event for a day.
    if (state.liveOn) {
      const hook = await docs.get(webhookDocName(key, 'live'), webhookHealthSchema);
      const quietSince = hook?.lastAt ?? null;
      if (quietSince === null || quietSince < at - SILENT_AFTER_MS) {
        const made = await deps.meta.db
          .selectFrom('adminium_payment_attempts')
          .select((eb) => eb.fn.countAll<number>().as('n'))
          .where('provider', '=', key)
          .where('mode', '=', 'live')
          .where('createdAt', '>=', at - SILENT_AFTER_MS)
          .where('createdAt', '<', at - 3_600_000)
          .executeTakeFirst();
        if (Number(made?.n ?? 0) > 0) {
          result.silent += told(
            await tellPaymentManagers(notices, {
              kind: 'payments.webhook',
              about: `webhook:${key}:${new Date(at).toISOString().slice(0, 10)}`,
              words: (locale) => ({
                title: { key: 'webhook.title', fallback: 'The {provider} webhook is silent' },
                body: quietSince === null ? { key: 'webhook.bodyNever', fallback: 'No live event has arrived yet. Payments are found by asking, more slowly.' } : { key: 'webhook.body', fallback: 'No event since {date}. Payments are found by asking, more slowly.' },
                values: { provider: name, date: quietSince === null ? '' : noticeDay(quietSince, locale) },
              }),
            }),
          );
        }
      }
    }

    // The sweep's read allowance.
    for (const one of ['test', 'live'] as const) {
      const sweep = await docs.get(sweepDocName(key, one), sweepStateSchema);
      if (sweep?.slowed !== true) continue;
      result.reads += told(
        await tellPaymentManagers(notices, {
          kind: 'payments.reads',
          about: `reads:${key}:${one}:${sweep.month}`,
          words: () => ({ title: { key: 'reads.title', fallback: 'Adminium checks {provider} less often' }, body: { key: 'reads.body', fallback: 'It has used half of the reads {provider} allows this month.' }, values: { provider: name } }),
        }),
      );
    }
  }
  return result;
}

// ─── Integrity ──────────────────────────────────────────────────────────────

export interface IntegrityResult {
  checked: number;
  missing: number;
  skipped: number;
}

/** Whether a recorded payment's row is there, for the amount taken; null when it cannot be told now. */
async function stillThere(deps: WatchDeps, attempt: PaymentAttempt): Promise<boolean | null> {
  const taken = attempt.takenAmount ?? attempt.amount;
  if (attempt.recordedKey?.startsWith('kept:') === true) {
    const kept = await keptPaymentsRepo(deps.meta).byAttempt(attempt.id);
    return kept !== null && !kept.voided && sameAmount(kept.amount, taken);
  }
  const payable = await resolvePayable(deps.sources, attempt.payable);
  // The record itself is gone: its payment is gone with it.
  if (payable === null) return false;
  const into = payable.recordInto;
  if (into.kind !== 'table' || attempt.payable.connectionId === null) return null;
  const found = await deps.sources.table(attempt.payable.connectionId, into.tableName);
  if (found === null) return null;
  const row = (await found.target.db
    .selectFrom(found.table.id)
    .selectAll()
    .where((eb) => eb(eb.ref(into.reference as never), '=', attempt.id as never))
    .executeTakeFirst()) as Row | undefined;
  if (row === undefined) return false;
  const scale = currencyScale(attempt.takenCurrency ?? attempt.currency);
  const amount = into.amountUnit === 'minor' ? fromMinorUnits(row[into.amount] ?? 0, scale) : exactAmount(row[into.amount] ?? 0, scale);
  return amount !== null && sameAmount(amount, taken);
}

/** One integrity run. It writes only to meta (a flag), never to a shop's table. */
export async function runPaymentIntegrity(deps: WatchDeps): Promise<IntegrityResult> {
  const at = (deps.now ?? Date.now)();
  const attempts = paymentAttemptsRepo(deps.meta);
  const result: IntegrityResult = { checked: 0, missing: 0, skipped: 0 };
  for (const attempt of await recentlyRecorded(deps.meta, at - INTEGRITY_DAYS * DAY_MS)) {
    if (attempt.provider === DEMO_PAYMENT_KEY || attempt.problem?.code === 'RECORD_MISSING') continue;
    let there: boolean | null;
    try {
      there = await stillThere(deps, attempt);
    } catch {
      there = null;
    }
    if (there === null) {
      result.skipped += 1;
      continue;
    }
    result.checked += 1;
    if (there) continue;
    await attempts.note(attempt.id, 'recorded', { problem: { code: 'RECORD_MISSING', message: 'The payment Adminium recorded is no longer in the record’s payments, or not for the amount taken.' } }, at);
    await attempts.flag(attempt.id, at);
    result.missing += 1;
  }
  return result;
}
