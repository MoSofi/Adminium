// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The chat door as the window reads it: a closed chat's poll is an answer
 * (the window shows who closed it), never a refusal; a write on it is; a
 * tripped cap says which; a refused token is lost; no cookie ever goes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatOffline, chatDoor, isRefusal } from './api.js';

function answer(status: number, body: unknown, headers: Record<string, string> = {}): void {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status, headers })));
}

afterEach(() => vi.unstubAllGlobals());

describe('the chat door, as the window reads it', () => {
  it('a closed chat’s poll is an answer, not a refusal; a write on it is one', async () => {
    answer(200, { state: 'closed', staff: false, messages: [], cursor: '9', open: true, closesAt: null, nextOpen: null });
    const polled = await chatDoor('live-chat').poll('tok', '9');
    expect(isRefusal(polled)).toBe(false);
    expect(polled).toMatchObject({ state: 'closed', cursor: '9' });
    answer(409, { state: 'closed' });
    expect(await chatDoor('live-chat').post('tok', { body: 'hello' })).toEqual({ state: 'write-closed' });
  });

  it('a tripped cap says which and how long; the chat’s own cap has no wait', async () => {
    answer(429, { state: 'too-many', cap: 'hour', retryAfter: 2400 });
    expect(await chatDoor('live-chat').post('tok', { body: 'x' })).toEqual({ state: 'too-many', cap: 'hour', retryAfter: 2400 });
    answer(429, { state: 'too-many', cap: 'conversation', retryAfter: null });
    expect(await chatDoor('live-chat').post('tok', { body: 'x' })).toEqual({ state: 'too-many', cap: 'conversation', retryAfter: null });
    answer(429, { state: 'too-many', cap: 'details', retryAfter: 1500 });
    expect(await chatDoor('live-chat').details('tok', { name: 'Marta' })).toEqual({ state: 'too-many', cap: 'details', retryAfter: 1500 });
    answer(410, { state: 'lost' });
    expect(await chatDoor('live-chat').poll('tok', '0')).toEqual({ state: 'lost' });
  });

  it('a chat that is not available is no config at all; an unreachable door is offline', async () => {
    answer(404, { state: 'unavailable' });
    expect(await chatDoor('live-chat').config({ lang: null, frame: true, preview: false })).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    await expect(chatDoor('live-chat').poll('tok', '0')).rejects.toBeInstanceOf(ChatOffline);
  });

  it('sends the token in its header for a poll, never a cookie, and the add-on’s own address', async () => {
    answer(200, { state: 'bot', staff: false, messages: [], cursor: '0', open: true, closesAt: null, nextOpen: null });
    await chatDoor('live chat').poll('tok', '12');
    const [url, init] = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect(url).toBe('/x/chat/api/live%20chat/messages?after=12');
    expect(init.credentials).toBe('omit');
    expect((init.headers as Record<string, string>)['x-adminium-chat']).toBe('tok');
  });
});
