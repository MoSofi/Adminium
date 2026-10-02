// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A streamed run against Ollama's `/api/chat`.
 *
 * The stream is one JSON object per line. Text arrives as `message.content`;
 * tool calls arrive whole, with their arguments already an object and no id
 * (one is made here, so a result can name the call it answers). The last
 * line has `done: true` and the token counts. A line `{ "error": "…" }` can
 * arrive in the middle of a reply that began with a 200.
 */
import { parseItem, streamError, streamRequest } from './run-http.js';
import {
  OLLAMA_RUN_FIRST_BYTE_TIMEOUT_MS,
  OLLAMA_RUN_IDLE_TIMEOUT_MS,
  parseCallArguments,
  type MalformedCall,
  type ProviderRunner,
  type RunBlock,
  type RunMessage,
  type RunRequest,
  type RunResult,
  type RunStop,
} from './run-types.js';
import { OLLAMA_NUM_CTX, stripTrailingSlash, type ProviderConfig } from './types.js';

const DEFAULT_BASE_URL = 'http://localhost:11434';

/** Our messages as Ollama's. A result names its tool, which is how Ollama pairs the two. */
export function ollamaMessages(system: string, messages: readonly RunMessage[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  if (system.length > 0) out.push({ role: 'system', content: system });
  /** The name each call id was made with, for the result that answers it. */
  const names = new Map<string, string>();
  for (const message of messages) {
    const text = message.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('');
    if (message.role === 'assistant') {
      const calls = message.content.flatMap((block) => {
        if (block.type !== 'tool_call') return [];
        names.set(block.id, block.name);
        return [{ function: { name: block.name, arguments: block.input } }];
      });
      out.push({ role: 'assistant', content: text, ...(calls.length > 0 ? { tool_calls: calls } : {}) });
      continue;
    }
    for (const block of message.content) {
      if (block.type !== 'tool_result') continue;
      const name = names.get(block.callId);
      out.push({ role: 'tool', content: block.content, ...(name === undefined ? {} : { tool_name: name }) });
    }
    if (text.length > 0) out.push({ role: 'user', content: text });
  }
  return out;
}

export function ollamaRunBody(req: RunRequest): Record<string, unknown> {
  return {
    model: req.model,
    stream: true,
    messages: ollamaMessages(req.system, req.messages),
    ...(req.tools.length > 0
      ? {
          tools: req.tools.map((tool) => ({
            type: 'function',
            function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
          })),
        }
      : {}),
    options: { num_predict: req.maxTokens, num_ctx: OLLAMA_NUM_CTX },
  };
}

export function createOllamaRunner(config: ProviderConfig): ProviderRunner {
  const baseUrl = config.baseUrl ? stripTrailingSlash(config.baseUrl) : DEFAULT_BASE_URL;

  return {
    id: 'ollama',
    async run(req: RunRequest): Promise<RunResult> {
      let text = '';
      const blocks: RunBlock[] = [];
      const malformed: MalformedCall[] = [];
      let reason: string | null = null;
      let inputTokens: number | undefined;
      let outputTokens: number | undefined;
      let done = false;
      let made = 0;

      const stream = streamRequest({
        provider: 'ollama',
        url: `${baseUrl}/api/chat`,
        headers: { 'content-type': 'application/json' },
        body: ollamaRunBody(req),
        signal: req.signal,
        firstByteTimeoutMs: req.firstByteTimeoutMs ?? OLLAMA_RUN_FIRST_BYTE_TIMEOUT_MS,
        idleTimeoutMs: req.idleTimeoutMs ?? OLLAMA_RUN_IDLE_TIMEOUT_MS,
        mode: 'lines',
      });

      for await (const item of stream) {
        const line = parseItem('ollama', item, undefined);
        if (typeof line['error'] === 'string') {
          throw streamError('ollama', 'server', `the reply broke off: ${line['error']}`, undefined);
        }
        const message = line['message'] as { content?: unknown; tool_calls?: unknown } | undefined;
        if (typeof message?.content === 'string' && message.content.length > 0) {
          text += message.content;
          req.onEvent?.({ type: 'text', delta: message.content });
        }
        for (const call of Array.isArray(message?.tool_calls) ? (message.tool_calls as Record<string, unknown>[]) : []) {
          const fn = call['function'] as { name?: unknown; arguments?: unknown } | undefined;
          if (typeof fn?.name !== 'string' || fn.name.length === 0) continue;
          made += 1;
          const id = typeof call['id'] === 'string' && call['id'].length > 0 ? call['id'] : `call_${String(made)}`;
          req.onEvent?.({ type: 'tool_call', id, name: fn.name });
          const parsed = parseCallArguments(fn.arguments ?? {});
          if ('input' in parsed) {
            blocks.push({ type: 'tool_call', id, name: fn.name, input: parsed.input });
          } else {
            blocks.push({ type: 'tool_call', id, name: fn.name, input: {} });
            malformed.push({ id, name: fn.name, raw: parsed.raw, error: parsed.error });
          }
        }
        if (line['done'] === true) {
          done = true;
          if (typeof line['done_reason'] === 'string') reason = line['done_reason'];
          if (typeof line['prompt_eval_count'] === 'number') inputTokens = line['prompt_eval_count'];
          if (typeof line['eval_count'] === 'number') outputTokens = line['eval_count'];
        }
      }

      if (!done) throw streamError('ollama', 'bad_response', 'the reply ended before it was complete', undefined);
      const called = blocks.length > 0;
      const stop: RunStop = reason === 'length' ? 'max_tokens' : called ? 'tool_calls' : 'end';
      return {
        blocks: text.length > 0 ? [{ type: 'text', text }, ...blocks] : blocks,
        stop,
        malformed,
        ...(typeof inputTokens === 'number' && typeof outputTokens === 'number' ? { usage: { inputTokens, outputTokens } } : {}),
      };
    },
  };
}
