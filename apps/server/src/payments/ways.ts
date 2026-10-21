// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Which ways to pay a customer is offered for one payable.
 *
 * ONE resolver, used by the pay page and by Studio's customer preview alike,
 * so the preview can never promise a way the page will not show. A way is
 * offered when it is switched on and every one of its rules lets it:
 *
 *   - countries: the customer's country (from the payable's mapped column),
 *     else the shop's; a way limited to some countries is not offered when
 *     neither is known;
 *   - currencies: the payable's currency;
 *   - min / max: the amount due now, inclusive;
 *   - only for: which payables (a payable profile's id, `shape`, `document`).
 *
 * A provider's ways are offered only while that provider can take a
 * checkout now (installed, loaded, keyed for the mode, not stopped). And
 * while the shop's own PayPal is connected, PayPal is never offered a second
 * time through another provider: the customer sees one PayPal button.
 *
 * Which of a provider's ways a customer finally sees is the provider's
 * choice on its own page; this decides only which ways Adminium lets it offer.
 */
import { compareAmounts } from '@adminium/add-on-contracts';
import type { PayableKind, PaymentMethodRow } from '@adminium/meta';

/** Ways to pay that are not a provider's: shown on the pay page with their own details. */
export const MANUAL_SOURCE = 'manual';
export const MANUAL_METHODS = ['bank-transfer', 'cash-on-delivery', 'other'] as const;

/** The provider whose PayPal button is the only one when it is connected. */
const PAYPAL_ADD_ON = 'payments-paypal';

export interface WaysPayable {
  kind: PayableKind;
  /** The payable profile's id, for a profile; null otherwise. */
  profileId: string | null;
  currency: string;
  /** The amount due now. */
  due: string;
  /** The customer's country (ISO 3166-1 alpha-2), or null when the payable does not say. */
  customerCountry: string | null;
}

export interface WaysInput {
  methods: readonly PaymentMethodRow[];
  payable: WaysPayable;
  /** The shop's own country, used when the customer's is not known. */
  shopCountry: string | null;
  /** Provider add-on keys that can start a checkout now. */
  providers: readonly string[];
}

export interface WayOffer {
  source: string;
  method: string;
  /** The way's own name per locale, when the shop gave one. */
  label: Record<string, string> | null;
  /** For a manual way: what the customer is told (bank details for the payable's currency, a note). */
  details: unknown;
}

function within(due: string, min: string | null, max: string | null): boolean {
  if (min !== null && compareAmounts(due, min) === -1) return false;
  if (max !== null && compareAmounts(due, max) === 1) return false;
  return true;
}

/** Every way the customer is offered, in the shop's order. */
export function waysFor(input: WaysInput): WayOffer[] {
  const { payable } = input;
  const country = payable.customerCountry ?? input.shopCountry;
  const payableKey = payable.kind === 'profile' ? (payable.profileId ?? '') : payable.kind;
  const paypalDirect = input.providers.includes(PAYPAL_ADD_ON);
  return [...input.methods]
    .sort((a, b) => a.position - b.position)
    .filter((way) => {
      if (!way.enabled) return false;
      if (way.source !== MANUAL_SOURCE && !input.providers.includes(way.source)) return false;
      if (paypalDirect && way.source !== PAYPAL_ADD_ON && way.method === 'paypal') return false;
      const { rules } = way;
      if (rules.countries.length > 0 && (country === null || !rules.countries.includes(country))) return false;
      if (rules.currencies.length > 0 && !rules.currencies.includes(payable.currency)) return false;
      if (!within(payable.due, rules.min, rules.max)) return false;
      if (rules.onlyFor.length > 0 && !rules.onlyFor.includes(payableKey)) return false;
      return true;
    })
    .map((way) => ({ source: way.source, method: way.method, label: way.label, details: detailsFor(way, payable.currency) }));
}

/**
 * What a manual way tells the customer. Bank details are kept per currency
 * (`{ accounts: [{ currency, … }] }`): a customer paying in EUR is shown the
 * EUR account only. A way with no account for the currency shows none.
 */
function detailsFor(way: PaymentMethodRow, currency: string): unknown {
  if (way.source !== MANUAL_SOURCE) return null;
  const details = way.details as { accounts?: { currency?: string }[]; note?: unknown } | null;
  if (details === null || typeof details !== 'object') return null;
  if (!Array.isArray(details.accounts)) return details;
  return { ...details, accounts: details.accounts.filter((account) => account.currency === currency) };
}
