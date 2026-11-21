// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { openLink, sealLink } from '../src/email/sealed-link.js';

const KEY = 'a-key-long-enough-for-this-test-0123456789';
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

describe('a sealed link has one spelling', () => {
  it.each([1, 2])('refuses a last letter that decodes to the same bytes (%i spare)', (spare) => {
    // A claim whose token ends part-way through a byte group, so its last letter carries spare bits.
    let token = '';
    for (let size = 0; size < 6; size += 1) {
      token = sealLink(KEY, 'test', { a: 'x'.repeat(size) });
      if (Buffer.from(token, 'base64url').length % 3 === spare) break;
    }
    expect(openLink([KEY], 'test', token)).not.toBeNull();
    const bytes = Buffer.from(token, 'base64url');
    const twins = [...LETTERS].map((letter) => `${token.slice(0, -1)}${letter}`).filter((other) => other !== token && Buffer.from(other, 'base64url').equals(bytes));
    expect(twins.length).toBeGreaterThan(0);
    for (const twin of twins) expect(openLink([KEY], 'test', twin)).toBeNull();
  });
});
