// SPDX-License-Identifier: AGPL-3.0-only
/**
 * How the chat window writes things down: times, counts, e-mails and web
 * addresses in the mono face (a closing full stop left to the sentence);
 * only an http(s) address is ever a link; lengths as the door counts them;
 * the hours in the business's words.
 */
import { describe, expect, it } from 'vitest';

import { closingOf, codeOf, hourOf, lengthOf, opensWords, runsOf } from './say.js';

describe('the window’s text', () => {
  it('sets times, counts, e-mails and addresses apart, leaving a closing stop to the sentence', () => {
    expect(runsOf('Leeds, Monday to Friday 9:00–17:30. Book a time here: https://crm.meridian.example/x/forms/showroom-visit')).toEqual([
      { text: 'Leeds, Monday to Friday ', kind: 'plain' },
      { text: '9:00–17:30', kind: 'mono' },
      { text: '. Book a time here: ', kind: 'plain' },
      { text: 'https://crm.meridian.example/x/forms/showroom-visit', kind: 'link' },
    ]);
    expect(runsOf('we’ll reply to marta.kovac@cobaltlegal.example.')).toEqual([
      { text: 'we’ll reply to ', kind: 'plain' },
      { text: 'marta.kovac@cobaltlegal.example', kind: 'mono' },
      { text: '.', kind: 'plain' },
    ]);
  });

  it('never makes a link of anything but an http(s) address', () => {
    expect(runsOf('javascript:alert(1) or www.meridian.example').filter((run) => run.kind === 'link')).toEqual([]);
  });

  it('counts a message as the door does: code points after NFC', () => {
    expect(lengthOf('é')).toBe(1);
    expect(lengthOf('😀')).toBe(1);
  });

  it('says the hours as the business keeps them', () => {
    expect(hourOf('09:00')).toBe('9:00');
    expect(closingOf('2026-07-28T16:30:00.000Z', 'Europe/London')).toBe('17:30');
    expect(opensWords({ at: '', date: '2026-08-03', time: '09:00', day: 'mon' }, 'en-US')).toEqual({ day: 'weekday', time: '9:00', weekday: 'Monday', date: '3 August' });
    expect(opensWords({ at: '', date: '2026-08-03', time: '09:00', day: 'tomorrow' }, 'de-DE')).toMatchObject({ day: 'tomorrow', weekday: 'Montag', date: '3. August' });
  });

  it('names a language on its button by its two letters, unless two offered share them', () => {
    expect(codeOf('en-US', ['en-US', 'de-DE'])).toBe('EN');
    expect(codeOf('zh-TW', ['zh-CN', 'zh-TW'])).toBe('ZH-TW');
  });
});
