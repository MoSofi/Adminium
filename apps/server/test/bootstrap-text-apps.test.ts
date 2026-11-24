// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `textAppGrants`: which apps' conversations an app role opens. The bootstrap
 * hands it to the console, which offers Conversations to a desk that holds no
 * console-wide key, and the conversation routes read the same answer.
 */
import { describe, expect, it } from 'vitest';

import { textAppGrants } from '../src/sms/threads/permission.js';

describe('textAppGrants', () => {
  it('reads each app once, replying winning over reading in either order', () => {
    expect([...textAppGrants(['texts:hotel:read', 'texts:hotel:reply', 'texts:clinic:read'])]).toEqual([
      ['hotel', 'reply'],
      ['clinic', 'read'],
    ]);
    expect([...textAppGrants(['texts:hotel:reply', 'texts:hotel:read'])]).toEqual([['hotel', 'reply']]);
  });

  it('ignores every other grant, and the console-wide keys', () => {
    expect([...textAppGrants(['system:texts:read', 'system:texts:reply', 'table:c:*:read', 'texts:a:b:read', 'texts:hotel:manage'])]).toEqual([]);
  });
});
