// SPDX-License-Identifier: AGPL-3.0-only
/**
 * One typed phone number, read exactly: its E.164 form and its country, or the
 * reason it cannot be read.
 *
 * Pure: no setting, clock, log or database. The country is an argument, and
 * what a failure MEANS belongs to the caller. A text never sends; a parcel asks
 * staff to fix the number. `e164` is the only form to store, compare or hash;
 * two numbers are the same number when their `e164` are equal, and never by a
 * looser match (`samePhone` in privacy/copy-rows.ts is for finding copies to
 * erase, where a false match is safe; on a stop list it is not).
 *
 * Every country rule is the library's. What is written here is the check in
 * front of it, because `google-libphonenumber` is built to find a number in
 * free text: it reads "Call 415…" as a number, turns letters into digits, and
 * silently skips digits it has no mapping for. So only a value that is written
 * as one number, in digits the library really reads, ever reaches it.
 */
import phoneLib from 'google-libphonenumber';

const { PhoneNumberFormat, PhoneNumberType, PhoneNumberUtil } = phoneLib;
/** The library's parse errors: exported at run time, missing from its `@types`. */
const ParseError = (
  phoneLib as unknown as {
    Error: Record<'INVALID_COUNTRY_CODE' | 'TOO_SHORT_AFTER_IDD' | 'TOO_SHORT_NSN' | 'TOO_LONG', string>;
  }
).Error;
const util = PhoneNumberUtil.getInstance();
const COUNTRIES: ReadonlySet<string> = new Set(util.getSupportedRegions());

export type PhoneKind =
  | 'mobile'
  | 'landline'
  | 'mobile-or-landline'
  | 'voip'
  | 'personal'
  | 'toll-free'
  | 'premium-rate'
  | 'shared-cost'
  | 'pager'
  | 'uan'
  | 'voicemail'
  | 'unknown';

/**
 * Whether a text can reach this number. `maybe` is a real answer: the US and
 * Canada do not separate mobiles from landlines in the number itself, so only
 * the provider's reply can tell.
 */
export type ReceivesText = 'yes' | 'maybe' | 'no';

export type PhoneFailureReason =
  /** The value is not a string. A number column has already lost any leading zero or plus. */
  | 'not-text'
  | 'empty'
  /** The country argument is not a known ISO code, even when this number did not need it. */
  | 'bad-country'
  /** A local number, and no country to read it in. */
  | 'needs-country'
  /** Not written as one phone number: letters, two numbers, control characters, far too long. */
  | 'not-a-number'
  /** A `+` followed by no country code that exists. */
  | 'bad-calling-code'
  | 'too-short'
  | 'too-long'
  /** A plausible length, in a range no number is assigned from. */
  | 'not-in-use'
  /** A global service number such as +800, which belongs to no country. */
  | 'no-country';

export interface Phone {
  readonly ok: true;
  /** The exact number, `+442079460958`. It never carries an extension. */
  readonly e164: string;
  /** The ISO country the NUMBER belongs to, which can differ from the country passed in. */
  readonly country: string;
  /** `44`. `e164` without the `+` and this code is the national number with no trunk prefix. */
  readonly callingCode: string;
  /** As written at home, `020 7946 0958`. */
  readonly national: string;
  /** The national form in digits alone, trunk prefix kept, `02079460958`. */
  readonly nationalDigits: string;
  readonly kind: PhoneKind;
  readonly receivesText: ReceivesText;
  readonly extension: string | null;
}

export interface PhoneFailure {
  readonly ok: false;
  readonly reason: PhoneFailureReason;
}

/** Longer than any number with an extension and its spacing; nothing past it is parsed. */
const MAX_WRITTEN = 64;

/** Direction marks a contacts app or a web page wraps around a number. An override is not here: it changes what the reader sees. */
const INVISIBLE = /[\u200E\u200F\u202A\u202C\u2066\u2069\uFEFF]/gu;

/** ASCII, Arabic-Indic, Persian and full-width: the digits the library maps. It skips any other. */
const DIGIT = '0-9\\u0660-\\u0669\\u06F0-\\u06F9\\uFF10-\\uFF19';
const SEPARATOR = ' \\u00A0\\u2009\\u202F\\u3000().\\-\\u2010-\\u2015\\uFF0D/';

/** One number: an optional plus, digits and separators, and an optional extension at the end. */
const WRITTEN = new RegExp(
  `^[+\\uFF0B]?[${DIGIT}${SEPARATOR}]+(?:(?:ext\\.?|extn\\.?|x|#)[ \\u00A0]*[${DIGIT}]{1,7})?$`,
  'iu',
);

/** A slash separates an area code, "030 / 1234567". A second one, or one with no digit after it, is a list. */
const ONE_SLASH = new RegExp(`^[^/]*(?:/[ \\u00A0]*[${DIGIT}][^/]*)?$`, 'u');

const KINDS = new Map<number, { kind: PhoneKind; receivesText: ReceivesText }>([
  [PhoneNumberType.MOBILE, { kind: 'mobile', receivesText: 'yes' }],
  [PhoneNumberType.FIXED_LINE_OR_MOBILE, { kind: 'mobile-or-landline', receivesText: 'maybe' }],
  [PhoneNumberType.VOIP, { kind: 'voip', receivesText: 'maybe' }],
  [PhoneNumberType.PERSONAL_NUMBER, { kind: 'personal', receivesText: 'maybe' }],
  [PhoneNumberType.FIXED_LINE, { kind: 'landline', receivesText: 'no' }],
  [PhoneNumberType.TOLL_FREE, { kind: 'toll-free', receivesText: 'no' }],
  [PhoneNumberType.PREMIUM_RATE, { kind: 'premium-rate', receivesText: 'no' }],
  [PhoneNumberType.SHARED_COST, { kind: 'shared-cost', receivesText: 'no' }],
  [PhoneNumberType.PAGER, { kind: 'pager', receivesText: 'no' }],
  [PhoneNumberType.UAN, { kind: 'uan', receivesText: 'no' }],
  [PhoneNumberType.VOICEMAIL, { kind: 'voicemail', receivesText: 'no' }],
]);
const UNKNOWN_KIND = { kind: 'unknown', receivesText: 'no' } as const;

const fail = (reason: PhoneFailureReason): PhoneFailure => ({ ok: false, reason });

function parseFailure(error: unknown): PhoneFailureReason {
  const message = error instanceof Error ? error.message : '';
  if (message === ParseError.INVALID_COUNTRY_CODE) return 'bad-calling-code';
  if (message === ParseError.TOO_SHORT_AFTER_IDD || message === ParseError.TOO_SHORT_NSN) return 'too-short';
  if (message === ParseError.TOO_LONG) return 'too-long';
  return 'not-a-number';
}

function lengthFailure(result: number): PhoneFailureReason | null {
  const { ValidationResult } = PhoneNumberUtil;
  if (result === ValidationResult.TOO_SHORT || result === ValidationResult.IS_POSSIBLE_LOCAL_ONLY) return 'too-short';
  if (result === ValidationResult.TOO_LONG) return 'too-long';
  return null;
}

/**
 * Read one typed number. `country` is the ISO code to read a local number in,
 * or null when there is none: a number written with `+` then still reads.
 * Accepts any value, because old rows may hold anything, and never throws.
 */
export function parsePhone(input: unknown, country: string | null): Phone | PhoneFailure {
  if (typeof input !== 'string') return fail('not-text');

  // Two ASCII letters BEFORE upper-casing: "ß" upper-cases to SS, South Sudan.
  if (country !== null && (typeof country !== 'string' || !/^[A-Za-z]{2}$/.test(country))) return fail('bad-country');
  const region = country?.toUpperCase() ?? null;
  if (region !== null && !COUNTRIES.has(region)) return fail('bad-country');

  const written = input.replace(INVISIBLE, '').trim();
  if (written === '') return fail('empty');
  if (written.length > MAX_WRITTEN || !WRITTEN.test(written) || !ONE_SLASH.test(written)) {
    return fail('not-a-number');
  }
  if (region === null && !/^[+\uFF0B]/u.test(written)) return fail('needs-country');

  let number: phoneLib.PhoneNumber;
  try {
    number = util.parse(written, region ?? undefined);
  } catch (error) {
    return fail(parseFailure(error));
  }

  const wrongLength = lengthFailure(util.isPossibleNumberWithReason(number));
  if (wrongLength !== null) return fail(wrongLength);
  if (!util.isValidNumber(number)) return fail('not-in-use');

  const numberCountry = util.getRegionCodeForNumber(number);
  if (numberCountry === undefined || !COUNTRIES.has(numberCountry)) return fail('no-country');

  const extension = number.getExtension() || null;
  number.clearExtension();
  const national = util.format(number, PhoneNumberFormat.NATIONAL);
  const { kind, receivesText } = KINDS.get(util.getNumberType(number)) ?? UNKNOWN_KIND;

  return {
    ok: true,
    e164: util.format(number, PhoneNumberFormat.E164),
    country: numberCountry,
    callingCode: String(number.getCountryCode()),
    national,
    nationalDigits: national.replace(/\D/g, ''),
    kind,
    // A text to an extension reaches the switchboard, not the person.
    receivesText: extension === null ? receivesText : 'no',
    extension,
  };
}
