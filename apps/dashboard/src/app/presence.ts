// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Presence: "someone is using this dashboard", told to the server once a
 * minute, only where the operator switched it on (`ADMINIUM_PRESENCE`, read
 * from `/system/info`). An operator whose proxy puts idle instances to sleep
 * counts any request as use, so a person reading a page without clicking still
 * counts.
 *
 * Sent only while the tab is visible and the person moved, typed or scrolled
 * in the last {@link ACTIVE_WITHIN_MS}. A hidden tab, or one left open and
 * untouched, sends nothing. Loaded lazily by the shell, and only where it is on.
 */
import { useEffect } from 'react';

import { api } from './api.js';

/** How often a request is sent while the person is active. */
export const PRESENCE_EVERY_MS = 60_000;

/** How recent the last move, key or scroll must be to count as active. */
export const ACTIVE_WITHIN_MS = 5 * 60_000;

/** What counts as the person doing something. */
const ACTIVITY = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'scroll', 'touchstart'] as const;

export interface PresenceDeps {
  now: () => number;
  /** Where the activity events are heard, and whose visibility is read. */
  doc: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>;
  send: () => Promise<unknown>;
  every: (run: () => void, ms: number) => () => void;
}

const browser = (): PresenceDeps => ({
  now: () => Date.now(),
  doc: document,
  send: () => api.get('/api/v1/presence'),
  every: (run, ms) => {
    const id = setInterval(run, ms);
    return () => clearInterval(id);
  },
});

/** Start telling the server; the returned function stops. */
export function startPresence(deps: PresenceDeps = browser()): () => void {
  // The page was just opened or the shell just mounted: that is the person doing something.
  let lastActive = deps.now();
  const active = (): void => {
    lastActive = deps.now();
  };
  const options = { capture: true, passive: true };
  for (const name of ACTIVITY) deps.doc.addEventListener(name, active, options);
  const stop = deps.every(() => {
    if (deps.doc.visibilityState !== 'visible') return;
    if (deps.now() - lastActive >= ACTIVE_WITHIN_MS) return;
    // A failed send (signed out, offline) is not worth a word: the next minute tries again.
    deps.send().catch(() => undefined);
  }, PRESENCE_EVERY_MS);
  return () => {
    stop();
    for (const name of ACTIVITY) deps.doc.removeEventListener(name, active, options);
  };
}

/** Mounted by the shell where presence is on; draws nothing. */
export default function Presence(): null {
  useEffect(() => startPresence(), []);
  return null;
}
