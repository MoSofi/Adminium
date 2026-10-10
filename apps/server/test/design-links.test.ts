// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { createDesignLinks, DESIGN_BROWSER_LINK_MS } from '../src/designer/design-links.js';

describe('the links an owner asks for', () => {
  it('are 64 hex characters, good once, and each its own', () => {
    const links = createDesignLinks();
    const one = links.issue();
    const two = links.issue();
    expect(one).toMatch(/^[0-9a-f]{64}$/);
    expect(two).not.toBe(one);
    expect(links.claim('f'.repeat(64))).toBe(false);
    expect(links.claim(two)).toBe(true);
    expect(links.claim(two)).toBe(false);
    // A wrong guess and another link's use spent nothing of this one.
    expect(links.claim(one)).toBe(true);
  });

  it('are good for a minute and no longer', () => {
    let clock = 1000;
    const links = createDesignLinks({ now: () => clock });
    const early = links.issue();
    clock += DESIGN_BROWSER_LINK_MS;
    expect(links.claim(early)).toBe(true);
    const late = links.issue();
    clock += DESIGN_BROWSER_LINK_MS + 1;
    expect(links.claim(late)).toBe(false);
  });

  it('holds a few at a time: the oldest give way', () => {
    let n = 0;
    const links = createDesignLinks({ token: () => String((n += 1)).padStart(64, '0') });
    const all = Array.from({ length: 7 }, () => links.issue());
    expect(all.map((token) => links.claim(token))).toEqual([false, false, true, true, true, true, true]);
  });
});
