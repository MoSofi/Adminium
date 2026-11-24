// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The counter is a copy of the server's rules, so it is held to the server's
 * own cases (`apps/server/test/sms-send-rules.test.ts`) and to every text of
 * the design data block, as that block's `countText` counted them.
 */
import { describe, expect, it } from 'vitest';

import { DATA_BLOCK_TEXTS } from './textCounter.fixture.js';
import {
  REPLY_STOP_LINE,
  SEGMENT_TABLES,
  TEXT_MAX_SEGMENTS,
  asksForYes,
  composeText,
  estimateLength,
  optOutFor,
  optOutLine,
  placeholderNames,
  readsCredential,
  unicodeCharacters,
  withPlainCharacters,
  type ComposeInput,
  type SegmentTable,
} from './textCounter.js';

const TABLE: Readonly<Record<'standard' | 'caLong' | 'tollFree', SegmentTable>> = { standard: 'standard', caLong: 'canadaLongCode', tollFree: 'tollFree' };
const segments = (body: string, table: SegmentTable = 'standard'): number => estimateLength(body, SEGMENT_TABLES[table]).segments;

describe('the server’s own length cases', () => {
  it('counts standard texts at 160, then 153', () => {
    expect(segments('a'.repeat(160))).toBe(1);
    expect(segments('a'.repeat(161))).toBe(2);
    expect(segments('a'.repeat(306))).toBe(2);
    expect(segments('a'.repeat(307))).toBe(3);
    expect(estimateLength('hello', SEGMENT_TABLES.standard)).toMatchObject({ encoding: 'gsm-7', units: 5, segments: 1 });
    expect(segments('')).toBe(0);
  });

  it('counts Unicode texts at 70, then 67', () => {
    expect(segments('ç'.repeat(70))).toBe(1);
    expect(segments('ç'.repeat(71))).toBe(2);
    expect(segments('ç'.repeat(134))).toBe(2);
    expect(segments('ç'.repeat(135))).toBe(3);
  });

  it('counts an escaped character twice, and never cuts one across segments', () => {
    expect(estimateLength('€'.repeat(80), SEGMENT_TABLES.standard)).toMatchObject({ units: 160, segments: 1 });
    expect(segments('€'.repeat(81))).toBe(2);
    expect(segments(`${'a'.repeat(152)}€${'a'.repeat(152)}`)).toBe(3);
    expect(estimateLength('😀', SEGMENT_TABLES.standard)).toMatchObject({ encoding: 'ucs-2', units: 2, characters: 1 });
    expect(segments(`${'ç'.repeat(66)}😀${'ç'.repeat(66)}`)).toBe(3);
  });

  it('reads Canada’s long codes at 136 and toll-free at 152 and 66', () => {
    expect(segments('a'.repeat(136), 'canadaLongCode')).toBe(1);
    expect(segments('a'.repeat(137), 'canadaLongCode')).toBe(2);
    expect(segments('a'.repeat(160), 'tollFree')).toBe(1);
    expect(segments('a'.repeat(305), 'tollFree')).toBe(3);
    expect(segments('ç'.repeat(133), 'tollFree')).toBe(3);
  });

  it('writes the server’s opt-out lines', () => {
    const business = { name: 'Lumen', phone: '+49301234567', email: 'hello@lumen.example' };
    expect(optOutLine('reply-stop', 'DE', business)).toBe('Reply STOP to opt out.');
    expect(optOutLine('through-business', 'DE', business)).toBe('To stop these texts, contact +49301234567.');
    expect(optOutLine('through-business', 'DE', { name: 'Lumen', email: 'hello@lumen.example' })).toBe('To stop these texts, contact hello@lumen.example.');
    expect(optOutLine('through-business', 'DE', { name: 'Lumen' })).toBeNull();
    expect(optOutLine('through-business', 'DE', { name: 'Lumen', phone: ' ', email: '' })).toBeNull();
    expect(optOutLine('through-business', 'FR', business)).toBe('To stop these texts, contact hello@lumen.example.');
    expect(optOutLine('through-business', 'FR', { name: 'Lumen', phone: '+33123456789' })).toBeNull();
    expect(optOutLine('through-business', 'AE', business)).toBe('To stop these texts, contact Lumen.');
    expect(optOutLine('through-business', 'AE', { name: ' ', phone: '+97141234567' })).toBeNull();
  });

  it('says Reply STOP only from a number, to a country with replies, on a server that reads them', () => {
    expect(optOutFor('number', 'US', true)).toBe('reply-stop');
    expect(optOutFor('number', 'US', false)).toBe('through-business');
    expect(optOutFor('name', 'GB', true)).toBe('through-business');
    expect(optOutFor('number', 'TW', true)).toBe('through-business');
    expect(optOutFor('pool', 'US', true)).toBe('through-business');
  });
});

describe('the design data block', () => {
  it.each(DATA_BLOCK_TEXTS)('%s', (_what, text, table, encoding, characters, units, count, left) => {
    expect(estimateLength(text, SEGMENT_TABLES[TABLE[table]])).toMatchObject({ encoding, characters, units, segments: count, left });
  });

  it('shows the comp’s cases: Dana is one standard segment, Zoë’s “ë” makes two Unicode ones', () => {
    const dana = DATA_BLOCK_TEXTS.find((row) => row[0] === 'g02 prearrival')!;
    const zoe = DATA_BLOCK_TEXTS.find((row) => row[0] === 'g01 prearrival')!;
    expect(estimateLength(dana[1], SEGMENT_TABLES.standard)).toMatchObject({ encoding: 'gsm-7', segments: 1 });
    expect(estimateLength(zoe[1], SEGMENT_TABLES.standard)).toMatchObject({ encoding: 'ucs-2', segments: 2 });
    expect(unicodeCharacters(zoe[1])).toEqual(['ë']);
    expect(unicodeCharacters(dana[1])).toEqual([]);
  });
});

describe('one finished text', () => {
  const base: ComposeInput = {
    template: '{{hotel}}: Hi {{name}}, we expect you on {{date}}.',
    values: { hotel: 'Wren House', name: 'Dana', date: 'Fri 31 Jul' },
    optOut: 'reply-stop',
    country: 'US',
    business: { name: 'Wren House', phone: '+1 207 555 0142', email: null },
    table: 'standard',
  };

  it('fills, adds the line, and counts the result', () => {
    const composed = composeText(base);
    expect(composed.body).toBe(`Wren House: Hi Dana, we expect you on Fri 31 Jul. ${REPLY_STOP_LINE}`);
    expect(composed.problems).toEqual([]);
    expect(composed.estimate).toMatchObject({ encoding: 'gsm-7', segments: 1 });
  });

  it('counts after filling: one name changes the encoding', () => {
    expect(composeText({ ...base, values: { ...base.values, name: 'Zoë' } }).estimate.encoding).toBe('ucs-2');
  });

  it('keeps a template’s own Reply STOP from a number, and drops it from a name', () => {
    const own = { ...base, template: 'Hi {{name}}. Reply STOP to opt out.' };
    expect(composeText(own).body).toBe('Hi Dana. Reply STOP to opt out.');
    expect(composeText({ ...own, optOut: 'through-business' }).body).toBe('Hi Dana. To stop these texts, contact +1 207 555 0142.');
  });

  it('marks a missing value and leaves the placeholder where it was', () => {
    const composed = composeText({ ...base, values: { hotel: 'Wren House', date: 'x' } });
    expect(composed.problems).toContainEqual({ kind: 'missing', names: ['name'] });
    expect(composed.body).toContain('{{name}}');
  });

  it('refuses what a text may not carry', () => {
    expect(composeText({ ...base, template: 'Reply YES to confirm.' }).problems).toContainEqual({ kind: 'asks-for-yes' });
    expect(composeText({ ...base, template: 'Sign in: {{signInLink}}' }).problems).toContainEqual({ kind: 'credential', names: ['signInLink'] });
    expect(composeText({ ...base, template: 'Your code {{booking.access_code}}' }).problems).toContainEqual({ kind: 'credential', names: ['booking.access_code'] });
    expect(composeText({ ...base, template: 'See https://bit.ly/abc' }).problems).toContainEqual({ kind: 'short-link' });
    expect(composeText({ ...base, optOut: 'through-business', business: { name: 'Wren House' } }).problems).toContainEqual({ kind: 'no-opt-out-contact' });
  });

  it('refuses a text over six segments', () => {
    const room = 6 * 153 - REPLY_STOP_LINE.length - 1;
    expect(composeText({ ...base, template: 'a'.repeat(room), values: {} }).estimate).toMatchObject({ segments: TEXT_MAX_SEGMENTS, tooLong: false });
    expect(composeText({ ...base, template: 'a'.repeat(room + 1), values: {} }).problems).toContainEqual({ kind: 'too-long' });
  });
});

describe('the small helpers', () => {
  it('reads the manifest’s credential names and “Reply YES” in every language', () => {
    expect(readsCredential('signInLink')).toBe(true);
    expect(readsCredential('booking.pin')).toBe(true);
    expect(readsCredential('ticket.qr')).toBe(true);
    expect(readsCredential('postal_code')).toBe(false);
    expect(readsCredential('name')).toBe(false);
    for (const yes of ['Reply YES', 'Antworten Sie mit JA', 'Répondez OUI', 'Svar JA', 'Odpovězte ANO', 'أرسل نعم', '回复是']) expect(asksForYes(yes), yes).toBe(true);
    expect(asksForYes('Yes, your room is ready.')).toBe(false);
  });

  it('offers a plain character for a typed curly apostrophe and an en dash', () => {
    expect(withPlainCharacters('Zoë’s room – ready')).toBe("Zoë's room - ready");
    expect(unicodeCharacters('it’s – fine')).toEqual(['’', '–']);
  });

  it('names each placeholder once, in reading order', () => {
    expect(placeholderNames('{{hotel}}: {{name}}, {{ name }} {{date|soon}}')).toEqual(['hotel', 'name', 'date']);
  });
});
