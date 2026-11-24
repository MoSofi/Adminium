// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The rules of a text that need no store: how long it is, what a template may
 * say, the opt-out it carries, when it may go, and the limit's settings.
 */
import { REVIEW_LINK_VARIABLE, STOP_LINK_VARIABLE, SURVEY_LINK_VARIABLE } from '@adminium/manifest';
import { describe, expect, it } from 'vitest';

import { OBJECT_LINK_VARIABLE } from '../src/leads/object-token.js';
import { clockIn } from '../src/notifications/quiet.js';
import { CALENDAR_GOOGLE_VARIABLE, CALENDAR_OUTLOOK_VARIABLE } from '../src/outbox/calendar-part.js';
import {
  asksForYes,
  checkTextTemplate,
  composeText,
  dayKey,
  DEFAULT_SERVICE_HOURS,
  DEFAULT_TEXT_DAILY_LIMIT,
  estimateLength,
  fillText,
  judgeWindow,
  limitsFor,
  MAX_TEXT_DAILY_LIMIT,
  optOutLine,
  readsCredential,
  readTextPolicy,
  saysStop,
  TEXT_MAX_SEGMENTS,
  TEXT_VALUE_MAX,
  warningAt,
  withoutStopSentence,
  zonesOfCountry,
  type ComposeInput,
  type WindowQuestion,
} from '../src/sms/send/index.js';
import type { SmsSender } from '../src/sms/types.js';

const LONG_CODE: SmsSender = { kind: 'number', value: '+14155550100' };
const TOLL_FREE: SmsSender = { kind: 'number', value: '+18005550100' };
const NAME: SmsSender = { kind: 'name', value: 'Lumen' };
const POOL: SmsSender = { kind: 'pool', value: 'pool' };
const standard = limitsFor('DE', LONG_CODE);
const segments = (body: string, limits = standard): number => estimateLength(body, limits).segments;

describe('message length', () => {
  it('counts GSM-7 at 160, then 153', () => {
    expect(segments('a'.repeat(160))).toBe(1);
    expect(segments('a'.repeat(161))).toBe(2);
    expect(segments('a'.repeat(306))).toBe(2);
    expect(segments('a'.repeat(307))).toBe(3);
    expect(estimateLength('hello', standard)).toEqual({ encoding: 'gsm-7', units: 5, segments: 1 });
    expect(segments('')).toBe(0);
  });

  it('counts UCS-2 at 70, then 67', () => {
    expect(segments('ç'.repeat(70))).toBe(1);
    expect(segments('ç'.repeat(71))).toBe(2);
    expect(segments('ç'.repeat(134))).toBe(2);
    expect(segments('ç'.repeat(135))).toBe(3);
  });

  it('one character outside GSM-7 moves the whole text to UCS-2', () => {
    const body = `${'a'.repeat(100)}č`;
    expect(estimateLength(body, standard)).toMatchObject({ encoding: 'ucs-2', segments: 2 });
    expect(estimateLength('a'.repeat(101), standard)).toMatchObject({ encoding: 'gsm-7', segments: 1 });
  });

  it('counts a GSM escape character as two and never cuts it', () => {
    expect(estimateLength('€'.repeat(80), standard)).toMatchObject({ units: 160, segments: 1 });
    expect(segments('€'.repeat(81))).toBe(2);
    // 306 units would fit two segments if the € could be cut.
    expect(segments(`${'a'.repeat(152)}€${'a'.repeat(152)}`)).toBe(3);
  });

  it('counts an emoji as two units and never cuts it', () => {
    expect(estimateLength('😀', standard)).toMatchObject({ encoding: 'ucs-2', units: 2 });
    expect(segments(`${'ç'.repeat(66)}😀${'ç'.repeat(66)}`)).toBe(3);
  });

  it('reads the per-destination table', () => {
    const canada = limitsFor('CA', LONG_CODE);
    expect(segments('a'.repeat(136), canada)).toBe(1);
    expect(segments('a'.repeat(137), canada)).toBe(2);
    const tollFree = limitsFor('US', TOLL_FREE);
    expect(segments('a'.repeat(160), tollFree)).toBe(1);
    expect(segments('a'.repeat(305), tollFree)).toBe(3);
    expect(segments('ç'.repeat(133), tollFree)).toBe(3);
    expect(limitsFor('CA', TOLL_FREE)).toEqual(tollFree);
    expect(limitsFor('US', LONG_CODE)).toEqual(standard);
    expect(limitsFor('US', POOL)).toEqual(tollFree);
    expect(limitsFor('CA', POOL)).toEqual(canada);
    expect(limitsFor('DE', TOLL_FREE)).toEqual(standard);
  });
});

describe('what a template may read', () => {
  it.each(['signInLink', SURVEY_LINK_VARIABLE, REVIEW_LINK_VARIABLE, STOP_LINK_VARIABLE, OBJECT_LINK_VARIABLE, CALENDAR_GOOGLE_VARIABLE, CALENDAR_OUTLOOK_VARIABLE, 'order.ticket.qr', 'order.ticket.grouped', 'door_code', 'booking.code', 'accessCode', 'member.pin', 'otp', 'reset_token', 'user.password', 'api_secret'])('refuses {{%s}}', (name) => {
    expect(checkTextTemplate(`Hello {{${name}}}`)).toEqual({ ok: false, reason: 'credential-in-template', names: [name] });
  });

  it.each(['postal_code', 'order.zip_code', 'country_code', 'postalCode', 'currency_code', 'customer.name', 'visit.starts_at.time', 'appName', 'pinned_note'])('allows {{%s}}', (name) => {
    expect(readsCredential(name)).toBe(false);
  });

  it('refuses a column the app declares as a code, and its forms', () => {
    expect(readsCredential('guest.locker', ['guest.locker'])).toBe(true);
    expect(readsCredential('guest.locker.label', ['guest.locker'])).toBe(true);
    expect(readsCredential('guest.lockers', ['guest.locker'])).toBe(false);
  });

  it.each(['Reply YES to confirm', 'please text yes back', 'Antworte mit JA', 'Svar JA for at bekræfte', 'Répondez OUI', 'Odpovězte ANO', 'رد بكلمة نعم', '回复“是”确认'])('refuses a request for a yes: %s', (words) => {
    expect(asksForYes(words)).toBe(true);
    expect(checkTextTemplate(words)).toMatchObject({ ok: false, reason: 'asks-for-yes' });
  });

  it.each(['Your table is ready', 'Yes, we are open today', 'Reply STOP to opt out.', 'Ja, wir haben geöffnet'])('does not read this as asking for a yes: %s', (words) => {
    expect(asksForYes(words)).toBe(false);
  });

  it('refuses an empty template', () => {
    expect(checkTextTemplate('  ')).toEqual({ ok: false, reason: 'template-empty' });
  });
});

describe('filling a text', () => {
  it('writes values with no escaping, and a backup for an empty one', () => {
    expect(fillText('{{a}} & {{b|friend}}', { a: 'Tom & Co', b: ' ' })).toEqual({ ok: true, body: 'Tom & Co & friend' });
  });

  it.each([
    ['a name nobody gave', 'Hi {{missing}}', {}],
    ['an empty value', 'Hi {{name}}', { name: '' }],
    ['a value of spaces', 'Hi {{name}}', { name: '   ' }],
    ['a value of control characters', 'Hi {{name}}', { name: '\u0007\u0008' }],
    ['a broken placeholder', 'Hi {{name', { name: 'x' }],
    ['a stray close', 'Hi name}}', {}],
    ['a value that spells a placeholder', 'Hi {{name}}', { name: '{{other}}' }],
  ])('refuses %s', (_label, template, values) => {
    expect(fillText(template, values as Record<string, string>)).toEqual({ ok: false, reason: 'unfilled-placeholder' });
  });

  it('fills once: a value is never read as a placeholder of its own', () => {
    expect(fillText('{{a}}', { a: '{b}' })).toEqual({ ok: true, body: '{b}' });
  });

  it('keeps a value on one line, with nothing that reorders it', () => {
    expect(fillText('Hi {{name}}!', { name: 'Tom\nCall now‮evil' })).toEqual({ ok: true, body: 'Hi Tom Call now evil!' });
  });

  it('refuses a value past its length', () => {
    expect(fillText('{{a}}', { a: 'x'.repeat(TEXT_VALUE_MAX) }).ok).toBe(true);
    expect(fillText('{{a}}', { a: 'x'.repeat(TEXT_VALUE_MAX + 1) })).toEqual({ ok: false, reason: 'value-too-long' });
  });

  it.each(['see https://evil.example', 'HTTP://evil.example', 'www.evil.example', 'evil.example/win'])('refuses a link in a value: %s', (value) => {
    expect(fillText('Hi {{name}}', { name: value })).toEqual({ ok: false, reason: 'value-has-link' });
  });

  it('keeps a link written in the template, and refuses an address in a value, which a phone makes a link of', () => {
    expect(fillText('See https://lumen.example {{who}}', { who: 'Tom' }).ok).toBe(true);
    expect(fillText('See https://lumen.example {{who}}', { who: 'tom@lumen.example' })).toEqual({ ok: false, reason: 'value-has-link' });
  });
});

describe('the opt-out line', () => {
  const business = { name: 'Lumen', phone: '+49301234567', email: 'hello@lumen.example' };

  it('a number says Reply STOP', () => {
    expect(optOutLine('reply-stop', 'DE', business)).toBe('Reply STOP to opt out.');
  });

  it('a name gives the business, phone first', () => {
    expect(optOutLine('through-business', 'DE', business)).toBe('To stop these texts, contact +49301234567.');
    expect(optOutLine('through-business', 'DE', { name: 'Lumen', email: 'hello@lumen.example' })).toBe('To stop these texts, contact hello@lumen.example.');
  });

  it('with no contact there is no line', () => {
    expect(optOutLine('through-business', 'DE', { name: 'Lumen' })).toBeNull();
    expect(optOutLine('through-business', 'DE', { name: 'Lumen', phone: ' ', email: '' })).toBeNull();
  });

  it('France takes an e-mail address, never a phone', () => {
    expect(optOutLine('through-business', 'FR', business)).toBe('To stop these texts, contact hello@lumen.example.');
    expect(optOutLine('through-business', 'FR', { name: 'Lumen', phone: '+33123456789' })).toBeNull();
  });

  it('the UAE takes the name alone', () => {
    expect(optOutLine('through-business', 'AE', business)).toBe('To stop these texts, contact Lumen.');
    expect(optOutLine('through-business', 'AE', { name: ' ', phone: '+97141234567' })).toBeNull();
  });

  it('takes a STOP sentence out, and leaves a dotted placeholder whole', () => {
    expect(withoutStopSentence('{{practice.name}}: visit {{visit.time}}. Reply STOP to opt out.')).toBe('{{practice.name}}: visit {{visit.time}}.');
    expect(withoutStopSentence('Reply STOP to leave {{practice.name}}. See you soon!')).toBe('See you soon!');
    expect(withoutStopSentence('Your table is ready.')).toBe('Your table is ready.');
    expect(withoutStopSentence('Do not stop here.')).toBe('Do not stop here.');
  });

  it.each([
    ['Visit at 10:30. Reply Stop to opt out.', 'Visit at 10:30.'],
    ['Visit at 10:30. reply stop to opt out.', 'Visit at 10:30.'],
    ['Termin um 10:30. Antworten Sie STOPP zum Abmelden.', 'Termin um 10:30.'],
    ['Termin um 10:30. Mit Stopp antworten.', 'Termin um 10:30.'],
    ['Visit at 10:30. Text END to opt out.', 'Visit at 10:30.'],
    ['Visit at 10:30. Reply with the word cancel.', 'Visit at 10:30.'],
    ['Visit at 10:30. Send UNSUBSCRIBE.', 'Visit at 10:30.'],
    ['Rendez-vous 10:30. Répondez ARRET.', 'Rendez-vous 10:30.'],
    ['Návštěva 10:30. Odpovězte KONEC.', 'Návštěva 10:30.'],
    ['预约 10:30。回复退订。', '预约 10:30。'],
  ])('takes the reply promise out of %s', (template, left) => {
    expect(withoutStopSentence(template)).toBe(left);
    const made = composeText({ template, values: {}, optOut: 'through-business', country: 'DE', sender: { kind: 'name', value: 'Lumen' }, business: { name: 'Lumen', phone: '+4930123456' } });
    expect(made).toMatchObject({ ok: true, body: `${left} To stop these texts, contact +4930123456.` });
  });

  it.each(['Your visit will end at 5.', 'We will send your receipt at the end.', 'You can cancel online.', 'Text us when you stop by.', 'To unsubscribe, call us.', 'END OF SEASON SALE TODAY.'])('leaves an ordinary sentence alone: %s', (words) => {
    expect(withoutStopSentence(words)).toBe(words);
  });

  it('refuses a filled value that brings the promise back', () => {
    const made = composeText({ template: 'Hi {{name}}.', values: { name: 'Tom. Reply STOP' }, optOut: 'through-business', country: 'DE', sender: { kind: 'name', value: 'Lumen' }, business: { name: 'Lumen', phone: '+4930123456' } });
    expect(made).toEqual({ ok: false, reason: 'promises-reply' });
  });

  it('a name that is a stop word is only a name', () => {
    const made = composeText({ template: 'Hi {{name}}.', values: { name: 'END' }, optOut: 'through-business', country: 'DE', sender: { kind: 'name', value: 'Lumen' }, business: { name: 'Lumen', phone: '+4930123456' } });
    expect(made).toMatchObject({ ok: true });
  });

  it('a number keeps a stop line it already has, in any listed word, and adds one to a mere mention', () => {
    const base = { values: {}, optOut: 'reply-stop' as const, country: 'DE', sender: { kind: 'number' as const, value: '+4930123456' }, business: { name: 'Lumen' } };
    expect(composeText({ ...base, template: 'Visit at 10:30. Text END to opt out.' })).toMatchObject({ ok: true, body: 'Visit at 10:30. Text END to opt out.' });
    expect(composeText({ ...base, template: 'CANCEL your visit online.' })).toMatchObject({ ok: true, body: 'CANCEL your visit online. Reply STOP to opt out.' });
  });

  it('reads STOP in the words, never in a placeholder', () => {
    expect(saysStop('Reply STOP.')).toBe(true);
    expect(saysStop('Hello {{STOP}}')).toBe(false);
    expect(saysStop('Please stop by')).toBe(false);
  });
});

describe('a finished text', () => {
  const base: ComposeInput = { template: 'Hi {{name}}, table at {{time}}.', values: { name: 'Tom', time: '19:00' }, optOut: 'reply-stop', country: 'DE', sender: LONG_CODE, business: { name: 'Lumen', email: 'hello@lumen.example' } };

  it('adds the line, once', () => {
    expect(composeText(base)).toMatchObject({ ok: true, body: 'Hi Tom, table at 19:00. Reply STOP to opt out.' });
    expect(composeText({ ...base, template: 'Hi {{name}}. Reply STOP to opt out.' })).toMatchObject({ ok: true, body: 'Hi Tom. Reply STOP to opt out.' });
  });

  it('a name never says Reply STOP, even when its template does', () => {
    const made = composeText({ ...base, template: 'Hi {{name}}. Reply STOP to opt out.', optOut: 'through-business', sender: NAME });
    expect(made).toMatchObject({ ok: true, body: 'Hi Tom. To stop these texts, contact hello@lumen.example.' });
  });

  it('a value saying STOP does not count as the opt-out line', () => {
    expect(composeText({ ...base, template: 'Hi {{name}}.', values: { name: 'STOP' } })).toMatchObject({ ok: true, body: 'Hi STOP. Reply STOP to opt out.' });
  });

  it('counts after filling: one name can change the encoding', () => {
    const plain = composeText({ ...base, values: { name: 'Tom', time: '19:00' } });
    const named = composeText({ ...base, values: { name: 'Tomáš', time: '19:00' } });
    expect(plain).toMatchObject({ estimate: { encoding: 'gsm-7' } });
    expect(named).toMatchObject({ estimate: { encoding: 'ucs-2' } });
  });

  it('refuses a text over the limit', () => {
    const line = ' Reply STOP to opt out.';
    const room = 153 * TEXT_MAX_SEGMENTS - line.length;
    expect(composeText({ ...base, template: 'a'.repeat(room), values: {} })).toMatchObject({ ok: true, estimate: { segments: TEXT_MAX_SEGMENTS } });
    expect(composeText({ ...base, template: 'a'.repeat(room + 1), values: {} })).toEqual({ ok: false, reason: 'too-long' });
  });

  it('refuses what the parts refuse', () => {
    expect(composeText({ ...base, template: 'Code {{door_code}}', values: { door_code: '1234' } })).toEqual({ ok: false, reason: 'credential-in-template' });
    expect(composeText({ ...base, values: { name: 'Tom' } })).toEqual({ ok: false, reason: 'unfilled-placeholder' });
    expect(composeText({ ...base, optOut: 'through-business', sender: NAME, business: { name: 'Lumen' } })).toEqual({ ok: false, reason: 'no-opt-out-contact' });
    expect(composeText({ ...base, template: 'Reply STOP.', values: {}, optOut: 'through-business', sender: NAME })).toEqual({ ok: false, reason: 'template-empty' });
  });

  it('a value cannot finish a request for a yes', () => {
    expect(composeText({ ...base, template: 'Reply {{word}} now.', values: { word: 'YES' } })).toEqual({ ok: false, reason: 'asks-for-yes' });
  });
});

describe('send windows', () => {
  const ask = (at: string, more: Partial<WindowQuestion> = {}) =>
    judgeWindow({ timing: 'service', at: Date.parse(at), zone: 'Europe/Berlin', country: 'DE', serviceHours: DEFAULT_SERVICE_HOURS, notAfter: null, ...more });
  const until = (at: string) => ({ go: false, until: Date.parse(at) });

  it('opens at 08:00 and closes at 21:00 on the business clock', () => {
    // Berlin is UTC+2 in June.
    expect(ask('2026-06-15T05:59:59Z')).toEqual(until('2026-06-15T06:00:00Z'));
    expect(ask('2026-06-15T06:00:00Z')).toEqual({ go: true });
    expect(ask('2026-06-15T18:59:59Z')).toEqual({ go: true });
    expect(ask('2026-06-15T19:00:00Z')).toEqual(until('2026-06-16T06:00:00Z'));
  });

  it('holds across midnight', () => {
    expect(ask('2026-06-15T22:30:00Z')).toEqual(until('2026-06-16T06:00:00Z'));
  });

  it('reads edited hours, including a window across midnight', () => {
    const late = { serviceHours: { from: '18:00', to: '02:00' } };
    expect(ask('2026-06-15T20:00:00Z', late)).toEqual({ go: true });
    expect(ask('2026-06-15T23:59:00Z', late)).toEqual({ go: true });
    expect(ask('2026-06-16T00:00:00Z', late)).toEqual(until('2026-06-16T16:00:00Z'));
  });

  it('no zone, or an unusable one, reads the destination country\'s zones, never UTC', () => {
    // 08:00 UTC is 10:00 in Berlin: open for a German number, though UTC would say so too.
    expect(ask('2026-06-15T05:59:00Z', { zone: 'Mars/Olympus' })).toEqual(until('2026-06-15T06:00:00Z'));
    expect(ask('2026-06-15T05:59:00Z', { zone: null })).toEqual(until('2026-06-15T06:00:00Z'));
    // 20:00 UTC is 22:00 in Berlin: shut, though UTC would read it open.
    expect(ask('2026-06-15T20:00:00Z', { zone: null })).toEqual(until('2026-06-16T06:00:00Z'));
  });

  it.each([
    ['Berlin, spring forward', 'Europe/Berlin', '2026-03-29T00:30:00Z', '2026-03-29T06:00:00Z'],
    ['Berlin, fall back', 'Europe/Berlin', '2026-10-25T00:30:00Z', '2026-10-25T07:00:00Z'],
    ['New York, spring forward', 'America/New_York', '2026-03-08T06:30:00Z', '2026-03-08T12:00:00Z'],
    ['New York, fall back', 'America/New_York', '2026-11-01T05:30:00Z', '2026-11-01T13:00:00Z'],
  ])('finds 08:00 across %s', (_label, zone, at, opens) => {
    expect(ask(at, { zone })).toEqual(until(opens));
  });

  it('closes at 21:00 on both sides of a clock change', () => {
    expect(ask('2026-03-28T19:59:00Z')).toEqual({ go: true });
    expect(ask('2026-03-28T20:00:00Z')).toEqual(until('2026-03-29T06:00:00Z'));
    expect(ask('2026-10-25T19:59:00Z')).toEqual({ go: true });
    expect(ask('2026-10-25T20:00:00Z')).toEqual(until('2026-10-26T07:00:00Z'));
  });

  it('an opening hour the clock skips still ends the wait that day', () => {
    // 02:30 does not exist in New York on 8 March 2026.
    for (const [zone, day, hours] of [['America/New_York', '2026-11-01', { from: '01:30', to: '23:00' }], ['Europe/London', '2026-10-25', { from: '01:30', to: '23:00' }], ['America/Havana', '2026-11-01', { from: '00:30', to: '02:30' }]] as const) {
      const inside = (at: number): boolean => {
        const { minutes } = clockIn(at, zone);
        const [from, to] = [hours.from, hours.to].map((one) => Number(one.slice(0, 2)) * 60 + Number(one.slice(3)));
        return minutes >= from! && minutes < to!;
      };
      const start = Date.parse(`${day}T00:00:00Z`) - 86_400_000;
      for (let at = start; at < start + 3 * 86_400_000; at += 5 * 60_000) {
        const answer = judgeWindow({ timing: 'service', at, zone, country: 'US', serviceHours: hours, notAfter: null });
        if (answer.go) expect(inside(at), `${zone} ${new Date(at).toISOString()}`).toBe(true);
        else if ('until' in answer) expect(inside(answer.until), `${zone} until ${new Date(answer.until).toISOString()}`).toBe(true);
      }
    }
    const verdict = ask('2026-03-08T06:00:00Z', { zone: 'America/New_York', serviceHours: { from: '02:30', to: '21:00' } });
    expect(verdict.go).toBe(false);
    const opens = (verdict as { until: number }).until;
    expect(opens).toBeGreaterThan(Date.parse('2026-03-08T06:00:00Z'));
    expect(opens).toBeLessThanOrEqual(Date.parse('2026-03-09T06:30:00Z'));
    expect(ask(new Date(opens).toISOString(), { zone: 'America/New_York', serviceHours: { from: '02:30', to: '21:00' } })).toEqual({ go: true });
  });

  it('a kind the customer is waiting for goes at any hour', () => {
    expect(ask('2026-06-15T01:00:00Z', { timing: 'waiting' })).toEqual({ go: true });
  });

  describe('a text about a moment', () => {
    const night = '2026-06-15T22:00:00Z';
    it('waits when the window opens before it', () => {
      expect(ask(night, { notAfter: Date.parse('2026-06-16T07:00:00Z') })).toEqual(until('2026-06-16T06:00:00Z'));
    });
    it('is skipped when the window would open after it', () => {
      expect(ask(night, { notAfter: Date.parse('2026-06-16T05:00:00Z') })).toEqual({ go: false, skip: 'past-its-moment' });
    });
    it('is skipped when the window would open exactly at it', () => {
      expect(ask(night, { notAfter: Date.parse('2026-06-16T06:00:00Z') })).toEqual({ go: false, skip: 'past-its-moment' });
    });
    it('is skipped once the moment has passed, even for a kind that goes at any hour', () => {
      expect(ask('2026-06-15T12:00:00Z', { timing: 'waiting', notAfter: Date.parse('2026-06-15T12:00:00Z') })).toEqual({ go: false, skip: 'past-its-moment' });
    });
    it('goes in an open window before it', () => {
      expect(ask('2026-06-15T12:00:00Z', { notAfter: Date.parse('2026-06-15T13:00:00Z') })).toEqual({ go: true });
    });
  });

  describe('marketing', () => {
    const market = (at: string, country = 'DE') => ask(at, { timing: 'marketing', country });

    it('runs 09:00 to 20:00', () => {
      expect(market('2026-06-15T06:59:00Z')).toEqual(until('2026-06-15T07:00:00Z'));
      expect(market('2026-06-15T07:00:00Z')).toEqual({ go: true });
      expect(market('2026-06-15T17:59:00Z')).toEqual({ go: true });
      expect(market('2026-06-15T18:00:00Z')).toEqual(until('2026-06-16T07:00:00Z'));
    });

    it('sends on a Saturday, and waits through Sunday to Monday', () => {
      expect(market('2026-06-20T10:00:00Z')).toEqual({ go: true });
      expect(market('2026-06-20T18:00:00Z')).toEqual(until('2026-06-22T07:00:00Z'));
      expect(market('2026-06-21T10:00:00Z')).toEqual(until('2026-06-22T07:00:00Z'));
    });

    it('in a country of several zones, waits until it is open in all', () => {
      expect(zonesOfCountry('US').length).toBeGreaterThan(5);
      // 09:00 in New York is 03:00 in Honolulu. Monday 09:00 in Honolulu is 19:00 UTC in June.
      expect(market('2026-06-15T13:00:00Z', 'US')).toEqual(until('2026-06-15T19:00:00Z'));
      expect(market('2026-06-15T19:00:00Z', 'US')).toEqual({ go: true });
    });

    it('closes as soon as the first zone closes', () => {
      // 20:00 in New York, 14:00 in Honolulu.
      expect(market('2026-06-16T00:00:00Z', 'US').go).toBe(false);
    });

    it('finds the short overlap of a very wide country', () => {
      // Kaliningrad is UTC+2 and Kamchatka UTC+12: open from 07:00 to 08:00 UTC.
      expect(market('2026-06-15T06:00:00Z', 'RU')).toEqual(until('2026-06-15T07:00:00Z'));
      expect(market('2026-06-15T07:30:00Z', 'RU')).toEqual({ go: true });
      expect(market('2026-06-15T08:00:00Z', 'RU')).toEqual(until('2026-06-16T07:00:00Z'));
    });

    it('holds across a clock change', () => {
      expect(market('2026-03-29T10:00:00Z')).toEqual(until('2026-03-30T07:00:00Z'));
      expect(market('2026-10-24T18:00:00Z')).toEqual(until('2026-10-26T08:00:00Z'));
    });

    it('does not send where the zones never share an open hour', () => {
      // Antarctica's stations span more hours than the window is long.
      expect(market('2026-06-15T10:00:00Z', 'AQ')).toEqual({ go: false, skip: 'no-send-window' });
    });

    it('with no zones it can read, does not send', () => {
      expect(zonesOfCountry('!!')).toEqual([]);
      expect(market('2026-06-15T10:00:00Z', '!!')).toEqual({ go: false, skip: 'no-send-window' });
    });
  });
});

describe('the sending settings', () => {
  it('defaults to 500 a day and 08:00 to 21:00', () => {
    expect(readTextPolicy(undefined)).toEqual({ dailyLimit: DEFAULT_TEXT_DAILY_LIMIT, serviceHours: { from: '08:00', to: '21:00' }, dayZone: 'UTC' });
    expect(DEFAULT_TEXT_DAILY_LIMIT).toBe(500);
  });

  it.each([0, -1, 1.5, '500', null, MAX_TEXT_DAILY_LIMIT + 1, Number.NaN, Number.POSITIVE_INFINITY])('a limit of %s never means no limit', (dailyLimit) => {
    expect(readTextPolicy({ dailyLimit }).dailyLimit).toBe(DEFAULT_TEXT_DAILY_LIMIT);
  });

  it('keeps a valid edit', () => {
    expect(readTextPolicy({ dailyLimit: 40, serviceHours: { from: '09:30', to: '02:00' }, dayZone: 'Europe/Berlin' })).toEqual({ dailyLimit: 40, serviceHours: { from: '09:30', to: '02:00' }, dayZone: 'Europe/Berlin' });
  });

  it.each([{ from: '9:00', to: '21:00' }, { from: '08:00', to: '24:00' }, { from: '08:00', to: '08:00' }, { from: '08:00' }, 'always', null])('reads hours of %j as the default', (serviceHours) => {
    expect(readTextPolicy({ serviceHours }).serviceHours).toEqual({ from: '08:00', to: '21:00' });
  });

  it('warns at 80%, rounded up', () => {
    expect(warningAt(500)).toBe(400);
    expect(warningAt(7)).toBe(6);
    expect(warningAt(1)).toBe(1);
  });

  it('counts a day on the business clock', () => {
    const at = Date.parse('2026-06-15T23:30:00Z');
    expect(dayKey(at, 'UTC')).toBe('2026-06-15');
    expect(dayKey(at, 'Europe/Berlin')).toBe('2026-06-16');
    expect(dayKey(at, 'America/Los_Angeles')).toBe('2026-06-15');
    expect(dayKey(at, null)).toBe('2026-06-15');
    expect(dayKey(at, 'Mars/Olympus')).toBe('2026-06-15');
  });
});
