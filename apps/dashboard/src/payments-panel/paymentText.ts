// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Payment panel's small rules, kept apart so they are tested alone.
 *
 * The card-number check is the server's own (`payments/card-number.ts`):
 * a run of 13 to 19 digits, together or in groups split by single spaces or
 * hyphens, that passes the Luhn check. The dialog says so before it sends;
 * the server refuses it again whatever a page sends.
 */

export function passesLuhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = digits.charCodeAt(index) - 48;
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

/** Whether a text holds what looks like a full card number. */
export function holdsCardNumber(text: string): boolean {
  for (const match of text.matchAll(/\d(?:[ .-]?\d)*/g)) {
    // A run glued to letters is an IBAN or a code ("DE89 3704 …", "INV2024…"), not a card number.
    if (match.index > 0 && /\p{L}/u.test(text[match.index - 1]!)) continue;
    // The number may share its run with what follows it ("4242 4242 4242 4242 12/27"): every stretch of
    // whole groups from a group's start, 13 to 19 digits long, is tried.
    const groups = match[0].split(/[ .-]/);
    for (let start = 0; start < groups.length; start += 1) {
      let digits = '';
      for (let end = start; end < groups.length && digits.length < 19; end += 1) {
        digits += groups[end];
        if (digits.length >= 13 && digits.length <= 19 && passesLuhn(digits)) return true;
      }
    }
  }
  return false;
}

/** An approval code from a terminal slip: letters and digits, up to 12. */
export function approvalCodeOk(text: string): boolean {
  return /^[A-Za-z0-9]{1,12}$/.test(text);
}

export function lastFourOk(text: string): boolean {
  return /^\d{4}$/.test(text);
}

/** Digits after the point of an amount the server sent ("120.00" → 2, "12000" → 0). */
export function decimalsOf(amount: string): number {
  return (amount.split('.')[1] ?? '').length;
}

/** An amount as the reader reads it, with exactly the decimals the server sent. */
export function formatMoney(amount: string, currency: string, locale: string, decimals = decimalsOf(amount)): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(amount as `${number}`); // the decimal string itself: exact, where a Number would round past 15 digits
  } catch {
    return `${currency} ${amount}`;
  }
}

/** A calendar day ("2026-10-20") or an instant as a short date ("20 Oct"). */
export function shortDay(value: string | number, locale: string): string {
  const at = typeof value === 'number' ? value : Date.parse(`${value}T12:00:00Z`);
  if (Number.isNaN(at)) return typeof value === 'string' ? value : '';
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(at));
}

/**
 * An amount typed by a person, as the server reads it: digits with one
 * decimal point (a comma is taken as one). Null when it is not a number.
 */
export function typedAmount(text: string): string | null {
  const plain = text.trim().replace(/\s/g, '').replace(',', '.');
  return /^\d+(\.\d+)?$/.test(plain) ? plain : null;
}

/** Whether `a` is more than `b`, both plain decimal strings. */
export function moreThan(a: string, b: string): boolean {
  const scale = Math.max(decimalsOf(a), decimalsOf(b));
  const minor = (value: string): bigint => {
    const [whole = '0', fraction = ''] = value.split('.');
    return BigInt(whole + fraction.padEnd(scale, '0'));
  };
  return minor(a) > minor(b);
}

/** Today in this browser, `YYYY-MM-DD`. */
export function today(now: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** The key the Record dialog sends with every try of one payment. */
export function newPaymentKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
