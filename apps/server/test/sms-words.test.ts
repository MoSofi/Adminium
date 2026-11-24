// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The words the server itself puts in a text, in the eight languages, read from
 * the catalogue (`email:texts`). Each must still do its job in every language:
 * the reply line says STOP, the contact line promises no reply, nothing asks
 * for a YES, and the "not read" answer keeps its shape.
 */
import { describe, expect, it } from 'vitest';

import { notReadText } from '../src/sms/threads/index.js';
import { asksForYes, composeText, optOutLine, repliesWithStopWord, saysStop } from '../src/sms/send/index.js';
import { STOP_CONFIRMATIONS, TEXT_LANGUAGES, textLanguageOf, textWordsFor } from '../src/sms/words.js';

const NUMBER = { kind: 'number', value: '+4930123456' } as const;
const NAME = { kind: 'name', value: 'Lumen' } as const;

describe('the catalogue words', () => {
  it('are there in all eight languages, each its own', () => {
    expect([...TEXT_LANGUAGES].sort()).toEqual(['ar-EG', 'cs-CZ', 'da-DK', 'de-DE', 'en-US', 'fr-FR', 'zh-CN', 'zh-TW']);
    for (const field of ['replyStop', 'stopConfirmed', 'test'] as const) {
      expect(new Set(TEXT_LANGUAGES.map((language) => textWordsFor(language)[field])).size, field).toBe(8);
    }
    expect(STOP_CONFIRMATIONS.size).toBe(8);
  });

  it('keep the US English words the server always had', () => {
    const english = textWordsFor('en_US');
    expect(english.replyStop).toBe('Reply STOP to opt out.');
    expect(english.contactLine('+49301234567')).toBe('To stop these texts, contact +49301234567.');
    expect(english.stopConfirmed).toBe('You are unsubscribed and will get no more texts from this business.');
    expect(english.test).toBe('Test text from Adminium. Your text message connection works.');
    expect(english.notRead('Lumen', '+4930123456')).toBe('Lumen: This number is not read. Contact us: +4930123456');
  });

  it('read any spelling of a locale, and US English for one they do not have', () => {
    expect(textLanguageOf('de_DE')).toBe('de-DE');
    expect(textLanguageOf('DE')).toBe('de-DE');
    expect(textLanguageOf('zh_HK')).toBe('zh-TW');
    expect(textLanguageOf('zh-Hans')).toBe('zh-CN');
    expect(textLanguageOf('pt-BR')).toBe('en-US');
    expect(textLanguageOf(null)).toBe('en-US');
  });

  it('put a value in as it is', () => {
    expect(textWordsFor('en-US').contactLine('$& {contact}')).toBe('To stop these texts, contact $& {contact}.');
    expect(textWordsFor('en-US').notRead('A$1', 'x')).toBe('A$1: This number is not read. Contact us: x');
  });
});

describe('the opt-out line in each language', () => {
  it('says STOP in every reply line, so a template that carries it is not given it twice', () => {
    for (const language of TEXT_LANGUAGES) {
      const line = textWordsFor(language).replyStop;
      expect(line, language).toContain('STOP');
      expect(saysStop(line), language).toBe(true);
    }
  });

  it('never promises a reply in a contact line, and never asks for a YES', () => {
    for (const language of TEXT_LANGUAGES) {
      const words = textWordsFor(language);
      const contact = words.contactLine('hello@lumen.example');
      expect(contact, language).toContain('hello@lumen.example');
      expect(repliesWithStopWord(contact), language).toBe(false);
      expect(asksForYes(contact), language).toBe(false);
      expect(asksForYes(words.replyStop), language).toBe(false);
    }
  });

  it('is written in the language asked for', () => {
    expect(optOutLine('reply-stop', 'DE', { name: 'Lumen' }, 'de_DE')).toBe('Antworten Sie STOP zum Abmelden.');
    expect(optOutLine('through-business', 'DE', { name: 'Lumen', phone: '+49301234567' }, 'de-DE')).toBe('Keine SMS mehr? Wenden Sie sich an +49301234567.');
    expect(optOutLine('through-business', 'AE', { name: 'Lumen', phone: '+97141234567' }, 'ar_EG')).toBe('لإيقاف الرسائل تواصل مع Lumen.');
    expect(optOutLine('through-business', 'FR', { name: 'Lumen', phone: '+33123456789', email: 'bonjour@lumen.example' }, 'fr_FR')).toBe('Pour ne plus recevoir de SMS, contactez bonjour@lumen.example.');
    expect(optOutLine('reply-stop', 'DE', { name: 'Lumen' })).toBe('Reply STOP to opt out.');
  });
});

describe('a finished text in each language', () => {
  const base = { values: {}, optOut: 'reply-stop', country: 'DE', sender: NUMBER, business: { name: 'Lumen', phone: '+4930123456' } } as const;

  it('ends with the line in the template’s language', () => {
    expect(composeText({ ...base, template: 'Ihr Termin ist morgen.', language: 'de_DE' })).toMatchObject({ ok: true, body: 'Ihr Termin ist morgen. Antworten Sie STOP zum Abmelden.' });
    expect(composeText({ ...base, template: 'Votre rendez-vous est demain.', language: 'fr_FR' })).toMatchObject({ ok: true, body: 'Votre rendez-vous est demain. Répondez STOP pour ne plus recevoir de SMS.' });
  });

  it('runs Chinese on with no space before the line', () => {
    expect(composeText({ ...base, template: '您的预约在明天。', language: 'zh_CN' })).toMatchObject({ ok: true, body: '您的预约在明天。回复STOP退订。' });
    expect(composeText({ ...base, template: '您的預約在明天。', language: 'zh_TW' })).toMatchObject({ ok: true, body: '您的預約在明天。回覆STOP退訂。' });
  });

  it('adds no second line to a template that already says it', () => {
    const template = 'Ihr Termin ist morgen. Antworten Sie STOP zum Abmelden.';
    expect(composeText({ ...base, template, language: 'de_DE' })).toMatchObject({ ok: true, body: template });
  });

  it('gives a sender name the contact line in the language, without the template’s own STOP sentence', () => {
    const made = composeText({ ...base, optOut: 'through-business', sender: NAME, template: 'Ihr Termin ist morgen. Antworten Sie STOP zum Abmelden.', language: 'de_DE' });
    expect(made).toMatchObject({ ok: true, body: 'Ihr Termin ist morgen. Keine SMS mehr? Wenden Sie sich an +4930123456.' });
  });
});

describe('the "not read" answer', () => {
  const business = { name: 'Lumen', phone: '+4930123456' };

  it('is the catalogue’s, in each language, with and without a contact', () => {
    expect(notReadText({ locale: 'de_DE', business, to: '+4915112345678' })).toBe('Lumen: Diese Nummer wird nicht gelesen. Kontakt: +4930123456');
    expect(notReadText({ locale: 'fr_FR', business, to: '+33612345678' })).toBe("Lumen : ce numéro n'est pas consulté. Contact : +4930123456");
    expect(notReadText({ locale: 'zh_TW', business, to: '+886912345678' })).toBe('Lumen：此號碼無人查看。請聯絡：+4930123456');
    // The UAE allows no contact in a text: the first sentence alone.
    expect(notReadText({ locale: 'ar_EG', business, to: '+971501234567' })).toBe('Lumen: هذا الرقم غير مُتابَع.');
  });

  it('starts at the sentence when the business has no name', () => {
    for (const language of TEXT_LANGUAGES) {
      const words = notReadText({ locale: language, business: { name: ' ', phone: '+4930123456' }, to: '+4915112345678' });
      expect(words, language).not.toMatch(/^[\s:：]/u);
      expect(words, language).not.toContain('{business}');
      expect(words, language).toContain('+4930123456');
    }
  });
});
