// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Words and numbers the payments tabs share: what a way to pay is called,
 * how an amount and a country read in the person's language.
 *
 * A way's name is its owner's mark where it has one ("Apple Pay", "Klarna"),
 * never translated or inflected; only the generic ones ("Cards", "Bank
 * transfer") are words of ours. Machine strings (IBAN, BIC, amounts in a
 * form) stay Latin digits and left-to-right wherever they are shown.
 */
import { getI18nInstance, t } from '../../i18n/t.js';
import type { WayView } from './paymentsApi.js';

export function locale(): string {
  return getI18nInstance()?.language ?? 'en-US';
}

/** The shop's own name for a way, in this language, when it gave one. */
function ownLabel(way: Pick<WayView, 'label'>): string | null {
  const labels = way.label;
  if (labels === null) return null;
  return labels[locale()] ?? labels['en-US'] ?? Object.values(labels)[0] ?? null;
}

/** The ways a Stripe account cannot leave out of one checkout: they follow cards, or have no switch of their own. */
export const FOLLOWS_CARDS: ReadonlySet<string> = new Set(['apple_pay', 'google_pay', 'link']);

export function wayName(way: Pick<WayView, 'source' | 'method' | 'label'>): string {
  const own = ownLabel(way);
  if (own !== null) return own;
  switch (way.method) {
    case 'card':
      return t('studio:payments.way.card', 'Cards');
    case 'link':
      return 'Link (Stripe)';
    case 'apple_pay':
      return 'Apple Pay';
    case 'google_pay':
      return 'Google Pay';
    case 'sepa_debit':
      return t('studio:payments.way.sepa', 'SEPA Direct Debit');
    case 'klarna':
      return 'Klarna';
    case 'paypal':
      return 'PayPal';
    case 'ideal':
      return 'iDEAL';
    case 'bancontact':
      return 'Bancontact';
    case 'bank-transfer':
      return t('studio:payments.way.bankTransfer', 'Bank transfer');
    case 'cash-on-delivery':
      return t('studio:payments.way.cashOnDelivery', 'Cash on delivery');
    case 'other':
      return t('studio:payments.way.other', 'Another way to pay by hand');
    default:
      return way.method.replace(/[_-]/g, ' ');
  }
}

/** "€120.00" in this language; the plain text when the currency is not one Intl knows. */
export function money(amount: string, currency: string): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) return `${amount} ${currency}`;
  try {
    const decimals = (amount.split('.')[1] ?? '').length;
    return new Intl.NumberFormat(locale(), { style: 'currency', currency, minimumFractionDigits: decimals, maximumFractionDigits: Math.max(decimals, 3), numberingSystem: 'latn' }).format(value);
  } catch {
    return `${amount} ${currency}`;
  }
}

/** A country's name in this language, from its two-letter code. */
export function countryName(code: string): string {
  try {
    return new Intl.DisplayNames([locale()], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** The countries the preview offers first: the ones the shop's own markets are usually in. */
export const PREVIEW_COUNTRIES = ['DE', 'AT', 'CH', 'NL', 'BE', 'FR', 'IT', 'ES', 'GB', 'IE', 'DK', 'CZ', 'US', 'CA', 'AU', 'EG', 'AE', 'CN', 'TW', 'JP'] as const;

/** Currencies the preview offers; the rules accept any ISO 4217 code. */
export const PREVIEW_CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'DKK', 'CZK', 'JPY', 'CNY', 'TWD', 'EGP', 'AED', 'KWD'] as const;
