// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import type { AssistantSession, AssistantTurn } from '@adminium/meta';
import { composeHistory, HISTORY_NEWEST_SHARE, type HistoryPiece } from '../src/assistant/sessions.js';

const session = { id: 's', context: 'data', draft: null } as unknown as AssistantSession;

function piece(n: number, over: Partial<AssistantTurn> = {}, size = 40): HistoryPiece {
  const turn = {
    id: `t${n}`,
    status: 'done',
    askText: `question ${n}`,
    say: `answer ${n}`,
    context: 'data',
    result: null,
    answer: { reads: [{ table: 'orders', rows: 12 }] },
    ...over,
  } as unknown as AssistantTurn;
  return {
    turn,
    whole: [
      { role: 'user', content: `question ${n}` },
      { role: 'assistant', content: 'x'.repeat(size) },
    ],
  };
}

const opening = { role: 'user' as const, content: 'and now?' };
const outlineOf = (content: string) =>
  (JSON.parse(content) as { earlier_in_this_conversation: Array<Record<string, unknown>> }).earlier_in_this_conversation;

describe('what a turn is sent of the conversation before it', () => {
  it('sends a first question alone', () => {
    const out = composeHistory({ session, open: null, pieces: [], opening, system: 'sys', limit: 10_000 });
    expect(out).toEqual({ messages: [opening], forgot: 0, outlined: 0 });
  });

  it('keeps the turn just before whole and tells older ones in outline, with what was read and never the rows', () => {
    const out = composeHistory({ session, open: null, pieces: [piece(1), piece(2), piece(3)], opening, system: 'sys', limit: 10_000 });
    expect(out.forgot).toBe(0);
    expect(out.outlined).toBe(2);
    expect(out.messages.slice(1).map((message) => message.content)).toEqual(['question 3', 'x'.repeat(40), 'and now?']);
    expect(outlineOf(out.messages[0]!.content)).toEqual([
      { asked: 'question 1', on: 'data', read: [{ table: 'orders', rows: 12 }], answered: 'answer 1' },
      { asked: 'question 2', on: 'data', read: [{ table: 'orders', rows: 12 }], answered: 'answer 2' },
    ]);
  });

  it('tells the turn just before in outline too when it alone is a large share of the window', () => {
    const limit = 2_000;
    const big = piece(2, {}, Math.ceil(HISTORY_NEWEST_SHARE * limit * 4) + 400);
    const out = composeHistory({ session, open: null, pieces: [piece(1), big], opening, system: 'sys', limit });
    expect(out.outlined).toBe(2);
    expect(out.messages).toHaveLength(2);
    expect(outlineOf(out.messages[0]!.content).map((turn) => turn.asked)).toEqual(['question 1', 'question 2']);
  });

  it('always sends whole a turn that asked the person something back, whatever its size', () => {
    const limit = 2_000;
    const big = piece(2, { status: 'awaiting_picks' } as Partial<AssistantTurn>, Math.ceil(HISTORY_NEWEST_SHARE * limit * 4) + 400);
    const out = composeHistory({ session, open: null, pieces: [piece(1), big], opening, system: 'sys', limit });
    expect(out.outlined).toBe(1);
    expect(out.messages.map((message) => message.content)).toContain(big.whole[1]!.content);
  });

  it('leaves the oldest turns out, and says how many, when the outline itself outgrows the window', () => {
    const pieces = Array.from({ length: 40 }, (_, n) => piece(n + 1, { say: 'y'.repeat(500) } as Partial<AssistantTurn>));
    const out = composeHistory({ session, open: null, pieces, opening, system: 'sys', limit: 1_500 });
    expect(out.forgot).toBeGreaterThan(0);
    expect(out.forgot + out.outlined).toBe(39);
    // What is left is the END of the conversation.
    const asked = outlineOf(out.messages[0]!.content).map((turn) => turn.asked);
    expect(asked.at(-1)).toBe('question 39');
    expect(asked[0]).toBe(`question ${out.forgot + 1}`);
  });

  it('cuts a long earlier answer short in the outline and names a draft by its title', () => {
    const drafted = piece(1, { say: 'z'.repeat(2_000), result: { title: 'Late orders' } } as Partial<AssistantTurn>);
    const out = composeHistory({ session, open: null, pieces: [drafted, piece(2)], opening, system: 'sys', limit: 10_000 });
    const [first] = outlineOf(out.messages[0]!.content);
    expect((first!.answered as string).length).toBe(600);
    expect(first!.drafted).toBe('Late orders');
  });

  it('puts the open document first', () => {
    const open = { role: 'user' as const, content: '{"open_document":{}}' };
    const out = composeHistory({ session, open, pieces: [piece(1), piece(2)], opening, system: 'sys', limit: 10_000 });
    expect(out.messages[0]).toBe(open);
  });
});
