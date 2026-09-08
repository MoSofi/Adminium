// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Document dates for the starters (34-invoices-add-on.md Appendix G). The
 * comp seeds literal strings ("Jul 12, 2026", comp 1088); a starter minted
 * on a real day writes today's, thirty days out for the due date, a month
 * out for the next charge — in the document's language, because the date is
 * CONTENT the customer reads, not chrome (34 D17 as amended).
 *
 * `Intl` with a fixed `en-US`-style pattern (short month, day, year) per
 * language; UTC, so the same instant gives the same text on every host.
 */
import type { InvoiceLang } from './languages.js';

const LOCALE_OF: Readonly<Record<InvoiceLang, string>> = {
  en: 'en-US',
  de: 'de-DE',
  fr: 'fr-FR',
  es: 'es-ES',
  pt: 'pt-PT',
  ja: 'ja-JP',
};

const DAY_MS = 86_400_000;

export function formatDocumentDate(epochMs: number, lang: InvoiceLang): string {
  return new Intl.DateTimeFormat(LOCALE_OF[lang], { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(epochMs));
}

export function addDays(epochMs: number, days: number): number {
  return epochMs + days * DAY_MS;
}

/** Calendar months in UTC; a day past the target month's end clamps to its last day. */
export function addMonths(epochMs: number, months: number): number {
  const date = new Date(epochMs);
  const day = date.getUTCDate();
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1, date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds()));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.getTime();
}
