// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The two emails a shop's customer gets about paying: the pay link, sent by
 * staff from the record's Payment panel, and the receipt, sent once when a
 * payment the pay page took is written down.
 *
 * ─── THE SHOP SPEAKS, NEVER THE SOFTWARE ───────────────────────────────────
 *
 * Both carry the shop's own name, logo and contact from the pay page
 * settings: the name heads the message, the logo replaces the workspace's
 * mark, and a reply goes to the shop's contact address. An install that
 * never named its shop goes by its pay address, as the pay page does.
 *
 * ─── THE RECEIPT GOES ONCE ─────────────────────────────────────────────────
 *
 * It is queued by whichever run of the record job moved the attempt to
 * `recorded` (a compare-and-set only one run wins), so a job retry, a second
 * settle or the pickup never queues a second one. That it was queued is kept
 * per attempt, which is what the pay page's way back reads ("A receipt is on
 * its way to your email." only when one is).
 *
 * Live payments only: a test payment is staff trying the page, and the
 * record's customer must not get a receipt for pretend money.
 */
import { tagForLocale, type LocaleId } from '@adminium/i18n';
import { compareAmounts, subtractAmounts } from '@adminium/add-on-contracts';
import { currencyScale } from '@adminium/manifest';
import { paymentSettingsRepo, settingsRepo, type EmailBrand, type MetaDb, type PaymentAttempt, type PaymentLink } from '@adminium/meta';
import { z } from 'zod';

import { resolveEmailTemplate, translatorForLocale } from '../email/builtins.js';
import { paymentEmailLines } from '../email/builtins.js';
import { PAYMENT_LINK_TEMPLATE_KEY, PAYMENT_RECEIPT_TEMPLATE_KEY, enqueueEmail, type EnqueueEmailDeps } from '../email/send.js';
import { WORKSPACE_ACCENT_HEX } from '../email/render.js';
import { recipientLocale } from '../i18n/server-i18n.js';
import { businessName } from '../privacy/business.js';
import { PAY_PAGE_DOC, payPageSchema } from '../routes/payments/ways.js';
import { resolvePayable, type PayableSources, type ResolvedPayable } from './payables.js';

export interface PaymentEmailDeps extends EnqueueEmailDeps {
  sources: PayableSources;
  now?: () => number;
}

/** The shop as its customers know it. */
export interface ShopFace {
  name: string;
  email: string | null;
  phone: string | null;
  logoFileId: string | null;
}

/** The pay page settings; the name is the one every page a stranger sees uses (`privacy/business.ts`). */
export async function shopFace(meta: MetaDb): Promise<ShopFace> {
  const page = await paymentSettingsRepo(meta).get(PAY_PAGE_DOC, payPageSchema);
  return { name: await businessName(meta), email: page?.contactEmail ?? null, phone: page?.contactPhone ?? null, logoFileId: page?.logoFileId ?? null };
}

/** How the shop's contact reads in a sentence: the address, the phone, or both. */
function contactOf(shop: ShopFace): string | null {
  const parts = [shop.email, shop.phone].filter((part): part is string => part !== null && part.trim() !== '');
  return parts.length === 0 ? null : parts.join(' · ');
}

async function brandOf(meta: MetaDb, shop: ShopFace): Promise<EmailBrand> {
  const accent = await settingsRepo(meta).get('appearance.accent');
  const hex = typeof accent === 'string' ? (WORKSPACE_ACCENT_HEX[accent] ?? (/^#[0-9a-fA-F]{6}$/.test(accent) ? accent : null)) : null;
  return { name: shop.name.slice(0, 80), mark: 'logo', accent: hex ?? '#b03e00', fromName: shop.name.slice(0, 120), fromEmail: '' };
}

function intlTag(locale: string): string {
  try {
    return tagForLocale(locale as LocaleId);
  } catch {
    return 'en-US';
  }
}

/** An amount as the customer reads it: their language, Latin digits, the currency's own decimals. */
export function moneyText(amount: string, currency: string, locale: string): string {
  const decimals = (amount.split('.')[1] ?? '').length;
  try {
    return new Intl.NumberFormat(`${intlTag(locale)}-u-nu-latn`, { style: 'currency', currency, minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(amount as `${number}`); // the decimal string itself: exact, where a Number would round past 15 digits
  } catch {
    return `${currency} ${amount}`;
  }
}

/** A day as the customer reads it, Latin digits; a `YYYY-MM-DD` is that calendar day wherever it is read. */
export function dayText(at: number | string, locale: string): string {
  const instant = typeof at === 'number' ? new Date(at) : new Date(`${at}T12:00:00Z`);
  return new Intl.DateTimeFormat(`${intlTag(locale)}-u-nu-latn`, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(instant);
}

/** The template a send renders, with the shop's brand on a row nobody gave a brand of their own. */
async function templateFor(meta: MetaDb, key: string, locale: string, shop: ShopFace) {
  const row = await resolveEmailTemplate(meta, key, locale);
  if (row === null) return null;
  return { ...row, brand: row.brand ?? (await brandOf(meta, shop)) };
}

// ─── The pay link ──────────────────────────────────────────────────────────

export type LinkEmailOutcome =
  | { sent: true; to: string; jobId: string }
  | { sent: false; reason: 'no-customer-email' | 'not-payable' | 'email-off' | 'template-off' };

/**
 * Sends a payable's pay link to the address the record holds. `url` is the
 * link's own address (unsealed by the caller); the payable is read again here.
 */
export async function sendPayLinkEmail(deps: PaymentEmailDeps, input: { link: PaymentLink; url: string; payable?: ResolvedPayable | null }): Promise<LinkEmailOutcome> {
  const payable = input.payable === undefined ? await resolvePayable(deps.sources, input.link.payable) : input.payable;
  if (payable === null || payable.refusal !== null) return { sent: false, reason: 'not-payable' };
  const to = payable.customerEmail;
  if (to === null) return { sent: false, reason: 'no-customer-email' };
  const locale = await recipientLocale(deps.meta, null);
  const shop = await shopFace(deps.meta);
  const template = await templateFor(deps.meta, PAYMENT_LINK_TEMPLATE_KEY, locale, shop);
  if (template === null) return { sent: false, reason: 'template-off' };
  const { t } = await translatorForLocale(deps.meta, template.locale);
  const lines = paymentEmailLines(t, { due: payable.dueDate === null ? null : dayText(payable.dueDate, template.locale), number: payable.label, contact: contactOf(shop) });
  const job = await enqueueEmail(deps, {
    to,
    templateKey: PAYMENT_LINK_TEMPLATE_KEY,
    locale,
    template,
    vars: {
      shop: shop.name,
      number: payable.label,
      amount: moneyText(payable.due, payable.currency, template.locale),
      payUrl: input.url,
      expiresOn: dayText(input.link.expiresAt, template.locale),
      dueLine: lines.dueLine,
      contactLine: lines.contactLine,
    },
    ...(shop.email === null ? {} : { replyTo: shop.email }),
    ...(shop.logoFileId === null ? {} : { markFileId: shop.logoFileId }),
    // A second press while the first is still on its way sends one email.
    dedupeKey: `payment-link-email:${input.link.id}`,
  });
  if (job === null) return { sent: false, reason: 'email-off' };
  return { sent: true, to, jobId: job.id };
}

// ─── The receipt ───────────────────────────────────────────────────────────

const receiptSchema = z.object({ queuedAt: z.number().int().nonnegative(), jobId: z.string().min(1) }).strict();

function receiptDocName(attemptId: string): string {
  return `receipt:${attemptId}`;
}

/** Whether a receipt went out for this payment: what the pay page's way back says. */
export async function receiptSentFor(meta: MetaDb, attempt: Pick<PaymentAttempt, 'id'>): Promise<boolean> {
  return (await paymentSettingsRepo(meta).get(receiptDocName(attempt.id), receiptSchema)) !== null;
}

/**
 * Queues the receipt for an attempt just recorded. Call it only from the run
 * that moved the attempt to `recorded`. Never throws: a payment that is
 * written down stays written down whatever the mail does.
 */
export async function queuePaymentReceipt(deps: PaymentEmailDeps, attempt: PaymentAttempt): Promise<boolean> {
  try {
    if (attempt.mode !== 'live' || attempt.provider === 'demo') return false;
    if (await receiptSentFor(deps.meta, attempt)) return false;
    const payable = await resolvePayable(deps.sources, attempt.payable);
    const to = payable?.customerEmail ?? null;
    if (payable === null || to === null) return false;
    const locale = await recipientLocale(deps.meta, null);
    const shop = await shopFace(deps.meta);
    const template = await templateFor(deps.meta, PAYMENT_RECEIPT_TEMPLATE_KEY, locale, shop);
    if (template === null) return false;
    const { t } = await translatorForLocale(deps.meta, template.locale);
    const currency = attempt.takenCurrency ?? attempt.currency;
    const amount = attempt.takenAmount ?? attempt.amount;
    // What is still due once this payment counts: the record read again now.
    const scale = currencyScale(currency);
    const left = payable.currency === currency && compareAmounts(payable.due, '0') === 1 ? subtractAmounts(payable.due, '0', scale) : null;
    const lines = paymentEmailLines(t, { left: left === null ? null : moneyText(left, currency, template.locale), number: payable.label, contact: contactOf(shop) });
    const label = (attempt.paidWith as { label?: unknown } | null)?.label;
    const service = attempt.provider === 'payments-stripe' ? 'Stripe' : attempt.provider === 'payments-paypal' ? 'PayPal' : attempt.provider.replace(/^payments-/, '');
    const method = typeof label === 'string' && label.trim() !== '' ? label : t('email:paymentReceipt.online', { service, defaultValue: 'Online payment ({service})' });
    const job = await enqueueEmail(deps, {
      to,
      templateKey: PAYMENT_RECEIPT_TEMPLATE_KEY,
      locale,
      template,
      vars: {
        shop: shop.name,
        number: payable.label,
        amount: moneyText(amount, currency, template.locale),
        paidOn: dayText(attempt.settledAt ?? attempt.recordedAt ?? (deps.now ?? Date.now)(), template.locale),
        method,
        balanceLine: lines.balanceLine,
        contactLine: lines.contactLine,
      },
      ...(shop.email === null ? {} : { replyTo: shop.email }),
      ...(shop.logoFileId === null ? {} : { markFileId: shop.logoFileId }),
      dedupeKey: `payment-receipt:${attempt.id}`,
    });
    if (job === null) return false;
    await paymentSettingsRepo(deps.meta).set(receiptDocName(attempt.id), receiptSchema, { queuedAt: (deps.now ?? Date.now)(), jobId: job.id });
    return true;
  } catch (error) {
    deps.logger?.warn({ err: error, attempt: attempt.id }, 'the payment is recorded, but its receipt could not be queued');
    return false;
  }
}
