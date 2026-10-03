// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a turn no longer needs is cut before each call to the model (65-T64).
 * The cuts are a view: same messages, same calls, same order; and nothing the
 * model is still working from is touched.
 */
import type { RunBlock, RunMessage } from '@adminium/llm';
import { describe, expect, it } from 'vitest';

import { FOLD_KEEP_LAST, FOLD_KEEP_REFERENCES, FOLDED_MARK, foldSpent } from '../src/designer/fold.js';

const LONG = (word: string): string => `${word} `.repeat(400);
let n = 0;
/** One step: the model's call and its answer. */
const step = (name: string, input: Record<string, unknown>, result: string, isError = false): RunMessage[] => {
  n += 1;
  const id = `c${String(n)}`;
  return [
    { role: 'assistant', content: [{ type: 'tool_call', id, name, input }] },
    { role: 'user', content: [{ type: 'tool_result', callId: id, content: result, ...(isError ? { isError: true } : {}) }] },
  ];
};
/** Steps that fold nothing, so what came before them is no longer "the last few". */
const filler = (): RunMessage[] => Array.from({ length: FOLD_KEEP_LAST / 2 }, () => step('list_files', {}, 'apps/x/manifest/app.json')).flat();
const resultOf = (messages: RunMessage[], at: number): string => (messages[at]?.content[0] as Extract<RunBlock, { type: 'tool_result' }>).content;
const inputOf = (messages: RunMessage[], at: number): Record<string, unknown> => (messages[at]?.content[0] as Extract<RunBlock, { type: 'tool_call' }>).input;

describe('the fold', () => {
  it('leaves a short conversation, and the newest messages of any, exactly as they are', () => {
    const short = [...step('read_file', { path: 'a.json' }, LONG('a')), ...step('write_file', { path: 'a.json', content: LONG('b') }, 'Wrote a.json')];
    expect(foldSpent(short)).toEqual(short);
    const long = [...filler(), ...step('read_file', { path: 'a.json' }, LONG('a')), ...step('read_file', { path: 'a.json' }, LONG('a')), ...step('check_app', {}, LONG('error')), ...step('check_app', {}, LONG('error'))];
    const folded = foldSpent(long);
    expect(folded.slice(-FOLD_KEEP_LAST)).toEqual(long.slice(-FOLD_KEEP_LAST));
    expect(folded).toHaveLength(long.length);
  });

  it('cuts a file read before it was read or changed again, and says how to get it', () => {
    const messages = [...step('read_file', { path: 'a.json' }, LONG('old')), ...step('read_file', { path: 'b.json' }, LONG('kept')), ...step('edit_file', { path: 'a.json', old: 'x', new: 'y' }, 'Edited a.json'), ...filler()];
    const folded = foldSpent(messages);
    expect(resultOf(folded, 1)).toMatch(/^old old .* … \(\d+ more characters of the file as it was then; .* read_file gives it as it is now\)$/s);
    expect(resultOf(folded, 1).length).toBeLessThan(400);
    // A file nothing touched since is still whole.
    expect(resultOf(folded, 3)).toBe(LONG('kept'));
  });

  it('cuts the words of a file written again later, never the last write of it', () => {
    const messages = [
      ...step('write_file', { path: 'seeds/sample.json', content: LONG('first') }, 'Wrote'),
      ...step('write_file', { path: 'seeds/sample.json', content: LONG('second') }, 'Wrote'),
      ...step('write_file', { path: 'other.json', content: LONG('only') }, 'Wrote'),
      ...filler(),
    ];
    const folded = foldSpent(messages);
    expect(String(inputOf(folded, 0)['content'])).toMatch(FOLDED_MARK);
    expect(inputOf(folded, 0)['path']).toBe('seeds/sample.json');
    expect(inputOf(folded, 2)['content']).toBe(LONG('second'));
    expect(inputOf(folded, 4)['content']).toBe(LONG('only'));
  });

  it('keeps the latest check whole and cuts the ones it replaced', () => {
    const messages = [...step('check_app', {}, LONG('error one')), ...step('check_app', {}, LONG('error two')), ...filler()];
    const folded = foldSpent(messages);
    expect(resultOf(folded, 1)).toContain('of an earlier check; the latest check is what holds');
    expect(resultOf(folded, 3)).toBe(LONG('error two'));
  });

  it('keeps the newest reference pages whole and cuts the older ones', () => {
    const reads = Array.from({ length: FOLD_KEEP_REFERENCES + 2 }, (_, i) => step('read_reference', { name: `page-${String(i)}.md` }, LONG(`page${String(i)}`))).flat();
    const folded = foldSpent([...reads, ...filler()]);
    expect(resultOf(folded, 1)).toContain('read_reference gives it again');
    expect(resultOf(folded, 3)).toContain('read_reference gives it again');
    for (let i = 2; i < FOLD_KEEP_REFERENCES + 2; i += 1) expect(resultOf(folded, i * 2 + 1)).toBe(LONG(`page${String(i)}`));
  });

  it('cuts a failed edit’s copy of the file once the file was read or changed again', () => {
    const messages = [...step('edit_file', { path: 'a.json', old: 'q', new: 'r' }, `"old" is not in a.json. The file is now:\n${LONG('line')}`, true), ...step('write_file', { path: 'a.json', content: '{}' }, 'Wrote'), ...filler()];
    expect(resultOf(foldSpent(messages), 1)).toContain('of the file as it was then');
  });

  it('never changes what it was given, and folds the same transcript the same way', () => {
    const messages = [...step('read_file', { path: 'a.json' }, LONG('old')), ...step('write_file', { path: 'a.json', content: LONG('new') }, 'Wrote'), ...step('read_file', { path: 'a.json' }, LONG('new')), ...filler()];
    const copy = JSON.stringify(messages);
    const once = foldSpent(messages);
    expect(JSON.stringify(messages)).toBe(copy);
    expect(foldSpent(messages)).toEqual(once);
    // Every call still has its answer, in place: a provider refuses a conversation where one is missing.
    expect(once.map((message) => message.content.map((block) => (block.type === 'tool_call' ? block.id : block.type === 'tool_result' ? block.callId : '')))).toEqual(
      messages.map((message) => message.content.map((block) => (block.type === 'tool_call' ? block.id : block.type === 'tool_result' ? block.callId : ''))),
    );
    // A short text is not made longer by a note about it.
    const tiny = [...step('read_file', { path: 'a.json' }, '{}'), ...step('read_file', { path: 'a.json' }, '{}'), ...filler()];
    expect(resultOf(foldSpent(tiny), 1)).toBe('{}');
  });
});

describe('the fold, on a provider that numbers its calls afresh at every step', () => {
  /** Ollama's ids: "call_1" at every step. */
  const stepAs = (id: string, name: string, input: Record<string, unknown>, result: string, isError = false): RunMessage[] => [
    { role: 'assistant', content: [{ type: 'tool_call', id, name, input }] },
    { role: 'user', content: [{ type: 'tool_result', callId: id, content: result, ...(isError ? { isError: true } : {}) }] },
  ];

  it('reads a result against the call just before it, never against a later call that reused the id', () => {
    const messages = [
      ...stepAs('call_1', 'read_file', { path: 'b.json' }, LONG('kept')),
      ...stepAs('call_1', 'read_file', { path: 'a.json' }, LONG('old')),
      ...stepAs('call_1', 'write_file', { path: 'a.json', content: '{}' }, 'Wrote'),
      ...filler(),
    ];
    const folded = foldSpent(messages);
    // b.json was never touched again: whole. a.json was written after: cut.
    expect(resultOf(folded, 1)).toBe(LONG('kept'));
    expect(resultOf(folded, 3)).toContain('of the file as it was then');
  });

  it('a later call that was refused, or that read only some lines, does not stand for the file', () => {
    const refusedWrite = [...step('read_file', { path: 'a.json' }, LONG('whole')), ...step('write_file', { path: 'a.json', content: '{' }, 'That is not valid JSON.', true), ...filler()];
    expect(resultOf(foldSpent(refusedWrite), 1)).toBe(LONG('whole'));
    const paged = [...step('read_file', { path: 'long.md' }, LONG('first')), ...step('read_file', { path: 'long.md', from: 200, lines: 200 }, LONG('second')), ...filler()];
    expect(resultOf(foldSpent(paged), 1)).toBe(LONG('first'));
    const written = [...step('write_file', { path: 'a.json', content: LONG('body') }, 'Wrote'), ...step('read_file', { path: 'a.json', from: 1, lines: 5 }, 'five lines'), ...filler()];
    expect(inputOf(foldSpent(written), 0)['content']).toBe(LONG('body'));
  });

  it('never cuts through a character written as a pair', () => {
    const emoji = `${'a'.repeat(159)}😀${'b'.repeat(900)}`;
    const cutText = resultOf(foldSpent([...step('check_app', {}, emoji), ...step('check_app', {}, 'No errors.'), ...filler()]), 1);
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(cutText)).toBe(false);
    expect(cutText.startsWith(`${'a'.repeat(159)} …`)).toBe(true);
  });
});
