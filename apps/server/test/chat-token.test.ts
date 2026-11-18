// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The conversation token (`chat/token.ts`) and what the door cuts a visitor's
 * words to (`chat/door.ts`): a token reads only on the install that made it,
 * under its key, unchanged; it lapses 24 hours after the conversation's last
 * message; a closed conversation's token reads but never writes. A body is
 * NFC, without control characters, 1 to 2,000 characters by code point; "came
 * from" keeps the page's origin and path, never its query or fragment; a staff
 * author is a first name and initials only.
 */
import { describe, expect, it } from 'vitest';

import { authorOf, cameFromOf, CAME_FROM_MAX, cleanBody } from '../src/chat/door.js';
import { chatTokenKey, chatTokenRefusal, CHAT_TOKEN_LAPSE_MS, makeChatToken, readChatToken } from '../src/chat/token.js';
import { TEST_SECRET } from './helpers.js';

const key = chatTokenKey(TEST_SECRET);
const AT = Date.parse('2026-11-18T10:00:00Z');
const claim = { addOn: 'live-chat', conversation: '42', issuedAt: AT };

describe('the conversation token', () => {
  it('reads back what it says, on the install that made it', () => {
    const token = makeChatToken(key, 'install-a', claim);
    expect(readChatToken(key, 'install-a', token)).toEqual(claim);
  });

  it('another install, another secret, a changed byte or not a token at all read as nothing', () => {
    const token = makeChatToken(key, 'install-a', claim);
    expect(readChatToken(key, 'install-b', token)).toBeNull();
    expect(readChatToken(chatTokenKey(`${TEST_SECRET}-other`), 'install-a', token)).toBeNull();
    const [text, signature] = token.split('~') as [string, string];
    const flip = (value: string, at: number) => `${value.slice(0, at)}${value[at] === 'A' ? 'B' : 'A'}${value.slice(at + 1)}`;
    expect(readChatToken(key, 'install-a', `${flip(text, 5)}~${signature}`)).toBeNull();
    expect(readChatToken(key, 'install-a', `${text}~${flip(signature, signature.length - 1)}`)).toBeNull();
    // Another conversation's key put in its place does not sign.
    const other = Buffer.from(JSON.stringify({ v: 1, i: 'install-a', a: 'live-chat', c: '43', t: AT })).toString('base64url');
    expect(readChatToken(key, 'install-a', `${other}~${signature}`)).toBeNull();
    expect(readChatToken(key, 'install-a', 'not-a-token')).toBeNull();
    expect(readChatToken(key, 'install-a', 42)).toBeNull();
    expect(readChatToken(key, 'install-a', `${'a'.repeat(1100)}~${signature}`)).toBeNull();
  });

  it('lapses 24 hours after the last message, whenever it was made', () => {
    const open = { lastMessageAt: AT, state: 'waiting' };
    expect(chatTokenRefusal(claim, open, { now: AT + CHAT_TOKEN_LAPSE_MS, write: true })).toBeNull();
    expect(chatTokenRefusal(claim, open, { now: AT + CHAT_TOKEN_LAPSE_MS + 1, write: false })).toBe('lapsed');
    // A message an hour ago keeps a day-old token working.
    expect(chatTokenRefusal(claim, { lastMessageAt: AT + CHAT_TOKEN_LAPSE_MS, state: 'open' }, { now: AT + CHAT_TOKEN_LAPSE_MS + 3_600_000, write: true })).toBeNull();
  });

  it('a closed conversation is read until it lapses, never written; reopened, it writes again', () => {
    const closed = { lastMessageAt: AT, state: 'closed' };
    expect(chatTokenRefusal(claim, closed, { now: AT + 1000, write: false })).toBeNull();
    expect(chatTokenRefusal(claim, closed, { now: AT + 1000, write: true })).toBe('closed');
    expect(chatTokenRefusal(claim, { ...closed, state: 'open' }, { now: AT + 1000, write: true })).toBeNull();
  });

  it('a conversation gone (erased), or a token from the future, is refused', () => {
    expect(chatTokenRefusal(claim, null, { now: AT, write: false })).toBe('gone');
    expect(chatTokenRefusal({ ...claim, issuedAt: AT + 3_600_000 }, { lastMessageAt: AT, state: 'bot' }, { now: AT, write: false })).toBe('gone');
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
  it('keeps the origin and the path, never the query or the fragment', () => {
    expect(cameFromOf('https://www.meridian.example/showroom?utm_source=mail&email=marta@cobalt.example#top')).toBe('https://www.meridian.example/showroom');
    expect(cameFromOf('http://shop.example:8080/a/b/')).toBe('http://shop.example:8080/a/b/');
  });

  it('is nothing for what is not a web page, and cut to 2,048 characters', () => {
    expect(cameFromOf('javascript:alert(1)')).toBeNull();
    expect(cameFromOf('not a url')).toBeNull();
    expect(cameFromOf(undefined)).toBeNull();
    const long = cameFromOf(`https://www.meridian.example/${'p'.repeat(3000)}`);
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
