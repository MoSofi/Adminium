// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The asleep answer (`asleep.ts`): an API call that gets a 503 with
 * `X-Aapp-Asleep: 1` reloads the page, at most once in the gap, and any other
 * answer does nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api, ApiError } from './api.js';
import { ASLEEP_RELOAD_GAP_MS, reloadIfAsleep, resetAsleepReload } from './asleep.js';

function answer(status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ error: { code: 'ASLEEP', message: 'Waking up.' } }), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

const ASLEEP = { 'retry-after': '5', 'x-aapp-asleep': '1' };
const T = 1_000_000;

let reload: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetAsleepReload();
  sessionStorage.clear();
  reload = vi.fn();
  vi.stubGlobal('location', { ...window.location, reload });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('reloadIfAsleep', () => {
  it('reloads on the asleep answer', () => {
    expect(reloadIfAsleep(answer(503, ASLEEP), T)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does nothing for any other answer', () => {
    expect(reloadIfAsleep(answer(503, { 'retry-after': '5' }), T)).toBe(false);
    expect(reloadIfAsleep(answer(500, { 'x-aapp-asleep': '1' }), T)).toBe(false);
    expect(reloadIfAsleep(answer(503, { 'x-aapp-asleep': '0' }), T)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads at most once in the gap, remembered across the reload', () => {
    expect(reloadIfAsleep(answer(503, ASLEEP), T)).toBe(true);
    // The page reloaded: its memory is gone, session storage is not.
    resetAsleepReload();
    expect(reloadIfAsleep(answer(503, ASLEEP), T + ASLEEP_RELOAD_GAP_MS - 1)).toBe(false);
    expect(reloadIfAsleep(answer(503, ASLEEP), T + ASLEEP_RELOAD_GAP_MS)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('still keeps the gap within the page when session storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(reloadIfAsleep(answer(503, ASLEEP), T)).toBe(true);
    expect(reloadIfAsleep(answer(503, ASLEEP), T + 1000)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('the API client', () => {
  it('reloads the page when a call gets the asleep answer, and still rejects the call', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answer(503, ASLEEP)));
    await expect(api.get('/api/v1/bootstrap')).rejects.toBeInstanceOf(ApiError);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload for a save, so what the person typed stays, and still rejects it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answer(503, ASLEEP)));
    await expect(api.post('/api/v1/bootstrap', { a: 1 })).rejects.toBeInstanceOf(ApiError);
    expect(reload).not.toHaveBeenCalled();
  });

  it('does not reload for an ordinary 503', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answer(503)));
    await expect(api.get('/api/v1/bootstrap')).rejects.toBeInstanceOf(ApiError);
    expect(reload).not.toHaveBeenCalled();
  });
});
