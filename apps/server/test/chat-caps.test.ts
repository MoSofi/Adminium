// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A chat's caps (`chat/caps.ts`), counted in meta on every engine this run
 * can reach: each trips at its number, on its own subject, and says how long
 * to wait; one visitor's messages never trip another's; an IPv6 address is
 * counted by its /64, and by its /56 at three times and its /48 at ten times
 * that; the chat's breaker counts only real conversations (bare starts never
 * trip it), pauses new conversations, tells once, and a resume reopens them
 * and starts the count again; the human check asks more work past half the
 * hour's starts; the details change ten times an hour; an address's hash is
 * gone after 3 hours.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  CHAT_ADDRESS_KEEP_MS,
  CHAT_DETAILS_PER_HOUR,
  CHAT_MESSAGES_PER_CONVERSATION,
  CHAT_MESSAGES_PER_HOUR,
  CHAT_MESSAGES_PER_MINUTE,
  CHAT_PAUSE_MS,
  CHAT_STARTS_PER_48_HOUR,
  CHAT_STARTS_PER_56_HOUR,
  CHAT_STARTS_PER_ADDRESS_HOUR,
  CHAT_STARTS_PER_HOUR,
  createChatCaps,
  type ChatCaps,
} from '../src/chat/caps.js';
import { PROOF_DIFFICULTY } from '../src/public-api/proof.js';
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
    // The oldest of the minute's twenty was a second before: 59 seconds to wait.
    expect(refused).toEqual({ ok: false, cap: 'minute', retryAfter: 59 });
    expect((await caps.chargeMessage('live-chat', '2', 0, AT + 1000)).ok).toBe(true);
    // The same conversation number in another chat is another conversation.
    expect((await caps.chargeMessage('other-chat', '1', 0, AT + 1000)).ok).toBe(true);
    // A minute later the first one may send again.
    expect((await caps.chargeMessage('live-chat', '1', 20, AT + 60_020)).ok).toBe(true);
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

  /** The n-th IPv4 address of a run, ten to an address block so none meets its own cap. */
  const v4 = (n: number) => `198.${String(51 + Math.floor(n / 2500))}.${String(Math.floor(n / 10) % 250)}.${String((n % 10) + 1)}`;

  it.skipIf(!engine.available)('an IPv6 /56 starts 30 an hour and a /48 100, however many /64s they hold', async () => {
    // Three /64s of one /56, ten each: thirty. A fourth /64 of the same /56 is held.
    for (let one = 0; one < CHAT_STARTS_PER_56_HOUR; one += 1) expect((await caps.chargeStart('live-chat', `2001:db8:7:${String(Math.floor(one / 10))}::${String((one % 10) + 1)}`, AT + one)).ok).toBe(true);
    expect(await caps.chargeStart('live-chat', '2001:db8:7:3::1', AT + 100)).toMatchObject({ ok: false, cap: 'new-conversations' });
    // Other /56s of the same /48 go on, up to a hundred in all.
    let made = CHAT_STARTS_PER_56_HOUR;
    for (let net = 1; made < CHAT_STARTS_PER_48_HOUR; net += 1) {
      for (let one = 0; one < CHAT_STARTS_PER_56_HOUR && made < CHAT_STARTS_PER_48_HOUR; one += 1, made += 1) {
        expect((await caps.chargeStart('live-chat', `2001:db8:7:${(net * 256 + Math.floor(one / 10)).toString(16)}::${String((one % 10) + 1)}`, AT + 200 + made)).ok).toBe(true);
      }
    }
    expect(await caps.chargeStart('live-chat', '2001:db8:7:ff00::1', AT + 500)).toMatchObject({ ok: false, cap: 'new-conversations' });
    // Another /48 is not held.
    expect((await caps.chargeStart('live-chat', '2001:db8:8::1', AT + 500)).ok).toBe(true);
  }, 120_000);

  it.skipIf(!engine.available)('501 bare starts from many /64s in one /48 never trip the breaker: the /48 refuses them first', async () => {
    let refused = 0;
    for (let one = 0; one <= CHAT_STARTS_PER_HOUR; one += 1) {
      // Each in its own /64 and spread over the /56s, so neither of those holds them: only the /48 can.
      const charged = await caps.chargeStart('live-chat', `2001:db8:9:${(((one % 256) << 8) | Math.floor(one / 256)).toString(16)}::1`, AT + one);
      if (!charged.ok) {
        expect(charged).toMatchObject({ cap: 'new-conversations' });
        refused += 1;
      }
    }
    expect(refused).toBe(CHAT_STARTS_PER_HOUR + 1 - CHAT_STARTS_PER_48_HOUR);
    expect(await caps.pausedUntil('live-chat', AT + 600)).toBeNull();
    expect(told).toEqual([]);
  }, 240_000);

  it.skipIf(!engine.available)('501 bare starts from 501 addresses never trip the breaker: only a real conversation counts', async () => {
    for (let one = 0; one <= CHAT_STARTS_PER_HOUR; one += 1) expect((await caps.chargeStart('live-chat', v4(one * 10), AT + one)).ok).toBe(true);
    expect(await caps.pausedUntil('live-chat', AT + 600)).toBeNull();
    expect(told).toEqual([]);
  }, 240_000);

  it.skipIf(!engine.available)("past 500 real conversations an hour the chat's breaker pauses it, tells once, and a resume reopens it and counts again from nothing", async () => {
    for (let one = 1; one <= CHAT_STARTS_PER_HOUR; one += 1) expect(await caps.counted('live-chat', String(one), AT + one)).toBe(true);
    expect(await caps.pausedUntil('live-chat', AT + 501)).toBeNull();
    // A conversation counts once, however many messages it sends.
    expect(await caps.counted('live-chat', '1', AT + 550)).toBe(false);
    expect(await caps.pausedUntil('live-chat', AT + 551)).toBeNull();
    // The 501st real conversation trips it: written all the same, but new ones pause.
    expect(await caps.counted('live-chat', '501', AT + 600)).toBe(true);
    expect(await caps.pausedUntil('live-chat', AT + 601)).toBe(AT + 600 + CHAT_PAUSE_MS);
    // Another chat on the install is not paused.
    expect(await caps.pausedUntil('other-chat', AT + 601)).toBeNull();
    // Paused: every new conversation is refused, and nobody is told twice.
    expect(await caps.chargeStart('live-chat', '203.0.113.2', AT + 700)).toMatchObject({ ok: false, cap: 'paused' });
    await caps.counted('live-chat', '502', AT + 701);
    expect(told).toEqual([{ addOn: 'live-chat', until: AT + 600 + CHAT_PAUSE_MS }]);
    // A person resumes it: open again, and what was counted before is not counted again.
    expect(await caps.resume('live-chat', AT + 800)).toBe(true);
    expect(await caps.pausedUntil('live-chat', AT + 801)).toBeNull();
    expect((await caps.chargeStart('live-chat', '203.0.113.3', AT + 900)).ok).toBe(true);
    expect(await caps.counted('live-chat', '503', AT + 901)).toBe(true);
    expect(await caps.pausedUntil('live-chat', AT + 902)).toBeNull();
    // A chat that is not paused has nothing to resume.
    expect(await caps.resume('live-chat', AT + 1000)).toBe(false);
  }, 240_000);

  it.skipIf(!engine.available)('the pause ends by itself after its hour', async () => {
    for (let one = 0; one <= CHAT_STARTS_PER_HOUR; one += 1) await caps.counted('live-chat', String(one), AT + one);
    expect(await caps.pausedUntil('live-chat', AT + 1000)).not.toBeNull();
    expect(await caps.pausedUntil('live-chat', AT + 500 + CHAT_PAUSE_MS + 1)).toBeNull();
  }, 240_000);

  it.skipIf(!engine.available)('the human check asks two bits more per quarter of the hour past half its starts, at most six', async () => {
    const half = CHAT_STARTS_PER_HOUR / 2;
    const quarter = CHAT_STARTS_PER_HOUR / 4;
    let made = 0;
    const startTo = async (n: number) => {
      for (; made < n; made += 1) expect((await caps.chargeStart('live-chat', v4(made), AT + made)).ok).toBe(true);
    };
    expect(await caps.difficulty('live-chat', AT)).toBe(PROOF_DIFFICULTY);
    await startTo(half);
    expect(await caps.difficulty('live-chat', AT + 1000)).toBe(PROOF_DIFFICULTY);
    await startTo(half + 1);
    expect(await caps.difficulty('live-chat', AT + 1000)).toBe(PROOF_DIFFICULTY + 2);
    await startTo(half + quarter + 1);
    expect(await caps.difficulty('live-chat', AT + 1000)).toBe(PROOF_DIFFICULTY + 4);
    await startTo(CHAT_STARTS_PER_HOUR + 1);
    expect(await caps.difficulty('live-chat', AT + 1000)).toBe(PROOF_DIFFICULTY + 6);
    await startTo(CHAT_STARTS_PER_HOUR + quarter + 1);
    expect(await caps.difficulty('live-chat', AT + 1000)).toBe(PROOF_DIFFICULTY + 6);
    // Another chat asks the usual work; an hour on, so does this one.
    expect(await caps.difficulty('other-chat', AT + 1000)).toBe(PROOF_DIFFICULTY);
    expect(await caps.difficulty('live-chat', AT + 3_600_000 + made)).toBe(PROOF_DIFFICULTY);
  }, 240_000);

  it.skipIf(!engine.available)('the details change ten times an hour; the eleventh is told to wait', async () => {
    for (let one = 0; one < CHAT_DETAILS_PER_HOUR; one += 1) expect((await caps.chargeDetails('live-chat', '1', AT + one)).ok).toBe(true);
    expect(await caps.chargeDetails('live-chat', '1', AT + 100)).toEqual({ ok: false, cap: 'details', retryAfter: 3600 });
    expect((await caps.chargeDetails('live-chat', '2', AT + 100)).ok).toBe(true);
  });

  it.skipIf(!engine.available)("an address's keyed hashes (its /64, /56 and /48 too) are gone after 3 hours, and are never the address", async () => {
    await caps.chargeStart('live-chat', '198.51.100.7', AT);
    await caps.chargeStart('live-chat', '2001:db8:5:6::7', AT);
    const rows = await handle.meta.db.selectFrom('adminium_form_marks').select(['subject', 'purpose']).execute();
    expect(rows.some((row) => row.subject.includes('198.51.100.7') || row.subject.includes('2001:db8'))).toBe(false);
    expect(rows.filter((row) => row.purpose === 'chat-new')).toHaveLength(4);
    expect(await caps.prune(AT + CHAT_ADDRESS_KEEP_MS - 1)).toBe(0);
    expect(await caps.prune(AT + CHAT_ADDRESS_KEEP_MS + 1)).toBe(4);
    const left = await handle.meta.db.selectFrom('adminium_form_marks').select(['purpose']).execute();
    expect(left.filter((row) => row.purpose === 'chat-new')).toHaveLength(0);
  });
});
