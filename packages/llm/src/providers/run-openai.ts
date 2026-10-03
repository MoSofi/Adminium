// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A streamed run against OpenAI's Chat Completions API, and against servers
 * that say they speak it.
 *
 * "Compatible" is not one format. The official API numbers each tool call
 * with an `index`, gives it an id on its first fragment, and spells its
 * arguments out as pieces of a JSON string. Other servers leave the index
 * out, give no id, send the arguments whole, or send them as an object; some
 * finish with `stop` although they called a tool, and some never report
 * usage. The reader below takes all of those, so one normaliser serves both
 * — the official API simply never exercises the lenient branches.
 *
 * The two differ in ONE request field: the official API takes
 * `max_completion_tokens` (its reasoning models refuse `max_tokens`), and
 * compatible servers know only `max_tokens`.
 */
import { parseItem, streamError, streamRequest } from './run-http.js';
import {
  parseCallArguments,
  RUN_FIRST_BYTE_TIMEOUT_MS,
  RUN_IDLE_TIMEOUT_MS,
  type MalformedCall,
  type ProviderRunner,
  type RunBlock,
  type RunMessage,
  type RunRequest,
  type RunResult,
  type RunStop,
} from './run-types.js';
import {
  ProviderError,
  requireApiKey,
  requireBaseUrl,
  stripTrailingSlash,
  type ProviderConfig,
  type ProviderId,
} from './types.js';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

/**
 * Our messages as chat messages. An assistant message carries its tool calls
 * beside its text; each tool result is a message of its own, in order, right
 * after the assistant message it answers.
 */
export function openAiMessages(system: string, messages: readonly RunMessage[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  if (system.length > 0) out.push({ role: 'system', content: system });
  for (const message of messages) {
    const text = message.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('');
    if (message.role === 'assistant') {
      const calls = message.content.flatMap((block) =>
        block.type === 'tool_call'
          ? [{ id: block.id, type: 'function', function: { name: block.name, arguments: JSON.stringify(block.input) } }]
          : [],
      );
      out.push({
        role: 'assistant',
        content: text.length > 0 ? text : null,
        ...(calls.length > 0 ? { tool_calls: calls } : {}),
      });
      continue;
    }
    // Results first: they must follow the assistant message directly.
    for (const block of message.content) {
      if (block.type === 'tool_result') out.push({ role: 'tool', tool_call_id: block.callId, content: block.content });
    }
    // Pictures make the message a list of parts; without one it stays the plain string every compatible server reads.
    const images = message.content.flatMap((block) =>
      block.type === 'image' && block.data.length > 0 ? [{ type: 'image_url', image_url: { url: `data:${block.mediaType};base64,${block.data}` } }] : [],
    );
    if (images.length > 0) out.push({ role: 'user', content: [...(text.length > 0 ? [{ type: 'text', text }] : []), ...images] });
    else if (text.length > 0) out.push({ role: 'user', content: text });
  }
  return out;
}

export function openAiRunBody(req: RunRequest, opts: { official: boolean; usage: boolean }): Record<string, unknown> {
  return {
    model: req.model,
    stream: true,
    ...(opts.usage ? { stream_options: { include_usage: true } } : {}),
    ...(opts.official ? { max_completion_tokens: req.maxTokens } : { max_tokens: req.maxTokens }),
    messages: openAiMessages(req.system, req.messages),
    ...(req.tools.length > 0
      ? {
          tools: req.tools.map((tool) => ({
            type: 'function',
            function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
          })),
        }
      : {}),
  };
}

interface OpenCall {
  id: string | null;
  name: string;
  /** Pieces of a JSON string, or the whole object when a server sent one. */
  raw: string;
  object: Record<string, unknown> | null;
  announced: boolean;
}

interface RunnerShape {
  provider: ProviderId;
  baseUrl: string;
  apiKey: string | undefined;
  official: boolean;
}

async function runOnce(shape: RunnerShape, req: RunRequest, usage: boolean): Promise<RunResult> {
  const { provider, apiKey } = shape;
  let text = '';
  const calls: OpenCall[] = [];
  let finish: string | null = null;
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;

  /** The call a fragment belongs to: by its index, else by its id, else the one still open. */
  const callFor = (fragment: { index?: unknown; id?: unknown }, position: number, only: boolean): OpenCall => {
    if (typeof fragment.index === 'number') {
      while (calls.length <= fragment.index) calls.push({ id: null, name: '', raw: '', object: null, announced: false });
      return calls[fragment.index] as OpenCall;
    }
    if (typeof fragment.id === 'string' && fragment.id.length > 0) {
      const known = calls.find((call) => call.id === fragment.id);
      if (known !== undefined) return known;
      const fresh: OpenCall = { id: fragment.id, name: '', raw: '', object: null, announced: false };
      calls.push(fresh);
      return fresh;
    }
    // No index and no id: a lone fragment continues the last call; several are one call each, in order.
    if (only && calls.length > 0) return calls[calls.length - 1] as OpenCall;
    while (calls.length <= position) calls.push({ id: null, name: '', raw: '', object: null, announced: false });
    return calls[position] as OpenCall;
  };

  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (apiKey !== undefined && apiKey.trim() !== '') headers['authorization'] = `Bearer ${apiKey}`;

  const stream = streamRequest({
    provider,
    url: `${shape.baseUrl}/chat/completions`,
    headers,
    body: openAiRunBody(req, { official: shape.official, usage }),
    apiKey,
    signal: req.signal,
    firstByteTimeoutMs: req.firstByteTimeoutMs ?? RUN_FIRST_BYTE_TIMEOUT_MS,
    idleTimeoutMs: req.idleTimeoutMs ?? RUN_IDLE_TIMEOUT_MS,
    mode: 'sse',
  });

  for await (const item of stream) {
    if (item.data.trim() === '[DONE]') break;
    const chunk = parseItem(provider, item, apiKey);
    if (chunk['error'] !== undefined && chunk['error'] !== null) {
      const error = chunk['error'] as { message?: unknown } | string;
      const message = typeof error === 'string' ? error : typeof error.message === 'string' ? error.message : JSON.stringify(error);
      throw streamError(provider, 'server', `the reply broke off: ${message}`, apiKey);
    }
    const reported = chunk['usage'] as { prompt_tokens?: unknown; completion_tokens?: unknown } | null | undefined;
    if (reported !== null && reported !== undefined) {
      if (typeof reported.prompt_tokens === 'number') inputTokens = reported.prompt_tokens;
      if (typeof reported.completion_tokens === 'number') outputTokens = reported.completion_tokens;
    }
    const choice = (chunk['choices'] as { delta?: Record<string, unknown>; finish_reason?: unknown }[] | undefined)?.[0];
    if (choice === undefined) continue;
    if (typeof choice.finish_reason === 'string') finish = choice.finish_reason;
    const delta = choice.delta;
    if (delta === undefined) continue;
    if (typeof delta['content'] === 'string' && delta['content'].length > 0) {
      text += delta['content'];
      req.onEvent?.({ type: 'text', delta: delta['content'] });
    }
    const fragments = Array.isArray(delta['tool_calls']) ? (delta['tool_calls'] as Record<string, unknown>[]) : [];
    fragments.forEach((fragment, position) => {
      const call = callFor(fragment, position, fragments.length === 1);
      if (typeof fragment['id'] === 'string' && fragment['id'].length > 0) call.id = fragment['id'];
      const fn = fragment['function'] as { name?: unknown; arguments?: unknown } | undefined;
      if (typeof fn?.name === 'string' && fn.name.length > 0) call.name = call.name.length === 0 ? fn.name : call.name;
      if (typeof fn?.arguments === 'string') call.raw += fn.arguments;
      else if (fn?.arguments !== null && typeof fn?.arguments === 'object') call.object = fn.arguments as Record<string, unknown>;
      if (!call.announced && call.name.length > 0) {
        call.announced = true;
        call.id ??= `call_${String(calls.indexOf(call) + 1)}`;
        req.onEvent?.({ type: 'tool_call', id: call.id, name: call.name });
      }
    });
  }

  const blocks: RunBlock[] = [];
  const malformed: MalformedCall[] = [];
  if (text.length > 0) blocks.push({ type: 'text', text });
  calls.forEach((call, index) => {
    // A slot an index skipped over, with nothing in it.
    if (call.name.length === 0 && call.raw.length === 0 && call.object === null) return;
    const id = call.id ?? `call_${String(index + 1)}`;
    const parsed = parseCallArguments(call.object ?? call.raw);
    if ('input' in parsed) {
      blocks.push({ type: 'tool_call', id, name: call.name, input: parsed.input });
    } else {
      blocks.push({ type: 'tool_call', id, name: call.name, input: {} });
      malformed.push({ id, name: call.name, raw: parsed.raw, error: parsed.error });
    }
  });

  const called = blocks.some((block) => block.type === 'tool_call');
  const stop: RunStop =
    finish === 'length' ? 'max_tokens' : finish === 'content_filter' ? 'refused' : called ? 'tool_calls' : 'end';
  return {
    blocks,
    stop,
    malformed,
    ...(typeof inputTokens === 'number' && typeof outputTokens === 'number' ? { usage: { inputTokens, outputTokens } } : {}),
  };
}

function createRunner(shape: RunnerShape): ProviderRunner {
  return {
    id: shape.provider,
    async run(req: RunRequest): Promise<RunResult> {
      try {
        return await runOnce(shape, req, true);
      } catch (error) {
        // A server that does not know `stream_options` and says so is asked again without it.
        if (
          !shape.official &&
          error instanceof ProviderError &&
          error.status === 400 &&
          /stream_options|include_usage/i.test(error.message)
        ) {
          return runOnce(shape, req, false);
        }
        throw error;
      }
    },
  };
}

export function createOpenAiRunner(config: ProviderConfig): ProviderRunner {
  return createRunner({
    provider: 'openai',
    apiKey: requireApiKey(config, 'openai'),
    baseUrl: config.baseUrl ? stripTrailingSlash(config.baseUrl) : DEFAULT_BASE_URL,
    official: true,
  });
}

export function createOpenAiCompatibleRunner(config: ProviderConfig): ProviderRunner {
  return createRunner({
    provider: 'openai-compatible',
    apiKey: config.apiKey,
    baseUrl: requireBaseUrl(config, 'openai-compatible'),
    official: false,
  });
}
