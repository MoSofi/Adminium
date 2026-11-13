// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Presence (`presence.ts`): one request a minute while the tab is visible and
 * the person did something in the last five minutes; nothing from a hidden tab
 * or an untouched one, and nothing once stopped.
 */
import { describe, expect, it } from 'vitest';

import { ACTIVE_WITHIN_MS, PRESENCE_EVERY_MS, startPresence, type PresenceDeps } from './presence.js';

function harness() {
  const listeners = new Map<string, Set<() => void>>();
  const state = {
    now: 0,
    visibility: 'visible' as DocumentVisibilityState,
    sent: 0,
    tick: null as null | (() => void),
    stopped: false,
  };
  const deps: PresenceDeps = {
    now: () => state.now,
    doc: {
      get visibilityState() {
        return state.visibility;
      },
      addEventListener: (name: string, run: () => void) => {
        listeners.set(name, (listeners.get(name) ?? new Set()).add(run));
      },
      removeEventListener: (name: string, run: () => void) => {
        listeners.get(name)?.delete(run);
      },
    } as unknown as PresenceDeps['doc'],
    send: async () => {
      state.sent += 1;
    },
    every: (run, ms) => {
      expect(ms).toBe(PRESENCE_EVERY_MS);
      state.tick = run;
      return () => {
        state.stopped = true;
      };
    },
  };
  /** A minute passes and the timer fires. */
  const minute = () => {
    state.now += PRESENCE_EVERY_MS;
    state.tick?.();
  };
  const fire = (name: string) => {
    for (const run of listeners.get(name) ?? []) run();
  };
  return { state, deps, minute, fire, listeners };
}

describe('startPresence', () => {
  it('sends once a minute while the tab is visible and the person active', () => {
    const h = harness();
    startPresence(h.deps);
    h.minute();
    h.fire('pointermove');
    h.minute();
    h.fire('keydown');
    h.minute();
    expect(h.state.sent).toBe(3);
  });

  it('sends nothing from a hidden tab', () => {
    const h = harness();
    startPresence(h.deps);
    h.state.visibility = 'hidden';
    h.fire('pointermove');
    h.minute();
    h.minute();
    expect(h.state.sent).toBe(0);
  });

  it('stops after five minutes without a move, key or scroll, and starts again on one', () => {
    const h = harness();
    startPresence(h.deps);
    for (let i = 0; i < ACTIVE_WITHIN_MS / PRESENCE_EVERY_MS + 2; i += 1) h.minute();
    // Minutes 1 to 4 count; at minute 5 the last activity is five minutes old.
    expect(h.state.sent).toBe(ACTIVE_WITHIN_MS / PRESENCE_EVERY_MS - 1);
    const before = h.state.sent;
    h.fire('scroll');
    h.minute();
    expect(h.state.sent).toBe(before + 1);
  });

  it('stops its timer and its listeners when stopped', () => {
    const h = harness();
    const stop = startPresence(h.deps);
    stop();
    expect(h.state.stopped).toBe(true);
    for (const set of h.listeners.values()) expect(set.size).toBe(0);
  });
});
