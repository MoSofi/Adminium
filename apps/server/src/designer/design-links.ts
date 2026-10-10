// SPDX-License-Identifier: AGPL-3.0-only
/**
 * One-use links that sign the project's local owner in from another browser
 * on this machine.
 *
 * The link `adminium design` prints, and the one the desktop app opens its
 * window with, is this run's single token, and the window spends it. A person
 * who then asks for the dashboard "in a new tab" from inside the desktop app
 * is sent to the system's browser, which holds no session. So the owner,
 * already signed in, may ask for one more link: a fresh token, good for a
 * minute, spent on first use, taken by the same door
 * (`routes/auth/design-session.ts`) under every one of its other gates.
 *
 * Held in memory only, a few at a time: a server that runs long does not
 * collect them, and a restart forgets them all.
 */
import { randomBytes } from 'node:crypto';

import { bootTokenMatches } from '../auth/desktop-session.js';

/** How long a link asked for can be opened: long enough for a browser to start. */
export const DESIGN_BROWSER_LINK_MS = 60_000;
const HELD_MOST = 5;

export interface DesignLinks {
  /** A new token, good once and for a minute. */
  issue(): string;
  /** Whether `candidate` is a token that was issued, is not too old and was never used. It is spent by this call. */
  claim(candidate: string): boolean;
}

export function createDesignLinks(opts: { now?: () => number; token?: () => string } = {}): DesignLinks {
  const now = opts.now ?? Date.now;
  const make = opts.token ?? (() => randomBytes(32).toString('hex'));
  let held: { token: string; until: number }[] = [];
  const live = (): void => {
    held = held.filter((link) => link.until >= now());
  };
  return {
    issue() {
      live();
      const token = make();
      held = [...held, { token, until: now() + DESIGN_BROWSER_LINK_MS }].slice(-HELD_MOST);
      return token;
    },
    claim(candidate) {
      live();
      // Every held one is compared, in constant time each: which one matched is not told by how long it took.
      let found = -1;
      held.forEach((link, index) => {
        if (bootTokenMatches(candidate, link.token)) found = index;
      });
      if (found === -1) return false;
      held = held.filter((_, index) => index !== found);
      return true;
    },
  };
}
