// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The asleep answer (`asleep.ts`): an API call that gets a 503 with
 * `X-Aapp-Asleep: 1` reloads the page, at most once in the gap, and any other
 * answer does nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api, ApiError } from './api.js';
import { ASLEEP_RELOAD_GAP_MS, reloadIfAsleep, resetAsleepReload, type AsleepDeps } from './asleep.js';

function answer(status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ error: { code: 'ASLEEP', message: 'Waking up.' } }), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

const ASLEEP = { 'retry-after': '5', 'x-aapp-asleep': '1' };

function deps(start = 1_000_000): AsleepDeps & { at: { now: number }; reloads: number; store: Map<string, string> } {
  const store = new Map<string, string>();
  const state = {
    at: { now: start },
    reloads: 0,
    store,
    now: () => state.at.now,
    reload: () => {
      state.reloads += 1;
    },
    storage: () => ({ getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) }),
  };
  return state;
}

beforeEach(() => {
  resetAsleepReload();
  try {
    window.sessionStorage.clear();
  } catch {
    // None in this environment.
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('reloadIfAsleep', () => {
  it('reloads on the asleep answer', () => {
    const d = deps();
    expect(reloadIfAsleep(answer(503, ASLEEP), d)).toBe(true);
    expect(d.reloads).toBe(1);
  });

  it('does nothing for any other answer', () => {
    const d = deps();
    expect(reloadIfAsleep(answer(503, { 'retry-after': '5' }), d)).toBe(false);
    expect(reloadIfAsleep(answer(500, { 'x-aapp-asleep': '1' }), d)).toBe(false);
    expect(reloadIfAsleep(answer(503, { 'x-aapp-asleep': '0' }), d)).toBe(false);
    expect(d.reloads).toBe(0);
  });

  it('reloads at most once in the gap, remembered across the reload', () => {
    const d = deps();
    expect(reloadIfAsleep(answer(503, ASLEEP), d)).toBe(true);
    // The page reloaded: its memory is gone, session storage is not.
    resetAsleepReload();
    d.at.now += ASLEEP_RELOAD_GAP_MS - 1;
    expect(reloadIfAsleep(answer(503, ASLEEP), d)).toBe(false);
    d.at.now += 1;
    expect(reloadIfAsleep(answer(503, ASLEEP), d)).toBe(true);
    expect(d.reloads).toBe(2);
  });

  it('still keeps the gap within the page when session storage throws', () => {
    const d = deps();
    d.storage = () => {
      throw new Error('blocked');
    };
    expect(reloadIfAsleep(answer(503, ASLEEP), d)).toBe(true);
    expect(reloadIfAsleep(answer(503, ASLEEP), d)).toBe(false);
    expect(d.reloads).toBe(1);
  });
});

describe('the API client', () => {
  it('reloads the page when a call gets the asleep answer, and still rejects the call', async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answer(503, ASLEEP)));
    await expect(api.get('/api/v1/bootstrap')).rejects.toBeInstanceOf(ApiError);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload for an ordinary 503', async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answer(503)));
    await expect(api.get('/api/v1/bootstrap')).rejects.toBeInstanceOf(ApiError);
    expect(reload).not.toHaveBeenCalled();
  });
});
