// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Amounts and dates as the customer reads them: in their language, always
 * with Latin digits, and an amount with exactly the decimals the server sent
 * (the currency's own: `12000` yen, `45.250` dinar), never rounded here.
 */
export function decimalsOf(amount: string): number {
  return (amount.split('.')[1] ?? '').length;
}

export function money(amount: string, currency: string, locale: string): string {
  const decimals = decimalsOf(amount);
  try {
    return new Intl.NumberFormat(`${locale}-u-nu-latn`, { style: 'currency', currency, minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(amount as `${number}`); // the decimal string itself: exact, where a Number would round past 15 digits
  } catch {
    return `${currency} ${amount}`;
  }
}

export function shortDate(at: number, locale: string): string {
  return new Intl.DateTimeFormat(`${locale}-u-nu-latn`, { day: 'numeric', month: 'short' }).format(new Date(at));
}

/** An IBAN shown in groups of four, copied without spaces. */
export function groupedIban(iban: string): string {
  return iban.replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim();
}
