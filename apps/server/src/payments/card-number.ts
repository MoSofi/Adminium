// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A full card number never goes into a payment's text: a note, an approval
 * code, a reference. A person recording a card payment from a terminal slip
 * may copy the long number by mistake, and a note is shown to every reader of
 * the record and kept in the audit trail.
 *
 * What counts: 13 to 19 digits, written together or in groups split by
 * single spaces, dots or hyphens (as card numbers are printed), that pass the
 * Luhn check every card number carries — also when more digits follow in the
 * same run (an expiry, a code). A run glued to letters is an IBAN or a code,
 * and digits that fail the check are a phone number, an order number or a
 * reference.
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

/** Whether a text holds what looks like a full card number. */
export function holdsCardNumber(text: string | null | undefined): boolean {
  if (text === null || text === undefined) return false;
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
