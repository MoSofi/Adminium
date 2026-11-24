// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The STOP parser, the confirmation rule and the delivery rule: pure, so they
 * run once, outside the engine loop.
 */
import { createHmac, generateKeyPairSync, sign } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  SMS_DELIVERY_STATUSES,
  SMS_STOP_CONFIRMATION,
  SMS_STOP_CONFIRM_WINDOW_MS,
  TELNYX_WINDOW_SECONDS,
  decideStopConfirmation,
  deliveryMoves,
  deliveryStatusOf,
  foldMessage,
  isFinalStatus,
  listedWords,
  readControlWord,
  twilioAddressForms,
  twilioSignedText,
  verifyTelnyx,
  verifyTwilio,
  type SmsDeliveryStatus,
  stopConfirmationIn,
} from '../src/sms/inbound/index.js';
import { estimateLength, limitsFor } from '../src/sms/send/length.js';
import { TEXT_LANGUAGES } from '../src/sms/words.js';

const kindOf = (text: unknown): string => readControlWord(text).kind;

describe('STOP words', () => {
  it.each(['STOP', 'stop', 'Stop', 'QUIT', 'END', 'REVOKE', 'OPT OUT', 'opt out', 'Opt-Out', 'OPTOUT', 'CANCEL', 'UNSUBSCRIBE', 'STOPALL', 'STOP ALL'])('reads the US word %s', (word) => {
    expect(kindOf(word)).toBe('stop');
  });

  it.each(['STOP PLEASE', 'please stop', 'Stop, please!', 'stop now', 'STOP thanks', 'stop thank you', 'OPT OUT PLEASE', 'cancel pls', 'stop stop stop', '  stop.  ', 'STOP!!!', 'stop 😡', 'ＳＴＯＰ', 'S​TOP', 'stop texting me', 'remove me', 'unsubscribe me'])('reads %s', (text) => {
    expect(kindOf(text)).toBe('stop');
  });

  it.each([
    ['de-DE', ['STOPP', 'stoppen', 'ABMELDEN', 'abbestellen', 'austragen', 'ENDE', 'beenden', 'kündigen', 'KUENDIGEN', 'bitte abmelden', 'abmelden danke']],
    ['fr-FR', ['ARRET', 'ARRÊT', 'arrêter', 'stopper', 'désabonner', 'me désabonner', 'DESINSCRIRE', 'désinscription', 'arrêt svp', "stop s'il vous plaît", 'stop merci']],
    ['da-DK', ['AFMELD', 'afmeld mig', 'frameld', 'frameld mig', 'afslut', 'stop tak', 'afmeld venligst']],
    ['cs-CZ', ['ODHLÁSIT', 'odhlasit', 'odhlásit se', 'odhlášení', 'KONEC', 'zrušit', 'zrušit prosím', 'stop děkuji']],
    ['ar-EG', ['إيقاف', 'ايقاف', 'إلغاء', 'الغاء', 'إلغاء الاشتراك', 'توقف', 'قف', 'إيقاف من فضلك', 'الغاء لو سمحت', 'توقف شكرا']],
    ['zh-CN', ['退订', '请退订', '退订谢谢', '我要退订', '取消订阅', '停止', '退出', 'TD', '退订。', '麻烦退订']],
    ['zh-TW', ['退訂', '請退訂', '退訂謝謝', '我要退訂', '取消訂閱', '停止']],
  ])('reads the %s words', (_language, words) => {
    for (const word of words as string[]) expect([word, kindOf(word)]).toEqual([word, 'stop']);
  });

  it('names the language of a local word, and none for a shared one', () => {
    expect(readControlWord('ABMELDEN')).toMatchObject({ language: 'de-DE' });
    expect(readControlWord('退訂')).toMatchObject({ language: 'zh-TW' });
    expect(readControlWord('stop')).toMatchObject({ language: null });
  });

  it.each([
    'I will stop by at 3',
    'Please do not stop',
    "don't stop",
    'stop by tomorrow',
    'Can you stop at the shop',
    'I want to cancel my appointment',
    'please cancel my booking',
    "please don't cancel",
    'do not cancel',
    'cancel my order',
    'end of the day works',
    'by the end of the week',
    'the end',
    'I quit my job',
    'quit it',
    'how do I opt out',
    'should I unsubscribe',
    'unsubscribe from what',
    'no stop',
    'stopping by later',
    'nonstop',
    'send',
    'trend',
    'Wir stoppen nicht',
    'nicht abmelden',
    'am Ende der Woche',
    "je ne veux pas arrêter",
    "ne pas arrêter",
    'nezrušit',
    'chci zrušit rezervaci',
    'لا توقف',
    'لا تلغي الموعد',
    '不要退订',
    '不要停止',
    '取消预约',
    '我要取消',
    '取消了',
    '不要取消',
    '我想取消預約',
    'ok thanks',
    'please',
    'thank you',
    '',
    '   ',
    '!!!',
  ])('does not fire on "%s"', (text) => {
    expect(kindOf(text)).toBe('none');
  });

  it('does not read a long message, whatever it starts with', () => {
    expect(kindOf(`stop ${'please '.repeat(40)}`)).toBe('none');
    expect(kindOf('x'.repeat(100_000))).toBe('none');
  });

  it('reads nothing from what is not a string', () => {
    for (const value of [null, undefined, 7, {}, ['stop']]) expect(kindOf(value)).toBe('none');
  });

  it('lists every required word', () => {
    const words = listedWords('stop');
    for (const word of ['stop', 'quit', 'end', 'revoke', 'opt out', 'cancel', 'unsubscribe']) expect(words).toContain(word);
  });

  it('every listed word survives folding, so none can never match', () => {
    for (const kind of ['stop', 'start', 'help'] as const) {
      for (const word of listedWords(kind)) expect([word, foldMessage(word)]).toEqual([word, word]);
    }
  });

  it('no word means two things', () => {
    const all = [...listedWords('stop'), ...listedWords('start'), ...listedWords('help')];
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('START and HELP', () => {
  it.each(['START', 'start', 'UNSTOP', 'start please', 'Starten', 'démarrer', 'spustit', 'ابدأ', '开始', '開始'])('reads %s as a start', (word) => {
    expect(kindOf(word)).toBe('start');
  });

  it.each(['YES', 'yes', 'Y', 'ok', 'oui', 'ja', 'ano', 'نعم', '是', 'subscribe', 'yes please'])('never reads %s as a start', (word) => {
    expect(kindOf(word)).toBe('none');
  });

  it.each(['when does it start', 'start at 5', 'can we start later', 'do not start', '不要开始'])('does not fire on "%s"', (text) => {
    expect(kindOf(text)).toBe('none');
  });

  it.each(['HELP', 'info', 'Hilfe', 'aide', 'hjælp', 'pomoc', 'مساعدة', '帮助', '幫助'])('reads %s as help', (word) => {
    expect(kindOf(word)).toBe('help');
  });
});

describe('the one confirmation', () => {
  const T = 1_800_000_000_000;
  const base = { provider: 'twilio' as const, added: true, answered: false, whole: 'stop please', via: 'webhook' as const, occurredAt: T, now: T + 1000 };

  it('answers a STOP the provider did not catch, with a deadline', () => {
    expect(decideStopConfirmation(base)).toEqual({ send: true, sendBy: T + SMS_STOP_CONFIRM_WINDOW_MS });
  });

  it('never answers a number that was already stopped', () => {
    expect(decideStopConfirmation({ ...base, added: false })).toEqual({ send: false, reason: 'already-stopped' });
  });

  it('stays quiet when the delivery says the provider answered', () => {
    expect(decideStopConfirmation({ ...base, answered: true })).toEqual({ send: false, reason: 'provider-answered' });
  });

  it.each(['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'revoke', 'optout', 'quit'])('stays quiet on Twilio default word %s', (whole) => {
    expect(decideStopConfirmation({ ...base, whole })).toEqual({ send: false, reason: 'provider-answered' });
  });

  it.each(['stop', 'stopall', 'stop all', 'unsubscribe', 'cancel', 'end', 'quit', 'revoke', 'opt out', 'optout'])('stays quiet on Telnyx default word %s', (whole) => {
    expect(decideStopConfirmation({ ...base, provider: 'telnyx', whole })).toEqual({ send: false, reason: 'provider-answered' });
  });

  it('answers "opt out" on Twilio, whose default misses it', () => {
    expect(decideStopConfirmation({ ...base, whole: 'opt out' }).send).toBe(true);
  });

  it('answers a local word on either provider', () => {
    expect(decideStopConfirmation({ ...base, whole: 'abmelden' }).send).toBe(true);
    expect(decideStopConfirmation({ ...base, provider: 'telnyx', whole: '退订' }).send).toBe(true);
  });

  it('is silent past five minutes, to the millisecond', () => {
    expect(decideStopConfirmation({ ...base, now: T + SMS_STOP_CONFIRM_WINDOW_MS - 1 }).send).toBe(true);
    expect(decideStopConfirmation({ ...base, now: T + SMS_STOP_CONFIRM_WINDOW_MS })).toEqual({ send: false, reason: 'too-late' });
  });

  it('never answers what the catch-up found', () => {
    expect(decideStopConfirmation({ ...base, via: 'catch-up' })).toEqual({ send: false, reason: 'catch-up' });
  });

  it('has plain words: no question, no link, no offer', () => {
    expect(SMS_STOP_CONFIRMATION).toBe('You are unsubscribed and will get no more texts from this business.');
    for (const language of TEXT_LANGUAGES) {
      const words = stopConfirmationIn(language);
      expect(words, language).not.toMatch(/[?؟？]/);
      expect(words, language).not.toMatch(/https?:|www\.|reply|offer|sale|%|\d/i);
      // One segment, from any sender.
      expect(estimateLength(words, limitsFor('US', { kind: 'number', value: '+12025550100' })).segments, language).toBe(1);
      // Nothing in it reads as a control word if it is sent back.
      expect(readControlWord(words).kind, language).toBe('none');
    }
  });

  it('writes the confirmation in the language asked, and US English for any other', () => {
    expect(stopConfirmationIn('de_DE')).toBe('Sie sind abgemeldet und erhalten keine weiteren SMS von diesem Unternehmen.');
    expect(stopConfirmationIn('zh-Hant-TW')).toBe('您已退訂，將不再收到該商家的簡訊。');
    expect(stopConfirmationIn('pt-BR')).toBe(SMS_STOP_CONFIRMATION);
    expect(stopConfirmationIn(null)).toBe(SMS_STOP_CONFIRMATION);
    expect(new Set(TEXT_LANGUAGES.map(stopConfirmationIn)).size).toBe(8);
  });
});

describe('delivery status', () => {
  it('maps each provider word, and refuses anything else', () => {
    expect(deliveryStatusOf('twilio', 'delivered')).toBe('delivered');
    expect(deliveryStatusOf('twilio', 'undelivered')).toBe('undelivered');
    expect(deliveryStatusOf('twilio', 'canceled')).toBe('failed');
    expect(deliveryStatusOf('telnyx', 'delivery_failed')).toBe('undelivered');
    expect(deliveryStatusOf('telnyx', 'sending_failed')).toBe('failed');
    expect(deliveryStatusOf('telnyx', 'delivery_unconfirmed')).toBe('unconfirmed');
    expect(deliveryStatusOf('telnyx', 'webhook_delivered')).toBeNull();
    expect(deliveryStatusOf('twilio', 'receiving')).toBeNull();
    expect(deliveryStatusOf('twilio', 'constructor')).toBeNull();
    expect(deliveryStatusOf('twilio', 7)).toBeNull();
  });

  it('never moves a final status back to a non-final one', () => {
    const finals = SMS_DELIVERY_STATUSES.filter(isFinalStatus);
    const open = SMS_DELIVERY_STATUSES.filter((status) => !isFinalStatus(status));
    expect(finals.length).toBeGreaterThan(0);
    for (const final of finals) for (const earlier of open) expect([final, earlier, deliveryMoves(final, earlier)]).toEqual([final, earlier, false]);
  });

  it('delivered is never replaced', () => {
    for (const status of SMS_DELIVERY_STATUSES) expect(deliveryMoves('delivered', status)).toBe(false);
  });

  it('stronger evidence replaces weaker among final statuses, and an equal one keeps the first', () => {
    expect(deliveryMoves('unconfirmed', 'delivered')).toBe(true);
    expect(deliveryMoves('unconfirmed', 'failed')).toBe(true);
    expect(deliveryMoves('failed', 'delivered')).toBe(true);
    expect(deliveryMoves('failed', 'undelivered')).toBe(false);
    expect(deliveryMoves('undelivered', 'failed')).toBe(false);
    expect(deliveryMoves('failed', 'unconfirmed')).toBe(false);
  });

  it('any order of reports ends on the same status', () => {
    const reports: SmsDeliveryStatus[] = ['queued', 'sending', 'sent', 'delivered'];
    const orders = (list: SmsDeliveryStatus[]): SmsDeliveryStatus[][] => (list.length <= 1 ? [list] : list.flatMap((one, index) => orders([...list.slice(0, index), ...list.slice(index + 1)]).map((rest) => [one, ...rest])));
    for (const order of orders(reports)) {
      let held: SmsDeliveryStatus = 'queued';
      for (const status of [...order, ...order]) if (deliveryMoves(held, status)) held = status;
      expect(held).toBe('delivered');
    }
  });
});

describe('Twilio signature', () => {
  const TOKEN = 'a-made-up-signing-value';
  const ADDRESS = 'https://texts.lumen.example/api/v1/inbound/sms/twilio/door';
  const signed = (address: string, body: string, token = TOKEN): string => {
    const form = new URLSearchParams(body);
    const names = [...new Set(form.keys())].sort();
    let text = address;
    for (const name of names) for (const value of [...new Set(form.getAll(name))].sort()) text += name + value;
    return createHmac('sha1', token).update(text, 'utf8').digest('base64');
  };
  const BODY = 'MessageSid=SM1&From=%2B4915123456789&To=%2B15005550006&Body=STOP+please';

  it('leaves the retry override out of what it checks, as Twilio leaves it out of what it signs', () => {
    expect(verifyTwilio({ address: `${ADDRESS}#rp=all&rc=5`, rawBody: Buffer.from(BODY), signature: signed(ADDRESS, BODY), authToken: TOKEN })).toBe(true);
    expect(twilioAddressForms(`${ADDRESS}#rp=all&rc=5`)[0]).toBe(ADDRESS);
  });

  it('matches the worked example in the provider library', () => {
    const form = new URLSearchParams({ CallSid: 'CA1234567890ABCDE', Caller: '+14158675309', Digits: '1234', From: '+14158675309', To: '+18005551212' });
    const text = twilioSignedText('https://mycompany.com/myapp.php?foo=1&bar=2', form);
    expect(createHmac('sha1', '12345').update(text, 'utf8').digest('base64')).toBe('RSOYDt4T1cUTdK1PDd93/VVr8B8=');
  });

  it('accepts a good signature over the stored address', () => {
    expect(verifyTwilio({ address: ADDRESS, rawBody: Buffer.from(BODY), signature: signed(ADDRESS, BODY), authToken: TOKEN })).toBe(true);
  });

  it('sorts names, not the order they came in', () => {
    const shuffled = 'To=%2B15005550006&Body=STOP+please&From=%2B4915123456789&MessageSid=SM1';
    expect(verifyTwilio({ address: ADDRESS, rawBody: Buffer.from(shuffled), signature: signed(ADDRESS, BODY), authToken: TOKEN })).toBe(true);
  });

  it('refuses a changed body, address, token, or a missing signature', () => {
    const good = signed(ADDRESS, BODY);
    expect(verifyTwilio({ address: ADDRESS, rawBody: Buffer.from(BODY.replace('STOP', 'START')), signature: good, authToken: TOKEN })).toBe(false);
    expect(verifyTwilio({ address: 'https://evil.example/api/v1/inbound/sms/twilio/door', rawBody: Buffer.from(BODY), signature: good, authToken: TOKEN })).toBe(false);
    expect(verifyTwilio({ address: ADDRESS, rawBody: Buffer.from(BODY), signature: good, authToken: 'another-value-here' })).toBe(false);
    for (const signature of [undefined, '', 'not base64!!', 'AAAA', 7, ['x'], 'A'.repeat(500)]) {
      expect(verifyTwilio({ address: ADDRESS, rawBody: Buffer.from(BODY), signature, authToken: TOKEN })).toBe(false);
    }
  });

  it('accepts the address signed with or without its port, and no other host', () => {
    const withPort = 'https://texts.lumen.example:8443/api/v1/inbound/sms/twilio/door';
    expect(twilioAddressForms(withPort)).toEqual([withPort, ADDRESS]);
    expect(verifyTwilio({ address: withPort, rawBody: Buffer.from(BODY), signature: signed(ADDRESS, BODY), authToken: TOKEN })).toBe(true);
    const port443 = 'https://texts.lumen.example:443/api/v1/inbound/sms/twilio/door';
    expect(verifyTwilio({ address: ADDRESS, rawBody: Buffer.from(BODY), signature: signed(port443, BODY), authToken: TOKEN })).toBe(true);
    expect(verifyTwilio({ address: ADDRESS, rawBody: Buffer.from(BODY), signature: signed('https://texts.lumen.example:8443/api/v1/inbound/sms/twilio/door', BODY), authToken: TOKEN })).toBe(false);
  });
});

describe('Telnyx signature', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const PUBLIC = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
  const NOW = 1_800_000_000_000;
  const TS = String(NOW / 1000);
  const BODY = Buffer.from('{"data":{"id":"x"}}');
  const signed = (timestamp: string, body: Buffer): string => sign(null, Buffer.concat([Buffer.from(`${timestamp}|`), body]), privateKey).toString('base64');
  const check = (over: Partial<Parameters<typeof verifyTelnyx>[0]> = {}) => verifyTelnyx({ rawBody: BODY, signature: signed(TS, BODY), timestamp: TS, publicKey: PUBLIC, now: NOW, ...over });

  it('accepts a good signature', () => {
    expect(check()).toBe('genuine');
  });

  it('refuses a changed body, timestamp or key', () => {
    const other = generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
    expect(check({ rawBody: Buffer.from('{"data":{"id":"y"}}') })).toBe('bad-signature');
    expect(check({ timestamp: String(Number(TS) + 1) })).toBe('bad-signature');
    expect(check({ publicKey: other })).toBe('bad-signature');
  });

  it('refuses malformed values', () => {
    for (const signature of [undefined, '', 'AAAA', 'not base64!!', 7, 'A'.repeat(500)]) expect(check({ signature })).toBe('bad-signature');
    for (const timestamp of [undefined, '', 'abc', '1.5', '-1', 7]) expect(check({ timestamp })).toBe('bad-signature');
    expect(check({ publicKey: 'AAAA' })).toBe('bad-signature');
  });

  it('holds the five-minute window both ways, to the second', () => {
    const at = (offset: number) => {
      const timestamp = String(Number(TS) + offset);
      return check({ timestamp, signature: signed(timestamp, BODY) });
    };
    expect(at(-TELNYX_WINDOW_SECONDS)).toBe('genuine');
    expect(at(TELNYX_WINDOW_SECONDS)).toBe('genuine');
    expect(at(-TELNYX_WINDOW_SECONDS - 1)).toBe('stale');
    expect(at(TELNYX_WINDOW_SECONDS + 1)).toBe('stale');
  });
});
