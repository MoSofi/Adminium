// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { hookAnswerSchema } from '../src/calendar-provider.js';

describe('a service\'s handshake', () => {
  const answer = (handshake: string) => hookAnswerSchema.safeParse({ handshake, notices: [] }).success;

  it('may hold spaces, because Microsoft\'s token is opaque text', () => {
    expect(answer('Validation: Testing client application reachability for subscription Request-Id: 25ff4c23')).toBe(true);
  });

  it('holds no line break or control character, and is bounded', () => {
    expect(answer('one\r\nSet-Cookie: x=1')).toBe(false);
    expect(answer('tab\there')).toBe(false);
    expect(answer('x'.repeat(513))).toBe(false);
  });

  it('holds none of the characters markup needs', () => {
    for (const mark of ['<', '>', '&', '"', "'", '`']) expect(answer(`a${mark}b`), mark).toBe(false);
  });
});
