// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A streamed run against Anthropic's Messages API.
 *
 * The stream is a sequence of named events. Text arrives as `text_delta`;
 * a tool call arrives as a `tool_use` block whose arguments are spelled out
 * piece by piece in `input_json_delta` and are only whole when the block
 * stops. An `error` event can arrive inside a reply that began with a 200.
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
import { requireApiKey, stripTrailingSlash, type ProviderConfig, type ProviderErrorCode } from './types.js';

const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_BASE_URL = 'https://api.anthropic.com';

/** Our messages as Anthropic's content blocks. */
export function anthropicMessages(messages: readonly RunMessage[]): { role: string; content: unknown[] }[] {
  return messages.map((message) => ({
    role: message.role,
    // A picture with no bytes (kept elsewhere, not filled in) is not sent.
    content: message.content.filter((block) => block.type !== 'image' || block.data.length > 0).map((block) => {
      if (block.type === 'text') return { type: 'text', text: block.text };
      if (block.type === 'tool_call') return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
      if (block.type === 'image') return { type: 'image', source: { type: 'base64', media_type: block.mediaType, data: block.data } };
      return {
        type: 'tool_result',
        tool_use_id: block.callId,
        content: block.content,
        ...(block.isError === true ? { is_error: true } : {}),
      };
    }),
  }));
}

/** Marks the end of what the API may keep from one call to the next. */
const CACHE = { cache_control: { type: 'ephemeral' } } as const;

/**
 * The request. A turn sends the same tools, the same system text and a
 * conversation that only grows, sixty times over: two cache marks let the API
 * read what it already has instead of being paid for it again. One after the
 * system text (the tools come before it in the API's order, so they are
 * covered), one on the conversation's last block. A prompt too short to cache
 * is answered as before; the marks are then ignored.
 */
export function anthropicRunBody(req: RunRequest): Record<string, unknown> {
  const messages = anthropicMessages(req.messages);
  const last = messages[messages.length - 1];
  if (last !== undefined && last.content.length > 0) {
    const tail = last.content[last.content.length - 1] as Record<string, unknown>;
    last.content[last.content.length - 1] = { ...tail, ...CACHE };
  }
  return {
    model: req.model,
    max_tokens: req.maxTokens,
    stream: true,
    ...(req.system.length > 0 ? { system: [{ type: 'text', text: req.system, ...CACHE }] } : {}),
    messages,
    ...(req.tools.length > 0
      ? { tools: req.tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.inputSchema })) }
      : {}),
  };
}

interface Usage {
  input_tokens?: unknown;
  cache_creation_input_tokens?: unknown;
  cache_read_input_tokens?: unknown;
}

/** What a call was sent, in tokens: what was read from the cache, or written to it, is still what was sent, and `input_tokens` alone leaves it out. */
function sentTokens(usage: Usage | undefined): number | undefined {
  if (typeof usage?.input_tokens !== 'number') return undefined;
  return (
    usage.input_tokens +
    (typeof usage.cache_creation_input_tokens === 'number' ? usage.cache_creation_input_tokens : 0) +
    (typeof usage.cache_read_input_tokens === 'number' ? usage.cache_read_input_tokens : 0)
  );
}

const STOPS: Record<string, RunStop> = {
  end_turn: 'end',
  stop_sequence: 'end',
  pause_turn: 'end',
  tool_use: 'tool_calls',
  max_tokens: 'max_tokens',
  model_context_window_exceeded: 'max_tokens',
  refusal: 'refused',
};

/** An error the API wrote into the stream, as the code a caller acts on. */
function errorCode(type: unknown): ProviderErrorCode {
  if (type === 'overloaded_error' || type === 'api_error') return 'server';
  if (type === 'rate_limit_error') return 'rate_limit';
  if (type === 'authentication_error' || type === 'permission_error') return 'auth';
  if (type === 'not_found_error') return 'not_found';
  return 'bad_response';
}

export function createAnthropicRunner(config: ProviderConfig): ProviderRunner {
  const apiKey = requireApiKey(config, 'anthropic');
  const baseUrl = config.baseUrl ? stripTrailingSlash(config.baseUrl) : DEFAULT_BASE_URL;

  return {
    id: 'anthropic',
    async run(req: RunRequest): Promise<RunResult> {
      const blocks: RunBlock[] = [];
      const malformed: MalformedCall[] = [];
      /** The block being received, by the stream's own index. */
      const open = new Map<number, { kind: 'text'; at: number } | { kind: 'tool'; at: number; raw: string }>();
      let stop: RunStop = 'end';
      let inputTokens: number | undefined;
      let outputTokens: number | undefined;
      let finished = false;

      const stream = streamRequest({
        provider: 'anthropic',
        url: `${baseUrl}/v1/messages`,
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION },
        body: anthropicRunBody(req),
        apiKey,
        signal: req.signal,
        firstByteTimeoutMs: req.firstByteTimeoutMs ?? RUN_FIRST_BYTE_TIMEOUT_MS,
        idleTimeoutMs: req.idleTimeoutMs ?? RUN_IDLE_TIMEOUT_MS,
        mode: 'sse',
      });

      for await (const item of stream) {
        const event = parseItem('anthropic', item, apiKey);
        const type = event['type'];
        if (type === 'message_start') {
          const sent = sentTokens((event['message'] as { usage?: Usage } | undefined)?.usage);
          if (sent !== undefined) inputTokens = sent;
        } else if (type === 'content_block_start') {
          const index = Number(event['index']);
          const block = event['content_block'] as { type?: unknown; id?: unknown; name?: unknown; text?: unknown } | undefined;
          if (block?.type === 'text') {
            blocks.push({ type: 'text', text: typeof block.text === 'string' ? block.text : '' });
            open.set(index, { kind: 'text', at: blocks.length - 1 });
          } else if (block?.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
            blocks.push({ type: 'tool_call', id: block.id, name: block.name, input: {} });
            open.set(index, { kind: 'tool', at: blocks.length - 1, raw: '' });
            req.onEvent?.({ type: 'tool_call', id: block.id, name: block.name });
          }
          // Any other block (thinking, a server tool) is not part of what we keep.
        } else if (type === 'content_block_delta') {
          const at = open.get(Number(event['index']));
          const delta = event['delta'] as { type?: unknown; text?: unknown; partial_json?: unknown } | undefined;
          if (at?.kind === 'text' && delta?.type === 'text_delta' && typeof delta.text === 'string') {
            const block = blocks[at.at];
            if (block?.type === 'text') block.text += delta.text;
            req.onEvent?.({ type: 'text', delta: delta.text });
          } else if (at?.kind === 'tool' && delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
            at.raw += delta.partial_json;
          }
        } else if (type === 'content_block_stop') {
          const index = Number(event['index']);
          const at = open.get(index);
          open.delete(index);
          if (at?.kind === 'tool') {
            const block = blocks[at.at];
            const parsed = parseCallArguments(at.raw);
            if (block?.type === 'tool_call') {
              if ('input' in parsed) block.input = parsed.input;
              else malformed.push({ id: block.id, name: block.name, raw: parsed.raw, error: parsed.error });
            }
          }
        } else if (type === 'message_delta') {
          const reason = (event['delta'] as { stop_reason?: unknown } | undefined)?.stop_reason;
          if (typeof reason === 'string') stop = STOPS[reason] ?? 'end';
          const usage = event['usage'] as (Usage & { output_tokens?: unknown }) | undefined;
          if (typeof usage?.output_tokens === 'number') outputTokens = usage.output_tokens;
          // The closing count, when the API gives one, is read the same way: its `input_tokens` alone would drop what the cache carried.
          const sent = sentTokens(usage);
          // Never below what the opening event counted: a closing event that gives the bare number again does not take the cache's share away.
          if (sent !== undefined) inputTokens = Math.max(inputTokens ?? 0, sent);
        } else if (type === 'message_stop') {
          finished = true;
        } else if (type === 'error') {
          const error = event['error'] as { type?: unknown; message?: unknown } | undefined;
          throw streamError(
            'anthropic',
            errorCode(error?.type),
            `the reply broke off: ${typeof error?.message === 'string' ? error.message : String(error?.type ?? 'error')}`,
            apiKey,
          );
        }
        // `ping` and anything new are passed over.
      }

      if (!finished) throw streamError('anthropic', 'bad_response', 'the reply ended before it was complete', apiKey);
      // A call cut off by the token limit never got its closing event: it cannot be run.
      for (const at of open.values()) {
        if (at.kind !== 'tool') continue;
        const block = blocks[at.at];
        if (block?.type === 'tool_call') {
          malformed.push({ id: block.id, name: block.name, raw: at.raw.slice(0, 2000), error: 'the call was cut off before its arguments were complete' });
        }
      }
      const kept = blocks.filter((block) => block.type !== 'text' || block.text.length > 0);
      return {
        blocks: kept,
        stop: kept.some((block) => block.type === 'tool_call') && stop === 'end' ? 'tool_calls' : stop,
        malformed,
        ...(typeof inputTokens === 'number' && typeof outputTokens === 'number' ? { usage: { inputTokens, outputTokens } } : {}),
      };
    },
  };
}
