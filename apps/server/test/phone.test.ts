// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The shared phone module: the exact number or a stated reason, for real
 * numbers as people type them and for values nobody should have typed. Both
 * callers lean on the same two promises: `e164` is exact and stable, and a
 * value that is not plainly one number is refused rather than guessed at.
 */
import phoneLib from 'google-libphonenumber';
import { describe, expect, it } from 'vitest';

import { parsePhone, type Phone, type PhoneFailureReason } from '../src/phone/index.js';

const E164 = /^\+[1-9]\d{1,14}$/;
const util = phoneLib.PhoneNumberUtil.getInstance();

function read(input: unknown, country: string | null): Phone {
  const result = parsePhone(input, country);
  if (!result.ok) throw new Error(`${JSON.stringify(input)} in ${country}: ${result.reason}`);
  return result;
}

const reason = (input: unknown, country: string | null): PhoneFailureReason | 'read' => {
  const result = parsePhone(input, country);
  return result.ok ? 'read' : result.reason;
};

describe('numbers as people write them', () => {
  it.each([
    ['(415) 555-0132', 'US', '+14155550132', 'US'],
    ['415.555.0132', 'US', '+14155550132', 'US'],
    ['1-415-555-0132', 'US', '+14155550132', 'US'],
    ['+1 415 555 0132', 'US', '+14155550132', 'US'],
    ['011 44 20 7946 0958', 'US', '+442079460958', 'GB'],
    ['020 7946 0958', 'GB', '+442079460958', 'GB'],
    ['44 20 7946 0958', 'GB', '+442079460958', 'GB'],
    ['+44 (0)20 7946 0958', 'DE', '+442079460958', 'GB'],
    ['0044 20 7946 0958', 'DE', '+442079460958', 'GB'],
    ['030 / 12345678', 'DE', '+493012345678', 'DE'],
    ['0170 1234567', 'DE', '+491701234567', 'DE'],
    ['01 23 45 67 89', 'FR', '+33123456789', 'FR'],
    ['06 12 34 56 78', 'FR', '+33612345678', 'FR'],
    ['32 12 34 56', 'DK', '+4532123456', 'DK'],
    ['601 123 456', 'CZ', '+420601123456', 'CZ'],
    ['010 1234 5678', 'EG', '+201012345678', 'EG'],
    ['138 0013 8000', 'CN', '+8613800138000', 'CN'],
    ['0912 345 678', 'TW', '+886912345678', 'TW'],
    ['5123 4567', 'HK', '+85251234567', 'HK'],
    ['011 15 2345-6789', 'AR', '+5491123456789', 'AR'],
  ])('%s in %s', (written, country, e164, numberCountry) => {
    const phone = read(written, country);
    expect(phone.e164).toBe(e164);
    expect(phone.country).toBe(numberCountry);
  });

  it('keeps the leading zero Italy dials as part of the number', () => {
    expect(read('02 1234 5678', 'IT').e164).toBe('+390212345678');
  });

  it('reads the digits and marks real keyboards and contact apps produce', () => {
    const plain = '+201012345678';
    expect(read('٠١٠١٢٣٤٥٦٧٨', 'EG').e164).toBe(plain); // Arabic-Indic
    expect(read('۰۱۰۱۲۳۴۵۶۷۸', 'EG').e164).toBe(plain); // Persian
    expect(read('＋２０ １０ １２３４ ５６７８', null).e164).toBe(plain); // full-width
    expect(read('‪+20 10 1234 5678‬', null).e164).toBe(plain); // copied from a contact
    expect(read('‎+20 10 1234 5678', null).e164).toBe(plain);
    expect(read('  +20-10-1234-5678\t', null).e164).toBe(plain);
  });

  it('accepts lower-case country codes, which stored data may hold', () => {
    expect(read('020 7946 0958', 'gb').e164).toBe('+442079460958');
  });

  it('needs no country for a number written with a plus', () => {
    expect(read('+44 20 7946 0958', null).country).toBe('GB');
  });
});

describe('the country is the number’s own', () => {
  it('keeps a foreign number foreign, whatever country was passed', () => {
    expect(read('+44 20 7946 0958', 'DE').country).toBe('GB');
    expect(read('+49 170 1234567', 'US').country).toBe('DE');
  });

  it('tells countries that share a calling code apart', () => {
    expect(read('+1 876 512 3456', 'US').country).toBe('JM');
    expect(read('+1 416 555 0132', 'US').country).toBe('CA');
    expect(read('+7 701 123 4567', 'RU').country).toBe('KZ');
    expect(read('+44 1481 256789', 'GB').country).toBe('GG');
  });

  it('separates mainland China from Hong Kong, Macau and Taiwan, as the +86 block needs', () => {
    expect(read('+86 138 0013 8000', 'US')).toMatchObject({ country: 'CN', callingCode: '86' });
    expect(read('+852 5123 4567', 'US')).toMatchObject({ country: 'HK', callingCode: '852' });
    expect(read('+853 6612 3456', 'US')).toMatchObject({ country: 'MO', callingCode: '853' });
    expect(read('+886 912 345 678', 'US')).toMatchObject({ country: 'TW', callingCode: '886' });
  });
});

describe('whether a text can reach it', () => {
  it('says yes for a mobile', () => {
    expect(read('07400 123456', 'GB')).toMatchObject({ kind: 'mobile', receivesText: 'yes' });
  });

  it('says maybe where the number cannot tell a mobile from a landline', () => {
    expect(read('(415) 555-0132', 'US')).toMatchObject({ kind: 'mobile-or-landline', receivesText: 'maybe' });
  });

  it('says no for a landline, which shipping still accepts', () => {
    expect(read('020 7946 0958', 'GB')).toMatchObject({ ok: true, kind: 'landline', receivesText: 'no' });
  });

  it.each([
    ['0800 123 4567', 'GB', 'toll-free'],
    ['1-800-555-0199', 'US', 'toll-free'],
    ['0906 123 4567', 'GB', 'premium-rate'],
  ])('says no for %s', (written, country, kind) => {
    expect(read(written, country)).toMatchObject({ kind, receivesText: 'no' });
  });

  it('says no once an extension is present, and keeps it out of e164', () => {
    for (const written of ['020 7946 0958 ext. 7', '020 7946 0958 x7', '020 7946 0958#7', '020 7946 0958 EXTN 7']) {
      expect(read(written, 'GB')).toMatchObject({ e164: '+442079460958', extension: '7', receivesText: 'no' });
    }
    expect(read('07400 123456 x12', 'GB')).toMatchObject({ kind: 'mobile', receivesText: 'no', extension: '12' });
  });
});

describe('the national form for a carrier', () => {
  it('gives the written form and its digits, trunk prefix kept', () => {
    expect(read('+44 20 7946 0958', null)).toMatchObject({
      national: '020 7946 0958',
      nationalDigits: '02079460958',
      callingCode: '44',
    });
  });

  it('never carries the extension', () => {
    const phone = read('020 7946 0958 ext 7', 'GB');
    expect(phone.national).toBe('020 7946 0958');
    expect(phone.nationalDigits).toBe('02079460958');
  });

  it('leaves the no-trunk form one slice of e164 away', () => {
    const phone = read('020 7946 0958', 'GB');
    expect(phone.e164.slice(1 + phone.callingCode.length)).toBe('2079460958');
  });
});

describe('what the loose `phone` format lets through', () => {
  it.each([
    ['12345', 'US', 'too-short'],
    ['12345', 'GB', 'too-short'],
    ['12345', 'DE', 'not-in-use'],
    ['(12345', 'US', 'too-short'],
    ['1.2.3.4.5', 'US', 'too-short'],
    ['00000', 'US', 'too-short'],
    ['000 000 0000', 'US', 'not-in-use'],
    ['555-0132', 'US', 'too-short'],
    ['123456789012345678', 'US', 'too-long'],
    ['+1 222 222 222 222 222 222', 'US', 'too-long'],
    ['+44 7777 7777 7777 7777', 'US', 'too-long'],
    ['+44 1', 'US', 'too-short'],
    ['+1 415', 'US', 'too-short'],
    ['011 1', 'US', 'too-short'],
    ['00 4', 'DE', 'too-short'],
  ])('%s in %s is %s', (written, country, why) => {
    expect(reason(written, country)).toBe(why);
  });

  it('refuses a local number with no country to read it in', () => {
    expect(reason('415 555 0132', null)).toBe('needs-country');
    expect(reason('12345', null)).toBe('needs-country');
    expect(reason('0044 20 7946 0958', null)).toBe('needs-country');
  });
});

describe('hostile and broken values', () => {
  it.each([[null], [undefined], [4155550132], [true], [{}], [['+14155550132']], [{ toString: () => '+14155550132' }]])(
    'refuses the non-string %j',
    (value) => {
      expect(reason(value, 'US')).toBe('not-text');
    },
  );

  it.each([[''], ['   '], ['‪‬'], ['﻿']])('calls %j empty', (value) => {
    expect(reason(value, 'US')).toBe('empty');
  });

  it.each([
    ['Call 415-555-0132 now'],
    ['Tel: 415-555-0132'],
    ['1-800-FLOWERS'],
    ['415-555-0132 or 212-555-0100'],
    ['415-555-0132, 212-555-0100'],
    ['415-555-0132; 212-555-0100'],
    ['415/555/0132'],
    ['415-555-0132 /'],
    ['415-555-0132 / x7'],
    ['tel:+14155550132'],
    ['tel:+1-415-555-0132;phone-context=+44'],
    ['+1 415 555 0132\n+44 20 7946 0958'],
    ['+1415\r\n5550132'],
    ['+1415\u00005550132'],
    ['++14155550132'],
    ['+1+4155550132'],
    ['41555+50132'],
    ['<script>alert(1)</script>'],
    ["'; DROP TABLE people; --"],
    ['${jndi:ldap://x}'],
    ['4155550132 ext'],
    ['4155550132 ext 12345678'],
    ['+'],
    ['()'],
    ['---'],
  ])('refuses %j', (value) => {
    expect(reason(value, 'US')).toBe('not-a-number');
  });

  it('refuses digits the library would silently skip', () => {
    // Devanagari 123: read past, these would leave a valid US number.
    expect(reason('१२३ 415 555 0132', 'US')).toBe('not-a-number');
    expect(reason('415 555 013२', 'US')).toBe('not-a-number');
  });

  it('refuses a direction override, which shows one number and holds another', () => {
    expect(reason('‮2310 555 514', 'US')).toBe('not-a-number');
    expect(reason('‭4155550132', 'US')).toBe('not-a-number');
    expect(reason('‫4155550132', 'US')).toBe('not-a-number');
  });

  it('stays fast and refuses very long input', () => {
    const started = performance.now();
    for (const value of ['1'.repeat(1_000_000), '+' + '( '.repeat(500_000), `${' '.repeat(65)}1`, 'x'.repeat(1_000_000)]) {
      expect(reason(value, 'US')).not.toBe('read');
    }
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it('refuses a real number padded past the length limit', () => {
    expect(reason(`+1${' '.repeat(70)}415 555 0132`, 'US')).toBe('not-a-number');
    expect(reason(`+1${' '.repeat(50)}415 555 0132`, 'US')).toBe('read'); // exactly 64
  });

  it('never throws, and anything it accepts is exact and repeatable', () => {
    const alphabet = [...'0123456789+-(). /#xX,;:*\n\t\u0000٠١۹５＋‪‮ ext१'];
    let seed = 80;
    const next = (below: number): number => {
      seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff;
      return seed % below;
    };
    const countries = ['US', 'GB', 'DE', 'FR', 'EG', 'CN', 'IN', 'BR', null];

    for (let i = 0; i < 20_000; i += 1) {
      const value = Array.from({ length: next(24) }, () => alphabet[next(alphabet.length)]).join('');
      const result = parsePhone(value, countries[next(countries.length)] ?? null);
      if (!result.ok) continue;
      expect(result.e164).toMatch(E164);
      expect(read(result.e164, null).e164).toBe(result.e164);
    }
  });

  it.each([['XX'], ['UK'], ['ZZ'], ['USA'], ['U'], [''], ['001'], ['__proto__'], ['constructor'], ['toString'], ['U S']])(
    'refuses the country %j, even for a number that did not need it',
    (country) => {
      expect(reason('+14155550132', country)).toBe('bad-country');
      expect(reason('4155550132', country)).toBe('bad-country');
    },
  );

  it.each([['ß'], ['ﬁ'], ['ﬀ'], ['ſs'], ['Ｕｓ']])('does not let %j case-fold into a real country', (country) => {
    expect(reason('+14155550132', country)).toBe('bad-country');
  });

  it.each([[undefined], [5], [{}], [['US']]])('refuses the non-string country %j', (country) => {
    expect(reason('+14155550132', country as unknown as string)).toBe('bad-country');
  });

  it('refuses a calling code that does not exist', () => {
    expect(reason('+999 123456789', 'US')).toBe('bad-calling-code');
    expect(reason('+0 415 555 0132', 'US')).toBe('bad-calling-code');
  });

  it('refuses global service numbers, which have no country', () => {
    expect(reason('+800 1234 5678', 'US')).toBe('no-country');
    expect(reason('+881 6 1234 5678', 'US')).toBe('no-country');
  });

  it('does not repair a number by guessing', () => {
    // Mexico's old mobile "1" is gone from the plan, and a shorter tail is another person.
    expect(reason('+52 1 55 1234 5678', 'MX')).not.toBe('read');
    expect(read('+1 415 555 0132', 'US').e164).not.toBe(read('+44 20 7946 0958', 'US').e164);
  });
});

describe('e164 is a stable key', () => {
  it('keeps two people with the same last digits apart, unlike the erasure match', () => {
    const us = read('+1 212 555 0132', null);
    const canada = read('+1 416 555 0132', null);
    expect(us.e164).not.toBe(canada.e164);
    expect(read('+49 170 1234567', null).e164).not.toBe(read('+43 670 1234567', null).e164);
  });

  it('gives every way of writing one number the same key', () => {
    const forms = ['(415) 555-0132', '415.555.0132', '1 415 555 0132', '+1-415-555-0132', '001 415 555 0132'];
    const countries = ['US', 'US', 'US', 'DE', 'DE'];
    expect(new Set(forms.map((form, i) => read(form, countries[i] ?? null).e164))).toEqual(new Set(['+14155550132']));
  });

  it('holds across every country: exact, repeatable, and its national form reads back', () => {
    const regions = util.getSupportedRegions();
    expect(regions.length).toBeGreaterThan(240);
    let checked = 0;

    for (const region of regions) {
      for (const type of [phoneLib.PhoneNumberType.MOBILE, phoneLib.PhoneNumberType.FIXED_LINE]) {
        const example = util.getExampleNumberForType(region, type);
        if (!example) continue;
        const written = util.format(example, phoneLib.PhoneNumberFormat.INTERNATIONAL);
        const result = read(written, region);
        checked += 1;

        expect(result.e164).toMatch(E164);
        expect(read(result.e164, null).e164).toBe(result.e164);
        expect(read(result.e164, 'US').e164).toBe(result.e164);
        expect(read(result.national, result.country).e164).toBe(result.e164);
        expect(read(result.nationalDigits, result.country).e164).toBe(result.e164);
      }
    }
    expect(checked).toBeGreaterThan(480);
  });
});
