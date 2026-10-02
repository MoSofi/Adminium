// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A transcript a provider will accept.
 *
 * Every provider refuses a conversation where the model asked for a tool and
 * no answer follows. A turn that was stopped, or a server that went away in
 * the middle of one, leaves exactly that. Before the transcript is sent
 * again, each call left without an answer is given one: "interrupted".
 */
import type { RunBlock, RunMessage } from '@adminium/llm';

export const INTERRUPTED = 'Interrupted: this did not finish (the turn was stopped, or the server stopped).';

/** The transcript with every unanswered tool call answered. Messages are never removed. */
export function closeDangling(messages: readonly RunMessage[]): RunMessage[] {
  const out: RunMessage[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index] as RunMessage;
    out.push(message);
    if (message.role !== 'assistant') continue;
    const calls = message.content.filter((block): block is Extract<RunBlock, { type: 'tool_call' }> => block.type === 'tool_call');
    if (calls.length === 0) continue;
    const next = messages[index + 1];
    const answered = new Set(
      next?.role === 'user' ? next.content.flatMap((block) => (block.type === 'tool_result' ? [block.callId] : [])) : [],
    );
    const missing = calls.filter((call) => !answered.has(call.id));
    if (missing.length === 0) continue;
    const results: RunBlock[] = missing.map((call) => ({ type: 'tool_result', callId: call.id, content: INTERRUPTED, isError: true }));
    if (next?.role === 'user') {
      // The answers go first in the message that follows, ahead of anything the person said.
      out.push({ role: 'user', content: [...next.content.filter((block) => block.type === 'tool_result'), ...results, ...next.content.filter((block) => block.type !== 'tool_result')] });
      index += 1;
    } else {
      out.push({ role: 'user', content: results });
    }
  }
  return out;
}

/** Two user messages in a row become one: providers want the roles to take turns. */
export function joinUserMessages(messages: readonly RunMessage[]): RunMessage[] {
  const out: RunMessage[] = [];
  for (const message of messages) {
    const last = out[out.length - 1];
    if (last !== undefined && last.role === 'user' && message.role === 'user') {
      // Tool results stay ahead of words.
      const blocks = [...last.content, ...message.content];
      out[out.length - 1] = {
        role: 'user',
        content: [...blocks.filter((block) => block.type === 'tool_result'), ...blocks.filter((block) => block.type !== 'tool_result')],
      };
    } else {
      out.push(message);
    }
  }
  return out;
}
