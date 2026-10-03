// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a turn no longer needs, folded before each call to the model (65-T64).
 *
 * Every step sends the whole conversation again. Measured on real turns, half
 * of what is sent after the fixed prompt is text the model cannot use any
 * more: a file it read before it rewrote it, the earlier of nine writes of one
 * file, a check that a later check replaced, a reference read forty steps ago.
 * Each of those is cut to a line that says what it was and how to get it
 * again. The stored transcript is never changed: this is a view of it.
 *
 * Nothing in the last few messages is touched, and the same transcript always
 * folds the same way, so what a provider cached of the conversation's start
 * stays good from one step to the next.
 */
import type { RunBlock, RunMessage } from '@adminium/llm';

/** The newest messages, left exactly as they are: the model is still working from them. */
export const FOLD_KEEP_LAST = 6;
/** Reference pages kept whole: the newest few. A build seldom works from more at once. */
export const FOLD_KEEP_REFERENCES = 4;
/** What is left of a cut text. */
const HEAD = 160;

/** A text the fold cut. A model that copies one back as a file's words is told so, and nothing is written. */
export const FOLDED_MARK = /… \(\d+ more characters (written then|of )/;

type Call = Extract<RunBlock, { type: 'tool_call' }>;

const path = (call: Call): string | null => (typeof call.input['path'] === 'string' ? call.input['path'] : null);
const cut = (text: string, why: string): string => (text.length <= HEAD + why.length + 40 ? text : `${text.slice(0, HEAD)} … (${String(text.length - HEAD)} more characters ${why})`);

/** The transcript as the model needs it now. Same length, same order, same calls; only long, spent texts are cut. */
export function foldSpent(messages: readonly RunMessage[]): RunMessage[] {
  const edge = messages.length - FOLD_KEEP_LAST;
  if (edge <= 0) return [...messages];

  // Every call, in order, with the message it is in.
  const calls: { call: Call; at: number }[] = [];
  for (const [at, message] of messages.entries()) {
    if (message.role !== 'assistant') continue;
    for (const block of message.content) if (block.type === 'tool_call') calls.push({ call: block, at });
  }
  const byId = new Map(calls.map((entry) => [entry.call.id, entry]));
  /** A later call on the same file, of one of these tools. */
  const later = (entry: { call: Call; at: number }, names: readonly string[]): boolean => {
    const file = path(entry.call);
    return file !== null && calls.some((other) => other.at > entry.at && names.includes(other.call.name) && path(other.call) === file);
  };
  const lastCheck = [...calls].reverse().find((entry) => entry.call.name === 'check_app');
  const references = calls.filter((entry) => entry.call.name === 'read_reference');
  const keptReferences = new Set(references.slice(-FOLD_KEEP_REFERENCES).map((entry) => entry.call.id));

  return messages.map((message, at) => {
    if (at >= edge) return message;
    let changed = false;
    const content = message.content.map((block): RunBlock => {
      if (block.type === 'tool_result') {
        const entry = byId.get(block.callId);
        if (entry === undefined) return block;
        const { name } = entry.call;
        let next = block.content;
        if (name === 'read_reference' && !keptReferences.has(entry.call.id)) {
          next = cut(block.content, 'of this page, read earlier; read_reference gives it again');
        } else if (name === 'read_file' && later(entry, ['read_file', 'write_file', 'edit_file', 'delete_file'])) {
          next = cut(block.content, 'of the file as it was then; it was read or changed after this, and read_file gives it as it is now');
        } else if (name === 'check_app' && lastCheck !== undefined && entry !== lastCheck) {
          next = cut(block.content, 'of an earlier check; the latest check is what holds');
        } else if (name === 'edit_file' && block.isError === true && later(entry, ['read_file', 'write_file', 'edit_file'])) {
          next = cut(block.content, 'of the file as it was then');
        }
        if (next === block.content) return block;
        changed = true;
        return { ...block, content: next };
      }
      if (block.type === 'tool_call') {
        const entry = byId.get(block.id);
        if (entry === undefined) return block;
        // The words of a file written again, or read back, later: the later step carries the file.
        if (block.name === 'write_file' && typeof block.input['content'] === 'string' && later(entry, ['write_file', 'read_file'])) {
          const next = cut(block.input['content'], 'written then; a later step has the file');
          if (next === block.input['content']) return block;
          changed = true;
          return { ...block, input: { ...block.input, content: next } };
        }
        if (block.name === 'edit_file' && later(entry, ['write_file', 'read_file'])) {
          const input = { ...block.input };
          for (const key of ['old', 'new']) {
            const value = input[key];
            if (typeof value === 'string') input[key] = cut(value, 'of an edit made then; a later step has the file');
          }
          if (input['old'] === block.input['old'] && input['new'] === block.input['new']) return block;
          changed = true;
          return { ...block, input };
        }
      }
      return block;
    });
    return changed ? { ...message, content } : message;
  });
}
