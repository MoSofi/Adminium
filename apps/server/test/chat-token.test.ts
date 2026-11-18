// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The conversation token (`chat/token.ts`) and what the door cuts a visitor's
 * words to (`chat/door.ts`): a token reads only on the server and the chat
 * install that made it, under its key, unchanged; it names one conversation
 * by its key AND its start; it lapses 24 hours after the visitor's own last
 * write or poll, whatever staff wrote since; a closed conversation's token
 * reads but never writes. A body is NFC, without control characters, 1 to
 * 2,000 characters by code point; "came from" keeps the page's origin, and
 * its path only on a listed website, never its query or fragment; a staff
 * author is a first name and initials only.
 */
import { describe, expect, it } from 'vitest';

import { authorOf, cameFromOf, CAME_FROM_MAX, cleanBody } from '../src/chat/door.js';
import { chatTokenKey, chatTokenRefusal, CHAT_TOKEN_LAPSE_MS, makeChatToken, readChatToken } from '../src/chat/token.js';
import { TEST_SECRET } from './helpers.js';

const key = chatTokenKey(TEST_SECRET);
const AT = Date.parse('2026-11-18T10:00:00Z');
const STARTED = AT - 60_000;
const claim = { installId: 'mfs_live', addOn: 'live-chat', conversation: '42', startedAt: STARTED, issuedAt: AT };
const chat = { addOn: 'live-chat', installId: 'mfs_live' };

describe('the conversation token', () => {
  it('reads back what it says, on the server and the chat install that made it', () => {
    const token = makeChatToken(key, 'install-a', claim);
    expect(readChatToken(key, 'install-a', token)).toEqual(claim);
    expect(readChatToken(key, 'install-a', token, chat)).toEqual(claim);
  });

  it('another server, another secret, a changed byte or not a token at all read as nothing', () => {
    const token = makeChatToken(key, 'install-a', claim);
    expect(readChatToken(key, 'install-b', token)).toBeNull();
    expect(readChatToken(chatTokenKey(`${TEST_SECRET}-other`), 'install-a', token)).toBeNull();
    const [text, signature] = token.split('~') as [string, string];
    const flip = (value: string, at: number) => `${value.slice(0, at)}${value[at] === 'A' ? 'B' : 'A'}${value.slice(at + 1)}`;
    expect(readChatToken(key, 'install-a', `${flip(text, 5)}~${signature}`)).toBeNull();
    expect(readChatToken(key, 'install-a', `${text}~${flip(signature, signature.length - 1)}`)).toBeNull();
    // Another conversation's key put in its place does not sign.
    const other = Buffer.from(JSON.stringify({ v: 2, i: 'install-a', n: 'mfs_live', a: 'live-chat', c: '43', s: STARTED, t: AT })).toString('base64url');
    expect(readChatToken(key, 'install-a', `${other}~${signature}`)).toBeNull();
    expect(readChatToken(key, 'install-a', 'not-a-token')).toBeNull();
    expect(readChatToken(key, 'install-a', 42)).toBeNull();
    expect(readChatToken(key, 'install-a', `${'a'.repeat(1100)}~${signature}`)).toBeNull();
  });

  it('is never read for another install of the same add-on, nor another add-on', () => {
    const token = makeChatToken(key, 'install-a', claim);
    expect(readChatToken(key, 'install-a', token, { addOn: 'live-chat', installId: 'mfs_other' })).toBeNull();
    expect(readChatToken(key, 'install-a', token, { addOn: 'desk-chat', installId: 'mfs_live' })).toBeNull();
  });

  it('names one conversation: the same key started at another moment (a number handed out again) is gone', () => {
    const conversation = { startedAt: STARTED, lastVisitorAt: AT, state: 'waiting' };
    expect(chatTokenRefusal(claim, conversation, { now: AT + 1000, write: true })).toBeNull();
    expect(chatTokenRefusal(claim, { ...conversation, startedAt: STARTED + 1 }, { now: AT + 1000, write: false })).toBe('gone');
  });

  it('lapses 24 hours after the visitor’s own last write or poll, whenever staff wrote', () => {
    const open = { startedAt: STARTED, lastVisitorAt: AT, state: 'waiting' };
    expect(chatTokenRefusal(claim, open, { now: AT + CHAT_TOKEN_LAPSE_MS, write: true })).toBeNull();
    expect(chatTokenRefusal(claim, open, { now: AT + CHAT_TOKEN_LAPSE_MS + 1, write: false })).toBe('lapsed');
    // The visitor polled an hour ago: a day-old token keeps working.
    expect(chatTokenRefusal(claim, { ...open, lastVisitorAt: AT + CHAT_TOKEN_LAPSE_MS }, { now: AT + CHAT_TOKEN_LAPSE_MS + 3_600_000, write: true })).toBeNull();
    // No visitor stamp at all: the token's own making counts.
    expect(chatTokenRefusal(claim, { ...open, lastVisitorAt: null }, { now: AT + CHAT_TOKEN_LAPSE_MS, write: true })).toBeNull();
    expect(chatTokenRefusal(claim, { ...open, lastVisitorAt: null }, { now: AT + CHAT_TOKEN_LAPSE_MS + 1, write: true })).toBe('lapsed');
  });

  it('a closed conversation is read until it lapses, never written; reopened within the lapse, it writes again', () => {
    const closed = { startedAt: STARTED, lastVisitorAt: AT, state: 'closed' };
    expect(chatTokenRefusal(claim, closed, { now: AT + 1000, write: false })).toBeNull();
    expect(chatTokenRefusal(claim, closed, { now: AT + 1000, write: true })).toBe('closed');
    expect(chatTokenRefusal(claim, { ...closed, state: 'open' }, { now: AT + 1000, write: true })).toBeNull();
    // Reopened by staff a month on: the visitor has not written since, so it stays lapsed.
    expect(chatTokenRefusal(claim, { ...closed, state: 'open' }, { now: AT + 30 * CHAT_TOKEN_LAPSE_MS, write: true })).toBe('lapsed');
  });

  it('a conversation gone (erased), or a token from the future, is refused', () => {
    expect(chatTokenRefusal(claim, null, { now: AT, write: false })).toBe('gone');
    expect(chatTokenRefusal({ ...claim, issuedAt: AT + 3_600_000 }, { startedAt: STARTED, lastVisitorAt: AT, state: 'bot' }, { now: AT, write: false })).toBe('gone');
  });
});

describe('what the door cuts a body to', () => {
  it('NFC, no control characters but line breaks, trimmed', () => {
    expect(cleanBody('  Café\u0007 open?\r\nTomorrow\u0000  ')).toBe('Café open?\nTomorrow');
    expect(cleanBody('\u0001\u0002 ')).toBeNull();
    expect(cleanBody(12)).toBeNull();
  });

  it('2,000 characters by code point, not by UTF-16 unit', () => {
    expect(cleanBody('a'.repeat(2000))).toHaveLength(2000);
    expect(cleanBody('a'.repeat(2001))).toBeNull();
    // An emoji is two UTF-16 units and one character: 2,000 of them are taken.
    expect([...(cleanBody('😀'.repeat(2000)) ?? '')]).toHaveLength(2000);
    expect(cleanBody('😀'.repeat(2001))).toBeNull();
    // A decomposed accent counts once it is composed.
    expect(cleanBody('é'.repeat(2000))).toHaveLength(2000);
  });
});

describe('"came from"', () => {
  const listed = ['https://www.meridian.example', 'http://shop.example:8080'];

  it('keeps the origin and the path on a listed website, never the query or the fragment', () => {
    expect(cameFromOf('https://www.meridian.example/showroom?utm_source=mail&email=marta@cobalt.example#top', listed)).toBe('https://www.meridian.example/showroom');
    expect(cameFromOf('http://shop.example:8080/a/b/', listed)).toBe('http://shop.example:8080/a/b/');
    expect(cameFromOf('HTTPS://WWW.Meridian.example:443/Showroom', listed)).toBe('https://www.meridian.example/Showroom');
  });

  it('keeps the origin alone on any other website: its path may hold a token or an address', () => {
    expect(cameFromOf('https://shop.example/account/reset/9f2c4e7a1b', listed)).toBe('https://shop.example');
    expect(cameFromOf('https://adminium-login.example/u/jane.doe@example.com/orders?x=1#y', listed)).toBe('https://adminium-login.example');
    expect(cameFromOf('https://www.meridian.example.evil.example/showroom', listed)).toBe('https://www.meridian.example.evil.example');
    expect(cameFromOf('https://www.meridian.example/showroom', [])).toBe('https://www.meridian.example');
  });

  it('is nothing for what is not a web page, and cut to 2,048 characters', () => {
    expect(cameFromOf('javascript:alert(1)', listed)).toBeNull();
    expect(cameFromOf('not a url', listed)).toBeNull();
    expect(cameFromOf(undefined, listed)).toBeNull();
    const long = cameFromOf(`https://www.meridian.example/${'p'.repeat(3000)}`, listed);
    expect(long).toHaveLength(CAME_FROM_MAX);
  });
});

describe("a staff member, as a visitor reads them", () => {
  it('a first name and initials, never the surname', () => {
    expect(authorOf('Dana Whitfield')).toEqual({ firstName: 'Dana', initials: 'DW' });
    expect(authorOf('Sam')).toEqual({ firstName: 'Sam', initials: 'S' });
    expect(authorOf('  ')).toBeNull();
    expect(JSON.stringify(authorOf('Dana Whitfield'))).not.toContain('Whitfield');
  });
});
