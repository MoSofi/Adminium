// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A full card number never goes into a payment's text: a note, an approval
 * code, a reference. A person recording a card payment from a terminal slip
 * may copy the long number by mistake, and a note is shown to every reader of
 * the record and kept in the audit trail.
 *
 * What counts: a run of 13 to 19 digits, written together or in groups split
 * by single spaces or hyphens (as card numbers are printed), that passes the
 * Luhn check every card number carries. A longer run is not a card number (an
 * IBAN's digits run to 20 and more), and a run that fails the check is a
 * phone number, an order number or a reference.
 */

/** The Luhn check over a string of digits. */
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

const RUN = /\d(?:[ -]?\d)*/g;

/** Whether a text holds what looks like a full card number. */
export function holdsCardNumber(text: string | null | undefined): boolean {
  if (text === null || text === undefined) return false;
  for (const match of text.matchAll(RUN)) {
    const digits = match[0].replace(/[ -]/g, '');
    if (digits.length >= 13 && digits.length <= 19 && passesLuhn(digits)) return true;
  }
  return false;
}
