// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a turn no longer needs, folded before each call to the model.
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
/** A call, where it is, and whether it was refused. */
interface Step {
  call: Call;
  at: number;
  failed: boolean;
}

const path = (call: Call): string | null => (typeof call.input['path'] === 'string' ? call.input['path'] : null);
/** The first `length` characters, never ending on half of a character written as a pair. */
function head(text: string, length: number): string {
  const code = text.charCodeAt(length - 1);
  return text.slice(0, code >= 0xd800 && code <= 0xdbff ? length - 1 : length);
}
const cut = (text: string, why: string): string => (text.length <= HEAD + why.length + 40 ? text : `${head(text, HEAD)} … (${String(text.length - HEAD)} more characters ${why})`);

/** The transcript as the model needs it now. Same length, same order, same calls; only long, spent texts are cut. */
export function foldSpent(messages: readonly RunMessage[]): RunMessage[] {
  const edge = messages.length - FOLD_KEEP_LAST;
  if (edge <= 0) return [...messages];

  // Every call, in order, with the message it is in. A call is known by the block itself, never by its id alone:
  // some providers number their calls afresh at every step ("call_1", "call_2"), so an id says nothing across steps.
  const steps: Step[] = [];
  const byBlock = new Map<Call, Step>();
  for (const [at, message] of messages.entries()) {
    if (message.role !== 'assistant') continue;
    for (const block of message.content) {
      if (block.type !== 'tool_call') continue;
      const step: Step = { call: block, at, failed: false };
      steps.push(step);
      byBlock.set(block, step);
    }
  }
  /** The call a result answers: the one with its id in the nearest assistant message before it. */
  const answered = (at: number, callId: string): Step | undefined => {
    for (let index = at - 1; index >= 0; index -= 1) {
      const message = messages[index] as RunMessage;
      if (message.role !== 'assistant') continue;
      const found = message.content.find((block): block is Call => block.type === 'tool_call' && block.id === callId);
      if (found !== undefined) return byBlock.get(found);
    }
    return undefined;
  };
  for (const [at, message] of messages.entries()) {
    if (message.role !== 'user') continue;
    for (const block of message.content) {
      if (block.type !== 'tool_result' || block.isError !== true) continue;
      const step = answered(at, block.callId);
      if (step !== undefined) step.failed = true;
    }
  }
  /**
   * A later call on the same file, of one of these tools, that DID something:
   * a refused write changed nothing, and reading lines 200 to 400 does not
   * stand for the file's first 200.
   */
  const later = (step: Step, names: readonly string[]): boolean => {
    const file = path(step.call);
    return (
      file !== null &&
      steps.some(
        (other) =>
          other.at > step.at &&
          !other.failed &&
          names.includes(other.call.name) &&
          path(other.call) === file &&
          !(other.call.name === 'read_file' && (other.call.input['from'] !== undefined || other.call.input['lines'] !== undefined)),
      )
    );
  };
  const lastCheck = [...steps].reverse().find((step) => step.call.name === 'check_app');
  const references = steps.filter((step) => step.call.name === 'read_reference');
  const keptReferences = new Set(references.slice(-FOLD_KEEP_REFERENCES));

  return messages.map((message, at) => {
    if (at >= edge) return message;
    let changed = false;
    const content = message.content.map((block): RunBlock => {
      if (block.type === 'tool_result') {
        const step = answered(at, block.callId);
        if (step === undefined) return block;
        const { name } = step.call;
        let next = block.content;
        if (name === 'read_reference' && !keptReferences.has(step)) {
          next = cut(block.content, 'of this page, read earlier; read_reference gives it again');
        } else if (name === 'read_file' && later(step, ['read_file', 'write_file', 'edit_file', 'delete_file'])) {
          next = cut(block.content, 'of the file as it was then; it was read or changed after this, and read_file gives it as it is now');
        } else if (name === 'check_app' && lastCheck !== undefined && step !== lastCheck) {
          next = cut(block.content, 'of an earlier check; the latest check is what holds');
        } else if (name === 'edit_file' && block.isError === true && later(step, ['read_file', 'write_file', 'edit_file'])) {
          next = cut(block.content, 'of the file as it was then');
        }
        if (next === block.content) return block;
        changed = true;
        return { ...block, content: next };
      }
      if (block.type === 'tool_call') {
        const step = byBlock.get(block);
        if (step === undefined) return block;
        // The words of a file written again, or read back, later: the later step carries the file.
        if (block.name === 'write_file' && typeof block.input['content'] === 'string' && later(step, ['write_file', 'read_file'])) {
          const next = cut(block.input['content'], 'written then; a later step has the file');
          if (next === block.input['content']) return block;
          changed = true;
          return { ...block, input: { ...block.input, content: next } };
        }
        if (block.name === 'edit_file' && later(step, ['write_file', 'read_file'])) {
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
