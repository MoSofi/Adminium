// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `addOn.chat`: the add-on block names a live chat's four tables. Only the
 * refs are typed here; the manifest package checks the tables themselves.
 */
import { describe, expect, it } from 'vitest';

import { addOnBlockSchema } from '../src/index.js';

const BLOCK = { attaches: [{ app: '*', range: '*' }], connect: { kind: 'none' } };
const CHAT = { conversations: 'conversations', messages: 'messages', answers: 'answers', choices: 'choices' };

describe('an add-on block that declares chat', () => {
  it('takes the four table refs', () => {
    const result = addOnBlockSchema.safeParse({ ...BLOCK, chat: CHAT });
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    expect(result.data?.chat).toEqual(CHAT);
  });

  it('is absent from a block that declares none', () => {
    expect(addOnBlockSchema.parse(BLOCK).chat).toBeUndefined();
  });

  it('refuses a missing part or a ref that is not a table ref', () => {
    const without = { ...CHAT } as Partial<typeof CHAT>;
    delete without.choices;
    expect(addOnBlockSchema.safeParse({ ...BLOCK, chat: without }).success).toBe(false);
    expect(addOnBlockSchema.safeParse({ ...BLOCK, chat: { ...CHAT, messages: 'Messages' } }).success).toBe(false);
  });

  it('keeps any other word for the manifest package to judge', () => {
    // Loose here, as forms is: the manifest's own schema is strict and refuses it there.
    expect(addOnBlockSchema.safeParse({ ...BLOCK, chat: { ...CHAT, extra: 'x' } }).success).toBe(true);
  });
});
