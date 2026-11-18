// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A chat's caps (`chat/caps.ts`), counted in meta on every engine this run
 * can reach: each trips at its number, on its own subject, and says how long
 * to wait; one visitor's messages never trip another's; an IPv6 address is
 * counted by its /64; the chat's breaker pauses new conversations, tells
 * once, and a resume reopens them; an address's hash is gone after 3 hours.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  CHAT_ADDRESS_KEEP_MS,
  CHAT_MESSAGES_PER_CONVERSATION,
  CHAT_MESSAGES_PER_HOUR,
  CHAT_MESSAGES_PER_MINUTE,
  CHAT_PAUSE_MS,
  CHAT_STARTS_PER_ADDRESS_HOUR,
  CHAT_STARTS_PER_HOUR,
  createChatCaps,
  type ChatCaps,
} from '../src/chat/caps.js';
import { TEST_SECRET } from './helpers.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';

const AT = Date.parse('2026-11-18T10:00:00Z');

describe.each(META_ENGINES)("a chat's caps — $name", (engine) => {
  let handle: MetaHandle;
  let caps: ChatCaps;
  let told: { addOn: string; until: number }[];

  beforeEach(async () => {
    if (!engine.available) return;
    handle = await engine.make();
    told = [];
    caps = createChatCaps({
      meta: handle.meta,
      secret: TEST_SECRET,
      paused: async (addOn, until) => {
        told.push({ addOn, until });
      },
    });
  });
  afterEach(async () => {
    if (!engine.available) return;
    await handle.destroy();
  });

  it.skipIf(!engine.available)('a conversation sends 20 messages a minute; the 21st waits for the minute; another conversation is not held', async () => {
    for (let one = 0; one < CHAT_MESSAGES_PER_MINUTE; one += 1) expect((await caps.chargeMessage('live-chat', '1', one, AT + one)).ok).toBe(true);
    const refused = await caps.chargeMessage('live-chat', '1', 20, AT + 1000);
    expect(refused).toEqual({ ok: false, cap: 'minute', retryAfter: 60 });
    expect((await caps.chargeMessage('live-chat', '2', 0, AT + 1000)).ok).toBe(true);
    // The same conversation number in another chat is another conversation.
    expect((await caps.chargeMessage('other-chat', '1', 0, AT + 1000)).ok).toBe(true);
    // A minute later the first one may send again.
    expect((await caps.chargeMessage('live-chat', '1', 20, AT + 60_000)).ok).toBe(true);
  });

  it.skipIf(!engine.available)('200 messages an hour, then it waits for the hour', async () => {
    // Twenty a minute, ten minutes running: two hundred in the hour.
    for (let one = 0; one < CHAT_MESSAGES_PER_HOUR; one += 1) expect((await caps.chargeMessage('live-chat', '1', one, AT + Math.floor(one / 20) * 61_000 + (one % 20))).ok).toBe(true);
    const at = AT + 11 * 61_000;
    const refused = await caps.chargeMessage('live-chat', '1', CHAT_MESSAGES_PER_HOUR, at);
    expect(refused).toMatchObject({ ok: false, cap: 'hour' });
    expect((refused as { retryAfter: number }).retryAfter).toBe(Math.ceil((AT + 3_600_000 - at) / 1000));
  }, 120_000);

  it.skipIf(!engine.available)('300 messages in all: the conversation is over for good', async () => {
    expect((await caps.chargeMessage('live-chat', '1', CHAT_MESSAGES_PER_CONVERSATION - 1, AT)).ok).toBe(true);
    expect(await caps.chargeMessage('live-chat', '1', CHAT_MESSAGES_PER_CONVERSATION, AT)).toEqual({ ok: false, cap: 'conversation', retryAfter: null });
  });

  it.skipIf(!engine.available)('a refused message gives its mark back; a released one too', async () => {
    const charged = await caps.chargeMessage('live-chat', '1', 0, AT);
    expect(charged.ok).toBe(true);
    if (charged.ok) await charged.release();
    for (let one = 0; one < CHAT_MESSAGES_PER_MINUTE; one += 1) expect((await caps.chargeMessage('live-chat', '1', one, AT + one)).ok).toBe(true);
  });

  it.skipIf(!engine.available)('10 new conversations an hour from one address, its /64 for IPv6; another address is not held', async () => {
    for (let one = 0; one < CHAT_STARTS_PER_ADDRESS_HOUR; one += 1) expect((await caps.chargeStart('live-chat', `2001:db8:1:2::${String(one + 1)}`, AT + one)).ok).toBe(true);
    const refused = await caps.chargeStart('live-chat', '2001:db8:1:2:ffff::9', AT + 100);
    expect(refused).toMatchObject({ ok: false, cap: 'new-conversations' });
    expect((refused as { retryAfter: number }).retryAfter).toBe(3600);
    expect((await caps.chargeStart('live-chat', '2001:db8:1:3::1', AT + 100)).ok).toBe(true);
    expect((await caps.chargeStart('live-chat', '198.51.100.7', AT + 100)).ok).toBe(true);
  });

  it.skipIf(!engine.available)("past 500 new conversations an hour the chat's breaker pauses it, tells once, and a resume reopens it", async () => {
    // Fifty addresses, ten each: five hundred, none held by its own address.
    for (let one = 0; one < CHAT_STARTS_PER_HOUR; one += 1) {
      const ip = `198.51.${String(Math.floor(one / CHAT_STARTS_PER_ADDRESS_HOUR))}.1`;
      expect((await caps.chargeStart('live-chat', ip, AT + one)).ok).toBe(true);
    }
    const tripped = await caps.chargeStart('live-chat', '203.0.113.1', AT + 600);
    expect(tripped).toEqual({ ok: false, cap: 'paused', retryAfter: CHAT_PAUSE_MS / 1000 });
    expect(await caps.pausedUntil('live-chat', AT + 601)).toBe(AT + 600 + CHAT_PAUSE_MS);
    // Another chat on the install is not paused.
    expect(await caps.pausedUntil('other-chat', AT + 601)).toBeNull();
    // Paused: every new conversation is refused, and nobody is told twice.
    expect(await caps.chargeStart('live-chat', '203.0.113.2', AT + 700)).toMatchObject({ ok: false, cap: 'paused' });
    expect(told).toEqual([{ addOn: 'live-chat', until: AT + 600 + CHAT_PAUSE_MS }]);
    // A person resumes it: open again, and what was counted before is not counted again.
    expect(await caps.resume('live-chat', AT + 800)).toBe(true);
    expect(await caps.pausedUntil('live-chat', AT + 801)).toBeNull();
    expect((await caps.chargeStart('live-chat', '203.0.113.3', AT + 900)).ok).toBe(true);
    // A chat that is not paused has nothing to resume.
    expect(await caps.resume('live-chat', AT + 1000)).toBe(false);
  }, 240_000);

  it.skipIf(!engine.available)('the pause ends by itself after its hour', async () => {
    for (let one = 0; one <= CHAT_STARTS_PER_HOUR; one += 1) await caps.chargeStart('live-chat', `198.51.${String(Math.floor(one / CHAT_STARTS_PER_ADDRESS_HOUR))}.1`, AT + one);
    expect(await caps.pausedUntil('live-chat', AT + 1000)).not.toBeNull();
    expect(await caps.pausedUntil('live-chat', AT + 500 + CHAT_PAUSE_MS + 1)).toBeNull();
  }, 240_000);

  it.skipIf(!engine.available)("an address's keyed hash is gone after 3 hours, and is never the address", async () => {
    await caps.chargeStart('live-chat', '198.51.100.7', AT);
    const rows = await handle.meta.db.selectFrom('adminium_form_marks').select(['subject', 'purpose']).execute();
    expect(rows.some((row) => row.subject.includes('198.51.100.7'))).toBe(false);
    expect(rows.filter((row) => row.purpose === 'chat-new')).toHaveLength(1);
    expect(await caps.prune(AT + CHAT_ADDRESS_KEEP_MS - 1)).toBe(0);
    expect(await caps.prune(AT + CHAT_ADDRESS_KEEP_MS + 1)).toBe(1);
    const left = await handle.meta.db.selectFrom('adminium_form_marks').select(['purpose']).execute();
    expect(left.filter((row) => row.purpose === 'chat-new')).toHaveLength(0);
  });
});
